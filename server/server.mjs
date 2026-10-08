// FUEL — server: static PWA + label-parse API.
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLabel } from './label.mjs';
import { coachAdvice, weeklyReview } from './coach.mjs';
import { mealPlan } from './mealplan.mjs';
import { readSync, writeSync, syncConfigured } from './sync.mjs';
import { sendTelegram, telegramConfigured } from './notify.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4170;

// Local dev convenience: pull the key from known local env files when unset.
function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const candidates = [
    'C:/Users/shelt/AppData/Local/hermes/.env',
    'C:/Users/shelt/tradedesk-replica/current/.env',
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const m = readFileSync(p, 'utf8').match(/^(?:GEMINI_API_KEY|GOOGLE_API_KEY)=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return null;
}
const GEMINI_KEY = loadKey();

const app = express();
app.use(express.json({ limit: '6mb' }));
app.use(express.static(join(__dirname, '..', 'public'), { extensions: ['html'] }));


/* /api/search — OFF full-text search proxied server-side. The modern search backend
   (search.openfoodfacts.org) sends no Access-Control-Allow-Origin, so browsers can't
   call it directly; and the legacy /api/v2/search ranks by global popularity and answers
   plain word searches with near-random products. Proxy + small cache + legacy fallback. */
const searchCache = new Map();
const SEARCH_TTL = 10 * 60 * 1000;
const SEARCH_FIELDS = 'code,product_name,brands,nutriments,serving_size,serving_quantity,image_front_small_url,image_front_url';
const OFF_UA = 'FuelTracker/0.1 (shelton@allplumbandgas.com.au)';

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const limit = Math.min(40, Math.max(1, parseInt(req.query.limit, 10) || 24));
  if (q.length < 2) return res.status(400).json({ error: 'bad_query', message: 'Give me at least two characters.' });
  const key = q.toLowerCase() + '|' + limit;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.t < SEARCH_TTL) return res.json({ ok: true, hits: hit.hits, cached: true });
  try {
    let hits = [];
    try {
      const r = await fetch(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=${limit}&fields=${SEARCH_FIELDS}`, { headers: { 'User-Agent': OFF_UA }, signal: AbortSignal.timeout(9000) });
      if (r.ok) hits = ((await r.json()).hits || []);
    } catch (e1) { console.error('[search] sal:', e1.message); }
    if (!hits.length) {
      const r2 = await fetch(`https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(q)}&fields=${SEARCH_FIELDS}&page_size=${limit}&sort_by=popularity_key`, { headers: { 'User-Agent': OFF_UA }, signal: AbortSignal.timeout(9000) });
      if (r2.ok) hits = ((await r2.json()).products || []);
    }
    if (searchCache.size > 80) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(key, { t: Date.now(), hits });
    res.json({ ok: true, hits });
  } catch (e) {
    console.error('[search]', e.message);
    res.status(502).json({ error: 'search_failed', message: 'Search is unavailable right now.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, ai: !!GEMINI_KEY, coach: !!GEMINI_KEY, sync: syncConfigured(), tg: telegramConfigured() }));

app.post('/api/parse-label', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(503).json({ error: 'ai_not_configured', message: 'AI scanner not configured yet.' });
    const { image } = req.body || {};
    if (typeof image !== 'string') return res.status(400).json({ error: 'no_image' });
    const m = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) return res.status(400).json({ error: 'bad_image' });
    const mimeType = m[1];
    const base64 = m[2];
    if (base64.length > 8_000_000) return res.status(413).json({ error: 'too_large' });
    const result = await parseLabel(base64, mimeType, GEMINI_KEY);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[parse-label]', e.detail || e.message);
    res.status(502).json({ error: 'label_parse_failed', message: 'Could not read the label. Try again with a clearer, flatter photo.' });
  }
});

app.post('/api/coach', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'no_payload' });
    if (JSON.stringify(payload).length > 20000) return res.status(413).json({ error: 'too_large' });
    const result = await coachAdvice(payload, GEMINI_KEY);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[coach]', e.detail || e.message);
    res.status(502).json({ error: 'coach_failed', message: 'The coach is unavailable right now — try again in a minute.' });
  }
});

app.post('/api/weekly', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'no_payload' });
    if (JSON.stringify(payload).length > 20000) return res.status(413).json({ error: 'too_large' });
    const result = await weeklyReview(payload, GEMINI_KEY);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[weekly]', e.detail || e.message);
    res.status(502).json({ error: 'weekly_failed', message: 'The check-in is unavailable right now — try again in a minute.' });
  }
});

const slotOf = (req) => (typeof req.query.slot === 'string' && /^[a-z0-9-]{1,20}$/.test(req.query.slot) ? `prod-${req.query.slot}` : undefined);

app.get('/api/sync/state', async (req, res) => {
  try {
    if (!syncConfigured()) return res.status(503).json({ error: 'sync_not_configured', message: 'Cloud backup is not configured on the server yet.' });
    const s = await readSync(slotOf(req));
    res.json({ ok: true, hasBlob: !!s.blob, updatedAt: s.updatedAt });
  } catch (e) { console.error('[sync-state]', e.detail || e.message); res.status(502).json({ error: 'sync_failed', message: 'Backup storage is unavailable right now.' }); }
});

app.get('/api/sync/blob', async (req, res) => {
  try {
    if (!syncConfigured()) return res.status(503).json({ error: 'sync_not_configured', message: 'Cloud backup is not configured on the server yet.' });
    const s = await readSync(slotOf(req));
    res.json({ ok: true, blob: s.blob, keyHash: s.keyHash, updatedAt: s.updatedAt });
  } catch (e) { console.error('[sync-blob]', e.detail || e.message); res.status(502).json({ error: 'sync_failed', message: 'Backup storage is unavailable right now.' }); }
});

app.post('/api/sync/blob', async (req, res) => {
  try {
    if (!syncConfigured()) return res.status(503).json({ error: 'sync_not_configured', message: 'Cloud backup is not configured on the server yet.' });
    const { blob, keyHash } = req.body || {};
    if (typeof blob !== 'string' || !blob) return res.status(400).json({ error: 'no_blob' });
    if (blob.length > 2_500_000) return res.status(413).json({ error: 'too_large' });
    if (typeof keyHash !== 'string' || !/^[0-9a-f]{64}$/.test(keyHash)) return res.status(400).json({ error: 'bad_keyhash' });
    const out = await writeSync(blob, keyHash, slotOf(req));
    res.json({ ok: true, updatedAt: out.updatedAt });
  } catch (e) {
    if (e.message === 'key_mismatch') return res.status(403).json({ error: 'key_mismatch', message: 'This backup slot already holds a backup made with a different sync key.' });
    console.error('[sync-write]', e.detail || e.message);
    res.status(502).json({ error: 'sync_failed', message: 'Backup failed — try again in a minute.' });
  }
});

app.post('/api/mealplan', async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'no_payload' });
    if (JSON.stringify(payload).length > 30000) return res.status(413).json({ error: 'too_large' });
    const result = await mealPlan(payload, GEMINI_KEY);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[mealplan]', e.detail || e.message);
    res.status(502).json({ error: 'mealplan_failed', message: 'The meal planner is unavailable right now — try again in a minute.' });
  }
});

app.post('/api/notify', async (req, res) => {
  try {
    if (!telegramConfigured()) return res.status(503).json({ error: 'tg_not_configured', message: 'Telegram is not configured on the server.' });
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'no_text' });
    await sendTelegram(text.trim());
    res.json({ ok: true });
  } catch (e) { console.error('[notify]', e.detail || e.message); res.status(502).json({ error: 'notify_failed', message: 'Message could not be sent.' }); }
});

app.listen(PORT, () => {
  console.log(`FUEL listening on :${PORT} | ai:${GEMINI_KEY ? 'on' : 'off'}`);
});
