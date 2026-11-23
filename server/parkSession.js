import { randomInt } from 'node:crypto'
import { areas, colors, constrain, nearbySpot, sprintSpeed, walkSpeed } from '../shared/park.js'
import { spawnParkNpcs, stepParkNpcs } from './parkNpcs.js'
import { claimSeat } from './parkSeats.js'
import { combatFeedbackDuration, isLiving, killFlashMs, penaltyFadeMs, respawnFadeMs, victimCueEndsAt } from '../shared/combat.js'
import { adjustProfile, hideProfileRate, hideTransitionMs, profileBarSize } from '../shared/profile.js'
import { advanceParkCombat, refreshParkTargets } from './parkCombat.js'

const staminaLimit = 100
const profileRange = 36
const hideLimit = 10_000
const stopped = { x: 0, y: 0, sprint: false, until: 0 }
const mainSpawns = [[130, 290], [215, 311], [338, 290], [70, 311], [277, 290], [411, 311]]
const parkActions = ['phone', 'talk', 'dance', 'scream']
const actionVariants = ['one', 'two', 'three']

export function createParkSession(players, random = Math.random, modeId = 'last_man_standing') {
  const palette = [...colors]
  const roster = new Map(players.map((player, index) => {
    const [color] = palette.splice(randomInt(palette.length), 1)
    const [x, y] = mainSpawns[index]
    return [player.id, {
      id: player.id,
      name: player.name,
      color,
      isBot: player.isBot,
      area: 0,
      x,
      y,
      facing: 1,
      pose: 'idle',
      mode: 'free',
      life: 'alive',
      combat: null,
      generation: 0,
      spotId: null,
      seatSlot: null,
      hideUntil: 0,
      stamina: staminaLimit,
      profile: profileBarSize,
      profileHideMs: 0,
      score: 0,
      recoveryMs: 0,
      exhausted: false,
      input: stopped,
    }]
  }))
  const targetOrder = [...roster.keys()]
  for (let index = targetOrder.length - 1; index > 0; index--) {
    const other = randomInt(index + 1)
    const current = targetOrder[index]
    targetOrder[index] = targetOrder[other]
    targetOrder[other] = current
  }
  const game = {
    players: roster, targetOrder, targets: new Map(), modeId,
    penaltyNotices: [], penaltySequence: 0,
    soundEvents: new Map(), privateSoundEvents: new Map(),
    initialPlayerCount: players.length, winner: null, winnerAt: null,
    npcs: new Map(), walkers: [], crowdRespawns: [], npcPanics: new Map(), random,
  }
  refreshParkTargets(game, 0, true)
  spawnParkNpcs(game)
  return game
}

export function setParkInput(actor, input, now) {
  if (!isLiving(actor) || actor.isBot || actor.combat) return
  if (![-1, 0, 1].includes(input.x) || ![-1, 0, 1].includes(input.y) || typeof input.sprint !== 'boolean') return
  actor.input = { x: input.x, y: input.y, sprint: input.sprint, until: now + 300 }
  if (!input.sprint) actor.exhausted = false
}

export function stopParkInput(actor) {
  if (actor) actor.input = stopped
}

function profileRate(game, actor, previous) {
  if (actor.mode === 'sit') return 8
  if (actor.mode === 'dance') return 3
  if (actor.mode !== 'free' && actor.mode !== 'action') return 0
  if (actor.mode === 'action' && actor.pose.startsWith('dance-') && nearbySpot(actor)?.type.sub === 'music') return 3

  const walking = actor.pose === 'walk' || actor.pose === 'sprint'
  const range = profileRange * areas[actor.area].modelScale
  let nearestBefore = Infinity
  let nearestAfter = Infinity
  for (const npc of game.npcs.values()) {
    if (npc.pose !== 'walk' && npc.pose !== 'talk') continue
    if (npc.area === actor.area) {
      const distance = Math.hypot(npc.x - actor.x, npc.y - actor.y)
      if (distance <= range && npc.pose === (walking ? 'walk' : 'talk')) return walking ? 2 : 5
      nearestAfter = Math.min(nearestAfter, distance)
    }
    if (walking && npc.area === previous.area) {
      nearestBefore = Math.min(nearestBefore, Math.hypot(npc.x - previous.x, npc.y - previous.y))
    }
  }
  if (!walking) return 1
  return nearestAfter > nearestBefore ? -1 : 0
}

function endInteraction(actor) {
  if (actor.mode === 'sit') Object.assign(actor, constrain(areas[actor.area], actor.x, actor.y))
  if (actor.mode === 'hide') actor.profileHideMs += hideTransitionMs
  actor.mode = 'free'
  actor.pose = 'idle'
  actor.spotId = null
  actor.seatSlot = null
  actor.hideUntil = 0
  actor.actionStartedAt = null
}

export function playParkAction(game, playerId, action, now) {
  const actor = game.players.get(playerId)
  if (!isLiving(actor) || actor.isBot || actor.combat || game.winner) return 'You cannot perform an action right now.'
  if (!parkActions.includes(action)) return 'That action is unavailable.'
  endInteraction(actor)
  stopParkInput(actor)
  const variant = actionVariants[Math.floor(game.random() * actionVariants.length)]
  actor.mode = 'action'
  actor.pose = `${action}-${variant}`
  actor.actionStartedAt = now
}

export function interactInPark(game, playerId, now) {
  const actor = game.players.get(playerId)
  if (!actor || actor.isBot) return
  if (!isLiving(actor) || actor.combat || game.winner) return 'You cannot interact right now.'
  if (actor.mode === 'action') endInteraction(actor)
  else if (actor.mode !== 'free') {
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
    actor.profileHideMs += hideTransitionMs
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
  const respawned = advanceParkCombat(game, now)
  for (const actor of game.players.values()) {
    if (actor.isBot || !isLiving(actor) || game.winner || respawned.has(actor.id)) continue
    if (actor.mode === 'hide' && now >= actor.hideUntil) endInteraction(actor)
    const hidingMs = Math.min(elapsedMs, actor.profileHideMs)
    actor.profileHideMs -= hidingMs
    if (actor.combat) {
      adjustProfile(actor, hideProfileRate * hidingMs / 1000)
      continue
    }
    const previous = { area: actor.area, x: actor.x, y: actor.y }
    const input = actor.input.until >= now ? actor.input : stopped
    if (actor.mode === 'action' && (input.x || input.y || input.sprint)) endInteraction(actor)
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
    const sprintMs = Math.min(spentMs, elapsedMs - hidingMs)
    const ordinaryMs = elapsedMs - hidingMs - sprintMs
    const profileChange = (profileRate(game, actor, previous) * ordinaryMs - 8 * sprintMs + hideProfileRate * hidingMs) / 1000
    adjustProfile(actor, profileChange)
  }
  stepParkNpcs(game, elapsedMs, now)
}

export function parkView(game, playerId, now) {
  const actor = game.players.get(playerId)
  refreshParkTargets(game, now)
  const target = game.players.get(game.targets.get(playerId))
  const hitman = game.modeId === 'Hitman'
  const spectating = actor.life === 'eliminated' && game.modeId === 'last_man_standing'
  const area = spectating ? actor.spectatorArea ?? actor.area : actor.area
  const restricted = !spectating && !isLiving(actor) && game.modeId === 'last_man_standing'
  const penaltyUntil = actor.penaltyUntil > now ? actor.penaltyUntil : undefined
  const penaltyNotices = penaltyUntil ? [] : game.penaltyNotices.flatMap(({ id, playerId, expiresAt }) => {
    const penalized = game.players.get(playerId)
    if (!penalized || expiresAt <= now) return []
    return [{ id, name: penalized.name, area: penalized.area, expiresAt }]
  })
  const actors = [...game.players.values(), ...game.npcs.values()]
    .filter((other) => other.area === area
      && (isLiving(other) || (other.life === 'dying' && now < other.vanishesAt))
      && (other === actor || other.mode !== 'hide')
      && (!restricted || game.npcs.has(other.id) || other === actor
        || other.life === 'dying' || other.combat || other.pose === 'sprint'))
  return {
    area,
    serverTime: now,
    penaltyUntil,
    penaltyFadeAt: !penaltyUntil && actor.penaltyUntil + penaltyFadeMs > now ? actor.penaltyUntil : undefined,
    penaltyNotices,
    killFlashAt: actor.killFlashAt != null && now - actor.killFlashAt < killFlashMs ? actor.killFlashAt : undefined,
    life: actor.life,
    spectating,
    respawnMs: actor.respawnAt ? Math.ceil(Math.max(0, actor.respawnAt - now)) : 0,
    respawnedAt: actor.life === 'alive' && actor.respawnedAt + respawnFadeMs > now ? actor.respawnedAt : undefined,
    matchEnded: Boolean(game.winner),
    winner: game.winner && now >= game.winnerAt ? game.winner : null,
    stamina: Math.round(actor.stamina * 10) / 10,
    profile: actor.profile,
    score: hitman ? actor.score : undefined,
    playerList: [...game.players.values()].map((player) => hitman
      ? { name: player.name, score: player.score }
      : { name: player.name, eliminated: !isLiving(player) }),
    victimCue: actor.victimCue && now < victimCueEndsAt(actor.victimCue) ? actor.victimCue : undefined,
    combatFeedback: actors.includes(actor) ? actor.combatFeedback
      ?.filter(({ area: eventArea, kind, startedAt }) => eventArea === area && now - startedAt < combatFeedbackDuration(kind))
      .map(({ area, ...feedback }) => feedback) : undefined,
    target: target ? { name: target.name, color: target.color } : null,
    targetReadyAt: actor.targetReadyAt,
    mode: actor.mode,
    spotId: isLiving(actor) && !actor.combat && !game.winner ? actor.spotId ?? nearbySpot(actor)?.id ?? null : null,
    hidingMs: Math.ceil(Math.max(0, actor.hideUntil - now)),
    actors: actors.map(({ id, color, area: actorArea, x, y, facing, pose, mode, animationOffset, actionStartedAt,
      life, combat, vanishesAt, generation, penaltyUntil: modelPenaltyUntil }) => ({
      id, color, area: actorArea, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
      facing, pose, hidden: mode === 'hide', animationOffset, life: life ?? 'alive',
      combat: combat ? { startedAt: combat.startedAt, endsAt: combat.endsAt } : null,
      actionStartedAt: actionStartedAt ?? undefined,
      oneShot: mode === 'panic' && actionStartedAt != null ? true : undefined,
      ...(modelPenaltyUntil > now ? { penaltyGlowUntil: modelPenaltyUntil } : {}),
      vanishesAt, generation: generation ?? 0,
    })),
  }
}
