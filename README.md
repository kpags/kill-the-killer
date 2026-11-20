# Kill the Killer

## Run the online lobby

Install dependencies with `npm install`. Start the WebSocket server with `npm run server` in one terminal and the frontend with `npm run dev` in another. Open the Vite URL and use **Play** to create a room or **Join Room** to enter an invite code.

For devices on the same network, run `npm run dev -- --host 0.0.0.0` and open the Network URL printed by Vite on each device. Allow inbound traffic to the Vite port if the host firewall prompts you. Vite proxies `/ws` to the WebSocket server on port 8787. For a production-build check, keep the server running and use `npm run build` followed by `npm run preview`.

For hosting, serve `dist/` and reverse proxy `/ws` with WebSocket upgrades to the Node process. Preserve the public Host header. If the frontend and socket use separate origins, set `VITE_WS_URL` at build time to the complete secure WebSocket URL and set `ROOM_ALLOWED_ORIGINS` on the server to the frontend origin. The server accepts a comma-separated list of origins. Set `PORT` for both processes if using a custom backend port with Vite. Rooms live in one server process and reset when it restarts.

Run `npm test` to check the WebSocket lobby.
