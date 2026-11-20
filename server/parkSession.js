import { randomInt } from 'node:crypto'
import { areas, colors, constrain, nearbySpot, walkSpeed } from '../shared/park.js'
import { spawnParkNpcs, stepParkNpcs } from './parkNpcs.js'
import { claimSeat } from './parkSeats.js'

const sprintSpeed = 121
const staminaLimit = 100
const hideLimit = 10_000
const stopped = { x: 0, y: 0, sprint: false, until: 0 }
const mainSpawns = [[130, 290], [215, 311], [338, 290], [70, 311], [277, 290], [411, 311]]

export function createParkSession(players, random = Math.random) {
  const palette = [...colors]
  const roster = new Map(players.map((player, index) => {
    const [color] = palette.splice(randomInt(palette.length), 1)
    const [x, y] = mainSpawns[index]
    return [player.id, {
      id: player.id,
      color,
      isBot: player.isBot,
      area: 0,
      x,
      y,
      facing: 1,
      pose: 'idle',
      mode: 'free',
      spotId: null,
      seatSlot: null,
      hideUntil: 0,
      stamina: staminaLimit,
      recoveryMs: 0,
      exhausted: false,
      input: stopped,
    }]
  }))
  const game = { players: roster, npcs: new Map(), walkers: [], random }
  spawnParkNpcs(game)
  return game
}

export function setParkInput(actor, input, now) {
  if (!actor || actor.isBot) return
  if (![-1, 0, 1].includes(input.x) || ![-1, 0, 1].includes(input.y) || typeof input.sprint !== 'boolean') return
  actor.input = { x: input.x, y: input.y, sprint: input.sprint, until: now + 300 }
  if (!input.sprint) actor.exhausted = false
}

export function stopParkInput(actor) {
  if (actor) actor.input = stopped
}

function endInteraction(actor) {
  if (actor.mode === 'sit') Object.assign(actor, constrain(areas[actor.area], actor.x, actor.y))
  actor.mode = 'free'
  actor.pose = 'idle'
  actor.spotId = null
  actor.seatSlot = null
  actor.hideUntil = 0
}

export function interactInPark(game, playerId, now) {
  const actor = game.players.get(playerId)
  if (!actor || actor.isBot) return
  if (actor.mode !== 'free') {
    endInteraction(actor)
    return
  }

  const spot = nearbySpot(actor)
  if (!spot) return
  const isSeat = spot.type.main === 'sitting'
  const seat = isSeat ? claimSeat(game, actor, spot) : null
  if (isSeat && !seat) return `${spot.name} is full.`
  actor.spotId = spot.id
  stopParkInput(actor)
  if (spot.hiding) {
    actor.mode = 'hide'
    actor.pose = 'idle'
    actor.hideUntil = now + hideLimit
  } else if (seat) {
    actor.mode = 'sit'
    actor.pose = 'sit'
    actor.recoveryMs = 0
    Object.assign(actor, seat)
  } else if (spot.type.sub === 'music') {
    actor.mode = 'dance'
    actor.pose = 'dance'
  } else {
    actor.mode = 'inspect'
    actor.pose = 'idle'
  }
}

function move(actor, dx, dy) {
  const current = areas[actor.area]
  const x = actor.x + dx
  const y = actor.y + dy
  const next = x < current.left && dx < 0 ? actor.area - 1
    : x > current.right && dx > 0 ? actor.area + 1
    : actor.area
  if (next !== actor.area && areas[next]) {
    const destination = areas[next]
    const fromLeft = next > actor.area
    Object.assign(actor, constrain(destination, fromLeft ? destination.left + 4 : destination.right - 4, y))
    actor.area = next
    return true
  }
  const position = constrain(current, x, y)
  if (Math.abs(position.y - actor.y) <= Math.abs(dy) + 0.01) {
    const moved = position.x !== actor.x || position.y !== actor.y
    Object.assign(actor, position)
    return moved
  }
  // Keep the feet on the current side of a step in the playable boundary.
  const alongBoundary = constrain(current, actor.x, y)
  const moved = alongBoundary.y !== actor.y
  actor.y = alongBoundary.y
  return moved
}

export function stepPark(game, elapsedMs, now) {
  for (const actor of game.players.values()) {
    if (actor.isBot) continue
    if (actor.mode === 'hide' && now >= actor.hideUntil) endInteraction(actor)
    const input = actor.input.until >= now ? actor.input : stopped
    const moving = Boolean(input.x || input.y) && actor.mode === 'free'
    const sprinting = moving && input.sprint && !actor.exhausted && actor.stamina > 0
    let spentMs = 0
    if (moving) {
      spentMs = sprinting ? Math.min(elapsedMs, actor.stamina * 50) : 0
      const distance = (sprintSpeed * spentMs + walkSpeed * (elapsedMs - spentMs)) / 1000
      const magnitude = Math.hypot(input.x, input.y)
      if (input.x) actor.facing = input.x
      if (move(actor, distance * input.x / magnitude, distance * input.y / magnitude)) {
        actor.pose = sprinting ? 'sprint' : 'walk'
      } else {
        actor.pose = 'idle'
        spentMs = 0
      }
    } else if (actor.mode === 'free') {
      actor.pose = 'idle'
    }

    if (spentMs) {
      actor.stamina = Math.max(0, actor.stamina - spentMs / 50)
      if (actor.stamina < 0.001) {
        actor.stamina = 0
        actor.exhausted = true
      }
      actor.recoveryMs = 0
    } else if (actor.mode === 'sit') {
      actor.stamina = Math.min(staminaLimit, actor.stamina + elapsedMs * 30 / 1000)
    } else if (actor.stamina < staminaLimit) {
      actor.recoveryMs += elapsedMs
      if (actor.recoveryMs >= 3000) {
        actor.stamina = Math.min(staminaLimit, actor.stamina + 10)
        actor.recoveryMs -= 3000
      }
    }
  }
  stepParkNpcs(game, elapsedMs, now)
}

export function parkView(game, playerId, now) {
  const actor = game.players.get(playerId)
  const actors = [...game.players.values(), ...game.npcs.values()]
    .filter((other) => other.area === actor.area && (other === actor || other.mode !== 'hide'))
  return {
    area: actor.area,
    stamina: Math.round(actor.stamina * 10) / 10,
    mode: actor.mode,
    spotId: actor.spotId ?? nearbySpot(actor)?.id ?? null,
    hidingMs: Math.ceil(Math.max(0, actor.hideUntil - now)),
    actors: actors.map(({ id, color, x, y, facing, pose, mode, animationOffset }) => ({
      id, color, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, facing, pose, hidden: mode === 'hide', animationOffset,
    })),
  }
}
