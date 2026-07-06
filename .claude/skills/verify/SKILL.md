---
name: verify
description: Build, launch, and drive Musket War to verify changes at its real surfaces (WebSocket game server + browser client).
---

# Verifying Musket War changes

Two surfaces. Server/gameplay changes are observed over the WebSocket
protocol; UI changes are observed in a real browser. `npm run smoke` is CI's
job — drive the surfaces directly instead.

## Launch

```bash
npm install
npm run build                                  # typecheck + vite build (client/dist)
PORT=8123 npx tsx server/src/index.ts &        # serves ws at /ws AND the built client
curl -s http://localhost:8123/healthz          # "ok" when up
```

One process serves everything; use different PORTs for parallel scenarios.

## Drive the server surface (bots, phases, AI behavior)

Write a node .mjs script importing `ws` from this repo's node_modules and
speak the protocol in `shared/src/protocol.ts` (see `scripts/smoke.ts` for
the message dance). Key gotchas learned the hard way:

- `hello` → `welcome` gives your id. Lobby state arrives as full `lobby`
  broadcasts; **poll the latest one** rather than matching message history —
  history matching hits stale states after add/remove churn.
- A round needs ≥1 infantry per team and *every* player ready.
- Positions come from `snap` messages (~22/s), only outside the lobby phase.
- Movement is streamed input steps ~30/s: `{type:'input',steps:[{seq,dt,mx,my,yaw,pitch}]}`.
  Blue faces +z (yaw 0), red faces -z (yaw π). `my` is forward along yaw.
- A lone human infantryman under AI fire gets shot: keep him moving
  (strafe/retreat) or out of `BOT_FIRE_RANGE` (55) or the round routs early.
- AI infantry volley immediately at battle start if the enemy is in range,
  then reload frozen for `BOT_RELOAD_MS` (7–9.5s) — time maneuvers around it.

## Drive the GUI surface

`playwright-core` + `executablePath: '/opt/pw-browsers/chromium'` against the
production server (it serves `client/dist`). Flow: fill `#name-input`, click
`#name-go`, wait for `#lobby:not(.hidden)`.

- **Park the mouse (`page.mouse.move(5,5)`) before measuring layout** —
  `button:hover` translates buttons up 1px by design.
- Lobby is server-driven: a second `newPage` joining is the cheap way to
  check broadcast state.
- Headless software GL renders ~11 FPS; don't assert high frame rates.
