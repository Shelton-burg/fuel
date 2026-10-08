// FUEL — client side of cloud backup: encrypts the whole state with the user's sync key
// (AES-GCM, key stretched with PBKDF2), then pushes/pulls the ciphertext blob via /api/sync.
// The sync key never leaves this device; the server can't read a single meal.

const META_KEY = 'fuel-sync-meta';
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const slotQS = () => (typeof window !== 'undefined' && window.__syncSlot ? `?slot=${window.__syncSlot}` : '');

export function genSyncKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const chars = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return 'FUEL-' + (s.match(/.{1,6}/g) || []).join('-');
}

async function deriveKey(key, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(key), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function keyHash(key) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(key));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pack(str) {
  try {
    const cs = new CompressionStream('gzip');
    const stream = new Blob([str]).stream().pipeThrough(cs);
    return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), z: 1 };
  } catch {
    return { bytes: enc.encode(str), z: 0 };
  }
}
async function unpack(bytes, z) {
  if (!z) return dec.decode(bytes);
  try {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  } catch {
    return dec.decode(bytes);
  }
}

export async function encryptState(obj, key) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await deriveKey(key, salt);
  const { bytes, z } = await pack(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes);
  return JSON.stringify({ v: 1, z, s: b64(salt), i: b64(iv), d: b64(ct) });
}

export async function decryptState(envStr, key) {
  let env;
  try { env = JSON.parse(envStr); } catch { throw new Error('This backup looks damaged.'); }
  if (!env || env.v !== 1 || !env.s || !env.d) throw new Error('This backup looks damaged.');
  const k = await deriveKey(key, unb64(env.s));
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: env.i ? unb64(env.i) : new Uint8Array(12) }, k, unb64(env.d));
  } catch {
    throw new Error('Wrong sync key — check the code and try again.');
  }
  try { return JSON.parse(await unpack(new Uint8Array(plain), env.z)); }
  catch { throw new Error('This backup looks damaged.'); }
}

export async function pushBackup(stateObj, key) {
  const blob = await encryptState(stateObj, key);
  const r = await fetch('/api/sync/blob' + slotQS(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob, keyHash: await keyHash(key) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    const err = new Error(j.message || 'Backup failed — try again in a minute.');
    err.code = j.error || 'sync_failed';
    throw err;
  }
  setMeta({ last: Date.now(), err: null });
  return j;
}

export async function pullBackup(key) {
  const r = await fetch('/api/sync/blob' + slotQS());
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.message || 'Could not reach the backup.');
  if (!j.blob) throw new Error('No backup found yet — turn on backup on your main phone first.');
  const state = await decryptState(j.blob, key);
  return { state, updatedAt: j.updatedAt };
}

export async function serverState() {
  try {
    const r = await fetch('/api/sync/state' + slotQS());
    return await r.json();
  } catch {
    return null;
  }
}

export function syncMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
export function setMeta(patch) {
  localStorage.setItem(META_KEY, JSON.stringify({ ...syncMeta(), ...patch }));
}
