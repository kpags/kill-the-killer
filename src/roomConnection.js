import { ref } from 'vue'

const storageKey = 'kill-the-killer-room-session'
const reconnectWindowMs = 10_000

function loadSession() {
  try { return window.sessionStorage.getItem(storageKey) } catch { return null }
}

function saveSession(token) {
  try {
    if (token) window.sessionStorage.setItem(storageKey, token)
    else window.sessionStorage.removeItem(storageKey)
  } catch {
    // The live connection still works when browser storage is unavailable.
  }
}

export function createRoomConnection(onRoomClosed, onParkSounds) {
  const room = ref(null)
  const playerId = ref(null)
  const park = ref(null)
  const reconnecting = ref(false)
  const pending = new Map()
  let token = loadSession()
  let socket
  let opening
  let nextRequestId = 0
  let retryTimer
  let reconnectDeadline = 0
  let disposed = false

  function clearRoom() {
    clearTimeout(retryTimer)
    token = null
    saveSession(null)
    reconnectDeadline = 0
    reconnecting.value = false
    playerId.value = null
    room.value = null
    park.value = null
  }

  function roomClosed(reason = '') {
    clearRoom()
    onRoomClosed(reason)
  }

  function receive(event) {
    const message = JSON.parse(event.data)
    if (message.type === 'room_closed') {
      roomClosed(message.reason)
      return
    }
    if (message.type === 'room' && token) {
      room.value = message.room
      return
    }
    if (message.type === 'park' && token) {
      park.value = message.state
      return
    }
    if (message.type === 'park_sounds' && token) {
      if (room.value?.phase === 'park' && park.value?.area === message.area) onParkSounds(message.sounds)
      return
    }
    if (message.type !== 'result') return
    const request = pending.get(message.requestId)
    if (!request) return
    pending.delete(message.requestId)
    clearTimeout(request.timer)
    if (message.error) {
      request.reject(Object.assign(new Error(message.error), { code: message.code }))
      return
    }
    if (message.token) {
      token = message.token
      saveSession(token)
      playerId.value = message.playerId
      room.value = message.room
    }
    request.resolve()
  }

  function connect() {
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket)
    if (opening) return opening

    const url = new URL('/ws', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(import.meta.env.VITE_WS_URL || url)
    const connection = socket
    opening = new Promise((resolve, reject) => {
      const timer = setTimeout(() => connection.close(), 3000)
      connection.addEventListener('open', () => {
        clearTimeout(timer)
        opening = null
        resolve(connection)
      }, { once: true })
      connection.addEventListener('message', receive)
      connection.addEventListener('close', () => {
        clearTimeout(timer)
        socket = null
        opening = null
        const error = new Error('Could not reach the room server.')
        reject(error)
        for (const { reject: rejectRequest, timer: requestTimer } of pending.values()) {
          clearTimeout(requestTimer)
          rejectRequest(error)
        }
        pending.clear()
        if (token && !disposed && !reconnecting.value) beginReconnect()
      }, { once: true })
    })
    return opening
  }

  async function send(type, fields) {
    const connection = await connect()
    const requestId = ++nextRequestId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('The room server did not respond.'))
        connection.close()
      }, 4000)
      pending.set(requestId, { resolve, reject, timer })
      connection.send(JSON.stringify({ type, requestId, ...fields }))
    })
  }

  async function resume() {
    if (!token || disposed) return
    try {
      await send('resume', { token })
      reconnecting.value = false
    } catch (error) {
      if (!token || disposed) return
      if (error.code === 'SESSION_ENDED' || Date.now() >= reconnectDeadline) {
        roomClosed('Your room connection has ended.')
        return
      }
      retryTimer = setTimeout(resume, 650)
    }
  }

  function beginReconnect() {
    if (!token || reconnecting.value || disposed) return
    reconnecting.value = true
    reconnectDeadline = Date.now() + reconnectWindowMs
    retryTimer = setTimeout(resume, 250)
  }

  function command(type, fields) {
    if (reconnecting.value) throw new Error('Wait for the room to reconnect.')
    return send(type, fields)
  }

  return {
    room,
    playerId,
    park,
    reconnecting,
    input(fields) {
      if (!reconnecting.value && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 4096) {
        socket.send(JSON.stringify({ type: 'game_input', ...fields }))
      }
    },
    restore: beginReconnect,
    command,
    async leave() {
      try {
        await command('leave')
      } catch (error) {
        if (error.code !== 'SESSION_ENDED') throw error
      }
      clearRoom()
    },
    dispose() {
      disposed = true
      clearTimeout(retryTimer)
      socket?.close()
    },
  }
}
