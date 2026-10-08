// FUEL — gym trainer: program picking, workout sessions, per-set logging, auto rest timers.
// Timer flow (as requested): log weight+reps for a set → countdown starts → zero → beep/vibrate →
// next set. After the final set of an exercise there's a longer transition countdown before the
// next exercise. +30 s and Skip buttons on every rest. Screen stays awake during a session.
import * as S from './store.js';
import { PROGRAMS, PROGRAM_LIST, dayIdFor, nextDayIdFor } from './programs.js';
import * as CH from './charts.js';
import { photoPanelHTML, renderPhotoStrip } from './photos.js';

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
const fmtN = (n, d = 0) => Number(n ?? 0).toLocaleString('en-AU', { maximumFractionDigits: d });

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
  const prHit = S.checkPR(ex.name, K(), w, r);
  if (prHit) toastT(`PR! ${ex.name} — ${w} kg × ${r}`);
  ensureAudio(); vib(prHit ? [40, 60, 40] : 12);
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
    setTimeout(() => toastT('All sets done — hit Finish workout 🎉'), 2000);
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
let ui = { mode: 'auto', justFinished: false, pickerBounce: 0, progTab: 'volume', progEx: null };

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
  else if (ui.mode === 'progress' && p) html = progressHTML(p);
  else if (!p) html = pickerHTML(null);
  else if (s && !s.finishedAt) { html = sessionHTML(p, s); keepAwake(true); }
  else { html = homeHTML(p, s); ui.justFinished = false; }
  root.innerHTML = html;
  if (ui.mode === 'auto') {
    const deloadAt = S.getSetting('deloadAt');
    if (deloadAt && Date.now() - deloadAt < 7 * 864e5) {
      root.insertAdjacentHTML('afterbegin', '<div class="panel deload-note">🧘 Deload week — keep it light (60–70% of your usual), same schedule. Your body will thank you.</div>');
    }
  }
  if (ui.mode === 'progress' && p) drawProgress();
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
  const favs = S.favExercises();
  const favHTML = `<div class="panel"><h2 class="ph2">My Exercises</h2>${favs.length
    ? favs.map((nm) => {
        const l = S.lastSetsFor(nm);
        return `<button class="favrow" data-fav-open="${esc(nm)}" type="button">
          <span class="fav-name">${esc(nm)}</span>
          <span class="fav-w">${l ? `${fmtN(l.bestW, 1)} kg` : '—'}</span>
          <span class="fav-when muted">${l ? esc(S.fmtDate(l.date)) : 'not logged yet'}</span>
          <svg class="hrow-chev"><use href="#i-chev"/></svg>
        </button>`;
      }).join('')
    : '<div class="fav-empty muted sm">Star any exercise with ☆ during a workout — your favourites live here with the weight you’re currently doing.</div>'}</div>`;
  const hist = S.sessionHistory(5).filter((h) => h && h.finishedAt);
  const histHTML = hist.length
    ? `<div class="panel"><h2 class="ph2">Recent workouts</h2>${hist.map((h) => {
        const st = sessionStats(h);
        return `<div class="hrow"><span class="hr-date">${esc(S.fmtDate(h.key))}</span><span class="hr-day">${esc(h.dayLabel.split('·')[0].trim())}</span><span class="hr-st">${st.sets} sets · ${st.vol.toLocaleString()} kg</span></div>`;
      }).join('')}</div>`
    : '';
  return `<div class="page-head"><h1>Train</h1><p class="muted">${esc(p.name)} · <button class="link-btn inline" data-act="chgprog" type="button">Change program</button> · <button class="link-btn inline" data-act="progress" type="button">Progress</button></p></div>
    ${ui.justFinished ? '<div class="finish-banner">Workout saved — 💪</div>' : ''}
    ${today}${favHTML}${histHTML}`;
}

/* ── progress (charts) ── */
function shortDate(k) {
  return `${Number(k.slice(8))}/${Number(k.slice(5, 7))}`;
}
function finishedSessions() {
  return S.sessionHistory(90).filter((h) => h && h.finishedAt);
}
function exNamesNewestFirst(fin) {
  const seen = [];
  for (const h of fin) for (const ex of h.ex || []) {
    if (!seen.includes(ex.name) && ex.sets?.some((st) => st.done)) seen.push(ex.name);
  }
  return seen;
}
function exSeries(name, finAsc) {
  const pts = [];
  for (const h of finAsc) {
    const ex = (h.ex || []).find((e2) => e2.name === name);
    if (!ex) continue;
    const done = ex.sets.filter((st) => st.done);
    if (!done.length) continue;
    const top = done.reduce((a, b) => ((b.w || 0) > (a.w || 0) ? b : a), done[0]);
    pts.push({ key: h.key, label: shortDate(h.key), value: top.w });
  }
  return pts;
}

function progressHTML(p) {
  const fin = finishedSessions();
  const asc = fin.slice().reverse();
  const TAB_META = { volume: 'Volume', strength: 'Strength', weight: 'Weight', bests: 'Bests' };
  const tabs = ['volume', 'strength', 'weight', 'bests']
    .map((id) => `<button class="chip${ui.progTab === id ? ' sel' : ''}" data-tab="${id}" type="button">${TAB_META[id]}</button>`)
    .join('');

  let body = '';
  if (ui.progTab === 'volume') {
    const vols = asc.slice(-12).map((h) => ({ key: h.key, label: shortDate(h.key), value: sessionStats(h).vol }));
    const totalVol = asc.reduce((a, h) => a + sessionStats(h).vol, 0);
    const best = asc.reduce((a, h) => Math.max(a, sessionStats(h).vol), 0);
    body = fin.length
      ? `<div class="prog-stats">
          <div><b>${fin.length}</b><span>workouts</span></div>
          <div><b>${fmtN(totalVol)}</b><span>kg lifted</span></div>
          <div><b>${fmtN(best)}</b><span>best session</span></div>
        </div>
        <div class="panel chart-panel"><canvas id="prog-volume" class="prog-canvas" height="130"></canvas>
        <div class="chart-legend"><span class="muted">Volume per workout (kg × reps)</span><span class="muted">last ${vols.length}</span></div></div>`
      : `<div class="panel"><div class="empty-state">Finish a workout and your volume trend appears here.</div></div>`;
  } else if (ui.progTab === 'strength') {
    const names = exNamesNewestFirst(fin);
    if (ui.progEx && !names.includes(ui.progEx)) ui.progEx = null;
    const sel = ui.progEx || names[0] || null;
    const pts = sel ? exSeries(sel, asc) : [];
    if (!names.length) {
      body = `<div class="panel"><div class="empty-state">Finish workouts to unlock strength trends.</div></div>`;
    } else {
      const chips = names.slice(0, 12)
        .map((nm) => `<button class="chip${nm === sel ? ' sel' : ''}" data-ex-pick="${esc(nm)}" type="button">${esc(nm)}</button>`)
        .join('');
      const first = pts[0], last = pts[pts.length - 1];
      const d = pts.length > 1 ? Math.round((last.value - first.value) * 10) / 10 : 0;
      body = `<div class="chip-row scroll" id="prog-ex">${chips}</div>
        <div class="prog-hero"><div class="prog-big"><span id="prog-str-val">${last ? fmtN(last.value, 1) : '—'}</span><span class="unit">kg</span></div>
        <div class="prog-delta ${d >= 0 ? 'up' : 'down'}" id="prog-str-delta">${pts.length > 1 ? `${d >= 0 ? '+' : ''}${d} kg since ${S.fmtDate(first.key)}` : 'First logged session'}</div>
        <button class="star-btn${S.isFavEx(sel) ? ' on' : ''}" data-act="fav" data-ex="${esc(sel)}" type="button" aria-label="Favourite ${esc(sel)}"><svg><use href="#i-star"/></svg></button></div>
        <div class="panel chart-panel"><canvas id="prog-strength" class="prog-canvas" height="150"></canvas>
        <div class="chart-legend"><span class="muted" id="prog-ex-name">${esc(sel)} · heaviest set each session</span><span class="muted">${pts.length} session${pts.length === 1 ? '' : 's'}</span></div></div>`;
    }
  } else if (ui.progTab === 'bests') {
    const rows = bestsRows();
    body = rows
      ? `<div class="panel"><h2 class="ph2">Personal bests</h2>${rows}</div>
        <p class="muted sm" style="padding:2px 6px 0">Best set per lift from your logged workouts — ✦ = set in the last 14 days. Tap one for its trend.</p>`
      : `<div class="panel"><div class="empty-state">Log some sets and your bests land here.</div></div>`;
  } else {
    const series = S.weightSeries();
    const latest = series.length ? series[series.length - 1] : null;
    const cutoff = S.dayKey(new Date(Date.now() - 30 * 864e5));
    const win = series.filter((w) => w.key >= cutoff);
    const d = win.length > 1 ? Math.round((win[win.length - 1].kg - win[0].kg) * 10) / 10 : null;
    body = latest
      ? `<div class="prog-hero"><div class="prog-big"><span id="prog-latest-v">${fmtN(latest.kg, 1)}</span><span class="unit">kg</span></div>
        <div class="prog-delta ${d === null || d <= 0 ? 'down' : 'up'}" id="prog-wt-delta">${d === null ? `logged ${S.fmtDate(latest.key)}` : `${d >= 0 ? '+' : ''}${d} kg in 30 days`}</div></div>
        <div class="panel chart-panel"><canvas id="prog-weight" class="prog-canvas" height="150"></canvas>
        <div class="chart-legend"><span class="muted">Your weigh-ins</span><span class="muted">tap the weight chip on Today to log</span></div></div>
        ${photoPanelHTML()}`
      : `<div class="panel"><div class="empty-state">No weigh-ins yet.<br>Tap the weight chip on the Today screen to log one.</div></div>
        ${photoPanelHTML()}`;
  }
  return `<div class="page-head"><h1>Progress</h1><p class="muted">${esc(p.name)}</p></div>
    <button class="link-btn" data-act="back" type="button">← Back</button>
    <div class="chip-row seg" id="prog-tabs" style="margin-top:10px">${tabs}</div>
    ${body}`;
}

function bestsRows() {
  const fin = finishedSessions();
  const agg = {};
  for (const h of fin) for (const ex of h.ex || []) {
    for (const st of ex.sets || []) {
      if (!st.done || !st.w || !st.r) continue;
      const e1 = st.w * (1 + st.r / 30);
      const cur = agg[ex.name] || (agg[ex.name] = { name: ex.name, best: null, last: h.key });
      if (h.key > cur.last) cur.last = h.key;
      if (!cur.best || e1 > cur.best.e1) cur.best = { w: st.w, r: st.r, e1, key: h.key };
    }
  }
  const recent = S.dayKey(new Date(Date.now() - 14 * 864e5));
  return Object.values(agg)
    .sort((a, b) => (a.last < b.last ? 1 : -1))
    .map((x) => `<button class="favrow" data-fav-open="${esc(x.name)}" type="button">
      <span class="fav-name">${esc(x.name)}</span>${x.best.key >= recent ? '<span class="pr-badge">✦</span>' : ''}
      <span class="fav-w">${fmtN(x.best.w, 1)} × ${x.best.r}</span>
      <span class="fav-when muted">${esc(S.fmtDate(x.best.key))}</span>
      <svg class="hrow-chev"><use href="#i-chev"/></svg>
    </button>`)
    .join('');
}

function drawProgress() {
  const fin = finishedSessions();
  const asc = fin.slice().reverse();
  if (ui.progTab === 'volume') {
    const c = document.getElementById('prog-volume');
    if (!c) return;
    const vols = asc.slice(-12).map((h) => ({ label: shortDate(h.key), value: sessionStats(h).vol }));
    const bestIdx = vols.reduce((bi, v, i) => (v.value > vols[bi].value ? i : bi), 0);
    CH.bars(c, { data: vols, cssH: 130, labelEvery: 2, highlight: bestIdx, padB: 16, padT: 12 });
  } else if (ui.progTab === 'strength') {
    const c = document.getElementById('prog-strength');
    if (!c) return;
    const names = exNamesNewestFirst(fin);
    const sel = ui.progEx || names[0] || null;
    CH.line(c, { data: sel ? exSeries(sel, asc) : [], cssH: 150, unit: 'kg', minPad: 5 });
  } else if (ui.progTab === 'weight') {
    renderPhotoStrip();
    const c = document.getElementById('prog-weight');
    if (!c) return;
    CH.line(c, { data: S.weightSeries().slice(-60).map((w) => ({ label: shortDate(w.key), value: w.kg })), cssH: 150, unit: 'kg', minPad: 0.5 });
  }
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
        <span class="ex-head-r">${exDone ? '<span class="ex-done-chip">Done ✓</span>' : ''}
        <button class="star-btn${S.isFavEx(ex.name) ? ' on' : ''}" data-act="fav" data-ex="${esc(ex.name)}" type="button" aria-label="Favourite ${esc(ex.name)}"><svg><use href="#i-star"/></svg></button></span>
      </div>
      <div class="setrow head"><span class="sr-n">Set</span><span class="sr-target">Reps</span><span class="sr-in-head">kg</span><span class="sr-in-head">reps</span><span></span></div>
      ${rows}
      ${(() => {
        if (ex.sets.some((st) => st.done)) return '';
        const w0 = ex.sets[0]?.w ?? lbl?.lastW ?? null;
        if (!w0 || w0 < 30) return '';
        const r2 = (x) => Math.max(2.5, Math.round(x / 2.5) * 2.5);
        const ramp = [['40% × 8', r2(w0 * 0.4)], ['60% × 5', r2(w0 * 0.6)], ['80% × 3', r2(w0 * 0.8)]];
        const wu = ex.wu || [];
        const doneCt = ramp.filter((x, wi) => wu[wi]).length;
        return `<div class="wu"><button class="wu-toggle" data-act="wu" data-ex="${ei}" type="button">Warm-up ${ex.wuOpen ? '▾' : '▸'}${doneCt === ramp.length ? ' ✓' : doneCt ? ` (${doneCt}/${ramp.length})` : ''}</button>
          ${ex.wuOpen ? `<div class="wu-rows">${ramp.map(([lab, wgt], wi) => `<div class="wu-row${wu[wi] ? ' done' : ''}" data-act="wutick" data-ex="${ei}" data-wi="${wi}" role="button"><span>${wgt} kg</span><span class="muted sm">${lab}</span><span class="wu-tick">${wu[wi] ? '✓' : ''}</span></div>`).join('')}</div>` : ''}</div>`;
      })()}
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
  if (ui.mode === 'progress') {
    const tab = t.closest('[data-tab]');
    if (tab) { ui.progTab = tab.dataset.tab; renderTrain(); return; }
    const exChip = t.closest('[data-ex-pick]');
    if (exChip) { ui.progEx = exChip.dataset.exPick; renderTrain(); return; }
  }
  const frow = t.closest('[data-fav-open]');
  if (frow) { ui.mode = 'progress'; ui.progTab = 'strength'; ui.progEx = frow.dataset.favOpen; renderTrain(); return; }
  const favBtn = t.closest('[data-act="fav"]');
  if (favBtn) {
    const on = S.toggleFavEx(favBtn.dataset.ex);
    toastT(on ? `★ ${favBtn.dataset.ex} added to My Exercises` : `${favBtn.dataset.ex} removed from favourites`);
    renderTrain();
    return;
  }
  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'start' || a === 'resume') { startSession(act.dataset.day || (todaySession()?.dayId) || dayIdFor()); return; }
    if (a === 'finish') { finishSession(); return; }
    if (a === 'discard') { discardSession(act); return; }
    if (a === 'chgprog') { ui.mode = 'picker'; renderTrain(); return; }
    if (a === 'back') { ui.mode = 'auto'; renderTrain(); return; }
    if (a === 'progress') { ui.mode = 'progress'; renderTrain(); return; }
    if (a === 'wu') { const s2 = todaySession(); if (s2) { const ex2 = s2.ex[+act.dataset.ex]; ex2.wuOpen = !ex2.wuOpen; S.putSession(K(), s2); renderTrain(); } return; }
    if (a === 'wutick') { const s3 = todaySession(); if (s3) { const ex3 = s3.ex[+act.dataset.ex]; ex3.wu = ex3.wu || []; const wi = +act.dataset.wi; ex3.wu[wi] = !ex3.wu[wi]; S.putSession(K(), s3); renderTrain(); } return; }
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
  seedDemoTrainHistory();
}

function seedDemoTrainHistory() {
  if (S.sessionHistory(90).some((h) => h.finishedAt)) return;
  const p = PROGRAMS.muscle;
  const DAYID = { 1: 'upperA', 2: 'lowerA', 4: 'upperB', 5: 'lowerB' };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let back = 56; back >= 1; back--) {
    const d = new Date(start.getTime() - back * 864e5);
    const dayId = DAYID[d.getDay()];
    if (!dayId) continue;
    const key = S.dayKey(d);
    if (S.getSession(key)) continue;
    const week = Math.floor((56 - back) / 7);
    const def = p.days[dayId];
    const base0 = dayId === 'lowerA' || dayId === 'lowerB' ? 70 : 55;
    const ex = def.exercises.map((x, i) => {
      const w = Math.round((base0 + i * 12 + week * 2.5) * 2) / 2;
      const r0 = parseInt((/(\d+)/.exec(String(x.reps)) || [])[1] || '10', 10);
      return {
        name: x.name, reps: x.reps, rest: x.rest,
        sets: Array.from({ length: x.sets }, (_, si) => ({
          w: Math.max(2.5, Math.round((w - si * 2.5) * 2) / 2),
          r: Math.max(3, r0 - si),
          done: true,
          ts: d.getTime() + 18 * 3600e3 + (i * 8 + si * 2) * 60e3,
        })),
      };
    });
    S.putSession(key, {
      programId: p.id, programName: p.name, dayId, dayLabel: def.label,
      startedAt: d.getTime() + 18 * 3600e3,
      finishedAt: d.getTime() + 18 * 3600e3 + 58 * 60e3,
      timer: null,
      ex,
    });
  }
}

window.addEventListener('fuel:refresh-train', () => { ui.mode = 'auto'; renderTrain(); });

/* QA hook */
window.__fuelTrain = {
  ff(sec) {
    const s = todaySession();
    if (s?.timer && !s.timer.fired) { s.timer.endAt -= sec * 1000; S.putSession(K(), s); onTick(); }
  },
  state() { return { ui: ui.mode, session: todaySession()?.finishedAt ? 'finished' : todaySession() ? 'active' : 'none' }; },
  render() { renderTrain(); },
  setTab(t) { ui.mode = 'progress'; ui.progTab = t; renderTrain(); },
};

trainBoot();
