// FUEL — privacy-safe owner analytics.
// The client sends ONLY allowlisted event names (feature usage, no content). The server
// aggregates per {dayKey, event, sha256(uid)} IN MEMORY and periodically merges the
// aggregates into a private gist ('fuel-analytics.json', description 'FUEL analytics').
// The raw user id never leaves the server: only sha256(uid) is stored.
// The owner account (one owner) also lives in that gist under 'fuel-owner.json' —
// scrypt-hashed password, HMAC session cookie, no password ever logged.
import { createHash, randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as AUTH from './auth.mjs';

const GH = 'https://api.github.com';
const TOKEN = process.env.GIST_TOKEN || null;
const DESC = 'FUEL analytics';
const FILE = 'fuel-analytics.json';
const OWNER_FILE = 'fuel-owner.json';

// day keys are computed in the owner's timezone (Australia East, UTC+10, no DST) so
// the heat map / "today" buckets match the day the owner actually lived, not UTC.
const TZ_OFFSET_MS = 10 * 60 * 60 * 1000;
const auDay = (d) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

export const ALLOWED = new Set([
  'app_open', 'tab_today', 'tab_train', 'tab_history', 'tab_body', 'tab_food',
  'tab_recovery', 'tab_settings', 'log_food', 'scan_barcode', 'scan_label',
  'plate_scan', 'coach_call', 'coach_chat_msg', 'mealplan', 'weekly_checkin',
  'recipe_ideas', 'workout_start', 'workout_finish', 'checkin_log', 'sync_push', 'pin_used',
]);

export const AI_BUDGETS = { label: 80, coach: 40, chat: 120, weekly: 10, meal: 20 }; // must mirror AUTH.aiBudget caps in server.mjs
const AI_EVENT = { scan_label: 'label', coach_call: 'coach', coach_chat_msg: 'chat', weekly_checkin: 'weekly', mealplan: 'meal' };

const CACHE_FILE = process.env.FUEL_ANALYTICS_CACHE || path.join(os.tmpdir(), 'fuel-analytics-cache.json');
const APP_OPEN_WINDOW = 60 * 60 * 1000;   // one app_open per user per hour
const FLUSH_MS = 10 * 60 * 1000;          // flush buffered aggregates every 10 min
const FLUSH_EVENTS = 200;                 // …or as soon as 200 events pile up

/* ── in-memory store ─────────────────────────────────────────────────── */
let mem = { days: {} };      // days[dayKey][ev] = { c, u: [sha256(uid)] }
let owner = null;            // { email, salt, hash, createdAt }
let gistId = null;
let blockedUntil = 0;
let dirty = false;
let buffered = 0;
const lastAppOpen = new Map(); // sha256(uid) -> epoch ms
const lastLoad = () => {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (j && j.days) { mem = { days: j.days }; if (j.owner) owner = j.owner; return true; }
  } catch {}
  return false;
};
const saveDisk = () => { try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ days: mem.days, owner, savedAt: Date.now() })); } catch {} };
lastLoad();

const hashUser = (uid) => createHash('sha256').update(String(uid)).digest('hex');

async function gh(method, path, body) {
  const r = await fetch(GH + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fuel-analytics', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const e = new Error('gh_' + r.status); e.detail = (await r.text()).replace(/\s+/g, ' ').slice(0, 200); throw e; }
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
  const made = await gh('POST', '/gists', { description: DESC, public: false, files: { [FILE]: { content: JSON.stringify({ days: {} }) }, [OWNER_FILE]: { content: JSON.stringify({ owner: null }) } } });
  gistId = made.id;
  return gistId;
}

async function readGist() {
  const id = await findGist();
  const g = await gh('GET', `/gists/${id}`);
  const out = { days: {}, owner: null };
  for (const [name, outKey] of [[FILE, 'days'], [OWNER_FILE, 'owner']]) {
    const f = g.files?.[name];
    try {
      let txt = typeof f?.content === 'string' && f.content ? f.content : null;
      if (!txt && f?.raw_url) txt = await (await fetch(f.raw_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).text();
      const j = JSON.parse(txt || (outKey === 'owner' ? 'null' : '{}'));
      if (outKey === 'days') out.days = j?.days || {};
      else out.owner = j?.owner || null;
    } catch {}
  }
  return out;
}

function mergeInto(dst, src) {
  for (const [day, evs] of Object.entries(src || {})) {
    const d = dst[day] || (dst[day] = {});
    for (const [ev, v] of Object.entries(evs || {})) {
      const cur = d[ev] || (d[ev] = { c: 0, u: [] });
      cur.c += v.c || 0;
      const set = new Set(cur.u);
      for (const h of v.u || []) set.add(h);
      cur.u = [...set];
    }
  }
  return dst;
}

/** merge the gist's latest aggregates into memory (used at boot and before each flush) */
async function readAll() {
  if (!TOKEN) return mem;
  if (Date.now() < blockedUntil) return mem;
  try {
    const cur = await readGist();
    mergeInto(mem.days, cur.days);
    if (cur.owner && !owner) owner = cur.owner;
    saveDisk();
  } catch (e) {
    console.error('[analytics] read failed:', e.detail || e.message);
    if (/rate limit|403|429/i.test(String(e.message) + String(e.detail || ''))) blockedUntil = Date.now() + 2 * 60 * 1000;
  }
  return mem;
}

async function flush() {
  if (!dirty && !buffered) return;
  if (!TOKEN) { buffered = 0; saveDisk(); return; }
  if (Date.now() < blockedUntil) { dirty = true; return; }
  try {
    const cur = await readGist();
    mergeInto(mem.days, cur.days);
    const payload = { days: mem.days, updatedAt: Date.now() };
    const files = { [FILE]: { content: JSON.stringify(payload) } };
    if (owner) files[OWNER_FILE] = { content: JSON.stringify({ owner }) };
    await gh('PATCH', `/gists/${await findGist()}`, { files });
    dirty = false; buffered = 0;
    saveDisk();
  } catch (e) {
    if (/rate limit|403|429/i.test(String(e.message) + String(e.detail || ''))) blockedUntil = Date.now() + 2 * 60 * 1000;
    dirty = true;
    console.error('[analytics] flush deferred:', e.detail || e.message);
  }
}

setInterval(() => { flush().catch(() => {}); }, FLUSH_MS).unref();
setInterval(async () => { if (dirty && TOKEN && Date.now() >= blockedUntil) { dirty = false; try { await flush(); } catch {} } }, 90 * 1000).unref();

// best-effort final flush on Render's SIGTERM (and Ctrl-C locally)
let hooked = false;
export function installShutdownHook() {
  if (hooked) return;
  hooked = true;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      const t = setTimeout(() => process.exit(0), 4000);
      t.unref();
      flush().catch(() => {}).finally(() => process.exit(0));
    });
  }
}

/* ── event intake ────────────────────────────────────────────────────── */
export function recordEvent(uid, ev, ts) {
  if (typeof ev !== 'string' || !ALLOWED.has(ev)) { const e = new Error('bad_event'); e.status = 400; throw e; }
  let when = Date.now();
  const t = Number(ts);
  if (Number.isFinite(t) && t > 0 && t < when + 24 * 3600 * 1000) when = t;
  const h = hashUser(uid);
  if (ev === 'app_open') {
    const last = lastAppOpen.get(h) || 0;
    if (when - last < APP_OPEN_WINDOW) return { ok: true, deduped: true };
    lastAppOpen.set(h, when);
  }
  const day = auDay(new Date(when));
  const d = mem.days[day] || (mem.days[day] = {});
  const cell = d[ev] || (d[ev] = { c: 0, u: [] });
  cell.c++;
  if (!cell.u.includes(h)) cell.u.push(h);
  buffered++;
  if (buffered >= FLUSH_EVENTS) { buffered = 0; flush().catch(() => {}); }
  return { ok: true };
}

/* ── owner account + session ─────────────────────────────────────────── */
const OWNER_SECRET = process.env.FUEL_SESSION_SECRET || (TOKEN ? createHash('sha256').update('fuel-owner|' + TOKEN).digest('hex') : 'dev-owner-secret');
export const OWNER_COOKIE = 'fuel_owner_sess';
const OWNER_MAX_AGE = 30 * 24 * 3600;

const hashPw = (pw, salt) => scryptSync(String(pw), salt, 64).toString('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const sign = (s) => createHmac('sha256', OWNER_SECRET).update(s).digest('base64url');

export function makeOwnerToken() {
  const body = Buffer.from(JSON.stringify({ o: 1, exp: Date.now() + OWNER_MAX_AGE * 1000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function readOwnerToken(tok) {
  try {
    const [body, sig] = String(tok || '').split('.');
    if (!body || !sig) return null;
    const want = sign(body);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.o || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
export const ownerCookieHeader = () => `${OWNER_COOKIE}=${makeOwnerToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OWNER_MAX_AGE}`;
export const clearOwnerCookie = () => `${OWNER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function setupCodeMatches(code) {
  const want = String(process.env.FUEL_OWNER_SETUP_CODE || '').replace(/[\s-]/g, '').toUpperCase();
  const got = String(code || '').replace(/[\s-]/g, '').toUpperCase();
  if (!want || !got) return false;
  const a = createHash('sha256').update(want).digest();
  const b = createHash('sha256').update(got).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function ownerSetup({ code, email, password }) {
  if (!process.env.FUEL_OWNER_SETUP_CODE) { const e = new Error('not_configured'); e.status = 503; throw e; }
  if (!setupCodeMatches(code)) { const e = new Error('bad_code'); e.status = 403; throw e; }
  await readAll();
  if (owner) { const e = new Error('already_setup'); e.status = 409; throw e; }
  const em = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { const e = new Error('bad_email'); e.status = 400; throw e; }
  if (String(password || '').length < 8) { const e = new Error('weak_password'); e.status = 400; throw e; }
  const salt = randomBytes(16).toString('hex');
  owner = { email: em, salt, hash: hashPw(password, salt), createdAt: Date.now() };
  buffered++; // force a flush so the owner record reaches the gist even with zero events
  await flush();
  return owner;
}

export async function ownerLogin({ email, password }) {
  const em = normEmail(email);
  if (!owner) await readAll();
  if (!owner) { const e = new Error('bad_login'); e.status = 401; throw e; }
  if (owner.email !== em) { const e = new Error('bad_login'); e.status = 401; throw e; }
  const got = Buffer.from(hashPw(password, owner.salt), 'hex');
  const want = Buffer.from(owner.hash, 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) { const e = new Error('bad_login'); e.status = 401; throw e; }
  return owner;
}

export function ownerEmail() { return owner?.email || null; }

export function requireOwner(req, res, next) {
  const t = readOwnerToken(AUTH.parseCookies(req)[OWNER_COOKIE]);
  if (!t) return res.status(401).json({ error: 'owner_required' });
  next();
}

/* ── dashboard stats ─────────────────────────────────────────────────── */
const last7 = (n = 7) => { const out = []; for (let i = 0; i < n; i++) out.push(auDay(new Date(Date.now() - i * 24 * 3600 * 1000))); return out; };

function mondayOf(dayKey) { // dayKey of the Monday that starts that week
  const d = new Date(dayKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

let statsCache = { at: 0, data: null };
export async function ownerStats({ fresh = false } = {}) {
  await readAll();
  if (!fresh && statsCache.data && Date.now() - statsCache.at < 60 * 1000) return statsCache.data;

  const days = mem.days;
  const dayKeys = Object.keys(days);
  const recent = last7(30);
  const recentSet = new Set(recent);
  const weekKeys = new Set(last7(7));
  const prevWeek = new Set(last7(14).slice(7));

  let events7 = 0, eventsPrev7 = 0, events30 = 0;
  const feat = {}; // ev -> {count (30d), delta (7d vs prev 7d)}
  const activeUsers30 = new Set(), activeUsers7 = new Set();

  for (const [day, evs] of Object.entries(days)) {
    const in30 = recentSet.has(day), in7 = weekKeys.has(day), inPrev7 = prevWeek.has(day);
    if (!in30) continue;
    for (const [ev, cell] of Object.entries(evs || {})) {
      const c = cell.c || 0;
      const f = feat[ev] || (feat[ev] = { count: 0, delta: 0 });
      f.count += c;
      if (in7) { f.delta += c; events7 += c; }
      if (inPrev7) { f.delta -= c; eventsPrev7 += c; }
      events30 += c;
      for (const h of cell.u || []) { activeUsers30.add(h); if (in7) activeUsers7.add(h); }
    }
  }

  // 12-week heat map: 12 weeks × 7 days, Monday-started columns ending today
  const todayKey = auDay(new Date());
  const thisMonday = mondayOf(todayKey);
  const heat = [];
  for (let w = 11; w >= 0; w--) {
    const monday = new Date(thisMonday + 'T00:00:00Z');
    monday.setUTCDate(monday.getUTCDate() - w * 7);
    for (let d = 0; d < 7; d++) {
      const dd = new Date(monday);
      dd.setUTCDate(dd.getUTCDate() + d);
      const key = dd.toISOString().slice(0, 10);
      if (key > todayKey) continue;
      let count = 0; const users = new Set();
      const evs = days[key] || {};
      for (const cell of Object.values(evs)) { count += cell.c || 0; for (const h of cell.u || []) users.add(h); }
      heat.push({ day: key, count, users: users.size });
    }
  }

  // AI route usage today vs budget caps
  const ai = {};
  for (const [ev, kind] of Object.entries(AI_EVENT)) ai[kind] = { used: (days[todayKey]?.[ev]?.c || 0), cap: AI_BUDGETS[kind] };

  // signups trend: last 8 weeks (Mon-start) from the auth users gist
  const { total, byDay } = await AUTH.userStats();
  const signups = [];
  for (let w = 7; w >= 0; w--) {
    const monday = new Date(thisMonday + 'T00:00:00Z');
    monday.setUTCDate(monday.getUTCDate() - w * 7);
    let n = 0;
    for (let d = 0; d < 7; d++) {
      const dd = new Date(monday); dd.setUTCDate(dd.getUTCDate() + d);
      n += byDay[dd.toISOString().slice(0, 10)] || 0;
    }
    signups.push({ week: monday.toISOString().slice(0, 10), n });
  }

  const features = Object.entries(feat)
    .map(([ev, v]) => ({ ev, count: v.count, delta7: v.delta }))
    .sort((a, b) => b.count - a.count);

  const data = {
    totals: { users: total, active7d: activeUsers7.size, active30d: activeUsers30.size },
    eventsToday: Object.values(days[todayKey] || {}).reduce((a, c) => a + (c.c || 0), 0),
    events7d: events7, eventsPrev7d: eventsPrev7, events30d: events30,
    signups,
    heat,
    features,
    ai,
    heatLabel: 'Activity heat map — colour = events logged that day',
    disclaimer: 'Aggregate counts only — never personal data.',
    updatedAt: Date.now(),
  };
  statsCache = { at: Date.now(), data };
  return data;
}

export function analyticsConfigured() { return true; }

// test hooks (plain-node unit test only — not part of the HTTP surface)
export const __test = { mergeDays: mergeInto, auDay };
