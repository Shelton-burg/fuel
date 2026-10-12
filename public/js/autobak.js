// FUEL — data-safety net. Three layers, so "my phone lost everything" can't happen again:
//   1. Storage probe — detects when the browser is BLOCKING localStorage (iPhones do this
//      with some privacy settings) so the app can warn instead of silently forgetting.
//   2. IndexedDB mirror — a second on-device copy that survives localStorage failure/eviction.
//   3. Automatic backup — every change is pushed (debounced) to /api/autobak, encrypted at
//      rest on the server, and auto-restored when a device opens with no data (fresh install,
//      wiped storage, new phone). No user key needed; the user-key sync in sync.js stays as
//      the privacy-maximum option.
//
// Guard: ?demo=1 disables all of this unless window.__fuelAllowAutoBak (QA escape hatch);
// window.__autoBakSlot = 'qa' routes tests to a throwaway slot.

import { hasAnyData, adoptState } from './store.js';

const MIRROR_DB = 'fuel-mirror';
const MIRROR_STORE = 'kv';
const MIRROR_KEY = 'state';
const META_KEY = 'fuel-autobak-meta';
const PUSH_MS = 12000;

let getState = () => null;
let pushTimer = null;
let mirrorTimer = null;
let pushing = false;
let dirty = false;
let hooked = false;

export const isDemo = () => new URLSearchParams(location.search).get('demo') === '1' && !window.__fuelAllowAutoBak;
const slotQS = () => (window.__autoBakSlot ? `?slot=${encodeURIComponent(window.__autoBakSlot)}` : '');

export function bindState(fn) { getState = fn; }

/* ── storage probe + meta ── */
export function storageOk() {
  try {
    const k = '__fuel_probe';
    localStorage.setItem(k, '1');
    const ok = localStorage.getItem(k) === '1';
    localStorage.removeItem(k);
    return ok;
  } catch { return false; }
}

export function meta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
function setMeta(patch) {
  try { localStorage.setItem(META_KEY, JSON.stringify({ ...meta(), ...patch })); } catch {}
}
const fire = (detail) => { try { window.dispatchEvent(new CustomEvent('fuel:autobak', { detail: detail || {} })); } catch {} };

/* ── IndexedDB mirror ── */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(MIRROR_DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(MIRROR_STORE)) r.result.createObjectStore(MIRROR_STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function mirrorWrite(state) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction(MIRROR_STORE, 'readwrite'); tx.objectStore(MIRROR_STORE).put(state, MIRROR_KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch {}
}
async function mirrorRead() {
  try {
    const db = await idb();
    const v = await new Promise((res, rej) => { const tx = db.transaction(MIRROR_STORE, 'readonly'); const q = tx.objectStore(MIRROR_STORE).get(MIRROR_KEY); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
    db.close();
    return v;
  } catch { return null; }
}
export async function clearMirror() {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction(MIRROR_STORE, 'readwrite'); tx.objectStore(MIRROR_STORE).delete(MIRROR_KEY); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch {}
}

/* ── automatic backup ── */
export function onSave() {
  if (isDemo()) return;
  const st = getState();
  if (!st || !hasAnyData(st)) return; // never overwrite a good backup with an empty shell
  dirty = true;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => mirrorWrite(st), 1500);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow(st), PUSH_MS);
}

export async function pushNow(state = getState(), opts = {}) {
  if (isDemo() && !opts.force) return { ok: false, skipped: 'demo' };
  if (!state || (!hasAnyData(state) && !opts.force)) return { ok: false, skipped: 'empty' };
  if (pushing) { dirty = true; return { ok: false, skipped: 'busy' }; }
  pushing = true;
  dirty = false;
  try {
    const r = await fetch('/api/autobak' + slotQS(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || 'Backup failed');
    setMeta({ last: Date.now(), err: null });
    return { ok: true, updatedAt: j.updatedAt };
  } catch (e) {
    setMeta({ err: e.message || 'offline' });
    return { ok: false, error: e.message };
  } finally {
    pushing = false;
    if (dirty) pushNow(getState());
    fire({ pushed: true });
  }
}

export async function autoPull() {
  try {
    const r = await fetch('/api/autobak' + slotQS());
    const j = await r.json();
    if (!r.ok || !j.ok) return null;
    return { state: j.state, updatedAt: j.updatedAt };
  } catch { return null; }
}

/* reset wipes the net too (a deliberate fresh start) — tombstone keeps boots from re-restoring */
export async function onReset() {
  await clearMirror();
  if (isDemo()) return;
  try { await pushNow(getState(), { force: true }); } catch {}
}

/* ── boot: probe + restore-if-empty. Call once, before the first render. ── */
export async function boot({ demo } = {}) {
  const report = { storage: storageOk(), restoredFrom: null, updatedAt: null };
  if (!demo) {
    hookFlush();
    try {
      const st = getState();
      if (st && !hasAnyData(st) && !((st.meta || {}).resetAt)) {
        const m = await mirrorRead();
        if (m && hasAnyData(m)) { adoptState(m); report.restoredFrom = 'device'; }
        else {
          const r = await autoPull();
          if (r && r.state && hasAnyData(r.state)) { adoptState(r.state); report.updatedAt = r.updatedAt; report.restoredFrom = 'cloud'; }
        }
      }
    } catch (e) { report.err = e.message; }
  }
  fire(report);
  return report;
}

/* flush on the way out — iOS kills apps abruptly, so try hard to save the last edit */
function hookFlush() {
  if (hooked) return;
  hooked = true;
  const flush = (opts = {}) => {
    if (isDemo()) return;
    const st = getState();
    if (!st || !hasAnyData(st)) return;
    const body = JSON.stringify({ state: st });
    try {
      const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
      if (opts.keepalive && body.length < 60000) init.keepalive = true; // keepalive rejects >64KB bodies
      fetch('/api/autobak' + slotQS(), init).catch(() => {});
    } catch {}
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush({ keepalive: false }); });
  window.addEventListener('pagehide', () => flush({ keepalive: true }));
}
