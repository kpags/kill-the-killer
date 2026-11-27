import { isLiving, victimCueEndsAt } from '../shared/combat.js'

export const parkMatchMs = 180_000
const overtimeMs = 60_000

export function hitmanStats({ score, kills, deaths, penalties }) {
  return { score, kills, deaths, penalties }
}

export function compareHitmanPlayers(first, second) {
  return second.score - first.score || first.deaths - second.deaths || first.penalties - second.penalties
}

export function finishHitmanMatch(game) {
  const ranked = [...game.players.values()].sort(compareHitmanPlayers)
  if (!ranked.length) return
  const leaders = ranked.filter((player) => compareHitmanPlayers(ranked[0], player) === 0)
  finishMatch(game, leaders, game.matchEndsAt)
}

export function resolveLastManStanding(game, now) {
  if (game.modeId !== 'last_man_standing' || game.initialPlayerCount < 2 || game.result) return
  const living = [...game.players.values()].filter(isLiving)
  if (living.length === 1) {
    const displayAt = Math.max(now, ...[...game.players.values()].map((player) => Math.max(
      player.vanishesAt ?? now, player.victimCue?.kind === 'killed' ? victimCueEndsAt(player.victimCue) : now,
    )))
    finishMatch(game, living, displayAt)
  } else if (living.length > 1 && now >= game.matchEndsAt) {
    const rounds = Math.floor((now - game.matchEndsAt) / overtimeMs) + 1
    game.overtimeRound += rounds
    game.matchEndsAt += rounds * overtimeMs
  }
}

function finishMatch(game, winners, displayAt) {
  game.result = { winners: winners.map((player) => ({
    id: player.id, name: player.name, color: player.color,
    ...(game.modeId === 'Hitman' ? hitmanStats(player) : {}),
  })) }
  game.resultAt = displayAt
  game.projectiles.length = 0
  for (const actor of [...game.players.values(), ...game.npcs.values()]) {
    if (actor.poison) actor.poison = null
  }
}
