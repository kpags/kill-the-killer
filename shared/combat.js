import atlases from '../assets/gameplay/atlases.json' with { type: 'json' }
import { areas, constrain } from './park.js'
import { smokeCooldownMs, smokeItem } from './smoke.js'

export const attackRange = 20
export const blowgunItem = 'poison_blowgun'
export const blowgunRange = (areaIndex) => (areas[areaIndex]?.width ?? 0) * 0.85
export const blowgunCooldownMs = 60_000
export const blowgunWindupMs = 250
export const blowgunFlightMs = 120
export const blowgunTraceFadeMs = 100
export const rockItem = 'Rock'
export const rockCooldownMs = 10_000
export const itemCooldownMs = {
  [blowgunItem]: blowgunCooldownMs,
  [rockItem]: rockCooldownMs,
  [smokeItem]: smokeCooldownMs,
}
export const rockRange = 100
export const rockWindupMs = 200
export const rockFlightMs = 270
export const rockSize = 30
export const poisonMs = 3000
export const poisonSpeedFactor = 0.5
export const deathFadeMs = 2000
export const respawnDelayMs = 5000
export const stunMs = 3000
export const targetSearchMs = 3000
export const winnerDisplayMs = 3000
export const screamPoses = ['scream-one', 'scream-two', 'scream-three']
export const oneShotPoses = new Set(['kill', 'punch', 'death', 'pre-stun', 'consume', 'drink', 'blowgun', 'head-hit', 'face-hit', 'throw'])
export const killFlashMs = 420
export const combatFeedbackMs = 1200
export const npcPenaltyMs = 10_000
export const penaltyFadeMs = 500
export const respawnFadeMs = 500
export const penaltyNoticeLimit = 3
export const combatCueFadeMs = 300
export const targetKilledSlideMs = 500
export const targetKilledHoldMs = 2000
export const victimCueHoldMs = { killed: 3000, stunned: 1500 }

export function combatFeedbackDuration(kind) {
  return kind === 'target-killed' ? targetKilledSlideMs + targetKilledHoldMs + combatCueFadeMs : combatFeedbackMs
}

export function victimCueFadeAt({ kind, startedAt, holdUntil }) {
  return holdUntil ?? startedAt + victimCueHoldMs[kind]
}

export function victimCueEndsAt(cue) {
  return victimCueFadeAt(cue) + combatCueFadeMs
}

export function combatPlaybackRate(pose) {
  return pose === 'kill' || pose === 'death' ? 1.3 : 1
}

export function animationDuration(color, pose) {
  const sourceDuration = atlases[`${color}-${pose}`].durations.reduce((sum, duration) => sum + duration, 0)
  return sourceDuration / combatPlaybackRate(pose)
}

export function isLiving(actor) {
  return Boolean(actor) && (!actor.life || actor.life === 'alive')
}

export function isRockStunned(actor, now) {
  return actor.rockStunnedUntil > now
}

export function poisonBlink(actor, now, reducedMotion) {
  return Boolean(actor?.poisonedUntil > now
    && (reducedMotion || Math.floor((now - actor.poisonedAt) / 200) % 2 === 0))
}

export function equippedAttackRange(item, area) {
  if (item === 'fist') return attackRange
  if (item === blowgunItem) return blowgunRange(area)
  return item === rockItem ? rockRange : 0
}

export function inAttackRange(actor, other, range = attackRange) {
  if (actor.area !== other.area) return false
  // Seats can place a model outside the walkable ground. Measure from its approach point.
  const area = areas[actor.area]
  const from = actor.pose === 'sit' ? constrain(area, actor.x, actor.y) : actor
  const to = other.pose === 'sit' ? constrain(area, other.x, other.y) : other
  return Math.hypot(from.x - to.x, from.y - to.y) <= range
}

export function deathOpacity(actor, now) {
  return actor.life === 'dying'
    ? Math.max(0, Math.min(1, (actor.vanishesAt - now) / deathFadeMs))
    : 1
}
