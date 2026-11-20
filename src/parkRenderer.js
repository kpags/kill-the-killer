import metadata from '../assets/gameplay/atlases.json'
import { areas, designHeight, designWidth, hidingPose, standingHeight } from '../shared/park.js'

const atlasUrls = import.meta.glob('../assets/gameplay/*.webp', { eager: true, import: 'default', query: '?url' })
const atlasScale = standingHeight / 120
const crowdPlaybackRate = 0.8
const footRow = 132
const narrowSceneWidth = areas[0].width
const narrowViewport = window.matchMedia('(max-width: 640px)')

function frameAt(atlas, ms) {
  let phase = ms % atlas.duration
  for (let frame = 0; frame < atlas.durations.length; frame++) {
    if (phase < atlas.durations[frame]) return frame
    phase -= atlas.durations[frame]
  }
  return 0
}

function paintFrame(ctx, atlas, index, x = 0, y = 0) {
  const { width, height, columns, image } = atlas
  ctx.drawImage(image, index % columns * width, Math.floor(index / columns) * height, width, height, x, y, width, height)
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

export async function loadParkArt() {
  const entries = await Promise.all(Object.entries(metadata).map(async ([name, atlas]) => {
    const image = new Image()
    image.src = atlasUrls[`../assets/gameplay/${name}.webp`]
    await image.decode()
    return [name, {
      ...atlas,
      image,
      duration: atlas.durations.reduce((sum, ms) => sum + ms, 0),
      silhouettes: new Map(),
    }]
  }))
  return Object.fromEntries(entries)
}

export function createParkRenderer(canvas, art) {
  const ctx = canvas.getContext('2d')
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = 160
  sampleCanvas.height = 136
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
  const foregroundPaths = areas.map((area) => area.foreground.map(polygon))
  let visible = new Map()
  let lastArea = null

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
        points,
        head: { x: points.length ? (left + right) / 2 : 0, y: top },
        width: halfWidth * 2 + 6,
        height: -top + 3,
        seatOffset: seatRow ? footRow - seatRow : 0,
      })
    }
    return atlas.silhouettes.get(index)
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

  return function draw(state, time, playerId, showPrompt) {
    const area = areas[state.area]
    const modelScale = atlasScale * area.modelScale
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.round(canvas.clientWidth * ratio)
    const height = Math.round(canvas.clientHeight * ratio)
    if (width < 1 || height < 1) return { faded: 0, head: null }
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const scale = Math.min(width / (narrowViewport.matches ? narrowSceneWidth : designWidth), height / designHeight)

    ctx.resetTransform()
    ctx.fillStyle = '#101728'
    ctx.fillRect(0, 0, width, height)

    if (lastArea !== state.area) {
      visible.clear()
      lastArea = state.area
    }
    const actors = state.actors.filter((actor) => !actor.hidden).map((actor) => {
      const previous = visible.get(actor.id)
      const poseTime = previous?.pose === actor.pose ? previous.poseTime : time - (actor.animationOffset ?? 0)
      const isSeated = actor.pose === 'sit'
      const atlas = art[`${actor.color}-${actor.pose}`]
      const playbackRate = actor.pose === 'talk' || actor.pose.startsWith('phone-') ? crowdPlaybackRate : 1
      const frame = frameAt(atlas, (time - poseTime) * playbackRate)
      const seatOffset = isSeated ? silhouette(atlas, frame).seatOffset * modelScale : 0
      const canInterpolate = previous && previous.pose !== 'sit' && !isSeated
      return {
        ...actor,
        poseTime,
        atlas,
        frame,
        seatOffset,
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
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY)
    const scene = art[area.art]
    const sceneFrame = frameAt(scene, time)
    paintFrame(ctx, scene, sceneFrame)

    const shadowRadius = 19 * area.modelScale
    for (const actor of actors) {
      const shadow = ctx.createRadialGradient(actor.x, 0, area.modelScale, actor.x, 0, shadowRadius)
      shadow.addColorStop(0, '#030611b8')
      shadow.addColorStop(1, '#03061100')
      ctx.save()
      ctx.translate(0, actor.y - actor.seatOffset + area.modelScale)
      ctx.scale(1, 0.33)
      ctx.fillStyle = shadow
      ctx.fillRect(actor.x - shadowRadius, -shadowRadius, shadowRadius * 2, shadowRadius * 2)
      ctx.restore()

      ctx.save()
      ctx.translate(actor.x, actor.y)
      ctx.scale(actor.facing * modelScale, modelScale)
      paintFrame(ctx, actor.atlas, actor.frame, -80, -footRow)
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
      paintFrame(ctx, scene, sceneFrame)
      ctx.restore()
    })
    if (preview) {
      ctx.save()
      ctx.globalAlpha = 0.45
      ctx.translate(preview.x, preview.y)
      ctx.scale(preview.facing * preview.scale, preview.scale)
      paintFrame(ctx, preview.atlas, preview.frame, -80, -footRow)
      ctx.restore()
    }

    let head = null
    if (showPrompt && player) {
      const atlas = player.atlas ?? art[`${player.color}-idle`]
      const headOffset = silhouette(atlas, player.frame ?? 0).head
      const playerScale = preview?.scale ?? modelScale
      head = {
        x: (offsetX + (player.x + player.facing * headOffset.x * playerScale) * scale) * canvas.clientWidth / width,
        y: (offsetY + (player.y + headOffset.y * playerScale) * scale) * canvas.clientHeight / height,
      }
    }
    return { faded, head }
  }
}
