import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { TICK_MS } from '../../shared/src/constants';
import { parseClientMsg } from '../../shared/src/protocol';
import { Game } from './game';

const PORT = Number(process.env.PORT) || 8080;
const here = fileURLToPath(new URL('.', import.meta.url));
const clientDist = resolve(here, '../../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const httpServer = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  // Serve the built client if it exists (production single-process deploy).
  const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(clientDist, rel === '/' || rel === '\\' ? 'index.html' : rel);
  try {
    const s = await stat(filePath).catch(() => null);
    if (!s || !s.isFile()) filePath = join(clientDist, 'index.html'); // SPA fallback
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Client not built. Run `npm run build`, or use `npm run dev` and open the Vite URL.');
  }
});

const game = new Game();
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  let playerId: string | null = null;

  ws.on('message', (data) => {
    const msg = parseClientMsg(data.toString());
    if (!msg) return;
    if (!playerId) {
      if (msg.type === 'hello') {
        playerId = game.addPlayer(ws, msg.name)?.id ?? null;
      }
      return;
    }
    game.handleMessageById(playerId, msg);
  });

  ws.on('close', () => {
    if (playerId) game.removePlayer(playerId);
  });
  ws.on('error', () => {
    /* close handler does the cleanup */
  });
});

setInterval(() => game.tick(), TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`[musket-war] server listening on http://localhost:${PORT} (ws at /ws, ${Math.round(1000 / TICK_MS)} ticks/s)`);
});
