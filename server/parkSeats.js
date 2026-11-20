export function claimSeat(game, actor, spot) {
  const occupied = new Set()
  for (const roster of [game.players, game.npcs]) {
    for (const other of roster.values()) {
      if (other.area === actor.area && other.spotId === spot.id && other.mode === 'sit') {
        occupied.add(other.seatSlot)
      }
    }
  }

  const [left, , width] = spot.rect
  const count = spot.seat_slots ?? 1
  let closest = Infinity
  let seat
  for (let index = 0; index < count; index++) {
    if (occupied.has(index)) continue
    const x = left + (index + 0.5) * width / count
    const distance = Math.abs(actor.x - x)
    if (distance < closest) {
      closest = distance
      seat = { x, y: spot.y, seatSlot: index }
    }
  }
  return seat
}
