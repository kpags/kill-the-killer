import { inAttackRange, isLiving } from '../shared/combat.js'

export function frameAt(atlas, ms, once = false) {
  if (once && ms >= atlas.duration) return atlas.durations.length - 1
  let phase = Math.max(0, ms) % atlas.duration
  for (let frame = 0; frame < atlas.durations.length; frame++) {
    if (phase < atlas.durations[frame]) return frame
    phase -= atlas.durations[frame]
  }
  return atlas.durations.length - 1
}

// Actors are in painting order. Only the active hover can bridge gaps in its current frame.
export function pickModel(actors, local, point, scale, alphaAt, retainedHover = null) {
  if (!isLiving(local) || !point) return null
  for (let index = actors.length - 1; index >= 0; index--) {
    const actor = actors[index]
    if (actor.hidden || actor.opacity <= 0) continue
    const x = Math.floor((point.x - actor.x) / (actor.facing * scale) + 80)
    const y = Math.floor((point.y - actor.y) / scale + 132)
    if (x < 0 || x >= 160) continue
    const opaque = y >= 0 && y < 136 && alphaAt(actor, x, y) > 100
    const retained = retainedHover?.id === actor.id
    if (!opaque && !retained) continue
    const ground = { area: actor.area, pose: actor.pose, x: actor.groundX ?? actor.x, y: actor.groundY ?? actor.y }
    const eligible = actor.id !== local.id && isLiving(actor) && inAttackRange(local, ground)
    if (opaque) return eligible ? actor.id : null
    if (eligible && retainedHover.contains(actor, x, y)) return actor.id
  }
  return null
}

export function hoverOpacity(elapsedMs, reducedMotion) {
  return reducedMotion ? 0.8 : (1 + Math.sin(elapsedMs * Math.PI / 500)) / 2
}
