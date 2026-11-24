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
  const points = [[130, 290], [215, 311], [338, 290]]
  for (const [index, actor] of [...game.players.values()].entries()) {
    const [x, y] = points[index]
    Object.assign(actor, { area: 0, x, y })
  }
  return game
}

test('Park shares only the assigned target name and color, even when the target moves or hides', () => {
  const members = roster(3).map((member, index) => ({ ...member, name: `Player ${index + 1}` }))
  const game = createEmptyPark(members)
  const targets = new Set()
  for (const player of game.players.values()) {
    const { profile, target } = parkView(game, player.id, 0)
    assert.equal(profile, 33)
    assert.notEqual(target.name, player.name)
    assert.deepEqual(Object.keys(target).sort(), ['color', 'name'])
    targets.add(target.name)
  }
  assert.equal(targets.size, members.length)

  const player = game.players.get('0')
  const assigned = parkView(game, player.id, 0).target
  const target = [...game.players.values()].find(({ name }) => name === assigned.name)
  target.area = 4
  target.mode = 'hide'
  const view = parkView(game, player.id, 50)
  assert.deepEqual(view.target, assigned)
  assert.ok(view.actors.every(({ id }) => id !== target.id))

  game.players.delete(target.id)
  assert.notEqual(parkView(game, player.id, 50).target.name, assigned.name)
  for (const id of game.players.keys()) {
    if (id !== player.id) game.players.delete(id)
  }
  assert.equal(parkView(game, player.id, 50).target, null)
})

test('the profile meter follows Park behavior rates and remains between 0 and 100', () => {
  const game = createEmptyPark(roster(1))
  const player = game.players.get('0')
  let now = 0
  const tick = (ms = 1000, x = 0, sprint = false) => {
    now += ms
    setParkInput(player, { x, y: 0, sprint }, now)
    stepPark(game, ms, now)
    return parkView(game, player.id, now).profile
  }

  assert.equal(tick(), 34)
  game.npcs.set('crowd', { id: 'crowd', pose: 'talk', area: 0, x: 125, y: 290 })
  assert.equal(tick(), 39)
  assert.equal(tick(1000, 1), 38)
  game.npcs.clear()
  game.npcs.set('walker', { id: 'walker', pose: 'walk', area: 0, x: 274, y: 290 })
  assert.equal(tick(1000, 1), 40)
  game.npcs.clear()
  assert.equal(tick(1000, -1), 40)
  assert.equal(tick(1000, -1, true), 32)

  Object.assign(player, { x: 130, y: 290 })
  interactInPark(game, player.id, now)
  assert.equal(tick(), 40)
  interactInPark(game, player.id, now)
  Object.assign(player, { area: 3, x: 214, y: 275 })
  interactInPark(game, player.id, now)
  assert.equal(tick(), 43)
  interactInPark(game, player.id, now)
  Object.assign(player, { x: 435, y: 273 })
  interactInPark(game, player.id, now)
  assert.equal(tick(500), 40.5)
  assert.equal(tick(500), 38)
  assert.equal(tick(), 38)
  interactInPark(game, player.id, now)
  assert.equal(tick(), 33)

  Object.assign(player, { area: 0, x: 130, y: 290 })
  interactInPark(game, player.id, now)
  assert.equal(tick(10000), 100)
  interactInPark(game, player.id, now)
  player.profile = 2
  assert.equal(tick(500, 1, true), 0)
})

test('both modes randomly spawn humans and bots in distinct playable areas', () => {
  const indices = areas.map((_, index) => index)
  for (const mode of ['last_man_standing', 'Hitman']) {
    for (const count of [1, 3, 6]) {
      for (const [draw, expectedAreas] of [[0.01, indices], [0.99, [...indices].reverse()]]) {
        const game = createParkSession(roster(count), () => draw, mode)
        const actors = [...game.players.values()]
        assert.deepEqual(actors.map(({ area }) => area), expectedAreas.slice(0, count))
        assert.equal(new Set(actors.map(({ color }) => color)).size, count)
        for (const { area, x, y } of actors) {
          assert.deepEqual(constrain(areas[area], x, y), { x, y })
        }
        if (count === 6) {
          assert.deepEqual(actors.map(({ color }) => color).sort(), [...colors].sort())
          const bot = actors.at(-1)
          const { area, x, y } = bot
          setParkInput(bot, { x: 1, y: 0, sprint: true }, 1)
          stepPark(game, 50, 51)
          assert.equal(bot.pose, 'idle')
          assert.deepEqual([bot.area, bot.x, bot.y], [area, x, y])
        }
      }
    }
  }
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
  Object.assign(player, { area: 3, x: 120, y: 274 })
  interactInPark(game, player.id, 3)
  assert.equal(player.mode, 'inspect')
  assert.equal(parkView(game, player.id, 3).spotId, 'interact-A')
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

test('the ice cream stall consumes immediately and only confirms to the nearby player', () => {
  const game = createEmptyPark(roster())
  const player = game.players.get('0')
  Object.assign(player, { x: 426, y: 311 })
  interactInPark(game, player.id, 1)
  assert.equal(parkView(game, player.id, 1).consumption, undefined)

  Object.assign(player, { y: 278, pose: 'phone-one', mode: 'action', actionStartedAt: 1 })
  interactInPark(game, player.id, 2)
  const view = parkView(game, player.id, 2)
  assert.equal(view.mode, 'free')
  assert.equal(view.actors.find(({ id }) => id === player.id).pose, 'idle')
  assert.deepEqual(view.consumption, { item: 'Ice cream', startedAt: 2 })
  assert.equal(parkView(game, '1', 2).consumption, undefined)

  interactInPark(game, player.id, 3)
  assert.equal(parkView(game, player.id, 2002).consumption.startedAt, 3)
  assert.equal(parkView(game, player.id, 2003).consumption, undefined)
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
