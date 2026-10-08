// FUEL — Open Food Facts client (search + barcode). Free, open database.
const UA = 'FuelTracker/0.1 (shelton@allplumbandgas.com.au)';
const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,brands,nutriments,serving_size,serving_quantity,nutrition_data_per,image_front_small_url,image_front_url,nutriscore_grade,nova_group';

async function jget(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('off_' + r.status);
  return r.json();
}

/** Search foods by name. Rate-limited endpoint — call on explicit submit, not per keystroke. */
export async function searchFoods(q, limit = 24) {
  const url = `${BASE}/api/v2/search?search_terms=${encodeURIComponent(q)}&fields=${FIELDS}&page_size=${limit}&sort_by=popularity_key`;
  const j = await jget(url);
  return (j.products || []).map(normalize).filter((f) => f.kcal100 !== null || f.kcalServe !== null);
}

/** Fetch one product by barcode. */
export async function getProduct(code) {
  const url = `${BASE}/api/v2/product/${encodeURIComponent(code)}?fields=${FIELDS}`;
  const j = await jget(url);
  if (j.status === 0 || !j.product) return null;
  const f = normalize(j.product);
  return f.kcal100 === null && f.kcalServe === null ? { ...f, noNutrition: true } : f;
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null);
const energyKcal = (nutr, basis) => {
  const kc = num(nutr[`energy-kcal_${basis}`]);
  if (kc !== null) return Math.round(kc);
  const kj = num(nutr[`energy-kj_${basis}`] ?? nutr[`energy_${basis}`]);
  return kj !== null ? Math.round(kj / 4.184) : null;
};

/** Normalize an OFF product into FUEL food shape. Prefers per-100g; falls back to per-serve. */
export function normalize(p) {
  const nutr = p.nutriments || {};
  const kcal100 = energyKcal(nutr, '100g');
  const kcalServe = energyKcal(nutr, 'serving');
  const serveGrams = num(p.serving_quantity);
  const has100 = kcal100 !== null;
  const base = has100 ? '100g' : 'serving';
  const g = (key) => num(nutr[`${key}_${base}`]);
  return {
    name: (p.product_name || '').trim() || 'Unknown product',
    brand: (p.brands || '').split(',')[0].trim() || null,
    barcode: p.code || null,
    basis: has100 ? '100g' : 'serve',
    kcal: has100 ? kcal100 : kcalServe,
    p: g('proteins'),
    c: g('carbohydrates'),
    f: g('fat'),
    fiber: g('fiber'),
    sugar: g('sugars'),
    salt: g('salt'),
    servingLabel: p.serving_size || null,
    servingGrams: serveGrams,
    kcalServe: kcalServe,
    kcal100,
    image: p.image_front_small_url || p.image_front_url || null,
    source: 'off',
  };
}
