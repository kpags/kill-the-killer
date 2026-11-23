import { randomUUID } from 'node:crypto'
import { areas, colors, constrain, groundRange, sprintSpeed, walkSpeed } from '../shared/park.js'
import { claimSeat } from './parkSeats.js'
import { animationDuration, isLiving, screamPoses } from '../shared/combat.js'
import { queueParkSound } from './parkSounds.js'

const phonePoses = ['phone-one', 'phone-two', 'phone-three']
const directions = [-1, 1]
const maxCrowdSize = 3
const screamDelay = 1000
const returnDelay = 5000
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
          crowd: { group: `${areaIndex}:${x}:${y}`, pose, facing: facings[index],
            position: constrain(area, x + (index + 0.5) * width / count, y + height * (index % 2 ? 0.65 : 0.4)) },
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
    // Follow the current ground line until the requested depth becomes reachable.
    const along = constrain(area, x, actor.y)
    if (dx && Math.abs(along.y - actor.y) <= 0.01) {
      actor.x = along.x
      actor.facing = Math.sign(dx)
      return false
    }
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

function updateConversation(game, group) {
  const members = [...game.npcs.values()]
    .filter((actor) => actor.crowd?.group === group && isLiving(actor) && !actor.arrival && actor.mode !== 'panic')
    .sort((first, second) => first.x - second.x)
  if (members.length === 1) {
    const actor = members[0]
    if (!phonePoses.includes(actor.pose)) actor.pose = pick(phonePoses, game.random)
  } else if (members.length > 1) {
    const facings = pick(crowdFacings[members.length], game.random)
    members.forEach((actor, index) => {
      actor.pose = 'talk'
      actor.facing = facings[index]
    })
  }
}

export function queueNpcPanic(game, victim, deathEndsAt) {
  if (victim.crowd) updateConversation(game, victim.crowd.group)
  if (!game.npcPanics.has(victim.area)) {
    game.npcPanics.set(victim.area, {
      startsAt: deathEndsAt + screamDelay, deathX: victim.x, started: false, returnsAt: null,
    })
  }
}

function retireNpc(game, actor, respawnAt) {
  game.npcs.delete(actor.id)
  const slot = game.walkers.find((candidate) => candidate.actor === actor)
  if (slot) {
    Object.assign(slot, { actor: null, visit: null, resumeAt: null, respawnAt })
  } else if (actor.crowd) {
    game.crowdRespawns.push({ area: actor.area, crowd: actor.crowd, respawnAt })
  }
}

function startPanic(game, areaIndex, { startsAt, deathX }) {
  const area = areas[areaIndex]
  const crowd = [...game.npcs.values()].filter((actor) => actor.area === areaIndex && isLiving(actor))
  if (crowd.length) queueParkSound(game, areaIndex, 'crowd-reaction')
  for (const actor of crowd) {
    Object.assign(actor, constrain(area, actor.x, actor.y))
    const pose = pick(screamPoses, game.random)
    Object.assign(actor, {
      mode: 'panic', pose, actionStartedAt: startsAt, arrival: null,
      spotId: null, seatSlot: null,
      facing: Math.sign(deathX - actor.x) || actor.facing,
      screamEndsAt: startsAt + animationDuration(actor.color, pose),
      fleeDirection: actor.x <= (area.left + area.right) / 2 ? -1 : 1,
    })
  }
}

function releasePanic(game, areaIndex, returnsAt) {
  let count = 0
  const nextReturn = () => returnsAt + (count++ === 0 ? 0 : randomTime(game.random, 100, 1600))
  for (const slot of game.walkers) {
    if (slot.area !== areaIndex || slot.actor) continue
    slot.respawnAt = nextReturn()
    slot.direction = pick(directions, game.random)
  }
  for (const pending of game.crowdRespawns) {
    if (pending.area !== areaIndex) continue
    pending.respawnAt = nextReturn()
    pending.returnFromEdge = true
  }
  game.npcPanics.delete(areaIndex)
}

function stepPanic(game, areaIndex, panic, elapsedMs, now) {
  if (now < panic.startsAt) return
  if (!panic.started) {
    panic.started = true
    startPanic(game, areaIndex, panic)
  }
  if (panic.returnsAt !== null) {
    if (now >= panic.returnsAt) releasePanic(game, areaIndex, panic.returnsAt)
    return
  }

  const area = areas[areaIndex]
  let fleeing = false
  for (const actor of game.npcs.values()) {
    if (actor.area !== areaIndex || actor.mode !== 'panic' || !isLiving(actor)) continue
    if (now < actor.screamEndsAt) {
      fleeing = true
      continue
    }
    actor.pose = 'sprint'
    actor.facing = actor.fleeDirection
    actor.actionStartedAt = null
    const edge = actor.fleeDirection < 0 ? area.left : area.right
    const distance = sprintSpeed * Math.min(elapsedMs, now - actor.screamEndsAt) / 1000
    if (walkTo(actor, area, constrain(area, edge, actor.y), distance)) retireNpc(game, actor, Infinity)
    else fleeing = true
  }
  if (!fleeing) panic.returnsAt = now + returnDelay
}

function spawnCrowdReplacement(game, pending) {
  const { area, crowd, returnFromEdge } = pending
  const used = new Set([...game.npcs.values()]
    .filter((actor) => actor.crowd?.group === crowd.group).map((actor) => actor.color))
  const actor = {
    id: randomUUID(), area, crowd, ...crowd.position,
    color: pick(colors.filter((color) => !used.has(color)), game.random),
    facing: crowd.facing, pose: 'idle',
  }
  if (returnFromEdge) {
    const zone = areas[area]
    const direction = pick(directions, game.random)
    const x = direction > 0 ? zone.left : zone.right
    Object.assign(actor, constrain(zone, x, crowd.position.y), {
      facing: direction, pose: 'walk', arrival: crowd.position,
    })
  }
  game.npcs.set(actor.id, actor)
  if (!returnFromEdge) updateConversation(game, crowd.group)
}

export function stepParkNpcs(game, elapsedMs, now) {
  for (const actor of game.npcs.values()) {
    if (actor.life !== 'eliminated') continue
    const respawnAt = actor.vanishesAt + randomTime(game.random, 5000, 10_000)
    retireNpc(game, actor, respawnAt)
  }
  for (const [area, panic] of game.npcPanics) {
    stepPanic(game, area, panic, elapsedMs, now)
  }
  game.crowdRespawns = game.crowdRespawns.filter((pending) => {
    if (now < pending.respawnAt || game.npcPanics.get(pending.area)?.started) return true
    spawnCrowdReplacement(game, pending)
    return false
  })
  const distance = walkSpeed * elapsedMs / 1000
  for (const actor of game.npcs.values()) {
    if (!actor.arrival || !isLiving(actor)) continue
    if (!walkTo(actor, areas[actor.area], actor.arrival, distance)) continue
    actor.arrival = null
    updateConversation(game, actor.crowd.group)
  }
  for (const slot of game.walkers) {
    if (game.npcPanics.get(slot.area)?.started) continue
    const { actor } = slot
    if (!actor) {
      if (now >= slot.respawnAt) spawnWalker(game, slot, -slot.direction)
      continue
    }
    if (!isLiving(actor)) continue
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
