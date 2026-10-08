// FUEL — state store: profile, goals, daily logs, food cache. All local.

const KEY = 'fuel-state-v1';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

export const DEFAULT_PROFILE = { sex: 'male', age: 38, height: 180, weight: 85, activity: 1.55, goalType: 'maintain', rate: 0.5, aspir: 'maintain', targetWeight: null, notes: '', calPref: null };
export const DEFAULT_GOALS = { kcal: 2550, protein: 180, carbs: 255, fat: 71 };

function fresh() {
  return { profile: { ...DEFAULT_PROFILE }, goals: { ...DEFAULT_GOALS }, logs: {}, foods: {}, workouts: {}, weights: {}, settings: {}, meta: { created: Date.now() } };
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

export function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  try { globalThis.dispatchEvent(new Event('fuel:state-saved')); } catch {}
}
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
  if (dt.getFullYear() !== new Date().getFullYear()) {
    return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
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
/* ── body weight log ── */
export function logWeight(key, kg) {
  state.weights = state.weights || {};
  state.weights[key] = kg;
  const keys = Object.keys(state.weights).sort();
  const latest = keys[keys.length - 1];
  if (latest) state.profile.weight = state.weights[latest]; // keep calorie targets honest
  save();
}
export function getWeight(key) { return (state.weights || {})[key]; }
export function latestWeight() {
  const keys = Object.keys(state.weights || {}).sort();
  if (!keys.length) return null;
  const k = keys[keys.length - 1];
  return { key: k, kg: state.weights[k] };
}
export function weightSeries() {
  return Object.entries(state.weights || {})
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, kg]) => ({ key, kg }));
}
/* ── quick log: frequent foods + saved meal "usuals" ── */
export function frequentFoods(n = 6) {
  const agg = {};
  for (const logv of Object.values(state.logs || {})) {
    for (const m of MEALS) {
      for (const e of (logv.meals?.[m] || [])) {
        const k = String(e.name || '').toLowerCase().trim();
        if (!k || !e.kcal) continue;
        const a = agg[k] || (agg[k] = { name: e.name, qtyLabel: e.qtyLabel || '', kcal: e.kcal, p: e.p || 0, c: e.c || 0, f: e.f || 0, count: 0, ts: 0 });
        a.count++;
        if ((e.ts || 0) >= a.ts) { a.ts = e.ts || 0; a.name = e.name; a.qtyLabel = e.qtyLabel || ''; a.kcal = e.kcal; a.p = e.p || 0; a.c = e.c || 0; a.f = e.f || 0; }
      }
    }
  }
  return Object.values(agg).sort((a, b) => b.count - a.count || b.ts - a.ts).slice(0, n);
}
export function usuals() { return (state.settings || {}).usuals || []; }
export function saveUsual(name, meal, items) {
  state.settings = state.settings || {};
  const sum = (f) => Math.round(items.reduce((a, e) => a + (e[f] || 0), 0));
  const u = {
    id: 'u' + Date.now().toString(36),
    name: String(name || 'Usual meal').slice(0, 40),
    meal,
    items: items.map((e) => ({ name: e.name, kcal: e.kcal || 0, p: e.p || 0, c: e.c || 0, f: e.f || 0, qtyLabel: e.qtyLabel || '' })),
    kcal: sum('kcal'), p: sum('p'), c: sum('c'), f: sum('f'),
    ts: Date.now(), uses: 0,
  };
  const list = state.settings.usuals || [];
  const dupe = list.findIndex((x) => x.name === u.name && x.meal === meal);
  if (dupe >= 0) list[dupe] = { ...u, id: list[dupe].id, uses: list[dupe].uses || 0 };
  else list.unshift(u);
  state.settings.usuals = list.slice(0, 20);
  save();
  return u;
}
export function removeUsual(id) {
  state.settings = state.settings || {};
  state.settings.usuals = (state.settings.usuals || []).filter((u) => u.id !== id);
  save();
}
/* ── favourite foods (starred from search) ── */
export function foodFavs() { return (state.settings || {}).foodFavs || []; }
export function isFoodFav(name) {
  const k = String(name || '').toLowerCase().trim();
  return foodFavs().some((f) => String(f.name || '').toLowerCase().trim() === k);
}
export function toggleFoodFav(food) {
  state.settings = state.settings || {};
  const k = String(food.name || '').toLowerCase().trim();
  const list = state.settings.foodFavs || [];
  const i = list.findIndex((f) => String(f.name || '').toLowerCase().trim() === k);
  if (i >= 0) list.splice(i, 1);
  else {
    list.unshift({
      name: food.name, brand: food.brand || '', basis: food.basis || '100g',
      kcal: food.kcal, p: food.p || 0, c: food.c || 0, f: food.f || 0,
      kcal100: food.kcal100 ?? null, servingLabel: food.servingLabel || '',
      barcode: food.barcode || null, image: food.image || null,
    });
  }
  state.settings.foodFavs = list.slice(0, 40);
  save();
  return i < 0; // true = now starred
}
export function logUsual(id, key) {
  const u = (state.settings?.usuals || []).find((x) => x.id === id);
  if (!u) return null;
  for (const it of u.items) addEntry(u.meal, { ...it }, key);
  u.uses = (u.uses || 0) + 1;
  u.ts = Date.now();
  save();
  return u;
}
/* ── personal bests (e1RM, Epley) ── */
export function bestE1RM(name, excludeKey) {
  let best = 0;
  for (const [k, s] of Object.entries(state.workouts || {})) {
    if (k === excludeKey || !s?.ex) continue;
    const ex = s.ex.find((e) => e.name === name);
    if (!ex) continue;
    for (const st of (ex.sets || [])) if (st.done && st.w && st.r) best = Math.max(best, st.w * (1 + st.r / 30));
  }
  return best;
}
export function checkPR(name, excludeKey, w, r) {
  if (!name || !w || !r) return null;
  const e1 = w * (1 + r / 30);
  const prev = bestE1RM(name, excludeKey);
  return prev > 0 && e1 > prev + 0.01 ? { prev: Math.round(prev * 10) / 10 } : null;
}
/* ── favourite exercises ── */
export function favExercises() { return (state.settings || {}).favs || []; }
export function isFavEx(name) { return favExercises().includes(name); }
export function toggleFavEx(name) {
  state.settings = state.settings || {};
  const set = new Set(state.settings.favs || []);
  if (set.has(name)) set.delete(name); else set.add(name);
  state.settings.favs = [...set];
  save();
  return set.has(name);
}
export function getSetting(k) { return (state.settings || {})[k]; }
export function setSetting(k, v) {
  state.settings = state.settings || {};
  state.settings[k] = v;
  save();
}
