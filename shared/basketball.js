export const basketballCourt = {
  width: 480, height: 370,
  startX: 240, startY: 329, ballRadius: 21,
  rimX: 240, rimY: 110, rimHalfWidth: 25.85, rimRadius: 4,
  launchTop: 260, launchBottom: 343,
}

const step = 1 / 120
const playbackRate = 2.1
export const basketballFrameMs = (step * 1000) / playbackRate
const gravity = 600
const maxUpwardSpeed = 650
const maxSideSpeed = 420

export function isBasketballSpot(spot) {
  return spot?.type.main === 'activity' && spot.type.sub === 'basketball'
}

export function basketballLaunch(x, y, vx, vy) {
  const { width, ballRadius, launchTop, launchBottom } = basketballCourt
  return {
    x: Math.max(ballRadius, Math.min(width - ballRadius, x)),
    y: Math.max(launchTop, Math.min(launchBottom, y)),
    vx: Math.max(-maxSideSpeed, Math.min(maxSideSpeed, vx)),
    vy: Math.max(-maxUpwardSpeed, Math.min(maxUpwardSpeed, vy)),
  }
}

export function simulateBasketballShot(launch) {
  if (!launch || !['x', 'y', 'vx', 'vy'].every((key) => Number.isFinite(launch[key]))) return null
  let { x, y, vx, vy } = basketballLaunch(launch.x, launch.y, launch.vx, launch.vy)
  const { width, height, ballRadius, rimX, rimY, rimHalfWidth, rimRadius } = basketballCourt
  const rimContact = rimHalfWidth - rimRadius
  const rims = [rimX - rimContact, rimX + rimContact]
  const frames = [{ x, y, radius: ballRadius }]
  let points = 0
  let scoreAt = 0
  let touchedRim = false
  let canScore = false

  for (let frame = 1; frame <= 330; frame++) {
    const previousY = y
    vy += gravity * step
    x += vx * step
    y += vy * step
    const radius = ballRadius - 12 * Math.min(1, frame / 90)
    if (y < rimY - radius) canScore = true

    if (canScore && !points && vy > 0) {
      for (const rim of rims) {
        const dx = x - rim
        const dy = y - rimY
        const distance = Math.hypot(dx, dy)
        const contact = radius + rimRadius
        if (distance >= contact) continue
        touchedRim = true
        const nx = distance ? dx / distance : 0
        const ny = distance ? dy / distance : -1
        x = rim + nx * contact
        y = rimY + ny * contact
        const speedIntoRim = vx * nx + vy * ny
        if (speedIntoRim < 0) {
          vx -= 1.45 * speedIntoRim * nx
          vy -= 1.45 * speedIntoRim * ny
        }
      }
      if (previousY <= rimY && y >= rimY && x > rims[0] && x < rims[1]) {
        points = touchedRim ? 1 : 2
        scoreAt = frame * basketballFrameMs
      }
    }

    frames.push({ x, y, radius })
    if (y - radius > height || x + radius < 0 || x - radius > width) break
  }

  return { frames, points, scoreAt, duration: (frames.length - 1) * basketballFrameMs }
}
