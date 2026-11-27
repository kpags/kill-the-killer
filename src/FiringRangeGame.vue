<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { rangeAttempts, rangeCenter, rangeCoordinate, rangeRings, rangeSize, rangeSweepMax, rangeSweepMin } from '../shared/firingRange.js'

const props = defineProps({
  round: { type: Object, required: true },
  serverTime: { type: Number, required: true },
  lockAim: { type: Function, required: true },
  reconnecting: Boolean,
})
const emit = defineEmits(['close'])
const dialog = ref(null)
const clock = ref(props.serverTime)
const busy = ref(false)
const failure = ref('')
const colors = ['#fabc66', '#34425b', '#d3deed', '#e5edf7', '#f1f5fa', '#f8fafc']
const rings = rangeRings.map((ring, index) => ({ ...ring, color: colors[index] })).reverse()
const size = rangeSweepMax - rangeSweepMin
const targetTop = `${(rangeCenter - rangeRings.at(-1).radius) / rangeSize * 100}%`
const complete = computed(() => props.round.attempts >= rangeAttempts)
const showingShot = computed(() => props.round.lastShot && clock.value < props.round.scanAt)
const showingFinal = computed(() => complete.value && !showingShot.value)
const showingImpact = computed(() => showingShot.value && clock.value >= props.round.lastShot.impactAt)
const points = computed(() => showingImpact.value ? props.round.lastShot.points : null)
const blocked = computed(() => busy.value || props.reconnecting || complete.value || clock.value < props.round.scanAt)
const x = computed(() => showingShot.value ? props.round.lastShot.x
  : props.round.lockedX ?? rangeCoordinate('x', props.round.scanAt, clock.value))
const y = computed(() => showingShot.value ? props.round.lastShot.y
  : rangeCoordinate('y', props.round.yScanAt ?? props.round.scanAt, clock.value))
const instruction = computed(() => {
  if (complete.value) return 'Round complete'
  if (showingShot.value) return showingImpact.value ? 'Next shot…' : 'Shot incoming…'
  return 'Mouse Left Click to stop the line'
})
const feedback = computed(() => {
  if (props.reconnecting) return 'Reconnecting…'
  if (failure.value) return failure.value
  return points.value != null ? `${points.value} points` : ''
})
let snapshotAt = performance.now()
let frameId

watch(() => props.serverTime, () => { snapshotAt = performance.now() }, { flush: 'sync' })

function render(now) {
  clock.value = Math.max(clock.value, props.serverTime + Math.max(0, now - snapshotAt))
  frameId = requestAnimationFrame(render)
}

async function lock() {
  if (blocked.value) return
  busy.value = true
  failure.value = ''
  try {
    await props.lockAim(clock.value)
  } catch (error) {
    failure.value = error.message
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  dialog.value.showModal()
  frameId = requestAnimationFrame(render)
})
onUnmounted(() => cancelAnimationFrame(frameId))
</script>

<template>
  <dialog ref="dialog" class="park-activity-dialog firing-range-dialog" aria-label="Firing Range" @cancel.prevent="emit('close')">
    <button type="button" class="park-activity-close" aria-label="Close" :disabled="reconnecting" @click="emit('close')">
      <span aria-hidden="true">×</span>
    </button>
    <dl class="park-activity-scores">
      <div><dt>Score</dt><dd>{{ round.score }}</dd></div>
      <div><dt>Highest score</dt><dd>{{ round.record.name }}: {{ round.record.score }}</dd></div>
    </dl>

    <div class="firing-range-playfield">
      <button type="button" class="firing-range-field" :aria-disabled="blocked" aria-describedby="firing-range-instruction"
        aria-label="Lock aim" @click="lock">
        <svg :viewBox="`0 0 ${rangeSize} ${rangeSize}`" aria-hidden="true">
          <rect :x="rangeSweepMin" :y="rangeSweepMin" :width="size" :height="size" fill="none" stroke="#cbd5e1"
            stroke-dasharray="4 5" vector-effect="non-scaling-stroke" />
          <circle v-for="ring in rings" :key="ring.points" :cx="rangeCenter" :cy="rangeCenter"
            :r="ring.radius" :fill="ring.color" stroke="#8898af" vector-effect="non-scaling-stroke" />
          <text v-for="(ring, index) in rangeRings" :key="ring.points" :x="rangeCenter"
            :y="index === 0 ? rangeCenter : rangeCenter - ring.radius + 12" :fill="index === 1 ? 'white' : '#25344a'"
            class="firing-range-value">{{ ring.points }}</text>
          <line v-if="!complete || showingShot" :x1="x" :x2="x" :y1="rangeSweepMin" :y2="rangeSweepMax" stroke="#007370" data-axis="x"
            class="firing-range-line" :class="{ 'is-fixed': round.lockedX !== null || showingShot }" />
          <line v-if="round.lockedX !== null || showingShot" :x1="rangeSweepMin" :x2="rangeSweepMax" :y1="y" :y2="y" stroke="#af3952" data-axis="y"
            class="firing-range-line" :class="{ 'is-fixed': showingShot }" />
          <g v-if="showingImpact" :key="round.lastShot.impactAt">
            <line :x1="rangeCenter" :y1="rangeSize - 12" :x2="x" :y2="y" pathLength="1" class="firing-range-trace" />
            <circle :cx="x" :cy="y" r="6" fill="#182339" stroke="#fff" stroke-width="2" class="firing-range-hit" />
            <g :transform="`translate(${x} ${y})`">
              <g class="firing-range-smoke" fill="#8994a6">
                <circle cx="-4" cy="-3" r="6" />
                <circle cx="5" cy="-5" r="6" />
                <circle cy="-9" r="7" />
              </g>
            </g>
          </g>
        </svg>
      </button>
      <template v-if="showingFinal">
        <p class="firing-range-replay" :style="{ top: targetTop }">Interact to play again</p>
        <div class="firing-range-final" role="status">
          <span>Final score</span>
          <strong>{{ round.score }} points</strong>
        </div>
      </template>
    </div>

    <p id="firing-range-instruction" :class="{ 'is-hidden': showingFinal }">{{ instruction }}</p>
    <div class="firing-range-results">
      <span>Shots {{ round.attempts }}/{{ rangeAttempts }}</span>
      <span class="park-activity-feedback" :class="{ 'firing-range-points': points != null && !failure && !reconnecting }"
        role="status">{{ feedback }}</span>
    </div>
  </dialog>
</template>

<style scoped>
.firing-range-dialog {
  width: min(28rem, calc(100vw - 40px), max(10rem, calc(100dvh - 9rem)));
}

.firing-range-playfield {
  position: relative;
  width: calc(100% + 2 * var(--activity-padding));
  margin-inline: calc(-1 * var(--activity-padding));
}

.firing-range-field {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: crosshair;
  touch-action: manipulation;
}

.firing-range-field[aria-disabled='true'] { cursor: default; }
.firing-range-field:focus-visible { outline: 2px solid #a6501f; outline-offset: -6px; }
.firing-range-field svg { display: block; width: 100%; }

.firing-range-dialog .firing-range-replay {
  position: absolute;
  left: 50%;
  margin: 0;
  color: #535e6d;
  white-space: nowrap;
  transform: translate(-50%, calc(-100% - 6px));
  pointer-events: none;
}

.firing-range-final {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  gap: 3px;
  padding: 8px clamp(12px, 4vw, 28px);
  border: 1px solid #d3deed;
  border-radius: 12px;
  background: #fffffff5;
  color: #25344a;
  text-align: center;
  white-space: nowrap;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.firing-range-final span { font-size: 0.75rem; }
.firing-range-final strong { font-size: clamp(1rem, 4.5vmin, 1.6rem); animation: firing-range-blink 2.4s ease-in-out infinite; }
#firing-range-instruction.is-hidden { visibility: hidden; }

.firing-range-line { stroke-width: 1.5; opacity: 0.8; vector-effect: non-scaling-stroke; }
.firing-range-line.is-fixed { stroke-width: 2; opacity: 1; }

.firing-range-trace {
  stroke: #d16a18;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-dasharray: 1;
  vector-effect: non-scaling-stroke;
  animation: firing-range-trace 250ms ease-out both;
}

.firing-range-smoke {
  transform-box: fill-box;
  transform-origin: center;
  animation: firing-range-smoke 650ms ease-out both;
}

.firing-range-points { animation: firing-range-blink 1s ease-in-out 2; }

@keyframes firing-range-trace {
  0% { opacity: 1; stroke-dashoffset: 1; }
  35% { opacity: 1; stroke-dashoffset: 0; }
  100% { opacity: 0; stroke-dashoffset: 0; }
}

@keyframes firing-range-smoke {
  0% { opacity: 0.52; transform: scale(0.55); }
  100% { opacity: 0; transform: translateY(-12px) scale(1.45); }
}

@keyframes firing-range-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .firing-range-points, .firing-range-final strong { animation: none; }
  .firing-range-smoke { display: none; }
}

.firing-range-value {
  font: 700 12px system-ui, sans-serif;
  dominant-baseline: middle;
  text-anchor: middle;
}

.firing-range-results {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0 8px;
  margin-top: 6px;
  color: #535e6d;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
</style>
