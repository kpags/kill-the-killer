<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { normalizeInviteCode } from '../shared/lobbyRules.js'
import RoomLobby from './RoomLobby.vue'
import ParkGame from './ParkGame.vue'
import AudioSettings from './AudioSettings.vue'
import { createRoomConnection } from './roomConnection.js'
import { useGameAudio } from './menuAudio.js'

const actions = ['Play', 'Join Room', 'Settings']
const audioStorageKey = 'kill-the-killer-audio-settings'
const defaultAudioLevel = 20
const lobby = ref(null)
const game = ref(null)
const home = ref(null)
const joinFormOpen = ref(false)
const joinInput = ref(null)
const inviteCode = ref('')
const pending = ref(false)
const homeError = ref('')
const homeSettingsOpen = ref(false)
const homeSettings = ref(null)
const homeSettingsButton = ref(null)
const audioSettings = ref(loadAudioSettings())

function loadAudioSettings() {
  const normalize = (value) => Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : defaultAudioLevel
  try {
    const saved = JSON.parse(window.localStorage.getItem(audioStorageKey))
    return { sfx: normalize(saved?.sfx), music: normalize(saved?.music) }
  } catch {
    return { sfx: defaultAudioLevel, music: defaultAudioLevel }
  }
}

watch(audioSettings, (levels) => {
  try {
    window.localStorage.setItem(audioStorageKey, JSON.stringify(levels))
  } catch {
    // The sliders still apply for this session if storage is unavailable.
  }
}, { flush: 'sync' })

const connection = createRoomConnection(async (reason) => {
  homeError.value = reason
  await focusPlay()
}, (sounds) => playCombatSounds(sounds))
const { room, playerId, park, reconnecting } = connection
const menuActive = computed(() => room.value?.phase !== 'park')
const { playCombatSounds, getFireworksSceneTime } = useGameAudio(audioSettings, menuActive, park)

watch(room, (value, previous) => {
  if (value && !previous) lobby.value?.focusHeading()
}, { flush: 'post' })

async function openRoom(type) {
  if (pending.value || reconnecting.value) return
  const code = type === 'join' ? normalizeInviteCode(inviteCode.value) : null
  if (type === 'join' && !code) {
    homeError.value = 'Enter a six-character room code using letters or digits.'
    joinInput.value?.focus()
    return
  }
  homeError.value = ''
  pending.value = true
  try {
    await connection.command(type, { code })
    joinFormOpen.value = false
    inviteCode.value = ''
  } catch (error) {
    homeError.value = error.message
  } finally {
    pending.value = false
  }
}

async function showJoinForm() {
  homeError.value = ''
  joinFormOpen.value = true
  await nextTick()
  joinInput.value?.focus()
}

async function cancelJoin() {
  joinFormOpen.value = false
  homeError.value = ''
  await nextTick()
  home.value?.querySelector('#join-room')?.focus()
}

async function focusPlay() {
  await nextTick()
  window.scrollTo(0, 0)
  home.value?.querySelector('#play')?.focus({ preventScroll: true })
}

async function leaveRoom() {
  await connection.leave()
  await focusPlay()
}

async function openHomeSettings() {
  homeError.value = ''
  homeSettingsOpen.value = true
  await nextTick()
  homeSettings.value?.focusHeading()
}

async function closeHomeSettings() {
  homeSettingsOpen.value = false
  await nextTick()
  homeSettingsButton.value?.focus()
}

onMounted(() => {
  connection.restore()
  window.render_game_to_text = () => JSON.stringify(game.value?.readState() ?? lobby.value?.readState() ?? {
    screen: homeSettingsOpen.value ? 'settings' : joinFormOpen.value ? 'join' : 'home',
    actions,
    notice: homeError.value || null,
  })
})

onUnmounted(() => {
  connection.dispose()
  delete window.render_game_to_text
})
</script>

<template>
  <ParkGame
    v-if="room?.phase === 'park'"
    ref="game"
    v-model:audio-settings="audioSettings"
    :state="park"
    :player-id="playerId"
    :reconnecting="reconnecting"
    :input="connection.input"
    :command="connection.command"
    :leave="leaveRoom"
    :play-sounds="playCombatSounds"
    :get-fireworks-scene-time="getFireworksSceneTime"
  />
  <RoomLobby
    v-else-if="room"
    ref="lobby"
    :room="room"
    :player-id="playerId"
    :reconnecting="reconnecting"
    :command="connection.command"
    :leave="leaveRoom"
  />
  <main v-else ref="home" class="home game-scene">
    <section class="home-menu" aria-labelledby="game-title">
      <h1 id="game-title">Kill the Killer</h1>

      <AudioSettings v-if="homeSettingsOpen" ref="homeSettings" v-model="audioSettings"
        @back="closeHomeSettings" @keydown.esc.prevent="closeHomeSettings" />
      <div v-else-if="!joinFormOpen" class="menu-actions">
        <button id="play" class="glass-button" type="button" :disabled="pending || reconnecting" @click="openRoom('create')">Play</button>
        <button id="join-room" class="glass-button" type="button" :disabled="pending || reconnecting" @click="showJoinForm">Join Room</button>
        <button ref="homeSettingsButton" class="glass-button" type="button" :disabled="pending || reconnecting"
          @click="openHomeSettings">Settings</button>
      </div>
      <form v-else class="join-form" @submit.prevent="openRoom('join')">
        <label for="join-code">Invite Code</label>
        <input
          id="join-code"
          ref="joinInput"
          v-model="inviteCode"
          maxlength="6"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          :disabled="pending"
          @input="homeError = ''"
        />
        <div class="join-actions">
          <button class="glass-button" type="submit" :disabled="pending">Join Room</button>
          <button class="glass-button" type="button" :disabled="pending" @click="cancelJoin">Back</button>
        </div>
      </form>

      <p class="menu-notice" role="status" aria-live="polite" aria-atomic="true">
        <span v-if="homeError || pending || reconnecting">
          {{ homeError || (reconnecting ? 'Reconnecting to your room…' : 'Connecting…') }}
        </span>
      </p>
    </section>
  </main>
</template>

<style>
:root {
  font-family: system-ui, sans-serif;
  color: #fff7ed;
  background-color: #44271f;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.game-scene {
  --scene-art: url('../assets/images/background/desktop.png');

  min-height: 100vh;
  min-height: 100dvh;
  background-image: var(--scene-tint, linear-gradient(transparent, transparent)), var(--scene-art);
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}

.home {
  display: grid;
  place-items: center;
  padding: 60px 16px;
}

.home-menu {
  position: relative;
  display: grid;
  justify-items: center;
  gap: clamp(24px, 4vmin, 40px);
  width: 100%;
  text-align: center;
}

.home-menu h1 {
  margin: 0;
  font-family: Impact, 'Arial Narrow', system-ui, sans-serif;
  font-size: clamp(2.65rem, 7.5vw, 5.5rem);
  font-weight: 900;
  line-height: 1.06;
  letter-spacing: 0.035em;
  text-transform: uppercase;
  text-wrap: balance;
  -webkit-text-stroke: 0.045em #412118;
  paint-order: stroke fill;
  text-shadow: 0 0.055em #412118, 0 0.095em 0.2em #30160fb0;
}

.menu-actions {
  display: grid;
  gap: 12px;
  width: min(100%, clamp(13rem, 22vw, 16rem));
}

.join-form {
  display: grid;
  gap: 10px;
  width: min(100%, 20rem);
  padding: 18px;
  border: 1px solid #ffdfba80;
  border-radius: 24px;
  background: #41241deb;
  backdrop-filter: blur(16px);
  box-shadow: inset 0 1px 0 #fff4e459, 0 10px 28px #20100c55;
  text-align: left;
}

.join-form label {
  font-weight: 700;
}

.join-form input {
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid #ffd5ad80;
  border-radius: 12px;
  background: #2d1715;
  color: inherit;
  font: 700 1rem ui-monospace, monospace;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.join-form input:focus-visible {
  outline: 2px solid #fff6e5;
  outline-offset: 2px;
}

.join-actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.glass-button:disabled {
  opacity: 0.65;
  cursor: wait;
}

.glass-button {
  min-height: 56px;
  padding: 12px 20px;
  border: 1px solid #fff1dc94;
  border-bottom-color: #ffd1aa66;
  border-radius: 21px;
  background:
    radial-gradient(ellipse at 27% 0%, #fff5df55, transparent 67%),
    linear-gradient(180deg, #733f2afa, #432319f5);
  box-shadow:
    inset 0 1px 0 #fff4e4b0,
    inset 0 -3px 8px #ffceaa28,
    0 5px 14px #2f160e55;
  color: inherit;
  font: 700 1.05rem / 1.25 system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 3px #311710;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: box-shadow 160ms ease, transform 160ms ease;
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass-button {
    background:
      radial-gradient(ellipse at 27% 0%, #fff5df52, transparent 67%),
      linear-gradient(180deg, #512a21b8, #361810d1);
    -webkit-backdrop-filter: blur(16px) saturate(145%);
    backdrop-filter: blur(16px) saturate(145%);
  }
}

@media (hover: hover) {
  .glass-button:hover {
    box-shadow:
      inset 0 2px 0 #fff4e4dc,
      inset 0 -4px 10px #ffceaa50,
      0 8px 17px #2f160e70;
    transform: translateY(-2px);
  }
}

.glass-button:active {
  transform: translateY(1px);
}

.glass-button:focus-visible {
  outline: 3px solid #fff6e5;
  outline-offset: 3px;
}

.menu-notice {
  position: absolute;
  inset: calc(100% + 14px) 0 auto;
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.4;
  pointer-events: none;
}

.menu-notice span {
  display: inline-block;
  padding: 7px 14px;
  border-radius: 2rem;
  background: #342018ed;
  box-shadow: 0 3px 12px #2f160e55;
}

@media (orientation: portrait) {
  .game-scene {
    --scene-art: url('../assets/images/background/mobile.png');
  }
}

@media (prefers-reduced-motion: reduce) {
  .glass-button {
    transition: none;
  }
}
</style>
