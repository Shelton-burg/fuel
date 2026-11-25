// Unit test for server/db.mjs — Postgres SQL logic WITHOUT a live Postgres.
// The `pg` module is mocked (injected via DB.__test.setPg) with a tiny
// in-memory relational store that understands exactly the SQL shapes db.mjs
// emits (CREATE TABLE / INSERT … ON CONFLICT / SELECT … WHERE / DELETE).
// Then the layer is flipped back to dormant and the gist-fallback delegation
// is exercised end-to-end against the real auth/sync/analytics modules
// (GIST_TOKEN unset → their in-memory stores).
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const tag = `db-layer-${Date.now()}`;
process.env.GIST_TOKEN = '';
process.env.FUEL_USERS_CACHE = path.join(os.tmpdir(), `fuel-users-${tag}.json`);
process.env.FUEL_ANALYTICS_CACHE = path.join(os.tmpdir(), `fuel-an-${tag}.json`);
process.env.FUEL_OWNER_SETUP_CODE = '';
process.env.FUEL_SESSION_SECRET = 'db-layer-unit-secret';
process.env.DATABASE_URL = 'postgres://fuel:test@127.0.0.1:5432/fuel_test';

/* ── minimal in-memory pg mock ────────────────────────────────────────── */
function makeFakePg() {
  const tables = new Map([
    ['users', new Map()], ['sync_blobs', new Map()], ['autobak_blobs', new Map()],
    ['analytics_events', new Map()], ['db_meta', new Map()],
  ]);
  const pkOf = (table, row) => {
    if (table === 'analytics_events') return `${row.day_key}|${row.ev}|${row.user_hash}`;
    return row.uid !== undefined ? row.uid : row.key;
  };
  const parseWhere = (whereS, params) => {
    const parts = whereS.split(' AND ');
    return parts.map((p) => {
      const m = p.trim().match(/^(\w+)\s*=\s*\$(\d+)$/);
      if (!m) throw new Error('mock: unsupported WHERE ' + p);
      return [m[1], params[Number(m[2]) - 1]];
    });
  };
  function handle(sql, params = []) {
    const s = sql.trim().replace(/\s+/g, ' ');
    if (s.startsWith('CREATE TABLE')) return { rows: [] };
    let m;
    if ((m = s.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)( ON CONFLICT.*)?$/))) {
      const [, table, colsS, valsS, tail] = m;
      const cols = colsS.split(',').map((x) => x.trim());
      const idxs = [...valsS.matchAll(/\$(\d+)/g)].map((x) => Number(x[1]));
      const row = {};
      cols.forEach((c, i) => { row[c] = params[idxs[i] - 1]; });
      const t = tables.get(table);
      const key = pkOf(table, row);
      if (/(DO UPDATE|DO NOTHING)/.test(tail || '')) {
        if (/DO NOTHING/.test(tail)) { if (!t.has(key)) t.set(key, row); }
        else if (table === 'analytics_events') {
          const prev = t.get(key) || { ...row, count: 0 };
          prev.count = (prev.count || 0) + (row.count || 0);
          t.set(key, prev);
        } else t.set(key, row);
      } else t.set(key, row);
      return { rows: [], rowCount: 1 };
    }
    if ((m = s.match(/^SELECT (.+) FROM (\w+)( WHERE (.+))?$/))) {
      const table = m[2];
      const rows = [...tables.get(table).values()];
      const out = m[4] ? rows.filter((r) => parseWhere(m[4], params).every(([col, v]) => r[col] === v)) : rows;
      return { rows: out };
    }
    if ((m = s.match(/^DELETE FROM (\w+)( WHERE (.+))?$/))) {
      const table = m[1];
      const t = tables.get(table);
      if (m[3]) {
        for (const [col, v] of parseWhere(m[3], params)) {
          for (const [key, row] of [...t]) if (row[col] === v) t.delete(key);
        }
      } else t.clear();
      return { rows: [] };
    }
    throw new Error('mock: unhandled SQL: ' + sql);
  }
  class FakeClient {
    constructor(opts) { this.opts = opts; this.connected = false; }
    async connect() { this.connected = true; }
    async end() { this.connected = false; }
    async query(sql, params = []) { return handle(sql, params); }
  }
  return { Client: FakeClient, tables };
}

const fake = makeFakePg();
const DB = await import('../../server/db.mjs');
const AUTH = await import('../../server/auth.mjs');
const SYNC = await import('../../server/sync.mjs');
const AN = await import('../../server/analytics.mjs');
DB.__test.setPg({ Client: fake.Client });

let ok = 0, bad = 0;
const T = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + msg); c ? ok++ : bad++; };
const DAY = '2026-11-26';

/* ── 1. lazy connection + schema ── */
T(DB.enabled() === true, 'enabled() true with DATABASE_URL set');
const up = await DB.ensure();
T(up === true && DB.active() === true, 'ensure() connects via the mocked pg client and activates');
T(fake.tables.get('users') instanceof Map, 'schema ensured (tables exist, no rows yet)');

/* ── 2. upsert/read roundtrip ── */
const u = { id: 'u_1', email: 'a@fuel.test', name: 'A', hash: 'h1', salt: 's1', sessionVersion: 3, createdAt: 1700000000000, pinHash: 'ph', slot: 'acct-u_1' };
await DB.upsertUser(u);
const got = await DB.readUser('u_1');
T(got && got.id === 'u_1' && got.email === 'a@fuel.test' && got.hash === 'h1' && got.salt === 's1', 'readUser roundtrips core fields');
T(got.sessionVersion === 3 && got.createdAt === 1700000000000, 'sessionVersion + createdAt roundtrip');
T(got.pinHash === 'ph' && got.slot === 'acct-u_1', 'extra JSONB fields roundtrip (pinHash, slot)');
u.name = 'A2'; u.sessionVersion = 4;
await DB.upsertUser(u);
const got2 = await DB.readUser('u_1');
T(got2.name === 'A2' && got2.sessionVersion === 4, 'upsert overwrites an existing row');
T((await DB.readUser('u_nope')) === null, 'readUser of a missing uid → null');
const listed = await DB.listUsers();
T(listed.length === 1 && listed[0].id === 'u_1', 'listUsers returns every row');

/* ── 3. blob put/get ── */
await DB.putBlob('u_1', { payload: 'CIPHERTEXT', keyHash: 'k'.repeat(64), updatedAt: 111 });
const b = await DB.getBlob('u_1');
T(b && b.payload === 'CIPHERTEXT' && b.keyHash === 'k'.repeat(64) && b.updatedAt === 111, 'blob put/get roundtrip (ciphertext stored as-is)');
await DB.putBlob('u_1', { payload: 'C2', keyHash: 'k2'.repeat(32), updatedAt: 222 });
const b2 = await DB.getBlob('u_1');
T(b2 && b2.payload === 'C2' && b2.updatedAt === 222, 'blob overwrite updates the row');
T((await DB.getBlob('u_nope')) === null, 'getBlob of a missing uid → null');

/* ── 4. analytics aggregation ── */
await DB.recordAnalytics(DAY, 'log_food', 'h1', 1);
await DB.recordAnalytics(DAY, 'log_food', 'h1', 1);
await DB.recordAnalytics(DAY, 'log_food', 'h1', 1);
await DB.recordAnalytics(DAY, 'log_food', 'h2', 2);
const tot = await DB.analyticsTotals(DAY, 'log_food');
T(tot.total === 5 && tot.users === 2, 'analytics aggregation: 5 events across 2 users');
const rows = await DB.analyticsRows();
T(rows.length === 2 && rows.every((r) => typeof r.count === 'number'), 'analyticsRows returns per-user aggregate rows');

/* ── 5. migration idempotency ── */
const u2 = { id: 'u_2', email: 'b@fuel.test', name: 'B', hash: 'h2', salt: 's2', sessionVersion: 1, createdAt: Date.now() };
const m1 = await DB.migrateUser(u2);
T(m1 && m1.imported === true, 'migrateUser imports a gist user once');
const m2 = await DB.migrateUser(u2);
T(m2 && m2.skipped === true, 'migrateUser is idempotent (migrated flag)');
T(fake.tables.get('users').size === 2, 'exactly one users row per uid after repeated migration');
u2.name = 'B2';
await DB.upsertUser(u2);
const m3 = await DB.migrateUser(u2);
T(m3.skipped === true && (await DB.readUser('u_2')).name === 'B2', 'migration never clobbers later edits');

/* ── 6. deletion wipes user + blob + analytics (as the endpoint composes it) ── */
await DB.putBlob('u_2', { payload: 'X', keyHash: null, updatedAt: Date.now() });
await DB.recordAnalytics(DAY, 'app_open', createHash('sha256').update('u_2').digest('hex'), 1);
await DB.deleteUser('u_2');
await DB.deleteBlob('u_2');
await DB.deleteAnalyticsUser(createHash('sha256').update('u_2').digest('hex'));
T((await DB.readUser('u_2')) === null, 'deleteUser removes the user row');
T((await DB.getBlob('u_2')) === null, 'deleteBlob removes the sync blob');
T((await DB.analyticsTotals(DAY, 'app_open')).total === 0, 'deleteAnalyticsUser removes the analytics rows');
T(!fake.tables.get('db_meta').has('migrated:u_2'), 'deleteUser clears the migration flag');

/* ── 7. gist-fallback delegation (dormant layer) ── */
DB.__test.reset();
delete process.env.DATABASE_URL;
T(DB.enabled() === false && DB.active() === false, 'without DATABASE_URL the layer is dormant');
const created = await AUTH.createAccount({ name: 'QA', email: 'qa@fuel.test', password: 'password-1' });
const byDb = await DB.readUser(created.user.id);
T(byDb && byDb.id === created.user.id && byDb.email === 'qa@fuel.test', 'readUser delegates to the gist(auth) store');
T((await DB.readUser('missing-uid')) === null, 'fallback readUser of a missing uid → null');
await DB.putBlob(created.user.id, { payload: 'FB', keyHash: 'kh'.repeat(32), updatedAt: Date.now() });
const fb = await DB.getBlob(created.user.id);
T(fb && fb.payload === 'FB', 'putBlob/getBlob delegate to the sync store');
await DB.recordAnalytics(DAY, 'sync_push', 'hh', 3);
const peek = AN.__test.peekDays();
T(peek[DAY] && peek[DAY].sync_push && peek[DAY].sync_push.c === 3, 'recordAnalytics delegates to the analytics store');
await AUTH.deleteAccount(created.user.id);
T((await DB.readUser(created.user.id)) === null, 'fallback deleteAccount removes the gist user');

/* ── 8. bad connection → no crash, no activation ── */
process.env.DATABASE_URL = 'postgres://fuel:test@127.0.0.1:5432/fuel_test';
DB.__test.reset();
DB.__test.setPg({ Client: class Boom { async connect() { throw new Error('connection refused (mock)'); } async end() {} async query() { throw new Error('n/a'); } } });
T(DB.enabled() === true && DB.active() === false, 'a dead database never activates the layer');
const fr = await DB.readUser('whatever');
T(fr === null, 'reads fall through to the gist store while the db is down (no crash)');

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
