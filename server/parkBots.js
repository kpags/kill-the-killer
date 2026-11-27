import { areas, constrain, groundRange, nearbySpot, sprintSpeed, walkSpeed } from '../shared/park.js'
import { attackRange, blowgunItem, equippedAttackRange, inAttackRange, isLiving, poisonSpeedFactor, rockItem } from '../shared/combat.js'
import { smokeItem } from '../shared/smoke.js'
import { claimSeat } from './parkSeats.js'
import { smokeObscuredUntil } from './parkSmoke.js'

export const botDecisionMs = 250
const sightRange = 220
const leadLifetime = 3000
const offensivePoses = new Set(['kill', 'punch', 'blowgun', 'throw'])
const idle = { kind: 'idle' }

const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y)

// These shared lanes cross the full playable width, including Carpark's step.
const travelDepth = areas.map((area) => {
  const samples = [area.left, area.right]
  for (const [x] of area.ground) {
    if (x > area.left && x < area.right) samples.push(x - 0.01, x)
  }
  const ranges = samples.map((x) => groundRange(area, x))
  return (Math.max(...ranges.map(([top]) => top)) + Math.min(...ranges.map(([, bottom]) => bottom))) / 2
})

export function createBotMemory(now, random) {
  return {
    nextDecisionAt: now + Math.floor(random() * botDecisionMs),
    intent: idle,
    visited: areas.map(() => -Infinity),
    tracks: new Map(),
    nextEscapeAt: 0,
    escapeUntil: 0,
    nextRestAt: 0,
    restUntil: 0,
    nextSprintAt: 0,
    sprintUntil: 0,
    nextMistakeAt: 0,
    nextRangedAt: 0,
  }
}

function spotApproach(area, spot) {
  const [left, , width] = spot.rect
  return constrain(area, left + width / 2, spot.y + 6)
}

export function observeParkBot(game, actor, now, { heartbeat, smokeObscured, penaltyNotices }) {
  const area = areas[actor.area]
  const here = { x: actor.x, y: actor.y, area: actor.area, pose: actor.pose }
  const target = game.players.get(game.targets.get(actor.id))
  const models = []
  if (!smokeObscured) {
    for (const roster of [game.players, game.npcs]) {
      for (const other of roster.values()) {
        if (other === actor || other.area !== here.area || other.mode === 'hide'
          || !isLiving(other) || distance(here, other) > sightRange
          || smokeObscuredUntil(other, game.smokeClouds, now, actor.id) > now) continue
        const { id, color, x, y, pose, facing } = other
        models.push({ id, color, x, y, pose: other.rockStunnedUntil > now ? 'stun' : pose, facing, area: here.area })
      }
    }
  }
  const spots = area.spots.flatMap((spot) => {
    const point = spotApproach(area, spot)
    if (distance(here, point) > 95) return []
    if (spot.hiding) return [{ id: spot.id, kind: 'hide', point }]
    if (spot.type.main === 'sitting' && claimSeat(game, actor, spot)) return [{ id: spot.id, kind: 'seat', point }]
    return []
  })
  return {
    here, models, spots, heartbeat, smokeObscured, penaltyNotices,
    modeId: game.modeId,
    target: target ? { color: target.color, name: target.name } : null,
    readyItems: [blowgunItem, rockItem, smokeItem].filter((item) => !(actor.itemReadyAt[item] > now)),
    penalized: actor.penaltyUntil > now,
    crowdReacting: Boolean(game.npcPanics.get(here.area)?.hasWitnesses),
    nearbySpotId: nearbySpot(actor)?.id,
    mode: actor.mode, stamina: actor.stamina, profile: actor.profile,
  }
}

function trackCandidates(observation, memory, now) {
  const { here, models, target, crowdReacting } = observation
  if (memory.targetColor !== target?.color || memory.observedArea !== here.area
    || now - memory.observedAt > botDecisionMs * 2) {
    memory.tracks.clear()
    memory.attack = null
    memory.watchUntil = undefined
    if (memory.targetColor !== target?.color) memory.lastSeen = null
    memory.targetColor = target?.color
    memory.observedArea = here.area
  }
  const candidates = target ? models.filter(({ color }) => color === target.color) : []
  const currentTracks = new Map()
  const ranked = []
  for (const model of candidates) {
    const old = memory.tracks.get(model.id)
    const standingStill = !crowdReacting && model.pose === 'idle'
    const track = {
      loneSince: candidates.length === 1 ? old?.loneSince ?? now : undefined,
      idleSince: standingStill ? old?.idleSince ?? now : undefined,
      offense: old?.offense || offensivePoses.has(model.pose),
      sprint: old?.sprint || (!crowdReacting && model.pose === 'sprint'),
      turned: old?.turned || Boolean(old && !crowdReacting && model.facing !== old.facing
        && ['walk', 'sprint'].includes(model.pose) && ['walk', 'sprint'].includes(old.pose)),
      facing: model.facing,
      pose: model.pose,
    }
    currentTracks.set(model.id, track)
    if (memory.lastAttempt?.id === model.id && memory.lastAttempt.until > now) continue
    const loneMatch = now - track.loneSince >= leadLifetime
    const sustainedIdle = now - track.idleSince >= 750
    ranked.push({ model, score: 4 * Number(track.offense) + 2 * Number(track.sprint)
      + Number(track.turned) + 2 * Number(loneMatch) + 3 * Number(sustainedIdle) })
  }
  memory.tracks = currentTracks
  memory.observedAt = now
  ranked.sort((first, second) => second.score - first.score)
  const [best, second] = ranked
  return {
    count: candidates.length,
    certain: best && best.score >= 3 && best.score > (second?.score ?? -1) ? best.model : null,
    possible: candidates.length === 1 ? best?.model : null,
  }
}

function travelTo(here, destination, sprint = false) {
  const direction = Math.sign(destination - here.area)
  const area = areas[here.area]
  return { kind: 'move', point: {
    x: direction > 0 ? area.right + 16 : area.left - 16, y: travelDepth[here.area],
  }, sprint }
}

function patrol(here, memory, random) {
  if (memory.patrolArea == null || memory.patrolArea === here.area) {
    const elsewhere = memory.visited.map((_, index) => index).filter((index) => index !== here.area)
    const oldest = Math.min(...elsewhere.map((index) => memory.visited[index]))
    const eligible = elsewhere.filter((index) => memory.visited[index] === oldest)
    const distanceToArea = Math.min(...eligible.map((index) => Math.abs(index - here.area)))
    const closest = eligible.filter((index) => Math.abs(index - here.area) === distanceToArea)
    memory.patrolArea = closest[Math.floor(random() * closest.length)]
  }
  return travelTo(here, memory.patrolArea)
}

function nearestSpot(observation, kind) {
  return observation.spots.filter((spot) => spot.kind === kind)
    .sort((a, b) => distance(observation.here, a.point) - distance(observation.here, b.point))[0]
}

function visitSpot(observation, spot, sprint) {
  if (observation.nearbySpotId === spot.id) return { kind: 'interact' }
  return { kind: 'move', point: spot.point, sprint }
}

function evade(observation, memory, now) {
  const { here, mode, stamina, smokeObscured } = observation
  if (mode === 'hide') return idle
  const sprint = stamina > 30 && now < memory.escapeUntil - 900
  const shelter = !smokeObscured && nearestSpot(observation, 'hide')
  if (shelter && distance(here, shelter.point) <= 70) return visitSpot(observation, shelter, sprint)
  if (memory.escapeArea === here.area) return idle
  return travelTo(here, memory.escapeArea, sprint)
}

function rest(observation, memory, now) {
  const { stamina, profile, modeId, here, models, nearbySpotId } = observation
  if (now < memory.restUntil) return idle
  if (now < memory.nextRestAt || (stamina > 55 && (modeId !== 'Hitman' || profile >= 66))) return
  const seat = nearestSpot(observation, 'seat')
  if (seat && nearbySpotId !== seat.id) return visitSpot(observation, seat, false)
  const talker = models.filter(({ pose }) => pose === 'talk')
    .sort((a, b) => distance(here, a) - distance(here, b))[0]
  if (!seat && modeId === 'Hitman' && talker && distance(here, talker) > 22 && distance(here, talker) <= 70) {
    const point = constrain(areas[here.area], talker.x, talker.y)
    return { kind: 'move', point }
  }
  memory.restUntil = now + 3000
  memory.nextRestAt = now + 10_000
  return seat ? { kind: 'interact' } : { kind: 'action', action: talker && distance(here, talker) <= 22 ? 'talk' : 'phone' }
}

function attackIsClear(here, target, models, range = attackRange) {
  if (!inAttackRange(here, target, range)) return false
  // A partial overlap can still leave a visible part of the target to click.
  return !models.some((other) => other.id !== target.id && other.y >= target.y
    && other.y - target.y < 5 && Math.abs(other.x - target.x) < 4)
}

function beginAttack(memory, { id }, item, now, random, mistaken = false) {
  memory.attack = { id, item, mistaken, at: now + 400 + Math.floor(random() * 251) }
  return idle
}

function continueAttack(memory, now) {
  const { id, item, at } = memory.attack
  if (now < at) return idle
  memory.lastAttempt = { id, until: now + 5000 }
  memory.attack = null
  memory.restUntil = 0
  return { kind: 'attack', id, item }
}

function mistakenTarget(observation, memory, certain, now, random) {
  if (now < memory.nextMistakeAt) return
  const { here, models, target } = observation
  // A same-color figure or someone seated nearby can be mistaken for the quarry.
  const candidates = models.filter((model) => model.id !== certain?.id
    && (model.color === target.color || model.pose === 'sit')
    && (memory.lastAttempt?.id !== model.id || memory.lastAttempt.until <= now)
    && attackIsClear(here, model, models))
  if (!candidates.length) return
  memory.nextMistakeAt = now + 7000
  if (random() >= 0.86) return candidates[Math.floor(random() * candidates.length)]
}

function rangedItem(observation, memory, target, now, random) {
  if (now < memory.nextRangedAt) return
  const { here, models, readyItems } = observation
  const options = [blowgunItem, rockItem].filter((item) =>
    readyItems.includes(item) && attackIsClear(here, target, models, equippedAttackRange(item, here.area)))
  if (!options.length) return
  memory.nextRangedAt = now + 4500
  if (random() >= 0.7) return options[Math.floor(random() * options.length)]
}

function pursue(observation, memory, target, now, random) {
  const { here, models, stamina } = observation
  memory.lastSeen = { x: target.x, y: target.y, area: here.area, until: now + leadLifetime }
  if (attackIsClear(here, target, models)) {
    memory.blockedAt = undefined
    return beginAttack(memory, target, 'fist', now, random)
  }
  if (inAttackRange(here, target)) {
    memory.blockedAt ??= now
    if (now - memory.blockedAt >= 1750) {
      memory.lastAttempt = { id: target.id, until: now + 3500 }
      memory.blockedAt = undefined
    }
    return idle
  }
  memory.blockedAt = undefined
  memory.restUntil = 0
  const item = rangedItem(observation, memory, target, now, random)
  if (item) return beginAttack(memory, target, item, now, random)
  const point = constrain(areas[here.area], target.x, target.y)
  const sprintRoom = distance(here, point) > attackRange + 8
  if (sprintRoom && stamina > 45 && now >= memory.nextSprintAt) {
    memory.sprintUntil = now + 650
    memory.nextSprintAt = now + 4000
  }
  return { kind: 'move', point, sprint: sprintRoom && stamina > 30 && now < memory.sprintUntil }
}

export function chooseBotIntent(observation, memory, now, random) {
  const { here, target, models, penalized, smokeObscured, heartbeat, crowdReacting } = observation
  memory.visited[here.area] = now
  const { certain, possible, count } = trackCandidates(observation, memory, now)
  const canHunt = target && !penalized && !smokeObscured
  const pending = memory.attack
  if (canHunt && pending && (pending.mistaken || certain?.id === pending.id)) {
    const model = models.find(({ id }) => id === pending.id)
    const ready = pending.item === 'fist' || observation.readyItems.includes(pending.item)
    if (model && ready && attackIsClear(here, model, models, equippedAttackRange(pending.item, here.area))) {
      return continueAttack(memory, now)
    }
  }
  memory.attack = null
  if (canHunt) {
    const mistake = mistakenTarget(observation, memory, certain, now, random)
    if (mistake) return beginAttack(memory, mistake, 'fist', now, random, true)
    if (certain && inAttackRange(here, certain)) return pursue(observation, memory, certain, now, random)
  }

  const threatened = heartbeat <= 700 && (!count || models.some((model) =>
    distance(here, model) <= 70 && (offensivePoses.has(model.pose) || (!crowdReacting && model.pose === 'sprint'))))
  if (now >= memory.nextEscapeAt && (threatened || penalized || smokeObscured)) {
    const area = areas[here.area]
    memory.escapeArea = here.area === 0 || (here.area < areas.length - 1 && area.right - here.x < here.x - area.left)
      ? here.area + 1 : here.area - 1
    memory.escapeUntil = now + 1800
    memory.nextEscapeAt = now + 6500
    memory.restUntil = 0
    if (threatened && !penalized && !smokeObscured && observation.mode !== 'hide'
      && observation.readyItems.includes(smokeItem) && random() >= 0.75) {
      return { kind: 'smoke', item: smokeItem }
    }
  }
  if (now < memory.escapeUntil) return evade(observation, memory, now)
  if (canHunt && certain) return pursue(observation, memory, certain, now, random)

  const lead = memory.lastSeen
  if (canHunt && lead?.until > now && lead.area === here.area && !count) {
    const area = areas[here.area]
    if (lead.x - area.left < 25 && here.area > 0) return travelTo(here, here.area - 1)
    if (area.right - lead.x < 25 && here.area < areas.length - 1) return travelTo(here, here.area + 1)
    return { kind: 'move', point: constrain(area, lead.x, lead.y) }
  }
  const notice = target && observation.penaltyNotices.find(({ name }) => name === target.name)
  if (canHunt && notice && notice.area !== here.area && !possible) return travelTo(here, notice.area)

  if (!count) memory.watchUntil = undefined
  if (canHunt && count) memory.watchUntil ??= now + (count === 1 ? 4250 : 1750)
  if (canHunt && now < memory.watchUntil) {
    if (possible && distance(here, possible) > 55) {
      return { kind: 'move', point: constrain(areas[here.area], possible.x, possible.y) }
    }
    return { kind: 'observe' }
  }
  return rest(observation, memory, now) ?? patrol(here, memory, random)
}

export function steerParkBot(actor, intent, elapsedMs) {
  const { point, sprint = false } = intent
  const area = areas[actor.area]
  const pace = sprint && actor.stamina > 0 && !actor.exhausted ? sprintSpeed : walkSpeed
  const step = pace * elapsedMs / 1000 * (actor.poison ? poisonSpeedFactor : 1)
  const tolerance = Math.max(2, step * 0.64)
  const dx = point.x - actor.x
  const dy = point.y - actor.y
  const x = Math.abs(dx) > tolerance ? Math.sign(dx) : 0
  const y = Math.abs(dy) > tolerance ? Math.sign(dy) : 0
  if (x) {
    const lift = constrain(area, actor.x + x * step, actor.y).y - actor.y
    if (Math.abs(lift) > Math.max(0.01, step * 0.7)) return { x: 0, y: Math.sign(lift), sprint: false }
  }
  return { x, y, sprint }
}
