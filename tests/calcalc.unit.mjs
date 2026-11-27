// FUEL v68 — unit tests for the deterministic calorie calculator (Mifflin-St Jeor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcCalories, macroSplit, ACTIVITY_MULT, ACTIVITY_LABELS } from '../public/js/calcalc.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.001, `${msg}: got ${a}, want ${b}`);

test('male BMR / TDEE / deficit / bulk known-answer (moderate activity)', () => {
  const r = calcCalories({ weightKg: 84.6, heightCm: 180, age: 38, sex: 'male', activity: 3 });
  // BMR = 10*84.6 + 6.25*180 − 5*38 + 5 = 1786
  assert.equal(r.bmr, 1790);
  // TDEE = 1786 × 1.55 = 2768.3 → 2770
  assert.equal(r.tdee, 2770);
  assert.equal(r.deficit, 2270); // 2768.3 − 500 = 2268.3 → 2270
  assert.equal(r.bulk, 3070);    // 2768.3 + 300 = 3068.3 → 3070
});

test('female BMR uses the −161 term and matches a known answer', () => {
  const r = calcCalories({ weightKg: 65, heightCm: 165, age: 30, sex: 'female', activity: 3 });
  // BMR = 650 + 1031.25 − 150 − 161 = 1370.25 → 1370
  assert.equal(r.bmr, 1370);
  // TDEE = 1370.25 × 1.55 = 2123.89 → 2120
  assert.equal(r.tdee, 2120);
  assert.equal(r.deficit, 1620);
  assert.equal(r.bulk, 2420);
});

test('macros reuse the 25%-fat rule and total the target kcal', () => {
  const m = macroSplit(2770, 84.6);
  assert.equal(m.protein, 169);              // 2 g/kg, rounded
  assert.equal(m.fat, 77);                   // round(2770*0.25/9) = 77
  assert.equal(m.carbs, 350);                // round(remainder / 4)
  const total = m.protein * 4 + m.carbs * 4 + m.fat * 9;
  assert.ok(Math.abs(total - 2770) <= 12, `macros approximate total (${total} vs 2770)`);
});

test('every activity tier scales TDEE by its multiplier', () => {
  const male = { weightKg: 80, heightCm: 180, age: 30, sex: 'male' };
  const base = 10 * 80 + 6.25 * 180 - 5 * 30 + 5; // 1730
  for (let t = 1; t <= 5; t++) {
    const r = calcCalories({ ...male, activity: t });
    near(r.tdee, Math.round((base * ACTIVITY_MULT[t - 1]) / 10) * 10, `tier ${t} tdee`);
    assert.equal(r.deficit, r.tdee - 500, `tier ${t} deficit = tdee − 500`);
    assert.equal(r.bulk, r.tdee + 300, `tier ${t} bulk = tdee + 300`);
  }
});

test('activity is clamped to the 1..5 range', () => {
  const p = { weightKg: 80, heightCm: 180, age: 30, sex: 'male' };
  const hi = calcCalories({ ...p, activity: 99 });
  const lo = calcCalories({ ...p, activity: 0 });
  const five = calcCalories({ ...p, activity: 5 });
  const one = calcCalories({ ...p, activity: 1 });
  assert.equal(hi.tdee, five.tdee);
  assert.equal(lo.tdee, one.tdee);
});

test('activity labels are the five plain-English tiers', () => {
  assert.deepEqual(ACTIVITY_LABELS, ['Sedentary', 'Lightly active', 'Moderately active', 'Very active', 'Athlete']);
  assert.equal(ACTIVITY_MULT.length, 5);
});
