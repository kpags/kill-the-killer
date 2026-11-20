import assert from 'node:assert/strict'
import test from 'node:test'
import { areas, colors, constrain, hidingPose, standingHeight } from '../shared/park.js'
import { createParkSession, interactInPark, parkView, setParkInput, stepPark } from '../server/parkSession.js'

function roster(count = 2) {
  return Array.from({ length: count }, (_, index) => ({ id: String(index), isBot: index > 1 }))
}

function createEmptyPark(players) {
  const game = createParkSession(players)
  game.npcs.clear()
  game.walkers.length = 0
  return game
}

test('the six roster seats get distinct colors and valid Main spawns', () => {
  const game = createEmptyPark(roster(6))
  const actors = [...game.players.values()]
  assert.deepEqual(actors.map(({ color }) => color).sort(), [...colors].sort())
  assert.equal(new Set(actors.map(({ x, y }) => `${x},${y}`)).size, 6)
  for (const { area, x, y } of actors) {
    assert.equal(area, 0)
    assert.deepEqual(constrain(areas[0], x, y), { x, y })
  }
  const bot = actors.at(-1)
  setParkInput(bot, { x: 1, y: 0, sprint: true }, 1)
  stepPark(game, 50, 51)
  assert.equal(bot.pose, 'idle')
})

test('movement follows area edges in order and leaves stationary bots behind', () => {
  const game = createEmptyPark(roster(3))
  const player = game.players.get('0')
  for (let area = 0; area < areas.length; area++) {
    const current = areas[area]
    Object.assign(player, constrain(current, current.right, 290))
    const now = 100 * (area + 1)
    setParkInput(player, { x: 1, y: 0, sprint: false }, now)
    stepPark(game, 50, now + 50)
    assert.equal(player.area, Math.min(area + 1, areas.length - 1))
  }
  assert.equal(parkView(game, '0', 1000).actors.length, 1)
  assert.equal(parkView(game, '1', 1000).actors.length, 2)
  setParkInput(player, { x: 1, y: 0, sprint: false }, 1000)
  stepPark(game, 50, 1400)
  assert.equal(player.pose, 'idle')
  Object.assign(player, { x: 172, y: 215 })
  setParkInput(player, { x: -1, y: 0, sprint: false }, 1450)
  stepPark(game, 50, 1500)
  assert.deepEqual([player.x, player.y], [172, 215])
})

test('sprinting drains for five seconds and recovers in three-second steps', () => {
  const game = createEmptyPark(roster())
  const player = game.players.get('0')
  for (let now = 50; now <= 5000; now += 50) {
    setParkInput(player, { x: 1, y: 0, sprint: true }, now)
    stepPark(game, 50, now)
  }
  assert.equal(player.stamina, 0)
  setParkInput(player, { x: 0, y: 0, sprint: false }, 5001)
  stepPark(game, 2999, 8000)
  assert.equal(player.stamina, 0)
  stepPark(game, 1, 8001)
  assert.equal(player.stamina, 10)
})

test('Food Stalls and Fireworks use the updated guide limits for walking and entrances', () => {
  for (const [area, top, bottom] of [[1, 284, 351], [4, 285, 329]]) {
    const game = createEmptyPark(roster())
    const player = game.players.get('0')
    const previous = areas[area - 1]
    Object.assign(player, { area: area - 1, ...constrain(previous, previous.right, 0) })
    setParkInput(player, { x: 1, y: 0, sprint: false }, 0)
    stepPark(game, 50, 50)
    assert.equal(player.area, area)
    assert.equal(player.y, top)

    setParkInput(player, { x: 0, y: -1, sprint: false }, 50)
    stepPark(game, 50, 100)
    assert.equal(player.y, top)

    Object.assign(player, { y: bottom - 2 })
    setParkInput(player, { x: 0, y: 1, sprint: false }, 100)
    stepPark(game, 50, 150)
    assert.equal(player.y, bottom)

    const next = areas[area + 1]
    Object.assign(player, { area: area + 1, ...constrain(next, next.left, 0) })
    setParkInput(player, { x: -1, y: 0, sprint: false }, 150)
    stepPark(game, 50, 200)
    assert.equal(player.area, area)
    assert.equal(player.y, top)
  }
})

test('sitting restores 30 stamina per second up to the maximum', () => {
  const game = createEmptyPark(roster())
  const player = game.players.get('0')
  Object.assign(player, { stamina: 40, recoveryMs: 2900 })

  interactInPark(game, player.id, 1)
  stepPark(game, 250, 251)
  assert.equal(player.stamina, 47.5)
  stepPark(game, 750, 1001)
  assert.equal(player.stamina, 70)
  interactInPark(game, player.id, 1002)
  stepPark(game, 2999, 4001)
  assert.equal(player.stamina, 70)
  stepPark(game, 1, 4002)
  assert.equal(player.stamina, 80)
  interactInPark(game, player.id, 4003)
  stepPark(game, 1000, 5003)
  assert.equal(player.stamina, 100)
})

test('hiding uses the sit pose at and below the area-scaled standing height', () => {
  const carpark = areas.find(({ id }) => id === 'carpark')
  const height = standingHeight * carpark.modelScale
  assert.equal(hidingPose(carpark, { rect: [0, 0, 40, height + 1] }), 'idle')
  assert.equal(hidingPose(carpark, { rect: [0, 0, 40, height] }), 'sit')
  assert.equal(hidingPose(carpark, { rect: [0, 0, 40, height - 1] }), 'sit')
})

test('authored spots provide seating, dancing, info, and a timed private hide', () => {
  const game = createEmptyPark(roster())
  const player = game.players.get('0')
  const other = game.players.get('1')
  interactInPark(game, player.id, 1)
  assert.equal(player.mode, 'sit')
  interactInPark(game, player.id, 2)
  assert.equal(player.pose, 'idle')
  Object.assign(player, { x: 426, y: 278 })
  interactInPark(game, player.id, 3)
  assert.equal(player.mode, 'inspect')
  interactInPark(game, player.id, 4)
  Object.assign(player, { area: 3, x: 214, y: 275 })
  interactInPark(game, player.id, 5)
  assert.equal(player.pose, 'dance')
  interactInPark(game, player.id, 6)
  Object.assign(player, { x: 435, y: 273 })
  other.area = 3
  interactInPark(game, player.id, 10)
  assert.equal(parkView(game, '1', 10).actors.length, 1)
  const ownView = parkView(game, '0', 10)
  assert.equal(ownView.hidingMs, 10000)
  assert.equal(ownView.actors.find(({ id }) => id === player.id).hidden, true)
  assert.equal(ownView.spotId, 'hide-A')
  stepPark(game, 50, 10009)
  assert.equal(player.mode, 'hide')
  stepPark(game, 50, 10010)
  assert.equal(player.mode, 'free')
  assert.equal(parkView(game, '1', 10010).actors.length, 2)
})

test('bench slots fill independently and free up when a player stands', () => {
  const game = createEmptyPark(roster(3).map((player) => ({ ...player, isBot: false })))
  const [first, second, third] = game.players.values()
  Object.assign(second, { x: 178, y: 285 })
  Object.assign(third, { x: 157, y: 285 })

  interactInPark(game, first.id, 1)
  interactInPark(game, second.id, 2)
  assert.deepEqual([first.x, first.y, first.seatSlot], [128.25, 251, 0])
  assert.deepEqual([second.x, second.y, second.seatSlot], [170.75, 251, 1])
  assert.equal(interactInPark(game, third.id, 3), 'Bench C is full.')
  assert.equal(third.mode, 'free')

  interactInPark(game, first.id, 4)
  assert.equal(first.seatSlot, null)
  assert.deepEqual(constrain(areas[0], first.x, first.y), { x: first.x, y: first.y })
  interactInPark(game, third.id, 5)
  assert.equal(third.seatSlot, 0)
})

test('one-seat chairs and legacy picnic tables only seat one occupant', () => {
  for (const [area, x, y, bottom, name] of [
    [2, 167, 250, 218, 'Bench B'],
    [4, 90, 289, 247, 'Picnic Table A'],
  ]) {
    const game = createEmptyPark(roster())
    const [first, second] = game.players.values()
    Object.assign(first, { area, x, y })
    Object.assign(second, { area, x, y })
    interactInPark(game, first.id, 1)
    assert.equal(first.x, area === 2 ? 167 : 91.5)
    assert.equal(first.y, bottom)
    assert.equal(interactInPark(game, second.id, 2), `${name} is full.`)
    game.players.delete(first.id)
    interactInPark(game, second.id, 3)
    assert.equal(second.mode, 'sit')
  }
})
