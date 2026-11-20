import { randomUUID } from 'node:crypto'
import { areas, colors, constrain, groundRange, walkSpeed } from '../shared/park.js'
import { claimSeat } from './parkSeats.js'

const phonePoses = ['phone-one', 'phone-two', 'phone-three']
const directions = [-1, 1]
const maxCrowdSize = 3
// In left-to-right order, the outer talkers always face inward.
const crowdFacings = {
  1: [[-1], [1]],
  2: [[1, -1]],
  3: [[1, -1, -1], [1, 1, -1]],
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)]
}

function randomTime(random, minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1))
}

export function spawnParkNpcs(game) {
  const { random } = game
  for (const [areaIndex, area] of areas.entries()) {
    for (const [x, y, width, height] of area.crowds) {
      const count = 1 + Math.floor(random() * maxCrowdSize)
      const palette = [...colors]
      const pose = count === 1 ? pick(phonePoses, random) : 'talk'
      const facings = pick(crowdFacings[count], random)
      for (let index = 0; index < count; index++) {
        const [color] = palette.splice(Math.floor(random() * palette.length), 1)
        const actor = {
          id: randomUUID(),
          area: areaIndex,
          color,
          ...constrain(area, x + (index + 0.5) * width / count, y + height * (index % 2 ? 0.65 : 0.4)),
          facing: facings[index],
          pose,
          animationOffset: index * 430,
        }
        game.npcs.set(actor.id, actor)
      }
    }

    if (!area.walkingNpcs) continue
    const firstDirection = pick(directions, random)
    for (let index = 0; index < area.walkingNpcs; index++) {
      const slot = { area: areaIndex }
      game.walkers.push(slot)
      spawnWalker(game, slot, index % 2 ? -firstDirection : firstDirection)
    }
  }
}

function spawnWalker(game, slot, direction) {
  const { random } = game
  const area = areas[slot.area]
  const x = direction > 0 ? area.left : area.right
  const [top, bottom] = groundRange(area, x)
  const actor = {
    id: randomUUID(),
    area: slot.area,
    color: pick(colors, random),
    x,
    y: top + random() * (bottom - top),
    facing: direction,
    pose: 'walk',
    mode: 'free',
    spotId: null,
    seatSlot: null,
  }
  slot.actor = actor
  slot.direction = direction
  slot.visit = random() < 0.3 ? chooseVisit(game, actor, area, direction) : null
  slot.resumeAt = null
  slot.respawnAt = null
  game.npcs.set(actor.id, actor)
}

function chooseVisit(game, actor, area, direction) {
  const destinations = []
  for (const spot of area.spots) {
    const isSeat = spot.type.main === 'sitting'
    if (!isSeat && spot.type.sub !== 'music') continue
    const [left, , width] = spot.rect
    const point = constrain(area, left + width / 2, spot.y + 6)
    if ((point.x - actor.x) * direction < 0 || (isSeat && !claimSeat(game, actor, spot))) continue
    destinations.push({ spot, point })
  }
  return pick(destinations, game.random) ?? null
}

function walkTo(actor, area, goal, distance) {
  const dx = goal.x - actor.x
  const dy = goal.y - actor.y
  const length = Math.hypot(dx, dy)
  if (!length) return true
  const fraction = Math.min(1, distance / length)
  const x = actor.x + dx * fraction
  const y = actor.y + dy * fraction
  const next = constrain(area, x, y)
  if (Math.abs(y - next.y) > 0.01) {
    // Approach a step in the green boundary before walking across it.
    const lift = next.y - actor.y
    Object.assign(actor, constrain(area, actor.x, actor.y + Math.sign(lift) * Math.min(distance, Math.abs(lift))))
    return false
  }
  if (dx) actor.facing = Math.sign(dx)
  Object.assign(actor, fraction === 1 ? goal : next)
  return fraction === 1
}

function startActivity(game, slot, now) {
  const { actor, visit: { spot } } = slot
  slot.visit = null
  if (spot.type.main === 'sitting') {
    const seat = claimSeat(game, actor, spot)
    if (!seat) return
    Object.assign(actor, seat)
    actor.mode = 'sit'
    actor.pose = 'sit'
    slot.resumeAt = now + randomTime(game.random, 10_000, 90_000)
  } else {
    actor.mode = 'dance'
    actor.pose = 'dance'
    slot.resumeAt = now + randomTime(game.random, 5_000, 60_000)
  }
  actor.spotId = spot.id
}

export function stepParkNpcs(game, elapsedMs, now) {
  const distance = walkSpeed * elapsedMs / 1000
  for (const slot of game.walkers) {
    const { actor } = slot
    if (!actor) {
      if (now >= slot.respawnAt) spawnWalker(game, slot, -slot.direction)
      continue
    }
    const area = areas[slot.area]
    if (slot.resumeAt !== null) {
      if (now < slot.resumeAt) continue
      Object.assign(actor, constrain(area, actor.x, actor.y))
      actor.mode = 'free'
      actor.pose = 'walk'
      actor.spotId = null
      actor.seatSlot = null
      actor.facing = slot.direction
      slot.resumeAt = null
    }

    const edge = slot.direction < 0 ? area.left : area.right
    const destination = slot.visit?.point ?? constrain(area, edge, actor.y)
    if (!walkTo(actor, area, destination, distance)) continue
    if (slot.visit) {
      startActivity(game, slot, now)
    } else {
      game.npcs.delete(actor.id)
      slot.actor = null
      slot.respawnAt = now + randomTime(game.random, 5000, 10_000)
    }
  }
}
