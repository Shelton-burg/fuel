// FUEL — app UI + flows.
import * as S from './store.js';
import * as OFF from './off.js';

const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => [...r.querySelectorAll(q)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vib = (ms) => { try { navigator.vibrate?.(ms); } catch {} };
const fmt = (n, d = 0) => Number(n ?? 0).toLocaleString('en-AU', { maximumFractionDigits: d, minimumFractionDigits: 0 });

const MEAL_META = {
  breakfast: { label: 'Breakfast', icon: 'i-sunrise' },
  lunch: { label: 'Lunch', icon: 'i-sun' },
  dinner: { label: 'Dinner', icon: 'i-moon' },
  snacks: { label: 'Snacks', icon: 'i-bolt' },
};

/* ══════════ init ══════════ */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (new URLSearchParams(location.search).get('demo') === '1') seedDemo();

renderAll();
$('#btn-fab').addEventListener('click', openAddSheet);
$('#btn-date').addEventListener('click', () => toast('Day navigation — next version'));
$$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

function switchView(v) {
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  vib(6);
  if (v === 'history') renderHistory();
}

/* ══════════ today render ══════════ */
function renderAll() {
  renderToday();
  renderSettings();
}

function mealForNow() {
  const h = new Date().getHours();
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snacks';
}

function renderToday() {
  const t = S.dayTotals();
  const g = S.getState().goals;
  const left = g.kcal - t.kcal;

  countUp($('#kcal-left'), left);
  $('#kcal-eaten').textContent = fmt(t.kcal);
  $('#kcal-goal').textContent = fmt(g.kcal);

  const circ = 2 * Math.PI * 104;
  const frac = Math.min(t.kcal / g.kcal, 1);
  const ring = $('#ring-progress');
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ * (1 - frac) + 0.001;
  ring.classList.toggle('over', t.kcal > g.kcal);

  const mset = [['prot', t.p, g.protein], ['carbs', t.c, g.carbs], ['fat', t.f, g.fat]];
  for (const [k, v, goal] of mset) {
    $('#m-' + k + '-val').textContent = fmt(Math.round(v));
    $('#m-' + k + '-bar').style.width = Math.min((v / goal) * 100, 100) + '%';
    const goalEl = $('#m-' + k + '-val').parentElement.querySelector('.macro-goal');
    if (goalEl) goalEl.textContent = ` / ${fmt(goal)}g`;
  }

  const st = S.streak();
  $('#streak-val').textContent = `${st} day${st === 1 ? '' : 's'} streak`;
  $('#weight-val').textContent = `${S.getState().profile.weight} kg`;

  const log = S.dayLog();
  const mealsEl = $('#meals');
  mealsEl.innerHTML = S.MEALS.map((m) => {
    const meta = MEAL_META[m];
    const items = log.meals[m];
    const mk = items.reduce((a, e) => a + (e.kcal || 0), 0);
    const rows = items
      .map(
        (e) => `<div class="mi" data-meal="${m}" data-id="${e.id}">
        <div class="mi-main"><div class="mi-name">${esc(e.name)}</div><div class="mi-sub">${esc(e.qtyLabel || '')}${e.brand ? ' · ' + esc(e.brand) : ''}</div></div>
        <div class="mi-kcal">${fmt(e.kcal)}</div>
        <button class="mi-del" data-del type="button" aria-label="Remove"><svg><use href="#i-trash"/></svg></button>
      </div>`
      )
      .join('');
    return `<div class="meal">
      <div class="meal-head">
        <div class="meal-ico"><svg><use href="#${meta.icon}"/></svg></div>
        <div class="meal-info"><div class="meal-name">${meta.label}</div><div class="meal-sub">${items.length ? `${items.length} item${items.length > 1 ? 's' : ''} · ${fmt(mk)} kcal` : 'Nothing logged'}</div></div>
        <div class="meal-kcal">${mk ? fmt(mk) : ''}</div>
        <button class="meal-add" data-add-meal="${m}" type="button"><svg><use href="#i-plus"/></svg></button>
      </div>
      ${items.length ? `<div class="meal-items">${rows}</div>` : ''}
    </div>`;
  }).join('');
}

$('#meals').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const row = del.closest('.mi');
    S.removeEntry(row.dataset.meal, row.dataset.id);
    vib(10);
    renderToday();
    return;
  }
  const add = e.target.closest('[data-add-meal]');
  if (add) { state.prefMeal = add.dataset.addMeal; openAddSheet(); }
});

/* count-up micro-animation */
function countUp(node, target) {
  const from = Number(String(node.dataset.v ?? node.textContent).replace(/[^\d.-]/g, '')) || 0;
  if (from === target) { node.textContent = fmt(target); node.dataset.v = target; return; }
  const t0 = performance.now(), dur = 600;
  const step = (t) => {
    const p = Math.min((t - t0) / dur, 1);
    const v = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3)));
    node.textContent = fmt(v);
    if (p < 1) requestAnimationFrame(step); else { node.textContent = fmt(target); node.dataset.v = target; }
  };
  requestAnimationFrame(step);
}

/* ══════════ add sheet ══════════ */
let state = { prefMeal: null };

function openAddSheet() {
  $('#sheet-add').hidden = false;
  $('#sheet-backdrop').hidden = false;
  renderRecents();
  vib(6);
}
function closeSheet() {
  $('#sheet-add').hidden = true;
  $('#sheet-backdrop').hidden = true;
}
$('#sheet-backdrop').addEventListener('click', closeSheet);

function renderRecents() {
  const rec = S.recentFoods(10);
  const wrap = $('#recents-wrap');
  wrap.hidden = !rec.length;
  $('#recents-list').innerHTML = rec
    .map(
      (f) => `<button class="rec-item" data-food="${f.id}" type="button">
      <div class="rec-main"><div class="rec-name">${esc(f.name)}</div><div class="rec-sub">${esc(f.brand || 'My food')} · ${f.basis === '100g' ? fmt(f.kcal) + ' kcal/100g' : fmt(f.kcal) + ' kcal/serve'}</div></div>
      <div class="rec-kcal">${f.basis === '100g' ? fmt(f.kcal) : ''}</div>
    </button>`
    )
    .join('');
}
$('#recents-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-food]');
  if (!b) return;
  const f = S.getFood(b.dataset.food);
  if (f) { closeSheet(); portionModal(f); }
});

$('#btn-scan').addEventListener('click', () => { closeSheet(); scanBarcode(); });
$('#btn-photo').addEventListener('click', () => { closeSheet(); captureLabel(); });
$('#btn-search-food').addEventListener('click', () => { closeSheet(); searchModal(); });
$('#btn-manual').addEventListener('click', () => { closeSheet(); manualModal(); });

/* ══════════ modal helpers ══════════ */
function openModal(html, { onClose } = {}) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal">${html}</div>`;
  root.appendChild(wrap);
  const close = () => { wrap.remove(); onClose?.(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  return { wrap, close };
}

function toast(msg, icon = 'i-check') {
  const t = $('#toast');
  t.innerHTML = `<svg><use href="#${icon}"/></svg>${esc(msg)}`;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ══════════ portion modal ══════════ */
export function portionModal(food, editFood = null) {
  const basis = food.basis || '100g';
  let qty = basis === '100g' ? 100 : 1;
  const startMeal = state.prefMeal || mealForNow();
  let meal = startMeal;
  state.prefMeal = null;

  const presets = basis === '100g' ? [50, 100, 150, 200] : [0.5, 1, 2, 3];
  const unitLabel = basis === '100g' ? 'g' : '×';
  const step = basis === '100g' ? 25 : 0.5;

  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Add food</div>
    </div>
    <div class="portion-hero"><div class="portion-kcal" id="p-kcal">—</div></div>
    <div class="portion-name"><div class="n">${esc(food.name)}</div><div class="b">${esc(food.brand || (basis === '100g' ? 'per 100 g' : 'per serve'))}${basis === 'serve' && food.servingLabel ? ' · ' + esc(food.servingLabel) : ''}</div></div>
    <div class="qty-controls">
      <button class="qty-btn" data-minus type="button">−</button>
      <div class="qty-input-wrap"><input class="qty-input" id="p-qty" type="number" inputmode="decimal" value="${qty}" step="${step}"><span class="qty-unit">${unitLabel}</span></div>
      <button class="qty-btn" data-plus type="button">+</button>
    </div>
    <div class="qty-presets">${presets.map((p) => `<button class="qty-preset" data-preset="${p}" type="button">${p}${unitLabel === 'g' ? 'g' : ' serve' + (p > 1 ? 's' : '')}</button>`).join('')}</div>
    <div class="macro-preview">
      <div class="mp-cell"><div class="v" id="p-p">—</div><div class="k">Protein</div></div>
      <div class="mp-cell"><div class="v" id="p-c">—</div><div class="k">Carbs</div></div>
      <div class="mp-cell"><div class="v" id="p-f">—</div><div class="k">Fat</div></div>
    </div>
    <div class="meal-picker">${S.MEALS.map((m) => `<button class="meal-opt${m === meal ? ' sel' : ''}" data-meal="${m}" type="button"><svg><use href="#${MEAL_META[m].icon}"/></svg>${MEAL_META[m].label}</button>`).join('')}</div>
    <button class="btn primary" data-confirm type="button">Add to ${MEAL_META[meal].label}</button>
  `);

  const recalc = () => {
    const f = basis === '100g' ? qty / 100 : qty;
    $('#p-kcal', wrap).innerHTML = `${fmt(Math.round((food.kcal || 0) * f))}<span class="unit">kcal</span>`;
    $('#p-p', wrap).textContent = fmt((food.p || 0) * f, 1) + 'g';
    $('#p-c', wrap).textContent = fmt((food.c || 0) * f, 1) + 'g';
    $('#p-f', wrap).textContent = fmt((food.f || 0) * f, 1) + 'g';
    $('#p-qty', wrap).value = qty;
    $$('[data-preset]', wrap).forEach((b) => b.classList.toggle('sel', Number(b.dataset.preset) === qty));
  };
  recalc();

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-minus]')) { qty = Math.max(step, +(qty - step).toFixed(2)); recalc(); vib(5); }
    if (e.target.closest('[data-plus]')) { qty = +(qty + step).toFixed(2); recalc(); vib(5); }
    const pre = e.target.closest('[data-preset]');
    if (pre) { qty = Number(pre.dataset.preset); recalc(); vib(5); }
    const m = e.target.closest('.meal-opt');
    if (m) { meal = m.dataset.meal; $$('.meal-opt', wrap).forEach((b) => b.classList.toggle('sel', b === m)); $('[data-confirm]', wrap).textContent = 'Add to ' + MEAL_META[meal].label; vib(5); }
    if (e.target.closest('[data-confirm]')) {
      const f = basis === '100g' ? qty / 100 : qty;
      const entry = {
        foodId: food.id || null,
        name: food.name,
        brand: food.brand || null,
        kcal: Math.round((food.kcal || 0) * f),
        p: Math.round((food.p || 0) * f * 10) / 10,
        c: Math.round((food.c || 0) * f * 10) / 10,
        f: Math.round((food.f || 0) * f * 10) / 10,
        qtyLabel: basis === '100g' ? `${fmt(qty)} g` : `${fmt(qty, 1)} × serve${food.servingGrams ? ` (${fmt(qty * food.servingGrams)} g)` : ''}`,
        src: food.source || 'manual',
      };
      S.saveFood({ ...food, id: food.id });
      S.addEntry(meal, entry);
      vib(14);
      close();
      renderToday();
      toast(`${food.name} added — ${fmt(entry.kcal)} kcal`);
    }
    if (e.target.closest('[data-close]')) close();
  });
  const inp = $('#p-qty', wrap);
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (isFinite(v) && v > 0) { qty = v; recalc(); } });
}

/* ══════════ search ══════════ */
function searchModal() {
  const { wrap } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Search foods</div>
    </div>
    <div class="field"><input id="q" placeholder="e.g. weet-bix, greek yoghurt, bread…" autocomplete="off"></div>
    <div id="results"></div>
  `);
  const results = $('#results', wrap);
  const input = $('#q', wrap);
  setTimeout(() => input.focus(), 120);

  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) return;
    results.innerHTML = `<div class="loading-row"><div class="spinner"></div>Searching 4M+ foods…</div>`;
    try {
      const list = await OFF.searchFoods(q);
      if (!list.length) { results.innerHTML = `<div class="empty-state">No matches.<br>Try a shorter or different word — or snap the label instead.</div>`; return; }
      results.innerHTML = list
        .map(
          (f, i) => `<button class="food-row" data-i="${i}" type="button">
          ${f.image ? `<img class="food-thumb" src="${esc(f.image)}" alt="" loading="lazy">` : `<span class="food-thumb ph"><svg><use href="#i-search"/></svg></span>`}
          <div class="food-main"><div class="food-name">${esc(f.name)}</div><div class="food-brand">${esc(f.brand || '')}</div></div>
          <div class="food-kcal">${f.basis === '100g' ? fmt(f.kcal) + ' kcal<small>per 100 g</small>' : fmt(f.kcal) + ' kcal<small>per serve</small>'}</div>
        </button>`
        )
        .join('');
      results._list = list;
    } catch (err) {
      results.innerHTML = `<div class="empty-state">Search is having a moment (${esc(err.message)}).<br>Try again shortly.</div>`;
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  input.addEventListener('change', run);
  const btn = document.createElement('button');
  btn.className = 'btn ghost';
  btn.textContent = 'Search';
  btn.addEventListener('click', run);
  results.after(btn);

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) wrap.remove();
    const row = e.target.closest('[data-i]');
    if (row) {
      const f = results._list[Number(row.dataset.i)];
      if (f) { wrap.remove(); portionModal(f); }
    }
  });
}

/* ══════════ barcode scanner ══════════ */
async function scanBarcode() {
  if (!('BarcodeDetector' in window)) {
    openModal(`<div class="modal-head"><button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button><div class="modal-title">Scan barcode</div></div>
      <div class="empty-state">This browser can't scan barcodes directly.<br><br>Snap the nutrition label instead — the AI will read it for you.</div>
      <button class="btn primary" data-photo type="button">Snap the label instead</button>`).wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-photo]')) { e.target.closest('.modal-backdrop').remove(); captureLabel(); }
      if (e.target.closest('[data-close]')) e.target.closest('.modal-backdrop').remove();
    });
    return;
  }
  const view = document.createElement('div');
  view.className = 'scanner-view';
  view.innerHTML = `
    <video playsinline muted></video>
    <div class="scanner-ui">
      <div class="scanner-top">
        <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
        <div class="scanner-title">Scan barcode</div>
        <button class="icon-btn" data-torch type="button"><svg><use href="#i-flame"/></svg></button>
      </div>
      <div class="reticle"></div>
      <div class="scanner-hint" data-hint>Point at the barcode — it scans automatically</div>
      <div class="scanner-bottom"><button class="scanner-btn" data-label type="button"><svg><use href="#i-cam"/></svg>Label photo instead</button></div>
    </div>`;
  document.body.appendChild(view);
  const video = $('video', view);

  let stream, stop = false, torchOn = false, track;
  const cleanup = () => { stop = true; try { stream?.getTracks().forEach((t) => t.stop()); } catch {} view.remove(); };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    track = stream.getVideoTracks()[0];
  } catch {
    cleanup();
    toast('Camera unavailable', 'i-x');
    return;
  }

  const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
  const tick = async () => {
    if (stop) return;
    try {
      const codes = await det.detect(video);
      if (codes.length) {
        const code = codes[0].rawValue;
        vib(40);
        const hint = $('[data-hint]', view);
        hint.textContent = `Found ${code} — checking the database…`;
        const f = await OFF.getProduct(code);
        cleanup();
        if (!f) {
          openModal(`<div class="modal-head"><button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button><div class="modal-title">Not found</div></div>
            <div class="empty-state">Barcode <b>${esc(code)}</b> isn't in the database yet.<br><br>Snap the label on the pack instead — the AI will read it.</div>
            <button class="btn primary" data-photo type="button">Snap the label</button>`).wrap.addEventListener('click', (e) => {
            if (e.target.closest('[data-photo]')) { e.target.closest('.modal-backdrop').remove(); captureLabel(); }
            if (e.target.closest('[data-close]')) e.target.closest('.modal-backdrop').remove();
          });
          return;
        }
        portionModal(f);
        return;
      }
    } catch {}
    setTimeout(tick, 280);
  };
  tick();

  view.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) cleanup();
    if (e.target.closest('[data-label]')) { cleanup(); captureLabel(); }
    if (e.target.closest('[data-torch]') && track) {
      try { torchOn = !torchOn; await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch {}
    }
  });
}

/* ══════════ label photo + AI ══════════ */
function captureLabel() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.capture = 'environment';
  inp.addEventListener('change', async () => {
    const file = inp.files?.[0];
    if (!file) return;
    const dataUrl = await downscale(file, 1400, 0.84);
    labelReviewModal(dataUrl);
  });
  inp.click();
}

function downscale(file, maxSide, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.src = URL.createObjectURL(file);
  });
}

function labelReviewModal(dataUrl) {
  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Reading the label…</div>
    </div>
    <div class="photo-frame"><img src="${dataUrl}" alt=""><div class="photo-scanline"></div></div>
    <div class="ai-status"><div class="spinner"></div><span>AI is reading the nutrition panel…</span></div>
  `);

  fetch('/api/parse-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  })
    .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      if (!ok || !j.result) throw new Error(j.message || 'parse_failed');
      const res = j.result;
      if (!res.found) throw new Error('no_panel');
      labelConfirmModal(dataUrl, res);
      close();
    })
    .catch((e) => {
      const msg = e.message === 'no_panel'
        ? `Couldn't spot a nutrition panel in that photo. Get the <b>"NUTRITION INFORMATION"</b> box in frame, flat and in focus.`
        : e.message === 'parse_failed' || e.message?.includes('read')
          ? esc(e.message)
          : `Couldn't read the label (${esc(e.message)}). Try again with a flatter, closer photo.`;
      wrap.querySelector('.ai-status').outerHTML = `<div class="empty-state">${msg}</div>`;
      wrap.querySelector('.modal-title').textContent = "Couldn't read it";
      const retry = document.createElement('button');
      retry.className = 'btn primary';
      retry.textContent = 'Try another photo';
      retry.addEventListener('click', () => { close(); captureLabel(); });
      wrap.querySelector('.modal').appendChild(retry);
    });
}

function labelConfirmModal(dataUrl, res) {
  const use100 = res.has_per_100g && res.per_100g.energy_kcal !== null || (res.has_per_100g && res.per_100g.energy_kj !== null);
  const basis = use100 ? '100g' : 'serve';
  const src = basis === '100g' ? res.per_100g : res.per_serve;
  const kjToKcal = src.energy_kcal === null && src.energy_kj !== null;
  const kcalVal = src.energy_kcal ?? (kjToKcal ? Math.round(src.energy_kj / 4.184) : '');

  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Check what I read</div>
    </div>
    <div class="photo-frame" style="max-height:180px"><img src="${dataUrl}" alt=""></div>
    <div class="field"><span>Name</span><input id="l-name" value="${esc(res.product_name || '')}" placeholder="Product name"></div>
    <div class="field"><span>Brand</span><input id="l-brand" value="${esc(res.brand || '')}" placeholder="Brand"></div>
    <div class="qty-presets" style="justify-content:flex-start">
      <button class="qty-preset${basis === '100g' ? ' sel' : ''}" data-basis="100g" type="button">per 100 g</button>
      <button class="qty-preset${basis === 'serve' ? ' sel' : ''}" data-basis="serve" type="button">per serve</button>
    </div>
    <div class="nutri-grid">
      <label class="field"><span>Energy (kcal ${basis === '100g' ? '/100g' : '/serve'})</span><input id="l-kcal" type="number" inputmode="decimal" value="${kcalVal}"></label>
      <label class="field"><span>Protein (g)</span><input id="l-p" type="number" inputmode="decimal" value="${src.protein_g ?? ''}"></label>
      <label class="field"><span>Carbs (g)</span><input id="l-c" type="number" inputmode="decimal" value="${src.carbs_g ?? ''}"></label>
      <label class="field"><span>Fat (g)</span><input id="l-f" type="number" inputmode="decimal" value="${src.fat_g ?? ''}"></label>
    </div>
    <div class="field"><span>Serving size (optional)</span><input id="l-serving" value="${esc(res.serve_size_text || '')}" placeholder="e.g. 2 slices (78 g)"></div>
    <p class="nutri-note">${kjToKcal ? '⚡ Energy was shown in kJ — converted to kcal (÷ 4.184). ' : ''}${res.notes ? esc(res.notes) + ' ' : ''}Fix anything the AI misread, then continue.</p>
    <button class="btn primary" data-next type="button">Looks right — next</button>
  `);

  let selBasis = basis;
  const get = (id) => $(id, wrap).value;
  const buildFood = () => {
    const serve = get('#l-serving');
    const grams = /([\d.]+)\s*g/i.exec(serve)?.[1];
    return {
      name: get('#l-name').trim() || 'Scanned food',
      brand: get('#l-brand').trim() || null,
      basis: selBasis,
      kcal: parseFloat(get('#l-kcal')) || null,
      p: parseFloat(get('#l-p')) || null,
      c: parseFloat(get('#l-c')) || null,
      f: parseFloat(get('#l-f')) || null,
      servingLabel: serve || null,
      servingGrams: grams ? parseFloat(grams) : null,
      source: 'ai',
    };
  };

  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-basis]');
    if (b && b.dataset.basis !== selBasis) {
      // switch basis: fill from the other column if we have it
      selBasis = b.dataset.basis;
      const d = selBasis === '100g' ? res.per_100g : res.per_serve;
      const kj = d.energy_kcal === null && d.energy_kj !== null;
      const kv = d.energy_kcal ?? (kj ? Math.round(d.energy_kj / 4.184) : '');
      if (kv !== '' && kv !== null) $('#l-kcal', wrap).value = kv;
      if (d.protein_g !== null) $('#l-p', wrap).value = d.protein_g;
      if (d.carbs_g !== null) $('#l-c', wrap).value = d.carbs_g;
      if (d.fat_g !== null) $('#l-f', wrap).value = d.fat_g;
      $$('[data-basis]', wrap).forEach((x) => x.classList.toggle('sel', x === b));
      return;
    }
    if (e.target.closest('[data-next]')) {
      const food = buildFood();
      if (!food.kcal) { toast('Energy value needed', 'i-x'); return; }
      S.saveFood(food);
      close();
      portionModal(food);
    }
    if (e.target.closest('[data-close]')) close();
  });
}

/* ══════════ manual entry ══════════ */
function manualModal() {
  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Enter manually</div>
    </div>
    <div class="field"><span>Name</span><input id="m-name" placeholder="e.g. Mum's lasagna"></div>
    <div class="qty-presets" style="justify-content:flex-start">
      <button class="qty-preset sel" data-basis="100g" type="button">per 100 g</button>
      <button class="qty-preset" data-basis="serve" type="button">per serve</button>
    </div>
    <div class="nutri-grid">
      <label class="field"><span>Energy (kcal)</span><input id="m-kcal" type="number" inputmode="decimal"></label>
      <label class="field"><span>Protein (g)</span><input id="m-p" type="number" inputmode="decimal"></label>
      <label class="field"><span>Carbs (g)</span><input id="m-c" type="number" inputmode="decimal"></label>
      <label class="field"><span>Fat (g)</span><input id="m-f" type="number" inputmode="decimal"></label>
    </div>
    <div class="field"><span>Serving size (optional, if per serve)</span><input id="m-serving" placeholder="e.g. 1 bowl (350 g)"></div>
    <button class="btn primary" data-next type="button">Next →</button>
  `);
  let selBasis = '100g';
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-basis]');
    if (b) { selBasis = b.dataset.basis; $$('[data-basis]', wrap).forEach((x) => x.classList.toggle('sel', x === b)); return; }
    if (e.target.closest('[data-next]')) {
      const name = $('#m-name', wrap).value.trim();
      const kcal = parseFloat($('#m-kcal', wrap).value);
      if (!name || !isFinite(kcal)) { toast('Name and energy needed', 'i-x'); return; }
      const serve = $('#m-serving', wrap).value;
      const grams = /([\d.]+)\s*g/i.exec(serve)?.[1];
      const food = {
        name, brand: null, basis: selBasis, kcal,
        p: parseFloat($('#m-p', wrap).value) || null,
        c: parseFloat($('#m-c', wrap).value) || null,
        f: parseFloat($('#m-f', wrap).value) || null,
        servingLabel: serve || null, servingGrams: grams ? parseFloat(grams) : null,
        source: 'manual',
      };
      S.saveFood(food);
      close();
      portionModal(food);
    }
    if (e.target.closest('[data-close]')) close();
  });
}

/* ══════════ history ══════════ */
function renderHistory() {
  const days = S.recentDays(14).slice(0, 14);
  const goal = S.getState().goals.kcal;
  const logged = days.filter((d) => d.any);
  const avg = logged.length ? Math.round(logged.reduce((a, d) => a + d.totals.kcal, 0) / logged.length) : 0;
  $('#hist-avg').textContent = logged.length ? `avg ${fmt(avg)} kcal · goal ${fmt(goal)}` : '';

  // chart
  const c = $('#hist-chart');
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth || 320, H = 120;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const n = days.length, gap = 4, bw = (W - gap * (n - 1)) / n;
  const maxV = Math.max(goal * 1.4, ...days.map((d) => d.totals.kcal));
  const y = (v) => H - 14 - (v / maxV) * (H - 26);
  // goal line
  ctx.strokeStyle = 'rgba(255,161,23,.5)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, y(goal)); ctx.lineTo(W, y(goal)); ctx.stroke();
  ctx.setLineDash([]);
  days.slice().reverse().forEach((d, i) => {
    const val = d.totals.kcal;
    const x = i * (bw + gap);
    const over = val > goal;
    const grad = ctx.createLinearGradient(0, y(val), 0, H - 14);
    grad.addColorStop(0, over ? '#FF5D6C' : '#FFB224');
    grad.addColorStop(1, over ? 'rgba(255,93,108,.25)' : 'rgba(255,122,0,.25)');
    ctx.fillStyle = val ? grad : 'rgba(255,255,255,.05)';
    const h = val ? Math.max(H - 14 - y(val), 3) : 3;
    const r = Math.min(bw / 2, 5);
    const bx = x, by = y(Math.max(val, 0)), bh = h;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.font = '10px Inter, sans-serif';
  days.slice().reverse().forEach((d, i) => {
    if (i % 3 === 0 || i === n - 1) {
      const x = i * (bw + gap) + bw / 2;
      const lbl = d.key.slice(8);
      ctx.fillText(lbl, x - 5, H - 2);
    }
  });

  // list
  const list = $('#history-list');
  const loggedDays = days.filter((d) => d.any);
  if (!loggedDays.length) {
    list.innerHTML = `<div class="empty-state">No days logged yet.<br>Once you start logging, your history lands here.</div>`;
    return;
  }
  list.innerHTML = loggedDays
    .map((d) => {
      const t = d.totals;
      const under = t.kcal <= goal;
      return `<button class="hrow" data-day="${d.key}" type="button">
      <div class="hrow-day"><div class="hrow-date">${S.fmtDate(d.key)}</div><div class="hrow-sub">P ${fmt(Math.round(t.p))}g · C ${fmt(Math.round(t.c))}g · F ${fmt(Math.round(t.f))}g</div></div>
      <div class="hrow-kcal ${under ? 'under' : 'over'}">${fmt(t.kcal)}</div>
    </button>`;
    })
    .join('');
  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-day]');
    if (row) dayDetailModal(row.dataset.day);
  }, { once: true });
}

function dayDetailModal(key) {
  const log = S.dayLog(key);
  const t = S.dayTotals(key);
  const rows = S.MEALS.map((m) => {
    const items = log.meals[m];
    if (!items.length) return '';
    return `<h3 class="recents-title" style="margin-top:14px">${MEAL_META[m].label}</h3>` +
      items.map((e) => `<div class="food-row"><div class="food-main"><div class="food-name">${esc(e.name)}</div><div class="food-brand">${esc(e.qtyLabel || '')}</div></div><div class="food-kcal">${fmt(e.kcal)}</div></div>`).join('');
  }).join('');
  openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">${S.fmtDate(key)}</div>
    </div>
    <div class="target-big">${fmt(t.kcal)}<span class="unit">kcal</span></div>
    <div class="macro-preview"><div class="mp-cell"><div class="v">${fmt(Math.round(t.p))}g</div><div class="k">Protein</div></div><div class="mp-cell"><div class="v">${fmt(Math.round(t.c))}g</div><div class="k">Carbs</div></div><div class="mp-cell"><div class="v">${fmt(Math.round(t.f))}g</div><div class="k">Fat</div></div></div>
    ${rows || '<div class="empty-state">Nothing logged this day.</div>'}
  `).wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) e.target.closest('.modal-backdrop').remove(); });
}

/* ══════════ settings ══════════ */
function renderSettings() {
  const st = S.getState();
  const p = st.profile, g = st.goals;
  $('#set-sex').value = p.sex;
  $('#set-age').value = p.age;
  $('#set-height').value = p.height;
  $('#set-weight').value = p.weight;
  $('#set-activity').value = String(p.activity);
  $('#set-goal-type').value = p.goalType;
  $('#set-rate').value = String(p.rate);
  $('#set-target-display').textContent = fmt(g.kcal);
  $('#set-prot').value = g.protein;
  $('#set-carbs').value = g.carbs;
  $('#set-fat').value = g.fat;
  const t = S.computeTargets(p);
  $('#tdee-hint').textContent = `Estimated burn (TDEE): ${fmt(t.bdee)} kcal/day — targets recalculated from this.`;
}

$('#btn-save-profile').addEventListener('click', () => {
  const p = {
    sex: $('#set-sex').value,
    age: +$('#set-age').value || 38,
    height: +$('#set-height').value || 180,
    weight: +$('#set-weight').value || 85,
    activity: +$('#set-activity').value || 1.55,
    goalType: $('#set-goal-type').value,
    rate: +$('#set-rate').value || 0.5,
  };
  S.setProfile(p);
  const t = S.computeTargets(p);
  S.setGoals({ kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat });
  renderSettings();
  renderToday();
  vib(12);
  toast(`Targets updated — ${fmt(t.kcal)} kcal`);
});

$('#btn-save-macros').addEventListener('click', () => {
  S.setGoals({
    protein: +$('#set-prot').value || 0,
    carbs: +$('#set-carbs').value || 0,
    fat: +$('#set-fat').value || 0,
  });
  renderToday();
  vib(10);
  toast('Macros saved');
});

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([S.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fuel-backup-${S.dayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded');
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    S.importJSON(await f.text());
    renderAll();
    renderToday();
    toast('Backup restored');
  } catch {
    toast('That file didn\'t look right', 'i-x');
  }
});

$('#btn-reset').addEventListener('click', () => {
  if (confirm('Erase ALL logged data, foods and settings?')) {
    S.resetAll();
    renderAll();
    renderToday();
    toast('Fresh start');
  }
});

/* ══════════ demo seed (only with ?demo=1) ══════════ */
function seedDemo() {
  const st = S.getState();
  if (Object.keys(st.logs).length) return;
  const demo = [
    ['breakfast', { name: 'Uncle Tobys Oats', brand: 'Uncle Tobys', kcal: 302, p: 11, c: 50, f: 6, qtyLabel: '75 g' }],
    ['breakfast', { name: 'Greek Yoghurt', brand: 'Chobani', kcal: 129, p: 17, c: 8, f: 4, qtyLabel: '170 g' }],
    ['lunch', { name: 'Chicken Breast (grilled)', kcal: 396, p: 66, c: 0, f: 14, qtyLabel: '210 g' }],
    ['lunch', { name: 'White Rice (cooked)', kcal: 232, p: 5, c: 50, f: 0.6, qtyLabel: '180 g' }],
    ['snacks', { name: 'Protein Shake', brand: 'Optimum Nutrition', kcal: 120, p: 24, c: 3, f: 1.5, qtyLabel: '30 g + water' }],
  ];
  for (const [meal, e] of demo) S.addEntry(meal, e);
  renderToday();
}
