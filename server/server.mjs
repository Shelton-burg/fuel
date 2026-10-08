// FUEL — server: static PWA + label-parse API.
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLabel } from './label.mjs';

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

app.get('/api/health', (req, res) => res.json({ ok: true, ai: !!GEMINI_KEY }));

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

app.listen(PORT, () => {
  console.log(`FUEL listening on :${PORT} | ai:${GEMINI_KEY ? 'on' : 'off'}`);
});
