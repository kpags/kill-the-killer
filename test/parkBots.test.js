import assert from 'node:assert/strict'
import test from 'node:test'
import { createParkSession, parkView, stepPark } from '../server/parkSession.js'
import { createBotMemory, chooseBotIntent, observeParkBot } from '../server/parkBots.js'
import { advanceParkCombat, attackInPark } from '../server/parkCombat.js'
import { areas, constrain } from '../shared/park.js'
import { blowgunItem, itemCooldownMs, rockItem } from '../shared/combat.js'
import { smokeCooldownMs, smokeItem } from '../shared/smoke.js'

const fixedRandom = () => 0

function match(modeId = 'last_man_standing', extraPlayers = []) {
  const game = createParkSession([
    { id: 'bot', name: 'Bot', isBot: true },
    { id: 'target', name: 'Target', isBot: false },
    ...extraPlayers,
  ], fixedRandom, modeId)
  game.npcs.clear()
  game.walkers.length = 0
  game.targetOrder = [...game.players.keys()]
  const bot = game.players.get('bot')
  const target = game.players.get('target')
  Object.assign(bot, { area: 0, x: 200, y: 295, color: 'red' })
  Object.assign(target, { area: 0, x: 215, y: 295, color: 'blue' })
  return { game, bot, target }
}

function runTicks(game, first, last, onTick = () => {}) {
  for (let now = first; now <= last; now += 50) {
    stepPark(game, 50, now)
    onTick(now)
  }
}

test('bot perception gives the planner visible behavior, a target portrait, and only public leads', () => {
  const { game, bot, target } = match()
  const decoy = { id: 'decoy', color: target.color, area: 0, x: 220, y: 305, facing: 1, pose: 'talk' }
  game.npcs.set(decoy.id, decoy)
  const context = { heartbeat: 810, smokeObscured: false, penaltyNotices: [{ id: 1, name: 'Target', area: 1 }] }
  target.mode = 'hide'
  let seen = observeParkBot(game, bot, 100, context)
  assert.deepEqual(seen.models.map(({ id }) => id), [decoy.id])
  assert.deepEqual(seen.target, { color: target.color, name: target.name })
  assert.deepEqual(Object.keys(seen.models[0]).sort(), ['area', 'color', 'facing', 'id', 'pose', 'x', 'y'])
  assert.equal(seen.heartbeat, 810)
  assert.deepEqual(seen.penaltyNotices, context.penaltyNotices)

  Object.assign(target, { mode: 'free', area: 1 })
  seen = observeParkBot(game, bot, 150, context)
  assert.deepEqual(seen.models.map(({ id }) => id), [decoy.id])
  target.area = 0
  seen = observeParkBot(game, bot, 200, { ...context, smokeObscured: true })
  assert.deepEqual(seen.models, [])

  Object.assign(target, { x: 330, y: 295 })
  game.smokeClouds.push({ ownerId: target.id, area: 0, x: 330, y: 295, endsAt: 10_000 })
  seen = observeParkBot(game, bot, 250, context)
  assert.deepEqual(seen.models.map(({ id }) => id), [decoy.id])
})

test('the planner waits on same-color decoys and uses a delayed attack when one model gives itself away', () => {
  const { game, bot, target } = match()
  game.npcs.set('decoy', { id: 'decoy', color: target.color, area: 0, x: 219, y: 291, facing: 1, pose: 'phone-one' })
  target.pose = 'phone-two'
  const memory = createBotMemory(0, fixedRandom)
  function decide(now) {
    return chooseBotIntent(observeParkBot(game, bot, now, {
      heartbeat: 600, smokeObscured: false, penaltyNotices: [],
    }), memory, now, fixedRandom)
  }
  for (let now = 0; now <= 1000; now += 250) assert.equal(decide(now).kind, 'observe')
  target.pose = 'punch'
  assert.equal(decide(1250).kind, 'idle')
  assert.equal(memory.attack.at, 1650)
  target.pose = 'phone-two'
  assert.equal(decide(1500).kind, 'idle')
  assert.deepEqual(decide(1650), { kind: 'attack', id: target.id, item: 'fist' })
})

test('losing sight during the reaction does not let a bot hit a hiding or off-area target', () => {
  for (const disappear of [
    ({ target }) => Object.assign(target, { mode: 'hide', hideUntil: 4000 }),
    ({ target }) => { target.area = 1 },
    ({ game, target }) => {
      game.smokeClouds.push({ ownerId: target.id, area: 0, x: 200, y: 295, endsAt: 4000 })
    },
  ]) {
    const fixture = match()
    const { game, bot, target } = fixture
    runTicks(game, 50, 800)
    assert.equal(bot.botMemory.attack.at, 1200)
    disappear(fixture)
    runTicks(game, 850, 1200)
    assert.equal(target.life, 'alive')
    assert.equal(bot.combat, null)
    assert.equal(bot.botMemory.attack, null)
    assert.equal(bot.botMemory.lastSeen.until, 3800)
    runTicks(game, 1250, 3900)
    assert.equal(target.life, 'alive')
  }
})

test('bots cross the Carpark step, patrol every area, and stay inside playable ground', () => {
  const { game, bot, target } = match()
  Object.assign(bot, { area: 5, x: 230, y: 215 })
  Object.assign(target, { area: 4, mode: 'hide', hideUntil: 90_000 })
  const visited = new Set([bot.area])
  runTicks(game, 50, 50_000, () => {
    visited.add(bot.area)
    assert.deepEqual(constrain(areas[bot.area], bot.x, bot.y), { x: bot.x, y: bot.y })
  })
  assert.deepEqual([...visited], [5, 4, 3, 2, 1, 0])
  assert.equal(target.life, 'alive')
})

test('bots use a public penalty notice to select the correct exit', () => {
  const { game, bot, target } = match()
  Object.assign(bot, { area: 2, x: 260, y: 280 })
  target.area = 5
  const context = { smokeObscured: false, penaltyNotices: [{ name: target.name, area: 5 }] }
  const observation = observeParkBot(game, bot, 100, context)
  const intent = chooseBotIntent(observation, createBotMemory(0, fixedRandom), 100, fixedRandom)
  assert.equal(intent.kind, 'move')
  assert.ok(intent.point.x > areas[2].right)
})

test('Hitman bots use available seats to recover stamina and build Profile between sightings', () => {
  const { game, bot, target } = match('Hitman')
  Object.assign(bot, { x: 130, y: 275, stamina: 40 })
  target.area = 1
  runTicks(game, 50, 1050)
  assert.equal(bot.mode, 'sit')
  assert.equal(bot.spotId, 'interact-C')
  assert.ok(bot.stamina > 65)
  assert.ok(bot.profile > 40)
  runTicks(game, 1100, 3300)
  assert.equal(bot.mode, 'free')
  assert.equal(bot.seatSlot, null)
  assert.equal(bot.pose, 'walk')
})

test('a Standard bot can identify a passive opponent and win Last Man Standing', () => {
  const { game, bot, target } = match()
  game.npcs.set('foreground', { id: 'foreground', color: 'green', area: 0, x: 216, y: 313, facing: 1, pose: 'phone-one' })
  runTicks(game, 50, 1150)
  assert.equal(target.life, 'alive')
  assert.equal(bot.combat, null)
  runTicks(game, 1200, 1200)
  assert.equal(target.life, 'dying')
  assert.equal(game.result.winners[0].id, bot.id)
  assert.equal(parkView(game, target.id, game.resultAt).result.winners[0].id, bot.id)
})

test('Hitman bots score using their Profile, wait for target reassignment, and respawn as players', () => {
  const { game, bot, target } = match('Hitman')
  bot.profile = 66
  runTicks(game, 50, 1200)
  assert.equal(bot.score, 200)
  assert.equal(target.life, 'dying')
  assert.equal(parkView(game, bot.id, 1200).targetReadyAt, 4200)
  runTicks(game, 1250, 4200)
  assert.equal(parkView(game, bot.id, 4200).target, null)
  runTicks(game, 4250, 6200)
  assert.equal(target.generation, 1)
  assert.equal(parkView(game, bot.id, 6200).target.name, target.name)

  Object.assign(target, { area: bot.area, x: bot.x, y: bot.y })
  assert.equal(attackInPark(game, target.id, bot.id, 6250), undefined)
  assert.equal(bot.life, 'dying')
  assert.equal(target.score, 100)
  runTicks(game, 6300, 11_250)
  assert.equal(bot.generation, 1)
  assert.equal(bot.life, 'alive')
  assert.equal(bot.profile, 33)
  assert.equal(bot.stamina, 100)
  assert.equal(bot.botMemory, undefined)
})

test('a bot can be fooled by a same-color model and then has to serve the NPC penalty', () => {
  const { game, bot, target } = match()
  target.mode = 'hide'
  target.hideUntil = 90_000
  game.npcs.set('decoy', { id: 'decoy', color: target.color, area: 0, x: 215, y: 295, facing: 1, pose: 'idle' })
  runTicks(game, 50, 1200)
  assert.equal(game.npcs.get('decoy').life, 'dying')
  assert.equal(bot.penaltyUntil, 11_200)
  assert.equal(target.life, 'alive')
  Object.assign(target, { mode: 'free', area: bot.area, x: bot.x + 10, y: bot.y })
  runTicks(game, 1250, 3100)
  assert.equal(target.life, 'alive')
})

test('bots can misread a nearby NPC or seated non-target and use the normal melee outcome', () => {
  for (const isNpc of [true, false]) {
    const { game, bot, target } = match('last_man_standing', [{ id: 'bystander', name: 'Bystander' }])
    bot.botMemory = createBotMemory(0, fixedRandom)
    game.random = () => 0.95
    target.area = 1
    let decoy = game.players.get('bystander')
    if (isNpc) {
      decoy.area = 1
      decoy = { id: 'npc', color: target.color, area: 0, x: 215, y: 295, facing: 1, pose: 'talk' }
      game.npcs.set(decoy.id, decoy)
    } else {
      decoy.color = 'green'
      Object.assign(decoy, { area: 0, x: 200, y: 255, pose: 'sit', mode: 'sit', seatSlot: 0 })
      bot.y = 275
    }
    runTicks(game, 50, 650)
    assert.equal(decoy.life ?? 'alive', 'alive')
    assert.equal(bot.botMemory.attack?.mistaken, true)
    runTicks(game, 700, 700)
    assert.equal(decoy.life, 'dying')
    assert.equal(target.life, 'alive')
    assert.equal(game.targets.get(bot.id), target.id)
    const { combatFeed, penaltyUntil } = parkView(game, bot.id, 700)
    assert.equal(combatFeed[0]?.kind, isNpc ? 'npc-kill' : undefined)
    assert.equal(penaltyUntil, isNpc ? 10700 : undefined)
  }
})

test('bots can select the blowgun or Rock in range and use the shared cooldowns and hit rules', () => {
  for (const item of [blowgunItem, rockItem]) {
    const { game, bot, target } = match('Hitman')
    bot.botMemory = createBotMemory(0, fixedRandom)
    game.random = () => 0.95
    bot.itemReadyAt[item === blowgunItem ? rockItem : blowgunItem] = 90_000
    Object.assign(target, { x: 280, pose: 'punch' })
    runTicks(game, 50, 650)
    assert.equal(game.projectiles.length, 0)
    runTicks(game, 700, 700)
    const [shot] = game.projectiles
    assert.equal(shot.itemId, item)
    assert.equal(shot.victimId, target.id)
    assert.equal(bot.itemReadyAt[item], 700 + itemCooldownMs[item])
    advanceParkCombat(game, shot.hitAt)
    if (item === blowgunItem) assert.equal(target.poison.attackerId, bot.id)
    else assert.equal(target.pose, 'stun')
  }
})

test('bots can deploy Smoke when threatened and respect the penalty lockout', () => {
  for (const penalized of [false, true]) {
    const { game, bot, target } = match('last_man_standing', [{ id: 'hunter', name: 'Hunter' }])
    bot.botMemory = createBotMemory(0, fixedRandom)
    game.random = () => 0.95
    target.area = 1
    Object.assign(game.players.get('hunter'), { area: 0, x: 220, y: 295, color: 'green' })
    if (penalized) bot.penaltyUntil = 10_000
    runTicks(game, 50, 50)
    assert.equal(game.smokeClouds.length, penalized ? 0 : 1)
    assert.equal(bot.itemReadyAt[smokeItem], penalized ? undefined : 50 + smokeCooldownMs)
  }
})
