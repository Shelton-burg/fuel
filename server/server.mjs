// FUEL — server: static PWA + label-parse API.
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseLabel, plateScan } from './label.mjs';
import { coachAdvice, coachChat, weeklyReview, nutritionGaps, recipeIdeas } from './coach.mjs';
import { mealPlan } from './mealplan.mjs';
import { readSync, writeSync, syncConfigured, readAuto, writeAuto, autoConfigured, deleteSlot } from './sync.mjs';
import { sendTelegram, telegramConfigured } from './notify.mjs';
import * as AUTH from './auth.mjs';
import * as AN from './analytics.mjs';
import * as DB from './db.mjs';
import { sendMail, resetEmail, verifyEmailMessage, deleteEmail, mailConfigured } from './mail.mjs';

AN.installShutdownHook();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4170;

// Local dev convenience: pull the key from known local env files when unset.
function loadKey(name = 'GEMINI_API_KEY') {
  if (process.env[name]) return process.env[name];
  const candidates = [
    'C:/Users/shelt/AppData/Local/hermes/.env',
    'C:/Users/shelt/tradedesk-replica/current/.env',
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const re = name === 'DEEPSEEK_API_KEY' ? /^DEEPSEEK_API_KEY=(.+)$/m : /^(?:GEMINI_API_KEY|GOOGLE_API_KEY)=(.+)$/m;
      const m = readFileSync(p, 'utf8').match(re);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return null;
}
const GEMINI_KEY = loadKey('GEMINI_API_KEY');
const DEEPSEEK_KEY = loadKey('DEEPSEEK_API_KEY');
const KEYS = { deepseek: DEEPSEEK_KEY, gemini: GEMINI_KEY };
const hasCoach = !!(DEEPSEEK_KEY || GEMINI_KEY);

export const app = express();
app.use(express.json({ limit: '6mb' }));
/* ── public legal pages + account-deletion link ──────────────────────────
   Registered BEFORE express.static so the /delete-account token check wins
   over the static `extensions: ['html']` lookup. */
const pageShell = (title, bodyHtml) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · FUEL</title>
<style>
  :root { --bg:#07090F; --panel:#10151F; --line:#232a3a; --text:#f5f5f7; --muted:#8b93a7; --amber:#FFA117; --red:#b3261e; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,'Segoe UI',Roboto,sans-serif; }
  .wrap { max-width:520px; margin:0 auto; padding:28px 20px 56px; }
  .brand { letter-spacing:.3em; color:var(--amber); font-weight:700; font-size:12px; margin-bottom:16px; }
  h1 { font-size:24px; line-height:1.3; margin:0 0 12px; }
  p { color:var(--muted); line-height:1.6; font-size:15px; margin:0 0 10px; }
  a { color:var(--amber); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px; margin-top:14px; }
  .btn { display:inline-block; background:var(--amber); color:#111; font-weight:700; border:0; border-radius:10px; padding:12px 22px; font-size:15px; text-decoration:none; cursor:pointer; }
</style></head><body><div class="wrap"><div class="brand">FUEL</div>${bodyHtml}</div></body></html>`;

app.get('/privacy', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'terms.html')));

app.get('/delete-account', (req, res) => {
  const tok = AUTH.readDeleteToken(req.query.token);
  if (!tok) {
    return res.status(400).send(pageShell('Link expired or invalid',
      `<h1>Link expired or invalid</h1><p>That deletion link is missing, expired or has already been used. To delete your account, open FUEL → Settings → Account → <b>Delete my account</b>, and we'll email you a fresh link.</p>`));
  }
  res.sendFile(join(__dirname, '..', 'public', 'delete-account.html'));
});

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

app.get('/api/health', (req, res) => res.json({
  ok: true, build: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
  ai: !!GEMINI_KEY, coach: hasCoach, coachProvider: DEEPSEEK_KEY ? 'deepseek' : GEMINI_KEY ? 'gemini' : null,
  sync: syncConfigured(), tg: telegramConfigured(), ab: autoConfigured(), auth: true,
  an: AN.analyticsConfigured(), owner: !!process.env.FUEL_OWNER_SETUP_CODE,
  db: DB.active(),
}));

app.post('/api/parse-label', AUTH.requireUser, AUTH.aiBudget('label', 80), async (req, res) => {
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
    if (e.message === 'ai_key_rejected') {
      return res.status(503).json({
        error: 'ai_key_rejected',
        message: "Label photos can't be read right now — scan the barcode or enter the numbers by hand, both still work.",
      });
    }
    if (e.message === 'ai_quota') {
      return res.status(503).json({
        error: 'ai_quota',
        message: "The AI label reader has hit its monthly AI allowance — nothing is wrong with your photo. Scan the barcode or enter the numbers by hand; both work and take seconds.",
      });
    }
    res.status(502).json({ error: 'label_parse_failed', message: 'Could not read the label. Try again with a clearer, flatter photo.' });
  }
});

app.post('/api/plate-scan', AUTH.requireUser, AUTH.aiBudget('plate', 40), async (req, res) => {
  try {
    if (!GEMINI_KEY) return res.status(503).json({ error: 'ai_not_configured', message: 'AI plate scanner not configured yet.' });
    const { image } = req.body || {};
    if (typeof image !== 'string') return res.status(400).json({ error: 'no_image' });
    const m = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) return res.status(400).json({ error: 'bad_image' });
    const mimeType = m[1];
    const base64 = m[2];
    if (base64.length > 8_000_000) return res.status(413).json({ error: 'too_large' });
    const result = await plateScan(base64, mimeType, GEMINI_KEY);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[plate-scan]', e.detail || e.message);
    if (e.message === 'ai_key_rejected') {
      return res.status(503).json({
        error: 'ai_key_rejected',
        message: "Plate scanning is offline right now — add the foods by hand or search instead, both still work.",
      });
    }
    if (e.message === 'ai_quota') {
      return res.status(503).json({
        error: 'ai_quota',
        message: "Plate scanning has hit its monthly AI allowance. Raise the cap at ai.studio/spend and it'll start working again — nothing is wrong with your photo.",
      });
    }
    res.status(502).json({ error: 'plate_scan_failed', message: 'Could not read the plate. Try again with a clearer, brighter photo.' });
  }
});

app.post('/api/coach', AUTH.requireUser, AUTH.aiBudget('coach', 40), async (req, res) => {
  try {
    if (!hasCoach) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'no_payload' });
    if (JSON.stringify(payload).length > 20000) return res.status(413).json({ error: 'too_large' });
    const result = await coachAdvice(payload, KEYS);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[coach]', e.detail || e.message);
    res.status(502).json({ error: 'coach_failed', message: 'The coach is unavailable right now — try again in a minute.' });
  }
});

app.post('/api/coach/chat', AUTH.requireUser, AUTH.aiBudget('chat', 120), async (req, res) => {
  try {
    if (!hasCoach) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const body = req.body || {};
    const ctx = body.context;
    if (!ctx || typeof ctx !== 'object') return res.status(400).json({ error: 'no_context' });
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'no_messages' });
    if (JSON.stringify(messages).length > 12000 || JSON.stringify(ctx).length > 20000) return res.status(413).json({ error: 'too_large' });
    const result = await coachChat(ctx, messages, KEYS);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[coach-chat]', e.detail || e.message);
    res.status(502).json({ error: 'coach_failed', message: 'The coach could not answer just now — try again.' });
  }
});

app.post('/api/nutrition-gaps', AUTH.requireUser, AUTH.aiBudget('gaps', 30), async (req, res) => {
  try {
    if (!hasCoach) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'no_payload' });
    if (JSON.stringify(payload).length > 20000) return res.status(413).json({ error: 'too_large' });
    const result = await nutritionGaps(payload, KEYS);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[nutrition-gaps]', e.detail || e.message);
    res.status(502).json({ error: 'gaps_failed', message: 'Could not analyse your last 7 days right now — try again.' });
  }
});

app.post('/api/recipes', AUTH.requireUser, AUTH.aiBudget('recipes', 30), async (req, res) => {
  try {
    if (!hasCoach) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'no_payload' });
    if (JSON.stringify(payload).length > 8000) return res.status(413).json({ error: 'too_large' });
    const result = await recipeIdeas(payload, KEYS);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[recipes]', e.detail || e.message);
    res.status(502).json({ error: 'recipes_failed', message: 'Could not dream up recipes right now — try again.' });
  }
});

app.post('/api/weekly', AUTH.requireUser, AUTH.aiBudget('weekly', 10), async (req, res) => {
  try {
    if (!hasCoach) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'no_payload' });
    if (JSON.stringify(payload).length > 20000) return res.status(413).json({ error: 'too_large' });
    const result = await weeklyReview(payload, KEYS);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[weekly]', e.detail || e.message);
    res.status(502).json({ error: 'weekly_failed', message: 'The check-in is unavailable right now — try again in a minute.' });
  }
});

/* ── privacy-safe analytics + owner dashboard ───────────────────────────
   The client sends allowlisted event NAMES only (feature usage, never content).
   The server aggregates {day, event, sha256(uid)} in memory and flushes to a
   private gist. The owner sign-in is separate from user accounts. */
app.post('/api/analytics/event', AUTH.requireUser, (req, res) => {
  const { ev, ts } = req.body || {};
  if (typeof ev !== 'string' || !AN.ALLOWED.has(ev)) return res.status(400).json({ error: 'bad_event' });
  try {
    AN.recordEvent(req.user.id, ev, ts);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: 'bad_event' });
  }
});

app.get('/owner', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'owner.html')));

const ownerLimiter = AUTH.rateLimit('owner-login', 10, 15 * 60 * 1000);
const ownerSetupLimiter = AUTH.rateLimit('owner-setup', 10, 15 * 60 * 1000);

app.post('/api/owner/setup', ownerSetupLimiter, async (req, res) => {
  try {
    const o = await AN.ownerSetup(req.body || {});
    res.setHeader('Set-Cookie', AN.ownerCookieHeader());
    res.json({ ok: true, owner: { email: o.email, createdAt: o.createdAt } });
  } catch (e) {
    const map = {
      bad_code: ['That setup code is wrong.', 403],
      already_setup: ['The owner account already exists — sign in instead.', 409],
      not_configured: ['Owner setup is not enabled on this server yet.', 503],
      weak_password: ['Use at least 8 characters.', 400],
      bad_email: ['That email doesn’t look right.', 400],
    };
    const [message, status] = map[e.message] || ['Could not set up the owner account.', 502];
    if (!map[e.message]) console.error('[owner-setup]', e.detail || e.message);
    res.status(status).json({ error: e.message || 'setup_failed', message });
  }
});

app.post('/api/owner/login', ownerLimiter, async (req, res) => {
  try {
    await AN.ownerLogin(req.body || {});
    res.setHeader('Set-Cookie', AN.ownerCookieHeader());
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: 'bad_login', message: 'Email or password is wrong.' });
  }
});

app.post('/api/owner/logout', (req, res) => {
  res.setHeader('Set-Cookie', AN.clearOwnerCookie());
  res.json({ ok: true });
});

app.get('/api/owner/me', (req, res) => {
  const t = AN.readOwnerToken(AUTH.parseCookies(req)[AN.OWNER_COOKIE]);
  if (!t) return res.status(401).json({ error: 'owner_required' });
  res.json({ ok: true, owner: { email: AN.ownerEmail() } });
});

app.get('/api/owner/stats', AN.requireOwner, async (req, res) => {
  try {
    const s = await AN.ownerStats();
    res.json({ ok: true, ...s });
  } catch (e) {
    console.error('[owner-stats]', e.detail || e.message);
    res.status(502).json({ error: 'stats_failed', message: 'Could not load the dashboard right now.' });
  }
});

/* ── accounts ───────────────────────────────────────────────────────── */
const authLimiter = AUTH.rateLimit('auth', 120, 10 * 60 * 1000);
const safeUser = (u) => ({ id: u.id, name: u.name, email: u.email, hasPin: !!u.pinHash, emailVerified: !!u.emailVerified });

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { user: u, recoveryCode, verifyCode } = await AUTH.createAccount(req.body || {});
    // verification email: a failure here must not lose the account
    let verifySent = false;
    try {
      const { text, html } = verifyEmailMessage({ code: verifyCode });
      const sent = await sendMail({ to: u.email, subject: 'Confirm your FUEL email', text, html });
      verifySent = !!sent.ok;
    } catch (e) { console.error('[verify-send]', e.detail || e.message); }
    res.setHeader('Set-Cookie', AUTH.cookieHeader(u.id, u.sessionVersion || 1));
    // the native shell (Capacitor) sends x-fuel-native: 1 and needs a bearer
    // token in the body — its WebView cannot reliably re-send the Lax cookie
    const native = String(req.headers['x-fuel-native'] || '') === '1';
    res.json({ ok: true, user: safeUser(u), recoveryCode, verifySent, ...(native ? { token: AUTH.makeApiToken(u.id, u.sessionVersion || 1) } : {}) });
  } catch (e) {
    const map = { bad_email: 'That email doesn’t look right.', weak_password: 'Use at least 8 characters.', bad_name: 'Add your name.', email_taken: 'An account with that email already exists — sign in instead.' };
    const code = map[e.message] ? (e.status || 400) : 502;
    if (code === 502) console.error('[auth-register]', e.detail || e.message);
    res.status(code).json({ error: e.message || 'register_failed', message: map[e.message] || 'Could not create the account right now.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const u = await AUTH.login(req.body || {});
    res.setHeader('Set-Cookie', AUTH.cookieHeader(u.id, u.sessionVersion || 1));
    const native = String(req.headers['x-fuel-native'] || '') === '1';
    res.json({ ok: true, user: safeUser(u), ...(native ? { token: AUTH.makeApiToken(u.id, u.sessionVersion || 1) } : {}) });
  } catch (e) {
    res.status(e.status || 401).json({ error: 'bad_login', message: 'Email or password is wrong.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', AUTH.clearCookie());
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  // bearer API token (native shell) OR the session cookie
  let u = await AUTH.userFromBearer(req);
  if (!u) {
    const tok = AUTH.readToken(AUTH.parseCookies(req)[AUTH.COOKIE]);
    if (!tok) return res.status(401).json({ error: 'auth_required' });
    u = await AUTH.byId(tok.uid);
    if (!u) return res.status(401).json({ error: 'auth_required' });
    if ((u.sessionVersion || 1) !== (tok.v || 1)) return res.status(401).json({ error: 'session_stale' });
  }
  res.json({ ok: true, user: safeUser(u) });
});

// Native shell: mint a 30-day HMAC API token. Requires the SESSION COOKIE —
// a bearer token cannot mint another token.
app.get('/api/auth/token', async (req, res) => {
  const u = await AUTH.cookieUser(req);
  if (!u) return res.status(401).json({ error: 'auth_required' });
  res.json({ ok: true, token: AUTH.makeApiToken(u.id, u.sessionVersion || 1), expiresIn: AUTH.API_TOKEN_MAX_AGE });
});

app.post('/api/auth/pin', AUTH.requireUser, async (req, res) => {
  try { await AUTH.setPin(req.user.id, req.body?.pin); res.json({ ok: true }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message, message: 'PIN must be 4 to 6 digits.' }); }
});

app.post('/api/auth/pin/check', AUTH.requireUser, AUTH.rateLimit('pin', 30, 10 * 60 * 1000), async (req, res) => {
  const ok = await AUTH.checkPin(req.user.id, req.body?.pin);
  res.status(ok ? 200 : 401).json({ ok });
});

/* ── password reset ─────────────────────────────────────────────────── */
const resetLimiter = AUTH.rateLimit('reset', 60, 15 * 60 * 1000);

app.post('/api/auth/forgot', resetLimiter, async (req, res) => {
  try {
    const hit = await AUTH.beginReset(req.body?.email);
    let mailed = false;
    if (hit) {
      const { text, html } = resetEmail({ code: hit.code, minutes: 30 });
      const r = await sendMail({ to: hit.user.email, subject: 'Your FUEL reset code', text, html });
      mailed = !!r.ok;
    }
    // same answer either way — never reveal whether an email is registered
    res.json({ ok: true, mailed, mailConfigured: mailConfigured() });
  } catch (e) {
    console.error('[forgot]', e.detail || e.message);
    res.status(502).json({ error: 'forgot_failed', message: 'Could not send a code right now — try again in a minute.' });
  }
});

app.post('/api/auth/reset', resetLimiter, async (req, res) => {
  const { token, email, code, recovery, password } = req.body || {};
  try {
    if (token) {
      await AUTH.resetWithToken(token, password);
    } else if (recovery) {
      await AUTH.resetWithRecovery(email, recovery, password);
    } else if (email && code) {
      const t = await AUTH.verifyResetCode(email, code);
      await AUTH.resetWithToken(t, password);
    } else {
      return res.status(400).json({ error: 'missing', message: 'Enter the code from your email, or your recovery code.' });
    }
    res.setHeader('Set-Cookie', AUTH.clearCookie());
    res.json({ ok: true });
  } catch (e) {
    const msg = e.message === 'weak_password' ? 'Use at least 8 characters.'
      : e.message === 'too_many' ? 'Too many tries — request a new code.'
      : e.message === 'bad_recovery' ? 'That recovery code does not match this account.'
      : 'That code is wrong or has expired.';
    res.status(e.status || 400).json({ error: e.message || 'reset_failed', message: msg });
  }
});

app.post('/api/auth/verify/send', AUTH.requireUser, AUTH.rateLimit('verify', 10, 15 * 60 * 1000), async (req, res) => {
  try {
    const v = await AUTH.beginVerify(req.user.id);
    const { text, html } = verifyEmailMessage({ code: v.code });
    const sent = await sendMail({ to: req.user.email, subject: 'Confirm your FUEL email', text, html });
    res.json({ ok: true, mailed: !!sent.ok, mailConfigured: mailConfigured() });
  } catch (e) {
    console.error('[verify-send]', e.detail || e.message);
    res.status(502).json({ error: 'verify_failed', message: 'Could not send the code right now.' });
  }
});

app.post('/api/auth/verify', AUTH.requireUser, AUTH.rateLimit('verify-check', 20, 15 * 60 * 1000), async (req, res) => {
  try {
    await AUTH.verifyEmail(req.user.id, req.body?.code);
    res.json({ ok: true, user: safeUser({ ...req.user, emailVerified: true }) });
  } catch (e) {
    const msg = e.message === 'too_many' ? 'Too many tries — send a new code.' : 'That code is wrong or has expired.';
    res.status(e.status || 400).json({ error: e.message || 'verify_failed', message: msg });
  }
});

app.post('/api/auth/password', AUTH.requireUser, async (req, res) => {
  try {
    const { current, next } = req.body || {};
    const out = await AUTH.changePassword(req.user.id, current, next);
    res.setHeader('Set-Cookie', AUTH.cookieHeader(req.user.id, out.sessionVersion));
    res.json({ ok: true });
  } catch (e) {
    const msg = e.message === 'bad_password' ? 'Your current password is wrong.'
      : e.message === 'weak_password' ? 'Use at least 8 characters.'
      : 'Could not change the password.';
    res.status(e.status || 400).json({ error: e.message || 'password_failed', message: msg });
  }
});

app.post('/api/auth/recovery', AUTH.requireUser, async (req, res) => {
  try {
    const rec = AUTH.newRecovery();
    await AUTH.setRecovery(req.user.id, rec.code);
    res.json({ ok: true, recoveryCode: rec.code });
  } catch (e) {
    res.status(502).json({ error: 'recovery_failed', message: 'Could not make a new recovery code.' });
  }
});

/* ── self-serve account deletion (Google Play requirement) ──────────────
   In-app: POST request → signed one-time token emailed via Resend.
   Email link: GET /delete-account?token=… → confirm page.
   Confirm: POST /api/auth/delete-account (must be signed in AND hold the
   token for the SAME account) → wipes the user, the sync blob, the automatic
   backup and every analytics row (gist entries too in fallback mode). */
const deleteReqLimiter = AUTH.rateLimit('delete-req', 5, 60 * 60 * 1000);
const deleteLimiter = AUTH.rateLimit('delete', 10, 60 * 60 * 1000);

app.post('/api/auth/delete-account/request', AUTH.requireUser, deleteReqLimiter, async (req, res) => {
  try {
    const token = AUTH.makeDeleteToken(req.user.id);
    const base = process.env.FUEL_BASE_URL || `https://${req.get('host')}`;
    const link = `${base}/delete-account?token=${encodeURIComponent(token)}`;
    const { text, html } = deleteEmail({ link });
    const sent = await sendMail({ to: req.user.email, subject: 'Delete your FUEL account', text, html });
    res.json({ ok: true, mailed: !!sent.ok, mailConfigured: mailConfigured() });
  } catch (e) {
    console.error('[delete-request]', e.detail || e.message);
    res.status(502).json({ error: 'delete_request_failed', message: 'Could not send the link right now — try again in a minute.' });
  }
});

app.post('/api/auth/delete-account', AUTH.requireUser, deleteLimiter, async (req, res) => {
  const tok = AUTH.readDeleteToken(req.body?.token);
  if (!tok || tok.uid !== req.user.id) {
    return res.status(400).json({ error: 'bad_token', message: 'That link is invalid or has expired — request a new one from Settings.' });
  }
  try {
    await AUTH.deleteAccount(req.user.id);      // user record (postgres row or gist entry)
    await deleteSlot(req.user.slot);            // client-encrypted sync blob + automatic backup
    await AN.purgeUserAnalytics(req.user.id);   // every analytics row for this account
    res.setHeader('Set-Cookie', AUTH.clearCookie());
    res.json({ ok: true, deleted: true });
  } catch (e) {
    console.error('[delete-account]', e.detail || e.message);
    res.status(502).json({ error: 'delete_failed', message: 'Could not delete the account right now — try again.' });
  }
});

const slotOf = (req) => req.user?.slot || null; // accounts only — a client-supplied slot is ignored

app.get('/api/sync/state', AUTH.requireUser, async (req, res) => {
  try {
    if (!syncConfigured()) return res.status(503).json({ error: 'sync_not_configured', message: 'Cloud backup is not configured on the server yet.' });
    const s = await readSync(slotOf(req));
    res.json({ ok: true, hasBlob: !!s.blob, updatedAt: s.updatedAt });
  } catch (e) { console.error('[sync-state]', e.detail || e.message); res.status(502).json({ error: 'sync_failed', message: 'Backup storage is unavailable right now.' }); }
});

app.get('/api/sync/blob', AUTH.requireUser, async (req, res) => {
  try {
    if (!syncConfigured()) return res.status(503).json({ error: 'sync_not_configured', message: 'Cloud backup is not configured on the server yet.' });
    const s = await readSync(slotOf(req));
    res.json({ ok: true, blob: s.blob, keyHash: s.keyHash, updatedAt: s.updatedAt });
  } catch (e) { console.error('[sync-blob]', e.detail || e.message); res.status(502).json({ error: 'sync_failed', message: 'Backup storage is unavailable right now.' }); }
});

app.post('/api/sync/blob', AUTH.requireUser, async (req, res) => {
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

/* Automatic safety backup — plain JSON over HTTPS, encrypted at rest in the private
   gist with a server-held key. Zero user setup; powers auto-restore after a phone
   storage wipe. (The user-key encrypted /api/sync above remains the privacy-max option.) */
app.get('/api/autobak', AUTH.requireUser, async (req, res) => {
  try {
    const s = await readAuto(slotOf(req));
    res.json({ ok: true, state: s ? s.state : null, updatedAt: s ? s.updatedAt : null });
  } catch (e) { console.error('[autobak-get]', e.detail || e.message); res.status(502).json({ error: 'autobak_failed', message: 'Backup storage is unavailable right now.' }); }
});

app.post('/api/autobak', AUTH.requireUser, async (req, res) => {
  try {
    const state = req.body && req.body.state;
    if (!state || typeof state !== 'object') return res.status(400).json({ error: 'no_state' });
    if (JSON.stringify(state).length > 3_000_000) return res.status(413).json({ error: 'too_large' });
    const out = await writeAuto(state, slotOf(req));
    res.json({ ok: true, updatedAt: out.updatedAt });
  } catch (e) { console.error('[autobak-put]', e.detail || e.message); res.status(502).json({ error: 'autobak_failed', message: 'Backup failed — try again in a minute.' }); }
});

app.post('/api/mealplan', AUTH.requireUser, AUTH.aiBudget('meal', 20), async (req, res) => {
  try {
    if (!hasCoach) return res.status(503).json({ error: 'ai_not_configured', message: 'AI coach not configured yet.' });
    const payload = req.body && req.body.payload;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'no_payload' });
    if (JSON.stringify(payload).length > 30000) return res.status(413).json({ error: 'too_large' });
    const result = await mealPlan(payload, KEYS);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[mealplan]', e.detail || e.message);
    res.status(502).json({ error: 'mealplan_failed', message: 'The meal planner is unavailable right now — try again in a minute.' });
  }
});

app.post('/api/notify', AUTH.requireUser, async (req, res) => {
  try {
    if (!telegramConfigured()) return res.status(503).json({ error: 'tg_not_configured', message: 'Telegram is not configured on the server.' });
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'no_text' });
    await sendTelegram(text.trim());
    res.json({ ok: true });
  } catch (e) { console.error('[notify]', e.detail || e.message); res.status(502).json({ error: 'notify_failed', message: 'Message could not be sent.' }); }
});

// run as a server only when executed directly (node server/server.mjs) —
// imported modules (unit tests) get the express app without binding a port
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(PORT, () => {
    console.log(`FUEL listening on :${PORT} | ai:${GEMINI_KEY ? 'on' : 'off'} | db:${DB.active() ? 'on' : 'off'}`);
  });
}
