import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { WebSocket, WebSocketServer } from 'ws'
import { capacity, compareMaps, normalizeInviteCode, normalizePlayerName, roomStartError } from '../shared/lobbyRules.js'
import { winnerDisplayMs } from '../shared/combat.js'
import { createParkSession, interactInPark, lockFiringRangeInPark, parkView, playParkAction, setParkInput,
  shootBasketballInPark, stepPark, stopParkInput } from './parkSession.js'
import { advanceParkCombat, attackInPark, equipParkItem, spectateInPark } from './parkCombat.js'
import { useSmokeInPark } from './parkSmoke.js'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const modeIds = Object.keys(JSON.parse(readFileSync(new URL('../data/game_modes.json', import.meta.url), 'utf8')))
const mapDirectory = new URL('../data/maps/', import.meta.url)
const mapIds = readdirSync(mapDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .flatMap((entry) => {
    const id = entry.name.slice(0, -5)
    const definition = JSON.parse(readFileSync(new URL(entry.name, mapDirectory), 'utf8'))
    return definition.id === id && definition.areas ? [id] : []
  })
  .sort(compareMaps)

export function createLobbyServer({
  port = 8787,
  host = '0.0.0.0',
  allowedOrigins = [],
  reconnectGraceMs = 10_000,
  availableMapIds = mapIds,
  createGame = createParkSession,
} = {}) {
  const rooms = new Map()
  const sessions = new Map()
  const server = new WebSocketServer({
    host,
    port,
    path: '/ws',
    maxPayload: 4096,
    verifyClient({ origin, req }) {
      if (!origin || allowedOrigins.includes(origin)) return true
      try {
        const url = new URL(origin)
        return ['http:', 'https:'].includes(url.protocol) && url.host === req.headers.host
      } catch {
        return false
      }
    },
  })

  function send(socket, message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  function snapshot(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      selectedModeId: room.selectedModeId,
      selectedMapId: room.selectedMapId,
      phase: room.game ? 'park' : 'lobby',
      slots: room.slots.map((player) => player && ({
        id: player.id,
        name: player.name,
        ready: player.ready,
        isBot: player.isBot,
        connected: player.isBot || Boolean(player.socket),
      })),
    }
  }

  function broadcast(room) {
    const message = { type: 'room', room: snapshot(room) }
    for (const player of room.slots) send(player?.socket, message)
  }

  function updateMatchDeadline(game, now) {
    if (game && !game.result && now >= game.matchEndsAt) advanceParkCombat(game, now)
  }

  function broadcastPark(room, now = performance.now()) {
    updateMatchDeadline(room.game, now)
    if (room.game.result && now >= room.game.resultAt) {
      room.game.returnHomeAt ??= now + winnerDisplayMs
      if (now >= room.game.returnHomeAt) {
        closeRoom(room)
        return
      }
    }
    for (const player of room.slots) {
      if (player?.socket && player.socket.bufferedAmount < 32_768) {
        const state = parkView(room.game, player.id, now)
        const sounds = room.game.soundEvents.get(state.area)
          ?.filter(({ listenerId }) => !listenerId || listenerId === player.id)
          .map(({ kind, variant }) => ({ kind, variant }))
        send(player.socket, { type: 'park', state })
        if (sounds?.length) send(player.socket, { type: 'park_sounds', area: state.area, sounds })
      }
    }
    room.game.soundEvents.clear()
  }

  function detach(player) {
    sessions.delete(player.token)
    clearTimeout(player.expiry)
    if (player.socket) player.socket.player = null
    player.socket = null
  }

  function closeRoom(room, reason, leavingHost) {
    rooms.delete(room.code)
    for (const member of room.slots) {
      if (!member || member.isBot) continue
      if (member !== leavingHost) send(member.socket, { type: 'room_closed', reason })
      detach(member)
    }
  }

  function removePlayer(player) {
    const room = player.room
    updateMatchDeadline(room.game, performance.now())
    if (player.id === room.hostId) {
      closeRoom(room, 'The host left the room.', player)
    } else {
      room.slots[room.slots.indexOf(player)] = null
      room.game?.players.delete(player.id)
      detach(player)
      broadcast(room)
    }
  }

  function addHuman(socket, room, index) {
    const number = room.slots.filter((player) => player && !player.isBot).length + 1
    const player = {
      id: randomUUID(),
      token: randomBytes(32).toString('hex'),
      name: `Player ${number}`,
      ready: false,
      isBot: false,
      socket,
      room,
    }
    room.slots[index] = player
    socket.player = player
    sessions.set(player.token, player)
    return player
  }

  function handle(socket, message) {
    const { requestId, type } = message
    const result = (fields = {}) => send(socket, { type: 'result', requestId, ...fields })
    const reject = (error, code) => result({ error, code })
    const confirmMembership = (player) => {
      result({ playerId: player.id, token: player.token, room: snapshot(player.room) })
      broadcast(player.room)
      if (player.room.game) broadcastPark(player.room)
    }
    const player = socket.player

    if (type === 'create' || type === 'join' || type === 'resume') {
      if (player) return reject('Leave your current room first.')

      if (type === 'resume') {
        const member = sessions.get(message.token)
        if (!member) return reject('Your room session has ended.', 'SESSION_ENDED')
        clearTimeout(member.expiry)
        const previousSocket = member.socket
        if (previousSocket) {
          stopParkInput(member.room.game?.players.get(member.id))
          previousSocket.player = null
          send(previousSocket, { type: 'room_closed', reason: 'This room session was opened in another tab.' })
          previousSocket.close()
        }
        socket.player = member
        member.socket = socket
        return confirmMembership(member)
      }

      if (type === 'create') {
        let code
        do {
          code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
        } while (rooms.has(code))
        const room = {
          code,
          hostId: null,
          selectedModeId: 'last_man_standing',
          selectedMapId: availableMapIds[0] ?? null,
          slots: Array(capacity).fill(null),
        }
        const hostPlayer = addHuman(socket, room, 0)
        room.hostId = hostPlayer.id
        rooms.set(code, room)
        return confirmMembership(hostPlayer)
      }

      const code = normalizeInviteCode(message.code)
      if (!code) return reject('Enter a six-character room code.')
      const room = rooms.get(code)
      if (!room) return reject('Room not found or already closed.')
      if (room.game) return reject('The room has already started playing.')
      const index = room.slots.indexOf(null)
      if (index < 0) return reject('This room is full.')
      return confirmMembership(addHuman(socket, room, index))
    }

    if (!player) return reject('You are not in a room.', 'SESSION_ENDED')
    const room = player.room
    const isHost = room.hostId === player.id
    if (type === 'leave') {
      removePlayer(player)
      return result()
    }
    if (room.game) {
      const now = performance.now()
      updateMatchDeadline(room.game, now)
      if (room.game.modeId === 'Hitman' && room.game.result && type !== 'spectate_area') {
        return reject('The match has ended.')
      }
      let interactionError
      if (type === 'interact') interactionError = interactInPark(room.game, player.id, now)
      else if (type === 'basketball_shot') interactionError = shootBasketballInPark(room.game, player.id, message.launch, now)
      else if (type === 'firing_range_lock') interactionError = lockFiringRangeInPark(room.game, player.id, now, message.aimedAt)
      else if (type === 'play_action') interactionError = playParkAction(room.game, player.id, message.action, now)
      else if (type === 'attack') interactionError = attackInPark(room.game, player.id, message.actorId, now, message.itemId)
      else if (type === 'equip_item') interactionError = equipParkItem(room.game, player.id, message.itemId)
      else if (type === 'use_smoke') interactionError = useSmokeInPark(room.game, player.id, now)
      else if (type === 'spectate_area') interactionError = spectateInPark(room.game, player.id, message.area)
      else return reject('This action is only available in the lobby.')
      if (interactionError) return reject(interactionError)
      broadcastPark(room)
      return result()
    }

    switch (type) {
      case 'start': {
        if (!isHost) return reject('Only the host can start.')
        if (room.selectedMapId !== 'park') return reject('This map is unavailable for gameplay.')
        const startError = roomStartError(snapshot(room).slots)
        if (startError) return reject(startError)
        room.game = createGame(room.slots.filter(Boolean), Math.random, room.selectedModeId, performance.now())
        broadcast(room)
        broadcastPark(room)
        return result()
      }
      case 'select_mode':
        if (!isHost) return reject('Only the host can select a mode.')
        if (!modeIds.includes(message.modeId)) return reject('That mode is unavailable.')
        room.selectedModeId = message.modeId
        break
      case 'select_map':
        if (!isHost) return reject('Only the host can select a map.')
        if (!availableMapIds.includes(message.mapId)) return reject('That map is unavailable.')
        room.selectedMapId = message.mapId
        break
      case 'add_bot': {
        if (!isHost) return reject('Only the host can add bots.')
        const index = message.index
        if (!Number.isInteger(index) || room.slots[index] !== null) return reject('That slot is unavailable.')
        room.slots[index] = { id: randomUUID(), name: `Bot${index + 1}`, ready: true, isBot: true }
        break
      }
      case 'rename': {
        const target = room.slots.find((member) => member && member.id === message.playerId)
        if (!target || (target !== player && !(isHost && target.isBot))) return reject('You cannot edit that name.')
        const name = normalizePlayerName(message.name)
        if (!name) return reject('Use 1–10 letters, digits, or internal spaces.')
        target.name = name
        break
      }
      case 'set_ready':
        if (typeof message.ready !== 'boolean' || message.playerId !== player.id) {
          return reject('You can only change your own readiness.')
        }
        player.ready = message.ready
        break
      default:
        return reject('Unknown room command.')
    }

    broadcast(room)
    result()
  }

  server.on('connection', (socket) => {
    socket.alive = true
    socket.on('pong', () => { socket.alive = true })
    socket.on('error', () => socket.terminate())
    socket.on('message', (raw, isBinary) => {
      if (isBinary) return
      let message
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message?.type === 'game_input') {
        const game = socket.player?.room.game
        const now = performance.now()
        if (game && !game.result && (game.modeId !== 'Hitman' || now < game.matchEndsAt)) {
          setParkInput(game.players.get(socket.player.id), message, now)
        }
        return
      }
      if (message && Number.isSafeInteger(message.requestId)) handle(socket, message)
    })
    socket.on('close', () => {
      const player = socket.player
      if (!player || player.socket !== socket) return
      player.socket = null
      stopParkInput(player.room.game?.players.get(player.id))
      broadcast(player.room)
      player.expiry = setTimeout(() => removePlayer(player), reconnectGraceMs)
      player.expiry.unref()
    })
  })

  const heartbeat = setInterval(() => {
    for (const socket of server.clients) {
      if (!socket.alive) {
        socket.terminate()
        continue
      }
      socket.alive = false
      socket.ping()
    }
  }, 10_000)
  heartbeat.unref()
  let lastTick = performance.now()
  const simulation = setInterval(() => {
    const now = performance.now()
    const elapsed = Math.min(now - lastTick, 100)
    lastTick = now
    for (const room of rooms.values()) {
      if (!room.game) continue
      stepPark(room.game, elapsed, now)
      broadcastPark(room, now)
    }
  }, 50)
  simulation.unref()
  server.on('close', () => {
    clearInterval(heartbeat)
    clearInterval(simulation)
    for (const player of sessions.values()) clearTimeout(player.expiry)
  })
  return server
}
