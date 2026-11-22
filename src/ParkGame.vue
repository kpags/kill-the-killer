<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { areas } from '../shared/park.js'
import { killFlashMs } from '../shared/combat.js'
import { maxProfile, profileBarSize, profileBars, profileFill } from '../shared/profile.js'
import AudioSettings from './AudioSettings.vue'
import { createParkRenderer, loadParkArt } from './parkRenderer.js'

const audioSettings = defineModel('audioSettings', { type: Object, required: true })
const props = defineProps({
  state: Object,
  playerId: { type: String, required: true },
  reconnecting: Boolean,
  input: { type: Function, required: true },
  command: { type: Function, required: true },
  leave: { type: Function, required: true },
})

const directions = [
  { key: 'KeyW', label: 'Move up', arrow: '↑' },
  { key: 'KeyA', label: 'Move left', arrow: '←' },
  { key: 'KeyS', label: 'Move down', arrow: '↓' },
  { key: 'KeyD', label: 'Move right', arrow: '→' },
]
const actionSlots = ['Phone', 'Talk', 'Dance', 'Scream', null, null]
const idleSprites = import.meta.glob('../assets/gameplay/*-idle.webp', { eager: true, import: 'default', query: '?url' })
const pressed = new Set()
const pointers = new Map()
const movement = new Set([...directions.map(({ key }) => key), 'ShiftLeft'])
const canvas = ref(null)
const overheadPrompt = ref(null)
const artReady = ref(false)
const error = ref('')
const pauseScreen = ref(null)
const pauseDialog = ref(null)
const actionsOpen = ref(false)
const actionsDialog = ref(null)
const resumeButton = ref(null)
const settingsButton = ref(null)
const settingsPanel = ref(null)
const exiting = ref(false)
const focusPanel = ref(null)
const area = computed(() => areas[props.state?.area])
const stamina = computed(() => props.state?.stamina ?? 100)
const profile = computed(() => props.state?.profile ?? profileBarSize)
const profileFills = computed(() => Array.from({ length: profileBars }, (_, index) => profileFill(profile.value, index)))
const profileLabel = computed(() => profile.value >= maxProfile ? 'Max' : `${Math.floor(profile.value * 10) / 10}%`)
const target = computed(() => props.state?.target ?? null)
const purplePortrait = ref(null)
const targetSprite = computed(() => {
  const color = target.value?.color
  if (color === 'purple' && purplePortrait.value) return purplePortrait.value
  return color ? idleSprites[`../assets/gameplay/${color}-idle.webp`] : null
})
const spot = computed(() => area.value?.spots.find(({ id }) => id === props.state?.spotId))
const hidden = computed(() => props.state?.mode === 'hide')
const inspecting = computed(() => props.state?.mode === 'inspect' && spot.value)
const alive = computed(() => props.state?.life === 'alive')
const canAct = computed(() => alive.value && !props.state?.matchEnded && props.state?.mode !== 'combat')
const canMove = computed(() => canAct.value && ['free', 'action'].includes(props.state?.mode))
const lifecycleNotice = computed(() => {
  if (props.state?.winner) return `${props.state.winner.name} wins!`
  if (props.state?.respawnMs) return `Respawning in ${Math.ceil(props.state.respawnMs / 1000)}s`
  if (props.state?.spectating) return 'Spectating'
  if (props.state && !alive.value) return 'You were eliminated.'
  return null
})
const prompt = computed(() => {
  if (!canAct.value) return null
  switch (props.state?.mode) {
    case 'hide': return `Leave hiding · ${Math.ceil(props.state.hidingMs / 1000)}s`
    case 'sit': return 'Stand up'
    case 'dance': return 'Stop dancing'
    case 'inspect': return 'Close'
    default: {
      const nearby = spot.value
      if (!nearby) return props.state?.mode === 'action' ? 'Stop action' : null
      if (nearby.hiding) return `Hide · ${nearby.name}`
      if (nearby.type.main === 'sitting') return `Sit · ${nearby.name}`
      if (nearby.type.sub === 'music') return `Dance · ${nearby.name}`
      return nearby.name
    }
  }
})

let draw
let frameId
let repeatInput
let disposed = false
let fadedForeground = 0
let activeCommand = false
let pointer = null
let hoveredActorId = null

function transmit() {
  const active = new Set([...pressed, ...pointers.values()])
  const blocked = pauseScreen.value || actionsOpen.value || !artReady.value || props.reconnecting || !canMove.value
  props.input({
    x: blocked ? 0 : Number(active.has('KeyD')) - Number(active.has('KeyA')),
    y: blocked ? 0 : Number(active.has('KeyS')) - Number(active.has('KeyW')),
    sprint: !blocked && active.has('ShiftLeft'),
  })
}

function release() {
  pointer = null
  hoveredActorId = null
  releaseMovement()
}

function releaseMovement() {
  pressed.clear()
  pointers.clear()
  transmit()
}

async function interact() {
  if (pauseScreen.value || actionsOpen.value || activeCommand || !prompt.value || props.reconnecting) return
  activeCommand = true
  error.value = ''
  release()
  try {
    await props.command('interact')
  } catch (failure) {
    error.value = failure.message
  } finally {
    activeCommand = false
  }
}

function closeActions() {
  if (!actionsOpen.value) return
  actionsDialog.value.close()
  actionsOpen.value = false
  if (inspecting.value) focusPanel.value?.focus()
  else refocus()
}

function toggleActions() {
  if (actionsOpen.value) {
    closeActions()
    return
  }
  if (!canAct.value || !artReady.value || props.reconnecting || pauseScreen.value) return
  actionsOpen.value = true
  release()
  actionsDialog.value.showModal()
}

async function selectAction(label) {
  if (!actionsOpen.value || !canAct.value || activeCommand || props.reconnecting) return
  activeCommand = true
  error.value = ''
  closeActions()
  try {
    await props.command('play_action', { action: label.toLowerCase() })
  } catch (failure) {
    error.value = failure.message
  } finally {
    activeCommand = false
  }
}

function pointAt(event) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function hover(event) {
  pointer = pointAt(event)
}

function clearHover() {
  pointer = null
  hoveredActorId = null
}

async function attack(event) {
  if (event.button !== 0 || !canAct.value || pauseScreen.value || actionsOpen.value
    || activeCommand || props.reconnecting || !artReady.value) return
  pointer = pointAt(event)
  const { attackId } = draw(props.state, performance.now(), props.playerId, false, pointer, true)
  if (!attackId) return
  activeCommand = true
  error.value = ''
  releaseMovement()
  refocus()
  try {
    await props.command('attack', { actorId: attackId })
  } catch (failure) {
    error.value = failure.message
  } finally {
    activeCommand = false
  }
}

async function spectate(event) {
  const field = event.currentTarget
  const nextArea = Number(field.value)
  field.value = String(props.state.area)
  if (activeCommand || pauseScreen.value || props.reconnecting) return
  activeCommand = true
  error.value = ''
  try {
    await props.command('spectate_area', { area: nextArea })
  } catch (failure) {
    error.value = failure.message
  } finally {
    activeCommand = false
  }
}

function keyDown(event) {
  if (event.code === 'KeyP' && !event.repeat) {
    event.preventDefault()
    openPause()
    return
  }
  if (pauseScreen.value) return
  if (event.code === 'KeyF') {
    event.preventDefault()
    if (!event.repeat) toggleActions()
    return
  }
  if (actionsOpen.value) return
  if (movement.has(event.code)) {
    event.preventDefault()
    if (event.repeat) return
    pressed.add(event.code)
    transmit()
  } else if (event.code === 'KeyE' && !event.repeat) {
    event.preventDefault()
    interact()
  }
}

function keyUp(event) {
  if (!pressed.delete(event.code)) return
  event.preventDefault()
  transmit()
}

function holdTouch(event, key) {
  if (pauseScreen.value || actionsOpen.value) return
  event.currentTarget.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, key)
  transmit()
}

function releaseTouch(event) {
  if (pointers.delete(event.pointerId)) transmit()
}

function refocus() {
  canvas.value?.focus({ preventScroll: true })
}

watch(inspecting, (value, previous) => {
  if (pauseScreen.value || actionsOpen.value) return
  if (value) focusPanel.value?.focus()
  else if (previous) refocus()
}, { flush: 'post' })

watch(() => props.reconnecting, (value) => {
  if (value) {
    closeActions()
    release()
  }
})
watch(canAct, (value) => { if (!value) closeActions() })
watch(canMove, (value) => { if (!value) releaseMovement() })
watch(() => props.state?.matchEnded, (value) => { if (value) release() })

async function openPause() {
  if (pauseScreen.value) return
  closeActions()
  pauseScreen.value = 'pause'
  error.value = ''
  release()
  pauseDialog.value.showModal()
  await nextTick()
  resumeButton.value?.focus()
}

function resume() {
  if (exiting.value) return
  pauseScreen.value = null
  pauseDialog.value.close()
  if (inspecting.value) focusPanel.value?.focus()
  else refocus()
}

async function openPauseSettings() {
  pauseScreen.value = 'settings'
  await nextTick()
  settingsPanel.value?.focusHeading()
}

async function backToPause() {
  pauseScreen.value = 'pause'
  await nextTick()
  settingsButton.value?.focus()
}

function cancelPause() {
  if (pauseScreen.value === 'settings') backToPause()
  else resume()
}

async function exitGame() {
  if (exiting.value || props.reconnecting) return
  exiting.value = true
  error.value = ''
  release()
  try {
    await props.leave()
  } catch (failure) {
    error.value = failure.message
  } finally {
    exiting.value = false
  }
}

function render(now) {
  if (props.state) {
    const label = overheadPrompt.value
    const { faded, head, hoveredId } = draw(props.state, now, props.playerId, Boolean(label),
      pauseScreen.value || actionsOpen.value || props.reconnecting ? null : pointer)
    fadedForeground = faded
    hoveredActorId = hoveredId
    canvas.value.style.cursor = hoveredId && canAct.value ? 'pointer' : 'default'
    if (label && head) {
      const inset = 5
      const x = Math.max(inset, Math.min(
        canvas.value.clientWidth - label.offsetWidth - inset,
        head.x - label.offsetWidth / 2,
      ))
      const y = Math.max(inset, head.y - label.offsetHeight - 8)
      label.style.transform = `translate3d(${x}px, ${y}px, 0)`
      label.style.visibility = 'visible'
    } else if (label) {
      label.style.visibility = 'hidden'
    }
  }
  frameId = requestAnimationFrame(render)
}

onMounted(async () => {
  refocus()
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', release)
  document.addEventListener('visibilitychange', release)
  repeatInput = window.setInterval(() => {
    if (pressed.size || pointers.size) transmit()
  }, 80)

  try {
    const art = await loadParkArt()
    if (disposed) return
    purplePortrait.value = art['purple-idle'].image.toDataURL()
    draw = createParkRenderer(canvas.value, art)
    artReady.value = true
    frameId = requestAnimationFrame(render)
  } catch {
    if (!disposed) error.value = 'Park artwork could not load.'
  }
})

onUnmounted(() => {
  disposed = true
  release()
  cancelAnimationFrame(frameId)
  window.clearInterval(repeatInput)
  window.removeEventListener('keydown', keyDown)
  window.removeEventListener('keyup', keyUp)
  window.removeEventListener('blur', release)
  document.removeEventListener('visibilitychange', release)
})

function readState() {
  return {
    screen: 'park',
    playerId: props.playerId,
    area: area.value?.id ?? null,
    artReady: artReady.value,
    stamina: stamina.value,
    profile: profile.value,
    score: props.state?.score,
    target: target.value,
    life: props.state?.life,
    spectating: props.state?.spectating,
    respawnMs: props.state?.respawnMs,
    winner: props.state?.winner,
    hoveredActorId,
    modelScale: area.value?.modelScale,
    pause: pauseScreen.value,
    actionsOpen: actionsOpen.value,
    mode: props.state?.mode,
    spot: spot.value?.name ?? null,
    hidingMs: props.state?.hidingMs,
    actors: props.state?.actors ?? [],
    fadedForeground,
    reconnecting: props.reconnecting,
  }
}

defineExpose({ readState })
</script>

<template>
  <main class="park-game">
    <header class="park-hud">
      <div class="park-profile">
        <div class="park-profile-track" role="meter" aria-labelledby="park-profile-label"
          aria-valuemin="0" :aria-valuemax="maxProfile" :aria-valuenow="profile" :aria-valuetext="profileLabel">
          <span v-for="(fill, index) in profileFills" :key="index" class="park-profile-segment">
            <span class="park-profile-fill" :style="{ transform: `scaleX(${fill})` }"></span>
          </span>
        </div>
        <span class="park-profile-label"><span id="park-profile-label">Profile Meter</span><span>{{ profileLabel }}</span></span>
        <span v-if="state?.score != null">Score {{ state.score }}</span>
      </div>
      <h1>{{ area?.name ?? 'Park' }}</h1>
      <div class="park-stamina">
        <span id="park-stamina-label">Stamina</span>
        <div id="park-stamina" class="park-stamina-track" role="meter" aria-labelledby="park-stamina-label"
          aria-valuemin="0" aria-valuemax="100" :aria-valuenow="stamina">
          <span class="park-stamina-fill" :style="{ transform: `scaleX(${stamina / 100})` }"></span>
        </div>
      </div>
      <button type="button" class="glass-button park-button park-hud-pause" aria-keyshortcuts="P" @click="openPause">Pause</button>
      <section class="park-target" aria-label="Target">
        <div class="park-target-text">
          <span v-if="target">Kill</span>
          <strong>{{ target?.name ?? 'No target' }}</strong>
        </div>
        <div class="park-target-frame" aria-hidden="true">
          <img v-if="targetSprite" :src="targetSprite" alt="" />
        </div>
      </section>
    </header>

    <div class="park-stage">
      <canvas ref="canvas" tabindex="0" :aria-label="'Park · ' + (area?.name ?? 'loading')"
        @pointermove="hover" @pointerleave="clearHover" @pointercancel="clearHover" @click="attack" />
      <p v-if="error || reconnecting || !state || !artReady" class="park-notice" role="status">
        {{ error || (reconnecting ? 'Reconnecting…' : 'Loading Park…') }}
      </p>
      <p v-if="state?.killAward" class="park-notice park-kill-award" role="status">
        {{ state.killAward.rating }} +{{ state.killAward.points }}
      </p>
      <section v-if="inspecting" ref="focusPanel" class="park-panel" tabindex="-1" :aria-label="spot.name">
        <h2>{{ spot.name }}</h2>
        <p>{{ spot.effect }}</p>
        <button type="button" class="glass-button park-button" @click="interact">Close</button>
      </section>
      <div v-else-if="prompt && artReady" ref="overheadPrompt" class="park-prompt" :class="{ 'park-hidden': hidden }">
        <kbd>E</kbd><span class="park-touch-label">Interact</span><span>{{ prompt }}</span>
      </div>
      <section v-if="lifecycleNotice" class="park-lifecycle" aria-label="Match status">
        <strong role="status">{{ lifecycleNotice }}</strong>
        <label v-if="state.spectating" for="spectator-area">Watch area</label>
        <select v-if="state.spectating" id="spectator-area" :value="state.area"
          :disabled="reconnecting || Boolean(pauseScreen)" @change="spectate">
          <option v-for="(place, index) in areas" :key="place.id" :value="index">{{ place.name }}</option>
        </select>
        <span v-if="state.winner">Use Pause to exit.</span>
      </section>
    </div>

    <div class="park-touch" aria-label="Touch controls">
      <div class="park-direction">
        <button
          v-for="{ key, label, arrow } in directions"
          :key="key"
          type="button"
          class="glass-button park-button"
          :class="key"
          :aria-label="label"
          :disabled="!canMove || reconnecting"
          @pointerdown.prevent="holdTouch($event, key)"
          @pointerup="releaseTouch"
          @pointercancel="releaseTouch"
          @lostpointercapture="releaseTouch"
        >{{ arrow }}</button>
      </div>
      <div class="park-touch-actions">
        <button
          type="button"
          class="glass-button park-button"
          :disabled="!canMove || reconnecting"
          @pointerdown.prevent="holdTouch($event, 'ShiftLeft')"
          @pointerup="releaseTouch"
          @pointercancel="releaseTouch"
          @lostpointercapture="releaseTouch"
        >Sprint</button>
        <button type="button" class="glass-button park-button" :disabled="!prompt || reconnecting" @click="interact">
          Interact
        </button>
        <button type="button" class="glass-button park-button" aria-haspopup="dialog"
          :disabled="!canAct || !artReady || reconnecting" @click="toggleActions">Actions</button>
      </div>
    </div>

    <dialog ref="actionsDialog" class="park-actions-dialog" aria-label="Actions"
      @cancel.prevent="closeActions" @click.self="closeActions">
      <div class="park-actions-wheel">
        <template v-for="(label, index) in actionSlots" :key="index">
          <button v-if="label" type="button" class="park-action-slice"
            :style="{ '--turn': `${index * 60}deg` }" @click="selectAction(label)">
            <span>{{ label }}</span>
          </button>
          <div v-else class="park-action-slice park-action-blank" aria-hidden="true"
            :style="{ '--turn': `${index * 60}deg` }"></div>
        </template>
        <button type="button" class="park-action-center" aria-label="Close Actions" @click="closeActions">Actions</button>
      </div>
    </dialog>

    <dialog ref="pauseDialog" class="park-pause-dialog" :aria-label="pauseScreen === 'settings' ? 'Settings' : 'Pause menu'"
      @cancel.prevent="cancelPause">
      <AudioSettings v-if="pauseScreen === 'settings'" ref="settingsPanel" v-model="audioSettings" @back="backToPause" />
      <section v-else class="park-pause-menu">
        <h2>Paused</h2>
        <button ref="resumeButton" type="button" class="glass-button park-button" :disabled="exiting" @click="resume">Resume</button>
        <button ref="settingsButton" type="button" class="glass-button park-button" :disabled="exiting"
          @click="openPauseSettings">Settings</button>
        <button type="button" class="glass-button park-button" :disabled="exiting || reconnecting" @click="exitGame">Exit</button>
        <p v-if="error || reconnecting" class="park-pause-status" role="status">{{ error || 'Reconnecting…' }}</p>
      </section>
    </dialog>

    <div v-if="state?.killFlashAt != null && !reconnecting" :key="state.killFlashAt"
      class="park-kill-flash" :style="{ '--flash-duration': `${killFlashMs}ms` }" aria-hidden="true"></div>
  </main>
</template>

<style scoped>
.park-game {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  min-height: 315px;
  background: #101728;
}

.park-hud {
  display: grid;
  grid-template-areas: "profile area stamina pause target";
  grid-template-columns: minmax(100px, 1fr) auto minmax(70px, 170px) auto minmax(120px, 1fr);
  align-items: center;
  gap: clamp(8px, 3vw, 28px);
  padding: 10px clamp(10px, 3vw, 34px);
  background: #201e28;
  border-bottom: 1px solid #ffdfba40;
}

.park-hud h1 {
  grid-area: area;
  margin: 0;
  font-size: clamp(1.1rem, 3vw, 1.65rem);
  line-height: 1.1;
}

.park-stamina {
  grid-area: stamina;
  display: grid;
  gap: 1px;
  width: 100%;
  max-width: 170px;
  font-size: 0.75rem;
  font-weight: 700;
}

.park-stamina-track {
  width: 100%;
  height: 0.625rem;
  overflow: hidden;
  border: 1px solid #7399c17a;
  border-radius: 1rem;
  background: #11192b;
}

.park-stamina-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f78e9, #7acaff);
  transform-origin: left center;
  transition: transform 200ms linear;
}

.park-hud-pause {
  grid-area: pause;
  justify-self: end;
}

.park-profile {
  grid-area: profile;
  display: grid;
  gap: 4px;
  width: 100px;
  font-size: 0.75rem;
  font-weight: 700;
}

.park-profile-track {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  width: 100px;
  height: 15px;
}

.park-profile-label {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  font-size: 0.6875rem;
}

.park-profile-segment {
  overflow: hidden;
  border: 1px solid #7399c17a;
  border-radius: 3px;
  background: #11192b;
}

.park-profile-fill {
  display: block;
  width: 100%;
  height: 100%;
  background: #2158bd;
  transform-origin: left center;
  transition: transform 200ms linear;
}

.park-profile-segment:nth-child(2) .park-profile-fill { background: #3989ee; }
.park-profile-segment:nth-child(3) .park-profile-fill { background: #88d7ff; }

.park-target {
  grid-area: target;
  display: flex;
  align-items: center;
  justify-content: end;
  gap: 8px;
  min-width: 0;
  text-align: right;
}

.park-target-text {
  display: grid;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.park-target-text span {
  color: #ffb4b1;
  font-size: 0.75rem;
  font-weight: 800;
}

.park-target-text strong {
  font-size: 0.875rem;
  line-height: 1.1;
}

.park-target-frame {
  position: relative;
  flex: none;
  width: 48px;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid #ffdfba65;
  border-radius: 8px;
  background: #11192b;
}

.park-target-frame img {
  position: absolute;
  /* Crop the 48px square at (56, 8) from the 160px idle sprite. */
  width: calc(100% * 160 / 48);
  max-width: none;
  top: calc(-100% * 8 / 48);
  left: calc(-100% * 56 / 48);
}

@media (max-width: 640px) {
  .park-hud {
    grid-template-areas: "profile target target" "area stamina pause";
    grid-template-columns: 100px minmax(0, 1fr) auto;
    gap: 8px;
    padding-block: 8px;
  }

  .park-hud h1 {
    overflow-wrap: anywhere;
  }

  .park-target-frame { width: 40px; }
  .park-target-text strong { font-size: 0.75rem; }
}

@media (prefers-reduced-motion: reduce) {
  .park-stamina-fill,
  .park-profile-fill {
    transition: none;
  }
}

.park-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.park-stage canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.park-lifecycle {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px 12px;
  width: max-content;
  max-width: calc(100% - 24px);
  padding: 12px;
  border: 1px solid #ffdfba65;
  border-radius: 12px;
  background: #251e25ee;
  text-align: center;
}

.park-lifecycle select {
  min-width: 0;
  max-width: 100%;
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid #ffdfba65;
  border-radius: 8px;
  background: #382820;
  color: inherit;
  font: inherit;
  color-scheme: dark;
}

.park-stage canvas:focus {
  outline: none;
}

.park-kill-flash {
  position: fixed;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  box-shadow: inset 0 0 clamp(30px, 8vmin, 85px) clamp(10px, 2vmin, 24px) #ed1e35e6;
  animation: park-kill-flash var(--flash-duration) ease-out both;
}

@keyframes park-kill-flash {
  0% { opacity: 0.85; }
  100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .park-kill-flash {
    animation: none;
    opacity: 0.38;
  }
}

.park-button {
  min-height: 44px;
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 0.9rem;
  touch-action: none;
  user-select: none;
}

.park-prompt,
.park-notice {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: calc(100% - 20px);
  margin: 0;
  padding: 7px 12px;
  border: 1px solid #ffdfba65;
  border-radius: 12px;
  background: #251e25ee;
  font-size: 0.875rem;
}

.park-kill-award {
  top: auto;
  left: auto;
  right: 12px;
  bottom: 12px;
  transform: none;
  pointer-events: none;
}

.park-prompt {
  top: 0;
  left: 0;
  visibility: hidden;
  pointer-events: none;
}

.park-notice {
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
}

.park-prompt kbd,
.park-touch-label {
  font: inherit;
  font-weight: 800;
}

.park-touch-label {
  display: none;
}

.park-hidden {
  border-color: #9bd2f6;
}

.park-panel {
  position: absolute;
  inset: 50% auto auto 50%;
  width: min(340px, calc(100% - 24px));
  padding: 16px;
  border: 1px solid #ffdfba80;
  border-radius: 15px;
  background: #382820f2;
  transform: translate(-50%, -50%);
}

.park-panel h2 {
  margin: 0;
  font-size: 1.12rem;
}

.park-panel p {
  margin: 9px 0 12px;
  font-size: 0.9rem;
}

.park-actions-dialog {
  width: min(19rem, calc(100vw - 24px), calc(100dvh - 24px));
  max-width: none;
  max-height: none;
  padding: 0;
  border: 0;
  overflow: visible;
  background: transparent;
  color: inherit;
}

.park-actions-dialog::backdrop {
  background: #101728b8;
}

.park-actions-wheel {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: #171624;
  box-shadow: 0 8px 34px #090915c7, inset 0 0 0 1px #ffdfba42;
}

.park-action-slice {
  --slice: #785345;
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  clip-path: polygon(38.1% 27.8%, 23.4% 0, 76.6% 0, 61.9% 27.8%);
  background: conic-gradient(from -28deg, var(--slice) 56deg, transparent 56deg);
  mask-image: radial-gradient(circle closest-side, transparent 53%, #000 54%, #000 99%, transparent 100%);
  color: #fff4e8;
  font: inherit;
  font-weight: 750;
  cursor: pointer;
  transform: rotate(var(--turn));
}

.park-action-slice:hover,
.park-action-slice:focus-visible {
  --slice: #ffc15c;
  color: #211413;
}

.park-action-slice span {
  position: absolute;
  top: 12%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(calc(0deg - var(--turn)));
}

.park-action-blank {
  --slice: #383143;
  pointer-events: none;
}

.park-action-center {
  position: absolute;
  inset: 27%;
  z-index: 1;
  padding: 0;
  border: 1px solid #ffdfba54;
  border-radius: 50%;
  background: #201e28;
  color: inherit;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.park-action-center:focus-visible {
  outline: 2px solid #ffc15c;
  outline-offset: 2px;
}

.park-pause-dialog {
  width: min(calc(100% - 28px), 20rem);
  max-height: calc(100dvh - 28px);
  padding: 0;
  border: 0;
  border-radius: 24px;
  background: transparent;
  color: inherit;
}

.park-pause-dialog::backdrop {
  background: #101728b8;
}

.park-pause-menu {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid #ffdfba80;
  border-radius: 24px;
  background: #382820f2;
  box-shadow: inset 0 1px 0 #fff4e459;
}

.park-pause-menu h2 {
  margin: 0 0 4px;
}

.park-pause-status {
  margin: 0;
  font-size: 0.875rem;
}

.park-touch {
  display: none;
}

@media (any-pointer: coarse) {
  .park-touch {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px max(8px, env(safe-area-inset-bottom));
    background: #201e28;
  }

  .park-direction {
    display: grid;
    grid-template-areas: '. up .' 'left down right';
    grid-template-columns: repeat(3, 44px);
    gap: 3px;
  }

  .KeyW { grid-area: up; }
  .KeyA { grid-area: left; }
  .KeyS { grid-area: down; }
  .KeyD { grid-area: right; }

  .park-touch-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 5px;
  }

  .park-prompt kbd {
    display: none;
  }

  .park-touch-label {
    display: inline;
  }
}
</style>
