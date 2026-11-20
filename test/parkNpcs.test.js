import assert from 'node:assert/strict'
import test from 'node:test'
import { areas, constrain } from '../shared/park.js'
import { stepParkNpcs } from '../server/parkNpcs.js'
import { createParkSession, interactInPark, parkView } from '../server/parkSession.js'

test('every blue marker gets its own crowd with distinct colors and the matching pose', () => {
  for (const [sample, size] of [[0, 1], [0.48, 2], [0.95, 3]]) {
    const game = createParkSession([{ id: 'player' }], () => sample)
    const crowd = [...game.npcs.values()].filter(({ pose }) => pose !== 'walk')
    assert.equal(crowd.length, size * 21)

    for (const [areaIndex, area] of areas.entries()) {
      for (const [left, top, width, height] of area.crowds) {
        const group = crowd.filter((actor) => actor.area === areaIndex && actor.x >= left
          && actor.x <= left + width && actor.y >= top && actor.y <= top + height)
          .sort((first, second) => first.x - second.x)
        assert.equal(group.length, size)
        assert.equal(new Set(group.map(({ color }) => color)).size, size)
        if (size === 1) assert.match(group[0].pose, /^phone-/)
        else {
          assert.ok(group.every(({ pose }) => pose === 'talk'))
          assert.equal(new Set(group.map(({ animationOffset }) => animationOffset)).size, size)
          assert.ok(group.some(({ facing }, index) => facing === 1 && group[index + 1]?.facing === -1))
        }
      }
    }
    game.players.get('player').area = 5
    assert.equal(parkView(game, 'player', 0).actors.length, size * 2 + 1)
  }
})

test('three talkers vary their facing while keeping a face-to-face pair', () => {
  const layouts = new Set()
  for (const sample of [0, 0.25, 0.5, 0.75]) {
    const draws = [0.9, sample]
    const game = createParkSession([], () => draws.shift() ?? 0.5)
    const facings = [...game.npcs.values()].slice(0, 3)
      .sort((first, second) => first.x - second.x)
      .map(({ facing }) => facing)
    assert.ok(facings.some((facing, index) => facing === 1 && facings[index + 1] === -1))
    layouts.add(facings.join(','))
  }
  assert.equal(layouts.size, 4)
})

test('walkers enter from both sides and each slot switches sides after its delay', () => {
  const game = createParkSession([], () => 0.5)
  for (const [index, area] of areas.entries()) {
    const slots = game.walkers.filter(({ area }) => area === index)
    assert.equal(slots.length, area.walkingNpcs)
    if (slots.length > 1) assert.deepEqual(new Set(slots.map(({ direction }) => direction)), new Set([-1, 1]))
    for (const { actor: { x, y, facing }, direction } of slots) {
      assert.equal(facing, direction)
      assert.equal(x, direction > 0 ? area.left : area.right)
      assert.deepEqual(constrain(area, x, y), { x, y })
    }
  }
  const slot = game.walkers[0]
  const actor = slot.actor
  actor.x = areas[0].right - 1
  stepParkNpcs(game, 50, 100)
  assert.equal(slot.actor, null)
  assert.equal(game.npcs.has(actor.id), false)
  assert.equal(slot.respawnAt, 7600)
  stepParkNpcs(game, 50, 7599)
  assert.equal(slot.actor, null)
  stepParkNpcs(game, 50, 7600)
  assert.notEqual(slot.actor.id, actor.id)
  assert.equal(slot.actor.area, 0)
  assert.equal(slot.actor.pose, 'walk')
  assert.equal(slot.actor.x, areas[0].right)
  assert.equal(slot.actor.facing, -1)
  stepParkNpcs(game, 50, 7650)
  assert.ok(slot.actor.x < areas[0].right)
})

function spawnSingleWalker(area, roll, selection) {
  const game = createParkSession([{ id: 'player' }], () => 0.5)
  const slot = game.walkers.find((slot) => slot.area === area)
  slot.direction = -1
  game.walkers = [slot]
  game.npcs.delete(slot.actor.id)
  slot.actor = null
  slot.respawnAt = 0
  const draws = [0.5, 0.5, roll, selection]
  game.random = () => draws.shift() ?? 0.5
  stepParkNpcs(game, 50, 0)
  return { game, slot }
}

test('each walker gets one ten-percent chance and keeps its slot during a dance', () => {
  const noVisit = spawnSingleWalker(3, 0.1, 0)
  assert.equal(noVisit.slot.visit, null)
  const { game, slot } = spawnSingleWalker(3, 0.099, 0)
  const { actor } = slot
  assert.equal(slot.visit.spot.name, 'Speaker C')
  Object.assign(actor, slot.visit.point)
  stepParkNpcs(game, 50, 100)
  assert.equal(actor.pose, 'dance')
  assert.equal(slot.resumeAt, 15100)
  stepParkNpcs(game, 50, 15099)
  assert.equal(slot.actor, actor)
  assert.equal(actor.pose, 'dance')
  stepParkNpcs(game, 50, 15100)
  assert.equal(slot.actor, actor)
  assert.equal(actor.pose, 'walk')
  assert.equal(actor.facing, 1)
})

test('NPCs share player seats, recheck upon arrival, and free them after a timed rest', () => {
  for (const playerFirst of [true, false]) {
    const { game, slot } = spawnSingleWalker(2, 0.01, 0.3)
    const player = game.players.get('player')
    const { actor, visit } = slot
    assert.equal(visit.spot.name, 'Bench B')
    Object.assign(player, visit.point, { area: 2 })
    if (playerFirst) interactInPark(game, 'player', 1)
    Object.assign(actor, visit.point)
    stepParkNpcs(game, 50, 100)
    assert.equal(slot.visit, null)

    if (playerFirst) {
      assert.equal(actor.pose, 'walk')
      assert.equal(slot.resumeAt, null)
    } else {
      assert.equal(actor.pose, 'sit')
      assert.equal(slot.resumeAt, 45100)
      assert.equal(interactInPark(game, 'player', 101), 'Bench B is full.')
      stepParkNpcs(game, 50, 45099)
      assert.equal(slot.actor, actor)
      assert.equal(actor.pose, 'sit')
      stepParkNpcs(game, 50, 45100)
      assert.equal(actor.pose, 'walk')
      assert.equal(interactInPark(game, 'player', 45101), undefined)
      assert.equal(player.pose, 'sit')
    }
  }
})
