// FUEL — meal planner: drafts a day of meals from a fixed food table + the user's own
// frequent foods. The model only PICKS foods and portions (multipliers); every number
// in the answer is computed HERE from the table — the model never does arithmetic.

import { callModel } from './coach.mjs';

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snacks'];
const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };
const MULTS = [0.5, 1, 1.5, 2, 3];

// Typical-serve values (rounded), standard nutrition data. Serve = the label shown.
const STAPLES = [
  { id: 'eggs', name: 'Eggs', serve: '2 large', kcal: 143, p: 13, c: 1, f: 10 },
  { id: 'eggwhites', name: 'Egg whites', serve: '200 g', kcal: 104, p: 22, c: 1, f: 0 },
  { id: 'chicken', name: 'Chicken breast (grilled)', serve: '150 g', kcal: 248, p: 47, c: 0, f: 5 },
  { id: 'beefmince', name: 'Lean beef mince', serve: '150 g cooked', kcal: 300, p: 36, c: 0, f: 12 },
  { id: 'steak', name: 'Rump steak (lean)', serve: '150 g', kcal: 260, p: 39, c: 0, f: 9 },
  { id: 'salmon', name: 'Salmon fillet', serve: '150 g', kcal: 310, p: 33, c: 0, f: 19 },
  { id: 'tuna', name: 'Tuna in springwater', serve: '95 g tin', kcal: 90, p: 20, c: 0, f: 1 },
  { id: 'prawns', name: 'Prawns (cooked)', serve: '150 g', kcal: 148, p: 30, c: 1, f: 2 },
  { id: 'yoghurt', name: 'Greek yoghurt 0%', serve: '170 g', kcal: 129, p: 17, c: 8, f: 4 },
  { id: 'cottage', name: 'Cottage cheese (light)', serve: '200 g', kcal: 196, p: 26, c: 7, f: 6 },
  { id: 'whey', name: 'Whey protein shake', serve: '30 g + water', kcal: 120, p: 24, c: 3, f: 2 },
  { id: 'milk', name: 'Full-cream milk', serve: '250 ml', kcal: 160, p: 8, c: 12, f: 9 },
  { id: 'skimmilk', name: 'Skim milk', serve: '250 ml', kcal: 90, p: 9, c: 12, f: 0 },
  { id: 'oats', name: 'Rolled oats', serve: '75 g dry', kcal: 300, p: 10, c: 50, f: 6 },
  { id: 'weetbix', name: 'Weet-Bix', serve: '2 biscuits', kcal: 130, p: 4, c: 25, f: 1 },
  { id: 'bread', name: 'Wholemeal bread', serve: '2 slices', kcal: 145, p: 7, c: 24, f: 2 },
  { id: 'rice', name: 'White rice (cooked)', serve: '180 g', kcal: 230, p: 5, c: 50, f: 1 },
  { id: 'brownrice', name: 'Brown rice (cooked)', serve: '180 g', kcal: 220, p: 5, c: 45, f: 2 },
  { id: 'pasta', name: 'Pasta (cooked)', serve: '200 g', kcal: 290, p: 10, c: 55, f: 2 },
  { id: 'potato', name: 'Potato (boiled)', serve: '250 g', kcal: 190, p: 4, c: 42, f: 0 },
  { id: 'sweetpotato', name: 'Sweet potato (roast)', serve: '200 g', kcal: 180, p: 3, c: 42, f: 0 },
  { id: 'broccoli', name: 'Broccoli', serve: '150 g', kcal: 50, p: 4, c: 6, f: 1 },
  { id: 'veg', name: 'Mixed vegetables', serve: '150 g', kcal: 60, p: 3, c: 10, f: 1 },
  { id: 'salad', name: 'Salad greens + tomato', serve: '1 bowl', kcal: 30, p: 2, c: 4, f: 1 },
  { id: 'banana', name: 'Banana', serve: '1 medium', kcal: 105, p: 1, c: 27, f: 0 },
  { id: 'apple', name: 'Apple', serve: '1 medium', kcal: 95, p: 0, c: 25, f: 0 },
  { id: 'orange', name: 'Orange', serve: '1 medium', kcal: 62, p: 1, c: 15, f: 0 },
  { id: 'berries', name: 'Mixed berries', serve: '100 g', kcal: 55, p: 1, c: 13, f: 0 },
  { id: 'pb', name: 'Peanut butter', serve: '20 g', kcal: 118, p: 5, c: 4, f: 10 },
  { id: 'almonds', name: 'Almonds', serve: '30 g', kcal: 170, p: 6, c: 6, f: 15 },
  { id: 'avocado', name: 'Avocado', serve: '100 g (half)', kcal: 160, p: 2, c: 9, f: 15 },
  { id: 'oliveoil', name: 'Olive oil', serve: '1 tbsp', kcal: 115, p: 0, c: 0, f: 13 },
  { id: 'cheese', name: 'Tasty cheese', serve: '30 g', kcal: 120, p: 8, c: 0, f: 10 },
  { id: 'bakedbeans', name: 'Baked beans', serve: '220 g tin', kcal: 180, p: 10, c: 30, f: 1 },
  { id: 'chickpeas', name: 'Chickpeas', serve: '150 g', kcal: 180, p: 9, c: 30, f: 3 },
  { id: 'lentils', name: 'Lentils (cooked)', serve: '150 g', kcal: 170, p: 13, c: 30, f: 1 },
  { id: 'hummus', name: 'Hummus', serve: '60 g', kcal: 165, p: 5, c: 9, f: 12 },
  { id: 'wrap', name: 'Wholemeal wrap', serve: '1 large', kcal: 150, p: 4, c: 27, f: 4 },
  { id: 'proteinbar', name: 'Protein bar', serve: '60 g', kcal: 220, p: 20, c: 20, f: 8 },
  { id: 'upgo', name: 'Up&Go', serve: '250 ml', kcal: 180, p: 9, c: 26, f: 5 },
  { id: 'timtam', name: 'Tim Tam', serve: '2 biscuits', kcal: 190, p: 2, c: 26, f: 9 },
  { id: 'choc', name: 'Dark chocolate', serve: '30 g', kcal: 155, p: 2, c: 12, f: 11 },
  { id: 'tortilla-chips', name: 'Corn chips', serve: '50 g', kcal: 240, p: 3, c: 29, f: 13 },
  { id: 'ricecakes', name: 'Rice cakes', serve: '2 cakes', kcal: 70, p: 1, c: 15, f: 0 },
  { id: 'honey', name: 'Honey', serve: '1 tbsp', kcal: 60, p: 0, c: 17, f: 0 },
];

const MP_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    meals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slot: { type: 'string', enum: SLOTS },
          why: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, mult: { type: 'number' } },
              required: ['id', 'mult'],
            },
          },
        },
        required: ['slot', 'why', 'items'],
      },
    },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'meals', 'tips'],
};

const MP_RULES = `You are FUEL's meal planner. Build ONE day of food.
- Use ONLY items from payload.foods — an "id" must match exactly; you may NOT invent foods.
- Portions: mult is the number of serves, from [0.5, 1, 1.5, 2, 3]. A 150 g chicken serve is mult 1; 300 g is mult 2.
- Every meal slot exactly once, in this order: breakfast, lunch, dinner, snacks. 1-4 items per meal.
- If mode is "full": total approximately hits targets (kcal within ±5%, protein at/above target).
- If mode is "left": totals approximately match remain (what's still to eat today) — keep it lighter.
- Prefer protein-dense choices; respect the user's notes; spread protein across meals.
- Favour foods from payload.frequent (marked in the list) when they fit — the user already eats them.
- why: one short line per meal (max ~90 chars). tips: up to 3 short lines. Australian English, "you" voice.
- Do NOT write any calorie/protein numbers in your answer text — the app computes and shows them.`;

export async function mealPlan(payload, apiKey) {
  const own = (Array.isArray(payload.frequent) ? payload.frequent : []).map((f, i) => ({
    id: `my${i}`,
    name: String(f.name || 'Food').slice(0, 60),
    serve: String(f.serve || 'serve').slice(0, 40),
    kcal: Math.max(0, Math.round(+f.kcal || 0)),
    p: Math.max(0, Math.round(+f.p || 0)),
    c: Math.max(0, Math.round(+f.c || 0)),
    f: Math.max(0, Math.round(+f.f || 0)),
    mine: true,
  })).filter((f) => f.kcal > 0);
  const list = [...STAPLES, ...own];
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));

  const brief = {
    mode: payload.mode === 'left' ? 'left' : 'full',
    targets: payload.targets || {},
    remain: payload.remain || {},
    aspiration: payload.aspiration || null,
    notes: (payload.notes || '').slice(0, 400),
    foods: list.map((s) => ({ id: s.id, name: s.name, serve: s.serve, kcal: s.kcal, p: s.p, c: s.c, f: s.f, ...(s.mine ? { frequent: true } : {}) })),
  };

  const parsed = await callModel(MP_SCHEMA, `Build the day's food plan.\nHere is the data as JSON:\n${JSON.stringify(brief)}\n\n${MP_RULES}`, apiKey);

  // ── deterministic composition: all numbers computed here ──
  const r1 = (n) => Math.round(n);
  const usedSlots = new Set();
  const meals = [];
  for (const m of Array.isArray(parsed.meals) ? parsed.meals : []) {
    const slot = SLOTS.includes(m.slot) ? m.slot : null;
    if (!slot || usedSlots.has(slot)) continue;
    const items = (Array.isArray(m.items) ? m.items : [])
      .map((it) => {
        const s = byId[it.id];
        if (!s) return null;
        const mult = MULTS.includes(+it.mult) ? +it.mult : 1;
        return { name: s.name, serve: s.serve, qty: mult, kcal: r1(s.kcal * mult), p: r1(s.p * mult), c: r1(s.c * mult), f: r1(s.f * mult), mine: !!s.mine };
      })
      .filter(Boolean)
      .slice(0, 4);
    if (!items.length) continue;
    usedSlots.add(slot);
    const totals = items.reduce((a, it) => ({ kcal: a.kcal + it.kcal, p: a.p + it.p, c: a.c + it.c, f: a.f + it.f }), { kcal: 0, p: 0, c: 0, f: 0 });
    meals.push({ slot, label: SLOT_LABEL[slot], why: String(m.why || '').slice(0, 120), items, totals });
  }
  if (!meals.length) { const e = new Error('mealplan_empty'); e.detail = 'no usable meals returned'; throw e; }
  const totals = meals.reduce((a, m) => ({ kcal: a.kcal + m.totals.kcal, p: a.p + m.totals.p, c: a.c + m.totals.c, f: a.f + m.totals.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  const tips = (Array.isArray(parsed.tips) ? parsed.tips : []).map((s) => String(s).slice(0, 160)).filter(Boolean).slice(0, 3);

  return {
    title: String(parsed.title || 'Your day').slice(0, 80),
    summary: String(parsed.summary || '').slice(0, 400),
    meals,
    totals,
    tips,
  };
}
