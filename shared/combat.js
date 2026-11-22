import atlases from '../assets/gameplay/atlases.json' with { type: 'json' }
import { areas, constrain } from './park.js'

export const attackRange = 20
export const deathFadeMs = 2000
export const respawnDelayMs = 5000
export const stunMs = 3000
export const screamPoses = ['scream-one', 'scream-two', 'scream-three']
export const oneShotPoses = new Set(['kill', 'punch', 'death', 'pre-stun'])
export const killFlashMs = 420

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

export function inAttackRange(actor, other) {
  if (actor.area !== other.area) return false
  // Seats can place a model outside the walkable ground. Measure from its approach point.
  const area = areas[actor.area]
  const from = actor.pose === 'sit' ? constrain(area, actor.x, actor.y) : actor
  const to = other.pose === 'sit' ? constrain(area, other.x, other.y) : other
  return Math.hypot(from.x - to.x, from.y - to.y) <= attackRange
}

export function deathOpacity(actor, now) {
  return actor.life === 'dying'
    ? Math.max(0, Math.min(1, (actor.vanishesAt - now) / deathFadeMs))
    : 1
}
