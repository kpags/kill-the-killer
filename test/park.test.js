import assert from 'node:assert/strict'
import test from 'node:test'
import { areas, colors, constrain, hidingPose, standingHeight } from '../shared/park.js'
import { animationDuration, blowgunFlightMs, blowgunItem, blowgunWindupMs, rockFlightMs, rockItem, rockWindupMs } from '../shared/combat.js'
import { createParkSession, interactInPark, lockFiringRangeInPark, parkView, setParkInput,
  shootBasketballInPark, stepPark } from '../server/parkSession.js'
import { simulateBasketballShot } from '../shared/basketball.js'
import { rangeCenter, rangeCoordinate, rangePoints, rangeResultMs, rangeRings, rangeShotDelayMs,
  rangeSweepMax, rangeSweepMin } from '../shared/firingRange.js'
import { attackInPark, equipParkItem } from '../server/parkCombat.js'
import { useSmokeInPark } from '../server/parkSmoke.js'
import { smokeItem } from '../shared/smoke.js'

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

test('the faster basketball shot counts clean makes, rim makes, and misses', () => {
  const clean = simulateBasketballShot({ x: 240, y: 260, vx: 0, vy: -600 })
  assert.equal(clean.points, 2)
  assert.ok(Math.abs(clean.duration * 2.1 - 2175) < 1)
  assert.equal(simulateBasketballShot({ x: 240, y: 265, vx: 8, vy: -560 }).points, 1)
  assert.equal(simulateBasketballShot({ x: 240, y: 265, vx: 22, vy: -560 }).points, 0)
  assert.equal(simulateBasketballShot({ x: 240, y: 290, vx: 0, vy: -170 }).points, 0)
  assert.equal(simulateBasketballShot({ x: 240, y: 260, vx: 350, vy: -600 }).points, 0)
  assert.equal(simulateBasketballShot({ x: 240, y: 260, vx: '0', vy: -600 }), null)
})

test('basketball shares the high score and keeps the record holder until their score is beaten', () => {
  const game = createEmptyPark([{ id: '0', name: 'Player 1' }, { id: '1', name: 'Player 2' }])
  const launch = { x: 240, y: 260, vx: 0, vy: -600 }
  const { scoreAt, duration } = simulateBasketballShot(launch)
  const record = (id, now) => parkView(game, id, now).basketball.record
  for (const actor of game.players.values()) Object.assign(actor, { area: 3, x: 110, y: 272 })
  assert.match(shootBasketballInPark(game, '0', launch, 0), /Open Basketball/)
  interactInPark(game, '0', 0)
  interactInPark(game, '1', 0)
  assert.deepEqual(record('1', 0), { name: 'Nobody', score: 0 })
  assert.equal(shootBasketballInPark(game, '0', launch, 0), undefined)
  assert.match(shootBasketballInPark(game, '0', launch, 50), /Wait for the ball/)
  stepPark(game, 50, scoreAt - 1)
  assert.deepEqual(record('1', scoreAt - 1), { name: 'Nobody', score: 0 })
  stepPark(game, 1, scoreAt)
  assert.deepEqual(record('1', scoreAt), { name: 'Player 1', score: 2 })
  assert.equal(parkView(game, '1', scoreAt).basketball.score, 0)
  interactInPark(game, '0', duration)
  assert.equal(parkView(game, '0', duration).basketball, undefined)

  assert.equal(shootBasketballInPark(game, '1', launch, duration), undefined)
  stepPark(game, 50, duration + scoreAt)
  assert.deepEqual(record('1', duration + scoreAt), { name: 'Player 1', score: 2 })
  assert.equal(shootBasketballInPark(game, '1', launch, duration * 2), undefined)
  stepPark(game, 50, duration * 2 + scoreAt)
  interactInPark(game, '0', duration * 3)
  assert.deepEqual(record('0', duration * 3), { name: 'Player 2', score: 4 })
  assert.equal(parkView(game, '0', duration * 3).basketball.score, 0)
})

test('basketball closes on a lethal hit, punch stun, rock stun, poison impact, or smoke exposure', () => {
  const effects = [
    { item: 'fist', target: true, pose: 'death', delay: 0 },
    { item: 'fist', target: false, pose: 'pre-stun', delay: 0 },
    { item: rockItem, target: true, pose: 'stun', delay: rockWindupMs + rockFlightMs },
    { item: blowgunItem, target: true, pose: 'idle', delay: blowgunWindupMs + blowgunFlightMs },
    { item: smokeItem, target: true, pose: 'idle', delay: 50 },
  ]
  for (const { item, target, pose, delay } of effects) {
    const game = createEmptyPark(roster(3))
    const [attacker, player, other] = game.players.values()
    game.targetOrder = [attacker.id, ...(target ? [player.id, other.id] : [other.id, player.id])]
    Object.assign(attacker, { area: 3, x: 100, y: 272 })
    Object.assign(player, { area: 3, x: 110, y: 272 })
    const launch = { x: 240, y: 260, vx: 0, vy: -600 }
    assert.equal(interactInPark(game, player.id, 0), undefined)
    assert.equal(shootBasketballInPark(game, player.id, launch, 10), undefined)
    assert.equal(equipParkItem(game, attacker.id, item), undefined)
    const result = item === smokeItem ? useSmokeInPark(game, attacker.id, 20)
      : attackInPark(game, attacker.id, player.id, 20, item)
    assert.equal(result, undefined)
    const hitAt = 20 + delay
    stepPark(game, 50, hitAt)
    assert.equal(player.pose, pose)
    assert.equal(parkView(game, player.id, hitAt).basketball, undefined)
    assert.equal(player.basketball, null)
    assert.match(shootBasketballInPark(game, player.id, launch, hitAt), /Open Basketball/)
    if (item === smokeItem || item === blowgunItem) {
      assert.match(interactInPark(game, player.id, hitAt), /Wait for the effect to clear/)
    }
    assert.equal(game.basketballRecords.size, 0)
  }
})

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
          setParkInput(bot, { x: 1, y: 0, sprint: true }, 1)
          assert.equal(bot.input.x, 0)
          assert.equal(bot.input.sprint, false)
        }
      }
    }
  }
})

test('movement follows area edges in order and leaves idle players behind', () => {
  const game = createEmptyPark(roster(3).map((player) => ({ ...player, isBot: false })))
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

test('players sprint at 181.5 map pixels per second, drain stamina for five seconds, and recover in three-second steps', () => {
  const game = createEmptyPark(roster())
  const player = game.players.get('0')
  const startX = player.x
  setParkInput(player, { x: 1, y: 0, sprint: true }, 50)
  stepPark(game, 50, 50)
  assert.ok(Math.abs(player.x - startX - 181.5 * 0.05) < 0.0001)
  for (let now = 100; now <= 5000; now += 50) {
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

test('firing range clicks lock each axis, count up to five shots and share the match record', () => {
  assert.deepEqual(rangeRings.map(({ radius }) => rangePoints(rangeCenter + radius, rangeCenter)), [25, 15, 12, 10, 8, 5])
  assert.equal(rangePoints(rangeSweepMin, rangeSweepMin), 0)
  assert.equal(rangeCoordinate('x', 0, 1050), rangeSweepMax)
  assert.equal(rangeCoordinate('y', 0, 2700), rangeSweepMin)
  const game = createEmptyPark([{ id: '0', name: 'Player 1' }, { id: '1', name: 'Player 2' }])
  const [player, viewer] = game.players.values()
  for (const actor of [player, viewer]) Object.assign(actor, { area: 3, x: 300, y: 274 })
  assert.match(lockFiringRangeInPark(game, player.id, 0), /Open the Firing Range/)
  assert.equal(interactInPark(game, player.id, 0), undefined)
  assert.deepEqual(parkView(game, player.id, 0).firingRange.record, { name: 'Nobody', score: 0 })
  assert.equal(parkView(game, viewer.id, 0).firingRange, undefined)
  for (let shot = 1; shot <= 5; shot++) {
    const start = player.firingRange.scanAt
    assert.equal(lockFiringRangeInPark(game, player.id, start + 595, start + 525), undefined)
    assert.equal(player.firingRange.lockedX, rangeCenter)
    assert.equal(player.firingRange.attempts, shot - 1)
    assert.equal(player.firingRange.yScanAt, start + 595)
    const lockedAt = player.firingRange.yScanAt + 745
    assert.equal(lockFiringRangeInPark(game, player.id, lockedAt, lockedAt - 70), undefined)
    const impactAt = lockedAt + rangeShotDelayMs
    assert.deepEqual(player.firingRange.lastShot, { x: rangeCenter, y: rangeCenter, impactAt })
    stepPark(game, 0, impactAt - 1)
    assert.equal(player.firingRange.attempts, shot - 1)
    assert.equal(player.firingRange.score, (shot - 1) * 25)
    assert.match(lockFiringRangeInPark(game, player.id, impactAt - 1), /Wait for the next attempt/)
    stepPark(game, 0, impactAt)
    assert.equal(player.firingRange.lastShot.points, 25)
    assert.equal(player.firingRange.attempts, shot)
    assert.equal(player.firingRange.score, shot * 25)
    assert.equal(player.firingRange.scanAt, impactAt + rangeResultMs)
    if (shot < 5) assert.match(lockFiringRangeInPark(game, player.id, player.firingRange.scanAt - 1), /Wait for the next attempt/)
  }
  assert.match(lockFiringRangeInPark(game, player.id, player.firingRange.scanAt), /five attempts/)
  assert.equal(interactInPark(game, viewer.id, player.firingRange.scanAt), undefined)
  const best = { name: 'Player 1', score: 125 }
  assert.deepEqual(parkView(game, viewer.id, player.firingRange.scanAt).firingRange.record, best)
  const finishedAt = player.firingRange.scanAt
  assert.equal(interactInPark(game, player.id, finishedAt), undefined)
  assert.equal(parkView(game, player.id, finishedAt).firingRange, undefined)
  assert.equal(interactInPark(game, player.id, finishedAt + 50), undefined)
  assert.equal(player.firingRange.attempts, 0)
  assert.deepEqual(parkView(game, player.id, finishedAt + 50).firingRange.record, best)
  assert.equal(game.basketballRecords.size, 0)
})

test('authored spots provide seating, dancing, a firing range, and a timed private hide', () => {
  const game = createEmptyPark(roster())
  const player = game.players.get('0')
  const other = game.players.get('1')
  interactInPark(game, player.id, 1)
  assert.equal(player.mode, 'sit')
  interactInPark(game, player.id, 2)
  assert.equal(player.pose, 'idle')
  Object.assign(player, { area: 3, x: 300, y: 274 })
  interactInPark(game, player.id, 3)
  assert.equal(player.mode, 'firing-range')
  assert.equal(parkView(game, player.id, 3).spotId, 'interact-B')
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

test('food and drinks restore 10 stamina once per interaction and play shared consumption animations', () => {
  for (const [area, x, y, item, pose] of [
    [0, 426, 278, 'Ice cream', 'consume'],
    [1, 380, 290, 'Cotton Candy', 'consume'],
    [1, 510, 290, 'Takoyaki', 'consume'],
    [1, 639, 290, 'Drink', 'drink'],
  ]) {
    const game = createEmptyPark(roster())
    const [player, observer] = game.players.values()
    Object.assign(observer, { area })
    Object.assign(player, { area, x, y: y + 30, stamina: 65 })
    interactInPark(game, player.id, 1)
    assert.equal(parkView(game, player.id, 1).consumption, undefined)
    assert.equal(player.stamina, 65)

    Object.assign(player, { y, pose: 'phone-one', mode: 'action', actionStartedAt: 1 })
    interactInPark(game, player.id, 2)
    const own = parkView(game, player.id, 2)
    assert.equal(own.mode, 'consume')
    assert.deepEqual(own.consumption, { item, startedAt: 2 })
    assert.equal(own.stamina, 75)
    const other = parkView(game, observer.id, 2)
    const visible = other.actors.find(({ id }) => id === player.id)
    assert.equal(visible.pose, pose)
    assert.equal(visible.actionStartedAt, 2)
    assert.equal(other.consumption, undefined)

    assert.match(interactInPark(game, player.id, 3), /cannot interact/)
    assert.equal(player.stamina, 75)
    setParkInput(player, { x: 1, y: 0, sprint: true }, 4)
    const end = 2 + animationDuration(player.color, pose)
    stepPark(game, 50, end - 1)
    assert.equal(player.pose, pose)
    stepPark(game, 50, end)
    assert.equal(player.mode, 'free')
    assert.equal(player.pose, 'idle')
    assert.equal(player.x, x)
    assert.equal(parkView(game, player.id, 2001).consumption.startedAt, 2)
    assert.equal(parkView(game, player.id, 2002).consumption, undefined)
    player.stamina = 95
    assert.equal(interactInPark(game, player.id, 2002), undefined)
    assert.equal(parkView(game, player.id, 2002).stamina, 100)
  }
  assert.deepEqual(colors.map((color) => animationDuration(color, 'consume')), Array(colors.length).fill(1350))
  assert.deepEqual(colors.map((color) => animationDuration(color, 'drink')), Array(colors.length).fill(720))
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
  assert.equal(interactInPark(game, third.id, 3), 'Left Bench is full.')
  assert.equal(third.mode, 'free')

  interactInPark(game, first.id, 4)
  assert.equal(first.seatSlot, null)
  assert.deepEqual(constrain(areas[0], first.x, first.y), { x: first.x, y: first.y })
  interactInPark(game, third.id, 5)
  assert.equal(third.seatSlot, 0)
})

test('one-seat chairs and legacy picnic tables only seat one occupant', () => {
  for (const [area, x, y, bottom, name] of [
    [2, 167, 250, 218, 'Left Middle Bench'],
    [4, 90, 289, 247, 'Left Picnic Table'],
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
