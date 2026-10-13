// HTTP (static client) + WebSocket (game) on one port.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from './world.js';
import { Store } from './store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const TICK_HZ = 20;
const SAVE_EVERY_MS = 30_000;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Only these directories are served; everything else is a 404.
const STATIC_ROOTS = { '/shared/': path.join(root, 'shared'), '/': path.join(root, 'client') };

function serveStatic(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [prefix, dir] of Object.entries(STATIC_ROOTS)) {
    if (!url.startsWith(prefix)) continue;
    let rel = url.slice(prefix.length) || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir + path.sep) && file !== dir) break;
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
}

const store = new Store(process.env.DATA_DIR || path.join(root, 'data'));
const world = new World({ store });
const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,15}$/;

wss.on('connection', (ws) => {
  let player = null;
  const send = (m) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!player) {
      if (m.t !== 'join') return;
      const name = String(m.name || '');
      if (!NAME_RE.test(name)) return send({ t: 'error', text: 'Name: 3-16 letters/digits/underscore, starting with a letter.' });
      const res = world.join(name, send);
      if (res.error) return send({ t: 'error', text: res.error });
      player = res.player;
      send({ t: 'welcome', id: player.id });
      return;
    }
    try {
      world.handle(player, m);
    } catch (err) {
      console.error('handle error', err);
    }
  });
  ws.on('close', () => {
    if (player) world.leave(player.id);
  });
});

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  try {
    world.tick(dt);
  } catch (err) {
    console.error('tick error', err);
  }
}, 1000 / TICK_HZ);

setInterval(() => world.save(), SAVE_EVERY_MS);

function shutdown() {
  world.save();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Goblin MMO on http://localhost:${PORT}`));
