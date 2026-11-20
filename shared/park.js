import park from '../data/maps/park.json' with { type: 'json' }

export const colors = ['blue', 'green', 'orange', 'purple', 'red', 'yellow']
export const designWidth = 719
export const designHeight = 357
export const standingHeight = 83
export const walkSpeed = 72
const edgePadding = 45
const spotRange = 21

// All geometry uses the corresponding guide image's original pixel coordinates.
export const areas = [
  {
    id: 'main', name: 'Main', art: '1_main', width: 507, height: 336,
    ground: [[1, 266], [490, 266], [490, 334], [1, 334]],
    crowds: [[78, 278, 70, 18], [165, 310, 69, 18], [223, 275, 70, 17], [292, 310, 69, 18], [364, 276, 69, 17]],
    interactions: { A: [408, 202, 82, 71], B: [299, 207, 81, 48], C: [107, 207, 85, 44] },
    foreground: [
      [[0, 277], [18, 276], [23, 290], [40, 300], [58, 303], [62, 316], [82, 315], [105, 334], [0, 336]],
      [[419, 336], [424, 326], [443, 316], [467, 303], [481, 301], [491, 282], [507, 282], [507, 336]],
    ],
  },
  {
    id: 'food_stalls', name: 'Food Stalls', art: '2_food_stalls', width: 719, height: 357,
    ground: [[17, 281], [702, 281], [702, 355], [17, 355]],
    crowds: [[187, 289, 69, 18], [290, 324, 69, 17], [407, 289, 70, 18], [565, 284, 70, 18]],
    interactions: { A: [24, 213, 81, 51], B: [149, 213, 116, 48], C: [323, 229, 121, 53], D: [462, 230, 118, 52], E: [598, 230, 105, 52] },
    foreground: [
      [[0, 289], [22, 285], [44, 297], [49, 313], [69, 310], [85, 328], [108, 336], [146, 337], [178, 355], [0, 357]],
      [[529, 357], [553, 341], [577, 322], [602, 324], [620, 318], [634, 309], [650, 312], [675, 297], [702, 295], [719, 297], [719, 357]],
    ],
  },
  {
    id: 'fountain', name: 'Fountain', art: '3_fountain', width: 553, height: 308,
    ground: [[15, 242], [537, 242], [537, 306], [15, 306]],
    crowds: [[98, 241, 69, 18], [423, 244, 69, 17]],
    interactions: { A: [24, 163, 93, 50], B: [147, 168, 40, 50], C: [381, 168, 40, 50], D: [445, 163, 91, 50] },
    foreground: [
      [[0, 257], [18, 257], [29, 275], [38, 280], [42, 295], [54, 294], [70, 301], [84, 308], [0, 308]],
      [[489, 308], [497, 298], [508, 302], [525, 286], [538, 272], [553, 267], [553, 308]],
      [[217, 248], [235, 250], [252, 248], [269, 251], [307, 249], [322, 250], [332, 247], [338, 251],
        [338, 274], [340, 278], [336, 284], [335, 295], [337, 302], [334, 304], [330, 304], [329, 300],
        [330, 287], [326, 282], [315, 284], [302, 281], [292, 283], [280, 280], [269, 283], [259, 284],
        [251, 280], [237, 282], [220, 282], [217, 286], [220, 291], [218, 303], [214, 303], [216, 293],
        [213, 286], [214, 282], [217, 276], [212, 271], [212, 260], [214, 254]],
    ],
  },
  {
    id: 'playground', name: 'Playground', art: '4_playground', width: 506, height: 335,
    ground: [[17, 269], [489, 269], [489, 333], [17, 333]],
    crowds: [[74, 271, 69, 18], [167, 271, 70, 18], [226, 304, 69, 17], [287, 271, 69, 18], [388, 275, 69, 18]],
    interactions: { A: [58, 215, 124, 52], B: [240, 215, 132, 52], C: [201, 186, 32, 80], D: [375, 186, 31, 81] },
    hiding: { A: [412, 170, 43, 92], B: [455, 170, 34, 92] },
    foreground: [
      [[0, 275], [16, 277], [34, 290], [56, 296], [73, 314], [104, 335], [0, 335]],
      [[425, 335], [433, 323], [460, 309], [472, 290], [489, 279], [506, 277], [506, 335]],
    ],
  },
  {
    id: 'fireworks', name: 'Fireworks', art: '5_fireworks', width: 506, height: 335,
    ground: [[15, 282], [489, 282], [489, 333], [15, 333]],
    crowds: [[105, 293, 70, 17], [218, 302, 69, 17], [355, 285, 69, 18]],
    interactions: { A: [45, 197, 93, 50], B: [212, 201, 93, 51], C: [378, 197, 93, 50] },
    foreground: [
      [[0, 283], [18, 283], [31, 301], [45, 302], [55, 312], [79, 317], [92, 327], [121, 335], [0, 335]],
      [[363, 335], [379, 325], [394, 317], [409, 316], [422, 300], [450, 289], [468, 297], [489, 282], [506, 280], [506, 335]],
    ],
  },
  {
    id: 'carpark', name: 'Carpark', art: '6_carpark', width: 549, height: 306,
    ground: [[11, 256], [170, 256], [171, 205], [533, 205], [547, 273], [547, 304], [11, 304]],
    crowds: [[76, 262, 69, 18], [186, 226, 69, 18]],
    hiding: { A: [37, 190, 42, 72], B: [110, 190, 43, 72] },
    foreground: [
      [[0, 271], [12, 271], [26, 284], [50, 291], [66, 306], [0, 306]],
      [[466, 306], [475, 292], [499, 281], [525, 276], [534, 286], [547, 266], [549, 267], [549, 306]],
    ],
  },
].map((area) => {
  const scale = park.areas[area.id].model_scale
  const walkingNpcs = park.areas[area.id].walking_npcs
  return {
    ...area,
    modelScale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    walkingNpcs: Number.isSafeInteger(walkingNpcs) && walkingNpcs > 0 ? walkingNpcs : 0,
    left: Math.min(...area.ground.map(([x]) => x)) + edgePadding,
    right: Math.max(...area.ground.map(([x]) => x)) - edgePadding,
    spots: [
      ...Object.entries(area.interactions ?? {}).map(([id, rect]) => spot(area, id, rect, false)),
      ...Object.entries(area.hiding ?? {}).map(([id, rect]) => spot(area, id, rect, true)),
    ],
  }
})

function spot(area, id, rect, hiding) {
  const [, y, , height] = rect
  const entry = park.areas[area.id][hiding ? 'hiding_spots' : 'interactions'][id]
  return { id: `${hiding ? 'hide' : 'interact'}-${id}`, rect, y: y + height, hiding, ...entry }
}

export function groundRange(area, x) {
  const intersections = area.ground.flatMap(([ax, ay], index) => {
    const [bx, by] = area.ground[(index + 1) % area.ground.length]
    return (x >= Math.min(ax, bx) && x < Math.max(ax, bx))
      ? [ay + ((x - ax) / (bx - ax)) * (by - ay)]
      : []
  })
  return [Math.min(...intersections) + 3, Math.max(...intersections) - 4]
}

export function constrain(area, x, y) {
  x = Math.max(area.left, Math.min(area.right, x))
  const [top, bottom] = groundRange(area, x)
  return { x, y: Math.max(top, Math.min(bottom, y)) }
}

export function hidingPose(area, spot) {
  return spot.rect[3] > standingHeight * area.modelScale ? 'idle' : 'sit'
}

export function nearbySpot(actor) {
  const area = areas[actor.area]
  let match
  let nearest = spotRange
  for (const spot of area.spots) {
    const [left, , width] = spot.rect
    const edgeX = Math.max(left, Math.min(left + width, actor.x))
    const approachY = spot.type.main === 'sitting'
      ? Math.max(spot.y, groundRange(area, actor.x)[0] + 4)
      : spot.y
    const distance = Math.hypot(actor.x - edgeX, actor.y - approachY)
    if (distance < nearest) {
      nearest = distance
      match = spot
    }
  }
  return match
}
