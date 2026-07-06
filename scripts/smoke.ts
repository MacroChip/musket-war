// End-to-end smoke test: boots the server, connects two bot privates, and
// marches them through a complete round — lobby, volley, a downed man, a
// broken line, the retreat, a bear trap, an escape, and the results screen.
// Run with: npm run smoke

import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/src/protocol';

const PORT = 8123;
const url = `ws://localhost:${PORT}/ws`;

function fail(why: string): never {
  console.error(`\nSMOKE FAIL: ${why}`);
  process.exit(1);
}

class Bot {
  ws!: WebSocket;
  id = '';
  msgs: ServerMsg[] = [];
  waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  x = 0;
  z = 0;
  seq = 0;
  /** last known positions of everyone, from snapshots */
  poses = new Map<string, { x: number; z: number }>();

  constructor(readonly name: string) {}

  clearHistory(): void {
    this.msgs = [];
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on('open', () => {
        this.send({ type: 'hello', name: this.name });
        resolve();
      });
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as ServerMsg;
        if (msg.type === 'welcome') this.id = msg.id;
        if (msg.type === 'snap') {
          for (const p of msg.snap.players) {
            this.poses.set(p.id, { x: p.x, z: p.z });
            if (p.id === this.id) {
              this.x = p.x;
              this.z = p.z;
            }
          }
        }
        this.msgs.push(msg);
        for (let i = this.waiters.length - 1; i >= 0; i--) {
          const w = this.waiters[i]!;
          if (w.pred(msg)) {
            this.waiters.splice(i, 1);
            w.resolve(msg);
          }
        }
      });
    });
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Wait for a message matching pred (checks history first). */
  wait<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, timeoutMs: number, what: string): Promise<T>;
  wait(pred: (m: ServerMsg) => boolean, timeoutMs: number, what: string): Promise<ServerMsg>;
  wait(pred: (m: ServerMsg) => boolean, timeoutMs: number, what: string): Promise<ServerMsg> {
    const seen = this.msgs.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${what}`)), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  /** Stream movement inputs for `seconds`, moving forward at the given yaw. */
  async walk(yaw: number, seconds: number, forward = 1): Promise<void> {
    const stepMs = 33;
    const steps = Math.round((seconds * 1000) / stepMs);
    for (let i = 0; i < steps; i++) {
      this.send({
        type: 'input',
        steps: [{ seq: ++this.seq, dt: stepMs / 1000, mx: 0, my: forward, yaw, pitch: 0 }],
      });
      await sleep(stepMs);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('smoke: starting server...');
  const server = spawn('npx', ['tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`  [server!] ${d}`));
  const kill = (): void => {
    server.kill();
  };
  process.on('exit', kill);

  await sleep(1500);

  const alice = new Bot('Alice');
  const bob = new Bot('Bob');
  await alice.connect();
  await bob.connect();
  await alice.wait((m) => m.type === 'welcome', 3000, 'welcome A');
  await bob.wait((m) => m.type === 'welcome', 3000, 'welcome B');
  console.log(`smoke: connected as ${alice.id} / ${bob.id}`);

  alice.send({ type: 'join_team', team: 'red' });
  alice.send({ type: 'choose_class', cls: 'infantry' });
  bob.send({ type: 'join_team', team: 'blue' });
  bob.send({ type: 'choose_class', cls: 'infantry' });
  await sleep(200);
  alice.send({ type: 'ready', ready: true });
  bob.send({ type: 'ready', ready: true });

  const countdown = await alice.wait(
    (m) => m.type === 'phase' && m.phase === 'countdown',
    4000,
    'countdown phase',
  );
  if (countdown.type !== 'phase' || !countdown.setup) fail('countdown missing setup');
  const setup = countdown.setup;
  if (setup.lineOrder.red.length !== 1 || setup.lineOrder.blue.length !== 1) {
    fail(`bad lineOrder: ${JSON.stringify(setup.lineOrder)}`);
  }
  const alicePart = setup.participants.find((p) => p.id === alice.id)!;
  const bobPart = setup.participants.find((p) => p.id === bob.id)!;
  if (alicePart.z <= bobPart.z) fail('expected red line at +z and blue at -z');
  console.log('smoke: countdown OK, lines formed');

  await alice.wait((m) => m.type === 'phase' && m.phase === 'battle', 6000, 'battle phase');
  console.log('smoke: battle begins');

  // Alice advances toward Bob to point-blank musket range.
  await alice.walk(Math.PI, 5.6);
  const dist = Math.hypot(alice.x - bob.x, alice.z - bob.z);
  console.log(`smoke: after advance, Alice at (${alice.x.toFixed(1)}, ${alice.z.toFixed(1)}), range ${dist.toFixed(1)}`);
  if (dist > 14) fail(`Alice did not advance (range ${dist.toFixed(1)}) — movement/input pipeline broken?`);

  // Volley until Bob goes down. Each miss is followed by the reload ritual
  // (the bot version: instantaneous hands).
  let downed = false;
  for (let shot = 0; shot < 25 && !downed; shot++) {
    const yaw = Math.atan2(bob.x - alice.x, bob.z - alice.z);
    alice.send({ type: 'fire', yaw, pitch: 0.02 });
    try {
      await alice.wait(
        (m) => m.type === 'downed' && m.id === bob.id,
        900,
        'downed',
      );
      downed = true;
    } catch {
      alice.send({ type: 'reload_start' });
      await sleep(120);
      alice.send({ type: 'reload_done' });
      await sleep(120);
    }
  }
  if (!downed) fail('Bob never went down after 25 shots');
  console.log('smoke: Bob is down (but not out)');

  // A one-man line with its only man down = formation broken = rout.
  const retreat = await alice.wait(
    (m) => m.type === 'phase' && m.phase === 'retreat',
    3000,
    'retreat phase',
  );
  if (retreat.type !== 'phase' || retreat.retreatTeam !== 'blue') fail('expected blue to rout');
  console.log('smoke: blue line broken, retreat begins');

  // Bob flees toward his own edge and drops a bear trap on the way.
  bob.send({ type: 'lay_trap' });
  await alice.wait((m) => m.type === 'trap', 2000, 'trap broadcast');
  console.log('smoke: bear trap laid');

  const fleePromise = bob.walk(Math.PI, 6); // blue home edge is -z; yaw π faces -z
  await alice.wait((m) => m.type === 'retreat_stage' && m.stage === 'charge', 6000, 'whistle');
  console.log('smoke: whistle blown, pursuit on');
  // Alice steers her charge after Bob.
  const chase = (async () => {
    for (let i = 0; i < 150; i++) {
      const yaw = Math.atan2(bob.x - alice.x, bob.z - alice.z);
      alice.send({
        type: 'input',
        steps: [{ seq: ++alice.seq, dt: 0.033, mx: 0, my: 0, yaw, pitch: 0 }],
      });
      await sleep(33);
    }
  })();

  const escaped = await alice.wait((m) => m.type === 'escaped', 12_000, 'escape');
  if (escaped.type === 'escaped' && escaped.id !== bob.id) fail('wrong man escaped');
  console.log('smoke: Bob escaped the field');
  await fleePromise;
  void chase;

  const results = await alice.wait(
    (m) => m.type === 'phase' && m.phase === 'results',
    8000,
    'results phase',
  );
  if (results.type !== 'phase' || results.stats?.winner !== 'red') fail('expected red to win');
  if ((results.stats.downs[alice.id] ?? 0) < 1) fail('Alice has no downs in stats');
  if (!results.stats.escaped.includes(bob.id)) fail('Bob missing from escaped list');
  console.log('smoke: results OK (red wins, stats recorded)');

  await alice.wait((m) => m.type === 'phase' && m.phase === 'lobby', 15_000, 'return to lobby');
  console.log('smoke: back to lobby');

  // Snapshot sanity: server should have been ticking snapshots at ~22/s.
  const snapCount = alice.msgs.filter((m) => m.type === 'snap').length;
  if (snapCount < 100) fail(`too few snapshots seen (${snapCount})`);
  console.log(`smoke: ${snapCount} snapshots received`);
  console.log('smoke: SCENARIO 1 PASS — full 1v1 round\n');

  await scenario2(alice, bob);

  console.log('\nSMOKE PASS ✔ all scenarios completed');
  alice.ws.close();
  bob.ws.close();
  server.kill();
  process.exit(0);
}

/**
 * Scenario 2, same server, next round: two late joiners (a second blue
 * infantryman and a blue medic). Covers: medic revive, the tether-distance
 * formation break, and multi-round lobby flow.
 */
async function scenario2(alice: Bot, bob: Bot): Promise<void> {
  const carl = new Bot('Carl');
  const mel = new Bot('Mel');
  await carl.connect();
  await mel.connect();
  await carl.wait((m) => m.type === 'welcome', 3000, 'welcome C');
  await mel.wait((m) => m.type === 'welcome', 3000, 'welcome M');
  carl.send({ type: 'join_team', team: 'blue' });
  carl.send({ type: 'choose_class', cls: 'infantry' });
  mel.send({ type: 'join_team', team: 'blue' });
  mel.send({ type: 'choose_class', cls: 'medic' });
  await sleep(300);

  const bots = [alice, bob, carl, mel];
  for (const b of bots) b.clearHistory();
  for (const b of bots) b.send({ type: 'ready', ready: true });

  const countdown = await alice.wait(
    (m) => m.type === 'phase' && m.phase === 'countdown',
    4000,
    'round 2 countdown',
  );
  if (countdown.type !== 'phase' || !countdown.setup) fail('round 2 missing setup');
  if (countdown.setup.lineOrder.blue.length !== 2) {
    fail(`blue line should have 2 men, got ${countdown.setup.lineOrder.blue.length}`);
  }
  console.log('smoke2: round 2 forming, blue line of two');
  await alice.wait((m) => m.type === 'phase' && m.phase === 'battle', 6000, 'round 2 battle');

  // Alice advances and downs one of the blue infantry.
  await alice.walk(Math.PI, 5.6);
  const blueIds = new Set([bob.id, carl.id]);
  let victimId = '';
  for (let shot = 0; shot < 30 && !victimId; shot++) {
    const target = alice.poses.get(bob.id) ?? { x: 0, z: -20 };
    const yaw = Math.atan2(target.x - alice.x, target.z - alice.z);
    alice.send({ type: 'fire', yaw, pitch: 0.02 });
    try {
      const downed = await alice.wait(
        (m) => m.type === 'downed' && blueIds.has(m.id),
        900,
        'downed blue',
      );
      if (downed.type === 'downed') victimId = downed.id;
    } catch {
      alice.send({ type: 'reload_start' });
      await sleep(100);
      alice.send({ type: 'reload_done' });
      await sleep(100);
    }
  }
  if (!victimId) fail('no blue infantryman went down in round 2');
  console.log('smoke2: a blue man is down; the line holds (0/1 tethers broken)');

  // The line must NOT have routed: one downed man crawling in place keeps his tether.
  const routedEarly = alice.msgs.some((m) => m.type === 'phase' && m.phase === 'retreat');
  if (routedEarly) fail('formation broke while tethers were intact');

  // Mel marches to the casualty and administers whiskey and leeches.
  for (let i = 0; i < 150; i++) {
    const target = mel.poses.get(victimId)!;
    const d = Math.hypot(target.x - mel.x, target.z - mel.z);
    if (d < 2.0) break;
    const yaw = Math.atan2(target.x - mel.x, target.z - mel.z);
    mel.send({
      type: 'input',
      steps: [{ seq: ++mel.seq, dt: 0.033, mx: 0, my: 1, yaw, pitch: 0 }],
    });
    await sleep(33);
  }
  mel.send({ type: 'revive_start', target: victimId });
  await mel.wait(
    (m) => m.type === 'revive_begin' && m.medic === mel.id,
    2000,
    'revive_begin',
  );
  await sleep(400); // the QTE, performed with veteran speed
  mel.send({ type: 'revive_done', target: victimId });
  const revived = await alice.wait(
    (m) => m.type === 'revived' && m.id === victimId,
    2000,
    'revived',
  );
  if (revived.type === 'revived' && (revived.by !== mel.id || revived.auto)) {
    fail('revive not credited to the medic');
  }
  console.log('smoke2: medic revive confirmed');

  // Now Carl wanders off; a two-man line with its one tether snapped = rout.
  await carl.walk(Math.PI / 2, 2.5); // due +x, away from Bob
  const retreat = await alice.wait(
    (m) => m.type === 'phase' && m.phase === 'retreat',
    4000,
    'round 2 retreat (tether break)',
  );
  if (retreat.type === 'phase' && retreat.retreatTeam !== 'blue') fail('wrong team routed in round 2');
  console.log('smoke2: tether-distance formation break confirmed');

  // Everyone in blue runs for home so the round wraps up quickly.
  await Promise.all([bob.walk(Math.PI, 7), carl.walk(Math.PI, 7), mel.walk(Math.PI, 7)]);
  const results = await alice.wait(
    (m) => m.type === 'phase' && m.phase === 'results',
    20_000,
    'round 2 results',
  );
  if (results.type === 'phase' && (results.stats?.revives[mel.id] ?? 0) < 1) {
    fail('medic revive missing from stats');
  }
  console.log('smoke2: results carry the revive stat');
  carl.ws.close();
  mel.ws.close();
}

main().catch((err) => {
  fail(String(err?.message ?? err));
});
