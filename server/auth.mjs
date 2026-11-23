// FUEL — accounts: email + password (scrypt), signed httpOnly session cookie.
// Users live in a PRIVATE gist (server token only). No plain-text passwords,
// no password in logs, no user data in the token beyond id + expiry.
import { createHash, randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

const GH = 'https://api.github.com';
const TOKEN = process.env.GIST_TOKEN || null;
const FILE = 'fuel-users.json';
const DESC = 'FUEL auth users';

const SECRET = process.env.FUEL_SESSION_SECRET || (TOKEN ? createHash('sha256').update('fuel-sess|' + TOKEN).digest('hex') : 'dev-secret-not-for-production');
export const COOKIE = 'fuel_sess';
const MAX_AGE = 90 * 24 * 3600; // 90 days

/* ── storage ─────────────────────────────────────────────────────────── */
let mem = { users: {} };
let gistId = null;

async function gh(method, path, body) {
  const r = await fetch(GH + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fuel-auth', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const e = new Error('gh_' + r.status); e.detail = (await r.text()).slice(0, 200); throw e; }
  return r.json();
}

async function findGist() {
  if (gistId) return gistId;
  for (let page = 1; page <= 3; page++) {
    const list = await gh('GET', `/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => (g.description || '') === DESC);
    if (hit) { gistId = hit.id; return gistId; }
    if (list.length < 100) break;
  }
  const made = await gh('POST', '/gists', { description: DESC, public: false, files: { [FILE]: { content: JSON.stringify({ users: {} }) } } });
  gistId = made.id;
  return gistId;
}

async function readAll() {
  if (!TOKEN) return mem;
  try {
    const id = await findGist();
    const g = await gh('GET', `/gists/${id}`);
    const f = g.files?.[FILE];
    let txt = f?.content || '{}';
    if (!f?.content && f?.raw_url) txt = await (await fetch(f.raw_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).text();
    const parsed = JSON.parse(txt || '{}');
    return parsed && parsed.users ? parsed : { users: {} };
  } catch (e) {
    console.error('[auth] read failed:', e.detail || e.message);
    return mem; // never lock everyone out because GitHub blipped
  }
}

async function writeAll(data) {
  if (!TOKEN) { mem = data; return; }
  const id = await findGist();
  await gh('PATCH', `/gists/${id}`, { files: { [FILE]: { content: JSON.stringify(data) } } });
  mem = data;
}

/* ── passwords ───────────────────────────────────────────────────────── */
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 64).toString('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();

/* ── sessions ────────────────────────────────────────────────────────── */
const sign = (s) => createHmac('sha256', SECRET).update(s).digest('base64url');
export function makeToken(uid) {
  const body = Buffer.from(JSON.stringify({ uid, exp: Date.now() + MAX_AGE * 1000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function readToken(tok) {
  try {
    const [body, sig] = String(tok || '').split('.');
    if (!body || !sig) return null;
    const want = sign(body);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.uid || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
export function cookieHeader(uid) {
  return `${COOKIE}=${makeToken(uid)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* ── users ───────────────────────────────────────────────────────────── */
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, slot: u.slot, hasPin: !!u.pinHash, createdAt: u.createdAt });

export async function register({ name, email, password }) {
  const em = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw Object.assign(new Error('bad_email'), { status: 400 });
  if (String(password || '').length < 8) throw Object.assign(new Error('weak_password'), { status: 400 });
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) throw Object.assign(new Error('bad_name'), { status: 400 });
  const data = await readAll();
  if (Object.values(data.users).some((u) => u.email === em)) throw Object.assign(new Error('email_taken'), { status: 409 });
  const salt = randomBytes(16).toString('hex');
  const id = 'u_' + randomBytes(9).toString('base64url');
  const user = { id, name: nm, email: em, salt, hash: hashPw(password, salt), slot: 'acct-' + id, createdAt: Date.now() };
  data.users[id] = user;
  await writeAll(data);
  return user;
}

export async function login({ email, password }) {
  const em = normEmail(email);
  const data = await readAll();
  const user = Object.values(data.users).find((u) => u.email === em);
  if (!user) throw Object.assign(new Error('bad_login'), { status: 401 });
  const got = Buffer.from(hashPw(password, user.salt), 'hex');
  const want = Buffer.from(user.hash, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw Object.assign(new Error('bad_login'), { status: 401 });
  return user;
}

export async function byId(id) {
  const data = await readAll();
  return data.users[id] || null;
}

export async function setPin(id, pin) {
  const data = await readAll();
  const u = data.users[id];
  if (!u) throw Object.assign(new Error('no_user'), { status: 404 });
  if (!/^\d{4,6}$/.test(String(pin || ''))) throw Object.assign(new Error('bad_pin'), { status: 400 });
  const salt = randomBytes(16).toString('hex');
  u.pinSalt = salt; u.pinHash = hashPw(pin, salt);
  await writeAll(data);
  return true;
}

export async function checkPin(id, pin) {
  const u = await byId(id);
  if (!u || !u.pinHash) return false;
  const got = Buffer.from(hashPw(pin, u.pinSalt), 'hex');
  const want = Buffer.from(u.pinHash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/* ── middleware + rate limit ─────────────────────────────────────────── */
export function currentUser(req) {
  const t = readToken(parseCookies(req)[COOKIE]);
  return t ? t.uid : null;
}

export async function requireUser(req, res, next) {
  const uid = currentUser(req);
  if (!uid) return res.status(401).json({ error: 'auth_required' });
  const u = await byId(uid);
  if (!u) return res.status(401).json({ error: 'auth_required' });
  req.user = u;
  next();
}

// crude per-IP bucket: enough to stop scripted abuse of login/registration
const buckets = new Map();
export function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'x';
    const k = `${name}:${ip}`;
    const now = Date.now();
    const b = buckets.get(k) || { n: 0, reset: now + windowMs };
    if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
    b.n++;
    buckets.set(k, b);
    if (b.n > max) return res.status(429).json({ error: 'slow_down', message: 'Too many attempts — try again in a few minutes.' });
    next();
  };
}

// per-account daily AI budget: open signup must not mean open wallet
const aiUse = new Map();
export function aiBudget(kind, max) {
  return (req, res, next) => {
    const uid = req.user?.id || 'anon';
    const day = new Date().toISOString().slice(0, 10);
    const k = `${kind}:${uid}:${day}`;
    const n = (aiUse.get(k) || 0) + 1;
    aiUse.set(k, n);
    if (n > max) return res.status(429).json({ error: 'daily_limit', message: 'Daily AI limit reached for this account — it resets tomorrow.' });
    next();
  };
}
