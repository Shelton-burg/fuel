// FUEL — progress photos: on-device (IndexedDB) photo check-ins with a strip,
// a viewer, and a compare-first-vs-latest overlay. Self-contained: markup helper +
// document-level interactions. Photos never leave the device.
import * as S from './store.js';

const DB = 'fuel-photos';
const STORE = 'p';
let dbP = null;

function db() {
  if (!dbP) {
    dbP = new Promise((res, rej) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE, { keyPath: 'key' }); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  return dbP;
}
async function put(p) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(p); t.oncomplete = () => res(p); t.onerror = () => rej(t.error); });
}
async function allP() {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readonly'); const rq = t.objectStore(STORE).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); });
}
async function delP(key) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

const byNewest = (a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : b.ts - a.ts);

function toImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('bad image')); };
    im.src = u;
  });
}
function snap(img, max) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export async function addPhoto(file) {
  const img = await toImg(file);
  const rec = { key: S.dayKey(), ts: Date.now(), d: snap(img, 1000), t: snap(img, 160), kg: S.getState().profile.weight };
  await put(rec);
  return rec;
}

export function photoPanelHTML() {
  return `<div class="panel photo-panel">
    <div class="photo-head"><h2 class="ph2">Check-in photos</h2>
      <div class="photo-head-r"><button class="btn ghost sm-btn" id="btn-photo-cmp" type="button" hidden>Compare</button>
      <button class="btn ghost sm-btn" data-photo-add type="button">Add photo</button></div></div>
    <div class="photo-strip" id="photo-strip"><p class="muted sm">Snap a progress photo — front, side, whatever. They stay on this device.</p></div>
    <input type="file" id="photo-file" accept="image/*" capture="environment" hidden>
  </div>`;
}

export async function renderPhotoStrip() {
  const el = document.getElementById('photo-strip');
  if (!el) return;
  let list = [];
  try { list = (await allP()).sort(byNewest); } catch { list = []; }
  const cmp = document.getElementById('btn-photo-cmp');
  if (cmp) cmp.hidden = list.length < 2;
  el.innerHTML = list.length
    ? list.map((p) => `<button class="photo-thumb" data-photo-open="${p.key}" type="button"><img src="${p.t}" alt=""><span>${S.fmtDate(p.key)}</span></button>`).join('')
    : `<p class="muted sm">Snap a progress photo — front, side, whatever. They stay on this device.</p>`;
}

function overlay(inner) {
  const w = document.createElement('div');
  w.className = 'photo-overlay';
  w.innerHTML = `<div class="photo-box">${inner}</div>`;
  w.addEventListener('click', (e) => { if (e.target === w) w.remove(); });
  document.body.appendChild(w);
  return w;
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-photo-add]')) { document.getElementById('photo-file')?.click(); return; }
  const open = e.target.closest('[data-photo-open]');
  if (open) {
    const list = (await allP()).sort(byNewest);
    const i = Math.max(0, list.findIndex((x) => x.key === open.dataset.photoOpen));
    const p = list[i];
    if (!p) return;
    overlay(`<img src="${p.d}" alt="">
      <div class="photo-meta"><b>${S.fmtDate(p.key)}</b>${p.kg ? ` · ${p.kg} kg` : ''}${list.length > 1 ? ` · ${i + 1} of ${list.length}` : ''}</div>
      <div class="photo-actions"><button class="btn danger sm-btn" data-photo-arm="${p.key}" type="button">Delete</button><button class="btn ghost sm-btn" data-photo-close type="button">Close</button></div>`);
    return;
  }
  if (e.target.closest('#btn-photo-cmp')) {
    const list = (await allP()).sort(byNewest);
    if (list.length < 2) return;
    const nw = list[0], old = list[list.length - 1];
    overlay(`<div class="photo-cmp">
        <figure><img src="${old.d}" alt=""><figcaption>${S.fmtDate(old.key)}${old.kg ? ` · ${old.kg} kg` : ''}</figcaption></figure>
        <figure><img src="${nw.d}" alt=""><figcaption>${S.fmtDate(nw.key)}${nw.kg ? ` · ${nw.kg} kg` : ''}</figcaption></figure>
      </div>
      <div class="photo-actions"><button class="btn ghost sm-btn" data-photo-close type="button">Close</button></div>`);
    return;
  }
  const arm = e.target.closest('[data-photo-arm]');
  if (arm) {
    if (!arm.dataset.armed) {
      arm.dataset.armed = '1';
      arm.textContent = 'Tap again to delete';
      setTimeout(() => { if (arm.isConnected) { delete arm.dataset.armed; arm.textContent = 'Delete'; } }, 3500);
      return;
    }
    await delP(arm.dataset.photoArm);
    arm.closest('.photo-overlay')?.remove();
    renderPhotoStrip();
    return;
  }
  if (e.target.closest('[data-photo-close]')) { e.target.closest('.photo-overlay')?.remove(); return; }
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 'photo-file' && e.target.files && e.target.files[0]) {
    try {
      await addPhoto(e.target.files[0]);
      window.dispatchEvent(new CustomEvent('fuel:toast', { detail: 'Photo saved' }));
    } catch {
      window.dispatchEvent(new CustomEvent('fuel:toast', { detail: "That image didn't load — try another" }));
    }
    e.target.value = '';
    renderPhotoStrip();
  }
});
