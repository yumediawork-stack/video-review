#!/usr/bin/env node
/**
 * Video Review — локальний агент трансляції.
 *
 * Що робить:
 *  1. Віддає MP4 з папки на вашому Mac по HTTP з Range-запитами (seek працює).
 *  2. Піднімає публічний тунель cloudflared (без акаунтів; URL на кожен запуск).
 *  3. Раз на хвилину реєструє тунель і поточний файл у Supabase
 *     (edge /functions/v1/agent-announce, агент-ключ). Новий файл → нова
 *     чернетка-версія в адмінці; опублікування — вручну.
 *
 * Запуск:
 *   node agent.mjs ./agent.json "/шлях/до/папки/з_експортом"
 * agent.json (береться з панелі адміна):
 *   { "projectId": "...", "agentToken": "...", "apiUrl": "https://<ref>.supabase.co" }
 *
 * Тунель: за бажанням заздалегідь `brew install cloudflared`;
 * якщо його нема — агент сам завантажить бінарник у agent/.bin.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : path.join(HERE, 'agent.json');
const WATCH_DIR = process.argv[3] ? path.resolve(process.argv[3]) : null;
const PORT = 8787;
const HEARTBEAT_MS = 60_000;
const STABILITY_MS = 15_000; // файл, ченний останні 15 c, вважаємо дописаним

function log(...a) { console.log(new Date().toLocaleTimeString('uk-UA'), ...a); }

if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Файл конфігу не знайдено: ${CONFIG_PATH}`);
  console.error('Скачайте agent.json з панелі адміна (розділ «Трансляція з PC») і запустіть: node agent.mjs ./agent.json "<папка>"');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
if (!cfg.projectId || !cfg.agentToken || !cfg.apiUrl) {
  console.error('agent.json має містити projectId, agentToken, apiUrl.');
  process.exit(1);
}
const watchDir = WATCH_DIR ?? (cfg.watchDir ? path.resolve(cfg.watchDir) : process.cwd());
if (!fs.existsSync(watchDir)) {
  console.error(`Папку спостереження не знайдено: ${watchDir}`);
  process.exit(1);
}
log('Проєкт:', cfg.projectId);
log('Папка спостереження:', watchDir);

// ------------------------------------------------------------------- стан
let currentFile = null;
const registry = new Map(); // versionId → { path, size }

// ------------------------------------------------------- HTTP Range-сервер
function parseRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  let start;
  let end;
  if (m[1] === '' && m[2] !== '') {
    start = Math.max(0, size - parseInt(m[2], 10));
    end = size - 1;
  } else {
    start = m[1] === '' ? 0 : parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : parseInt(m[2], 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return { tooBig: start >= size && end >= size };
  return { start, end: Math.min(end, size - 1), partial: start > 0 || end < size - 1 };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (u.pathname === '/' || u.pathname === '/health') {
      const st = currentFile ? fs.statSync(currentFile) : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        current: currentFile ? { name: path.basename(currentFile), size: st.size } : null,
        versions: [...registry.keys()].length,
      }));
      return;
    }
    const m = u.pathname.match(/^\/v\/([a-f0-9-]{36})\.mp4$/i);
    const target = (m && registry.get(m[1]) ? registry.get(m[1]).path : null) ?? currentFile;
    if (!target || !fs.existsSync(target)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Файл наразі недоступний.' }));
      return;
    }
    const size = fs.statSync(target).size;
    const range = parseRange(req.headers.range ?? '', size);
    if (!range || range.tooBig) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    const headers = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(range.end - range.start + 1),
      'Cache-Control': 'no-store',
    };
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    res.writeHead(range.partial ? 206 : 200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(target, { start: range.start, end: range.end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return;
  }
  res.writeHead(405);
  res.end();
});

function startServer() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve());
  });
}

// ------------------------------------------------------------------- тунель
function findCloudflared() {
  const candidates = [
    path.join(HERE, '.bin', 'cloudflared'),
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

async function ensureCloudflared() {
  const found = findCloudflared();
  if (found) return found;
  if (process.platform !== 'darwin') {
    throw new Error('Не знайдено cloudflared. Встановіть (brew install cloudflared) і перезапустіть.');
  }
  const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64';
  const dstDir = path.join(HERE, '.bin');
  fs.mkdirSync(dstDir, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`;
  const tgz = path.join(dstDir, 'cloudflared.tgz');
  log('Завантажую cloudflared (одноразово, ~25 МБ)…');
  execSync(`curl -sL --fail -o "${tgz}" "${url}"`, { stdio: 'inherit' });
  execSync(`tar -xzf "${tgz}" -C "${dstDir}"`, { stdio: 'inherit' });
  fs.unlinkSync(tgz);
  const dst = path.join(dstDir, 'cloudflared');
  fs.chmodSync(dst, 0o755);
  try { execSync(`xattr -d com.apple.quarantine "${dst}"`, { stdio: 'ignore' }); } catch { /* не критично */ }
  log('Готово:', dst);
  return dst;
}

async function startTunnel() {
  const bin = await ensureCloudflared();
  const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const publicUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Тунель не піднявся за 60 сек.')), 60_000);
    const handle = (buf) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`cloudflared завершився (code ${code})`)); });
  });
  return { child, publicUrl };
}

// ------------------------------------------------------------------- announce
async function announce(publicUrl) {
  if (!currentFile) {
    log('Announce пропущено: файл ще не обрано.');
    return null;
  }
  const st = fs.statSync(currentFile);
  try {
    const res = await fetch(`${cfg.apiUrl.replace(/\/+$/, '')}/functions/v1/agent-announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: cfg.agentToken,
        url: publicUrl,
        file: { name: path.basename(currentFile), size: st.size },
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.versionId) {
      registry.set(j.versionId, { path: currentFile, size: st.size });
      log(`Announce ok → версія ${String(j.versionId).slice(0, 8)}… (${j.created ? 'НОВА чернетка' : 'heartbeat'})`);
      return j.versionId;
    }
    log('Announce помилка:', res.status, j?.error?.message ?? '');
    return null;
  } catch (e) {
    log('Announce мережева помилка:', e.message);
    return null;
  }
}

// ------------------------------------------------------------------- папка
function latestStableMp4(dir) {
  let candidates = [];
  try {
    candidates = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.mp4'))
      .map((f) => {
        const p = path.join(dir, f);
        try {
          const st = fs.statSync(p);
          return { p, size: st.size, mtime: st.mtimeMs };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return null; }
  const newest = candidates[0];
  if (!newest) return null;
  // файл, який_output ще дописується ( недавно змінений) — не беремо
  if (Date.now() - newest.mtime < STABILITY_MS) return null;
  return newest.p;
}

function watchFolder() {
  const check = () => {
    const next = latestStableMp4(watchDir);
    if (next && next !== currentFile) {
      currentFile = next;
      log('Поточний файл →', path.basename(next));
      if (wasTunnelReady()) { void announce(lastPublicUrlRef()); }
    }
  };
  check();
  setInterval(check, 5_000);
}

// ------------------------------------------------------------------- main
let lastPublicUrl = null;
function lastPublicUrlRef() { return lastPublicUrl; }
function wasTunnelReady() { return lastPublicUrl != null; }

process.on('SIGINT', () => {
  log('\nЗупиняю агент і тунель…');
  try { server.close(); } catch { /* ignore */ }
  process.exit(0);
});

await startServer();
log(`Локальний сервер: http://127.0.0.1:${PORT}`);
watchFolder();
const { child, publicUrl } = await startTunnel();
lastPublicUrl = publicUrl;
log('');
log('ПУБЛІЧНИЙ URL ТУНЕЛЯ:', publicUrl);
log('(змінюється між перезапусками агенту — це нормально, адмінка отримує його сама)');
log('');
void announce(publicUrl);
setInterval(() => void announce(publicUrl), HEARTBEAT_MS);
child.on('exit', () => process.exit(1));
