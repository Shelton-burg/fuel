// FUEL — cloud sync: keeps an ENCRYPTED state blob in a private GitHub gist.
// The blob is encrypted client-side (AES-GCM, key derived from the user's sync key);
// the server only ever sees ciphertext + a SHA-256 key hash used to stop a different
// device from silently overwriting the slot.

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as db from './db.mjs';

const GH = 'https://api.github.com';
const TOKEN = process.env.GIST_TOKEN || null;
const DEFAULT_SLOT = process.env.SYNC_SLOT || 'prod';
const FILE = 'fuel-sync.json';
const descFor = (slot) => `FUEL sync ${slot}`;
const gistCache = new Map(); // slot -> gist id

async function gh(method, path, body) {
  const r = await fetch(GH + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fuel-sync',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = new Error('gist_http_' + r.status);
    e.detail = (await r.text()).replace(/\s+/g, ' ').slice(0, 200);
    throw e;
  }
  return r.json();
}

async function ghDel(path) { // DELETE returns 204 with no body — r.json() would throw
  const r = await fetch(GH + path, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fuel-sync' },
  });
  if (!r.ok && r.status !== 404) {
    const e = new Error('gist_http_' + r.status);
    e.detail = (await r.text()).replace(/\s+/g, ' ').slice(0, 200);
    throw e;
  }
  return true;
}

async function findGist(slot) {
  if (gistCache.has(slot)) return gistCache.get(slot);
  const desc = descFor(slot);
  for (let page = 1; page <= 3; page++) {
    const list = await gh('GET', `/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => (g.description || '') === desc);
    if (hit) { gistCache.set(slot, hit.id); return hit.id; }
    if (list.length < 100) break;
  }
  const created = await gh('POST', '/gists', { description: desc, public: false, files: { [FILE]: { content: '{}' } } });
  gistCache.set(slot, created.id);
  return created.id;
}

// No GitHub token (local dev): keep everything in memory so the flow still works
// end-to-end — never touches the real gist.
const mem = new Map();

// account slot -> db key: postgres rows are keyed by the account uid
const uidKey = (slot) => (String(slot || '').startsWith('acct-') ? String(slot).slice(5) : String(slot || DEFAULT_SLOT));

export async function readSync(slot = DEFAULT_SLOT) {
  if (db.active()) {
    const rec = await db.getBlob(uidKey(slot));
    return rec ? { blob: rec.payload, keyHash: rec.keyHash, updatedAt: rec.updatedAt } : { blob: null, keyHash: null, updatedAt: null };
  }
  if (!TOKEN) return mem.get(slot) || { blob: null, keyHash: null, updatedAt: null };
  const id = await findGist(slot);
  const g = await gh('GET', `/gists/${id}`);
  const f = g.files && g.files[FILE];
  let content = '{}';
  if (f && typeof f.content === 'string' && f.content) content = f.content;
  else if (f && f.raw_url) content = await (await fetch(f.raw_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).text();
  let parsed;
  try { parsed = JSON.parse(content || '{}'); } catch { parsed = {}; }
  return { blob: parsed.blob || null, keyHash: parsed.k || null, updatedAt: parsed.u || null };
}

export async function writeSync(blob, keyHash, slot = DEFAULT_SLOT) {
  if (db.active()) {
    const cur = await db.getBlob(uidKey(slot));
    if (cur && cur.keyHash && cur.keyHash !== keyHash) { const e = new Error('key_mismatch'); throw e; }
    const out = await db.putBlob(uidKey(slot), { payload: blob, keyHash, updatedAt: Date.now() });
    return { updatedAt: out.updatedAt };
  }
  if (!TOKEN) {
    const cur = mem.get(slot) || {};
    if (cur.keyHash && cur.keyHash !== keyHash) { const e = new Error('key_mismatch'); throw e; }
    const rec = { blob, keyHash, updatedAt: Date.now() };
    mem.set(slot, rec);
    return { updatedAt: rec.updatedAt };
  }
  const cur = await readSync(slot);
  if (cur.keyHash && cur.keyHash !== keyHash) { const e = new Error('key_mismatch'); throw e; }
  const id = await findGist(slot);
  const updatedAt = Date.now();
  await gh('PATCH', `/gists/${id}`, { files: { [FILE]: { content: JSON.stringify({ k: keyHash, u: updatedAt, blob }) } } });
  return { updatedAt };
}

export function syncConfigured() { return true; }

/* ── automatic safety backup ──────────────────────────────────────────────
   The app pushes its full state here every few seconds with NO user key; the
   server encrypts it at rest (AES-256-GCM, key = sha256(GIST_TOKEN-derived) so
   the secret is never in the public repo) and keeps it in a second file in the
   same private gist. A phone whose storage was wiped fetches this and
   auto-restores. Distinct from the user-key encrypted sync above. */
const AUTO_FILE = 'fuel-autobak.json';
const autoCache = new Map(); // slot -> { state, updatedAt } (memory fallback)

const autoKey = () => createHash('sha256').update('fuel-autobak-v1|' + (TOKEN || 'dev')).digest();

function autoEncrypt(state) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', autoKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(state), 'utf8'), c.final()]);
  return { v: 1, i: iv.toString('base64'), d: ct.toString('base64'), t: c.getAuthTag().toString('base64') };
}
function autoDecrypt(env) {
  const d = createDecipheriv('aes-256-gcm', autoKey(), Buffer.from(env.i, 'base64'));
  d.setAuthTag(Buffer.from(env.t, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(env.d, 'base64')), d.final()]).toString('utf8'));
}

export async function readAuto(slot = DEFAULT_SLOT) {
  if (db.active()) {
    const env = await db.getAuto(uidKey(slot));
    if (!env) return null;
    try { return { state: autoDecrypt(env), updatedAt: env.u || null }; }
    catch (e) { console.error('[autobak-read]', e.message); return null; }
  }
  if (!TOKEN) return autoCache.get(slot) || null;
  const id = await findGist(slot);
  const g = await gh('GET', `/gists/${id}`);
  const f = g.files && g.files[AUTO_FILE];
  let content = '';
  if (f && typeof f.content === 'string' && f.content) content = f.content;
  else if (f && f.raw_url) content = await (await fetch(f.raw_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).text();
  if (!content) return null;
  try {
    const env = JSON.parse(content);
    return { state: autoDecrypt(env), updatedAt: env.u || null };
  } catch (e) { console.error('[autobak-read]', e.message); return null; }
}

export async function writeAuto(state, slot = DEFAULT_SLOT) {
  const updatedAt = Date.now();
  if (db.active()) {
    const env = autoEncrypt(state);
    env.u = updatedAt;
    await db.putAuto(uidKey(slot), env);
    return { updatedAt };
  }
  if (!TOKEN) { autoCache.set(slot, { state, updatedAt }); return { updatedAt }; }
  const env = autoEncrypt(state);
  env.u = updatedAt;
  const id = await findGist(slot);
  await gh('PATCH', `/gists/${id}`, { files: { [AUTO_FILE]: { content: JSON.stringify(env) } } });
  return { updatedAt };
}
export function autoConfigured() { return true; }

/* ── account deletion ────────────────────────────────────────────────────
   Wipes EVERYTHING this account holds server-side: the client-encrypted sync
   blob AND the automatic safety backup. Postgres rows when the db layer is
   active; in gist mode the whole slot gist is deleted (both files live in it). */
export async function deleteSlot(slot = DEFAULT_SLOT) {
  if (db.active()) {
    await db.deleteBlob(uidKey(slot));
    await db.deleteAuto(uidKey(slot));
    return true;
  }
  if (!TOKEN) { mem.delete(slot); autoCache.delete(slot); return true; }
  const id = gistCache.get(slot);
  if (id) {
    await ghDel(`/gists/${id}`);
    gistCache.delete(slot);
  }
  return true;
}

/* ── pre-encrypted envelope passthrough (db layer's gist fallback) ─────── */
export async function putAutoEnv(slot = DEFAULT_SLOT, env) {
  const updatedAt = env.u || Date.now();
  if (!TOKEN) { autoCache.set(slot, { state: autoDecrypt(env), updatedAt }); return { updatedAt }; }
  env.u = updatedAt;
  const id = await findGist(slot);
  await gh('PATCH', `/gists/${id}`, { files: { [AUTO_FILE]: { content: JSON.stringify(env) } } });
  return { updatedAt };
}

export async function getAutoEnv(slot = DEFAULT_SLOT) {
  const s = await readAuto(slot);
  if (!s || !s.state) return null;
  const env = autoEncrypt(s.state); // re-encapsulate losslessly
  env.u = s.updatedAt || Date.now();
  return env;
}
