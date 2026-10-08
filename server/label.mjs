// FUEL — label parser: reads a nutrition-panel photo via Gemini vision.
// Returns ONLY what is printed on the label. Never estimates.

const MODEL_CANDIDATES = ['gemini-3.8-flash', 'gemini-2.5-flash'];

const PROMPT = `You are reading a photo of a packaged food's nutrition information panel (Australian or international packaging).
Extract ONLY what is actually printed on the panel. Never estimate, infer or invent values. If a value is not printed, return null for it.
Return JSON:
- found: true if a nutrition panel is clearly readable, false otherwise
- product_name: the product name from the packaging if visible (else null)
- brand: the brand if visible (else null)
- has_per_100g: whether a "per 100 g" column is present
- has_per_serve: whether a "per serve" column is present
- per_100g: { energy_kj, energy_kcal, protein_g, fat_g, saturated_fat_g, carbs_g, sugar_g, fibre_g, sodium_mg, salt_g }
- per_serve: { energy_kj, energy_kcal, protein_g, fat_g, saturated_fat_g, carbs_g, sugar_g, fibre_g, sodium_mg, salt_g }
- serve_size_text: the serving size description exactly as printed, e.g. "2 slices (78 g)" (else null)
- serve_grams: serving size in grams as a number if derivable from the printed serving text (else null)
- notes: one short line about anything ambiguous (e.g. "energy shown in kJ only", "per 100 g column only"), else null
Rules:
- energy_kj only if kilojoules are printed; energy_kcal only if kcal/Calories are printed. Do NOT convert between them.
- Nutrition panels list values like "Per 100 g" and "Per Serving" columns — map each column to the right object.
- Values are per the printed basis (unprepared/as sold). Ignore any "as prepared" columns unless that is all that exists.`;

const NUTRI_PROPS = {
  energy_kj: { type: 'number', nullable: true },
  energy_kcal: { type: 'number', nullable: true },
  protein_g: { type: 'number', nullable: true },
  fat_g: { type: 'number', nullable: true },
  saturated_fat_g: { type: 'number', nullable: true },
  carbs_g: { type: 'number', nullable: true },
  sugar_g: { type: 'number', nullable: true },
  fibre_g: { type: 'number', nullable: true },
  sodium_mg: { type: 'number', nullable: true },
  salt_g: { type: 'number', nullable: true },
};
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    product_name: { type: 'string', nullable: true },
    brand: { type: 'string', nullable: true },
    has_per_100g: { type: 'boolean' },
    has_per_serve: { type: 'boolean' },
    per_100g: { type: 'object', properties: structuredClone(NUTRI_PROPS) },
    per_serve: { type: 'object', properties: structuredClone(NUTRI_PROPS) },
    serve_size_text: { type: 'string', nullable: true },
    serve_grams: { type: 'number', nullable: true },
    notes: { type: 'string', nullable: true },
  },
  required: ['found'],
};

function cleanNutri(o) {
  const out = {};
  for (const k of ['energy_kj', 'energy_kcal', 'protein_g', 'fat_g', 'saturated_fat_g', 'carbs_g', 'sugar_g', 'fibre_g', 'sodium_mg', 'salt_g']) {
    const v = o && typeof o[k] === 'number' && isFinite(o[k]) ? Math.round(o[k] * 100) / 100 : null;
    out[k] = v;
  }
  return out;
}

export async function parseLabel(base64, mimeType, apiKey) {
  const body = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 1400,
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
      continue; // try next model on failure
    }
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    let parsed;
    try { parsed = JSON.parse(text); } catch { lastErr = 'bad_json'; continue; }
    return {
      found: !!parsed.found,
      product_name: parsed.product_name || null,
      brand: parsed.brand || null,
      has_per_100g: !!parsed.has_per_100g,
      has_per_serve: !!parsed.has_per_serve,
      per_100g: cleanNutri(parsed.per_100g),
      per_serve: cleanNutri(parsed.per_serve),
      serve_size_text: parsed.serve_size_text || null,
      serve_grams: typeof parsed.serve_grams === 'number' ? parsed.serve_grams : null,
      notes: parsed.notes || null,
    };
  }
  const err = new Error('label_parse_failed');
  err.detail = lastErr;
  throw err;
}
