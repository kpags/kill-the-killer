import { isLiving } from '../shared/combat.js'
import { smokeCooldownMs, smokeDurationMs, smokeHeight, smokeItem, smokeWidth } from '../shared/smoke.js'

export function smokeObscuredUntil(actor, clouds, now) {
  if (!isLiving(actor)) return 0
  let until = 0
  for (const cloud of clouds) {
    if (cloud.area !== actor.area || cloud.ownerId === actor.id || cloud.endsAt <= now) continue
    if (Math.hypot((actor.x - cloud.x) / (smokeWidth / 2), (actor.y - cloud.y) / (smokeHeight / 2)) <= 1) {
      until = Math.max(until, cloud.endsAt)
    }
  }
  return until
}

export function useSmokeInPark(game, playerId, now) {
  const actor = game.players.get(playerId)
  if (!isLiving(actor) || actor.isBot || actor.combat || ['consume', 'basketball', 'firing-range'].includes(actor.mode) || game.winner) {
    return 'You cannot use Smoke right now.'
  }
  if (actor.penaltyUntil > now) return 'Items are disabled during a penalty.'
  if (actor.equippedItem !== smokeItem) return 'Equip Smoke first.'
  if (actor.itemReadyAt[smokeItem] > now) return 'Smoke is recharging.'
  actor.itemReadyAt[smokeItem] = now + smokeCooldownMs
  game.smokeClouds.push({ x: actor.x, y: actor.y, ownerId: actor.id, area: actor.area,
    startedAt: now, endsAt: now + smokeDurationMs })
}
