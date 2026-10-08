// FUEL — state store: profile, goals, daily logs, food cache. All local.

const KEY = 'fuel-state-v1';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

export const DEFAULT_PROFILE = { sex: 'male', age: 38, height: 180, weight: 85, activity: 1.55, goalType: 'maintain', rate: 0.5 };
export const DEFAULT_GOALS = { kcal: 2550, protein: 180, carbs: 255, fat: 71 };

function fresh() {
  return { profile: { ...DEFAULT_PROFILE }, goals: { ...DEFAULT_GOALS }, logs: {}, foods: {}, workouts: {}, settings: {}, meta: { created: Date.now() } };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw);
    return { ...fresh(), ...s, profile: { ...DEFAULT_PROFILE, ...(s.profile || {}) }, goals: { ...DEFAULT_GOALS, ...(s.goals || {}) } };
  } catch {
    return fresh();
  }
}

export function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
export function getState() { return state; }

/* ── dates ── */
export function dayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function fmtDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = dayKey(); 
  const yest = dayKey(new Date(Date.now() - 864e5));
  if (key === today) return 'Today';
  if (key === yest) return 'Yesterday';
  return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ── logs ── */
export function dayLog(key = dayKey()) {
  if (!state.logs[key]) state.logs[key] = { meals: Object.fromEntries(MEALS.map((m) => [m, []])) };
  for (const m of MEALS) if (!state.logs[key].meals[m]) state.logs[key].meals[m] = [];
  return state.logs[key];
}

export function addEntry(meal, entry, key = dayKey()) {
  const log = dayLog(key);
  entry.id = 'e' + Date.now() + Math.random().toString(36).slice(2, 6);
  entry.ts = Date.now();
  log.meals[meal].push(entry);
  save();
  return entry;
}

export function removeEntry(meal, id, key = dayKey()) {
  const log = dayLog(key);
  log.meals[meal] = log.meals[meal].filter((e) => e.id !== id);
  save();
}

export function dayTotals(key = dayKey()) {
  const log = dayLog(key);
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const m of MEALS) for (const e of log.meals[m]) { t.kcal += e.kcal || 0; t.p += e.p || 0; t.c += e.c || 0; t.f += e.f || 0; }
  return t;
}

export function recentDays(n = 14) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = dayKey(new Date(Date.now() - i * 864e5));
    const any = MEALS.some((m) => (state.logs[k]?.meals?.[m] || []).length);
    out.push({ key: k, totals: dayTotals(k), any });
  }
  return out;
}

export function streak() {
  let n = 0;
  for (let i = 0; ; i++) {
    const k = dayKey(new Date(Date.now() - i * 864e5));
    const any = MEALS.some((m) => (state.logs[k]?.meals?.[m] || []).length);
    if (any) n++;
    else if (i === 0) continue; // today not logged yet — keep counting from yesterday
    else break;
    if (i > 400) break;
  }
  return n;
}

/* ── foods cache ── */
export function saveFood(f) {
  if (!f.id) f.id = 'f' + Date.now() + Math.random().toString(36).slice(2, 6);
  state.foods[f.id] = { ...f, ts: Date.now() };
  save();
  return f.id;
}
export function getFood(id) { return state.foods[id]; }
export function recentFoods(n = 8) {
  return Object.values(state.foods).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, n);
}

/* ── targets (Mifflin-St Jeor) ── */
export function computeTargets(profile) {
  const { sex, age, height, weight, activity, goalType, rate } = profile;
  const bmr = 10 * weight + 6.25 * height - 5 * age + (sex === 'female' ? -161 : 5);
  const tdee = bmr * activity;
  const delta = goalType === 'lose' ? -(rate * 7700) / 7 : goalType === 'gain' ? (rate * 7700) / 7 : 0;
  const kcal = Math.max(1200, Math.round((tdee + delta) / 10) * 10);
  const protein = Math.round(weight * 2);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, bdee: Math.round(tdee) };
}

/* ── export / import / reset ── */
export function exportJSON() { return JSON.stringify(state, null, 2); }
export function importJSON(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object') throw new Error('bad file');
  state = { ...fresh(), ...s, profile: { ...DEFAULT_PROFILE, ...(s.profile || {}) }, goals: { ...DEFAULT_GOALS, ...(s.goals || {}) } };
  save();
}
export function resetAll() { state = fresh(); save(); }
export function setProfile(p) { state.profile = { ...state.profile, ...p }; save(); }
export function setGoals(g) { state.goals = { ...state.goals, ...g }; save(); }

/* ── nutrition helpers ── */
export const KJ_PER_KCAL = 4.184;
export function kcalFromNutri(n, basisKey) {
  // n: compat nutri object (nutriments map) + basisKey '100g'|'serving'
  const kc = n[`energy-kcal_${basisKey}`] ?? n[`energy-kcal_${basisKey === 'serving' ? 'serving' : '100g'}`];
  let k = typeof kc === 'number' ? kc : null;
  if (k === null) {
    const kj = n[`energy-kj_${basisKey}`] ?? n[`energy_${basisKey}`];
    if (typeof kj === 'number') k = kj / KJ_PER_KCAL;
  }
  return k === null ? null : Math.round(k);
}
export function n(nutr, key, basisKey) {
  const v = nutr?.[`${key}_${basisKey}`];
  return typeof v === 'number' ? v : null;
}

/* ── workouts (gym) ── */
export function getSession(key) { return (state.workouts || {})[key] || null; }
export function putSession(key, s) {
  state.workouts = state.workouts || {};
  if (s === null) delete state.workouts[key];
  else state.workouts[key] = s;
  save();
}
export function delSession(key) { putSession(key, null); }
export function sessionHistory(n = 30) {
  return Object.entries(state.workouts || {})
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, n)
    .map(([key, s]) => ({ key, ...s }));
}
export function lastSetsFor(exName, excludeKey) {
  const ws = state.workouts || {};
  const keys = Object.keys(ws).filter((k) => k !== excludeKey).sort().reverse();
  for (const k of keys) {
    const ex = (ws[k].ex || []).find((e) => e.name === exName);
    if (ex) {
      const done = ex.sets.filter((st) => st.done);
      if (done.length) {
        const last = done[done.length - 1];
        const best = done.reduce((a, b) => ((b.w || 0) > (a.w || 0) ? b : a), done[0]);
        return { lastW: last.w, lastR: last.r, bestW: best.w, bestR: best.r, date: k };
      }
    }
  }
  return null;
}
export function getSetting(k) { return (state.settings || {})[k]; }
export function setSetting(k, v) {
  state.settings = state.settings || {};
  state.settings[k] = v;
  save();
}
