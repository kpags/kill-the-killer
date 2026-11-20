import { createLobbyServer } from './lobby.js'

const port = Number(process.env.PORT || 8787)
const allowedOrigins = (process.env.ROOM_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
const server = createLobbyServer({ port, allowedOrigins })

server.on('listening', () => {
  console.log(`Room WebSocket listening on port ${server.address().port} (/ws)`)
})
