export const rangeSize = 400
export const rangeCenter = rangeSize / 2
export const rangeSweepMin = rangeSize / 8
export const rangeSweepMax = rangeSize - rangeSweepMin
export const rangeAttempts = 5
export const rangeShotDelayMs = 1000
export const rangeResultMs = 2000

export const rangeRings = [
  { radius: 20, points: 25 },
  { radius: 44, points: 15 },
  { radius: 68, points: 12 },
  { radius: 92, points: 10 },
  { radius: 116, points: 8 },
  { radius: 140, points: 5 },
]

export function isFiringRangeSpot(spot) {
  return spot?.type.main === 'activity' && spot.type.sub === 'shooting'
}

export function rangeCoordinate(axis, startedAt, now) {
  const travelMs = axis === 'x' ? 1050 : 1350
  const phase = (Math.max(0, now - startedAt) / travelMs) % 2
  return rangeSweepMin + (rangeSweepMax - rangeSweepMin) * (1 - Math.abs(phase - 1))
}

export function rangePoints(x, y) {
  const distance = Math.hypot(x - rangeCenter, y - rangeCenter)
  return rangeRings.find(({ radius }) => distance <= radius)?.points ?? 0
}
