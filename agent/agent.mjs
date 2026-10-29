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
import readline from 'node:readline';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8787;
const HEARTBEAT_MS = 60_000;
const STABILITY_MS = 15_000; // файл, не чienий 15 с, вважаємо дописаним

// ----------------------------------------------------------------- аргументи
// Режим 1 (підключення з веб-інтерфейсу, одним рядком command):
//   node agent.mjs --api <Supabase URL> --token <агент-токен> [--watch <папка>]
// Режим 2 (старий/локальний): node agent.mjs [agent.json] [watchDir]
function parseArgs() {
  const a = process.argv.slice(2);
  const out = { config: null, watch: null, api: null, token: null };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const next = a[i + 1];
    if (k === '--api') { out.api = next; i++; continue; }
    if (k.startsWith('--api=')) { out.api = k.slice(6); continue; }
    if (k === '--token') { out.token = next; i++; continue; }
    if (k.startsWith('--token=')) { out.token = k.slice(8); continue; }
    if (k === '--watch') { out.watch = next; i++; continue; }
    if (k.startsWith('--watch=')) { out.watch = k.slice(8); continue; }
    if (!k.startsWith('--') && out.config === null) { out.config = k; continue; }
    if (!k.startsWith('--')) out.watch = k;
  }
  return out;
}
const argv = parseArgs();
const CONFIG_PATH = argv.config ? path.resolve(argv.config) : path.join(HERE, 'agent.json');

function log(...a) { console.log(new Date().toLocaleTimeString('uk-UA'), ...a); }

/**
 * Режим 1: агент сам отримує конфіг за токеном (без файлів/клавіш).
 * Зберігає agent.json для наступних запусків без аргументів.
 */
async function bootstrapConfig() {
  if (!argv.api || !argv.token) {
    console.error('Для підключення з веб-інтерфейсу вкажіть: --api <Supabase URL> --token <агент-токен>');
    console.error('Готову команду копіюйте з адмінки → розділ «Трансляція з PC».');
    process.exit(1);
  }
  const res = await fetch(`${argv.api.replace(/\/+$/, '')}/functions/v1/agent-bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: argv.token }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Bootstrap не вдалися (${res.status}):`, j?.error?.message ?? '');
    process.exit(1);
  }
  const cfg = {
    projectId: j.projectId,
    agentToken: argv.token,
    apiUrl: j.apiUrl,
    publicKey: j.publicKey,
    watchDir: argv.watch,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  log(`Конфіг збережено: ${CONFIG_PATH}`);
  return cfg;
}

async function loadConfig() {
  if (argv.token) return bootstrapConfig();
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Файл конфігу не знайдено: ${CONFIG_PATH}`);
    console.error('Команду для підключення копіюйте з адмінки → розділ «Трансляція з PC».');
    process.exit(1);
  }
  const cfg = readJson(CONFIG_PATH);
  if (!cfg.projectId || !cfg.agentToken || !cfg.apiUrl) {
    console.error('agent.json має містити projectId, agentToken, apiUrl.');
    process.exit(1);
  }
  return cfg;
}

/** JSON із терпимістю до BOM (Windows Set-Content UTF8 додає BOM). */
function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(clean);
}

// ------------------------------------------------------------------- стан
let currentFile = null;
const registry = new Map(); // versionId → { path, size }
let lastPublicUrl = null; // базовий URL поточного тунеля

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
/**
 * Визначає файл для завантаження з Cloudflare releases:
 *  win32 → cloudflared-windows-amd64.exe (звичайний exe, без tar)
 *  darwin → cloudflared-darwin-arm64|amd64.tgz
 *  linux → cloudflared-linux-amd64 (звичайний бінарник)
 */
function cloudflaredTarget(platform = process.platform, arch = os.arch()) {
  if (platform === 'win32') {
    return { asset: 'cloudflared-windows-amd64.exe', dstName: 'cloudflared.exe', kind: 'raw' };
  }
  if (platform === 'darwin') {
    const a = arch === 'arm64' ? 'arm64' : 'amd64';
    return { asset: `cloudflared-darwin-${a}.tgz`, dstName: 'cloudflared', kind: 'tgz' };
  }
  return { asset: 'cloudflared-linux-amd64', dstName: 'cloudflared', kind: 'raw' };
}

function findCloudflared() {
  const { dstName } = cloudflaredTarget();
  const binName = process.platform === 'win32' ? `${dstName}.exe` : dstName;
  const candidates = [
    path.join(HERE, '.bin', binName),
    ...(process.platform === 'win32'
      ? [path.join(os.homedir(), 'Program Files (x86)', 'cloudflared', 'cloudflared.exe')]
      : ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

async function download(url, dst) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Завантаження ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dst, buf);
}

async function extractTgz(tgz, dstDir) {
  // tar є у Windows 10+ (bsdtar), macOS, Linux
  execSync(`tar -xzf "${tgz}" -C "${dstDir}"`, { stdio: 'inherit', windowsHide: true });
}

async function ensureCloudflared() {
  const found = findCloudflared();
  if (found) return found;
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    throw new Error('Не знайдено cloudflared. Встановіть його (brew install cloudflared / winget install Cloudflare.cloudflared) і перезапустіть.');
  }
  const { asset, dstName, kind } = cloudflaredTarget();
  const dstDir = path.join(HERE, '.bin');
  fs.mkdirSync(dstDir, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
  const tmp = path.join(dstDir, asset.replace('.tgz', '.download'));
  const dst = path.join(dstDir, dstName);
  log(`Завантажую cloudflared ${asset} (одноразово, ~25 МБ)…`);
  await download(url, tmp);
  if (kind === 'tgz') {
    await extractTgz(tmp, dstDir);
    fs.rmSync(tmp, { force: true });
  } else if (tmp !== dst) {
    fs.renameSync(tmp, dst);
  }
  if (process.platform !== 'win32') fs.chmodSync(dst, 0o755);
  try {
    if (process.platform !== 'win32') execSync(`xattr -d com.apple.quarantine "${dst}"`, { stdio: 'ignore' });
  } catch { /* не критично */ }
  log('Готово:', dst);
  return dst;
}

/** Node fetch здатен церпіти повільну мережу (наш шлях до CF API ~25-36 c). */
async function registerQuickTunnel() {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch('https://api.trycloudflare.com/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(90_000),
      });
      const j = await res.json().catch(() => null);
      if (j && j.success && j.result?.id && j.result?.hostname) {
        const b64 = Buffer.from(JSON.stringify({ a: j.result.account_tag, t: j.result.id, s: j.result.secret })).toString('base64');
        return { token: b64, hostname: j.result.hostname };
      }
      lastErr = new Error('API не дав tunnel-дані: ' + JSON.stringify(j?.errors ?? '').slice(0, 120));
    } catch (e) {
      lastErr = e;
      log(`Реєстрація тунеля (${i + 1}/4) не вдалася: ${e.message} → ще раз…`);
    }
    await delay(2_000);
  }
  throw lastErr ?? new Error('Реєстрація тунеля не вдалася.');
}

async function startTunnelAttempt() {
  const bin = await ensureCloudflared();
  const reg = await registerQuickTunnel();
  const child = spawn(bin, ['tunnel', 'run', '--token', reg.token, '--url', `http://127.0.0.1:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // URL відомий із реєстрації; чекаємо ≥2 «Registered tunnel connection»
  await new Promise((resolve, reject) => {
    let seen = 0;
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error('cloudflared не підключився за 45 с.'));
    }, 45_000);
    const handle = (buf) => {
      if (String(buf).includes('Registered tunnel connection')) {
        seen += 1;
        if (seen >= 2) { clearTimeout(timer); resolve(); }
      }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`cloudflared завершився (code ${code})`)); });
  });
  return { child, publicUrl: `https://${reg.hostname}` };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function startTunnelWithRetry(maxAttempts = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log(`Тунель: спроба ${attempt}/${maxAttempts}…`);
      return await startTunnelAttempt();
    } catch (e) {
      log(`Тунель не вдався: ${e.message}`);
      if (attempt < maxAttempts) await delay(2_000);
    }
  }
  throw new Error('Тунель не піднявся після всіх спроб. Перевірте інтернет або `brew install cloudflared`.');
}

// ------------------------------------------------------------------- announce
async function announce(publicUrl) {
  if (!currentFile) {
    log('Announce пропущено: файл ще не обрано.');
    return null;
  }
  const st = fs.statSync(currentFile);
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.publicKey) {
    // publishable key — публічне значення; платформа вимагає валідний JWT
    headers.Authorization = `Bearer ${cfg.publicKey}`;
    headers.apikey = cfg.publicKey;
  }
  try {
    const res = await fetch(`${cfg.apiUrl.replace(/\/+$/, '')}/functions/v1/agent-announce`, {
      method: 'POST',
      headers,
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
  // файл, який ще дописується (змінений хвилину тому) — не беремо
  if (Date.now() - newest.mtime < STABILITY_MS) return null;
  return newest.p;
}

function watchFolder(dir) {
  const check = () => {
    const next = latestStableMp4(dir);
    if (next && next !== currentFile) {
      currentFile = next;
      log('Поточний файл →', path.basename(next));
      if (lastPublicUrl) {
        void announce(lastPublicUrl);
      }
    }
  };
  check();
  setInterval(() => check(), 5_000);
}
let heartbeatTimer = null;

async function runTunnelLoop() {
  for (;;) {
    try {
      const { child, publicUrl } = await startTunnelWithRetry();
      lastPublicUrl = publicUrl;
      log('');
      log('ПУБЛІЧНИЙ URL ТУНЕЛЯ:', publicUrl);
      log('(змінюється між перезапусками агенту — це нормально, адмінка отримує його сама)');
      log('');
      await announce(publicUrl);
      if (!heartbeatTimer) {
        heartbeatTimer = setInterval(() => void announce(publicUrl), HEARTBEAT_MS);
      } else {
        // оновлюємо підхоплений URL у heartbeat без створення другого таймер-циклу
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => void announce(publicUrl), HEARTBEAT_MS);
      }
      await new Promise((resolve) => {
        child.on('exit', (code) => {
          log(`cloudflared завершився (code ${code}) — перезапускаю тунель…`);
          resolve();
        });
      });
      await delay(3_000);
    } catch (e) {
      log('Цикл тунеля:', e.message);
      log('Повторно за 15 с…');
      await delay(15_000);
    }
  }
}

process.on('SIGINT', () => {
  log('\nЗупиняю агент і тунель…');
  try { server.close(); } catch { /* ignore */ }
  process.exit(0);
});

// ----------------------------------------------------------------- main
const cfg = await loadConfig();
let watchDir = argv.watch || cfg.watchDir ? path.resolve(argv.watch || cfg.watchDir) : null;

// Теку немає → пропонуємо створити тут же (одна клавіша замість ре-налаштування).
if (watchDir && !fs.existsSync(watchDir) && process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`Теки немає: ${watchDir}\nСтворити її зараз? [Enter = так / n = ні]: `);
  rl.close();
  if (ans.trim() === '' || /^(y|yes|д|так)$/i.test(ans.trim())) {
    try {
      fs.mkdirSync(watchDir, { recursive: true });
      log('Теку створено:', watchDir);
    } catch (e) {
      console.error('Не вдалося створити теку:', e.message);
    }
  } else {
    console.error('Ок — вкажіть існуючу теку, куди DaVinci складає MP4, і запустіть знову.');
  }
}
if (watchDir && fs.existsSync(watchDir) && fs.statSync(watchDir).isFile()) {
  console.error('Шлях вказує на файл, а не на теку:', watchDir);
  process.exit(1);
}
if (!watchDir || !fs.existsSync(watchDir)) {
  console.error(`Теку спостереження не знайдено: ${watchDir ?? '(не задано)'}`);
  console.error('Створіть теку або вкажіть шлях до неї — і запустіть знову.');
  process.exit(1);
}
log('Проєкт:', cfg.projectId);
log('Теку спостереження:', watchDir);

await startServer();
log(`Локальний сервер: http://127.0.0.1:${PORT}`);
watchFolder(watchDir);
await runTunnelLoop();
