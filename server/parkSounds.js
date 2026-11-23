function enqueue(events, key, sound) {
  const sounds = events.get(key) ?? []
  sounds.push(sound)
  events.set(key, sounds)
}

export function queueParkSound(game, area, kind) {
  enqueue(game.soundEvents, area, { kind, variant: Math.random() })
}

export function queuePenaltySound(game, playerId) {
  const sound = { kind: 'penalty', variant: Math.random() }
  enqueue(game.privateSoundEvents, playerId, sound)
  for (const [hunterId, targetId] of game.targets) {
    if (targetId === playerId && hunterId !== playerId) enqueue(game.privateSoundEvents, hunterId, sound)
  }
}

export function parkSoundsFor(game, playerId, area) {
  return [...(game.soundEvents.get(area) ?? []), ...(game.privateSoundEvents.get(playerId) ?? [])]
}
