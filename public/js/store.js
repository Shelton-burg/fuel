// FUEL — state store: profile, goals, daily logs, food cache. All local.

const KEY = 'fuel-state-v1';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

export const DEFAULT_PROFILE = { sex: 'male', age: 38, height: 180, weight: 85, activity: 1.55, goalType: 'maintain', rate: 0.5, aspir: 'maintain', targetWeight: null, notes: '', calPref: null };
export const DEFAULT_GOALS = { kcal: 2550, protein: 180, carbs: 255, fat: 71 };

function fresh() {
  return { profile: { ...DEFAULT_PROFILE }, goals: { ...DEFAULT_GOALS }, logs: {}, foods: {}, workouts: {}, weights: {}, settings: {}, meta: { created: Date.now() } };
}

let state = load();

function normalize(s) {
  return { ...fresh(), ...s, profile: { ...DEFAULT_PROFILE, ...(s.profile || {}) }, goals: { ...DEFAULT_GOALS, ...(s.goals || {}) } };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return normalize(JSON.parse(raw));
  } catch (e) {
    globalThis.__fuelStoreOk = false; // storage blocked or corrupt — never crash, just start clean
    return fresh();
  }
}

// NEVER let persistence failures crash a flow (iOS can block localStorage entirely):
// the state stays live in memory, the app warns, and autobak.js ships copies to the server.
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    globalThis.__fuelStoreOk = true;
  } catch (e) {
    globalThis.__fuelStoreOk = false;
    console.error('[store] local save failed:', e && e.message);
    try { globalThis.dispatchEvent(new Event('fuel:storage-error')); } catch {}
  }
  try { globalThis.dispatchEvent(new Event('fuel:state-saved')); } catch {}
}

/* true when the state holds anything worth protecting (used by the auto-backup/restore) */
export function hasAnyData(st = state) {
  try {
    const logs = st.logs || {};
    for (const k of Object.keys(logs)) {
      const meals = (logs[k] && logs[k].meals) || {};
      for (const m of Object.keys(meals)) if ((meals[m] || []).length) return true;
    }
    if (Object.keys(st.weights || {}).length) return true;
    if (Object.keys(st.workouts || {}).length) return true;
    if (((st.settings || {}).usuals || []).length) return true;
    if (((st.settings || {}).foodFavs || []).length) return true;
    if (Object.keys(((st.settings || {}).planEdits) || {}).length) return true;
    return false;
  } catch { return true; } // in doubt: assume data exists, never clobber
}

/* replace the whole state (restore from mirror/cloud) — returns the new state or null on junk */
export function adoptState(obj) {
  if (!obj || typeof obj !== 'object') return null;
  try {
    state = normalize(obj);
    save();
    return state;
  } catch { return null; }
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

/* ── editing a logged entry ── */
export function findEntry(id, key = dayKey()) {
  const log = dayLog(key);
  for (const m of MEALS) {
    const e = (log.meals[m] || []).find((x) => x.id === id);
    if (e) return { meal: m, entry: e };
  }
  return null;
}
/** Overwrite an entry in place (may move it to another meal). Keeps its id + original ts. */
export function updateEntry(meal, id, patch, key = dayKey(), newMeal = meal) {
  const log = dayLog(key);
  const i = (log.meals[meal] || []).findIndex((x) => x.id === id);
  if (i < 0) return null;
  const merged = { ...log.meals[meal][i], ...patch, id, ts: log.meals[meal][i].ts };
  if (newMeal && newMeal !== meal && MEALS.includes(newMeal)) {
    log.meals[meal].splice(i, 1);
    log.meals[newMeal].push(merged);
  } else {
    log.meals[meal][i] = merged;
  }
  save();
  return merged;
}
/** Rebuild a food model from a logged entry so the portion sheet can re-open it.
    Entries written since the edit feature carry basis/qty/per; older ones are
    derived from the quantity label ("275 g", "1 × serve", "1 cup ≈ 180 g"). */
export function foodFromEntry(e) {
  if (!e) return null;
  const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
  const gramsM = String(e.qtyLabel || '').match(/(\d+(?:\.\d+)?)\s*g\b/i);
  const servesM = String(e.qtyLabel || '').match(/(\d+(?:\.\d+)?)\s*(?:×\s*)?serves?\b/i);
  const qty = num(e.qty) || (gramsM ? Number(gramsM[1]) : null) || (servesM ? Number(servesM[1]) : null) || 1;
  const cached = e.foodId ? getFood(e.foodId) : null;
  if (cached && cached.kcal != null) return { ...cached, basis: e.basis || cached.basis || '100g', lastQty: qty };
  const basis = e.basis || (gramsM ? '100g' : 'serve');
  if (e.per && (e.per.kcal || e.per.kcal === 0)) {
    return { name: e.name, brand: e.brand || '', basis, source: e.src || 'manual', kcal: e.per.kcal, p: e.per.p || 0, c: e.per.c || 0, f: e.per.f || 0, lastQty: qty };
  }
  const factor = basis === '100g' ? qty / 100 : qty;
  const div = factor > 0 ? factor : 1;
  const r1 = (v) => Math.round(((v || 0) / div) * 10) / 10;
  return {
    name: e.name, brand: e.brand || '', basis, source: e.src || 'manual',
    kcal: r1(e.kcal), p: r1(e.p), c: r1(e.c), f: r1(e.f), lastQty: qty,
  };
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

/* ── foods cache: every scanned/saved food, de-duped by barcode (or name+brand) ── */
export function foodKey(f) {
  if (f && f.barcode) return 'bc:' + String(f.barcode).trim();
  const nm = String((f && f.name) || '').toLowerCase().trim();
  const br = String((f && f.brand) || '').toLowerCase().trim();
  return 'nm:' + nm + '|' + br;
}
export function saveFood(f) {
  if (!f || !f.name) return null;
  state.foods = state.foods || {};
  const nm = String(f.name).toLowerCase().trim();
  const br = String(f.brand || '').toLowerCase().trim();
  const all = Object.values(state.foods);
  let id = f.id;
  if (!id) {
    // same barcode wins; otherwise same name+brand — never two records for one food
    const hit = (f.barcode && all.find((x) => x.barcode && String(x.barcode) === String(f.barcode)))
      || all.find((x) => String(x.name || '').toLowerCase().trim() === nm && String(x.brand || '').toLowerCase().trim() === br);
    if (hit) id = hit.id;
  }
  if (!id) id = 'f' + Date.now() + Math.random().toString(36).slice(2, 6);
  const prev = state.foods[id] || {};
  const merged = { ...prev, ...f, id, key: foodKey(f), ts: Date.now() };
  for (const kk of Object.keys(merged)) if (merged[kk] === undefined) delete merged[kk];
  state.foods[id] = merged;
  // keep the newest 300 — a long list must never slow logging down
  const ids = Object.keys(state.foods);
  if (ids.length > 300) {
    ids.sort((a, b) => (state.foods[b].ts || 0) - (state.foods[a].ts || 0));
    for (const old of ids.slice(300)) delete state.foods[old];
  }
  save();
  return id;
}
export function getFood(id) { return (state.foods || {})[id]; }
export function myFoods(n = 10) {
  return Object.values(state.foods || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, n);
}
export function searchMyFoods(q, n = 5) {
  const t = String(q || '').toLowerCase().trim();
  if (!t) return [];
  return Object.values(state.foods || {})
    .filter((f) => `${f.name || ''} ${f.brand || ''}`.toLowerCase().includes(t))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, n);
}
export function removeFood(id) {
  if (!state.foods || !state.foods[id]) return;
  delete state.foods[id];
  save();
}
export function recentFoods(n = 8) { return myFoods(n); }

/* ── my version of a program day (swap / add / remove / reorder) ── */
export function planEdits() { return (state.settings || {}).planEdits || {}; }
/** the exercise list actually used for a program day — the user's edits win */
export function planFor(programId, dayId, fallback) {
  const list = planEdits()[programId]?.[dayId];
  const src = Array.isArray(list) && list.length ? list : (fallback || []);
  return src.map((x) => ({ name: x.name, sets: x.sets, reps: x.reps, rest: x.rest }));
}
export function planCustomised(programId, dayId) {
  const list = planEdits()[programId]?.[dayId];
  return Array.isArray(list) && list.length > 0;
}
export function setPlan(programId, dayId, list) {
  state.settings = state.settings || {};
  const pe = state.settings.planEdits || {};
  pe[programId] = pe[programId] || {};
  if (list === null) delete pe[programId][dayId];
  else pe[programId][dayId] = list.map((x) => ({ name: String(x.name), sets: Number(x.sets) || 1, reps: String(x.reps || '10'), rest: Number(x.rest) || 60 }));
  if (!Object.keys(pe[programId]).length) delete pe[programId];
  state.settings.planEdits = pe;
  save();
}
export function resetPlan(programId, dayId) { setPlan(programId, dayId, null); }

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
export function resetAll() { state = fresh(); state.meta.resetAt = Date.now(); save(); } // tombstone: boots won't auto-restore a wiped net over an intentional reset
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
/* ── progression: what to aim for next time ──
   Double progression: beat the top of the rep range on the best set and the weight goes up
   (back to the bottom of the range at the new weight); otherwise the same weight, one more rep.
   Pure arithmetic on his own logged sets — no guessing, no AI. */
export function lastWorkingSets(name, excludeKey) {
  const ws = state.workouts || {};
  const keys = Object.keys(ws).filter((k) => k !== excludeKey).sort().reverse();
  for (const k of keys) {
    const ex = (ws[k].ex || []).find((e) => e.name === name);
    if (!ex) continue;
    const done = (ex.sets || []).filter((st) => st.done && st.w > 0);
    if (done.length) return { date: k, sets: done.map((st) => ({ w: st.w, r: st.r || 0 })) };
  }
  return null;
}
export function nextTarget(name, repsTarget, excludeKey) {
  const last = lastWorkingSets(name, excludeKey);
  if (!last) return null;
  const best = last.sets.reduce((a, b) => (b.w > a.w || (b.w === a.w && b.r > a.r) ? b : a), last.sets[0]);
  const m = String(repsTarget == null ? '' : repsTarget).match(/(\d+)\s*-\s*(\d+)/);
  const lo = m ? Number(m[1]) : Number((String(repsTarget).match(/\d+/) || [0])[0]) || 0;
  const hi = m ? Number(m[2]) : lo;
  if (hi <= 0) return null;
  const step = best.w >= 100 ? 5 : 2.5;
  if (best.r >= hi) {
    return { w: Math.round((best.w + step) * 10) / 10, r: lo, from: { w: best.w, rep: best.r, date: last.date }, why: 'beat the top of the range — add weight' };
  }
  return { w: best.w, r: Math.min(hi, best.r + 1), from: { w: best.w, rep: best.r, date: last.date }, why: 'same weight — one more rep' };
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
        if ((e.ts || 0) >= a.ts) { a.ts = e.ts || 0; a.name = e.name; a.qtyLabel = e.qtyLabel || ''; a.kcal = e.kcal; a.p = e.p || 0; a.c = e.c || 0; a.f = e.f || 0; a.basis = e.basis || null; a.qty = e.qty ?? null; a.per = e.per || null; }
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
    items: items.map((e) => ({ name: e.name, kcal: e.kcal || 0, p: e.p || 0, c: e.c || 0, f: e.f || 0, qtyLabel: e.qtyLabel || '', basis: e.basis || null, qty: e.qty ?? null, per: e.per || null, src: e.src || null })),
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
