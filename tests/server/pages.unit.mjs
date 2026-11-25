// Unit test for the public legal + deletion routes: /privacy and /terms
// serve 200 with the required content; /delete-account enforces the token;
// /api/health reports db:false without DATABASE_URL and boots cleanly.
import os from 'node:os';
import path from 'node:path';

const tag = `pages-${Date.now()}`;
process.env.GIST_TOKEN = '';
process.env.FUEL_USERS_CACHE = path.join(os.tmpdir(), `fuel-users-${tag}.json`);
process.env.FUEL_ANALYTICS_CACHE = path.join(os.tmpdir(), `fuel-an-${tag}.json`);
process.env.FUEL_OWNER_SETUP_CODE = '';
process.env.FUEL_SESSION_SECRET = 'pages-unit-secret';
delete process.env.DATABASE_URL;

const { app } = await import('../../server/server.mjs');
const AUTH = await import('../../server/auth.mjs');

const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let ok = 0, bad = 0;
const T = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + msg); c ? ok++ : bad++; };

/* ── privacy policy ── */
const r1 = await fetch(base + '/privacy');
const p1 = await r1.text();
T(r1.status === 200, '/privacy serves 200');
T(p1.includes('Shelton Allenberg') && p1.includes('shelton@allplumbandgas.com.au'), 'privacy names the operator + contact');
T(p1.includes('Google Gemini') && p1.includes('DeepSeek'), 'privacy states the AI providers plainly');
T(p1.includes('Privacy Act') && p1.includes('No ads'), 'privacy covers Australian law + no-ads promise');

/* ── terms ── */
const r2 = await fetch(base + '/terms');
const p2 = await r2.text();
T(r2.status === 200, '/terms serves 200');
T(/not medical advice/i.test(p2), 'terms carry the no-medical-advice disclaimer');
T(/liability/i.test(p2) && /subscription/i.test(p2), 'terms cover subscriptions + liability limits');

/* ── deletion link guards ── */
const r3 = await fetch(base + '/delete-account');
T(r3.status === 400, 'GET /delete-account without a token → 400');
const r4 = await fetch(base + '/delete-account?token=garbage');
T(r4.status === 400, 'GET /delete-account with a garbage token → 400');
const t = AUTH.makeDeleteToken('u_pages_test');
const r5 = await fetch(base + '/delete-account?token=' + encodeURIComponent(t));
const p5 = await r5.text();
T(r5.status === 200 && /sorry to see you go/i.test(p5), 'GET /delete-account with a valid token serves the confirm page');
T(/cannot be undone/i.test(p5) || /permanent/i.test(p5), 'confirm page carries the irreversible-data warning');

/* ── deletion endpoint auth ── */
const r7 = await fetch(base + '/api/auth/delete-account', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'x' }),
});
T(r7.status === 401, 'POST /api/auth/delete-account unauthenticated → 401');

/* ── health: db flag false, boot never touched a database ── */
const r6 = await fetch(base + '/api/health');
const h = await r6.json();
T(h.ok === true && h.db === false, '/api/health boots clean without DATABASE_URL and reports db:false');

srv.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
