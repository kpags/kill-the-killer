import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { WebSocket } from 'ws'
import { createLobbyServer } from '../server/lobby.js'
import { areas, constrain } from '../shared/park.js'

async function setup(context, options) {
  const server = createLobbyServer({ port: 0, host: '127.0.0.1', reconnectGraceMs: 500, ...options })
  context.after(() => new Promise((resolve) => {
    for (const socket of server.clients) socket.terminate()
    server.close(resolve)
  }))
  await once(server, 'listening')
  const url = `ws://127.0.0.1:${server.address().port}/ws`

  return async function connect() {
    const socket = new WebSocket(url)
    const messages = []
    socket.on('message', (event) => messages.push(JSON.parse(event.toString())))
    await once(socket, 'open')
    let requestId = 0

    async function waitFor(predicate, timeout = 2000) {
      let index = messages.findIndex(predicate)
      while (index < 0) {
        await once(socket, 'message', { signal: AbortSignal.timeout(timeout) })
        index = messages.findIndex(predicate)
      }
      return messages.splice(0, index + 1).at(-1)
    }

    return {
      socket,
      waitFor,
      command(type, attributes) {
        const id = ++requestId
        socket.send(JSON.stringify({ type, requestId: id, ...attributes }))
        return waitFor((message) => message.type === 'result' && message.requestId === id)
      },
    }
  }
}

test('rooms synchronize human numbering and enforce slot and player permissions', { timeout: 5000 }, async (context) => {
  const connect = await setup(context, { availableMapIds: ['park', 'quiet_lane'] })
  const host = await connect()
  const created = await host.command('create')
  const { code, selectedMapId } = created.room
  assert.match(code, /^[A-Z0-9]{6}$/)
  assert.equal(created.room.slots[0].name, 'Player 1')
  assert.equal(selectedMapId, 'park')
  assert.equal(created.room.slots.length, 6)
  for (const index of [2, 4]) assert.equal((await host.command('add_bot', { index })).error, undefined)

  const guest = await connect()
  assert.match((await guest.command('join', { code: '#bad' })).error, /six-character/)
  const joined = await guest.command('join', { code: code.toLowerCase() })
  const bot = joined.room.slots[2]
  assert.equal(joined.room.slots[1].name, 'Player 2')
  assert.equal(bot.ready, true)
  assert.equal(joined.room.slots.some((seat) => seat?.token), false)

  assert.match((await guest.command('add_bot', { index: 3 })).error, /Only the host/)
  assert.match((await guest.command('select_map', { mapId: 'park' })).error, /Only the host/)
  assert.match((await host.command('select_map', { mapId: 'missing' })).error, /unavailable/)
  assert.equal((await host.command('select_map', { mapId: 'quiet_lane' })).error, undefined)
  await guest.waitFor(({ room }) => room?.selectedMapId === 'quiet_lane')
  assert.match((await host.command('rename', { playerId: joined.playerId, name: 'Other' })).error, /cannot/)
  assert.match((await guest.command('rename', { playerId: bot.id, name: 'Other' })).error, /cannot/)
  assert.match((await host.command('set_ready', { playerId: bot.id, ready: false })).error, /only change/)
  assert.match((await guest.command('rename', { playerId: joined.playerId, name: 'Bad name!' })).error, /letters/)
  assert.equal((await host.command('rename', { playerId: bot.id, name: 'Trail Bot' })).error, undefined)
  assert.equal((await guest.command('rename', { playerId: joined.playerId, name: ' Guest 2 ' })).error, undefined)
  assert.equal((await guest.command('set_ready', { playerId: joined.playerId, ready: true })).error, undefined)
  const updated = await host.waitFor(({ room }) => room?.slots[1]?.ready)
  assert.equal(updated.room.slots[1].name, 'Guest 2')
  assert.equal(updated.room.slots[2].name, 'Trail Bot')

  const third = await connect()
  assert.equal((await third.command('join', { code })).room.slots[3].name, 'Player 3')
  const contenders = await Promise.all([connect(), connect()])
  const results = await Promise.all(contenders.map((client) => client.command('join', { code })))
  assert.equal(results.filter((item) => item.error === 'This room is full.').length, 1)
  assert.equal(results.find((item) => item.room).room.slots[5].name, 'Player 4')
  await guest.command('leave')
  const refill = await contenders[results.findIndex((item) => item.error)].command('join', { code })
  assert.equal(refill.room.slots[1].name, 'Player 4')

  await host.command('leave')
  const closed = await third.waitFor(({ type }) => type === 'room_closed')
  assert.match(closed.reason, /host left/)
  assert.match((await guest.command('join', { code })).error, /not found/)
})

test('Actions wheel commands broadcast the same chosen clip and stop on movement', { timeout: 5000 }, async (context) => {
  const connect = await setup(context)
  const host = await connect()
  const created = await host.command('create')
  const guest = await connect()
  await guest.command('join', { code: created.room.code })
  await host.command('start')
  const playerIn = ({ state }) => state?.actors.find(({ id }) => id === created.playerId)

  assert.match((await host.command('play_action', { action: 'idle' })).error, /unavailable/)
  for (const action of ['phone', 'talk', 'dance', 'scream']) {
    assert.equal((await host.command('play_action', { action })).error, undefined)
    const selected = await guest.waitFor((message) => playerIn(message)?.pose.startsWith(`${action}-`))
    const actor = playerIn(selected)
    assert.match(actor.pose, /-(one|two|three)$/)
    assert.equal(actor.oneShot, undefined)
    const own = await host.waitFor((message) => playerIn(message)?.actionStartedAt === actor.actionStartedAt && message.state?.mode === 'action')
    assert.equal(playerIn(own).pose, actor.pose)
  }

  host.socket.send(JSON.stringify({ type: 'game_input', x: 1, y: 0, sprint: false }))
  const update = await guest.waitFor((message) => playerIn(message)?.pose === 'walk')
  assert.equal(playerIn(update).actionStartedAt, undefined)
})

async function approach(client, playerId, victimId) {
  let game = await client.waitFor(({ type }) => type === 'park')
  for (let tick = 0; tick < 80; tick++) {
    const actor = game.state.actors.find(({ id }) => id === playerId)
    const victim = game.state.actors.find(({ id }) => id === victimId)
    const dx = victim.x - actor.x
    const dy = victim.y - actor.y
    if (Math.hypot(dx, dy) <= 8) {
      client.socket.send(JSON.stringify({ type: 'game_input', x: 0, y: 0, sprint: false }))
      return
    }
    client.socket.send(JSON.stringify({ type: 'game_input',
      x: Math.abs(dx) > 4 ? Math.sign(dx) : 0,
      y: Math.abs(dy) > 4 ? Math.sign(dy) : 0, sprint: false }))
    game = await client.waitFor(({ type }) => type === 'park')
  }
  assert.fail('Could not move the test player within attack range')
}

test('combat broadcasts the same death timing and reconnect restores elimination and the winner', { timeout: 10_000 }, async (context) => {
  const connect = await setup(context, { reconnectGraceMs: 3000 })
  const host = await connect()
  const created = await host.command('create')
  const guest = await connect()
  const joined = await guest.command('join', { code: created.room.code })
  assert.match((await host.command('attack', { actorId: joined.playerId })).error, /Unknown room command/)
  await host.command('start')
  assert.match((await guest.command('spectate_area', { area: 1 })).error, /not spectating/)
  assert.match((await host.command('attack', { actorId: joined.playerId })).error, /20 pixels/)
  await approach(host, created.playerId, joined.playerId)
  assert.equal((await host.command('attack', { actorId: joined.playerId })).error, undefined)
  const hostDeath = await host.waitFor(({ state }) => state?.actors.some(({ id, life }) => id === joined.playerId && life === 'dying'))
  const guestDeath = await guest.waitFor(({ state }) => state?.life === 'dying')
  const corpse = hostDeath.state.actors.find(({ id }) => id === joined.playerId)
  const ownCorpse = guestDeath.state.actors.find(({ id }) => id === joined.playerId)
  assert.deepEqual(corpse.combat, ownCorpse.combat)
  assert.equal(corpse.vanishesAt, ownCorpse.vanishesAt)
  assert.equal(corpse.pose, 'death')
  assert.equal(hostDeath.state.killFlashAt, corpse.combat.startedAt)
  assert.equal(guestDeath.state.killFlashAt, undefined)
  assert.match((await guest.command('interact')).error, /cannot interact/)
  assert.match((await guest.command('attack', { actorId: created.playerId })).error, /cannot attack/)
  guest.socket.close()
  const replacement = await connect()
  assert.equal((await replacement.command('resume', { token: joined.token })).error, undefined)
  const recovered = await replacement.waitFor(({ state }) => state?.life === 'dying')
  assert.equal(recovered.state.actors.find(({ id }) => id === joined.playerId).vanishesAt, corpse.vanishesAt)
  const screamsIn = ({ state }) => state?.actors.filter(({ pose }) => pose.startsWith('scream-')) ?? []
  const [hostPanic, guestPanic] = await Promise.all([
    host.waitFor((message) => screamsIn(message).length > 0),
    replacement.waitFor((message) => screamsIn(message).length > 0),
  ])
  assert.deepEqual(screamsIn(hostPanic), screamsIn(guestPanic))
  assert.ok(screamsIn(hostPanic).every(({ actionStartedAt }) => actionStartedAt === corpse.combat.endsAt + 1000))
  const end = await replacement.waitFor(({ state }) => state?.spectating && state.winner, 4000)
  assert.equal(end.state.winner.id, created.playerId)
  assert.ok(end.state.actors.every(({ id }) => id !== created.playerId && id !== joined.playerId))
  assert.equal((await replacement.command('spectate_area', { area: 5 })).error, undefined)
  assert.equal((await replacement.waitFor(({ state }) => state?.area === 5)).state.spectating, true)
  replacement.socket.close()
  const spectator = await connect()
  await spectator.command('resume', { token: joined.token })
  const recoveredSpectator = await spectator.waitFor(({ state }) => state?.spectating && state.area === 5)
  assert.equal(recoveredSpectator.state.winner.id, created.playerId)
  await host.command('leave')
  await spectator.waitFor(({ type }) => type === 'room_closed')
})

test('Hitman reconnect during death recovers the five-second respawn and a green-boundary spawn', { timeout: 12_000 }, async (context) => {
  const connect = await setup(context, { reconnectGraceMs: 3000 })
  const host = await connect()
  const created = await host.command('create')
  await host.command('select_mode', { modeId: 'Hitman' })
  const guest = await connect()
  const joined = await guest.command('join', { code: created.room.code })
  await host.command('start')
  await approach(host, created.playerId, joined.playerId)
  assert.equal((await host.command('attack', { actorId: joined.playerId })).error, undefined)
  const death = await guest.waitFor(({ state }) => state?.life === 'dying')
  assert.ok(death.state.respawnMs > 4000 && death.state.respawnMs <= 5000)
  const startedAt = death.state.actors.find(({ id }) => id === joined.playerId).combat.startedAt
  guest.socket.close()
  const replacement = await connect()
  await replacement.command('resume', { token: joined.token })
  const restored = await replacement.waitFor(({ state }) => state?.life === 'dying')
  assert.ok(restored.state.respawnMs > 0)
  const waiting = await replacement.waitFor(({ state }) => state?.life === 'respawning', 4000)
  assert.equal(waiting.state.spectating, false)
  replacement.socket.close()
  const respawning = await connect()
  await respawning.command('resume', { token: joined.token })
  const recoveredWait = await respawning.waitFor(({ state }) => state?.life === 'respawning')
  assert.ok(recoveredWait.state.respawnMs > 0)
  const respawned = await respawning.waitFor(({ state }) => state?.life === 'alive', 4000)
  assert.ok(respawned.state.serverTime - startedAt >= 5000)
  assert.equal(respawned.state.respawnMs, 0)
  assert.equal(respawned.state.winner, null)
  const actor = respawned.state.actors.find(({ id }) => id === joined.playerId)
  const point = constrain(areas[respawned.state.area], actor.x, actor.y)
  assert.ok(Math.abs(point.x - actor.x) < 0.11 && Math.abs(point.y - actor.y) < 0.11)
  assert.equal(actor.pose, 'idle')
  assert.equal(actor.generation, 1)
  assert.equal(respawned.state.stamina, 100)
  assert.equal(respawned.state.profile, 33)
})

test('reconnecting a stunned killer preserves the shared stun deadline and target', { timeout: 10_000 }, async (context) => {
  const connect = await setup(context, { reconnectGraceMs: 3000 })
  const host = await connect()
  const created = await host.command('create')
  const members = []
  for (let index = 0; index < 2; index++) {
    const client = await connect()
    const joined = await client.command('join', { code: created.room.code })
    members.push({ client, ...joined })
  }
  await host.command('start')
  for (const member of members) {
    member.game = await member.client.waitFor(({ type }) => type === 'park')
  }
  const killer = members.find(({ game }) => game.state.target.name === 'Player 1')
  assert.ok(killer)
  await approach(host, created.playerId, killer.playerId)
  assert.equal((await host.command('attack', { actorId: killer.playerId })).error, undefined)
  const pre = await killer.client.waitFor(({ state }) => state?.actors.some(({ id, pose }) => id === killer.playerId && pose === 'pre-stun'))
  const reaction = pre.state.actors.find(({ id }) => id === killer.playerId)
  killer.client.socket.close()
  const replacement = await connect()
  await replacement.command('resume', { token: killer.token })
  const stun = await replacement.waitFor(({ state }) => state?.actors.some(({ id, pose }) => id === killer.playerId && pose === 'stun'))
  const stunned = stun.state.actors.find(({ id }) => id === killer.playerId)
  assert.equal(stunned.combat.startedAt, reaction.combat.endsAt)
  assert.equal(stunned.combat.endsAt, reaction.combat.endsAt + 3000)
  assert.deepEqual(stun.state.target, pre.state.target)
  assert.match((await replacement.command('interact')).error, /cannot interact/)
  replacement.socket.send(JSON.stringify({ type: 'game_input', x: 1, y: 0, sprint: true }))
  const still = await replacement.waitFor(({ state }) => state?.actors.some(({ id, pose }) => id === killer.playerId && pose === 'stun'))
  const same = still.state.actors.find(({ id }) => id === killer.playerId)
  assert.equal(same.x, stunned.x)
  assert.equal(same.y, stunned.y)
  const recovered = await replacement.waitFor(({ state }) => state?.actors.some(({ id, pose }) => id === killer.playerId && pose === 'idle'), 4000)
  assert.ok(recovered.state.serverTime >= stunned.combat.endsAt)
  assert.deepEqual(recovered.state.target, pre.state.target)
})

test('mode selection is host-only, synchronized, and restored on join and reconnect', { timeout: 5000 }, async (context) => {
  const connect = await setup(context)
  const host = await connect()
  const created = await host.command('create')
  assert.equal(created.room.selectedModeId, 'last_man_standing')
  assert.equal(created.room.slots.length, 6)

  const guest = await connect()
  const joined = await guest.command('join', { code: created.room.code })
  assert.equal(joined.room.selectedModeId, 'last_man_standing')
  assert.match((await guest.command('select_mode', { modeId: 'Hitman' })).error, /Only the host/)
  await host.command('set_ready', { playerId: created.playerId, ready: true })
  await guest.command('set_ready', { playerId: joined.playerId, ready: true })

  for (const modeId of ['Hitman', 'last_man_standing', 'Hitman']) {
    assert.equal((await host.command('select_mode', { modeId })).error, undefined)
    const update = await guest.waitFor(({ type, room }) => type === 'room' && room.selectedModeId === modeId)
    assert.equal(update.room.slots[0].ready, true)
    assert.equal(update.room.slots[1].ready, true)
  }
  for (const modeId of [undefined, null, 42, {}, [], 'missing', 'hitman', '__proto__', 'toString']) {
    assert.match((await host.command('select_mode', { modeId })).error, /unavailable/)
  }

  const lateGuest = await connect()
  const lateJoined = await lateGuest.command('join', { code: created.room.code })
  assert.equal(lateJoined.room.selectedModeId, 'Hitman')
  assert.equal(lateJoined.room.slots[0].ready, true)
  assert.equal(lateJoined.room.slots[1].ready, true)
  await host.waitFor(({ room }) => room?.slots[2]?.id === lateJoined.playerId)

  guest.socket.close()
  await host.waitFor(({ room }) => room?.slots[1]?.connected === false)
  await host.command('select_mode', { modeId: 'last_man_standing' })
  const replacement = await connect()
  const restored = await replacement.command('resume', { token: joined.token })
  assert.equal(restored.room.selectedModeId, 'last_man_standing')
  assert.equal(restored.room.slots[1].ready, true)

  assert.equal((await host.command('start')).error, undefined)
  assert.match((await host.command('select_mode', { modeId: 'Hitman' })).error, /only available in the lobby/)
  await host.command('leave')
  assert.equal((await host.command('create')).room.selectedModeId, 'last_man_standing')
})

test('a reconnect restores membership until the disconnect grace expires', { timeout: 5000 }, async (context) => {
  const connect = await setup(context)
  const host = await connect()
  const created = await host.command('create')
  const guest = await connect()
  const joined = await guest.command('join', { code: created.room.code })
  guest.socket.close()
  await host.waitFor(({ room }) => room?.slots[1]?.connected === false)
  const replacement = await connect()
  const restored = await replacement.command('resume', { token: joined.token })
  assert.equal(restored.playerId, joined.playerId)
  assert.equal(restored.room.slots[1].connected, true)
  assert.equal(restored.room.slots[1].name, 'Player 2')

  replacement.socket.close()
  await host.waitFor(({ type, room }) => type === 'room' && room.slots[1]?.connected === false)
  await host.waitFor(({ type, room }) => type === 'room' && room.slots[1] === null)
  const newGuest = await connect()
  assert.equal((await newGuest.command('resume', { token: joined.token })).code, 'SESSION_ENDED')
  await newGuest.command('join', { code: created.room.code })
  host.socket.close()
  await newGuest.waitFor(({ type }) => type === 'room_closed')
})

test('host Start opens Park for the current roster and reconnect recovers the same actor', { timeout: 5000 }, async (context) => {
  const connect = await setup(context)
  const host = await connect()
  const created = await host.command('create')
  assert.equal(created.room.selectedMapId, 'park')
  assert.equal(created.room.phase, 'lobby')
  assert.match((await host.command('select_map', { mapId: 'game_modes' })).error, /unavailable/)
  const guest = await connect()
  const joined = await guest.command('join', { code: created.room.code })
  assert.match((await guest.command('start')).error, /Only the host/)
  await host.command('add_bot', { index: 2 })
  const roster = await guest.waitFor(({ room }) => room?.slots.filter(Boolean).length === 3)
  const playerIds = new Set(roster.room.slots.filter(Boolean).map(({ id }) => id))
  const hostStart = new Promise((resolve) => {
    const captureStart = (event) => {
      const message = JSON.parse(event.toString())
      if (message.type !== 'park') return
      host.socket.off('message', captureStart)
      resolve(message)
    }
    host.socket.on('message', captureStart)
  })
  assert.equal((await host.command('start')).error, undefined)
  const game = await guest.waitFor(({ type }) => type === 'park')
  const players = game.state.actors.filter(({ id }) => playerIds.has(id))
  const npcs = game.state.actors.filter(({ id }) => !playerIds.has(id))
  assert.equal(players.length, 3)
  assert.equal(new Set(players.map(({ color }) => color)).size, 3)
  assert.equal(npcs.filter(({ pose }) => pose === 'walk').length, 3)
  const hostGame = await hostStart
  assert.deepEqual(hostGame.state.actors, game.state.actors)
  const original = game.state.actors.find(({ id }) => id === joined.playerId)
  guest.socket.send(JSON.stringify({ type: 'game_input', x: 1, y: 0, sprint: false }))
  const moved = await host.waitFor(({ state }) => state?.actors.some(({ id, x }) => id === joined.playerId && x > original.x))
  assert.equal(moved.state.area, 0)
  const stranger = await connect()
  assert.match((await stranger.command('join', { code: created.room.code })).error, /already started/)
  guest.socket.close()
  const replacement = await connect()
  const resumed = await replacement.command('resume', { token: joined.token })
  assert.equal(resumed.room.phase, 'park')
  const restored = await replacement.waitFor(({ type }) => type === 'park')
  const actor = restored.state.actors.find(({ id }) => id === joined.playerId)
  assert.equal(actor.color, original.color)
  assert.ok(actor.x > original.x)
  await host.command('leave')
  await replacement.waitFor(({ type }) => type === 'room_closed')
  const soloRoom = await host.command('create')
  assert.equal((await host.command('start')).error, undefined)
  const solo = await host.waitFor(({ type }) => type === 'park')
  assert.equal(solo.state.actors.filter(({ id }) => id === soloRoom.playerId).length, 1)
  assert.ok(solo.state.actors.some(({ pose }) => pose === 'talk' || pose.startsWith('phone-')))
})
