// test-label.mjs — E2E: pull a real nutrition-panel photo from Open Food Facts, feed it to the label API.
const UA = 'FuelTracker/0.1 (shelton@allplumbandgas.com.au)';
(async () => {
  // health
  const h = await (await fetch('http://localhost:4170/api/health')).json();
  console.log('health:', JSON.stringify(h));

  // find a product with a nutrition-panel photo
  const s = await (await fetch('https://world.openfoodfacts.org/api/v2/search?search_terms=bread&fields=code,product_name,brands,image_nutrition_url,countries_tags&page_size=50&sort_by=popularity_key', { headers: { 'User-Agent': UA } })).json();
  let target = null;
  for (const p of s.products || []) {
    if (p.image_nutrition_url && (p.countries_tags || []).includes('en:australia')) { target = p; break; }
  }
  if (!target) { for (const p of s.products || []) { if (p.image_nutrition_url) { target = p; break; } } }
  if (!target) { console.log('no product with nutrition image found'); return; }
  console.log('test product:', target.product_name, '|', target.brands, '|', target.code);

  const imgRes = await fetch(target.image_nutrition_url, { headers: { 'User-Agent': UA } });
  const buf = Buffer.from(await imgRes.arrayBuffer());
  console.log('image:', imgRes.headers.get('content-type'), buf.length, 'bytes');
  const b64 = buf.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${b64}`;

  const r = await fetch('http://localhost:4170/api/parse-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });
  const j = await r.json();
  console.log('HTTP', r.status);
  console.log(JSON.stringify(j, null, 2).slice(0, 1600));
})();
