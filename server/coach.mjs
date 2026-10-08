// FUEL — AI coach: recommends a strategy + training plan from the user's stats and history.
// The calorie numbers are computed client-side (Mifflin-St Jeor) and passed in —
// the model picks between them and explains; it never invents values.

const MODEL_CANDIDATES = ['gemini-3.8-flash', 'gemini-2.5-flash'];

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

export async function coachAdvice(payload, apiKey) {
  const body = {
    contents: [{ parts: [{ text: `You are FUEL's personal fitness & nutrition coach.\nHere is the user's data as JSON:\n${JSON.stringify(payload)}\n\n${RULES}` }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 2600,
    },
  };
  let lastErr = '';
  for (const model of MODEL_CANDIDATES) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      lastErr += `[${model}] ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 160)} | `;
      continue;
    }
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    let parsed;
    try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); }
    catch { lastErr += `[${model}] bad_json(len=${text.length}): ${text.slice(0, 120).replace(/\s+/g, ' ')} | `; continue; }
    return sanitize(parsed, payload);
  }
  const err = new Error('coach_failed');
  err.detail = lastErr;
  throw err;
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

export async function callModel(schema, promptText, apiKey) {
  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 2600 },
  };
  let lastErr = '';
  for (const model of MODEL_CANDIDATES) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (!r.ok) { lastErr += `[${model}] ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 160)} | `; continue; }
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p2) => p2.text || '').join('') || '';
    try { return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); }
    catch { lastErr += `[${model}] bad_json(len=${text.length}): ${text.slice(0, 120).replace(/\s+/g, ' ')} | `; continue; }
  }
  const err = new Error('weekly_failed');
  err.detail = lastErr;
  throw err;
}

export async function weeklyReview(payload, apiKey) {
  const parsed = await callModel(WEEKLY_SCHEMA, `You are FUEL's coach running this week's check-in.\nHere is the user's data as JSON:\n${JSON.stringify(payload)}\n\n${WEEKLY_RULES}`, apiKey);
  return sanitizeWeekly(parsed, payload);
}
