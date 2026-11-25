import { areas, constrain, randomGroundPoint } from '../shared/park.js'
import { animationDuration, attackRange, combatFeedbackDuration, deathFadeMs, inAttackRange, isLiving,
  npcPenaltyMs, penaltyNoticeLimit, respawnDelayMs, stunMs, targetSearchMs, victimCueEndsAt } from '../shared/combat.js'
import { adjustProfile, hideTransitionMs, profileBarSize, profileKillAward } from '../shared/profile.js'
import { queueNpcPanic } from './parkNpcs.js'
import { queueParkSound, setPenaltySound } from './parkSounds.js'

const stopped = { x: 0, y: 0, sprint: false, until: 0 }
const pick = (values, random) => values[Math.floor(random() * values.length)] ?? null

function addCombatFeedback(actor, kind, text, now, points) {
  const feedback = (actor.combatFeedback ?? []).filter(({ kind, startedAt }) => now - startedAt < combatFeedbackDuration(kind))
  feedback.push({ kind, text, startedAt: now, area: actor.area, ...(points != null ? { points } : {}) })
  actor.combatFeedback = feedback
}

function applyNpcPenalty(game, actor, now) {
  actor.penaltyUntil = now + npcPenaltyMs
  game.penaltyNotices = game.penaltyNotices
    .filter(({ playerId, expiresAt }) => expiresAt > now && game.players.has(playerId))
    .slice(1 - penaltyNoticeLimit)
  game.penaltyNotices.push({ id: ++game.penaltySequence, playerId: actor.id, expiresAt: actor.penaltyUntil })
  setPenaltySound(game, actor)
}

function setTarget(game, actor, targetId, initial = false) {
  const previousTargetId = game.targets.get(actor.id) ?? actor.previousTargetId
  if (!initial && targetId && previousTargetId !== targetId) actor.profile = 0
  game.targets.set(actor.id, targetId)
  actor.targetReadyAt = undefined
  actor.previousTargetId = undefined
}

function startTargetSearch(game, actor, now, previousTargetId) {
  game.targets.set(actor.id, null)
  actor.targetReadyAt = now + targetSearchMs
  actor.previousTargetId = previousTargetId
}

export function refreshParkTargets(game, now, initial = false) {
  const living = [...game.players.values()].filter(isLiving)
  const hitman = game.modeId === 'Hitman'
  const order = hitman ? [] : game.targetOrder.filter((id) => isLiving(game.players.get(id)))
  for (const actor of game.players.values()) {
    if (game.winner || !isLiving(actor)) {
      setTarget(game, actor, null)
      continue
    }
    if (actor.targetReadyAt > now) continue
    if (hitman) {
      const target = game.players.get(game.targets.get(actor.id))
      if (isLiving(target) && target !== actor) continue
      const candidates = living.filter((other) => other !== actor)
      const differentTargets = candidates.filter(({ id }) => id !== actor.previousTargetId)
      const next = pick(differentTargets.length ? differentTargets : candidates, game.random)
      setTarget(game, actor, next?.id ?? null, initial)
    } else {
      const index = order.indexOf(actor.id)
      const targetId = index >= 0 && order.length > 1 ? order[(index + 1) % order.length] : null
      setTarget(game, actor, targetId, initial)
    }
  }
  for (const id of game.targets.keys()) {
    if (!game.players.has(id)) game.targets.delete(id)
  }
}

function releaseActivity(actor) {
  Object.assign(actor, { spotId: null, seatSlot: null, hideUntil: 0, actionStartedAt: null, input: stopped })
}

function beginCombat(actor, pose, now, extra = {}) {
  if (actor.mode === 'hide') actor.profileHideMs += hideTransitionMs
  releaseActivity(actor)
  actor.mode = 'combat'
  actor.pose = pose
  actor.combat = { startedAt: now, endsAt: now + animationDuration(actor.color, pose), ...extra }
}

function finishCombat(actor) {
  Object.assign(actor, constrain(areas[actor.area], actor.x, actor.y))
  Object.assign(actor, { mode: 'free', pose: 'idle', combat: null, input: stopped })
}

export function resolveParkWinner(game, now) {
  if (game.modeId !== 'last_man_standing' || game.initialPlayerCount < 2 || game.winner) return
  const living = [...game.players.values()].filter(isLiving)
  if (living.length !== 1) return
  const actor = living[0]
  game.winner = { id: actor.id, name: actor.name, color: actor.color }
  game.winnerAt = Math.max(now, ...[...game.players.values()].map((player) => Math.max(
    player.vanishesAt ?? now, player.victimCue?.kind === 'killed' ? victimCueEndsAt(player.victimCue) : now,
  )))
  for (const player of game.players.values()) player.input = stopped
}

export function attackInPark(game, playerId, actorId, now) {
  const actor = game.players.get(playerId)
  if (!actor || actor.isBot || !isLiving(actor)) return 'You cannot attack right now.'
  if (game.winner) return 'The match has ended.'
  if (actor.combat || actor.mode === 'consume') return 'Wait for your current action to finish.'
  const victim = typeof actorId === 'string' && (game.players.get(actorId) ?? game.npcs.get(actorId))
  if (!isLiving(victim) || victim === actor || victim.mode === 'hide' || victim.area !== actor.area) {
    return 'That model is unavailable.'
  }
  if (!inAttackRange(actor, victim)) return `Move within ${attackRange} pixels of that model.`

  refreshParkTargets(game, now)
  const isNpc = game.npcs.has(actorId)
  const isTarget = game.targets.get(actor.id) === victim.id
  const lastManStanding = game.modeId === 'last_man_standing'
  const lethal = isNpc || isTarget || victim.mode === 'sit'
  if (!lethal && ['pre-stun', 'stun'].includes(victim.pose)) return 'That player is already reacting to a punch.'
  const defensiveStun = !lethal && game.targets.get(victim.id) === actor.id
  actor.facing = Math.sign(victim.x - actor.x) || actor.facing
  beginCombat(actor, lethal ? 'kill' : 'punch', now)
  if (lethal) {
    beginCombat(victim, 'death', now)
    Object.assign(victim, {
      life: 'dying',
      vanishesAt: victim.combat.endsAt + deathFadeMs,
      respawnAt: !isNpc && game.modeId === 'Hitman' ? now + respawnDelayMs : null,
      victimCue: isTarget && !victim.isBot ? { kind: 'killed', startedAt: now, killerName: actor.name } : null,
    })
    if (isNpc || isTarget) {
      actor.killFlashAt = now
      queueParkSound(game, actor.area, 'kill')
    }
    if (isNpc) {
      adjustProfile(actor, -20)
      applyNpcPenalty(game, actor, now)
    }
    if (isTarget && lastManStanding) {
      addCombatFeedback(actor, 'target-killed', 'Target\nKilled', now)
    } else if (isTarget && game.modeId === 'Hitman') {
      const award = profileKillAward(actor.profile)
      actor.score += award.points
      addCombatFeedback(actor, 'rating', award.rating, now, award.points)
    }
    queueNpcPanic(game, victim, victim.combat.endsAt)
    resolveParkWinner(game, now)
    if (!isNpc && !game.winner) {
      for (const hunter of game.players.values()) {
        if (isLiving(hunter) && game.targets.get(hunter.id) === victim.id) startTargetSearch(game, hunter, now, victim.id)
      }
    }
    refreshParkTargets(game, now)
  } else {
    victim.facing = -actor.facing
    beginCombat(victim, 'pre-stun', now, { stun: defensiveStun })
    queueParkSound(game, actor.area, 'pre-stun')
    if (!defensiveStun) queueParkSound(game, actor.area, 'quick-stun')
    if (!victim.isBot && (lastManStanding || defensiveStun)) {
      victim.victimCue = { kind: 'stunned', startedAt: now }
      if (defensiveStun) victim.victimCue.holdUntil = victim.combat.endsAt + stunMs
    }
    addCombatFeedback(actor, 'stun', 'Stunned', now)
    adjustProfile(actor, -10)
    if (defensiveStun && game.modeId === 'Hitman') {
      const hasAlternative = [...game.players.values()].some((other) => isLiving(other) && other !== victim && other !== actor)
      if (hasAlternative) startTargetSearch(game, victim, now, actor.id)
    }
  }
}

function respawn(game, actor, now) {
  const area = Math.floor(game.random() * areas.length)
  releaseActivity(actor)
  Object.assign(actor, {
    area, ...randomGroundPoint(areas[area], game.random),
    life: 'alive', pose: 'idle', mode: 'free', combat: null,
    vanishesAt: null, respawnAt: null, respawnedAt: now, stamina: 100, profile: profileBarSize, profileHideMs: 0,
    recoveryMs: 0, exhausted: false, generation: (actor.generation ?? 0) + 1,
  })
}

export function advanceParkCombat(game, now) {
  const respawned = []
  for (const actor of [...game.players.values(), ...game.npcs.values()]) {
    const waitingToSpectate = actor.respawnAt === null
      && actor.victimCue?.kind === 'killed' && now < victimCueEndsAt(actor.victimCue)
    if (actor.life === 'dying' && now >= actor.vanishesAt && !waitingToSpectate) {
      actor.life = actor.respawnAt !== null ? 'respawning' : 'eliminated'
      actor.mode = actor.life
      actor.combat = null
      actor.pose = 'idle'
    }
    if (actor.life === 'respawning' && now >= actor.respawnAt) {
      respawn(game, actor, now)
      respawned.push(actor)
    }
    if (!isLiving(actor) || !actor.combat || now < actor.combat.endsAt) continue
    if (actor.pose === 'pre-stun' && actor.combat.stun) {
      actor.pose = 'stun'
      actor.combat = { startedAt: actor.combat.endsAt, endsAt: actor.combat.endsAt + stunMs }
      if (now < actor.combat.endsAt) {
        queueParkSound(game, actor.area, 'full-stun')
        continue
      }
    }
    finishCombat(actor)
  }
  resolveParkWinner(game, now)
  refreshParkTargets(game, now)
  // A respawn starts with one bar, even when it receives a fresh target.
  for (const actor of respawned) actor.profile = profileBarSize
  return new Set(respawned.map((actor) => actor.id))
}

export function spectateInPark(game, playerId, area) {
  const actor = game.players.get(playerId)
  if (game.modeId !== 'last_man_standing' || actor?.life !== 'eliminated') return 'You are not spectating.'
  if (!Number.isInteger(area) || !areas[area]) return 'That area is unavailable.'
  actor.spectatorArea = area
}
