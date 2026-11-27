// calcalc — deterministic Calorie Calculator (Mifflin-St Jeor).
// Pure, side-effect-free arithmetic. Numbers are computed, never invented.
// FUEL v68.

// Activity tiers 1..5 → Mifflin-St Jeor multipliers.
export const ACTIVITY_MULT = [1.2, 1.375, 1.55, 1.725, 1.9];
export const ACTIVITY_LABELS = [
  'Sedentary',
  'Lightly active',
  'Moderately active',
  'Very active',
  'Athlete',
];

const round10 = (n) => Math.round(n / 10) * 10;

/**
 * Protein / fat / carbs for a given kcal target, reusing the app's 25%-fat rule
 * (protein 2 g/kg, fat = 25% of kcal → grams via 9 kcal/g, carbs = the remainder
 * via 4 kcal/g) so the three macros total the calorie target.
 */
export function macroSplit(kcal, weightKg) {
  const protein = Math.round(weightKg * 2);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { protein, carbs, fat };
}

/**
 * @param {object} o
 * @param {number} o.weightKg
 * @param {number} o.heightCm
 * @param {number} o.age
 * @param {'male'|'female'} o.sex
 * @param {1|2|3|4|5} o.activity  activity tier (1 = sedentary … 5 = athlete)
 * @returns {{bmr:number, tdee:number, deficit:number, bulk:number, protein:number, carbs:number, fat:number}}
 */
export function calcCalories({ weightKg, heightCm, age, sex = 'male', activity = 3 }) {
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'female' ? -161 : 5);
  const tdee = bmr * ACTIVITY_MULT[Math.min(5, Math.max(1, activity)) - 1];
  const deficit = tdee - 500;
  const bulk = tdee + 300;
  const { protein, carbs, fat } = macroSplit(round10(tdee), weightKg);
  return {
    bmr: round10(bmr),
    tdee: round10(tdee),
    deficit: round10(deficit),
    bulk: round10(bulk),
    protein,
    carbs,
    fat,
  };
}
