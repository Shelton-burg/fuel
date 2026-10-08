// test-label2.mjs — find products with REAL nutrition-panel photos and run them through the API until one parses.
const UA = 'FuelTracker/0.1 (shelton@allplumbandgas.com.au)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryProduct(p) {
  const imgRes = await fetch(p.image_nutrition_url, { headers: { 'User-Agent': UA } });
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const r = await fetch('http://localhost:4170/api/parse-label', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: 'data:image/jpeg;base64,' + buf.toString('base64') }),
  });
  const j = await r.json();
  const res = j.result;
  const ok = r.status === 200 && res && res.found;
  console.log(`\n── ${p.product_name} (${p.brands || '?'}) [${buf.length} B] → ${ok ? '✅ FOUND' : '✗ ' + (res?.notes || r.status)}`);
  if (ok) {
    console.log('   per_100g:', JSON.stringify(res.per_100g));
    console.log('   per_serve:', JSON.stringify(res.per_serve));
    console.log('   serve:', res.serve_size_text, '| notes:', res.notes);
  }
  return ok;
}

(async () => {
  const terms = ['bread', 'weet bix', 'greek yoghurt', 'milk'];
  for (const t of terms) {
    const s = await (await fetch(`https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(t)}&fields=code,product_name,brands,image_nutrition_url&page_size=40&sort_by=popularity_key`, { headers: { 'User-Agent': UA } })).json().catch(() => null);
    const list = (s?.products || []).filter((p) => p.image_nutrition_url).slice(0, 4);
    console.log(`\n══ search "${t}": ${list.length} candidates`);
    for (const p of list) {
      try { if (await tryProduct(p)) { console.log('\nSUCCESS — stopping.'); return; } } catch (e) { console.log('  img err', e.message); }
      await sleep(1200);
    }
    await sleep(2500); // be kind between searches
  }
  console.log('\nNo clean panel found in this pass.');
})();
