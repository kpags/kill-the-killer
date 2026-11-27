function enqueue(events, key, sound) {
  const sounds = events.get(key) ?? []
  sounds.push(sound)
  events.set(key, sounds)
}

export function queueParkSound(game, area, kind, listenerId) {
  enqueue(game.soundEvents, area, { kind, variant: Math.random(), ...(listenerId ? { listenerId } : {}) })
}

export function setPenaltySound(game, actor) {
  const listeners = new Set([actor.id])
  for (const [hunterId, targetId] of game.targets) {
    if (targetId === actor.id) listeners.add(hunterId)
  }
  actor.penaltySound = { id: game.penaltySequence, variant: Math.random(), listeners }
}

export function penaltySoundsFor(game, playerId, now) {
  const sounds = []
  for (const actor of game.players.values()) {
    const { penaltySound, penaltyUntil } = actor
    if (penaltyUntil > now && penaltySound?.listeners.has(playerId)) {
      sounds.push({ id: penaltySound.id, variant: penaltySound.variant, expiresAt: penaltyUntil })
    }
  }
  return sounds.length ? sounds : undefined
}
