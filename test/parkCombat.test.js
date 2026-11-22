import assert from 'node:assert/strict'
import test from 'node:test'
import { areas, colors, constrain } from '../shared/park.js'
import { animationDuration, deathOpacity, killFlashMs } from '../shared/combat.js'
import { profileFill } from '../shared/profile.js'
import { createParkSession, interactInPark, parkView, playParkAction, setParkInput, stepPark } from '../server/parkSession.js'
import { advanceParkCombat, attackInPark, refreshParkTargets, spectateInPark } from '../server/parkCombat.js'

const deathDuration = 450 / 1.3
const corpseDuration = deathDuration + 2000

function emptyGame(mode = 'last_man_standing', count = 4) {
  const game = createParkSession(Array.from({ length: count }, (_, index) => ({
    id: String(index), name: `Player ${index + 1}`, isBot: false,
  })), () => 0.5, mode)
  game.npcs.clear()
  game.walkers.length = 0
  game.targetOrder = [...game.players.keys()]
  game.targets = new Map(game.targetOrder.map((id, index, ids) => [id, ids[(index + 1) % ids.length]]))
  for (const actor of game.players.values()) Object.assign(actor, { x: 200, y: 290 })
  refreshParkTargets(game, true)
  return game
}

test('combat validates identity, visibility, area and an exact unscaled 20-pixel ground distance', () => {
  for (const area of areas.keys()) {
    const game = emptyGame()
    const attacker = game.players.get('0')
    const victim = game.players.get('1')
    Object.assign(attacker, { area, x: 200, y: 290 })
    Object.assign(victim, { area, x: 212.001, y: 306 })
    assert.match(attackInPark(game, '0', '1', 0), /20 pixels/)
    for (const id of [null, {}, 1, 'missing', '0']) assert.match(attackInPark(game, '0', id, 0), /unavailable/)
    victim.area = (area + 1) % areas.length
    assert.match(attackInPark(game, '0', '1', 0), /unavailable/)
    victim.area = area
    victim.mode = 'hide'
    assert.match(attackInPark(game, '0', '1', 0), /unavailable/)
    victim.mode = 'free'
    victim.x = 212
    assert.equal(attackInPark(game, '0', '1', 0), undefined)
    assert.equal(victim.life, 'dying')
  }
})

test('every color has one-shot combat timing, a complete death, and a separate two-second fade', () => {
  const killDuration = 270 / 1.3
  const deathEndsAt = 1000 + deathDuration
  const vanishesAt = deathEndsAt + 2000
  for (const [index, color] of colors.entries()) {
    const game = emptyGame()
    const attacker = game.players.get('0')
    const victim = game.players.get('1')
    attacker.color = color
    victim.color = colors[(index + 1) % colors.length]
    assert.equal(animationDuration(color, 'kill'), killDuration)
    assert.equal(animationDuration(color, 'death'), deathDuration)
    assert.equal(animationDuration(color, 'punch'), 450)
    assert.equal(animationDuration(color, 'pre-stun'), 450)
    assert.equal(animationDuration(color, 'stun'), 540)
    Object.assign(victim, { mode: 'sit', pose: 'sit', spotId: 'interact-C', seatSlot: 0 })
    assert.equal(attackInPark(game, '0', '1', 1000), undefined)
    assert.equal(attacker.pose, 'kill')
    assert.equal(attacker.combat.endsAt, 1000 + killDuration)
    assert.equal(parkView(game, '0', 1000).killFlashAt, 1000)
    assert.equal(parkView(game, '1', 1000).killFlashAt, undefined)
    assert.equal(parkView(game, '0', 1000 + killFlashMs).killFlashAt, undefined)
    assert.equal(victim.pose, 'death')
    assert.equal(victim.combat.endsAt, deathEndsAt)
    assert.equal(victim.vanishesAt, vanishesAt)
    assert.equal(victim.spotId, null)
    assert.equal(victim.seatSlot, null)
    assert.equal(attacker.profile, 0)
    assert.equal(attacker.stamina, 100)
    assert.equal(game.targets.get('0'), '2')
    assert.match(attackInPark(game, '0', '2', 1001), /current action/)
    assert.match(attackInPark(game, '1', '0', 1001), /cannot attack/)
    assert.match(interactInPark(game, '1', 1001), /cannot interact/)
    setParkInput(victim, { x: 1, y: 0, sprint: true }, 1001)
    assert.equal(victim.input.x, 0)
    advanceParkCombat(game, 1000 + killDuration - 1)
    assert.equal(attacker.pose, 'kill')
    advanceParkCombat(game, 1000 + killDuration)
    assert.equal(attacker.pose, 'idle')
    advanceParkCombat(game, deathEndsAt)
    assert.equal(victim.pose, 'death')
    assert.equal(deathOpacity(victim, deathEndsAt), 1)
    assert.equal(deathOpacity(victim, deathEndsAt + 1000), 0.5)
    assert.equal(parkView(game, '0', vanishesAt - 1).actors.some(({ id }) => id === '1'), true)
    assert.equal(parkView(game, '0', vanishesAt).actors.some(({ id }) => id === '1'), false)
    advanceParkCombat(game, vanishesAt)
    assert.equal(victim.life, 'eliminated')
    assert.equal(parkView(game, '1', vanishesAt).spectating, true)
  }
})

test('NPCs and players retain their facing through death and fade', () => {
  for (const kind of ['player', 'npc']) {
    for (const facing of [-1, 1]) {
      const game = emptyGame()
      const attacker = game.players.get('0')
      const victim = kind === 'player'
        ? game.players.get('1')
        : { id: 'npc', area: attacker.area, y: attacker.y, color: 'red', pose: 'walk' }
      if (kind === 'npc') game.npcs.set(victim.id, victim)
      Object.assign(victim, { x: attacker.x + 8 * facing, facing })
      assert.equal(attackInPark(game, attacker.id, victim.id, 0), undefined)
      assert.equal(attacker.facing, facing)
      for (const time of [0, deathDuration, corpseDuration - 1]) {
        advanceParkCombat(game, time)
        const corpse = parkView(game, attacker.id, time).actors.find(({ id }) => id === victim.id)
        assert.equal(corpse.pose, 'death')
        assert.equal(corpse.facing, facing)
      }
    }
  }
})

test('a seated NPC or unassigned player can be killed from a walkable position and frees the seat', () => {
  for (const kind of ['npc', 'player']) {
    const game = emptyGame()
    const attacker = game.players.get('0')
    const player = game.players.get('2')
    Object.assign(attacker, { area: 2, x: 167, y: 270 })
    Object.assign(player, { area: 2, x: 167, y: 250 })
    interactInPark(game, player.id, 0)
    assert.equal(player.pose, 'sit')
    assert.ok(Math.hypot(player.x - attacker.x, player.y - attacker.y) > 20)
    const victim = kind === 'player' ? player : { ...player, id: 'seated-npc' }
    if (kind === 'npc') {
      game.players.delete(player.id)
      game.npcs.set(victim.id, victim)
    }
    assert.notEqual(game.targets.get(attacker.id), victim.id)
    assert.match(attackInPark(game, attacker.id, victim.id, 1), /20 pixels/)
    attacker.y = 265
    assert.equal(attackInPark(game, attacker.id, victim.id, 2), undefined)
    assert.equal(victim.pose, 'death')
    assert.equal(parkView(game, attacker.id, 2).killFlashAt, kind === 'npc' ? 2 : undefined)
    assert.equal(victim.seatSlot, null)
    const replacement = game.players.get('3')
    Object.assign(replacement, { area: 2, x: 167, y: 250 })
    interactInPark(game, replacement.id, 3)
    assert.equal(replacement.mode, 'sit')
  }
})

test('a mutual target is killed and the winner is shown only after the death fade', () => {
  const game = emptyGame('last_man_standing', 2)
  assert.equal(game.winner, null)
  assert.equal(attackInPark(game, '0', '1', 0), undefined)
  assert.equal(game.players.get('0').pose, 'kill')
  assert.equal(parkView(game, '0', 0).matchEnded, true)
  assert.equal(parkView(game, '0', corpseDuration - 1).winner, null)
  assert.equal(parkView(game, '0', corpseDuration).winner.id, '0')
  assert.match(attackInPark(game, '0', '1', 1), /match has ended/)
  stepPark(game, 50, 500)
  setParkInput(game.players.get('0'), { x: 1, y: 0, sprint: false }, 501)
  stepPark(game, 50, 551)
  assert.equal(game.players.get('0').x, 200)
  assert.equal(emptyGame('last_man_standing', 1).winner, null)
})

test('killer stuns last three seconds after pre-stun and reassign only in Hitman', () => {
  for (const mode of ['last_man_standing', 'Hitman']) {
    const game = emptyGame(mode)
    const victim = game.players.get('3')
    const attacker = game.players.get('0')
    attacker.profile = 16
    victim.profile = 80
    const targets = new Map(game.targets)
    assert.equal(attackInPark(game, '0', '3', 100), undefined)
    assert.equal(game.players.get('0').pose, 'punch')
    assert.equal(victim.pose, 'pre-stun')
    assert.equal(victim.combat.endsAt, 550)
    assert.equal(attacker.profile, 6)
    assert.equal(attacker.score, 0)
    if (mode === 'Hitman') {
      assert.notEqual(game.targets.get('3'), '0')
      assert.equal(victim.profile, 0)
    } else {
      assert.deepEqual(game.targets, targets)
      assert.equal(victim.profile, 80)
    }
    assert.match(interactInPark(game, '3', 549), /cannot interact/)
    advanceParkCombat(game, 549)
    assert.equal(victim.pose, 'pre-stun')
    advanceParkCombat(game, 550)
    assert.equal(victim.pose, 'stun')
    assert.deepEqual(victim.combat, { startedAt: 550, endsAt: 3550 })
    assert.match(attackInPark(game, '0', '3', 600), /already reacting/)
    advanceParkCombat(game, 3549)
    assert.equal(victim.pose, 'stun')
    advanceParkCombat(game, 3550)
    assert.equal(victim.pose, 'idle')
    assert.equal(victim.mode, 'free')
  }
})

test('Hitman scores the pre-kill Profile, then resets it for the new target', () => {
  for (const [profile, rating, points] of [
    [32.999999, 'Warfreak', 50], [33, 'Brawler', 100], [65.999999, 'Brawler', 100],
    [66, 'Secret Agent', 200], [98.999999, 'Secret Agent', 200], [99, 'Hitman', 300],
    [99.999999, 'Hitman', 300], [100, 'Assassin', 400],
  ]) {
    const game = emptyGame('Hitman')
    const attacker = game.players.get('0')
    Object.assign(attacker, { profile, score: 100 })
    assert.equal(attackInPark(game, '0', '1', 10), undefined)
    const own = parkView(game, '0', 10)
    assert.equal(own.score, 100 + points)
    assert.deepEqual(own.killAward, { rating, points, until: 2510 })
    assert.equal(own.profile, 0)
    assert.equal(parkView(game, '1', 10).score, 0)
    assert.equal(parkView(game, '1', 10).killAward, undefined)
    assert.equal(parkView(game, '0', 2510).killAward, undefined)
  }
  assert.deepEqual([0, 1, 2].map((index) => profileFill(33, index)), [1, 0, 0])
  assert.deepEqual([0, 1, 2].map((index) => profileFill(66, index)), [1, 1, 0])
  assert.ok(profileFill(98.99, 2) < 1)
  assert.equal(profileFill(99, 2), 1)
})

test('NPC kills deduct Profile without awarding points and preserve the hiding exit deduction', () => {
  const game = emptyGame('Hitman')
  const actor = game.players.get('0')
  const npc = { id: 'npc', area: 3, x: 438, y: 273, color: 'purple', pose: 'walk' }
  const target = game.targets.get('0')
  Object.assign(actor, { area: 3, x: 435, y: 273, profile: 50 })
  game.npcs.set(npc.id, npc)
  interactInPark(game, '0', 0)
  stepPark(game, 1000, 1000)
  assert.equal(actor.profile, 45)
  assert.equal(attackInPark(game, '0', npc.id, 1000), undefined)
  assert.equal(actor.profile, 25)
  assert.equal(actor.score, 0)
  assert.equal(game.targets.get('0'), target)
  stepPark(game, 200, 1200)
  assert.equal(actor.profile, 24)
  stepPark(game, 800, 2000)
  assert.equal(actor.profile, 20)
})

test('unrelated punches preserve targets, interrupt activities and finish after pre-stun only', () => {
  for (const mode of ['last_man_standing', 'Hitman']) {
    for (const activity of ['free', 'action', 'dance', 'inspect']) {
      const game = emptyGame(mode)
      const attacker = game.players.get('0')
      const victim = game.players.get('2')
      const targets = new Map(game.targets)
      attacker.mode = 'hide'
      attacker.spotId = 'hide-A'
      Object.assign(victim, { mode: activity, spotId: 'interact-B', seatSlot: 0, profile: 80 })
      assert.equal(attackInPark(game, '0', '2', 0), undefined)
      assert.equal(attacker.mode, 'combat')
      assert.equal(attacker.spotId, null)
      assert.equal(victim.pose, 'pre-stun')
      assert.equal(parkView(game, attacker.id, 0).killFlashAt, undefined)
      assert.deepEqual(game.targets, targets)
      assert.equal(victim.profile, 80)
      assert.equal(victim.spotId, null)
      assert.equal(victim.seatSlot, null)
      advanceParkCombat(game, 450)
      assert.equal(victim.pose, 'idle')
      assert.equal(victim.mode, 'free')
      assert.deepEqual(game.targets, targets)
    }
  }
})

test('a lethal attack can interrupt a stun without extending it through repeat punches', () => {
  const game = emptyGame()
  attackInPark(game, '0', '3', 0)
  advanceParkCombat(game, 450)
  assert.equal(game.players.get('3').pose, 'stun')
  assert.equal(attackInPark(game, '2', '3', 500), undefined)
  assert.equal(game.players.get('3').pose, 'death')
  assert.equal(game.players.get('3').life, 'dying')
})

test('action clips replace activities and stop when interacting or killed', () => {
  const game = emptyGame()
  const actor = game.players.get('0')
  const victim = game.players.get('1')
  Object.assign(actor, { x: 130, y: 290 })
  interactInPark(game, actor.id, 0)
  assert.equal(actor.mode, 'sit')
  const rolls = [0, 0.5, 0.99]
  game.random = () => rolls.shift()
  assert.equal(playParkAction(game, actor.id, 'phone', 1), undefined)
  assert.equal(actor.pose, 'phone-one')
  assert.equal(actor.seatSlot, null)
  assert.deepEqual({ x: actor.x, y: actor.y }, constrain(areas[0], actor.x, actor.y))
  assert.equal(playParkAction(game, actor.id, 'talk', 2), undefined)
  assert.equal(actor.pose, 'talk-two')
  interactInPark(game, actor.id, 3)
  assert.equal(actor.mode, 'sit')
  assert.equal(actor.actionStartedAt, null)

  Object.assign(victim, { x: 130, y: 275 })
  assert.equal(playParkAction(game, victim.id, 'dance', 4), undefined)
  assert.equal(victim.pose, 'dance-three')
  assert.equal(attackInPark(game, actor.id, victim.id, 5), undefined)
  assert.equal(victim.pose, 'death')
  assert.equal(victim.actionStartedAt, null)
  assert.match(playParkAction(game, victim.id, 'phone', 6), /cannot perform/)
  assert.match(playParkAction(game, actor.id, 'phone', 6), /cannot perform/)
})

test('Hitman respawns five seconds after a kill in a random green-boundary position', () => {
  for (const [areaIndex, area] of areas.entries()) {
    const game = emptyGame('Hitman')
    const victim = game.players.get('1')
    attackInPark(game, '0', '1', 1000)
    assert.equal(game.winner, null)
    assert.equal(parkView(game, '1', 1000).respawnMs, 5000)
    advanceParkCombat(game, 3450)
    assert.equal(victim.life, 'respawning')
    assert.equal(parkView(game, '1', 3450).spectating, false)
    assert.equal(parkView(game, '0', 3450).actors.some(({ id }) => id === '1'), false)
    advanceParkCombat(game, 5999)
    assert.equal(victim.life, 'respawning')
    const draws = [(areaIndex + 0.1) / areas.length, 0.5, 0.5]
    game.random = () => draws.shift() ?? 0.5
    stepPark(game, 50, 6000)
    assert.equal(victim.life, 'alive')
    assert.equal(victim.area, areaIndex)
    assert.deepEqual({ x: victim.x, y: victim.y }, constrain(area, victim.x, victim.y))
    assert.equal(victim.pose, 'idle')
    assert.equal(victim.stamina, 100)
    assert.equal(victim.profile, 33)
    assert.equal(victim.generation, 1)
    assert.ok(game.targets.get('1'))
    assert.notEqual(game.targets.get('1'), '1')
    assert.equal(parkView(game, '1', 6000).respawnMs, 0)
    assert.equal(victim.x, (area.left + area.right) / 2)
  }
})

test('spectators can change areas but receive no ordinary or hidden living players', () => {
  const game = emptyGame()
  attackInPark(game, '0', '1', 0)
  advanceParkCombat(game, 2450)
  game.npcs.set('npc', { id: 'npc', color: 'red', area: 0, x: 205, y: 290, facing: 1, pose: 'talk' })
  game.players.get('3').pose = 'sprint'
  let view = parkView(game, '1', 2450)
  assert.deepEqual(new Set(view.actors.map(({ id }) => id)), new Set(['npc', '3']))
  assert.equal(view.target, null)
  const player = game.players.get('2')
  player.combat = { startedAt: 2400, endsAt: 2760, stun: true }
  player.pose = 'kill'
  view = parkView(game, '1', 2450)
  assert.ok(view.actors.some(({ id }) => id === '2'))
  assert.deepEqual(Object.keys(view.actors.find(({ id }) => id === '2').combat).sort(), ['endsAt', 'startedAt'])
  player.mode = 'hide'
  assert.ok(parkView(game, '1', 2450).actors.every(({ id }) => id !== '2'))
  assert.match(spectateInPark(game, '0', 1), /not spectating/)
  for (const area of [-1, 6, '1', 0.5]) assert.match(spectateInPark(game, '1', area), /unavailable/)
  assert.equal(spectateInPark(game, '1', 4), undefined)
  view = parkView(game, '1', 2450)
  assert.equal(view.area, 4)
  assert.equal(view.actors.length, 0)
  assert.match(attackInPark(game, '1', 'npc', 2450), /cannot attack/)
})

test('killed crowd NPCs and walkers stop and return through their existing population slots', () => {
  for (const walker of [false, true]) {
    const game = createParkSession([{ id: 'player', name: 'Player' }], () => 0.5)
    const slot = walker ? game.walkers[0] : null
    const victim = slot?.actor ?? [...game.npcs.values()].find(({ crowd }) => crowd)
    const areaIndex = victim.area
    const player = game.players.get('player')
    Object.assign(player, { area: victim.area, x: victim.x + 5, y: victim.y })
    const position = { x: victim.x, y: victim.y }
    assert.equal(attackInPark(game, 'player', victim.id, 100), undefined)
    stepPark(game, 50, 150)
    assert.deepEqual({ x: victim.x, y: victim.y }, position)
    const vanishesAt = 100 + deathDuration + 2000
    stepPark(game, 50, vanishesAt)
    assert.equal(game.npcs.has(victim.id), false)
    const panic = game.npcPanics.get(areaIndex)
    for (let now = vanishesAt + 50; panic.returnsAt === null && now < vanishesAt + 10_000; now += 50) {
      stepPark(game, 50, now)
    }
    assert.ok(panic.returnsAt)
    stepPark(game, 50, panic.returnsAt - 1)
    assert.equal([...game.npcs.values()].some((actor) => actor.area === areaIndex), false)
    stepPark(game, 50, panic.returnsAt)
    for (let time = 50; time <= 1800; time += 50) stepPark(game, 50, panic.returnsAt + time)
    if (walker) {
      assert.notEqual(slot.actor.id, victim.id)
      assert.equal(slot.actor.area, victim.area)
      assert.equal(game.npcs.get(slot.actor.id), slot.actor)
    } else {
      const group = [...game.npcs.values()].filter(({ crowd }) => crowd?.group === victim.crowd.group)
      assert.equal(group.length, 2)
      assert.ok(group.every(({ id }) => id !== victim.id))
      assert.equal(new Set(group.map(({ color }) => color)).size, group.length)
    }
  }
})

test('target assignments recover after departures, and solo play does not end automatically', () => {
  const game = emptyGame('Hitman')
  game.players.delete('1')
  refreshParkTargets(game)
  assert.notEqual(game.targets.get('0'), '1')
  assert.equal(game.targets.has('1'), false)
  const last = emptyGame('last_man_standing', 2)
  last.players.delete('1')
  advanceParkCombat(last, 0)
  assert.equal(last.winner.id, '0')
  const solo = emptyGame('last_man_standing', 1)
  advanceParkCombat(solo, 0)
  assert.equal(solo.winner, null)
})
