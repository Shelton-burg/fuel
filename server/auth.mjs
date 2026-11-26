// FUEL — accounts: email + password (scrypt), signed httpOnly session cookie.
// Users live in a PRIVATE gist (server token only). No plain-text passwords,
// no password in logs, no user data in the token beyond id + expiry.
import { createHash, randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from './db.mjs';

const GH = 'https://api.github.com';
const TOKEN = process.env.GIST_TOKEN || null;
const FILE = 'fuel-users.json';
const DESC = 'FUEL auth users';

const SECRET = process.env.FUEL_SESSION_SECRET || (TOKEN ? createHash('sha256').update('fuel-sess|' + TOKEN).digest('hex') : 'dev-secret-not-for-production');
export const COOKIE = 'fuel_sess';
const MAX_AGE = 90 * 24 * 3600; // 90 days
export const API_TOKEN_MAX_AGE = 30 * 24 * 3600; // 30 days — native-shell bearer token

/* ── storage ─────────────────────────────────────────────────────────── */
let mem = { users: {} };
let memAt = 0;
let gistId = null;
let blockedUntil = 0;   // GitHub throttled us; stop hammering it
let dirty = false;      // a write is waiting for GitHub to come back
const CACHE_FILE = process.env.FUEL_USERS_CACHE || path.join(os.tmpdir(), 'fuel-users-cache.json');

function loadDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (j && j.users && Object.keys(j.users).length) { mem = { users: j.users }; return true; }
  } catch {}
  return false;
}
function saveDisk() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ users: mem.users, savedAt: Date.now() })); } catch {}
}
loadDisk();
const CACHE_MS = 300000; // 5 min: GitHub secondary limits punish chatty auth reads

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

async function readAllFromGist({ fresh = false } = {}) {
  if (!TOKEN) return mem;
  if (!fresh && memAt && Date.now() - memAt < CACHE_MS) return mem;
  if (Date.now() < blockedUntil && Object.keys(mem.users).length) return mem;
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
    if (/rate limit|403|429/i.test(String(e.message) + String(e.detail || ''))) {
      blockedUntil = Date.now() + 2 * 60 * 1000; // back off: failed calls still burn quota
    }
    if (!Object.keys(mem.users).length) loadDisk();
    return mem; // never lock everyone out because GitHub blipped
  }
}

/** Read every account. Postgres when the db layer is active; otherwise the
    gist path exactly as before. On first successful db connection the gist
    accounts are lazily imported (once per uid, guarded by a migrated flag). */
async function readAll({ fresh = false } = {}) {
  if (db.active()) {
    let users = await db.listUsers();
    if (!db.migrationDone()) {
      const gist = await readAllFromGist({ fresh: true });
      for (const u of Object.values(gist.users)) {
        try { await db.migrateUser(u); } catch (e) { console.error('[auth] migrate', u.id, e.message); }
      }
      db.markMigrationDone();
      users = await db.listUsers();
    }
    const map = {};
    for (const u of users) map[u.id] = u;
    mem = { users: map };
    memAt = Date.now();
    return mem;
  }
  return readAllFromGist({ fresh });
}

async function writeAll(data) {
  mem = data;
  memAt = Date.now();
  if (db.active()) {
    try {
      for (const u of Object.values(data.users)) await db.upsertUser(u);
      saveDisk();
      return;
    } catch (e) {
      console.error('[auth] db write failed — gist fallback:', e.message);
    }
  }
  saveDisk();
  if (!TOKEN) return;
  if (Date.now() < blockedUntil) { dirty = true; return; } // keep the change locally, sync later
  try {
    const id = await findGist();
    await gh('PATCH', `/gists/${id}`, { files: { [FILE]: { content: JSON.stringify(data) } } });
    dirty = false;
  } catch (e) {
    if (/rate limit|403|429/i.test(String(e.message) + String(e.detail || ''))) blockedUntil = Date.now() + 2 * 60 * 1000;
    dirty = true;
    console.error('[auth] write deferred:', e.message);
  }
}

// retry a deferred write once GitHub lifts the limit; no timer kept alive forever
setInterval(async () => {
  if (!dirty || !TOKEN || Date.now() < blockedUntil) return;
  try {
    const id = await findGist();
    await gh('PATCH', `/gists/${id}`, { files: { [FILE]: { content: JSON.stringify(mem) } } });
    dirty = false;
    console.log('[auth] deferred write flushed');
  } catch {}
}, 90 * 1000).unref();

/* ── passwords ───────────────────────────────────────────────────────── */
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 64).toString('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();

/* ── FUEL Pro entitlement (v67) ──────────────────────────────────────────
   plan lives on the user record ('free' | 'pro', default free). Billing is
   not wired yet — Pro is granted by the owner dashboard or by the
   FUEL_PRO_EMAILS env list (comma-separated emails, read per request). */
const proEmails = () => new Set(String(process.env.FUEL_PRO_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
export const planOf = (u) => (u && (u.plan === 'pro' || proEmails().has(normEmail(u.email)))) ? 'pro' : 'free';
export async function setPlan(uid, plan) {
  const p = plan === 'pro' ? 'pro' : 'free';
  const data = await readAll({ fresh: true });
  const u = data.users[uid];
  if (!u) throw Object.assign(new Error('no_user'), { status: 404 });
  u.plan = p;
  await writeAll(data);
  return u;
}
/** minimal account rows for the owner dashboard — email + plan + createdAt */
export async function listAll() {
  const data = await readAll();
  return Object.values(data.users).map((u) => ({ id: u.id, email: u.email, plan: planOf(u), storedPlan: u.plan || 'free', createdAt: u.createdAt || 0 }));
}

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
/** Native-shell API tokens: HMAC-signed, purpose-tagged ('api') so a session
    cookie token can never double as an API token. 30 days, versioned with the
    session so a password reset signs the app out too. */
export function makeApiToken(uid, v = 1, ttlMs = API_TOKEN_MAX_AGE * 1000) {
  const body = Buffer.from(JSON.stringify({ uid, v, purpose: 'api', exp: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function readApiToken(tok) {
  try {
    const [body, sig] = String(tok || '').split('.');
    if (!body || !sig) return null;
    const want = sign(body);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.purpose !== 'api' || !p.uid || !p.exp || p.exp < Date.now()) return null;
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
export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, slot: u.slot, hasPin: !!u.pinHash, emailVerified: !!u.emailVerified, createdAt: u.createdAt, plan: planOf(u) });

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
  const user = { id, name: nm, email: em, salt, hash: hashPw(password, salt), slot: 'acct-' + id, createdAt: Date.now(), plan: 'free' };
  data.users[id] = user;
  await writeAll(data);
  return user;
}

/** one read + one write: account + recovery code + verification code */
export async function createAccount({ name, email, password }) {
  const em = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw Object.assign(new Error('bad_email'), { status: 400 });
  if (String(password || '').length < 8) throw Object.assign(new Error('weak_password'), { status: 400 });
  const nm = String(name || '').trim().slice(0, 40);
  if (!nm) throw Object.assign(new Error('bad_name'), { status: 400 });
  const data = await readAll({ fresh: true });
  if (Object.values(data.users).some((u) => u.email === em)) throw Object.assign(new Error('email_taken'), { status: 409 });

  const salt = randomBytes(16).toString('hex');
  const id = 'u_' + randomBytes(9).toString('base64url');
  const rec = newRecovery();
  const ver = newVerify();
  const user = {
    id, name: nm, email: em, salt, hash: hashPw(password, salt), slot: 'acct-' + id, createdAt: Date.now(), plan: 'free',
    recoverySalt: rec.salt, recoveryHash: rec.hash,
    verifySalt: ver.salt, verifyHash: ver.hash, verifyExp: Date.now() + 24 * 60 * 60 * 1000, verifyTries: 0,
  };
  data.users[id] = user;
  await writeAll(data);
  return { user, recoveryCode: rec.code, verifyCode: ver.code };
}

export async function login({ email, password }) {
  const em = normEmail(email);
  let data = await readAll();
  let user = Object.values(data.users).find((u) => u.email === em);
  if (!user) {
    data = await readAll({ fresh: true });
    user = Object.values(data.users).find((u) => u.email === em);
  }
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

/** single-user upsert — the db layer's gist-fallback path */
export async function saveUser(user) {
  const data = await readAll();
  data.users[user.id] = user;
  await writeAll(data);
  return user;
}

/** Permanently remove an account (idempotent). Postgres row when the db layer
    is active, otherwise the gist entry — never both, never neither. */
export async function deleteAccount(uid) {
  if (db.active()) {
    try { await db.deleteUser(uid); return true; } catch (e) { console.error('[auth] db delete failed — gist fallback:', e.message); }
  }
  const data = await readAll({ fresh: true });
  if (!data.users[uid]) return true;
  delete data.users[uid];
  await writeAll(data);
  return true;
}

/** signed one-time token emailed for self-serve account deletion */
export function makeDeleteToken(uid, ttlMs = 60 * 60 * 1000) {
  const body = Buffer.from(JSON.stringify({ uid, purpose: 'delete', exp: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readDeleteToken(tok) {
  try {
    const [body, sig] = String(tok || '').split('.');
    if (!body || !sig) return null;
    const want = sign(body);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.purpose !== 'delete' || !p.uid || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

/** test hook — read-only snapshot of the in-memory user map */
export const __test = { users: () => ({ ...mem.users }) };

/** counts only, no personal fields — for the owner dashboard (AU day keys, UTC+10). */
export async function userStats() {
  const data = await readAll();
  const byDay = {};
  let total = 0;
  for (const u of Object.values(data.users)) {
    total++;
    const d = new Date((u.createdAt || 0) + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  return { total, byDay };
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

function makeCode(len, digits) {
  if (digits) return String(Math.floor(100000 + Math.random() * 900000));
  let out = '';
  const bytes = randomBytes(Math.ceil(len / 2));
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export function newVerify() {
  const code = makeCode(6, true);
  const salt = randomBytes(16).toString('hex');
  return { code, salt, hash: hashPw(code, salt) };
}

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

/** user authenticated by a bearer API token — null otherwise (tampered,
    expired, wrong-family or stale tokens fall through to the cookie path). */
export async function userFromBearer(req) {
  const m = /^Bearer[ \t]+(\S+)$/i.exec(String(req.headers.authorization || ''));
  if (!m) return null;
  const p = readApiToken(m[1]);
  if (!p) return null;
  const u = await byId(p.uid);
  if (!u) return null;
  if ((u.sessionVersion || 1) !== (p.v || 1)) return null;
  return u;
}

/** user authenticated by the session cookie — null otherwise. */
export async function cookieUser(req) {
  const tok = readToken(parseCookies(req)[COOKIE]);
  if (!tok) return null;
  const u = await byId(tok.uid);
  if (!u) return null;
  if ((u.sessionVersion || 1) !== (tok.v || 1)) return null;
  return u;
}

export async function requireUser(req, res, next) {
  // Bearer API token (native shell) as an alternative to the session cookie.
  // The cookie path below is byte-for-byte the pre-v63 behaviour.
  const bu = await userFromBearer(req);
  if (bu) { req.user = bu; return next(); }
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
