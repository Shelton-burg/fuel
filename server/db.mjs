// FUEL — database layer (Postgres via `pg`), DORMANT until DATABASE_URL is set.
//
// Without DATABASE_URL (the production default today) nothing here ever
// connects and every public function delegates to the existing gist-backed
// modules (auth.mjs / sync.mjs / analytics.mjs) — behaviour identical to v61.
//
// With DATABASE_URL set:
//   - the first successful connection runs the schema (schema.mjs) and flips
//     active() to true; auth/sync/analytics then read and write Postgres.
//   - existing gist users are lazily imported once per uid (db_meta
//     'migrated:<uid>' flag), so a provisioned database can adopt the
//     current gist accounts without downtime or duplication.
//   - any connect/query failure flips back to the gist fallback (logged once
//     per transition, not per call) and reconnects are retried with backoff.
//
// The pg module is loaded lazily (dynamic import) so a deploy without the
// package, or without a database, boots exactly like today.
import { createHash } from 'node:crypto';
import { SCHEMA, USER_EXTRA_FIELDS } from './schema.mjs';

const RETRY_MS = 30 * 1000;       // min gap between connection attempts
const CONNECT_TIMEOUT_MS = 5000;  // don't hang a request on a dead database

const state = {
  ready: false,        // connected at least once + schema ensured
  failed: false,       // last connect/query failed -> gist fallback
  lastAttempt: 0,      // backoff clock
  lastOk: 0,
  migratedAll: false,  // gist users imported once since activation
  client: null,
  pg: null,            // resolved pg module (lazy; tests inject a mock)
  loggedUp: false,
  loggedDown: false,
};

export const enabled = () => !!process.env.DATABASE_URL;
export const active = () => state.ready && !state.failed;

const slotKey = (uid) => (String(uid || '').startsWith('acct-') ? String(uid).slice(5) : String(uid || ''));
const userHash = (uid) => createHash('sha256').update(String(uid)).digest('hex');

/* ── connection ───────────────────────────────────────────────────────── */
async function loadPg() {
  if (state.pg) return state.pg;
  state.pg = await import('pg');
  return state.pg;
}

function noteDown(e) {
  state.failed = true;
  state.migratedAll = false; // re-import once we come back, in case a write was lost
  if (!state.loggedDown) {
    state.loggedDown = true;
    state.loggedUp = false;
    console.error('[db] unreachable — gist fallback active:', e.message);
  }
}

export async function ensure() {
  if (!enabled()) return false;
  if (active()) return true;
  const now = Date.now();
  if (now - state.lastAttempt < RETRY_MS) return false;
  state.lastAttempt = now;
  try {
    const pg = await loadPg();
    if (!state.client) {
      state.client = new pg.Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      });
    }
    await state.client.connect();
    for (const stmt of SCHEMA) await state.client.query(stmt);
    state.ready = true;
    state.failed = false;
    state.lastOk = now;
    if (!state.loggedUp) {
      state.loggedUp = true;
      state.loggedDown = false;
      console.log('[db] connected — postgres storage active');
    }
    return true;
  } catch (e) {
    noteDown(e);
    try { if (state.client) { await state.client.end().catch(() => {}); } } catch {}
    state.client = null;
    return false;
  }
}

async function q(sql, params = []) {
  await ensure();
  if (!active()) throw new Error('db_not_active');
  try {
    return await state.client.query(sql, params);
  } catch (e) {
    noteDown(e);
    throw e;
  }
}

/* ── row <-> user mapping ─────────────────────────────────────────────── */
function pickExtra(u) {
  const extra = {};
  for (const f of USER_EXTRA_FIELDS) if (u[f] !== undefined) extra[f] = u[f];
  return extra;
}

function rowToUser(r) {
  const extra = (typeof r.extra === 'string' ? JSON.parse(r.extra || '{}') : (r.extra || {}));
  return {
    id: r.uid, email: r.email, name: r.name || '', hash: r.hash, salt: r.salt,
    sessionVersion: r.session_version ?? 1, createdAt: Number(r.created_at || 0),
    emailVerified: !!r.email_verified,
    plan: r.plan === undefined ? 'free' : r.plan, // v67 — free | pro
    ...extra,
  };
}

/* ── users ────────────────────────────────────────────────────────────── */
export async function listUsers() {
  if (!(await ensure()) || !active()) return Object.values((await import('./auth.mjs')).__test.users());
  const r = await q('SELECT * FROM users');
  return r.rows.map(rowToUser);
}

export async function readUser(uid) {
  if (!(await ensure()) || !active()) return (await import('./auth.mjs')).byId(uid);
  const r = await q('SELECT * FROM users WHERE uid = $1', [uid]);
  return r.rows.length ? rowToUser(r.rows[0]) : null;
}

export async function upsertUser(u) {
  if (!(await ensure()) || !active()) return (await import('./auth.mjs')).saveUser(u);
  await q(
    `INSERT INTO users (uid, email, name, hash, salt, session_version, has_pin, email_verified, recovery_hash, plan, created_at, extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (uid) DO UPDATE SET
       email = EXCLUDED.email, name = EXCLUDED.name, hash = EXCLUDED.hash,
       salt = EXCLUDED.salt, session_version = EXCLUDED.session_version,
       has_pin = EXCLUDED.has_pin, email_verified = EXCLUDED.email_verified,
       recovery_hash = EXCLUDED.recovery_hash, plan = EXCLUDED.plan,
       created_at = EXCLUDED.created_at,
       extra = EXCLUDED.extra`,
    [u.id, u.email, u.name || '', u.hash, u.salt, u.sessionVersion || 1,
     !!u.pinHash, !!u.emailVerified, u.recoveryHash || null,
     u.plan === 'pro' ? 'pro' : 'free',
     u.createdAt || Date.now(), JSON.stringify(pickExtra(u))],
  );
  return u;
}

/** One-shot gist->postgres import, guarded by a per-uid migrated flag. */
export async function migrateUser(u) {
  await ensure();
  if (!active()) throw new Error('db_not_active');
  const key = 'migrated:' + u.id;
  const has = await q('SELECT value FROM db_meta WHERE key = $1', [key]);
  if (has.rows.length) return { skipped: true };
  await q(
    `INSERT INTO users (uid, email, name, hash, salt, session_version, has_pin, email_verified, recovery_hash, plan, created_at, extra)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (uid) DO NOTHING`,
    [u.id, u.email, u.name || '', u.hash, u.salt, u.sessionVersion || 1,
     !!u.pinHash, !!u.emailVerified, u.recoveryHash || null,
     u.plan === 'pro' ? 'pro' : 'free',
     u.createdAt || Date.now(), JSON.stringify(pickExtra(u))],
  );
  await q('INSERT INTO db_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, String(Date.now())]);
  return { imported: true };
}

export function migrationDone() { return state.migratedAll; }
export function markMigrationDone() { state.migratedAll = true; }

export async function deleteUser(uid) {
  if (!(await ensure()) || !active()) return (await import('./auth.mjs')).deleteAccount(uid);
  await q('DELETE FROM users WHERE uid = $1', [uid]);
  await q('DELETE FROM db_meta WHERE key = $1', ['migrated:' + uid]);
}

/* ── sync blobs (client ciphertext, stored as-is) ─────────────────────── */
export async function putBlob(uid, { payload, keyHash, updatedAt }) {
  if (!(await ensure()) || !active()) {
    await (await import('./sync.mjs')).writeSync(payload, keyHash, 'acct-' + slotKey(uid));
    return { updatedAt: Date.now() };
  }
  const at = updatedAt || Date.now();
  await q(
    `INSERT INTO sync_blobs (uid, payload, key_hash, updated_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (uid) DO UPDATE SET payload = EXCLUDED.payload, key_hash = EXCLUDED.key_hash, updated_at = EXCLUDED.updated_at`,
    [slotKey(uid), payload, keyHash || null, at],
  );
  return { updatedAt: at };
}

export async function getBlob(uid) {
  if (!(await ensure()) || !active()) {
    const s = await (await import('./sync.mjs')).readSync('acct-' + slotKey(uid));
    return s && s.blob ? { payload: s.blob, keyHash: s.keyHash, updatedAt: s.updatedAt } : null;
  }
  const r = await q('SELECT payload, key_hash, updated_at FROM sync_blobs WHERE uid = $1', [slotKey(uid)]);
  if (!r.rows.length) return null;
  return { payload: r.rows[0].payload, keyHash: r.rows[0].key_hash, updatedAt: Number(r.rows[0].updated_at) };
}

export async function deleteBlob(uid) {
  if (!(await ensure()) || !active()) return (await import('./sync.mjs')).deleteSlot('acct-' + slotKey(uid));
  await q('DELETE FROM sync_blobs WHERE uid = $1', [slotKey(uid)]);
}

/* ── automatic safety backup (server-encrypted envelope, stored as-is) ── */
export async function putAuto(uid, envelope) {
  if (!(await ensure()) || !active()) {
    return (await import('./sync.mjs')).putAutoEnv('acct-' + slotKey(uid), envelope);
  }
  const at = envelope.u || Date.now();
  await q(
    `INSERT INTO autobak_blobs (uid, payload, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (uid) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
    [slotKey(uid), JSON.stringify(envelope), at],
  );
  return { updatedAt: at };
}

export async function getAuto(uid) {
  if (!(await ensure()) || !active()) {
    return (await import('./sync.mjs')).getAutoEnv('acct-' + slotKey(uid));
  }
  const r = await q('SELECT payload, updated_at FROM autobak_blobs WHERE uid = $1', [slotKey(uid)]);
  if (!r.rows.length) return null;
  try { return JSON.parse(r.rows[0].payload); } catch { return null; }
}

export async function deleteAuto(uid) {
  if (!(await ensure()) || !active()) return;
  await q('DELETE FROM autobak_blobs WHERE uid = $1', [slotKey(uid)]);
}

/* ── analytics (aggregate counts per {day, ev, sha256(uid)}) ──────────── */
export async function recordAnalytics(dayKey, ev, hash, n = 1) {
  if (!(await ensure()) || !active()) {
    return (await import('./analytics.mjs')).recordAggregate(dayKey, ev, hash, n);
  }
  await q(
    `INSERT INTO analytics_events (day_key, ev, user_hash, count) VALUES ($1,$2,$3,$4)
     ON CONFLICT (day_key, ev, user_hash) DO UPDATE SET count = analytics_events.count + EXCLUDED.count`,
    [dayKey, ev, hash, n],
  );
  return { ok: true };
}

/** { total, users } for one {day, ev} cell — used by tests and future dashboards. */
export async function analyticsTotals(dayKey, ev) {
  await ensure();
  if (!active()) throw new Error('db_not_active');
  const r = await q('SELECT user_hash, count FROM analytics_events WHERE day_key = $1 AND ev = $2', [dayKey, ev]);
  let total = 0; const users = new Set();
  for (const row of r.rows) { total += row.count; users.add(row.user_hash); }
  return { total, users: users.size };
}

export async function deleteAnalyticsUser(hash) {
  if (!(await ensure()) || !active()) return false;
  await q('DELETE FROM analytics_events WHERE user_hash = $1', [hash]);
  return true;
}

/** all aggregate rows — merged into memory at boot in db mode */
export async function analyticsRows() {
  await ensure();
  if (!active()) return [];
  const r = await q('SELECT day_key, ev, user_hash, count FROM analytics_events');
  return r.rows;
}

export const uidHash = userHash;

/* ── test hooks (unit tests only — not part of the HTTP surface) ─────── */
export const __test = {
  setPg(mod) { state.pg = mod; },
  reset() {
    state.ready = false; state.failed = false; state.lastAttempt = 0; state.lastOk = 0;
    state.migratedAll = false; state.client = null; state.pg = null;
    state.loggedUp = false; state.loggedDown = false;
  },
  state,
};
