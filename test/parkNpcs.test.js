import assert from 'node:assert/strict'
import test from 'node:test'
import { areas, constrain } from '../shared/park.js'
import { animationDuration } from '../shared/combat.js'
import { stepParkNpcs } from '../server/parkNpcs.js'
import { createParkSession, interactInPark, parkView, stepPark } from '../server/parkSession.js'
import { attackInPark } from '../server/parkCombat.js'

test('one random eligible NPC visits food on a roll below ten percent and resumes its activity', () => {
  for (const pose of ['walk', 'talk', 'phone-one']) {
    const game = createParkSession([{ id: 'player' }], () => pose === 'phone-one' ? 0.2 : 0.5)
    const player = game.players.get('player')
    Object.assign(player, { area: 0 })
    const visitor = pose === 'walk' ? game.walkers[0].actor : [...game.npcs.values()][0]
    const partner = pose === 'talk' ? [...game.npcs.values()][1] : null
    const origin = { x: visitor.x, y: visitor.y }
    const visit = { spot: areas[0].spots[1], point: constrain(areas[0], 380, 278) }
    if (pose === 'walk') game.walkers[0].visit = visit
    const selected = [...game.npcs.values()].filter(({ area }) => area === 0).indexOf(visitor)
    const count = [...game.npcs.values()].filter(({ area }) => area === 0).length

    game.random = () => 0.1
    stepParkNpcs(game, 0, 0)
    stepParkNpcs(game, 0, 10_000)
    assert.equal(visitor.foodVisit, undefined)
    const draws = [0.099, (selected + 0.5) / count, 0]
    game.random = () => draws.shift() ?? 0.5
    stepParkNpcs(game, 0, 19_999)
    assert.equal(visitor.foodVisit, undefined)
    stepParkNpcs(game, 0, 20_000)
    assert.deepEqual([...game.npcs.values()].filter(({ foodVisit }) => foodVisit), [visitor])
    assert.equal(visitor.pose, 'walk')
    assert.equal(visitor.spotId, 'interact-A')
    if (partner) assert.match(partner.pose, /^phone-/)

    stepParkNpcs(game, 7000, 27_000)
    assert.equal(visitor.pose, 'consume')
    assert.equal(parkView(game, 'player', 27_000).actors.find(({ id }) => id === visitor.id).actionStartedAt, 27_000)
    assert.equal(parkView(game, 'player', 27_000).consumption, undefined)
    const ends = 27_000 + animationDuration(visitor.color, 'consume')
    stepParkNpcs(game, 50, ends - 1)
    assert.equal(visitor.pose, 'consume')
    stepParkNpcs(game, 50, ends)
    assert.equal(visitor.pose, 'walk')
    assert.equal(visitor.spotId, null)
    stepParkNpcs(game, 7000, ends + 7000)
    assert.equal(visitor.foodVisit, null)
    assert.equal(visitor.pose, pose)
    if (partner) assert.equal(partner.pose, 'talk')
    if (pose === 'walk') assert.equal(game.walkers[0].visit, visit)
    assert.deepEqual({ x: visitor.x, y: visitor.y }, origin)
  }
})

test('NPCs skip occupied food stores and go back if a player starts eating before they arrive', () => {
  const game = createParkSession([{ id: 'player' }], () => 0.5)
  const player = game.players.get('player')
  const visitor = [...game.npcs.values()][0]
  Object.assign(player, { area: 0, x: 427, y: 278 })
  stepParkNpcs(game, 0, 0)
  interactInPark(game, player.id, 9999)
  const draws = [0.5, 0, 0, 0]
  game.random = () => draws.shift() ?? 0.5
  stepParkNpcs(game, 0, 10_000)
  assert.equal(visitor.foodVisit, undefined)
  assert.equal(draws.length, 3)
  stepPark(game, 0, 11_500)
  stepParkNpcs(game, 0, 20_000)
  assert.equal(visitor.mode, 'food-walk')
  assert.equal(interactInPark(game, player.id, 25_999), undefined)
  stepParkNpcs(game, 6000, 26_000)
  assert.equal(visitor.mode, 'food-return')
  assert.equal(visitor.spotId, null)
  assert.equal(visitor.actionStartedAt, null)
})

test('a player death causes a synchronized scream, nearest-edge flight and staggered return in its area', () => {
  for (const [areaIndex, area] of areas.entries()) {
    const game = createParkSession([{ id: 'attacker' }, { id: 'victim' }], () => 0.5)
    const x = (area.left + area.right) / 2
    const middle = constrain(area, x, 300)
    for (const actor of game.players.values()) Object.assign(actor, { area: areaIndex }, middle)
    const locals = () => [...game.npcs.values()].filter((actor) => actor.area === areaIndex)
    const initialActorCount = locals().length
    const left = locals()[0]
    const right = locals()[1]
    const aligned = locals()[2]
    Object.assign(left, constrain(area, area.left + 12, 300), { facing: -1, mode: 'sit', pose: 'sit', seatSlot: 0 })
    Object.assign(right, constrain(area, area.right - 12, 300), { facing: 1 })
    Object.assign(aligned, middle, { facing: -1 })
    assert.equal(attackInPark(game, 'attacker', 'victim', 100), undefined)
    const panic = game.npcPanics.get(areaIndex)
    const killed = game.players.get('victim')
    const startsAt = killed.combat.endsAt + 1000
    assert.equal(panic.startsAt, startsAt)
    stepPark(game, 0, startsAt - 1)
    assert.equal(parkView(game, 'attacker', startsAt - 1).crowdReacting, false)
    assert.equal(left.pose, 'sit')
    assert.deepEqual(game.soundEvents.get(areaIndex).map(({ kind }) => kind), ['kill'])
    stepPark(game, 0, startsAt)
    const reactionSounds = () => game.soundEvents.get(areaIndex).filter(({ kind }) => kind === 'crowd-reaction')
    assert.deepEqual([...game.soundEvents.keys()], [areaIndex])
    assert.equal(reactionSounds().length, 1)
    assert.ok(reactionSounds()[0].variant >= 0 && reactionSounds()[0].variant < 1)
    assert.equal(locals().length, initialActorCount)
    assert.ok(locals().every(({ pose }) => pose === 'scream-two'))
    assert.equal(left.facing, 1)
    assert.equal(right.facing, -1)
    assert.equal(aligned.facing, -1)
    assert.equal(left.seatSlot, null)
    assert.ok([...game.npcs.values()].filter(({ area }) => area !== areaIndex).every(({ pose }) => !pose.startsWith('scream')))
    const view = parkView(game, 'attacker', startsAt)
    assert.equal(view.crowdReacting, true)
    const attacker = game.players.get('attacker')
    attacker.area = (areaIndex + 1) % areas.length
    assert.equal(parkView(game, 'attacker', startsAt).crowdReacting, false)
    attacker.area = areaIndex
    const visibleRight = view.actors.find(({ id }) => id === right.id)
    assert.equal(visibleRight.actionStartedAt, startsAt)
    assert.equal(visibleRight.facing, -1)
    assert.equal(visibleRight.oneShot, true)
    const screamsEnd = startsAt + animationDuration(left.color, left.pose)
    stepPark(game, 0, screamsEnd - 1)
    assert.equal(left.pose, 'scream-two')
    assert.equal(reactionSounds().length, 1)
    assert.equal(left.facing, 1)
    assert.equal(right.facing, -1)
    stepPark(game, 50, screamsEnd + 50)
    assert.equal(left.pose, 'sprint')
    assert.equal(right.pose, 'sprint')
    assert.equal(left.facing, -1)
    assert.equal(right.facing, 1)
    let now = screamsEnd + 50
    while (panic.returnsAt === null && now < screamsEnd + 10_000) stepPark(game, 50, now += 50)
    assert.equal(panic.returnsAt, now + 5000)
    assert.equal(locals().length, 0)
    stepPark(game, 0, panic.returnsAt - 1)
    assert.equal(locals().length, 0)
    assert.equal(parkView(game, 'attacker', panic.returnsAt - 1).crowdReacting, true)
    stepPark(game, 0, panic.returnsAt)
    assert.equal(parkView(game, 'attacker', panic.returnsAt).crowdReacting, false)
    assert.equal(locals().length, 1)
    assert.equal(locals()[0].pose, 'walk')
    assert.ok([area.left, area.right].includes(locals()[0].x))

    const capacities = new Map()
    for (let time = 50; time < 12_000; time += 50) {
      stepPark(game, 50, panic.returnsAt + time)
      const crowd = locals().filter(({ crowd }) => crowd)
      const talking = crowd.filter(({ pose }) => pose === 'talk')
      for (const npc of talking) {
        assert.ok(talking.some((other) => other !== npc && other.crowd.group === npc.crowd.group))
        capacities.set(npc.crowd.group, talking.filter((other) => other.crowd.group === npc.crowd.group).length)
      }
      assert.ok(locals().length <= initialActorCount)
    }
    assert.equal(capacities.size, area.crowds.length)
    assert.ok([...capacities.values()].every((count) => count === 2))
  }
})

test('a surviving solo crowd member uses a phone while an earlier death reaction is pending', () => {
  const game = createParkSession([{ id: 'attacker' }, { id: 'other-attacker' }], () => 0.5)
  const actor = game.players.get('attacker')
  const other = game.players.get('other-attacker')
  const [first, second] = [...game.npcs.values()]
  assert.equal(first.crowd.group, second.crowd.group)
  Object.assign(actor, { area: first.area, x: first.x, y: first.y })
  assert.equal(attackInPark(game, actor.id, first.id, 10), undefined)
  assert.match(second.pose, /^phone-/)
  const panic = game.npcPanics.get(0)
  const originalStart = panic.startsAt
  assert.equal(panic.deathX, first.x)
  stepPark(game, 0, 250)
  Object.assign(other, { area: second.area, x: second.x, y: second.y })
  assert.equal(attackInPark(game, other.id, second.id, 260), undefined)
  assert.equal(game.npcPanics.get(0).startsAt, originalStart)
  assert.equal(game.npcPanics.get(0).deathX, first.x)
})

test('every blue marker spawns up to three NPCs with distinct colors and the matching pose', () => {
  for (const [sample, size] of [[0, 1], [0.48, 2], [1 - Number.EPSILON, 3]]) {
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
          assert.equal(group[0].facing, 1)
          assert.equal(group.at(-1).facing, -1)
        }
      }
    }
    game.players.get('player').area = 5
    assert.equal(parkView(game, 'player', 0).actors.length, size * 2 + 1)
  }
})

test('three talkers face inward at the edges and vary the middle facing', () => {
  const layouts = new Set()
  for (const sample of [0, 0.25, 0.5, 0.75]) {
    const draws = [0.9, sample]
    const game = createParkSession([], () => draws.shift() ?? 0.5)
    const facings = [...game.npcs.values()].slice(0, 3)
      .sort((first, second) => first.x - second.x)
      .map(({ facing }) => facing)
    layouts.add(facings.join(','))
  }
  assert.deepEqual(layouts, new Set(['1,-1,-1', '1,1,-1']))
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

test('each walker gets one thirty-percent chance and keeps its slot for a 5–60 second dance', () => {
  const noVisit = spawnSingleWalker(3, 0.3, 0)
  assert.equal(noVisit.slot.visit, null)
  for (const [sample, duration] of [[0, 5_000], [0.5, 32_500], [1 - Number.EPSILON, 60_000]]) {
    const { game, slot } = spawnSingleWalker(3, 0.299, 0)
    const { actor } = slot
    const resumeAt = 100 + duration
    assert.equal(slot.visit.spot.name, 'Speaker C')
    Object.assign(actor, slot.visit.point)
    game.random = () => sample
    stepParkNpcs(game, 50, 100)
    assert.equal(actor.pose, 'dance')
    assert.equal(slot.resumeAt, resumeAt)
    stepParkNpcs(game, 50, resumeAt - 1)
    assert.equal(actor.pose, 'dance')
    stepParkNpcs(game, 50, resumeAt)
    assert.equal(slot.actor, actor)
    assert.equal(actor.pose, 'walk')
    assert.equal(actor.facing, 1)
  }
})

test('NPCs share player seats, recheck availability, and free them after 10–90 seconds', () => {
  const scenarios = [
    { playerFirst: true, sample: 0.5 },
    { sample: 0, duration: 10_000 },
    { sample: 0.5, duration: 50_000 },
    { sample: 1 - Number.EPSILON, duration: 90_000 },
  ]
  for (const { playerFirst, sample, duration } of scenarios) {
    const { game, slot } = spawnSingleWalker(2, 0.01, 0.3)
    const player = game.players.get('player')
    const { actor, visit } = slot
    assert.equal(visit.spot.name, 'Left Middle Bench')
    Object.assign(player, visit.point, { area: 2 })
    if (playerFirst) interactInPark(game, 'player', 1)
    Object.assign(actor, visit.point)
    game.random = () => sample
    stepParkNpcs(game, 50, 100)
    assert.equal(slot.visit, null)

    if (playerFirst) {
      assert.equal(actor.pose, 'walk')
      assert.equal(slot.resumeAt, null)
    } else {
      const resumeAt = 100 + duration
      assert.equal(actor.pose, 'sit')
      assert.equal(slot.resumeAt, resumeAt)
      assert.equal(interactInPark(game, 'player', 101), 'Left Middle Bench is full.')
      stepParkNpcs(game, 50, resumeAt - 1)
      assert.equal(slot.actor, actor)
      assert.equal(actor.pose, 'sit')
      stepParkNpcs(game, 50, resumeAt)
      assert.equal(actor.pose, 'walk')
      assert.equal(interactInPark(game, 'player', resumeAt + 1), undefined)
      assert.equal(player.pose, 'sit')
    }
  }
})
