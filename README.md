# Musket War

A browser-based multiplayer PvP musket shooter set in the American Revolution.
Two lines of toy-soldier redcoats and continentals face each other across a
trampled field, fire wildly inaccurate muskets, fumble through historically
tedious reloads, keep formation or rout, and occasionally step in bear traps.

Simple, a bit funny, not zany. Built for a handful of trusted friends on
low-latency connections.

## Quick start

```bash
npm install

# Development (Vite dev server + game server, hot reload)
npm run dev          # client at http://localhost:5173, server on :8080

# Production (single process serves everything)
npm run build
npm start            # http://localhost:8080
```

Everyone opens the URL, picks a name, a team, a class, and hits READY.
The round starts when **every** connected player is ready (needs at least one
player and one infantryman per team).

```bash
npm run smoke        # end-to-end test: boots the server, runs bot privates
                     # through two full rounds (battle, revive, rout, escape)
npm run check        # typecheck all packages
```

## Deploying with Docker (e.g. a DigitalOcean droplet)

```bash
docker compose up -d --build   # build + run, serves on host port 8080
docker compose down            # stop and remove
```

Everything — HTTP, the built client, and the WebSocket — rides one port, so a
single mapping is all it needs. The host port defaults to **8080**; to use a
different one (it deliberately stays away from 8081):

```bash
MUSKET_PORT=9000 docker compose up -d --build
```

Players connect to `http://<droplet-ip>:8080/`. If you later put it behind a
TLS reverse proxy, proxy `/ws` as a WebSocket upgrade too — the client uses
`wss://` automatically on https pages.

## How to play

| Key / mouse | Action |
| --- | --- |
| WASD | move (relative to where you look) |
| Mouse | aim · **click** fires |
| R | begin the reload ritual (infantry) |
| E | revive a downed neighbor (medic) |
| Arrow keys | play your instrument (musician) / mash ⬇ to ram (reload) |
| F | drop a bear trap (retreating team only, 2 each) |
| M | mute |

### Classes

- **Infantry** — carries a musket: a generous ring aimer, a real projectile
  with drop, a spark → *bang* → wall of smoke. One hit puts a man down (not
  out). Reloading is a first-person, real-time ritual: pour powder into the
  pan (you will spill), snap the frizzen, pour the barrel, seat the cartridge,
  and mash the ramrod home. You cannot move while doing any of this.
- **Musician** — one fife and one drum per team. Notes scroll across a lane;
  hit them with the arrow keys (WASD still moves you). Every hit plays the
  next bar of the tune for the whole field and tightens your team's aim rings.
- **Medic** — walk to a downed man, press E: a measured pour of whiskey
  (release in the green — do not drown him), then three leeches, precisely
  placed. No tethers, no formation obligations.

### Formation, down-but-not-out, and the rout

Infantry spawn in a line, musicians at the ends. A colored tether links each
man to his neighbors — green is comfortable, yellow is stretching, red is
snapped. If **half or more** of your team's tethers are broken at any moment
(or nobody in the line is left standing), your formation breaks and the rout
begins.

A shot man is *down but not out*: he can crawl (and should — a crawling man
still holds his tether). A medic can get him up quickly; failing that, an NPC
circuit healer arrives on a visible countdown, WoW-graveyard style. That
healer is a scripted fallback, not an AI.

### The retreat sequence

When a line breaks, everyone hears about it. The routed side turns and runs
(with a fear-powered speed bonus) and each retreater can lay two bear traps.
The pursuers stand fast fixing bayonets; a whistle blows; then they
auto-sprint — fast but hard to steer — trying to touch the fleeing enemy with
cold steel while avoiding the traps. Retreaters who cross their home boundary
escape; the rest are caught. The pursuing team takes the field either way,
and the results screen hands out honors (sharpest shot, most powder spilled,
and so on).

## Architecture

```
shared/   constants, protocol types, movement sim, songs — imported by both sides
server/   authoritative Node.js game server (ws), 45 ticks/sec
client/   browser client: Vite + TypeScript + three.js
scripts/  smoke.ts — bot-driven end-to-end test
```

### Networking model

- **Dedicated authoritative server** over WebSockets (JSON messages — easy to
  read, easy to debug, plenty fast for a dozen friends). The server owns all
  important state: positions, hits, DBNO timers, formation, phases.
- **45 ticks/sec** simulation; snapshots broadcast every other tick (~22/s).
- **Client prediction** for your own movement: every frame is applied locally
  and shipped to the server in small batches; on each snapshot the client
  rewinds to the server's authoritative position and replays unacknowledged
  inputs (`shared/src/movement.ts` is the single movement implementation both
  sides run).
- **Interpolation** for everyone else: remote players render ~130 ms in the
  past between buffered snapshots.
- **Events, not state, for effects**: shots, hits, notes, traps, and revives
  are broadcast as discrete events; projectiles are simulated ballistically on
  both sides from the launch event, with the server's verdict (`proj_end`)
  authoritative for hits.
- **No anti-cheat, by design.** The server validates enough to keep the game
  coherent (ranges, phases, class rules); minigame outcomes are
  client-reported. This is a game for trusted friends; the engineering budget
  went to feel and clarity instead.

### Technology choices

- **three.js** for rendering: the standard, best-documented WebGL library;
  everything on screen is procedural low-poly (boxes, cones, sprite smoke).
- **No physics engine.** Movement is flat-plane kinematics with boundary
  clamping, and projectiles are three lines of ballistics. A physics library
  would add a dependency and a sync problem without adding gameplay; the
  bespoke sim lives in `shared/` so server and client can never disagree
  about how a soldier walks.
- **WebAudio synthesis** for all sound — musket bangs, the fife's Yankee
  Doodle, drum cadences, the pursuit whistle — no audio assets.

### Tuning

Nearly every gameplay number (speeds, spreads, tether lengths, timers) lives
in `shared/src/constants.ts` with a comment. Change, `npm run dev`, argue
with your friends, repeat.
