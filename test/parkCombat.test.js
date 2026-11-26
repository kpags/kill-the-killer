import assert from 'node:assert/strict'
import test from 'node:test'
import { areas, colors, constrain } from '../shared/park.js'
import { animationDuration, blowgunCooldownMs, blowgunFlightMs, blowgunItem, blowgunRange, blowgunWindupMs,
  combatFeedbackMs, deathOpacity, killFlashMs, poisonMs } from '../shared/combat.js'
import { profileFill } from '../shared/profile.js'
import { createParkSession, interactInPark, parkView, playParkAction, setParkInput, stepPark } from '../server/parkSession.js'
import { advanceParkCombat, attackInPark, equipParkItem, refreshParkTargets, spectateInPark } from '../server/parkCombat.js'
import { useSmokeInPark } from '../server/parkSmoke.js'
import { smokeDurationMs, smokeHeight, smokeWidth } from '../shared/smoke.js'

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
  for (const actor of game.players.values()) Object.assign(actor, { area: 0, x: 200, y: 290 })
  refreshParkTargets(game, 0, true)
  return game
}

test('the blowgun validates range, traces the shot, halves movement, and applies one delayed kill', () => {
  for (const mode of ['last_man_standing', 'Hitman']) {
    const game = emptyGame(mode)
    const [shooter, victim, other, remote] = game.players.values()
    assert.equal(blowgunRange(0), areas[0].width * 0.85)
    assert.equal(blowgunRange(1), areas[1].width * 0.85)
    Object.assign(shooter, { facing: 1, x: 50 + blowgunRange(0) })
    Object.assign(victim, { x: 49.9 })
    remote.area = 1
    assert.match(attackInPark(game, shooter.id, victim.id, 0, blowgunItem), /Equip/)
    equipParkItem(game, shooter.id, blowgunItem)
    assert.match(attackInPark(game, shooter.id, victim.id, 0, blowgunItem), /430.95 pixels/)
    assert.equal(shooter.blowgunReadyAt, undefined)
    victim.x = 50
    assert.equal(attackInPark(game, shooter.id, victim.id, 0, blowgunItem), undefined)
    assert.equal(shooter.facing, -1)
    assert.equal(shooter.pose, 'blowgun')
    const hitAt = blowgunWindupMs + blowgunFlightMs
    assert.deepEqual(parkView(game, other.id, 0).blowgunTraces, [{
      from: { x: shooter.x, y: 290, facing: -1 }, to: { x: 50, y: 290 }, startedAt: blowgunWindupMs, hitAt,
    }])
    assert.deepEqual(parkView(game, remote.id, 0).blowgunTraces, [])
    assert.equal(parkView(game, other.id, 0).blowgunReadyAt, undefined)
    advanceParkCombat(game, hitAt - 1)
    assert.equal(victim.poison, undefined)
    advanceParkCombat(game, hitAt)
    assert.equal(victim.life, 'alive')
    assert.equal(parkView(game, other.id, hitAt).actors.find(({ id }) => id === victim.id).poisonedAt, hitAt)
    setParkInput(victim, { x: 1, y: 0, sprint: false }, hitAt)
    stepPark(game, 100, hitAt + 100)
    assert.ok(Math.abs(victim.x - 53.6) < 0.0001)
    assert.deepEqual(parkView(game, shooter.id, hitAt + 100).blowgunTraces, [])
    advanceParkCombat(game, hitAt + poisonMs - 1)
    assert.equal(victim.life, 'alive')
    advanceParkCombat(game, hitAt + poisonMs)
    assert.equal(victim.life, 'dying')
    assert.equal(victim.poison, null)
    assert.equal(victim.victimCue.killerName, shooter.name)
    assert.equal(victim.combat.startedAt, hitAt + poisonMs)
    assert.equal(shooter.score, mode === 'Hitman' ? 100 : 0)
    assert.match(attackInPark(game, shooter.id, other.id, blowgunCooldownMs - 1, blowgunItem), /recharging/)
    assert.equal(attackInPark(game, shooter.id, other.id, blowgunCooldownMs, blowgunItem), undefined)
  }
})

test('poisoned NPCs die with a penalty, while a target who changes area before impact escapes', () => {
  const game = emptyGame()
  const shooter = game.players.get('0')
  const npc = { id: 'npc', color: 'green', facing: 1, pose: 'idle', area: 0, x: 220, y: 290 }
  game.npcs.set(npc.id, npc)
  const victim = game.players.get('1')
  const hitAt = blowgunWindupMs + blowgunFlightMs
  equipParkItem(game, shooter.id, blowgunItem)
  assert.equal(attackInPark(game, shooter.id, victim.id, 0, blowgunItem), undefined)
  victim.area = 1
  advanceParkCombat(game, hitAt)
  assert.equal(victim.poison, undefined)
  advanceParkCombat(game, blowgunCooldownMs)
  assert.equal(attackInPark(game, shooter.id, npc.id, blowgunCooldownMs, blowgunItem), undefined)
  const deathAt = blowgunCooldownMs + hitAt + poisonMs
  advanceParkCombat(game, blowgunCooldownMs + hitAt)
  assert.equal(shooter.penaltyUntil, undefined)
  advanceParkCombat(game, deathAt)
  assert.equal(npc.life, 'dying')
  assert.equal(shooter.penaltyUntil, deathAt + 10_000)
})

test('the earlier poison deadline decides the final elimination when both expire in one tick', () => {
  const game = emptyGame('last_man_standing', 2)
  const [first, second] = game.players.values()
  equipParkItem(game, first.id, blowgunItem)
  equipParkItem(game, second.id, blowgunItem)
  assert.equal(attackInPark(game, first.id, second.id, 0, blowgunItem), undefined)
  assert.equal(attackInPark(game, second.id, first.id, 10, blowgunItem), undefined)
  const bothExpired = blowgunWindupMs + blowgunFlightMs + poisonMs + 10
  advanceParkCombat(game, bothExpired)
  assert.equal(game.winner.id, first.id)
  assert.equal(second.life, 'dying')
  assert.equal(first.poison, null)
})

test('only the equipped item can be used and a smoke cloud obscures other players for at most ten seconds', () => {
  const game = emptyGame()
  const [owner, victim, observer, remote] = game.players.values()
  owner.x = 180
  observer.x += smokeWidth
  remote.area = 1
  assert.equal(smokeWidth, 200)
  assert.equal(smokeHeight, 200)
  assert.match(useSmokeInPark(game, owner.id, 0), /Equip Smoke/)
  assert.match(equipParkItem(game, owner.id, '__proto__'), /unavailable/)
  for (const item of ['smoke', 'Rock']) {
    assert.equal(equipParkItem(game, owner.id, item), undefined)
    assert.equal(parkView(game, owner.id, 0).equippedItem, item)
    assert.match(attackInPark(game, owner.id, victim.id, 0, 'fist'), /Equip/)
    assert.match(attackInPark(game, owner.id, victim.id, 0), /cannot attack/)
  }
  equipParkItem(game, owner.id, 'smoke')
  assert.equal(useSmokeInPark(game, owner.id, 0), undefined)
  const view = (actor, now = 0) => parkView(game, actor.id, now)
  assert.deepEqual(view(observer).smokeClouds, [{ x: owner.x, y: owner.y, startedAt: 0, endsAt: smokeDurationMs }])
  assert.deepEqual(view(remote).smokeClouds, [])
  assert.equal(view(owner).smokeObscured, false)
  assert.equal(view(observer).smokeObscured, false)
  assert.equal(view(victim).smokeObscured, true)
  assert.equal(view(victim).smokeUntil, view(owner).smokeClouds[0].endsAt)
  assert.deepEqual(view(victim).actors.map(({ id }) => id), [victim.id])
  assert.match(attackInPark(game, victim.id, owner.id, 0), /blocking your view/)

  setParkInput(victim, { x: 1, y: 0, sprint: false }, 50)
  stepPark(game, 100, 150)
  assert.ok(victim.x > 200)
  victim.x = owner.x + smokeWidth / 2 + 0.1
  assert.equal(view(victim, 160).smokeObscured, false)
  assert.equal(view(victim, 160).smokeUntil, 0)
  victim.x = owner.x + smokeWidth / 2
  const reentered = view(victim, smokeDurationMs - 1)
  assert.equal(reentered.smokeObscured, true)
  assert.equal(reentered.smokeUntil, smokeDurationMs)
  stepPark(game, 0, smokeDurationMs)
  assert.equal(view(victim, smokeDurationMs).smokeObscured, false)
  assert.deepEqual(game.smokeClouds, [])
})

test('the player list shares match scores or eliminations across areas without actor details', () => {
  for (const mode of ['last_man_standing', 'Hitman']) {
    const game = emptyGame(mode, 3)
    Object.assign(game.players.get('2'), { area: 3, mode: 'hide', isBot: true })
    const observerView = parkView(game, '2', 0)
    assert.ok(observerView.actors.every(({ id }) => id !== '0'))
    assert.equal(observerView.playerList.length, 3)
    assert.equal(attackInPark(game, '0', '1', 10), undefined)

    const expected = mode === 'Hitman'
      ? [{ name: 'Player 1', score: 100 }, { name: 'Player 2', score: 0 }, { name: 'Player 3', score: 0 }]
      : [{ name: 'Player 1', eliminated: false }, { name: 'Player 2', eliminated: true }, { name: 'Player 3', eliminated: false }]
    for (const id of game.players.keys()) assert.deepEqual(parkView(game, id, 10).playerList, expected)
  }
})

test('combat queues only accepted kill and stun sounds at the corresponding phase', () => {
  for (const mode of ['last_man_standing', 'Hitman']) {
    for (const [victim, impact, full] of [
      ['1', ['kill'], false],
      ['2', ['pre-stun', 'quick-stun'], false],
      ['3', ['pre-stun'], true],
      ['npc', ['kill'], false],
    ]) {
      const game = emptyGame(mode)
      for (const id of ['0', '1', '2', '3']) game.players.get(id).area = 3
      game.npcs.set('npc', { id: 'npc', color: 'red', pose: 'idle', area: 3, x: 201, y: 290 })
      const kinds = () => game.soundEvents.get(3)?.map(({ kind }) => kind) ?? []
      assert.match(attackInPark(game, '0', 'missing', 99), /unavailable/)
      assert.equal(game.soundEvents.size, 0)
      assert.equal(attackInPark(game, '0', victim, 100), undefined)
      assert.deepEqual([...game.soundEvents.keys()], [3])
      assert.deepEqual(kinds(), impact)
      assert.ok(game.soundEvents.get(3).every(({ variant }) => variant >= 0 && variant < 1))
      game.soundEvents.clear()
      advanceParkCombat(game, 549)
      assert.deepEqual(kinds(), [])
      advanceParkCombat(game, 550)
      advanceParkCombat(game, 551)
      assert.deepEqual(kinds(), full ? ['full-stun'] : [])
    }

    const game = emptyGame(mode)
    assert.equal(attackInPark(game, '0', '3', 0), undefined)
    game.soundEvents.clear()
    assert.equal(attackInPark(game, '2', '3', 200), undefined)
    advanceParkCombat(game, 450)
    assert.deepEqual(game.soundEvents.get(0).map(({ kind }) => kind), ['kill'])
  }
})

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
    assert.equal(attacker.profile, 33)
    assert.equal(attacker.stamina, 100)
    assert.equal(game.targets.get('0'), null)
    assert.equal(parkView(game, '0', 1000).targetReadyAt, 4000)
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
    assert.equal(victim.life, 'dying')
    assert.equal(parkView(game, '1', vanishesAt).spectating, false)
    advanceParkCombat(game, 3999)
    assert.equal(parkView(game, '0', 3999).target, null)
    advanceParkCombat(game, 4000)
    assert.equal(parkView(game, '0', 4000).targetReadyAt, undefined)
    assert.equal(parkView(game, '0', 4000).target.name, 'Player 3')
    assert.equal(attacker.profile, 0)
    advanceParkCombat(game, 4300)
    assert.equal(victim.life, 'eliminated')
    assert.equal(parkView(game, '1', 4300).spectating, true)
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

test('a final kill shows the same winner to both players after the death fade and Killed cue', () => {
  const game = emptyGame('last_man_standing', 2)
  assert.equal(game.winner, null)
  assert.equal(attackInPark(game, '0', '1', 0), undefined)
  assert.equal(game.players.get('0').pose, 'kill')
  const feedback = [{ kind: 'target-killed', text: 'Target\nKilled', startedAt: 0 }]
  const cue = { kind: 'killed', startedAt: 0, killerName: 'Player 1' }
  assert.deepEqual(parkView(game, '0', 0).combatFeedback, feedback)
  assert.equal(parkView(game, '0', 0).victimCue, undefined)
  assert.equal(parkView(game, '1', 0).combatFeedback, undefined)
  assert.deepEqual(parkView(game, '1', 0).victimCue, cue)
  assert.equal(parkView(game, '0', 0).matchEnded, true)
  assert.equal(parkView(game, '0', 0).targetReadyAt, undefined)
  assert.match(attackInPark(game, '0', '1', 1), /match has ended/)
  stepPark(game, 50, 500)
  setParkInput(game.players.get('0'), { x: 1, y: 0, sprint: false }, 501)
  stepPark(game, 50, 551)
  assert.equal(game.players.get('0').x, 200)
  assert.equal(parkView(game, '0', corpseDuration).winner, null)
  assert.deepEqual(parkView(game, '0', 2799).combatFeedback, feedback)
  assert.deepEqual(parkView(game, '0', 2800).combatFeedback, [])
  advanceParkCombat(game, 3299)
  assert.equal(parkView(game, '0', 3299).winner, null)
  assert.deepEqual(parkView(game, '1', 3299).victimCue, cue)
  assert.equal(parkView(game, '1', 3299).spectating, false)
  assert.match(spectateInPark(game, '1', 1), /not spectating/)
  advanceParkCombat(game, 3300)
  assert.equal(parkView(game, '1', 3300).victimCue, undefined)
  assert.equal(parkView(game, '1', 3300).spectating, true)
  const expectedWinner = { id: '0', name: 'Player 1', color: game.players.get('0').color }
  assert.deepEqual(parkView(game, '0', 3300).winner, expectedWinner)
  assert.deepEqual(parkView(game, '1', 3300).winner, expectedWinner)
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
    assert.deepEqual(parkView(game, '0', 100).combatFeedback, [{ kind: 'stun', text: 'Stunned', startedAt: 100 }])
    assert.equal(parkView(game, '3', 100).combatFeedback, undefined)
    assert.equal(parkView(game, '0', 100).victimCue, undefined)
    const cue = { kind: 'stunned', startedAt: 100, holdUntil: 3550 }
    assert.deepEqual(parkView(game, '3', 100).victimCue, cue)
    assert.equal(parkView(game, '3', 100).targetReadyAt, mode === 'Hitman' ? 3100 : undefined)
    assert.equal(victim.profile, 80)
    assert.match(interactInPark(game, '3', 549), /cannot interact/)
    advanceParkCombat(game, 549)
    assert.equal(victim.pose, 'pre-stun')
    advanceParkCombat(game, 550)
    assert.equal(victim.pose, 'stun')
    assert.deepEqual(victim.combat, { startedAt: 550, endsAt: 3550 })
    assert.match(attackInPark(game, '0', '3', 600), /already reacting/)
    advanceParkCombat(game, 3099)
    if (mode === 'Hitman') {
      assert.equal(parkView(game, '3', 3099).target, null)
      assert.equal(parkView(game, '3', 3099).targetReadyAt, 3100)
      assert.equal(parkView(game, '0', 3099).targetReadyAt, undefined)
    }
    advanceParkCombat(game, 3100)
    if (mode === 'Hitman') {
      const view = parkView(game, '3', 3100)
      assert.ok(view.target)
      assert.notEqual(view.target.name, 'Player 1')
      assert.equal(view.targetReadyAt, undefined)
      assert.equal(victim.profile, 0)
    } else {
      assert.deepEqual(game.targets, targets)
      assert.equal(victim.profile, 80)
    }
    advanceParkCombat(game, 3549)
    assert.equal(victim.pose, 'stun')
    assert.deepEqual(parkView(game, '3', 3549).victimCue, cue)
    advanceParkCombat(game, 3550)
    assert.equal(victim.pose, 'idle')
    assert.equal(victim.mode, 'free')
    assert.deepEqual(parkView(game, '3', 3849).victimCue, cue)
    assert.equal(parkView(game, '3', 3850).victimCue, undefined)
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
    const feedback = [{ kind: 'rating', text: rating, points, startedAt: 10 }]
    assert.deepEqual(own.combatFeedback, feedback)
    assert.equal(own.profile, profile)
    assert.equal(own.target, null)
    assert.equal(own.targetReadyAt, 3010)
    assert.equal(parkView(game, '1', 10).score, 0)
    assert.equal(parkView(game, '1', 10).combatFeedback, undefined)
    assert.equal(own.victimCue, undefined)
    const killedCue = { kind: 'killed', startedAt: 10, killerName: 'Player 1' }
    assert.deepEqual(parkView(game, '1', 10).victimCue, killedCue)
    assert.deepEqual(parkView(game, '0', 9 + combatFeedbackMs).combatFeedback, feedback)
    assert.deepEqual(parkView(game, '0', 10 + combatFeedbackMs).combatFeedback, [])
    advanceParkCombat(game, 3010)
    assert.equal(parkView(game, '0', 3010).profile, 0)
    assert.equal(parkView(game, '0', 3010).targetReadyAt, undefined)
    assert.ok(parkView(game, '0', 3010).target)
    advanceParkCombat(game, 3309)
    assert.equal(parkView(game, '1', 3309).life, 'respawning')
    assert.deepEqual(parkView(game, '1', 3309).victimCue, killedCue)
    assert.equal(parkView(game, '1', 3310).victimCue, undefined)
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
  const penalized = parkView(game, '0', 1000)
  assert.equal(penalized.penaltyUntil, 11_000)
  assert.equal(penalized.combatFeedback, undefined)
  assert.equal(parkView(game, '1', 1000).combatFeedback, undefined)
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
      attacker.profile = activity === 'free' ? 7 : 33
      Object.assign(victim, { mode: activity, spotId: 'interact-B', seatSlot: 0, profile: 80 })
      assert.equal(attackInPark(game, '0', '2', 0), undefined)
      assert.equal(attacker.mode, 'combat')
      assert.equal(attacker.spotId, null)
      assert.equal(victim.pose, 'pre-stun')
      assert.equal(parkView(game, attacker.id, 0).killFlashAt, undefined)
      assert.deepEqual(parkView(game, attacker.id, 0).combatFeedback, [{ kind: 'stun', text: 'Stunned', startedAt: 0 }])
      assert.equal(parkView(game, victim.id, 0).combatFeedback, undefined)
      assert.deepEqual(game.targets, targets)
      assert.equal(attacker.profile, activity === 'free' ? 0 : 23)
      assert.equal(victim.profile, 80)
      assert.equal(victim.spotId, null)
      assert.equal(victim.seatSlot, null)
      advanceParkCombat(game, 450)
      assert.equal(victim.pose, 'idle')
      assert.equal(victim.mode, 'free')
      assert.deepEqual(parkView(game, victim.id, 450).victimCue,
        mode === 'last_man_standing' ? { kind: 'stunned', startedAt: 0 } : undefined)
      assert.deepEqual(game.targets, targets)
    }
  }
})

test('NPC penalties use individual deadlines and a three-event room-wide FIFO in both modes', () => {
  for (const mode of ['last_man_standing', 'Hitman']) {
    const game = emptyGame(mode, 5)
    for (const [playerId, now] of [['0', 0], ['1', 250], ['1', 500], ['2', 750]]) {
      const npc = { id: `npc-${now}`, area: 0, x: 204, y: 290, color: 'purple', pose: 'walk' }
      game.npcs.set(npc.id, npc)
      advanceParkCombat(game, now)
      assert.equal(attackInPark(game, playerId, npc.id, now), undefined)
      assert.equal(parkView(game, playerId, now).penaltyUntil, now + 10_000)
      assert.deepEqual(parkView(game, playerId, now).penaltyNotices, [])
    }
    assert.equal(parkView(game, '0', 750).penaltyUntil, 10_000)
    assert.deepEqual(parkView(game, '0', 750).penaltyNotices, [])
    assert.equal(parkView(game, '4', 750).penaltyUntil, undefined)
    assert.deepEqual(parkView(game, '4', 750).penaltyNotices, [
      { id: 2, name: 'Player 2', area: 0, expiresAt: 10_250 },
      { id: 3, name: 'Player 2', area: 0, expiresAt: 10_500 },
      { id: 4, name: 'Player 3', area: 0, expiresAt: 10_750 },
    ])
    Object.assign(game.players.get('4'), { area: 4 })
    Object.assign(game.players.get('1'), { area: 1 })
    assert.deepEqual(parkView(game, '4', 900).penaltyNotices.map(({ area }) => area), [1, 1, 0])
    assert.equal(parkView(game, '0', 10_000).penaltyUntil, undefined)
    assert.equal(parkView(game, '0', 10_000).penaltyFadeAt, 10_000)
    assert.equal(parkView(game, '0', 10_499).penaltyFadeAt, 10_000)
    assert.equal(parkView(game, '0', 10_500).penaltyFadeAt, undefined)
    assert.ok(parkView(game, '0', 10_000).penaltyNotices.length)
    game.players.delete('2')
    assert.deepEqual(parkView(game, '4', 10_250).penaltyNotices, [
      { id: 3, name: 'Player 2', area: 1, expiresAt: 10_500 },
    ])
    assert.deepEqual(parkView(game, '4', 10_500).penaltyNotices, [])
  }
})

test('an NPC penalty survives Hitman death and respawn with the same deadline', () => {
  const game = emptyGame('Hitman')
  const npc = { id: 'npc', area: 0, x: 204, y: 290, color: 'purple', pose: 'walk' }
  game.npcs.set(npc.id, npc)
  assert.equal(attackInPark(game, '0', npc.id, 0), undefined)
  assert.equal(attackInPark(game, '3', '0', 500), undefined)
  advanceParkCombat(game, 4000)
  assert.equal(parkView(game, '0', 4000).life, 'respawning')
  assert.equal(parkView(game, '0', 4000).penaltyUntil, 10_000)
  assert.equal(parkView(game, '1', 4000).penaltyNotices[0].area, 0)
  advanceParkCombat(game, 5500)
  const respawned = parkView(game, '0', 5500)
  assert.equal(respawned.life, 'alive')
  assert.equal(respawned.respawnedAt, 5500)
  assert.equal(parkView(game, '0', 5999).respawnedAt, 5500)
  assert.equal(parkView(game, '0', 6000).respawnedAt, undefined)
  assert.equal(parkView(game, '1', 5500).respawnedAt, undefined)
  assert.equal(respawned.penaltyUntil, 10_000)
  assert.equal(parkView(game, '1', 5500).penaltyNotices[0].area, respawned.area)
})

test('penalties expose visible models and share one sound with only the penalized player and their hunters', () => {
  const game = emptyGame('Hitman')
  const actor = game.players.get('0')
  game.targets.set('2', actor.id)
  game.players.get('2').area = 1
  game.npcs.set('npc', { id: 'npc', area: 0, x: 204, y: 290, color: 'purple', pose: 'walk' })
  assert.equal(attackInPark(game, actor.id, 'npc', 100), undefined)
  const [penalty] = parkView(game, actor.id, 100).penaltySounds
  assert.ok(penalty.variant >= 0 && penalty.variant < 1)
  assert.equal(penalty.expiresAt, 10_100)
  assert.deepEqual(parkView(game, '2', 100).penaltySounds, [penalty])
  assert.deepEqual(parkView(game, '3', 100).penaltySounds, [penalty])
  assert.equal(parkView(game, '1', 100).penaltySounds, undefined)
  assert.deepEqual(game.soundEvents.get(0).map(({ kind }) => kind), ['kill'])
  game.soundEvents.clear()

  const actorSeenBy = (id, now) => parkView(game, id, now).actors.find(({ id }) => id === actor.id)
  assert.equal(actorSeenBy('1', 100).penaltyGlowUntil, 10_100)
  assert.equal(actorSeenBy('1', 10_100).penaltyGlowUntil, undefined)
  assert.equal(actorSeenBy('2', 100), undefined)
  actor.mode = 'hide'
  assert.equal(actorSeenBy('1', 100), undefined)
  actor.mode = 'free'
  actor.area = 1
  assert.equal(actorSeenBy('2', 100).penaltyGlowUntil, 10_100)
  assert.deepEqual(parkView(game, actor.id, 10_099).penaltySounds, [penalty])
  assert.deepEqual(parkView(game, '2', 10_099).penaltySounds, [penalty])
  assert.equal(parkView(game, actor.id, 10_100).penaltySounds, undefined)
  assert.equal(parkView(game, '2', 10_100).penaltySounds, undefined)
})

test('quick combat actions keep their own feedback timestamps and expire independently', () => {
  const game = emptyGame('Hitman')
  const attacker = game.players.get('0')
  assert.equal(attackInPark(game, attacker.id, '2', 0), undefined)
  const nextAttack = attacker.combat.endsAt
  advanceParkCombat(game, nextAttack)
  assert.equal(attackInPark(game, attacker.id, '1', nextAttack), undefined)
  const feedback = parkView(game, attacker.id, nextAttack).combatFeedback
  assert.deepEqual(feedback.map(({ kind, startedAt }) => [kind, startedAt]), [['stun', 0], ['rating', nextAttack]])
  assert.deepEqual(parkView(game, attacker.id, combatFeedbackMs).combatFeedback, feedback.slice(1))
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

test('spectators can see every visible model in the watched area and hiding stays private', () => {
  const game = emptyGame()
  attackInPark(game, '0', '1', 0)
  advanceParkCombat(game, 3300)
  game.npcs.set('npc', { id: 'npc', color: 'red', area: 0, x: 205, y: 290, facing: 1, pose: 'talk' })
  game.players.get('3').pose = 'sprint'
  let view = parkView(game, '1', 3300)
  assert.deepEqual(new Set(view.actors.map(({ id }) => id)), new Set(['npc', '0', '2', '3']))
  assert.equal(view.target, null)
  assert.ok(view.actors.every((model) => !('name' in model) && !('isBot' in model) && !('penaltyUntil' in model)))
  const player = game.players.get('2')
  player.combat = { startedAt: 3250, endsAt: 3610, stun: true }
  player.pose = 'kill'
  view = parkView(game, '1', 3300)
  assert.ok(view.actors.some(({ id }) => id === '2'))
  assert.deepEqual(Object.keys(view.actors.find(({ id }) => id === '2').combat).sort(), ['endsAt', 'startedAt'])
  player.mode = 'hide'
  assert.ok(parkView(game, '1', 3300).actors.every(({ id }) => id !== '2'))
  assert.match(spectateInPark(game, '0', 1), /not spectating/)
  for (const area of [-1, 6, '1', 0.5]) assert.match(spectateInPark(game, '1', area), /unavailable/)
  assert.equal(spectateInPark(game, '1', 4), undefined)
  view = parkView(game, '1', 3300)
  assert.equal(view.area, 4)
  assert.equal(view.actors.length, 0)
  assert.match(attackInPark(game, '1', 'npc', 3300), /cannot attack/)
  assert.equal(attackInPark(game, '3', 'npc', 3300), undefined)
  assert.deepEqual(parkView(game, '1', 3300).penaltyNotices, [
    { id: 1, name: 'Player 4', area: 0, expiresAt: 13_300 },
  ])
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
  refreshParkTargets(game, 0)
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
