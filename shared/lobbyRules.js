export const capacity = 6

export function roomStartError(slots) {
  const players = slots.filter(Boolean)
  if (players.length < 2) return 'Add a bot or invite another player to start.'
  if (players.some((player) => !player.isBot && (!player.connected || !player.ready))) {
    return 'All human players must be connected and ready.'
  }
  return ''
}

export function mapName(id) {
  return id.split(/[-_\s]+/).filter(Boolean).map((word) => (
    word[0].toUpperCase() + word.slice(1).toLowerCase()
  )).join(' ')
}

export function compareMaps(first, second) {
  return mapName(first).localeCompare(mapName(second))
}

export function normalizeInviteCode(value) {
  if (typeof value !== 'string') return null
  const code = value.trim()
  return /^[A-Za-z0-9]{6}$/.test(code) ? code.toUpperCase() : null
}

export function normalizePlayerName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length <= 10 && /^[A-Za-z0-9]+(?: +[A-Za-z0-9]+)*$/.test(name) ? name : null
}
