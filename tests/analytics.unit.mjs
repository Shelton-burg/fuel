// Unit test for privacy-safe analytics: allowlist, aggregation maths, app_open
// dedup, gist-merge maths, owner auth (setup code, scrypt login, HMAC token).
// No gist — memory store (GIST_TOKEN unset), isolated cache files.
// Client-side demo rejection (?demo=1 never fires) is covered by the
// browserclaw playwright suite fuel-analytics-check.mjs.
import os from 'node:os';
import path from 'node:path';

const tag = `analytics-unit-${Date.now()}`;
process.env.GIST_TOKEN = '';
process.env.FUEL_ANALYTICS_CACHE = path.join(os.tmpdir(), `fuel-an-${tag}.json`);
process.env.FUEL_USERS_CACHE = path.join(os.tmpdir(), `fuel-users-${tag}.json`);
process.env.FUEL_OWNER_SETUP_CODE = 'FUEL-OWNER-TEST-1234';

const AN = await import('../server/analytics.mjs');

let ok = 0, bad = 0;
const T = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + msg); cond ? ok++ : bad++; };

/* ── allowlist ── */
T(AN.ALLOWED.has('app_open') && AN.ALLOWED.has('log_food') && AN.ALLOWED.has('pin_used'), 'known events are allowed');
T(!AN.ALLOWED.has('password') && !AN.ALLOWED.has('food_name') && !AN.ALLOWED.has('kcal'), 'content-ish names are NOT allowed');
let rejected = false;
try { AN.recordEvent('u_abc', 'weight'); } catch (e) { rejected = e.status === 400; }
T(rejected, 'unknown event is rejected (400)');

/* ── aggregation maths ── */
const t0 = Date.now();
AN.recordEvent('u_1', 'log_food', t0);
AN.recordEvent('u_1', 'log_food', t0 + 1000);
AN.recordEvent('u_2', 'log_food', t0 + 2000);
AN.recordEvent('u_1', 'tab_today', t0 + 3000);
AN.recordEvent('u_3', 'log_food', t0 + 4000);

const stats = await AN.ownerStats();
T(stats.eventsToday === 5, `5 events land in today's bucket (got ${stats.eventsToday})`);
T(stats.totals.active7d === 3, `3 distinct users counted (got ${stats.totals.active7d})`);
const lf = stats.features.find((f) => f.ev === 'log_food');
T(lf && lf.count === 4, `log_food count = 4 across users (got ${lf?.count})`);
const tt = stats.features.find((f) => f.ev === 'tab_today');
T(tt && tt.count === 1, `tab_today count = 1 (got ${tt?.count})`);

/* ── app_open dedup (per user, 60 min) ── */
AN.recordEvent('u_1', 'app_open', t0 + 5000);
AN.recordEvent('u_1', 'app_open', t0 + 6000);   // within 60 min → deduped
AN.recordEvent('u_1', 'app_open', t0 + 61 * 60 * 1000); // hour later → counts
AN.recordEvent('u_2', 'app_open', t0 + 7000);
const opens = await AN.ownerStats({ fresh: true });
const ao = opens.features.find((f) => f.ev === 'app_open');
T(ao && ao.count === 3, `app_open deduped to 3 (2 real for u1 + 1 for u2, got ${ao?.count})`);

/* ── gist merge maths (pure) ── */
const merged = AN.__test.mergeDays({ '2026-01-01': { log_food: { c: 2, u: ['h1'] } } }, { '2026-01-01': { log_food: { c: 3, u: ['h1', 'h2'] } }, '2026-01-02': { app_open: { c: 1, u: ['h2'] } } });
T(merged['2026-01-01'].log_food.c === 5, 'merge sums counts (2+3=5)');
T(merged['2026-01-01'].log_food.u.length === 2, 'merge unions distinct users');
T(merged['2026-01-02'].app_open.c === 1, 'merge keeps new days');

/* ── owner setup code ── */
let wrongCode = false;
try { await AN.ownerSetup({ code: 'WRONG-CODE-0000', email: 'owner@fuel.test', password: 'password-1' }); } catch (e) { wrongCode = e.status === 403; }
T(wrongCode, 'wrong setup code rejected (403)');

const owner = await AN.ownerSetup({ code: 'fuel-owner-test-1234', email: 'owner@fuel.test', password: 'password-1' });
T(owner && owner.email === 'owner@fuel.test', 'correct setup code creates the owner account');
T(!('password' in owner), 'owner record carries a scrypt hash, never the password');
const stored = JSON.parse(JSON.stringify(owner));
T(typeof stored.hash === 'string' && typeof stored.salt === 'string' && !('password' in stored), 'no plaintext password stored');

let doubleSetup = false;
try { await AN.ownerSetup({ code: 'FUEL-OWNER-TEST-1234', email: 'other@fuel.test', password: 'password-2' }); } catch (e) { doubleSetup = e.status === 409; }
T(doubleSetup, 'second setup attempt rejected (already_setup 409)');

/* ── owner login ── */
let badPw = false;
try { await AN.ownerLogin({ email: 'owner@fuel.test', password: 'nope-nope-nope' }); } catch (e) { badPw = e.status === 401; }
T(badPw, 'wrong owner password rejected (401)');
let badEmail = false;
try { await AN.ownerLogin({ email: 'intruder@fuel.test', password: 'password-1' }); } catch (e) { badEmail = e.status === 401; }
T(badEmail, 'unknown owner email rejected (401)');
const okLogin = await AN.ownerLogin({ email: 'owner@fuel.test', password: 'password-1' });
T(okLogin && okLogin.email === 'owner@fuel.test', 'correct owner credentials accepted');

/* ── owner session token ── */
const tok = AN.makeOwnerToken();
const payload = AN.readOwnerToken(tok);
T(!!payload && payload.o === 1, 'owner token signs and verifies');
T(AN.readOwnerToken(tok + 'x') === null, 'tampered owner token rejected');
T(AN.readOwnerToken('garbage') === null, 'garbage token rejected');

/* ── stats shape for the dashboard ── */
T(Array.isArray(stats.signups) && stats.signups.length === 8, 'signups trend has 8 weeks');
T(Array.isArray(stats.heat) && stats.heat.length > 70 && stats.heat.length <= 84, `heat map covers the last 12 weeks (${stats.heat.length} cells)`);
T(stats.ai.label && stats.ai.label.cap === 80 && stats.ai.coach.cap === 40 && stats.ai.chat.cap === 120 && stats.ai.weekly.cap === 10 && stats.ai.meal.cap === 20, 'AI budget caps match the server budgets');
T(typeof stats.disclaimer === 'string' && /never personal data/i.test(stats.disclaimer), 'disclaimer present');
T(Array.isArray(stats.features) && stats.features[0].count >= stats.features[stats.features.length - 1].count, 'features ranked by count desc');

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
