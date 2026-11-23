import metadata from '../assets/gameplay/atlases.json'
import { areas, designHeight, designWidth, hidingPose, standingHeight } from '../shared/park.js'
import { combatCueFadeMs, combatFeedbackDuration, combatPlaybackRate, deathOpacity, oneShotPoses,
  npcPenaltyMs, penaltyFadeMs, targetKilledSlideMs } from '../shared/combat.js'
import { frameAt, hoverOpacity, pickModel } from './parkPicking.js'

const atlasUrls = import.meta.glob('../assets/gameplay/*.webp', { eager: true, import: 'default', query: '?url' })
const atlasScale = standingHeight / 120
const crowdPlaybackRate = 0.8
const footRow = 132
const playerShadowColors = ['#ff7096', '#ffd568', '#8cefaf', '#74dfff', '#b69bff']
const narrowSceneWidth = areas[0].width
const narrowViewport = window.matchMedia('(max-width: 640px)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const feedbackColors = { penalty: '#ff4545', rating: '#ffffff', stun: '#ffe452', 'target-killed': '#ffffff' }
const penaltyGlowPadding = 22
const penaltyGlowColor = '#ff1737'

function paintCombatFeedback(ctx, feedback, head, now, width) {
  const stackSpacing = feedback.some(({ kind, points }) => kind === 'target-killed' || points != null) ? 42 : 16
  let targetLabelTop = null
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#000'
  for (const [index, { kind, text, startedAt, points }] of feedback.entries()) {
    const age = Math.max(0, now - startedAt)
    const duration = combatFeedbackDuration(kind)
    if (age >= duration) continue
    const targetKilled = kind === 'target-killed'
    const scoredKill = kind === 'rating' && points != null
    const lines = targetKilled ? text.split('\n') : scoredKill ? [`+${points}`, text] : [text]
    const lineSpacing = targetKilled ? 23 : 18
    const slide = reducedMotion.matches ? 1 : Math.min(1, age / targetKilledSlideMs)
    const progress = age / duration
    const lift = reducedMotion.matches ? 0 : 30 * (1 - (1 - progress) ** 2)
    const top = targetKilled ? head.y + 12 - 56 * slide : head.y - 44 - lift
    const stack = (feedback.length - index - 1) * stackSpacing
    const y = Math.max(12, top - stack - (scoredKill ? lineSpacing : 0))
    if (targetKilled) targetLabelTop = Math.min(targetLabelTop ?? Infinity, y - 15)
    ctx.font = targetKilled ? '800 18px system-ui, sans-serif' : '800 15px system-ui, sans-serif'
    ctx.lineWidth = targetKilled ? 10 : 3
    ctx.globalAlpha = targetKilled ? Math.min(1, (duration - age) / combatCueFadeMs) : 1 - progress
    ctx.fillStyle = feedbackColors[kind]
    const inset = Math.max(...lines.map((line) => ctx.measureText(line).width / 2)) + ctx.lineWidth / 2 + 2
    const x = Math.max(inset, Math.min(width - inset, head.x))
    for (const [lineIndex, line] of lines.entries()) ctx.strokeText(line, x, y + lineIndex * lineSpacing)
    for (const [lineIndex, line] of lines.entries()) ctx.fillText(line, x, y + lineIndex * lineSpacing)
  }
  return targetLabelTop
}

function paintFrame(ctx, atlas, index, x = 0, y = 0) {
  const { width, height, columns, image } = atlas
  ctx.drawImage(image, index % columns * width, Math.floor(index / columns) * height, width, height, x, y, width, height)
}

function penaltyGlowStrength(until, now) {
  if (reducedMotion.matches) return 1
  const age = now - (until - npcPenaltyMs)
  return 0.6 + 0.4 * Math.cos(2 * Math.PI * age / 1000)
}

function distortScene(ctx, atlas, frame, strength, time) {
  const { image, width, height, columns } = atlas
  if (ctx.canvas.width !== width) ctx.canvas.width = width
  if (ctx.canvas.height !== height) ctx.canvas.height = height
  const sourceX = frame % columns * width
  const sourceY = Math.floor(frame / columns) * height
  const phase = reducedMotion.matches ? 0 : time / 360
  const rows = 12
  const margin = 4 * strength
  for (let row = 0; row < rows; row++) {
    const top = Math.floor(row * height / rows)
    const bandHeight = Math.floor((row + 1) * height / rows) - top
    const offset = 3.5 * strength * Math.sin(phase + row * 0.68)
    ctx.drawImage(image, sourceX + margin - offset, sourceY + top, width - margin * 2, bandHeight, 0, top, width, bandHeight)
  }
}

function createPenaltyOutline(atlas, frame) {
  const outline = document.createElement('canvas')
  outline.width = atlas.width + penaltyGlowPadding * 2
  outline.height = atlas.height + penaltyGlowPadding * 2
  const ctx = outline.getContext('2d')
  for (const [x, y] of [[-8, 0], [8, 0], [0, -8], [0, 8], [-6, -6], [6, -6], [-6, 6], [6, 6]]) {
    paintFrame(ctx, atlas, frame, penaltyGlowPadding + x, penaltyGlowPadding + y)
  }
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = penaltyGlowColor
  ctx.fillRect(0, 0, outline.width, outline.height)
  ctx.globalCompositeOperation = 'destination-out'
  paintFrame(ctx, atlas, frame, penaltyGlowPadding, penaltyGlowPadding)
  return outline
}

function createPlayerShadow() {
  const shadow = document.createElement('canvas')
  const size = 64
  const center = size / 2
  shadow.width = size
  shadow.height = size
  const ctx = shadow.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, size, 0)
  playerShadowColors.forEach((color, index) => gradient.addColorStop(index / (playerShadowColors.length - 1), color))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const fade = ctx.createRadialGradient(center, center, 0, center, center, center)
  fade.addColorStop(0, '#000b')
  fade.addColorStop(0.45, '#0009')
  fade.addColorStop(1, '#0000')
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, size, size)
  return shadow
}

function polygon(points) {
  const shape = new Path2D()
  shape.moveTo(...points[0])
  for (const point of points.slice(1)) shape.lineTo(...point)
  shape.closePath()
  return shape
}

function contains(points, x, y) {
  let inside = false
  let [previousX, previousY] = points.at(-1)
  for (const [currentX, currentY] of points) {
    if ((currentY > y) !== (previousY > y)
      && x < currentX + (previousX - currentX) * (y - currentY) / (previousY - currentY)) inside = !inside
    previousX = currentX
    previousY = currentY
  }
  return inside
}

function matchPurpleIdle(image) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = frame
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i]
    const green = data[i + 1]
    const blue = data[i + 2]
    // Match the walking fill (#9800fd) while retaining the outline and the alpha mask.
    const tint = Math.min(1, Math.max(0, Math.min(red, blue) - green) / 167)
    data[i] = red - 20 * tint
    data[i + 1] = green - 5 * tint
    data[i + 2] = blue + 17 * tint
  }
  ctx.putImageData(frame, 0, 0)
  return canvas
}

export async function loadParkArt() {
  const entries = await Promise.all(Object.entries(metadata).map(async ([name, atlas]) => {
    const image = new Image()
    image.src = atlasUrls[`../assets/gameplay/${name}.webp`]
    await image.decode()
    return [name, {
      ...atlas,
      image: name === 'purple-idle' ? matchPurpleIdle(image) : image,
      duration: atlas.durations.reduce((sum, ms) => sum + ms, 0),
      silhouettes: new Map(),
    }]
  }))
  return Object.fromEntries(entries)
}

export function createParkRenderer(canvas, art) {
  const ctx = canvas.getContext('2d')
  const playerShadow = createPlayerShadow()
  const distortionCtx = document.createElement('canvas').getContext('2d')
  const grayscaleCtx = document.createElement('canvas').getContext('2d')
  grayscaleCtx.canvas.width = 160
  grayscaleCtx.canvas.height = 136
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = 160
  sampleCanvas.height = 136
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
  const foregroundPaths = areas.map((area) => area.foreground.map(polygon))
  let visible = new Map()
  let lastArea = null
  let snapshot = null
  let snapshotReceivedAt = 0
  let lastServerNow = 0
  let hoveredId = null
  let hoverStartedAt = 0
  const tints = new Map()
  const penaltyOutlines = new WeakMap()

  function paintPenaltyGlow({ atlas, frame, opacity = 1 }, strength) {
    let frames = penaltyOutlines.get(atlas)
    if (!frames) {
      frames = new Map()
      penaltyOutlines.set(atlas, frames)
    }
    if (!frames.has(frame)) frames.set(frame, createPenaltyOutline(atlas, frame))
    ctx.save()
    ctx.globalAlpha = opacity * strength
    ctx.shadowColor = penaltyGlowColor
    ctx.shadowBlur = 12
    ctx.drawImage(frames.get(frame), -80 - penaltyGlowPadding, -footRow - penaltyGlowPadding)
    ctx.restore()
  }

  function paintPlayerShadow(x, y, radius) {
    const depth = radius * 0.3
    ctx.drawImage(playerShadow, x - radius, y - depth, radius * 2, depth * 2)
  }

  function silhouette(atlas, index) {
    if (!atlas.silhouettes.has(index)) {
      sampleCtx.clearRect(0, 0, 160, 136)
      paintFrame(sampleCtx, atlas, index)
      const { data } = sampleCtx.getImageData(0, 0, 160, 136)
      const points = []
      let halfWidth = 0
      for (let y = 0; y < 136; y += 3) {
        for (let x = 0; x < 160; x += 3) {
          if (data[(y * 160 + x) * 4 + 3] > 100) {
            points.push([x - 80, y - footRow])
            halfWidth = Math.max(halfWidth, Math.abs(x - 80))
          }
        }
      }
      const top = points[0]?.[1] ?? -120
      let left = Infinity
      let right = -Infinity
      for (const [x, y] of points) {
        if (y > top + 12) break
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
      // The seated atlas has a gap between the legs. Trace up it to the pelvis.
      let seatRow = footRow
      while (seatRow > 0 && data[((seatRow - 1) * 160 + 80) * 4 + 3] < 128) seatRow--
      atlas.silhouettes.set(index, {
        data,
        points,
        head: { x: points.length ? (left + right) / 2 : 0, y: top },
        width: halfWidth * 2 + 6,
        height: -top + 3,
        seatOffset: seatRow ? footRow - seatRow : 0,
      })
    }
    return atlas.silhouettes.get(index)
  }

  function alphaAt(actor, x, y) {
    return silhouette(actor.atlas, actor.frame).data[(y * 160 + x) * 4 + 3]
  }

  function withinPose(actor, x, y) {
    const { atlas, pose, frame } = actor
    const currentSeatOffset = pose === 'sit' ? silhouette(atlas, frame).seatOffset : 0
    return atlas.durations.some((_, index) => {
      if (index === frame) return false
      const shape = silhouette(atlas, index)
      const frameY = pose === 'sit' ? y + currentSeatOffset - shape.seatOffset : y
      return frameY >= 0 && frameY < 136 && shape.data[(frameY * 160 + x) * 4 + 3] > 100
    })
  }

  function hidingPreview(area, actor, spotId, time, modelScale) {
    const spot = area.spots.find(({ id, hiding }) => id === spotId && hiding)
    if (!spot) return null

    const [x, y, width, height] = spot.rect
    const atlas = art[`${actor.color}-${hidingPose(area, spot)}`]
    const frame = frameAt(atlas, time)
    const shape = silhouette(atlas, frame)
    const inset = Math.min(1, width / 10, height / 10)
    return {
      ...actor,
      x: x + width / 2,
      y: y + height - inset,
      atlas,
      frame,
      scale: Math.min(modelScale, (width - inset * 2) / shape.width, (height - inset * 2) / shape.height),
    }
  }

  return function draw(state, time, playerId, showPrompt, pointer = null, pickAttack = false) {
    const area = areas[state.area]
    const modelScale = atlasScale * area.modelScale
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.round(canvas.clientWidth * ratio)
    const height = Math.round(canvas.clientHeight * ratio)
    if (width < 1 || height < 1) return { faded: 0, head: null, hoveredId: null, attackId: null, serverNow: state.serverTime }
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const viewWidth = state.spectating ? area.width : narrowViewport.matches ? narrowSceneWidth : designWidth
    const scale = Math.min(width / viewWidth, height / designHeight)
    if (snapshot !== state) {
      snapshot = state
      snapshotReceivedAt = time
    }
    const serverNow = Math.max(lastServerNow, (state.serverTime ?? 0) + Math.max(0, time - snapshotReceivedAt))
    lastServerNow = serverNow
    const penaltyActive = state.penaltyUntil > serverNow
    const penaltyEnd = state.penaltyUntil ?? state.penaltyFadeAt ?? -Infinity
    const penaltyStrength = Math.min(1, Math.max(0, (penaltyEnd + penaltyFadeMs - serverNow) / penaltyFadeMs))
    const penaltyFilter = penaltyStrength ? `grayscale(${penaltyStrength})` : 'none'

    ctx.resetTransform()
    ctx.filter = penaltyFilter
    ctx.fillStyle = '#101728'
    ctx.fillRect(0, 0, width, height)
    ctx.filter = 'none'

    if (lastArea !== state.area) {
      visible.clear()
      hoveredId = null
      lastArea = state.area
    }
    const actors = state.actors.filter((actor) => !actor.hidden && deathOpacity(actor, serverNow) > 0).map((actor) => {
      const previous = visible.get(actor.id)
      const poseTime = previous?.pose === actor.pose ? previous.poseTime : time - (actor.animationOffset ?? 0)
      const isSeated = actor.pose === 'sit'
      const atlas = art[`${actor.color}-${actor.pose}`]
      const playbackRate = actor.pose === 'talk' || actor.pose.startsWith('phone-') ? crowdPlaybackRate : 1
      let age = (time - poseTime) * playbackRate
      if (actor.combat) age = (serverNow - actor.combat.startedAt) * combatPlaybackRate(actor.pose)
      else if (actor.actionStartedAt != null) age = serverNow - actor.actionStartedAt
      const frame = frameAt(atlas, age, actor.oneShot || oneShotPoses.has(actor.pose))
      const seatOffset = isSeated ? silhouette(atlas, frame).seatOffset * modelScale : 0
      const canInterpolate = previous && previous.pose !== 'sit' && !isSeated
        && !previous.combat && !actor.combat && previous.generation === actor.generation
      return {
        ...actor,
        poseTime,
        atlas,
        frame,
        seatOffset,
        groundX: actor.x,
        groundY: actor.y,
        opacity: deathOpacity(actor, serverNow),
        x: canInterpolate ? previous.x + (actor.x - previous.x) * 0.42 : actor.x,
        y: canInterpolate ? previous.y + (actor.y - previous.y) * 0.42 : actor.y + seatOffset,
      }
    }).sort((first, second) => first.y - second.y)
    visible = new Map(actors.map((actor) => [actor.id, actor]))
    const local = state.actors.find((actor) => actor.id === playerId)
    const preview = local?.hidden ? hidingPreview(area, local, state.spotId, time, modelScale) : null
    const player = preview ?? visible.get(playerId) ?? local
    const sceneWidth = area.width * scale
    const offsetX = sceneWidth > width
      ? Math.max(width - sceneWidth, Math.min(0, width / 2 - (player?.x ?? area.width / 2) * scale))
      : (width - sceneWidth) / 2
    const offsetY = (height - area.height * scale) / 2
    const worldPointer = pointer && !state.matchEnded ? {
      x: (pointer.x * width / canvas.clientWidth - offsetX) / scale,
      y: (pointer.y * height / canvas.clientHeight - offsetY) / scale,
    } : null
    const nextHovered = pickModel(actors, local, worldPointer, modelScale, alphaAt,
      hoveredId ? { id: hoveredId, contains: withinPose } : null)
    const attackId = pickAttack ? pickModel(actors, local, worldPointer, modelScale, alphaAt) : null
    if (hoveredId !== nextHovered) {
      hoveredId = nextHovered
      hoverStartedAt = time
    }
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY)
    const scene = art[area.art]
    const sceneFrame = frameAt(scene, time)
    if (penaltyStrength) {
      distortScene(distortionCtx, scene, sceneFrame, penaltyStrength, time)
      ctx.filter = penaltyFilter
      ctx.drawImage(distortionCtx.canvas, 0, 0)
      ctx.filter = 'none'
    } else {
      paintFrame(ctx, scene, sceneFrame)
    }

    const shadowRadius = 19 * area.modelScale
    const playerShadowRadius = 17 * area.modelScale
    for (const actor of actors) {
      const shadow = ctx.createRadialGradient(actor.x, 0, area.modelScale, actor.x, 0, shadowRadius)
      shadow.addColorStop(0, '#030611b8')
      shadow.addColorStop(1, '#03061100')
      ctx.save()
      ctx.globalAlpha = actor.opacity
      ctx.translate(0, actor.y - actor.seatOffset + area.modelScale)
      ctx.scale(1, 0.33)
      ctx.fillStyle = shadow
      ctx.fillRect(actor.x - shadowRadius, -shadowRadius, shadowRadius * 2, shadowRadius * 2)
      ctx.restore()

      if (actor.id === playerId) {
        ctx.save()
        ctx.globalAlpha = actor.opacity
        ctx.filter = penaltyFilter
        paintPlayerShadow(actor.x, actor.y + 3 * area.modelScale, playerShadowRadius)
        ctx.restore()
      }
      ctx.save()
      ctx.globalAlpha = actor.opacity
      ctx.translate(actor.x, actor.y)
      ctx.scale(actor.facing * modelScale, modelScale)
      const glowUntil = actor.id === playerId ? state.penaltyUntil : actor.penaltyGlowUntil
      if (glowUntil > serverNow) {
        ctx.filter = 'none'
        paintPenaltyGlow(actor, penaltyGlowStrength(glowUntil, serverNow))
      }
      if (penaltyStrength && !(penaltyActive && actor.id === playerId)) {
        // Apply the color filter on a sprite-sized canvas to keep the fade responsive.
        grayscaleCtx.clearRect(0, 0, 160, 136)
        grayscaleCtx.filter = penaltyFilter
        paintFrame(grayscaleCtx, actor.atlas, actor.frame)
        ctx.drawImage(grayscaleCtx.canvas, -80, -footRow)
      } else {
        paintFrame(ctx, actor.atlas, actor.frame, -80, -footRow)
      }
      if (actor.id === hoveredId) {
        const key = `${actor.color}-${actor.pose}:${actor.frame}`
        if (!tints.has(key)) {
          const tint = document.createElement('canvas')
          tint.width = 160
          tint.height = 136
          const tintCtx = tint.getContext('2d')
          paintFrame(tintCtx, actor.atlas, actor.frame)
          tintCtx.globalCompositeOperation = 'source-in'
          tintCtx.fillStyle = '#910123'
          tintCtx.fillRect(0, 0, 160, 136)
          tints.set(key, tint)
        }
        ctx.globalAlpha = hoverOpacity(time - hoverStartedAt, reducedMotion.matches)
        if (penaltyStrength) ctx.filter = penaltyFilter
        ctx.drawImage(tints.get(key), -80, -footRow)
      }
      ctx.restore()
    }

    let faded = 0
    const silhouetteReach = 55 * area.modelScale
    area.foreground.forEach((region, index) => {
      const xMin = Math.min(...region.map(([x]) => x))
      const xMax = Math.max(...region.map(([x]) => x))
      const overlaps = actors.some((actor) => actor.x >= xMin - silhouetteReach && actor.x <= xMax + silhouetteReach
        && silhouette(actor.atlas, actor.frame).points.some(([x, y]) => (
          contains(region, actor.x + actor.facing * x * modelScale, actor.y + y * modelScale)
        )))
      ctx.save()
      ctx.clip(foregroundPaths[state.area][index])
      if (overlaps) {
        ctx.globalAlpha = 0.24
        faded++
      }
      if (penaltyStrength) {
        ctx.filter = penaltyFilter
        ctx.drawImage(distortionCtx.canvas, 0, 0)
      } else {
        paintFrame(ctx, scene, sceneFrame)
      }
      ctx.restore()
    })
    if (preview) {
      ctx.save()
      ctx.globalAlpha = 0.6
      ctx.filter = penaltyFilter
      paintPlayerShadow(preview.x, preview.y + area.modelScale, playerShadowRadius * preview.scale / modelScale)
      ctx.globalAlpha = 0.45
      ctx.translate(preview.x, preview.y)
      ctx.scale(preview.facing * preview.scale, preview.scale)
      if (penaltyActive) {
        ctx.filter = 'none'
        paintPenaltyGlow(preview, penaltyGlowStrength(state.penaltyUntil, serverNow))
      }
      paintFrame(ctx, preview.atlas, preview.frame, -80, -footRow)
      ctx.restore()
    }

    let head = null
    if (player && (showPrompt || state.combatFeedback?.length)) {
      const atlas = player.atlas ?? art[`${player.color}-idle`]
      const headOffset = silhouette(atlas, player.frame ?? 0).head
      const playerScale = preview?.scale ?? modelScale
      head = {
        x: (offsetX + (player.x + player.facing * headOffset.x * playerScale) * scale) * canvas.clientWidth / width,
        y: (offsetY + (player.y + headOffset.y * playerScale) * scale) * canvas.clientHeight / height,
      }
    }
    let targetLabelTop = null
    if (head && state.combatFeedback?.length) {
      ctx.save()
      ctx.setTransform(width / canvas.clientWidth, 0, 0, height / canvas.clientHeight, 0, 0)
      ctx.filter = penaltyFilter
      targetLabelTop = paintCombatFeedback(ctx, state.combatFeedback, head, serverNow, canvas.clientWidth)
      ctx.restore()
    }
    ctx.filter = 'none'
    return { faded, head, hoveredId, attackId, serverNow, targetLabelTop, penaltyActive, penaltyStrength }
  }
}
