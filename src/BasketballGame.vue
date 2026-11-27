<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { basketballCourt as court, basketballFrameMs, basketballLaunch, simulateBasketballShot } from '../shared/basketball.js'

const props = defineProps({
  round: { type: Object, required: true },
  shoot: { type: Function, required: true },
  reconnecting: Boolean,
})
const emit = defineEmits(['close'])
const dialog = ref(null)
const canvas = ref(null)
const held = ref(false)
const flying = ref(false)
const feedback = ref('')
const celebrating = ref(false)
const confettiPieces = [
  [8, 47, -100, '#df3c83'], [16, 68, -48, '#f37f28'], [25, 33, 42, '#2d9bc1'],
  [29, 89, 120, '#8059df'], [39, 57, -68, '#199c71'], [46, 80, 85, '#e3a013'],
  [53, 42, 164, '#df3c83'], [61, 72, -115, '#2d9bc1'], [71, 91, 38, '#f37f28'],
  [74, 39, 100, '#8059df'], [84, 66, -50, '#199c71'], [92, 47, 135, '#e3a013'],
]
const rimTop = `${(court.rimY - court.rimRadius) / court.height * 100}%`
const startingBall = { x: court.startX, y: court.startY, radius: court.ballRadius }
const backboardWidth = 93.6
const targetWidth = backboardWidth / 3
let ball = startingBall
let drag = null
let flight = null
let frameId
let ctx

watch(() => props.round.score, (score, previous) => {
  if (score > previous) celebrating.value = true
})

function paintCourt() {
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, court.width, court.height)

  ctx.strokeStyle = '#aab4c1'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.roundRect(court.rimX - backboardWidth / 2, 40, backboardWidth, 78, 5)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.strokeRect(court.rimX - targetWidth / 2, 73, targetWidth, 32)
}

function paintRim() {
  const { rimX, rimY, rimHalfWidth, rimRadius } = court
  ctx.fillStyle = '#d63038'
  ctx.beginPath()
  ctx.roundRect(rimX - rimHalfWidth, rimY - rimRadius, rimHalfWidth * 2, rimRadius * 2, 3)
  ctx.fill()
}

function paintBall({ x, y, radius }) {
  ctx.fillStyle = '#0005'
  ctx.beginPath()
  ctx.ellipse(x, court.startY + court.ballRadius + 4, radius * 0.83, radius * 0.2, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = '#fb8d37'
  ctx.strokeStyle = '#1f1112'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(-radius, 0)
  ctx.lineTo(radius, 0)
  ctx.moveTo(0, -radius)
  ctx.bezierCurveTo(-radius * 0.65, -radius * 0.5, -radius * 0.65, radius * 0.5, 0, radius)
  ctx.moveTo(0, -radius)
  ctx.bezierCurveTo(radius * 0.65, -radius * 0.5, radius * 0.65, radius * 0.5, 0, radius)
  ctx.stroke()
  ctx.restore()
}

function paint() {
  paintCourt()
  paintBall(ball)
  paintRim()
}

function render(now) {
  const age = now - flight.startedAt
  const { frames, duration, points } = flight.shot
  if (age >= duration) {
    feedback.value = points === 2 ? 'Clean shot! +2' : points === 1 ? 'Off the rim! +1' : 'Missed. Try again.'
    resetBall()
    return
  }
  ball = frames[Math.max(0, Math.floor(age / basketballFrameMs))]
  paint()
  frameId = requestAnimationFrame(render)
}

function pointerSample(event) {
  const bounds = canvas.value.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) * court.width / bounds.width,
    y: (event.clientY - bounds.top) * court.height / bounds.height,
    time: event.timeStamp,
  }
}

function grab(event) {
  if (event.button !== 0 || drag || flying.value || props.round.ballInFlight || props.reconnecting) return
  const sample = pointerSample(event)
  if (Math.hypot(sample.x - ball.x, sample.y - ball.y) > ball.radius + 5) return
  canvas.value.setPointerCapture(event.pointerId)
  drag = { id: event.pointerId, samples: [sample] }
  feedback.value = ''
  held.value = true
}

function track(event) {
  if (drag?.id !== event.pointerId) return
  const sample = pointerSample(event)
  drag.samples = drag.samples.filter(({ time }) => sample.time - time <= 110)
  drag.samples.push(sample)
  const { x, y } = basketballLaunch(sample.x, sample.y, 0, 0)
  ball = { x, y, radius: court.ballRadius }
  paint()
}

function resetBall() {
  cancelAnimationFrame(frameId)
  drag = null
  flight = null
  held.value = false
  flying.value = false
  ball = startingBall
  paint()
}

async function releaseBall(event) {
  if (drag?.id !== event.pointerId) return
  track(event)
  const first = drag.samples[0]
  const last = drag.samples.at(-1)
  const elapsed = Math.max(16, last.time - first.time) / 1000
  const vx = (last.x - first.x) / elapsed
  const vy = (last.y - first.y) / elapsed
  const launch = basketballLaunch(ball.x, ball.y, vx, vy)
  if (Math.hypot(vx, vy) < 30 || props.reconnecting) {
    resetBall()
    return
  }
  drag = null
  held.value = false
  flight = { shot: simulateBasketballShot(launch), startedAt: performance.now() }
  flying.value = true
  frameId = requestAnimationFrame(render)
  try {
    await props.shoot(launch)
  } catch (failure) {
    resetBall()
    feedback.value = failure.message
  }
}

function cancelDrag(event) {
  if (drag?.id === event.pointerId) resetBall()
}

onMounted(() => {
  dialog.value.showModal()
  ctx = canvas.value.getContext('2d')
  paint()
})

onUnmounted(() => cancelAnimationFrame(frameId))
</script>

<template>
  <dialog ref="dialog" class="park-activity-dialog basketball-dialog" aria-label="Basketball Shooting" @cancel.prevent="emit('close')">
    <button type="button" class="park-activity-close" aria-label="Close" :disabled="reconnecting" @click="emit('close')">
      <span aria-hidden="true">×</span>
    </button>
    <dl class="park-activity-scores">
      <div><dt>Score</dt><dd>{{ round.score }}</dd></div>
      <div><dt>Highest score</dt><dd>{{ round.record.name }}: {{ round.record.score }}</dd></div>
    </dl>
    <div class="basketball-playfield">
      <canvas ref="canvas" :width="court.width" :height="court.height" class="basketball-court"
        :class="{ 'is-held': held, 'is-flying': flying || round.ballInFlight }" aria-label="Basketball court"
        aria-describedby="basketball-instructions" @pointerdown="grab" @pointermove="track" @pointerup="releaseBall"
        @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" />
      <div v-if="celebrating" class="basketball-confetti" :style="{ top: rimTop }" aria-hidden="true"
        @animationend.self="celebrating = false">
        <span v-for="([x, y, turn, color], index) in confettiPieces" :key="index" class="basketball-confetti-piece"
          :style="{ '--x': `${x}%`, '--y': `${y}%`, '--turn': `${turn}deg`, backgroundColor: color }"></span>
      </div>
    </div>
    <p id="basketball-instructions">Hold the ball, flick toward the hoop, and release.</p>
    <p class="park-activity-feedback" role="status">{{ reconnecting ? 'Reconnecting…' : feedback }}</p>
  </dialog>
</template>

<style scoped>
.basketball-playfield {
  position: relative;
  width: min(100%, calc((100dvh - 9rem) * 480 / 370));
  margin: 0 auto;
}

.basketball-court {
  display: block;
  width: 100%;
  height: auto;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.basketball-court.is-held { cursor: grabbing; }
.basketball-court.is-flying { cursor: default; }

.basketball-confetti {
  position: absolute;
  left: 50%;
  width: 38%;
  height: 22%;
  transform: translate(-50%, -100%);
  pointer-events: none;
  animation: basketball-confetti-fade 460ms linear both;
}

.basketball-confetti-piece {
  position: absolute;
  width: clamp(3px, 0.85vmin, 6px);
  height: clamp(4px, 1.15vmin, 8px);
  border-radius: 1px;
  animation: basketball-confetti-spread 460ms ease-out both;
}

@keyframes basketball-confetti-fade {
  0%, 38% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes basketball-confetti-spread {
  0% { left: 50%; bottom: 0; transform: translate(-50%, 50%) rotate(0); }
  70% { left: var(--x); bottom: var(--y); transform: translate(-50%, 50%) rotate(var(--turn)); }
  100% { left: var(--x); bottom: calc(var(--y) - 14%); transform: translate(-50%, 50%) rotate(calc(var(--turn) + 30deg)); }
}

@media (prefers-reduced-motion: reduce) {
  .basketball-confetti-piece {
    left: var(--x);
    bottom: var(--y);
    transform: translate(-50%, 50%) rotate(var(--turn));
    animation: none;
  }
}

</style>
