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
let memAt = 0;
let gistId = null;
const CACHE_MS = 30000;

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

async function readAll({ fresh = false } = {}) {
  if (!TOKEN) return mem;
  if (!fresh && memAt && Date.now() - memAt < CACHE_MS) return mem;
  try {
    const id = await findGist();
    const g = await gh('GET', `/gists/${id}`);
    const f = g.files?.[FILE];
    let txt = f?.content || '{}';
    if (!f?.content && f?.raw_url) txt = await (await fetch(f.raw_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).text();
    const parsed = JSON.parse(txt || '{}');
    const out = parsed && parsed.users ? parsed : { users: {} };
    mem = out; memAt = Date.now();
    return out;
  } catch (e) {
    console.error('[auth] read failed:', e.detail || e.message);
    return mem; // never lock everyone out because GitHub blipped
  }
}

async function writeAll(data) {
  if (!TOKEN) { mem = data; return; }
  const id = await findGist();
  await gh('PATCH', `/gists/${id}`, { files: { [FILE]: { content: JSON.stringify(data) } } });
  mem = data; memAt = Date.now();
}

/* ── passwords ───────────────────────────────────────────────────────── */
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 64).toString('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();

/* ── sessions ────────────────────────────────────────────────────────── */
const sign = (s) => createHmac('sha256', SECRET).update(s).digest('base64url');
export function makeToken(uid, v = 1) {
  const body = Buffer.from(JSON.stringify({ uid, v, exp: Date.now() + MAX_AGE * 1000 })).toString('base64url');
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
export function cookieHeader(uid, v = 1) {
  return `${COOKIE}=${makeToken(uid, v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
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
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, slot: u.slot, hasPin: !!u.pinHash, emailVerified: !!u.emailVerified, createdAt: u.createdAt });

export async function register({ name, email, password }) {
  const em = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw Object.assign(new Error('bad_email'), { status: 400 });
  if (String(password || '').length < 8) throw Object.assign(new Error('weak_password'), { status: 400 });
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) throw Object.assign(new Error('bad_name'), { status: 400 });
  const data = await readAll({ fresh: true });
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
  const data = await readAll({ fresh: true });
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

/* ── recovery codes + password reset ─────────────────────────────────── */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newRecovery() {
  let out = '';
  const bytes = randomBytes(12);
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  const code = `FUEL-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
  const salt = randomBytes(16).toString('hex');
  return { code, salt, hash: hashPw(code.replace(/-/g, '').toUpperCase(), salt) };
}

export async function setRecovery(id, code) {
  const data = await readAll({ fresh: true });
  const u = data.users[id];
  if (!u) throw Object.assign(new Error('no_user'), { status: 404 });
  const clean = String(code || '').replace(/-/g, '').toUpperCase();
  const salt = randomBytes(16).toString('hex');
  u.recoverySalt = salt;
  u.recoveryHash = hashPw(clean, salt);
  await writeAll(data);
}

export async function checkRecovery(id, code) {
  const u = await byId(id);
  if (!u || !u.recoveryHash) return false;
  const clean = String(code || '').replace(/-/g, '').toUpperCase();
  const got = Buffer.from(hashPw(clean, u.recoverySalt), 'hex');
  const want = Buffer.from(u.recoveryHash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** create a 6-digit code for the account; null when the email is unknown (no enumeration) */
export async function beginReset(email) {
  const em = normEmail(email);
  const data = await readAll({ fresh: true });
  const u = Object.values(data.users).find((x) => x.email === em);
  if (!u) return null;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const salt = randomBytes(16).toString('hex');
  u.resetSalt = salt;
  u.resetHash = hashPw(code, salt);
  u.resetExp = Date.now() + 30 * 60 * 1000;
  u.resetTries = 0;
  await writeAll(data);
  return { user: u, code };
}

/** verify the emailed 6-digit code -> short-lived signed reset token */
export async function verifyResetCode(email, code) {
  const em = normEmail(email);
  const data = await readAll({ fresh: true });
  const u = Object.values(data.users).find((x) => x.email === em);
  const bad = Object.assign(new Error('bad_code'), { status: 400 });
  if (!u || !u.resetHash) throw bad;
  if (!u.resetExp || Date.now() > u.resetExp) throw bad;
  if ((u.resetTries || 0) >= 5) throw Object.assign(new Error('too_many'), { status: 429 });
  const got = Buffer.from(hashPw(String(code || '').trim(), u.resetSalt), 'hex');
  const want = Buffer.from(u.resetHash, 'hex');
  const ok = got.length === want.length && timingSafeEqual(got, want);
  if (!ok) {
    u.resetTries = (u.resetTries || 0) + 1;
    await writeAll(data);
    throw bad;
  }
  u.resetHash = undefined;
  u.resetSalt = undefined;
  u.resetExp = undefined;
  u.resetTries = 0;
  await writeAll(data);
  const body = Buffer.from(JSON.stringify({ uid: u.id, purpose: 'reset', exp: Date.now() + 20 * 60 * 1000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** set a new password from an emailed link token */
export async function resetWithToken(token, password) {
  const [body, sig] = String(token || '').split('.');
  const bad = Object.assign(new Error('bad_token'), { status: 400 });
  if (!body || !sig) throw bad;
  const want = sign(body);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw bad;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (p.purpose !== 'reset' || !p.exp || p.exp < Date.now()) throw bad;
  return setPassword(p.uid, password);
}

export async function resetWithRecovery(email, recovery, password) {
  const em = normEmail(email);
  const data = await readAll({ fresh: true });
  const u = Object.values(data.users).find((x) => x.email === em);
  if (!u) throw Object.assign(new Error('bad_recovery'), { status: 400 });
  if (!(await checkRecovery(u.id, recovery))) throw Object.assign(new Error('bad_recovery'), { status: 400 });
  return setPassword(u.id, password);
}

export async function changePassword(uid, current, next) {
  const u = await byId(uid);
  if (!u) throw Object.assign(new Error('no_user'), { status: 404 });
  const got = Buffer.from(hashPw(current, u.salt), 'hex');
  const want = Buffer.from(u.hash, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw Object.assign(new Error('bad_password'), { status: 401 });
  return setPassword(uid, next);
}

async function setPassword(uid, password) {
  if (String(password || '').length < 8) throw Object.assign(new Error('weak_password'), { status: 400 });
  const data = await readAll({ fresh: true });
  const u = data.users[uid];
  if (!u) throw Object.assign(new Error('no_user'), { status: 404 });
  const salt = randomBytes(16).toString('hex');
  u.salt = salt;
  u.hash = hashPw(password, salt);
  u.sessionVersion = (u.sessionVersion || 1) + 1; // every old cookie dies
  u.passwordChangedAt = Date.now();
  await writeAll(data);
  return { id: u.id, sessionVersion: u.sessionVersion };
}

/* ── email verification ──────────────────────────────────────────────── */
export async function beginVerify(id) {
  const data = await readAll({ fresh: true });
  const u = data.users[id];
  if (!u) throw Object.assign(new Error('no_user'), { status: 404 });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const salt = randomBytes(16).toString('hex');
  u.verifySalt = salt;
  u.verifyHash = hashPw(code, salt);
  u.verifyExp = Date.now() + 24 * 60 * 60 * 1000;
  u.verifyTries = 0;
  await writeAll(data);
  return { user: u, code };
}

export async function verifyEmail(id, code) {
  const data = await readAll({ fresh: true });
  const u = data.users[id];
  const bad = Object.assign(new Error('bad_verify_code'), { status: 400 });
  if (!u || !u.verifyHash) throw bad;
  if (!u.verifyExp || Date.now() > u.verifyExp) throw bad;
  if ((u.verifyTries || 0) >= 8) throw Object.assign(new Error('too_many'), { status: 429 });
  const got = Buffer.from(hashPw(String(code || '').trim(), u.verifySalt), 'hex');
  const want = Buffer.from(u.verifyHash, 'hex');
  const ok = got.length === want.length && timingSafeEqual(got, want);
  if (!ok) { u.verifyTries = (u.verifyTries || 0) + 1; await writeAll(data); throw bad; }
  u.emailVerified = true;
  u.verifiedAt = Date.now();
  u.verifyHash = undefined; u.verifySalt = undefined; u.verifyExp = undefined; u.verifyTries = 0;
  await writeAll(data);
  return true;
}

/* ── middleware + rate limit ─────────────────────────────────────────── */
export function currentUser(req) {
  const t = readToken(parseCookies(req)[COOKIE]);
  return t ? t.uid : null;
}

export async function requireUser(req, res, next) {
  const tok = readToken(parseCookies(req)[COOKIE]);
  if (!tok) return res.status(401).json({ error: 'auth_required' });
  const u = await byId(tok.uid);
  if (!u) return res.status(401).json({ error: 'auth_required' });
  // a password reset bumps sessionVersion — old cookies stop working everywhere
  if ((u.sessionVersion || 1) !== (tok.v || 1)) return res.status(401).json({ error: 'session_stale' });
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
