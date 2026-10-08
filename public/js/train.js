// FUEL — gym trainer: program picking, workout sessions, per-set logging, auto rest timers.
// Timer flow (as requested): log weight+reps for a set → countdown starts → zero → beep/vibrate →
// next set. After the final set of an exercise there's a longer transition countdown before the
// next exercise. +30 s and Skip buttons on every rest. Screen stays awake during a session.
import * as S from './store.js';
import { PROGRAMS, PROGRAM_LIST, dayIdFor, nextDayIdFor } from './programs.js';

const K = () => S.dayKey();
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtClock = (msLeft) => {
  const t = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const fmtDur = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};
const fmtRest = (s) => (s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60}:00` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/* ── audio + haptics ── */
let ac = null;
function ensureAudio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch {}
}
function beep() {
  if (!ac) return;
  [0, 0.22].forEach((t, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = i ? 1240 : 880;
    o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.0001, ac.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.24, ac.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.18);
    o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
  });
  navigator.vibrate?.([180, 90, 180]);
}
const vib = (p) => { try { navigator.vibrate?.(p); } catch {} };

/* ── wake lock (screen stays on through a session) ── */
let wl = null;
async function keepAwake(on) {
  try {
    if (on) { if (!wl && 'wakeLock' in navigator) wl = await navigator.wakeLock.request('screen'); }
    else { await wl?.release?.(); wl = null; }
  } catch {}
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wl === null) {
    const s = todaySession();
    if (s && !s.finishedAt) keepAwake(true);
  }
});

/* ── session helpers ── */
function program() { return PROGRAMS[S.getSetting('programId')] || null; }
function todaySession() { return S.getSession(K()); }

function buildSession(p, dayId) {
  const d = p.days[dayId];
  return {
    programId: p.id, programName: p.name, dayId, dayLabel: d.label,
    startedAt: Date.now(), finishedAt: null, timer: null,
    ex: d.exercises.map((x) => ({
      name: x.name, reps: x.reps, rest: x.rest,
      sets: Array.from({ length: x.sets }, () => ({ w: null, r: null, done: false, ts: null })),
    })),
  };
}

function nextIncomplete(s, ei, si) {
  for (let i = ei; i < s.ex.length; i++) {
    const from = i === ei ? si + 1 : 0;
    for (let j = from; j < s.ex[i].sets.length; j++) if (!s.ex[i].sets[j].done) return { ei: i, si: j };
  }
  return null;
}

function sessionStats(s) {
  let sets = 0, vol = 0, total = 0;
  for (const ex of s.ex) for (const st of ex.sets) {
    total++;
    if (st.done) { sets++; vol += (st.w || 0) * (st.r || 0); }
  }
  return { sets, total, vol: Math.round(vol) };
}

/* ── timer engine ── */
let tickHandle = null;
function startTicker() { if (!tickHandle) tickHandle = setInterval(onTick, 250); }

function onTick() {
  const bar = document.getElementById('restbar');
  if (!bar) return;
  const s = todaySession();
  const sessEl = document.getElementById('sess-elapsed');
  if (sessEl && s && !s.finishedAt) sessEl.textContent = fmtDur(Date.now() - s.startedAt);
  if (!s || s.finishedAt || !s.timer) { bar.hidden = true; return; }
  const t = s.timer;
  const rem = t.endAt - Date.now();
  if (rem > 0 && !t.fired) {
    bar.hidden = false; bar.classList.remove('go');
    document.getElementById('rb-clock').textContent = fmtClock(rem);
    document.getElementById('rb-label').textContent = t.label;
    document.getElementById('rb-sub').textContent = t.sub || '';
  } else if (!t.fired) {
    fireTimer(s);
  } else {
    bar.hidden = false; bar.classList.add('go');
    document.getElementById('rb-clock').textContent = 'GO';
    document.getElementById('rb-label').textContent = t.goLabel || t.label;
    document.getElementById('rb-sub').textContent = t.goSub || 'Tap to dismiss';
  }
}

function fireTimer(s) {
  s.timer.fired = true;
  S.putSession(K(), s);
  beep();
  renderTrainSoft();
  const firedAt = Date.now();
  setTimeout(() => {
    const s2 = todaySession();
    if (s2 && s2.timer && s2.timer.fired) {
      s2.timer = null; S.putSession(K(), s2);
      const bar = document.getElementById('restbar'); if (bar) bar.hidden = true;
      renderTrain();
    }
  }, 30000);
}

function skipTimer() {
  const s = todaySession();
  if (s?.timer && !s.timer.fired) { s.timer.endAt = Date.now(); S.putSession(K(), s); onTick(); }
  else dismissTimer();
}
function addThirty() {
  const s = todaySession();
  if (s?.timer && !s.timer.fired) { s.timer.endAt += 30000; S.putSession(K(), s); onTick(); }
}
function dismissTimer() {
  const s = todaySession();
  if (s?.timer) { s.timer = null; S.putSession(K(), s); }
  const bar = document.getElementById('restbar'); if (bar) bar.hidden = true;
  renderTrain();
}

/* ── actions ── */
function pickProgram(id) { ensureAudio(); vib(8); S.setSetting('programId', id); ui.mode = 'auto'; renderTrain(); }

function startSession(dayId) {
  const p = program(); if (!p) return;
  const s = buildSession(p, dayId);
  S.putSession(K(), s);
  ensureAudio(); vib(10); keepAwake(true);
  ui.mode = 'auto'; renderTrain(); startTicker();
  onTick();
}

function logSet(ei, si) {
  const s = todaySession(); if (!s || s.finishedAt) return;
  const row = document.querySelector(`.setrow[data-ex="${ei}"][data-set="${si}"]`);
  if (!row) return;
  const w = parseFloat(row.querySelector('[data-k="w"]').value);
  const r = parseFloat(row.querySelector('[data-k="r"]').value);
  if (!(w > 0) || !(r > 0)) { flashRow(row); return; }
  const ex = s.ex[ei], st = ex.sets[si];
  st.w = w; st.r = r; st.done = true; st.ts = Date.now();
  ensureAudio(); vib(12);
  const next = nextIncomplete(s, ei, si);
  if (next) {
    const sameEx = next.ei === ei;
    const secs = sameEx ? ex.rest : ex.rest + 30;
    s.timer = {
      endAt: Date.now() + secs * 1000, total: secs, kind: sameEx ? 'set' : 'transition', fired: false,
      label: sameEx ? `Set ${next.si + 1}/${ex.sets.length} · ${ex.name}` : `Next exercise · ${s.ex[next.ei].name}`,
      sub: sameEx ? `Rest ${fmtRest(secs)} — next set when it hits zero` : `Rest ${fmtRest(secs)} — set up your next station`,
      goLabel: sameEx ? `GO — Set ${next.si + 1}/${ex.sets.length} · ${ex.name}` : `GO — ${s.ex[next.ei].name}`,
      goSub: 'Tap to dismiss',
    };
  } else {
    s.timer = null;
    setTimeout(() => toastT('All sets done — hit Finish workout 🎉'), 350);
  }
  S.putSession(K(), s);
  renderTrain(); startTicker(); onTick();
}

function unlogSet(ei, si) {
  const s = todaySession(); if (!s || s.finishedAt) return;
  const st = s.ex[ei].sets[si];
  if (!st.done) return;
  st.done = false; vib(6);
  S.putSession(K(), s); renderTrain();
}

function finishSession() {
  const s = todaySession(); if (!s) return;
  s.finishedAt = Date.now(); s.timer = null;
  S.putSession(K(), s);
  keepAwake(false); vib([30, 60, 30]);
  const bar = document.getElementById('restbar'); if (bar) bar.hidden = true;
  ui.mode = 'auto'; ui.justFinished = true;
  renderTrain();
}

let discardArmed = false;
function discardSession(btn) {
  if (!discardArmed) {
    discardArmed = true;
    btn.textContent = 'Tap again to discard';
    btn.classList.add('armed');
    setTimeout(() => { discardArmed = false; if (btn.isConnected) { btn.textContent = 'Discard'; btn.classList.remove('armed'); } }, 3500);
    return;
  }
  S.delSession(K());
  keepAwake(false);
  discardArmed = false;
  const bar = document.getElementById('restbar'); if (bar) bar.hidden = true;
  renderTrain();
}

/* ── view state + render ── */
let ui = { mode: 'auto', justFinished: false, pickerBounce: 0 };

function renderTrainSoft() {
  const root = document.getElementById('train-root');
  if (root && !root.querySelector('input:focus')) renderTrain();
}

export function renderTrain() {
  const root = document.getElementById('train-root');
  if (!root) return;
  const p = program();
  const s = todaySession();
  let html;
  if (ui.mode === 'picker') html = pickerHTML(p);
  else if (!p) html = pickerHTML(null);
  else if (s && !s.finishedAt) { html = sessionHTML(p, s); keepAwake(true); }
  else { html = homeHTML(p, s); ui.justFinished = false; }
  root.innerHTML = html;
  onTick();
}

/* ── picker ── */
function pickerHTML(p) {
  const cards = PROGRAM_LIST.map((id) => {
    const pr = PROGRAMS[id];
    const nEx = Object.values(pr.days).reduce((a, d) => a + d.exercises.length, 0);
    return `<button class="prog-card${p && p.id === id ? ' cur' : ''}" data-pick="${id}" type="button">
      <div class="pc-top"><span class="pc-name">${esc(pr.name)}</span>${p && p.id === id ? '<span class="pc-badge">Current</span>' : ''}</div>
      <div class="pc-tag">${esc(pr.tag)}</div>
      <p class="pc-blurb">${esc(pr.blurb)}</p>
      <div class="pc-meta"><span>Mon &amp; Thu · Upper</span><span>Tue &amp; Fri · Lower</span><span>${nEx} exercises</span><span>${esc(pr.restLine)}</span></div>
    </button>`;
  }).join('');
  return `<div class="page-head"><h1>Train</h1><p class="muted">Pick the program that matches your goal — you can switch anytime.</p></div>
    ${p ? '<button class="link-btn" data-act="back" type="button">← Back</button>' : ''}
    <div class="prog-list">${cards}</div>`;
}

/* ── home ── */
function homeHTML(p, s) {
  const dayId = dayIdFor();
  const stats = s ? sessionStats(s) : null;
  const finishedToday = s && s.finishedAt;
  let today;
  if (finishedToday) {
    today = `<div class="panel tcard done">
      <div class="tc-head"><span class="tc-day">Today ✓ ${esc(s.dayLabel)}</span></div>
      <div class="tc-stats"><span><b>${stats.sets}</b> sets</span><span><b>${stats.vol.toLocaleString()}</b> kg volume</span><span><b>${fmtDur(s.finishedAt - s.startedAt)}</b></span></div>
      <p class="muted sm">Logged &amp; saved. Great session — rest up.</p>
    </div>`;
  } else {
    const nxt = nextDayIdFor();
    const label = dayId ? p.days[dayId].label : `${p.days[nxt.id].label} (next up)`;
    const active = dayId ? p.days[dayId].exercises : p.days[nxt.id].exercises;
    const exList = active.map((x, i) => `<div class="ex-li"><span class="ex-n">${i + 1}</span><span class="ex-name">${esc(x.name)}</span><span class="ex-sr">${x.sets} × ${esc(x.reps)}</span><span class="ex-rest">${fmtRest(x.rest)}</span></div>`).join('');
    today = `<div class="panel tcard">
      <div class="tc-head">
        <span class="tc-day">${dayId ? 'Today' : 'Rest day'} · ${esc(label)}</span>
        ${dayId ? '' : '<span class="tc-rest">Recovery day 😴</span>'}
      </div>
      <div class="ex-list">${exList}</div>
      <div class="tc-note muted sm">Sets × reps · rest time between sets shown on the right</div>
      ${s && !s.finishedAt
        ? `<button class="btn-primary wide" data-act="resume" type="button">Resume workout (${stats.sets}/${stats.total} sets)</button>`
        : `<button class="btn-primary wide" data-act="start" data-day="${dayId || nxt.id}" type="button">${dayId ? 'Start workout' : 'Train anyway'}</button>`}
    </div>`;
  }
  const hist = S.sessionHistory(5).filter((h) => h && h.finishedAt);
  const histHTML = hist.length
    ? `<div class="panel"><h2 class="ph2">Recent workouts</h2>${hist.map((h) => {
        const st = sessionStats(h);
        return `<div class="hrow"><span class="hr-date">${esc(S.fmtDate(h.key))}</span><span class="hr-day">${esc(h.dayLabel.split('·')[0].trim())}</span><span class="hr-st">${st.sets} sets · ${st.vol.toLocaleString()} kg</span></div>`;
      }).join('')}</div>`
    : '';
  return `<div class="page-head"><h1>Train</h1><p class="muted">${esc(p.name)} · <button class="link-btn inline" data-act="chgprog" type="button">Change program</button></p></div>
    ${ui.justFinished ? '<div class="finish-banner">Workout saved — 💪</div>' : ''}
    ${today}${histHTML}`;
}

/* ── active session ── */
function sessionHTML(p, s) {
  const stats = sessionStats(s);
  const cards = s.ex.map((ex, ei) => {
    const exDone = ex.sets.every((st) => st.done);
    const isActive = !exDone && ex.sets.some((st) => !st.done) && s.ex.slice(0, ei).every((e) => e.sets.every((st) => st.done));
    const lbl = S.lastSetsFor(ex.name);
    let prevW = null;
    const rows = ex.sets.map((st, si) => {
      const isCur = isActive && !st.done && ex.sets.slice(0, si).every((x) => x.done);
      const wVal = st.w ?? (prevW ?? lbl?.lastW ?? '');
      const rVal = st.r ?? '';
      if (st.done) prevW = st.w;
      return `<div class="setrow${st.done ? ' done' : ''}${isCur ? ' cur' : ''}" data-ex="${ei}" data-set="${si}">
        <span class="sr-n">${si + 1}</span>
        <span class="sr-target">${esc(String(ex.reps))}</span>
        <input class="sr-in" data-k="w" type="number" inputmode="decimal" step="0.5" min="0" placeholder="${st.done ? '' : (lbl?.lastW ?? 'kg')}" value="${st.done ? st.w : wVal}" ${st.done ? 'disabled' : ''}>
        <input class="sr-in" data-k="r" type="number" inputmode="numeric" step="1" min="0" placeholder="${st.done ? '' : ex.reps.split('-')[0]}" value="${st.done ? st.r : rVal}" ${st.done ? 'disabled' : ''}>
        <button class="sr-go${st.done ? ' on' : ''}" data-act="${st.done ? 'unlog' : 'log'}" type="button" aria-label="log set">${st.done ? '✓' : '✓'}</button>
      </div>`;
    }).join('');
    return `<div class="panel excard${isActive ? ' active' : ''}${exDone ? ' done' : ''}">
      <div class="ex-head">
        <div><span class="ex-title">${esc(ex.name)}</span>
        <span class="ex-sub">${ex.sets.length} × ${esc(ex.reps)} · rest ${fmtRest(ex.rest)} between sets</span></div>
        ${exDone ? '<span class="ex-done-chip">Done ✓</span>' : ''}
      </div>
      <div class="setrow head"><span class="sr-n">Set</span><span class="sr-target">Reps</span><span class="sr-in-head">kg</span><span class="sr-in-head">reps</span><span></span></div>
      ${rows}
      ${!exDone ? `<div class="ex-hint muted sm">Log a set and the rest timer starts automatically</div>` : ''}
    </div>`;
  }).join('');
  const doneAll = stats.sets === stats.total;
  return `<div class="sess-head">
      <div><div class="sh-title">${esc(s.dayLabel)}</div><div class="sh-sub muted">Started ${new Date(s.startedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })} · <span id="sess-elapsed">${fmtDur(Date.now() - s.startedAt)}</span></div></div>
      <div class="sh-actions">
        <button class="btn-ghost" data-act="discard" type="button">Discard</button>
        <button class="btn-primary sm" data-act="finish" type="button">${doneAll ? 'Finish ✓' : 'Finish'}</button>
      </div>
    </div>
    <div class="sess-prog"><div class="sp-bar"><i style="width:${Math.round((stats.sets / stats.total) * 100)}%"></i></div><span class="sp-txt">${stats.sets} / ${stats.total} sets · ${stats.vol.toLocaleString()} kg</span></div>
    ${cards}`;
}

/* ── interactions ── */
document.addEventListener('click', (e) => {
  const t = e.target;
  const pick = t.closest('[data-pick]');
  if (pick) { pickProgram(pick.dataset.pick); return; }
  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'start' || a === 'resume') { startSession(act.dataset.day || (todaySession()?.dayId) || dayIdFor()); return; }
    if (a === 'finish') { finishSession(); return; }
    if (a === 'discard') { discardSession(act); return; }
    if (a === 'chgprog') { ui.mode = 'picker'; renderTrain(); return; }
    if (a === 'back') { ui.mode = 'auto'; renderTrain(); return; }
    if (a === 'log') { const row = act.closest('.setrow'); logSet(+row.dataset.ex, +row.dataset.set); return; }
    if (a === 'unlog') { const row = act.closest('.setrow'); unlogSet(+row.dataset.ex, +row.dataset.set); return; }
  }
  if (t.closest('#rb-add')) { addThirty(); return; }
  if (t.closest('#rb-skip')) { skipTimer(); return; }
  const bar = t.closest('#restbar');
  if (bar && bar.classList.contains('go')) dismissTimer();
});

/* small local toast + flash (app.js has its own; this module stays self-contained) */
function toastT(msg) {
  let el = document.getElementById('train-toast');
  if (!el) { el = document.createElement('div'); el.id = 'train-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}
function flashRow(row) {
  row.classList.add('flash'); vib(20);
  setTimeout(() => row.classList.remove('flash'), 700);
}

/* ── boot ── */
export function trainBoot() {
  const root = document.getElementById('train-root');
  if (!root) return;
  document.querySelector('.tab[data-view="train"]')?.addEventListener('click', () => renderTrain());
  startTicker();
  if (new URLSearchParams(location.search).get('demo') === '1') seedDemoTrain();
  renderTrain();
}

function seedDemoTrain() {
  if (!S.getSetting('programId')) S.setSetting('programId', 'muscle');
  if (!S.getSession(K())) {
    const p = PROGRAMS.muscle;
    const s = buildSession(p, 'upperA');
    s.startedAt = Date.now() - 32 * 60000;
    s.ex[0].sets[0] = { w: 70, r: 10, done: true, ts: Date.now() - 25 * 60000 };
    s.ex[0].sets[1] = { w: 72.5, r: 9, done: true, ts: Date.now() - 19 * 60000 };
    s.ex[0].sets[2] = { w: 75, r: 8, done: true, ts: Date.now() - 13 * 60000 };
    s.ex[0].sets[3] = { w: 77.5, r: 8, done: true, ts: Date.now() - 9 * 60000 };
    s.ex[1].sets[0] = { w: 55, r: 10, done: true, ts: Date.now() - 6 * 60000 };
    s.timer = { endAt: Date.now() + 71 * 1000, total: 90, kind: 'set', fired: false, label: 'Set 2/4 · Lat Pulldown', sub: 'Rest 1:30 — next set when it hits zero', goLabel: 'GO — Set 2/4 · Lat Pulldown', goSub: 'Tap to dismiss' };
    S.putSession(K(), s);
  }
}

/* QA hook */
window.__fuelTrain = {
  ff(sec) {
    const s = todaySession();
    if (s?.timer && !s.timer.fired) { s.timer.endAt -= sec * 1000; S.putSession(K(), s); onTick(); }
  },
  state() { return { ui: ui.mode, session: todaySession()?.finishedAt ? 'finished' : todaySession() ? 'active' : 'none' }; },
};

trainBoot();
