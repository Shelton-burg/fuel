// FUEL — app UI + flows.
import * as S from './store.js';
import * as OFF from './off.js';
import * as CH from './charts.js';
import * as SY from './sync.js';
import { dayIdFor, PROGRAMS } from './programs.js';

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
let selDate = S.dayKey(); // the day being viewed/edited (day navigation)
let histMetric = 'kcal'; // history chart metric: kcal | protein
let quickCache = []; // quick-add chips resolve their food via this (frequent + fits)
let health = { tg: false, sync: false }; // server capabilities (/api/health) — read by Settings panels
const isToday = () => selDate === S.dayKey();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (new URLSearchParams(location.search).get('demo') === '1') seedDemo();

renderAll();
$('#btn-fab').addEventListener('click', openAddSheet);
$('#btn-date').addEventListener('click', openDaySheet);
$('#daynav-pill').addEventListener('click', () => setDay(S.dayKey()));
$('#chip-weight').addEventListener('click', weightModal);
$('#week-panel').addEventListener('click', () => switchView('history'));
$('#nudge').addEventListener('click', () => {
  const a = $('#nudge').dataset.nact;
  if (a === 'train') switchView('train');
  else if (a === 'add') openAddSheet();
  else if (a === 'quick') { switchView('today'); $('#quick-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
});
$('#hist-metrics').addEventListener('click', (e) => {
  const b = e.target.closest('[data-metric]');
  if (!b) return;
  histMetric = b.dataset.metric;
  renderHistory();
  vib(5);
});
$('#history-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-day]');
  if (row) navigateToDay(row.dataset.day);
});
$$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

/* ── goals & AI coach ── */
let coachBusy = false;
let weeklyBusy = false;
let mpBusy = false;
let goalsFrom = 'settings';

$('#btn-open-goals').addEventListener('click', () => { goalsFrom = 'settings'; switchView('goals'); });

$('#goals-body').addEventListener('click', (e) => {
  const t = e.target;
  const asp = t.closest('[data-aspir]');
  if (asp) {
    const a = asp.dataset.aspir;
    S.setProfile({ aspir: a, ...GOAL_DEFAULTS[a] });
    renderGoals(); vib(6); return;
  }
  if (t.closest('[data-goals-back]')) { renderSettings(); switchView(goalsFrom); return; }
  if (t.closest('#btn-ask-coach')) { if (!coachBusy) askCoach(); return; }
  if (t.closest('#btn-apply-targets')) { applyCoachPlan(); return; }
  if (t.closest('#btn-apply-program')) { applyCoachProgram(); return; }
  if (t.closest('#btn-run-weekly') || t.closest('#btn-ask-weekly')) { if (!weeklyBusy) runWeekly(false); return; }
  if (t.closest('#btn-build-full')) { if (!mpBusy) runMealPlan(S.getSetting('mealPlan')?.mode && t.closest('.plan-foot') ? S.getSetting('mealPlan').mode : 'full'); return; }
  if (t.closest('#btn-build-left')) { if (!mpBusy) runMealPlan('left'); return; }
  const mpAdd = t.closest('[data-mp-add]');
  if (mpAdd) { addMealPlan(mpAdd.dataset.mpAdd); return; }
  if (t.closest('#btn-mp-add-all')) { addMealPlan('all'); return; }
  const wt = t.closest('[data-wtweak]');
  if (wt) { applyWeeklyTweak(+wt.dataset.wtweak); return; }
});

$('#goals-body').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'goal-target') S.setProfile({ targetWeight: t.value ? Math.round(+t.value * 10) / 10 : null });
  else if (t.id === 'goal-rate') S.setProfile({ rate: +t.value || 0.5 });
  else if (t.id === 'goal-cals') S.setProfile({ calPref: t.value ? Math.round(+t.value) : null });
  else if (t.id === 'goal-notes') S.setProfile({ notes: t.value.slice(0, 400) });
  else return;
  renderGoals();
});

maybeWeeklyCheckin();

/* ══════════ day navigation ══════════ */
const DAY_MS = 864e5;

function setDay(key, opts = {}) {
  const today = S.dayKey();
  if (key > today) key = today; // ISO keys compare lexically — never navigate past today
  selDate = key;
  renderToday();
  if (!opts.silent) vib(6);
}

function navigateToDay(key) {
  setDay(key, { silent: true });
  switchView('today');
}

function shiftKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return S.dayKey(new Date(y, m - 1, d + delta));
}

function openDaySheet() {
  const today = S.dayKey();
  const yest = S.dayKey(new Date(Date.now() - DAY_MS));
  const week = [];
  for (let i = 0; i < 7; i++) week.push(S.dayKey(new Date(Date.now() - i * DAY_MS)));

  const strip = week
    .map((k) => {
      const [y, m, d] = k.split('-').map(Number);
      const wd = new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short' });
      const any = S.MEALS.some((mm) => (S.getState().logs[k]?.meals?.[mm] || []).length);
      return `<button class="daycell${k === selDate ? ' sel' : ''}" data-day="${k}" type="button" aria-label="${S.fmtDate(k)}">
        <span class="dc-wd">${wd}</span><span class="dc-d">${d}</span>${any ? '<span class="dc-dot"></span>' : ''}
      </button>`;
    })
    .join('');

  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Jump to a day</div>
    </div>
    <div class="daynav-row">
      <button class="daynav-arrow" data-prev type="button" aria-label="Previous day"><svg class="flip"><use href="#i-chev"/></svg></button>
      <div class="daynav-label" id="dn-label">${S.fmtDate(selDate)}</div>
      <button class="daynav-arrow" data-next type="button" aria-label="Next day" ${selDate >= today ? 'disabled' : ''}><svg><use href="#i-chev"/></svg></button>
    </div>
    <div class="day-strip">${strip}</div>
    <div class="daynav-quick">
      <button class="qty-preset${selDate === today ? ' sel' : ''}" data-today type="button">Today</button>
      <button class="qty-preset${selDate === yest ? ' sel' : ''}" data-yest type="button">Yesterday</button>
    </div>
    <label class="field"><span>Or pick a date</span><input id="dn-input" type="date" max="${today}" value="${selDate}"></label>
    <p class="nutri-note">Log or fix anything for that day — the ring and totals follow along.</p>
  `);

  const sync = (cur) => {
    $('#dn-label', wrap).textContent = S.fmtDate(cur);
    $$('[data-day]', wrap).forEach((b) => b.classList.toggle('sel', b.dataset.day === cur));
    $('[data-next]', wrap).disabled = cur >= today;
    $('#dn-input', wrap).value = cur;
    $('[data-today]', wrap).classList.toggle('sel', cur === today);
    $('[data-yest]', wrap).classList.toggle('sel', cur === yest);
  };

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-prev]')) { setDay(shiftKey(selDate, -1), { silent: true }); sync(selDate); vib(5); return; }
    if (e.target.closest('[data-next]')) { if (selDate < today) { setDay(shiftKey(selDate, 1), { silent: true }); sync(selDate); vib(5); } return; }
    const cell = e.target.closest('[data-day]');
    if (cell) { setDay(cell.dataset.day); close(); return; }
    if (e.target.closest('[data-today]')) { setDay(today); close(); return; }
    if (e.target.closest('[data-yest]')) { setDay(yest); close(); return; }
  });
  $('#dn-input', wrap).addEventListener('change', (e) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { setDay(e.target.value); close(); }
  });
}

function switchView(v) {
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  vib(6);
  if (v === 'history') { renderHistory(); renderConsistency(); }
  if (v === 'today') renderWeek();
  if (v === 'goals') renderGoals();
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
  const t = S.dayTotals(selDate);
  const g = S.getState().goals;
  const left = g.kcal - t.kcal;

  // day chip + past-day banner
  $('#topbar-date').textContent = S.fmtDate(selDate);
  $('#btn-date').classList.toggle('past', !isToday());
  $('#daynav-pill').hidden = isToday();
  $('#dayview-date').textContent = S.fmtDate(selDate);

  const n = isToday() ? buildNudge() : null;
  const nb = $('#nudge');
  nb.hidden = !n;
  if (n) { $('#nudge-ico').textContent = n.ico; $('#nudge-txt').textContent = n.txt; nb.dataset.nact = n.act; }

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

  const log = S.dayLog(selDate);
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
        ${items.length ? `<button class="meal-save" data-savecl="${m}" type="button" aria-label="Save as usual"><svg><use href="#i-bookmark"/></svg></button>` : ''}
        <button class="meal-add" data-add-meal="${m}" type="button"><svg><use href="#i-plus"/></svg></button>
      </div>
      ${items.length ? `<div class="meal-items">${rows}</div>` : ''}
    </div>`;
  }).join('');
  renderQuick();
  renderWeek();
}

$('#meals').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const row = del.closest('.mi');
    S.removeEntry(row.dataset.meal, row.dataset.id, selDate);
    vib(10);
    renderToday();
    return;
  }
  const savecl = e.target.closest('[data-savecl]');
  if (savecl) { saveUsualModal(savecl.dataset.savecl); return; }
  const add = e.target.closest('[data-add-meal]');
  if (add) { state.prefMeal = add.dataset.addMeal; openAddSheet(); }
});

/* ══════════ quick add (usuals · frequent · fits-what's-left) ══════════ */
function renderQuick() {
  const panel = $('#quick-panel');
  if (!panel) return;
  const st = S.getState();
  const t = S.dayTotals(selDate);
  const left = st.goals.kcal - t.kcal;
  const leftP = st.goals.protein - t.p;
  $('#quick-sub').textContent = isToday() ? '' : `logging to ${S.fmtDate(selDate)}`;

  const us = S.usuals();
  $('#quick-usuals').innerHTML = us.length
    ? `<div class="q-label muted sm">Your usuals</div><div class="chip-row wrap" id="quick-usual-chips">${us
        .map((u) => `<span class="qchip usual" data-uid="${u.id}" role="button" tabindex="0"><b>${esc(u.name)}</b><i>${fmt(u.kcal)} kcal</i><span class="qdel" data-delusual="${u.id}" aria-label="Delete usual">✕</span></span>`)
        .join('')}</div>`
    : `<p class="hint muted" style="margin:0 0 10px">Save any meal as a “usual” (bookmark button on the meal card) → one-tap re-log next time.</p>`;

  const freq = S.frequentFoods(6);
  quickCache = freq;
  $('#q-freq-label').hidden = !freq.length;
  $('#quick-freq').innerHTML = freq
    .map((f, i) => `<button class="qchip" data-qi="${i}" type="button"><b>${esc(f.name)}</b><i>${fmt(f.kcal)} kcal${f.p >= 15 ? ` · ${Math.round(f.p)}g P` : ''}</i></button>`)
    .join('');

  const fit = freq.filter((f) => f.kcal && f.kcal <= Math.max(left, 0) + 40).sort((a, b) => (b.p || 0) - (a.p || 0)).slice(0, 3);
  const fitLabel = $('#q-fit-label');
  if (left <= 80) {
    fitLabel.hidden = false;
    fitLabel.textContent = 'Right at your goal for this day — nice 👍';
    $('#quick-fit').innerHTML = '';
  } else if (fit.length) {
    fitLabel.hidden = false;
    fitLabel.textContent = leftP > 30 ? `Fits what's left — ~${fmt(left)} kcal · ${Math.round(leftP)}g protein to go` : `Fits what's left — ~${fmt(left)} kcal to go`;
    $('#quick-fit').innerHTML = fit
      .map((f) => {
        quickCache.push(f);
        return `<button class="qchip fit" data-qi="${quickCache.length - 1}" type="button"><b>${esc(f.name)}${f.qtyLabel ? ` <i>${esc(f.qtyLabel)}</i>` : ''}</b><i>${fmt(f.kcal)} kcal · ${Math.round(f.p)}g P</i></button>`;
      })
      .join('');
  } else {
    fitLabel.hidden = true;
    $('#quick-fit').innerHTML = '';
  }
}

$('#quick-panel').addEventListener('click', (e) => {
  const del = e.target.closest('[data-delusual]');
  if (del) { S.removeUsual(del.dataset.delusual); renderQuick(); toast('Usual removed'); return; }
  const uid = e.target.closest('[data-uid]');
  if (uid) {
    const u = S.logUsual(uid.dataset.uid, selDate);
    if (u) { vib(10); renderToday(); toast(`${u.name} added — ${fmt(u.kcal)} kcal${isToday() ? '' : ' · ' + S.fmtDate(selDate)}`); }
    return;
  }
  const qi = e.target.closest('[data-qi]');
  if (qi) {
    const f = quickCache[+qi.dataset.qi];
    if (f) {
      S.addEntry(mealForNow(), { name: f.name, kcal: f.kcal, p: f.p, c: f.c, f: f.f, qtyLabel: f.qtyLabel || '' }, selDate);
      vib(10);
      renderToday();
      toast(`${f.name} added${isToday() ? '' : ' · ' + S.fmtDate(selDate)}`);
    }
  }
});

function saveUsualModal(meal) {
  const logv = S.dayLog(selDate);
  const items = logv.meals[meal];
  if (!items.length) return;
  const mk = items.reduce((a, e) => a + (e.kcal || 0), 0);
  const label = MEAL_META[meal].label;
  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Save as usual</div>
    </div>
    <div class="field"><span>Name it</span>
      <input id="usual-name" type="text" maxlength="40" value="My ${label.toLowerCase()}" /></div>
    <div class="usual-preview">${items.map((e) => `<div class="wt-row"><span>${esc(e.name)}</span><b>${fmt(e.kcal)} kcal</b></div>`).join('')}<div class="wt-row total"><span>Total</span><b>${fmt(mk)} kcal</b></div></div>
    <p class="nutri-note">One tap on Today re-logs all of it. Saving the same name again updates it.</p>
    <button class="btn primary" data-save-usual type="button">Save usual</button>
  `);
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-save-usual]')) {
      const name = ($('#usual-name', wrap).value || '').trim() || `My ${label.toLowerCase()}`;
      S.saveUsual(name, meal, items);
      close();
      renderToday();
      vib(12);
      toast(`Saved “${name}” — one-tap it from Quick add`);
    }
  });
}

/* ══════════ consistency heatmap ══════════ */
function renderConsistency() {
  const grid = $('#heat-grid');
  if (!grid) return;
  const goal = S.getState().goals.kcal;
  const todayK = S.dayKey();
  const dow = (new Date().getDay() + 6) % 7; // Mon = 0
  const monday = new Date(Date.now() - dow * 864e5);
  monday.setHours(0, 0, 0, 0);
  const start = monday.getTime() - 13 * 7 * 864e5;
  const cells = [];
  for (let i = 0; i < 98; i++) {
    const d = new Date(start + i * 864e5);
    const k = S.dayKey(d);
    if (k > todayK) { cells.push('<i class="hc empty"></i>'); continue; }
    const t = S.dayTotals(k);
    let style = '';
    if (t.kcal > 0) {
      const ratio = t.kcal / goal;
      const alpha = Math.min(1, Math.max(0.25, ratio)).toFixed(2);
      style = ` style="background:${ratio > 1.03 ? 'rgba(255,93,108,' : 'rgba(255,161,23,'}${alpha})"`;
    }
    cells.push(`<span class="hc${k === todayK ? ' today' : ''}" data-day="${k}"${style}></span>`);
  }
  grid.innerHTML = cells.join('');
  const streak = S.streak();
  $('#streak-line').textContent = streak >= 2 ? `🔥 ${streak}-day streak` : '';
}
$('#heat-grid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-day]');
  if (c) navigateToDay(c.dataset.day);
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
      S.addEntry(meal, entry, selDate);
      vib(14);
      close();
      renderToday();
      toast(`${food.name} added — ${fmt(entry.kcal)} kcal${isToday() ? '' : ` · ${S.fmtDate(selDate)}`}`);
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
const METRIC_META = {
  kcal: { legend: 'Daily kcal vs goal', unit: 'kcal' },
  protein: { legend: 'Daily protein vs goal', unit: 'g' },
};

function renderHistory() {
  const days = S.recentDays(14);
  const st = S.getState();
  const meta = METRIC_META[histMetric] || METRIC_META.kcal;
  const goal = histMetric === 'protein' ? st.goals.protein : st.goals.kcal;
  const val = (d) => (histMetric === 'protein' ? d.totals.p : d.totals.kcal);

  $('#hist-legend').textContent = meta.legend;
  $$('#hist-metrics .chip').forEach((c) => c.classList.toggle('sel', c.dataset.metric === histMetric));

  const logged = days.filter((d) => d.any);
  const avg = logged.length ? Math.round(logged.reduce((a, d) => a + val(d), 0) / logged.length) : 0;
  $('#hist-avg').textContent = logged.length ? `avg ${fmt(avg)} ${meta.unit} · goal ${fmt(goal)} ${meta.unit}` : '';

  CH.bars($('#hist-chart'), {
    data: days.slice().reverse().map((d) => ({ label: d.key.slice(8), value: val(d) })),
    goal,
    cssH: 120,
    labelEvery: 3,
    overColor: histMetric === 'kcal', // over-goal red only means something for calories
  });

  const list = $('#history-list');
  if (!logged.length) {
    list.innerHTML = `<div class="empty-state">No days logged yet.<br>Once you start logging, your history lands here.</div>`;
    return;
  }
  list.innerHTML = logged
    .map((d) => {
      const t = d.totals;
      const under = histMetric === 'protein' ? t.p >= st.goals.protein : t.kcal <= st.goals.kcal;
      const num = histMetric === 'protein' ? fmt(Math.round(t.p)) + 'g' : fmt(t.kcal);
      return `<button class="hrow" data-day="${d.key}" type="button">
      <div class="hrow-day"><div class="hrow-date">${S.fmtDate(d.key)}</div><div class="hrow-sub">P ${fmt(Math.round(t.p))}g · C ${fmt(Math.round(t.c))}g · F ${fmt(Math.round(t.f))}g</div></div>
      <div class="hrow-kcal ${under ? 'under' : 'over'}">${num}</div>
      <svg class="hrow-chev"><use href="#i-chev"/></svg>
    </button>`;
    })
    .join('');
}

/* ══════════ this week (mini chart on Today) ══════════ */
function renderWeek() {
  const panel = $('#week-panel');
  if (!panel) return;
  const days = S.recentDays(7).slice().reverse(); // oldest → newest
  const goal = S.getState().goals.kcal;
  const logged = days.filter((d) => d.any);
  const avg = logged.length ? Math.round(logged.reduce((a, d) => a + d.totals.kcal, 0) / logged.length) : 0;
  $('#week-sub').textContent = logged.length ? `avg ${fmt(avg)} kcal · ${logged.length}/7 logged` : 'nothing logged yet';
  const hi = days.findIndex((d) => d.key === selDate);
  CH.bars($('#week-chart'), {
    data: days.map((d) => {
      const [y, m, dd] = d.key.split('-').map(Number);
      const wd = new Date(y, m - 1, dd).toLocaleDateString('en-AU', { weekday: 'narrow' });
      return { label: wd, value: d.totals.kcal };
    }),
    goal,
    cssH: 64,
    labelEvery: 1,
    highlight: hi,
    padB: 16,
    padT: 10,
  });
}

/* ══════════ body weight log ══════════ */
function weightModal() {
  const latest = S.latestWeight();
  const cur = S.getWeight(selDate) ?? latest?.kg ?? S.getState().profile.weight;
  const recent = S.weightSeries().slice(-5).reverse();
  const rows = recent
    .map((w) => `<div class="wt-row"><span>${S.fmtDate(w.key)}</span><b>${fmt(w.kg, 1)} kg</b></div>`)
    .join('');
  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Log weight</div>
    </div>
    <div class="field"><span>Weight for ${S.fmtDate(selDate)} (kg)</span>
      <input id="w-val" type="number" inputmode="decimal" step="0.1" min="30" max="250" value="${fmt(cur, 1)}"></div>
    ${rows ? `<div class="wt-list">${rows}</div>` : ''}
    <p class="nutri-note">Recent check-ins above. Your latest entry keeps the calorie target in sync — the date chip decides which day it lands on.</p>
    <button class="btn primary" data-save type="button">Save weight</button>
  `);
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-save]')) {
      const v = parseFloat($('#w-val', wrap).value);
      if (!(v >= 30 && v <= 250)) { toast('Enter a weight between 30–250 kg', 'i-x'); return; }
      S.logWeight(selDate, Math.round(v * 10) / 10);
      close();
      renderToday();
      vib(12);
      toast(`Weight logged — ${fmt(Math.round(v * 10) / 10, 1)} kg`);
    }
  });
}

/* ══════════ goals & AI coach (screen) ══════════ */
const GOAL_DEFAULTS = {
  lose: { goalType: 'lose', rate: 0.5 },
  muscle: { goalType: 'gain', rate: 0.5 },
  strength: { goalType: 'gain', rate: 0.25 },
  maintain: { goalType: 'maintain', rate: 0.5 },
};
const ASPIR_LABELS = { lose: 'Lose fat', muscle: 'Build muscle', strength: 'Get stronger', maintain: 'Maintain' };
const PROGRAM_NAMES = { strength: 'Foundation Strength 5×5', muscle: 'Muscle Builder', lean: 'Lean & Athletic' };

function aspirOf(p) {
  if (p.aspir) return p.aspir;
  return p.goalType === 'lose' ? 'lose' : p.goalType === 'gain' ? 'muscle' : 'maintain';
}

function renderGoals() {
  const body = $('#goals-body');
  if (!body) return;
  const st = S.getState();
  const p = st.profile;
  const aspir = aspirOf(p);
  const t0 = S.computeTargets(p);
  const cand = {
    lose: S.computeTargets({ ...p, goalType: 'lose' }),
    maintain: S.computeTargets({ ...p, goalType: 'maintain' }),
    gain: S.computeTargets({ ...p, goalType: 'gain' }),
  };
  const chips = Object.entries(ASPIR_LABELS)
    .map(([id, label]) => `<button class="chip${aspir === id ? ' sel' : ''}" data-aspir="${id}" type="button">${label}</button>`)
    .join('');

  const err = S.getSetting('coachPlanError');
  const plan = S.getSetting('coachPlan');
  let planHTML;
  if (coachBusy) {
    planHTML = `<div class="panel"><div class="loading-row">The coach is reading your stats, meals and workouts…</div></div>`;
  } else if (plan) {
    const r = plan.result || {};
    const t2 = S.computeTargets({ ...p, goalType: r.strategy || 'maintain', rate: r.rateRecommend || p.rate });
    const rateTxt = r.strategy === 'maintain' ? 'maintain your weight' : `${r.strategy === 'lose' ? 'lose' : 'gain'} ~${r.rateRecommend || 0.5} kg/week`;
    const curPid = S.getSetting('programId');
    const progRow = r.program && r.program !== 'keep'
      ? (r.program === curPid
        ? `<p class="muted sm plan-prog-line">Training: stay on <b>${PROGRAM_NAMES[r.program] || r.program}</b> — ${esc(r.programWhy || '')}</p>`
        : `<div class="plan-prog"><div><b>Switch to ${PROGRAM_NAMES[r.program] || r.program}?</b><div class="muted sm">${esc(r.programWhy || '')}</div></div><button class="btn ghost sm-btn" id="btn-apply-program" type="button">Switch</button></div>`)
      : `<p class="muted sm plan-prog-line">Training: ${esc(r.programWhy || 'Stay on your current program — it fits your goal.')}</p>`;
    planHTML = `
    <div class="panel plan-panel">
      <div class="plan-head"><svg class="plan-spark"><use href="#i-spark"/></svg><h2 class="ph2">The coach's plan</h2></div>
      <p class="plan-sum">${esc(r.summary || '')}</p>
      <div class="plan-targets">
        <div class="pt-big"><span>${fmt(t2.kcal)}</span><span class="unit">kcal / day</span></div>
        <div class="pt-sub">to ${rateTxt} · P ${t2.protein} g · C ${t2.carbs} g · F ${t2.fat} g</div>
        ${r.targetNote ? `<div class="pt-note muted">${esc(r.targetNote)}</div>` : ''}
      </div>
      ${r.strategyWhy ? `<p class="plan-why muted">${esc(r.strategyWhy)}</p>` : ''}
      <button class="btn primary" id="btn-apply-targets" type="button">Use these targets</button>
      ${progRow}
      ${(r.focusExercises || []).length ? `<div class="plan-focus"><span class="muted sm">Focus lifts</span>${r.focusExercises.map((x) => `<span class="mini-chip">${esc(x)}</span>`).join('')}</div>` : ''}
      ${(r.tips || []).length ? `<ul class="plan-tips">${r.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="plan-foot"><span class="muted sm">Asked ${new Date(plan.ts).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${plan.basisDays ? ` · from ${plan.basisDays} logged day${plan.basisDays === 1 ? '' : 's'}` : ''}</span>
        <button class="link-btn" id="btn-ask-coach" type="button">Ask again</button></div>
    </div>`;
  } else {
    planHTML = `
    <div class="panel coach-cta">
      ${err ? `<p class="coach-err">${esc(err)}</p>` : ''}
      <button class="btn primary" id="btn-ask-coach" type="button">Ask the AI coach</button>
      <p class="hint muted">Reads your stats, the last 2 weeks of eating, your weigh-ins and your workouts — then recommends your calories, macros and training.</p>
    </div>`;
  }

  body.innerHTML = `
    <button class="link-btn" data-goals-back type="button">← Back</button>

    <div class="panel">
      <h2 class="ph2">What do you want?</h2>
      <div class="chip-row wrap" id="goal-aspir">${chips}</div>
      <div class="field-2">
        <label class="field"><span>Target weight (kg — optional)</span>
          <input id="goal-target" type="number" inputmode="decimal" step="0.1" min="30" max="250" placeholder="${fmt(p.weight, 1)}" value="${p.targetWeight ?? ''}"></label>
        <label class="field"><span>Pace (kg / week)</span>
          <select id="goal-rate">
            <option value="0.25"${+p.rate === 0.25 ? ' selected' : ''}>0.25 — slow &amp; steady</option>
            <option value="0.5"${+p.rate === 0.5 ? ' selected' : ''}>0.5 — standard</option>
            <option value="0.75"${+p.rate === 0.75 ? ' selected' : ''}>0.75 — ambitious</option>
          </select></label>
      </div>
      <label class="field"><span>Want a specific daily calorie number? (optional)</span>
        <input id="goal-cals" type="number" inputmode="numeric" min="1000" max="6000" placeholder="leave blank — the coach sets it" value="${p.calPref ?? ''}"></label>
      <label class="field"><span>Anything I should know? (optional)</span>
        <input id="goal-notes" type="text" maxlength="400" placeholder="injuries, what you enjoy, foods you avoid…" value="${esc(p.notes || '')}"></label>
    </div>

    <div class="panel">
      <h2 class="ph2">Your numbers</h2>
      <div class="goal-stats">
        <div><b>${fmt(t0.bdee)}</b><span>burn / day</span></div>
        <div><b>${fmt(cand.lose.kcal)}</b><span>lose fat</span></div>
        <div><b>${fmt(cand.maintain.kcal)}</b><span>maintain</span></div>
        <div><b>${fmt(cand.gain.kcal)}</b><span>gain muscle</span></div>
      </div>
      <p class="hint muted">Calculated from your age, height, weight and activity (Mifflin-St Jeor). The coach picks one of these — it never invents numbers.</p>
    </div>

    ${planHTML}
    ${mealHTML()}
    ${weeklyHTML()}
  `;
}

function coachPayload() {
  const st = S.getState();
  const p = st.profile, g = st.goals;
  const days = S.recentDays(14).filter((d) => d.any);
  const avg = (f) => (days.length ? Math.round(days.reduce((a, d) => a + f(d.totals), 0) / days.length) : 0);
  const fin = S.sessionHistory(90).filter((h) => h.finishedAt);
  const cutoff = S.dayKey(new Date(Date.now() - 28 * 864e5));
  const ws = S.weightSeries().filter((w) => w.key >= cutoff);
  const dW = ws.length > 1 ? Math.round((ws[ws.length - 1].kg - ws[0].kg) * 10) / 10 : null;
  const exAgg = {};
  for (const h of fin) for (const ex of h.ex || []) {
    const done = (ex.sets || []).filter((s2) => s2.done);
    if (!done.length) continue;
    const top = done.reduce((a, b) => ((b.w || 0) > (a.w || 0) ? b : a), done[0]);
    exAgg[ex.name] = exAgg[ex.name] || { name: ex.name, bestW: 0, sessions: 0 };
    exAgg[ex.name].bestW = Math.max(exAgg[ex.name].bestW, top.w || 0);
    exAgg[ex.name].sessions++;
  }
  return {
    profile: {
      sex: p.sex, age: p.age, height: p.height, weight: p.weight, activity: p.activity,
      aspiration: aspirOf(p), goalType: p.goalType, rate: p.rate,
      targetWeight: p.targetWeight || null, noteFromUser: (p.notes || '').slice(0, 400), caloriePreference: p.calPref || null,
    },
    currentTargets: { kcal: g.kcal, protein: g.protein, carbs: g.carbs, fat: g.fat },
    calorieCandidates: { lose: S.computeTargets({ ...p, goalType: 'lose' }).kcal, maintain: S.computeTargets({ ...p, goalType: 'maintain' }).kcal, gain: S.computeTargets({ ...p, goalType: 'gain' }).kcal },
    intake: { daysLogged: days.length, avgKcal: avg((t) => t.kcal), avgProtein: avg((t) => t.p), avgCarbs: avg((t) => t.c), avgFat: avg((t) => t.f) },
    weight: { latestKg: S.latestWeight()?.kg ?? null, change28dKg: dW },
    training: {
      programId: S.getSetting('programId') || null,
      sessionsTotal: fin.length,
      sessionsLast28d: fin.filter((h) => h.key >= cutoff).length,
      topExercises: Object.values(exAgg).sort((a, b) => b.sessions - a.sessions).slice(0, 10).map((e2) => ({ name: e2.name, bestKg: e2.bestW, sessions: e2.sessions })),
    },
  };
}

async function askCoach() {
  coachBusy = true;
  renderGoals();
  const payload = coachPayload();
  try {
    const r = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || 'The coach is unavailable right now. Try again in a minute.');
    S.setSetting('coachPlanError', null);
    S.setSetting('coachPlan', { ts: Date.now(), result: j.result, basisDays: payload.intake.daysLogged });
    toast('Coach plan ready');
  } catch (e) {
    S.setSetting('coachPlanError', String(e.message || e).slice(0, 200));
    toast('Coach unavailable right now', 'i-x');
  }
  coachBusy = false;
  renderGoals();
}

function applyCoachPlan() {
  const plan = S.getSetting('coachPlan');
  if (!plan?.result) return;
  const r = plan.result;
  const p = S.getState().profile;
  const patch = { goalType: r.strategy || 'maintain', aspir: r.strategy === 'lose' ? 'lose' : r.strategy === 'maintain' ? 'maintain' : aspirOf(p) === 'strength' ? 'strength' : 'muscle' };
  if ((r.strategy === 'lose' || r.strategy === 'gain') && r.rateRecommend) patch.rate = r.rateRecommend;
  S.setProfile(patch);
  const t = S.computeTargets({ ...p, ...patch });
  S.setGoals({ kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat });
  renderToday();
  renderGoals();
  vib(12);
  toast(`Targets applied — ${fmt(t.kcal)} kcal`);
}

function applyCoachProgram() {
  const plan = S.getSetting('coachPlan');
  const pid = plan?.result?.program;
  if (!pid || pid === 'keep' || pid === S.getSetting('programId')) { toast('Program unchanged'); return; }
  S.setSetting('programId', pid);
  window.dispatchEvent(new Event('fuel:refresh-train'));
  toast(`Program switched — ${PROGRAM_NAMES[pid] || pid}`);
  renderGoals();
  vib(12);
}

/* ══════════ weekly check-in ══════════ */
const TW_LABEL = { kcal: 'Calories', protein: 'Protein', rate: 'Pace', program: 'Program', deload: 'Deload week' };

function weeklyHTML() {
  const w = S.getSetting('weeklyReview');
  const err = S.getSetting('weeklyError');
  if (weeklyBusy) return `<div class="panel"><div class="loading-row">Your coach is reviewing the week…</div></div>`;
  if (!w) {
    return `<div class="panel coach-cta">
      ${err ? `<p class="coach-err">${esc(err)}</p>` : ''}
      <h2 class="ph2">Weekly check-in</h2>
      <p class="hint muted">Runs by itself once a week — it reviews your weight trend, eating and training, then suggests small tweaks (nothing changes without your tap).</p>
      <button class="btn ghost" id="btn-run-weekly" type="button">Run this week's check-in</button>
    </div>`;
  }
  const r = w.result || {};
  const tweaks = (r.tweaks || [])
    .map((t, i) => `<div class="tw-row"><div><b>${TW_LABEL[t.kind] || t.kind}</b>${t.suggest !== '' && t.suggest != null ? ` → <span class="tw-val">${typeof t.suggest === 'number' ? fmt(t.suggest) : esc(String(t.suggest))}</span>` : ''}<div class="muted sm">${esc(t.why || '')}</div></div><button class="btn ghost sm-btn" data-wtweak="${i}" type="button">Apply</button></div>`)
    .join('');
  return `<div class="panel plan-panel">
    <div class="plan-head"><svg class="plan-spark"><use href="#i-spark"/></svg><h2 class="ph2">This week's check-in</h2></div>
    ${r.headline ? `<p class="plan-sum">${esc(r.headline)}</p>` : ''}
    ${r.summary ? `<p class="plan-why muted">${esc(r.summary)}</p>` : ''}
    ${(r.wins || []).length ? `<ul class="plan-tips wins">${r.wins.map((x) => `<li>✓ ${esc(x)}</li>`).join('')}</ul>` : ''}
    ${(r.watch || []).length ? `<ul class="plan-tips watch">${r.watch.map((x) => `<li>→ ${esc(x)}</li>`).join('')}</ul>` : ''}
    ${tweaks ? `<div class="tw-list">${tweaks}</div>` : ''}
    <div class="plan-foot"><span class="muted sm">Reviewed ${new Date(w.ts).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
      <button class="link-btn" id="btn-ask-weekly" type="button">Run again</button></div>
  </div>`;
}

function weeklyPayload() {
  const base = coachPayload();
  const g = S.getState().goals;
  const d7 = S.recentDays(7).filter((d) => d.any);
  const prev7 = [];
  for (let i = 7; i < 14; i++) {
    const k = S.dayKey(new Date(Date.now() - i * 864e5));
    const logv = S.getState().logs[k];
    if (logv && S.MEALS.some((m) => (logv.meals?.[m] || []).length)) prev7.push(S.dayTotals(k));
  }
  const avgOf = (arr, f) => (arr.length ? Math.round(arr.reduce((a, t) => a + f(t), 0) / arr.length) : 0);
  const wk = {};
  for (const h of S.sessionHistory(98).filter((x) => x.finishedAt)) {
    const wcut = S.dayKey(new Date(Date.now() - 12 * 7 * 864e5));
    if (h.key < wcut) continue;
    const d = new Date(h.key);
    const mon = S.dayKey(new Date(d.getTime() - ((d.getDay() + 6) % 7) * 864e5));
    wk[mon] = (wk[mon] || 0) + 1;
  }
  const weeksActive = Object.values(wk).filter((n2) => n2 >= 2).length;
  const deloadAt = S.getSetting('deloadAt');
  return {
    ...base,
    training: { ...base.training, weeksActive, deloadRecent: !!(deloadAt && Date.now() - deloadAt < 8 * 7 * 864e5) },
    week: {
      logged: d7.length, avgKcal: avgOf(d7, (t) => t.kcal), avgProtein: avgOf(d7, (t) => t.p),
      prevLogged: prev7.length, prevAvgKcal: avgOf(prev7, (t) => t.kcal), prevAvgProtein: avgOf(prev7, (t) => t.p),
    },
    tweakOptions: { kcal: [g.kcal - 150, g.kcal, g.kcal + 150], protein: [Math.max(60, g.protein - 20), g.protein, g.protein + 20], rate: [0.25, 0.5, 0.75] },
  };
}

async function runWeekly(silent) {
  weeklyBusy = true;
  if (!silent) renderGoals();
  try {
    const r = await fetch('/api/weekly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: weeklyPayload() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || 'The check-in is unavailable right now — try again in a minute.');
    S.setSetting('weeklyError', null);
    S.setSetting('weeklyReview', { ts: Date.now(), result: j.result });
    maybeSendDigest(j.result);
    if (!silent) toast('Weekly check-in ready');
  } catch (e) {
    S.setSetting('weeklyError', String(e.message || e).slice(0, 200));
    if (!silent) toast('Check-in unavailable right now', 'i-x');
  }
  weeklyBusy = false;
  if (!silent) renderGoals();
}

function applyWeeklyTweak(i) {
  const w = S.getSetting('weeklyReview');
  const tw = w?.result?.tweaks?.[i];
  if (!tw) return;
  const g = S.getState().goals;
  if (tw.kind === 'kcal') {
    const kcal = +tw.suggest;
    const fat = Math.round((kcal * 0.25) / 9);
    const carbs = Math.max(0, Math.round((kcal - g.protein * 4 - fat * 9) / 4));
    S.setGoals({ kcal, fat, carbs });
    toast(`Calories → ${fmt(kcal)} kcal`);
  } else if (tw.kind === 'protein') {
    const protein = +tw.suggest;
    const carbs = Math.max(0, Math.round((g.kcal - protein * 4 - g.fat * 9) / 4));
    S.setGoals({ protein, carbs });
    toast(`Protein → ${protein} g`);
  } else if (tw.kind === 'rate') {
    S.setProfile({ rate: +tw.suggest });
    toast(`Pace → ${tw.suggest} kg/week`);
  } else if (tw.kind === 'program') {
    S.setSetting('programId', tw.suggest);
    window.dispatchEvent(new Event('fuel:refresh-train'));
    toast(`Program → ${PROGRAM_NAMES[tw.suggest] || tw.suggest}`);
  } else if (tw.kind === 'deload') {
    S.setSetting('deloadAt', Date.now());
    toast('Deload marked — go lighter for a week 🧘');
  }
  w.result.tweaks.splice(i, 1); // consume it — no double-applying
  S.setSetting('weeklyReview', w);
  renderToday();
  renderGoals();
  vib(12);
}

async function maybeWeeklyCheckin() {
  try {
    if (new URLSearchParams(location.search).get('demo') === '1') return; // QA runs it by hand
    const last = S.getSetting('weeklyReview');
    if (last && Date.now() - last.ts < 6 * 864e5) return;
    if (S.recentDays(7).filter((d) => d.any).length < 3) return;
    await runWeekly(true);
  } catch {}
}

/* ══════════ meal planner ══════════ */
function mealHTML() {
  const mp = S.getSetting('mealPlan');
  const g = S.getState().goals;
  const t = S.dayTotals();
  const left = g.kcal - t.kcal;
  if (mpBusy) return `<div class="panel"><div class="loading-row">Building your day…</div></div>`;
  if (!mp) {
    return `<div class="panel coach-cta">
      <h2 class="ph2">Build my day</h2>
      <p class="hint muted">The coach drafts breakfast, lunch, dinner and snacks hitting your targets — from foods you actually eat. Add any meal to today with one tap.</p>
      <button class="btn primary" id="btn-build-full" type="button">Build a full day (${fmt(g.kcal)} kcal)</button>
      ${left > 300 ? `<button class="btn ghost" id="btn-build-left" type="button">Just what's left today (${fmt(left)} kcal)</button>` : ''}
    </div>`;
  }
  const r = mp.result || {};
  const added = mp.added || [];
  const meals = (r.meals || []).map((m) => {
    const isAdded = added.includes(m.slot);
    return `<div class="mp-meal"><div class="mp-head"><b>${esc(m.label || m.slot)}</b><span class="muted sm">${fmt(m.totals?.kcal || 0)} kcal · ${Math.round(m.totals?.p || 0)}g P</span>
      <button class="btn ghost sm-btn" data-mp-add="${m.slot}" type="button" ${isAdded ? 'disabled' : ''}>${isAdded ? 'Added ✓' : 'Add'}</button></div>
      ${m.why ? `<div class="muted sm" style="margin:2px 0 6px">${esc(m.why)}</div>` : ''}
      <div class="mp-items">${(m.items || []).map((it) => `<div class="mp-item${isAdded ? ' done' : ''}"><span>${esc(it.name)}</span><i>${it.qty && it.qty !== 1 ? it.qty + '× ' : ''}${esc(it.serve || '')}</i><b>${fmt(it.kcal)}</b></div>`).join('')}</div></div>`;
  }).join('');
  const pending = (r.meals || []).some((m) => !added.includes(m.slot));
  return `<div class="panel plan-panel">
    <div class="plan-head"><svg class="plan-spark"><use href="#i-spark"/></svg><h2 class="ph2">${esc(r.title || 'Your day')}</h2></div>
    ${r.summary ? `<p class="plan-why muted">${esc(r.summary)}</p>` : ''}
    <div class="mp-totals muted sm">Plan total: ${fmt(r.totals?.kcal || 0)} kcal · ${Math.round(r.totals?.p || 0)}g P · ${Math.round(r.totals?.c || 0)}g C · ${Math.round(r.totals?.f || 0)}g F</div>
    ${meals}
    ${(r.tips || []).length ? `<ul class="plan-tips">${r.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${pending ? `<button class="btn primary" id="btn-mp-add-all" type="button">Add the whole day to today</button>` : ''}
    <div class="plan-foot"><span class="muted sm">Built ${new Date(mp.ts).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
      <span><button class="link-btn" id="btn-build-full" type="button">Rebuild (${mp.mode === 'left' ? 'what\u2019s left' : 'full day'})</button></span></div>
  </div>`;
}

async function runMealPlan(mode) {
  mpBusy = true;
  renderGoals();
  const st = S.getState();
  const g = st.goals, p = st.profile;
  const t = S.dayTotals();
  const payload = {
    mode,
    targets: { kcal: g.kcal, protein: g.protein, carbs: g.carbs, fat: g.fat },
    remain: { kcal: Math.max(0, g.kcal - t.kcal), p: Math.max(0, g.protein - t.p) },
    aspiration: aspirOf(p),
    notes: (p.notes || '').slice(0, 400),
    frequent: S.frequentFoods(12).map((f, i) => ({ id: 'my' + i, name: f.name, serve: f.qtyLabel || 'serve', kcal: Math.round(f.kcal), p: Math.round(f.p), c: Math.round(f.c), f: Math.round(f.f) })),
  };
  try {
    const r = await fetch('/api/mealplan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || 'The meal planner is unavailable right now — try again in a minute.');
    S.setSetting('mealPlan', { ts: Date.now(), mode, result: j.result, added: [] });
    toast('Meal plan ready');
  } catch (e) {
    toast(String(e.message || e).slice(0, 80), 'i-x');
  }
  mpBusy = false;
  renderGoals();
}

function addMealPlan(which) {
  const mp = S.getSetting('mealPlan');
  if (!mp?.result?.meals) return;
  const added = mp.added || [];
  let n = 0;
  let kcal = 0;
  for (const m of mp.result.meals) {
    if (which !== 'all' && m.slot !== which) continue;
    if (added.includes(m.slot)) continue;
    for (const it of m.items || []) {
      S.addEntry(m.slot, { name: `${it.name}${it.qty && it.qty !== 1 ? ` ×${it.qty}` : ''}`, kcal: it.kcal, p: it.p, c: it.c, f: it.f, qtyLabel: it.serve || '' }, S.dayKey());
      n++;
      kcal += it.kcal || 0;
    }
    if (!added.includes(m.slot)) added.push(m.slot);
  }
  mp.added = added;
  S.setSetting('mealPlan', mp);
  renderToday();
  renderGoals();
  vib(12);
  if (n) toast(`${which === 'all' ? 'Whole day' : (mp.result.meals.find((x) => x.slot === which)?.label || 'Meal')} added to today — ${fmt(kcal)} kcal`);
}

/* ══════════ gentle nudges ══════════ */
function buildNudge(now = new Date()) {
  const h = now.getHours();
  const key = S.dayKey(now);
  const st = S.getState();
  const t = S.dayTotals(key);
  const g = st.goals;
  const sess = st.workouts[key];
  const dayId = dayIdFor(now);
  if (dayId && h >= 16 && (!sess || sess.finishedAt)) {
    const pid = S.getSetting('programId') || 'muscle';
    const day = (PROGRAMS[pid] || PROGRAMS.muscle)?.days?.[dayId];
    return { ico: '💪', txt: `${day ? day.label : 'Training'} day — your session is waiting`, act: 'train' };
  }
  if (h >= 14 && t.kcal < 400) return { ico: '🍽️', txt: t.kcal > 0 ? `Only ${fmt(t.kcal)} kcal logged today — keep it rolling` : 'Nothing logged yet today — quick add a meal', act: 'add' };
  if (h >= 19 && t.kcal > 0 && t.p < g.protein * 0.6) return { ico: '🥛', txt: `Protein at ${Math.round(t.p)}g of ${g.protein}g — a shake or yoghurt closes the gap`, act: 'quick' };
  return null;
}
window.__fuelNudge = (iso) => { try { const n = buildNudge(new Date(iso)); return n ? n.txt : null; } catch { return null; } };

/* ══════════ cloud backup (Settings) ══════════ */
fetch('/api/health').then((r) => r.json()).then((h) => { health = h || health; }).catch(() => {});

function renderSyncPanel() {
  const el = $('#sync-body');
  if (!el) return;
  const key = S.getSetting('syncKey');
  const meta = SY.syncMeta();
  if (!key) {
    el.innerHTML = `<p class="hint muted" style="margin-top:0">Your logs live only on this phone. Turn on backup and an encrypted copy is kept in your private cloud slot — a new phone can restore everything in seconds. Only a phone holding your key can read it.</p>
      <button class="btn primary" id="btn-sync-on" type="button">Turn on cloud backup</button>
      <button class="btn ghost" id="btn-sync-restore" type="button">Restore from a backup instead…</button>`;
    return;
  }
  const last = meta.last
    ? `Last backup: ${new Date(meta.last).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${meta.err ? ` · last error: ${esc(meta.err)}` : ''}`
    : 'Not backed up yet — tap “Back up now”.';
  el.innerHTML = `<p class="hint muted" style="margin-top:0">${last}</p>
    <button class="btn primary" id="btn-sync-now" type="button">Back up now</button>
    <button class="btn ghost" id="btn-sync-key" type="button">Show my sync key</button>
    <button class="btn ghost" id="btn-sync-restore" type="button">Restore from backup…</button>
    <button class="btn ghost" id="btn-sync-off" type="button">Turn off backup</button>`;
}

function renderTgPanel() {
  const panel = $('#tg-panel');
  if (!panel) return;
  panel.hidden = !health.tg;
  if (panel.hidden) return;
  $('#tg-body').innerHTML = `<label class="switch-row"><span>Send each weekly check-in to my Telegram</span>
      <input type="checkbox" id="tg-toggle" ${S.getSetting('telegramDigest') !== false ? 'checked' : ''}></label>
    <button class="btn ghost" id="btn-tg-test" type="button">Send a test message</button>`;
}

async function syncNow(manual) {
  const key = S.getSetting('syncKey');
  if (!key) return false;
  try {
    await SY.pushBackup(S.getState(), key);
    if (manual) { toast('Backed up ✓'); renderSettings(); }
    return true;
  } catch (err) {
    SY.setMeta({ err: String(err.message || err).slice(0, 120) });
    if (manual) { toast(String(err.message || err).slice(0, 80), 'i-x'); renderSettings(); }
    return false;
  }
}

function syncEnable() {
  const parked = SY.syncMeta().parkedKey;
  if (parked) {
    S.setSetting('syncKey', parked);
    SY.setMeta({ parkedKey: null });
    toast('Backup resumed with your existing key');
    syncNow(true);
    renderSettings();
    return;
  }
  const key = SY.genSyncKey();
  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Your sync key</div>
    </div>
    <p class="nutri-note">This key unlocks your backup. Keep it somewhere safe — a password manager, or a note you'd still have if this phone died. Anyone with the key can read the backup, so don't post it.</p>
    <div class="sync-key-box" id="sync-key-show">${key}</div>
    <button class="btn ghost" data-copy type="button">Copy key</button>
    <button class="btn primary" data-arm type="button">I've saved it — turn on backup</button>
  `);
  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-copy]')) {
      try { await navigator.clipboard.writeText(key); toast('Key copied'); } catch { toast('Copy failed — screenshot it instead', 'i-x'); }
      return;
    }
    if (e.target.closest('[data-arm]')) {
      S.setSetting('syncKey', key);
      close();
      renderSettings();
      const okp = await syncNow(false);
      toast(okp ? 'Cloud backup on — first backup saved' : 'Cloud backup on — first backup failed, check Settings', okp ? 'i-check' : 'i-x');
      renderSettings();
    }
  });
}

function syncShowKey() {
  const key = S.getSetting('syncKey');
  if (!key) return;
  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">My sync key</div>
    </div>
    <p class="nutri-note">The key that unlocks your backup. Keep it somewhere safe.</p>
    <div class="sync-key-box">${key}</div>
    <button class="btn ghost" data-copy type="button">Copy key</button>
  `);
  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-copy]')) {
      try { await navigator.clipboard.writeText(key); toast('Key copied'); } catch { toast('Copy failed — screenshot it instead', 'i-x'); }
    }
  });
}

function syncRestore() {
  let pulled = null;
  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Restore from backup</div>
    </div>
    <label class="field"><span>Your sync key</span>
      <input id="sync-key-in" type="text" placeholder="FUEL-XXXXXX-…" autocapitalize="characters" autocomplete="off"></label>
    <button class="btn primary" data-sync-pull type="button">Find my backup</button>
    <div id="sync-pull-msg" class="muted sm" style="margin-top:8px"></div>
  `);
  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-sync-pull]')) {
      const key = ($('#sync-key-in', wrap).value || '').trim().toUpperCase();
      const msg = $('#sync-pull-msg', wrap);
      if (!key) { msg.textContent = 'Type your sync key first.'; return; }
      msg.textContent = 'Looking for your backup…';
      try {
        const out = await SY.pullBackup(key);
        pulled = out;
        const st = out.state || {};
        const days = Object.keys(st.logs || {}).length;
        const wkt = Object.keys(st.workouts || {}).length;
        msg.innerHTML = `Found a backup from ${new Date(out.updatedAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} — ${days} logged day${days === 1 ? '' : 's'}, ${wkt} workout${wkt === 1 ? '' : 's'}, goal ${fmt(st.goals?.kcal || 0)} kcal.<br>
          <button class="btn danger sm-btn" data-sync-replace type="button" style="margin-top:8px">Replace everything on this phone with it</button>`;
      } catch (err) {
        msg.textContent = String(err.message || err);
      }
      return;
    }
    if (e.target.closest('[data-sync-replace]')) {
      if (!pulled) return;
      S.importJSON(JSON.stringify(pulled.state));
      S.setSetting('syncKey', (($('#sync-key-in', wrap).value || '').trim().toUpperCase()));
      selDate = S.dayKey();
      renderAll();
      renderToday();
      close();
      toast('Backup restored');
    }
  });
}

function syncOff() {
  const key = S.getSetting('syncKey');
  if (!key) return;
  const { wrap, close } = openModal(`
    <div class="modal-head">
      <button class="icon-btn" data-close type="button"><svg><use href="#i-x"/></svg></button>
      <div class="modal-title">Turn off backup?</div>
    </div>
    <p class="nutri-note">Your cloud copy stays put — the sync key still restores it later. Keep the key safe before turning off.</p>
    <button class="btn danger" data-sync-off-arm type="button">Turn off backup</button>
  `);
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-sync-off-arm]')) {
      SY.setMeta({ parkedKey: key });
      S.setSetting('syncKey', null);
      close();
      renderSettings();
      toast('Backup off — your key was kept for easy re-enable');
    }
  });
}

async function tgTest() {
  try {
    const r = await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '🏋️ FUEL test — your weekly check-in will arrive here. ✅' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || 'Could not send');
    toast('Test message sent to your Telegram');
  } catch (e) { toast(String(e.message || e).slice(0, 80), 'i-x'); }
}

async function maybeSendDigest(result) {
  try {
    if (new URLSearchParams(location.search).get('demo') === '1') return;
    if (!health.tg) return;
    if (S.getSetting('telegramDigest') === false) return;
    const lines = ['🏋️ FUEL — weekly check-in', ''];
    if (result.headline) lines.push(`*${result.headline}*`);
    if (result.summary) lines.push(result.summary);
    if ((result.wins || []).length) lines.push('', ...result.wins.map((w) => `✓ ${w}`));
    if ((result.watch || []).length) lines.push('', ...result.watch.map((w) => `→ ${w}`));
    if ((result.tweaks || []).length) lines.push('', `Suggested: ${result.tweaks.map((t) => `${TW_LABEL[t.kind] || t.kind}${t.suggest ? ' → ' + t.suggest : ''}`).join(' · ')} — open FUEL to apply.`);
    await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lines.join('\n') }) });
  } catch { /* digest is best-effort */ }
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
  renderSyncPanel();
  renderTgPanel();
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
    selDate = S.dayKey();
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
    selDate = S.dayKey();
    renderAll();
    renderToday();
    toast('Fresh start');
  }
});

/* ── cloud backup + telegram wiring ── */
$('#view-settings').addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('#btn-sync-on')) { syncEnable(); return; }
  if (t.closest('#btn-sync-now')) { syncNow(true); return; }
  if (t.closest('#btn-sync-key')) { syncShowKey(); return; }
  if (t.closest('#btn-sync-restore')) { syncRestore(); return; }
  if (t.closest('#btn-sync-off')) { syncOff(); return; }
  if (t.closest('#btn-tg-test')) { tgTest(); return; }
});
$('#view-settings').addEventListener('change', (e) => {
  if (e.target.id === 'tg-toggle') {
    S.setSetting('telegramDigest', e.target.checked);
    toast(e.target.checked ? 'Weekly digest on' : 'Weekly digest off');
  }
});

/* ── auto cloud backup (debounced) + toast bridge ── */
let syncTimer = null, syncInFlight = false;
window.addEventListener('fuel:state-saved', () => {
  if (new URLSearchParams(location.search).get('demo') === '1' && !window.__syncAllowDemo) return;
  if (!S.getSetting('syncKey')) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (syncInFlight) return;
    syncInFlight = true;
    try { await SY.pushBackup(S.getState(), S.getSetting('syncKey')); } catch (e2) { SY.setMeta({ err: String(e2.message || e2).slice(0, 120) }); }
    syncInFlight = false;
  }, 12000);
});
window.addEventListener('fuel:toast', (e) => toast(e.detail));

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

  // two weeks of believable history — drives the History chart, This-week strip and day dots
  const hist = [
    [13, 2240, 172, 214, 76], [12, 2610, 188, 268, 88], [11, 2380, 181, 232, 80],
    [10, 2120, 163, 205, 71], [8, 2520, 196, 246, 82], [7, 2780, 175, 295, 92],
    [6, 2310, 188, 218, 74], [4, 2460, 190, 240, 79], [3, 2190, 171, 208, 72],
    [1, 2350, 182, 226, 77],
  ];
  const split = [
    ['breakfast', 'Oats & berries', 0.25],
    ['lunch', 'Chicken rice bowl', 0.4],
    ['dinner', 'Salmon & greens', 0.35],
  ];
  for (const [ago, kcal, p, c, f] of hist) {
    const key = S.dayKey(new Date(Date.now() - ago * 864e5));
    for (const [meal, name, part] of split) {
      S.addEntry(meal, {
        name, kcal: Math.round(kcal * part), p: Math.round(p * part), c: Math.round(c * part), f: Math.round(f * part),
        qtyLabel: '1 serve',
      }, key);
    }
  }

  // weight check-ins trending gently down (drives Progress → Weight)
  const ws = [[45, 87.2], [42, 87.0], [38, 86.7], [34, 86.9], [31, 86.3], [27, 86.0], [24, 85.8], [20, 85.9], [17, 85.3], [13, 85.1], [10, 84.9], [7, 84.8], [4, 84.7], [2, 84.6]];
  for (const [ago, kg] of ws) S.logWeight(S.dayKey(new Date(Date.now() - ago * 864e5)), kg);

  renderToday();
}
