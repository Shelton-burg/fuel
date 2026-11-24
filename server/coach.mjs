// FUEL — AI coach: recommends a strategy + training plan from the user's stats and history.
// The calorie numbers are computed client-side (Mifflin-St Jeor) and passed in —
// the model picks between them and explains; it never invents values.

const MODEL_CANDIDATES = ['gemini-3.8-flash', 'gemini-flash-latest']; // 2.5-flash is retired for new users
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

/* ── provider chain: DeepSeek first (OpenAI-compatible, reliable), Gemini as fallback ── */
async function askDeepSeek(system, user, key, maxTokens = 2000) {
  const r = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`deepseek ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 160)}`);
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || '';
  try { return JSON.parse(text); } catch { throw new Error(`deepseek bad_json(len=${text.length}): ${text.slice(0, 120)}`); }
}
async function askGemini(schema, promptText, key, maxTokens = 2000) {
  let lastErr = '';
  for (const model of MODEL_CANDIDATES) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}), maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) { lastErr += `[${model}] ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 160)} | `; continue; }
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p2) => p2.text || '').join('') || '';
    try { return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); }
    catch { lastErr += `[${model}] bad_json(len=${text.length}) | `; }
  }
  throw new Error(lastErr || 'gemini_failed');
}
/** keys = { deepseek, gemini } — first provider that answers wins */
export async function askModel(system, user, keys, schema = null, maxTokens = 2000) {
  const errs = [];
  if (keys && keys.deepseek) {
    try { return await askDeepSeek(system, user, keys.deepseek, maxTokens); }
    catch (e) { errs.push(String(e.message || e)); }
  }
  if (keys && keys.gemini) {
    try { return await askGemini(schema, `${system}\n\n${user}`, keys.gemini, maxTokens); }
    catch (e) { errs.push(String(e.message || e)); }
  }
  const err = new Error('all_providers_failed');
  err.detail = errs.join(' || ') || 'no provider configured';
  throw err;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    strategy: { type: 'string', enum: ['lose', 'maintain', 'gain'] },
    rateRecommend: { type: 'number' },
    strategyWhy: { type: 'string' },
    program: { type: 'string', enum: ['strength', 'muscle', 'lean', 'keep'] },
    programWhy: { type: 'string' },
    focusExercises: { type: 'array', items: { type: 'string' } },
    tips: { type: 'array', items: { type: 'string' } },
    targetNote: { type: 'string' },
  },
  required: ['summary', 'strategy', 'program', 'programWhy', 'tips'],
};

const RULES = `Rules:
- The calorie numbers already exist in payload.calorieCandidates (computed with Mifflin-St Jeor). NEVER invent different calorie numbers — if you mention calories, use those values.
- strategy: "lose" | "maintain" | "gain" — pick the one that best serves the user's aspiration (lose fat / build muscle / get stronger / maintain), the pace they set, their weight trend and their logged intake. If eating data is thin (fewer than 7 logged days), still pick the best fit but add a tip about logging more days.
- rateRecommend: kg per week for lose/gain: 0.25, 0.5 or 0.75; use 0 for maintain.
- program: the training program to run: "strength" (Foundation Strength 5x5 — heavy compounds), "muscle" (Muscle Builder — hypertrophy volume) or "lean" (Lean & Athletic — conditioning), or "keep" if their current program already fits.
- programWhy: 1-2 sentences, plain English, Australian English.
- focusExercises: 0-4 exercise names copied EXACTLY from payload.training.topExercises[].name — lifts to prioritise. Only names from that list.
- tips: 3-5 short, specific, personal tips grounded in their real numbers where possible (protein intake, logged days, weight trend, sessions per week, specific lifts). No medical claims, no supplement push.
- targetNote: one short line for under the recommended calories (e.g. what the pace means day to day).
- Speak directly to the user ("you"), warm but efficient tone.`;

const clamp = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

function sanitize(p, payload) {
  const strat = ['lose', 'maintain', 'gain'].includes(p.strategy) ? p.strategy : 'maintain';
  const rates = [0.25, 0.5, 0.75];
  const rateRecommend = strat === 'maintain' ? 0 : rates.includes(+p.rateRecommend) ? +p.rateRecommend : 0.5;
  const prog = ['strength', 'muscle', 'lean', 'keep'].includes(p.program) ? p.program : 'keep';
  const allowed = new Set(((payload && payload.training && payload.training.topExercises) || []).map((e) => e.name));
  const focusExercises = (Array.isArray(p.focusExercises) ? p.focusExercises : [])
    .map((s) => clamp(s, 60))
    .filter((s) => s && allowed.has(s))
    .slice(0, 4);
  const tips = (Array.isArray(p.tips) ? p.tips : []).map((s) => clamp(s, 200)).filter(Boolean).slice(0, 5);
  return {
    summary: clamp(p.summary, 700),
    strategy: strat,
    rateRecommend,
    strategyWhy: clamp(p.strategyWhy, 400),
    program: prog,
    programWhy: clamp(p.programWhy, 400),
    focusExercises,
    tips,
    targetNote: clamp(p.targetNote, 200),
  };
}

export async function coachAdvice(payload, keys) {
  const user = `Here is the user's data as JSON:\n${JSON.stringify(payload)}\n\n${RULES}`;
  const parsed = await askModel("You are FUEL's personal fitness & nutrition coach. Reply with JSON only.", user, keys, RESPONSE_SCHEMA, 3000);
  return sanitize(parsed, payload);
}

/* ══════════ weekly check-in ══════════ */
// Same philosophy as coachAdvice: every number the model may suggest is pre-computed
// client-side and passed in as tweakOptions — sanitize() drops anything off-list.

const WEEKLY_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    wins: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' } },
    tweaks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['kcal', 'protein', 'rate', 'program', 'deload', 'none'] },
          suggest: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['kind', 'why'],
      },
    },
  },
  required: ['headline', 'summary', 'wins', 'watch', 'tweaks'],
};

const WEEKLY_RULES = `You are FUEL's fitness & nutrition coach doing the weekly check-in.
Data: the user's stats, goals, this week vs last week averages, weight trend, training summary, and tweakOptions.
Rules:
- headline: one short line (max ~60 chars).
- summary: 2-4 sentences reviewing the week honestly, grounded in the numbers given.
- wins: 1-3 short wins from the data (days logged, sessions done, protein, weight moving the right way).
- watch: 1-3 short things to keep an eye on.
- tweaks: 0-4 small adjustments. kind must be one of: kcal (suggest MUST be one of tweakOptions.kcal), protein (one of tweakOptions.protein), rate (one of tweakOptions.rate), program ("strength"|"muscle"|"lean"), deload, or none.
- deload: ONLY include it when payload.training.weeksActive >= 8 AND payload.training.deloadRecent is false — then suggest backing off for a week (lighter weights, same schedule). No suggest value needed.
  Each tweak needs a short "why". Only include a tweak when the data justifies it — an empty tweaks list is fine and better than noise.
- suggest is a string, e.g. "2700" for kcal, "180" for protein, "0.5" for rate, "lean" for program.
- Australian English, "you" voice, warm but efficient. No medical claims.`;

function sanitizeWeekly(p, payload) {
  const opt = (payload && payload.tweakOptions) || {};
  const allowedKcal = (opt.kcal || []).map(Number);
  const allowedProtein = (opt.protein || []).map(Number);
  const allowedRate = (opt.rate || []).map(Number);
  const tweaks = (Array.isArray(p.tweaks) ? p.tweaks : [])
    .map((t) => {
      const kind = ['kcal', 'protein', 'rate', 'program', 'deload'].includes(t.kind) ? t.kind : null;
      if (!kind) return null;
      const why = clamp(t.why, 220);
      if (kind === 'deload') return { kind, suggest: '', why };
      if (kind === 'kcal') { const v = Math.round(Number(t.suggest)); return allowedKcal.includes(v) ? { kind, suggest: v, why } : null; }
      if (kind === 'protein') { const v = Math.round(Number(t.suggest)); return allowedProtein.includes(v) ? { kind, suggest: v, why } : null; }
      if (kind === 'rate') { const v = Number(t.suggest); return allowedRate.includes(v) ? { kind, suggest: v, why } : null; }
      const v = String(t.suggest || '').trim();
      return ['strength', 'muscle', 'lean'].includes(v) ? { kind, suggest: v, why } : null;
    })
    .filter(Boolean)
    .slice(0, 4);
  const strArr = (a, n, len) => (Array.isArray(a) ? a : []).map((s) => clamp(s, len)).filter(Boolean).slice(0, n);
  return {
    headline: clamp(p.headline, 120),
    summary: clamp(p.summary, 600),
    wins: strArr(p.wins, 3, 120),
    watch: strArr(p.watch, 3, 140),
    tweaks,
  };
}

/** kept for mealplan.mjs: schema + one prompt in, JSON out, through the provider chain */
export async function callModel(schema, promptText, keys) {
  const k = typeof keys === 'string' ? { gemini: keys } : keys; // older call sites passed a raw key
  return askModel('Reply with JSON only.', promptText, k, schema, 3000);
}

export async function weeklyReview(payload, keys) {
  const user = `Here is the user's data as JSON:\n${JSON.stringify(payload)}\n\n${WEEKLY_RULES}`;
  const parsed = await askModel("You are FUEL's coach running the weekly check-in. Reply with JSON only.", user, keys, WEEKLY_SCHEMA, 2500);
  return sanitizeWeekly(parsed, payload);
}

/* ══════════ conversational coach ══════════ */
// The client sends a context it computed itself (no invented numbers) plus the thread so far.
// The model answers in JSON: prose + evidence keys + optional actions. Every number the UI shows
// comes from metricIndex() built out of the context — a claim about a metric the payload doesn't
// contain is dropped, and the values are overwritten with the real ones.

const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    evidence: { type: 'array', items: { type: 'object', properties: { metric: { type: 'string' } }, required: ['metric'] } },
    actions: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, value: { type: 'string' }, label: { type: 'string' } }, required: ['kind'] } },
    followups: { type: 'array', items: { type: 'string' } },
  },
  required: ['text'],
};

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

function metricIndex(ctx) {
  const c = ctx || {};
  const t = c.targets || {};
  const i = c.intake || {};
  const w = c.weight || {};
  const m = c.measures || {};
  const tr = c.training || {};
  const idx = {};
  const add = (key, label, value, target, unit) => {
    const v = num(value);
    if (v === null) return;
    idx[key] = { metric: key, label, value: v, target: num(target), unit: unit || '' };
  };
  add('kcal_7d', 'Calories, 7-day average', i.kcal7, t.kcal, 'kcal');
  add('kcal_14d', 'Calories, 14-day average', i.kcal14, t.kcal, 'kcal');
  add('protein_7d', 'Protein, 7-day average', i.protein7, t.protein, 'g');
  add('protein_14d', 'Protein, 14-day average', i.protein14, t.protein, 'g');
  add('carbs_14d', 'Carbs, 14-day average', i.carbs14, t.carbs, 'g');
  add('fat_14d', 'Fat, 14-day average', i.fat14, t.fat, 'g');
  add('days_logged', 'Days logged (of 14)', i.days14, 14, 'days');
  add('adherence', 'Days within 100 kcal of target', i.adherencePct, 100, '%');
  add('protein_hits', 'Days hitting protein (of days logged)', i.proteinHitDays, i.days14, 'days');
  add('weekend_kcal', 'Calories on weekends', i.weekendKcal, t.kcal, 'kcal');
  add('weekday_kcal', 'Calories on weekdays', i.weekdayKcal, t.kcal, 'kcal');
  add('weight_now', 'Weight now', w.now, w.target, 'kg');
  add('weight_7d', 'Weight change, 7 days', w.change7d, null, 'kg');
  add('weight_28d', 'Weight change, 28 days', w.change28d, null, 'kg');
  add('waist_now', 'Waist', m.waist, null, 'cm');
  add('waist_28d', 'Waist change, 28 days', m.change28d, null, 'cm');
  add('sessions_28d', 'Sessions, last 28 days', tr.sessions28d, null, 'sessions');
  add('sessions_week', 'Sessions per week', tr.perWeek, null, 'sessions');
  add('deload_due', 'Deload due', tr.deloadDue ? 1 : 0, null, '');
  const wa = c.water || {};
  add('water_today', 'Water today', (wa.todayMl || 0) / 1000, (wa.goalMl || 0) / 1000, 'L');
  add('water_avg7', 'Water, 7-day average', wa.avg7Ml != null ? wa.avg7Ml / 1000 : null, (wa.goalMl || 0) / 1000, 'L');
  const fe = c.feel || {};
  add('energy_7d', 'Energy, 7-day average', fe.energy, 5, '/5');
  add('mood_7d', 'Mood, 7-day average', fe.mood, 5, '/5');
  add('soreness_7d', 'Soreness, 7-day average', fe.soreness, 5, '/5');
  add('hunger_7d', 'Hunger, 7-day average', fe.hunger, 5, '/5');
  add('readiness', 'Readiness (energy + mood − soreness)', fe.readiness, 5, '/5');
  add('checkin_days', 'Check-ins logged (of 7)', fe.days, 7, 'days');
  for (const meal of Object.keys(i.byMeal || {})) {
    const row = i.byMeal[meal] || {};
    add('meal_' + slug(meal), `${meal} average`, row.kcal, null, 'kcal');
  }
  for (const grp of (tr.muscles || [])) {
    add('sets_' + slug(grp.group), `${grp.group} sets this week`, grp.sets, 10, 'sets');
  }
  for (const l of (tr.lifts || [])) {
    add('lift_' + slug(l.name), `${l.name} best`, l.bestKg, null, 'kg');
  }
  for (const r of (c.recipes || [])) {
    add('recipe_' + slug(r.name), `${r.name} a serve`, r.perServeKcal, null, 'kcal');
  }
  return idx;
}

function sanitizeChat(p, ctx) {
  const idx = metricIndex(ctx);
  const allowed = (ctx && ctx.allowed) || {};
  const inList = (v, list) => (list || []).map(String).includes(String(v));
  const evidence = (Array.isArray(p.evidence) ? p.evidence : [])
    .map((e) => idx[slug(e && e.metric)])
    .filter(Boolean)
    .filter((e, i, a) => a.findIndex((x) => x.metric === e.metric) === i)
    .slice(0, 5);
  const actions = (Array.isArray(p.actions) ? p.actions : [])
    .map((a) => {
      const kind = String((a && a.kind) || '');
      const value = a && a.value != null ? String(a.value) : '';
      const label = clamp(a && a.label, 70);
      if (kind === 'kcal' && inList(Math.round(Number(value)), allowed.kcal)) return { kind, value: String(Math.round(Number(value))), label: label || `Set calories to ${Math.round(Number(value))}` };
      if (kind === 'protein' && inList(Math.round(Number(value)), allowed.protein)) return { kind, value: String(Math.round(Number(value))), label: label || `Set protein to ${Math.round(Number(value))} g` };
      if (kind === 'rate' && inList(Number(value), allowed.rate)) return { kind, value: String(Number(value)), label: label || `Change pace to ${Number(value)} kg/week` };
      if (kind === 'program' && inList(value, allowed.programs)) return { kind, value, label: label || `Switch to ${value}` };
      if (kind === 'swap' && inList(value, allowed.swaps)) return { kind, value, label: label || `Swap in ${value}` };
      if (kind === 'deload') return { kind, value: '', label: label || 'Take a deload week' };
      return null;
    })
    .filter(Boolean)
    .slice(0, 3);
  const followups = (Array.isArray(p.followups) ? p.followups : []).map((f) => clamp(f, 90)).filter(Boolean).slice(0, 3);
  return { text: clamp(p.text, 1400), evidence, actions, followups, ungrounded: evidence.length === 0 };
}

const CHAT_RULES = `Answer the question the user actually asked. Rules:
- 2-5 short sentences, plain English, Australian English, speak to them as "you". No markdown, no headings, no bullet lists in the text.
- Every factual claim about their numbers MUST be backed by an entry in "evidence". Only use these metric keys: {METRICS}.
- Never write a number that is not in those metrics — the app fills in the values from its own data, so a made-up figure will be dropped and look wrong.
- If the data cannot answer the question (not enough logs, a lift never trained), say exactly what is missing and what to log.
- actions: only when you are recommending a concrete change, and only from what the app can do: kcal / protein / rate / program / swap / deload, with values drawn from {ALLOWED}. An empty list is fine.
- followups: 0-3 very short questions they might ask next (max ~40 chars each).
- No medical claims, no supplement advice, no calorie numbers you invented.`;

export async function coachChat(ctx, messages, keys) {
  const idx = metricIndex(ctx);
  const allowed = (ctx && ctx.allowed) || {};
  const system = `You are FUEL's coach, talking with the person whose data is below. Reply with JSON only: {"text": string, "evidence": [{"metric": key}], "actions": [{"kind","value","label"}], "followups": [string]}.
Rules:
${CHAT_RULES.replace('{METRICS}', Object.keys(idx).join(', ') || 'none').replace('{ALLOWED}', JSON.stringify({
    kcal: allowed.kcal || [], protein: allowed.protein || [], rate: allowed.rate || [],
    program: allowed.programs || [], swap: (allowed.swaps || []).slice(0, 12),
  }))}`;
  const thread = (Array.isArray(messages) ? messages : [])
    .slice(-10)
    .map((m2) => `${m2.role === 'coach' ? 'Coach' : 'Them'}: ${clamp(m2.text, 800)}`)
    .join('\n');
  const user = `Their data:
${JSON.stringify(ctx)}

Conversation so far:
${thread || '(this is the first message)'}

Answer the last message from Them. JSON only.`;
  const parsed = await askModel(system, user, keys, CHAT_SCHEMA, 1600);
  return sanitizeChat(parsed, ctx);
}

/* ── 7-day nutrition balance & micronutrient gaps ────────────────────────── */
const GAPS_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nutrient: { type: 'string' },
          why: { type: 'string' },
          swap: { type: 'string' },
        },
        required: ['nutrient', 'why', 'swap'],
      },
    },
    next3Days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          food: { type: 'string' },
          reason: { type: 'string' },
          kcal: { type: 'number' },
          p: { type: 'number' },
          c: { type: 'number' },
          f: { type: 'number' },
        },
        required: ['food', 'reason', 'kcal', 'p', 'c', 'f'],
      },
    },
  },
  required: ['headline', 'gaps', 'next3Days'],
};

export async function nutritionGaps(payload, keys) {
  const region = typeof payload?.region === 'string' ? payload.region : 'qld';
  const month = typeof payload?.season?.month === 'string' ? payload.season.month : '';
  const inSeason = Array.isArray(payload?.season?.inSeason) ? payload.season.inSeason.slice(0, 24) : [];
  const fv = payload?.fruitVeg || {};
  const fvLine = (typeof fv.avgVeg === 'number' && typeof fv.avgFruit === 'number')
    ? `Fruit & veg over the last 7 days: they averaged ${fv.avgVeg} veg serves and ${fv.avgFruit} fruit serves per day (targets: 5 veg, 2 fruit). If they are under target, weave veg-heavy and fruit options into next3Days.`
    : '';
  const system = `You are FUEL's practical Australian nutritionist. Look at the user's last 7 days of logged foods and spot likely vitamin, mineral, omega-3, or fibre gaps from their actual food patterns (e.g. heavy on chicken & white rice -> low iron/B12, omega-3, folate/fibre; low dairy/greens -> low calcium/potassium/magnesium).
Rules:
- Australian English, plain and direct, no lecturing, no fake exact mg numbers.
- Fit their calorie & protein goals.
${fvLine}
- It is ${month || 'this month'} in ${region.toUpperCase()} Australia. Prefer in-season produce when choosing the next3Days foods — the in-season list right now includes: ${inSeason.join(', ') || '(unknown)'}. Only pick something out of season when it specifically fixes a gap.
- Return JSON ONLY: {"headline": string (<= 110 chars), "gaps": [{"nutrient": string, "why": string (<= 90 chars), "swap": string (<= 90 chars)}] (2 to 4 items), "next3Days": [{"food": string (e.g. "Lean beef mince (150g)"), "reason": string (<= 60 chars), "kcal": number, "p": number, "c": number, "f": number}] (4 to 6 everyday Australian supermarket foods)}.`;
  const user = `Last 7 days food log summary:\n${JSON.stringify(payload)}\n\nReturn JSON only.`;
  const raw = await askModel(system, user, keys, GAPS_SCHEMA, 1400);
  const headline = clamp(raw?.headline || 'Balanced week — keep rotating proteins and veg.', 140);
  const gaps = (Array.isArray(raw?.gaps) ? raw.gaps : []).slice(0, 4).map((g) => ({
    nutrient: clamp(g?.nutrient || 'Variety', 40),
    why: clamp(g?.why || '', 120),
    swap: clamp(g?.swap || '', 120),
  })).filter((g) => g.nutrient && (g.why || g.swap));
  const next3Days = (Array.isArray(raw?.next3Days) ? raw.next3Days : []).slice(0, 6).map((x) => ({
    food: clamp(x?.food || '', 60),
    reason: clamp(x?.reason || '', 90),
    kcal: Math.max(0, Math.round(Number(x?.kcal) || 0)),
    p: Math.max(0, Math.round((Number(x?.p) || 0) * 10) / 10),
    c: Math.max(0, Math.round((Number(x?.c) || 0) * 10) / 10),
    f: Math.max(0, Math.round((Number(x?.f) || 0) * 10) / 10),
  })).filter((x) => x.food);
  return { headline, gaps, next3Days, generatedAt: new Date().toISOString() };
}

/* ── ingredient-based recipe ideas (v55) ─────────────────────────────────── */
const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          serves: { type: 'number' },
          ingredients: { type: 'array', items: { type: 'string' } },
          method: { type: 'string' },
          kcal: { type: 'number' },
          p: { type: 'number' },
          c: { type: 'number' },
          f: { type: 'number' },
        },
        required: ['title', 'ingredients', 'method', 'kcal', 'p', 'c', 'f'],
      },
    },
  },
  required: ['recipes'],
};

export async function recipeIdeas(payload, keys) {
  const ingredients = (Array.isArray(payload?.ingredients) ? payload.ingredients : [])
    .map((s) => clamp(String(s), 40)).filter(Boolean).slice(0, 10);
  const region = typeof payload?.region === 'string' ? payload.region : 'qld';
  const month = typeof payload?.season?.month === 'string' ? payload.season.month : '';
  const inSeason = Array.isArray(payload?.season?.inSeason) ? payload.season.inSeason.slice(0, 24) : [];
  const kcal = Math.max(0, Math.round(Number(payload?.kcal) || 0));
  const protein = Math.max(0, Math.round(Number(payload?.protein) || 0));
  const system = `You are FUEL's practical Aussie home cook. Invent 2 to 3 realistic recipes that use the ingredients the user has. They can assume ordinary pantry staples are available (oil, salt, pepper, dried herbs, rice, pasta, stock, garlic, onion, eggs).
Rules:
- Australian English; simple, fast, home-kitchen recipes; no exotic or hard-to-find ingredients.
- Each recipe MUST use at least 2 of the user's ingredients.
- Prefer in-season produce when adding veg: it is ${month || 'this month'} in ${region.toUpperCase()} Australia; in season now: ${inSeason.join(', ') || '(unknown)'}.
- Portion realistically: ${kcal ? `aim for roughly ${kcal} kcal per serve` : 'a sensible single-serve portion'}${protein ? ` and macros that help hit a ${protein}g protein day` : ''}.
- "method": one short paragraph, numbered steps, <= 500 chars.
- Return JSON ONLY: {"recipes": [{"title": string, "serves": number, "ingredients": [string], "method": string, "kcal": number (per serve), "p": number (g), "c": number (g), "f": number (g)}]} with 2 to 3 recipes.`;
  const user = `Ingredients I have: ${ingredients.join(', ') || '(none given — suggest 3 easy seasonal dinners)'}\n\nReturn JSON only.`;
  const raw = await askModel(system, user, keys, RECIPE_SCHEMA, 1600);
  const recipes = (Array.isArray(raw?.recipes) ? raw.recipes : []).slice(0, 3).map((r) => ({
    title: clamp(r?.title || 'Quick meal', 70),
    serves: Math.max(1, Math.round(Number(r?.serves) || 1)),
    ingredients: (Array.isArray(r?.ingredients) ? r.ingredients : []).map((s) => clamp(String(s), 60)).filter(Boolean).slice(0, 14),
    method: clamp(r?.method || '', 700),
    kcal: Math.max(0, Math.round(Number(r?.kcal) || 0)),
    p: Math.max(0, Math.round((Number(r?.p) || 0) * 10) / 10),
    c: Math.max(0, Math.round((Number(r?.c) || 0) * 10) / 10),
    f: Math.max(0, Math.round((Number(r?.f) || 0) * 10) / 10),
  })).filter((r) => r.title && r.ingredients.length);
  return { recipes, generatedAt: new Date().toISOString() };
}
