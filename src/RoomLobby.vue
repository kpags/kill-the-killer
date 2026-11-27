<script setup>
import { computed, nextTick, reactive, ref } from 'vue'
import { capacity, compareMaps, mapName, normalizePlayerName, roomStartError } from '../shared/lobbyRules.js'
import gameModes from '../data/game_modes.json'

const props = defineProps({
  room: { type: Object, required: true },
  playerId: { type: String, required: true },
  reconnecting: Boolean,
  command: { type: Function, required: true },
  leave: { type: Function, required: true },
})

const mapFiles = import.meta.glob('../data/maps/*.json', { eager: true, import: 'default' })
const thumbnails = import.meta.glob('../assets/maps/*/thumbnail.png', {
  eager: true,
  import: 'default',
  query: '?url',
})
const maps = Object.entries(mapFiles).flatMap(([path, definition]) => {
  const id = path.split('/').pop().slice(0, -5)
  if (definition.id !== id || !definition.areas) return []
  return [{ id, name: mapName(id), thumbnail: thumbnails[`../assets/maps/${id}/thumbnail.png`] }]
}).sort((first, second) => compareMaps(first.id, second.id))
const modes = Object.entries(gameModes).map(([id, instructions]) => ({ id, name: mapName(id), instructions }))

const heading = ref(null)
const codeField = ref(null)
const copyStatus = ref('')
const roomError = ref('')
const invalidPlayer = ref(null)
const drafts = reactive(new Map())
const isHost = computed(() => props.room.hostId === props.playerId)
const selectedMode = computed(() => modes.find(({ id }) => id === props.room.selectedModeId))
const selectedMap = computed(() => maps.find(({ id }) => id === props.room.selectedMapId))
const playerCount = computed(() => props.room.slots.filter(Boolean).length)
const startError = computed(() => roomStartError(props.room.slots))

function canEdit(player) {
  return player.id === props.playerId || (isHost.value && player.isBot)
}

async function run(action) {
  roomError.value = ''
  try {
    await action()
    return true
  } catch (error) {
    roomError.value = error.message
    return false
  }
}

async function copyCode(event) {
  const button = event.currentTarget

  try {
    await navigator.clipboard.writeText(props.room.code)
    copyStatus.value = 'Code copied.'
    return
  } catch {
    // Try selection-based copying when the Clipboard API is unavailable.
  }

  const field = codeField.value
  if (!field) return

  field.focus()
  field.select()
  try {
    if (document.execCommand('copy')) {
      button.focus()
      copyStatus.value = 'Code copied.'
      return
    }
  } catch {
    // Leave the code selected for manual copying.
  }
  copyStatus.value = 'Code selected. Copy it using your browser.'
}

async function addBot(index, event) {
  const usedKeyboard = event.detail === 0
  const row = event.currentTarget.closest('li')
  const added = await run(() => props.command('add_bot', { index }))

  if (added && usedKeyboard) {
    await nextTick()
    row.querySelector('input')?.focus()
  }
}

function saveName(player, event) {
  const input = event.currentTarget
  if (!drafts.has(player.id)) return
  const name = normalizePlayerName(input.value)
  drafts.delete(player.id)
  input.value = player.name
  if (!name) {
    invalidPlayer.value = player.id
    return
  }
  if (invalidPlayer.value === player.id) invalidPlayer.value = null
  if (name !== player.name) run(() => props.command('rename', { playerId: player.id, name }))
}

function selectMode(event) {
  const field = event.currentTarget
  const modeId = field.value
  field.value = props.room.selectedModeId
  run(() => props.command('select_mode', { modeId }))
}

function selectMap(event) {
  const field = event.currentTarget
  const mapId = field.value
  field.value = props.room.selectedMapId
  run(() => props.command('select_map', { mapId }))
}

function focusHeading() {
  heading.value?.focus({ preventScroll: true })
  window.scrollTo(0, 0)
}

function readState() {
  return {
    screen: 'room',
    inviteCode: props.room.code,
    selectedMode: props.room.selectedModeId,
    selectedMap: props.room.selectedMapId,
    playerCount: playerCount.value,
    capacity,
    slots: props.room.slots,
    playerId: props.playerId,
    reconnecting: props.reconnecting,
    copyStatus: copyStatus.value || null,
  }
}

defineExpose({ focusHeading, readState })
</script>

<template>
  <main class="room game-scene">
    <div class="room-content">
      <h1 ref="heading" class="room-title" tabindex="-1">Room</h1>
      <p v-if="reconnecting || roomError" class="connection-status" role="status">
        {{ reconnecting ? 'Reconnecting to your room…' : roomError }}
      </p>

      <div class="room-layout">
        <section class="room-pane room-details" aria-label="Room details">
          <div>
            <label for="invite-code">Invite Code</label>
            <div class="code-controls">
              <input id="invite-code" ref="codeField" class="room-field code-field" :value="room.code" readonly />
              <button class="glass-button room-button" type="button" @click="copyCode">Copy Code</button>
            </div>
            <p class="copy-status" role="status">{{ copyStatus }}</p>
          </div>

          <div>
            <label for="room-mode">Mode</label>
            <select id="room-mode" class="room-field" :value="room.selectedModeId ?? ''"
              :disabled="!isHost || reconnecting" @change="selectMode">
              <option v-for="mode in modes" :key="mode.id" :value="mode.id">{{ mode.name }}</option>
            </select>
          </div>

          <div>
            <label for="room-map">Map</label>
            <select id="room-map" class="room-field map-select" :value="room.selectedMapId ?? ''"
              :disabled="!isHost || reconnecting || !maps.length" @change="selectMap">
              <option v-if="!maps.length" value="">No maps available</option>
              <option v-for="map in maps" :key="map.id" :value="map.id">{{ map.name }}</option>
            </select>
          </div>

          <figure v-if="selectedMap" class="map-preview">
            <img v-if="selectedMap.thumbnail" :src="selectedMap.thumbnail" alt="" />
            <p v-else>Thumbnail unavailable</p>
            <figcaption>{{ selectedMap.name }}</figcaption>
          </figure>

          <div class="room-footer">
            <p class="player-count" aria-live="polite">{{ playerCount }} / {{ capacity }} players</p>
            <div class="room-actions">
              <button v-if="isHost" class="glass-button room-button start-button" type="button"
                :disabled="reconnecting || !selectedMap || Boolean(startError)"
                :title="startError || undefined" @click="run(() => command('start'))">Start</button>
              <button class="glass-button room-button" type="button" :disabled="reconnecting" @click="run(leave)">Leave</button>
            </div>
          </div>
        </section>

        <div class="room-people">
          <section class="room-pane" aria-labelledby="room-players">
            <h2 id="room-players">Players</h2>
            <ol class="room-slots" role="list">
              <li v-for="(player, index) in room.slots" :key="index" class="player-slot">
                <span class="slot-number" :aria-label="`Slot ${index + 1}`">{{ index + 1 }}</span>
                <div v-if="player && canEdit(player)" :key="player.id" class="player-info">
                  <label class="player-label" :for="`player-name-${index}`">
                    {{ player.isBot ? 'Bot name' : 'Your name' }}
                  </label>
                  <input
                    :id="`player-name-${index}`"
                    class="room-field player-name"
                    :value="drafts.get(player.id) ?? player.name"
                    maxlength="10"
                    autocomplete="off"
                    spellcheck="false"
                    :disabled="reconnecting"
                    @input="drafts.set(player.id, $event.target.value)"
                    @blur="saveName(player, $event)"
                    @keydown.enter.prevent="$event.currentTarget.blur()"
                  />
                </div>
                <span v-else-if="player" class="other-player">{{ player.name }}</span>
                <span v-else class="empty-slot">Empty slot</span>

                <button
                  v-if="player?.id === playerId"
                  class="glass-button room-button slot-action"
                  :class="{ 'start-button': player.ready }"
                  type="button"
                  :disabled="reconnecting"
                  @click="run(() => command('set_ready', { playerId, ready: !player.ready }))"
                >
                  {{ player.ready ? 'Unready' : 'Ready' }}
                </button>
                <span v-else-if="player" class="ready-badge slot-action" :class="{ 'ready-badge-muted': !player.ready || !player.connected }">
                  {{ !player.connected ? 'Offline' : player.ready ? 'Ready' : 'Not ready' }}
                </span>
                <button v-else-if="isHost" class="glass-button room-button slot-action" type="button" :disabled="reconnecting" @click="addBot(index, $event)">
                  Add Bot
                </button>
                <p v-if="player && invalidPlayer === player.id" class="name-error" role="status">Use 1–10 letters, digits, or internal spaces.</p>
              </li>
            </ol>
          </section>

          <section class="room-pane game-description" aria-labelledby="room-description">
            <h2 id="room-description">Game Description</h2>
            <ul v-if="selectedMode" class="mode-instructions">
              <li v-for="(instruction, index) in selectedMode.instructions" :key="index">{{ instruction }}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.room {
  --scene-tint: linear-gradient(#301a1380, #25100d9e);

  padding: clamp(20px, 5vw, 58px) clamp(12px, 4vw, 48px);
}

.room-content {
  width: min(100%, 1280px);
  margin-inline: auto;
}

.room-title {
  margin: 0 0 18px;
  font-family: Impact, 'Arial Narrow', system-ui, sans-serif;
  font-size: clamp(2.4rem, 6vw, 3.5rem);
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-shadow: 0 3px 12px #24100c;
}

.room-title:focus {
  outline: none;
}

.connection-status {
  margin: 0 0 12px;
  color: #fff3e3;
  text-shadow: 0 2px 5px #26120e;
}

.room-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  align-items: start;
  gap: 16px;
}

.room-people {
  display: grid;
  min-width: 0;
  gap: 16px;
}

.room-pane {
  min-width: 0;
  padding: clamp(12px, 2.5vw, 22px);
  border: 1px solid #ffdfba80;
  border-radius: 25px;
  background: linear-gradient(155deg, #5c362bf5, #291512f5);
  box-shadow: inset 0 1px 0 #fff4e459, 0 10px 28px #20100c55;
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .room-pane {
    background: linear-gradient(155deg, #5b382cc9, #291512e5);
    -webkit-backdrop-filter: blur(16px) saturate(125%);
    backdrop-filter: blur(16px) saturate(125%);
  }
}

.room-details {
  display: grid;
  gap: 14px;
}

.room-details label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.875rem;
  font-weight: 700;
}

.code-controls,
.room-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.room-field {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid #ffd5ad58;
  border-radius: 12px;
  background: #2d1715a6;
  color: inherit;
  font: inherit;
  color-scheme: dark;
}

.room-field:focus-visible {
  outline: 2px solid #fff6e5;
  outline-offset: 2px;
}

.code-field {
  font-family: ui-monospace, Consolas, monospace;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.room-button {
  min-height: 44px;
  padding: 7px 12px;
  border-radius: 13px;
  font-size: 0.875rem;
  white-space: nowrap;
}

.start-button {
  background: linear-gradient(180deg, #94512d, #6b321d);
}

.copy-status,
.name-error {
  margin: 0;
  color: #ffe0c0;
  font-size: 0.8125rem;
}

.copy-status {
  min-height: 1.4em;
  margin-top: 5px;
}

.map-preview {
  overflow: hidden;
  width: min(100%, 180px);
  justify-self: center;
  margin: 0;
  border: 1px solid #ffd5ad58;
  border-radius: 15px;
  background: #271612a6;
}

.map-preview img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
}

.map-preview p {
  margin: 0;
  padding: 20px;
}

.map-preview figcaption {
  padding: 8px 12px;
  font-weight: 700;
  text-align: center;
}

.player-count {
  margin: 0 0 9px;
  font-size: 0.875rem;
  font-weight: 700;
}

.room-actions {
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  grid-template-columns: none;
}

h2 {
  margin: 0 0 12px;
  font-size: 1.25rem;
}

.room-slots {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.player-slot {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: minmax(64px, auto) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 140px;
  padding: 12px;
  border: 1px solid #ffdfba42;
  border-radius: 15px;
  background: linear-gradient(120deg, #ffdfba21, #30181063);
}

.slot-number {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #2a1513a1;
  font-size: 0.8125rem;
}

.player-info {
  min-width: 0;
}

.player-label {
  display: block;
  margin-bottom: 2px;
  color: #ffe0c0;
  font-size: 0.75rem;
}

.player-name {
  max-width: 100%;
}

.slot-action {
  grid-column: 1 / -1;
}

.empty-slot {
  color: #ffe8d5;
  font-size: 0.875rem;
}

.other-player {
  overflow-wrap: anywhere;
  font-weight: 700;
}

.ready-badge {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  min-height: 44px;
  padding: 5px 9px;
  border: 1px solid #badcb96b;
  border-radius: 1rem;
  background: #243c2bdb;
  color: #ddf8dc;
  font-size: 0.8125rem;
  font-weight: 700;
}

.ready-badge-muted {
  border-color: #ffdfba56;
  background: #33231edb;
  color: #ffe8d5;
}

.name-error {
  grid-column: 1 / -1;
}

.mode-instructions {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 1.25rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

@media (min-width: 960px) and (max-height: 800px) {
  .room {
    padding-block: 24px;
  }

  .room-title {
    margin-bottom: 14px;
    font-size: 2.75rem;
  }

  .map-preview {
    /* Reserve space for the heading, room fields, and Start/Leave controls. */
    width: min(100%, clamp(96px, calc(100dvh - 540px), 180px));
  }
}

@media (max-width: 1099px) {
  .room-slots {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 959px) {
  .room-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 539px) {
  .room-slots {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
