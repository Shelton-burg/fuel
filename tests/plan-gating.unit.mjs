// FUEL v67 — free/paid entitlement unit tests (no gist, no db, in-memory stores).
// Spins the real express app on an ephemeral port and drives the HTTP surface:
//   - plan defaults to 'free' and is exposed on /api/auth/me
//   - free users get 403 plan_required on every gated AI route
//   - free-tier routes (me/pin/sync/autobak/nutrition-gaps/analytics) stay open
//   - unauthenticated (demo-style) requests 401 at requireUser, never 403
//   - owner grant/revoke persists (gist user record field) and flips the gate
//   - FUEL_PRO_EMAILS grants Pro without touching the stored plan
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const tag = `plan-gating-${Date.now()}`;
process.env.GIST_TOKEN = '';
process.env.FUEL_USERS_CACHE = path.join(os.tmpdir(), `fuel-users-${tag}.json`);
process.env.FUEL_ANALYTICS_CACHE = path.join(os.tmpdir(), `fuel-an-${tag}.json`);
process.env.FUEL_SESSION_SECRET = 'plan-gating-unit-secret';
process.env.FUEL_OWNER_SETUP_CODE = 'FUEL-OWNER-1234-5678';
delete process.env.FUEL_PRO_EMAILS;
delete process.env.DATABASE_URL;

const { app } = await import('../server/server.mjs');
const AUTH = await import('../server/auth.mjs');
const AN = await import('../server/analytics.mjs');

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let ok = 0, bad = 0;
const T = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + msg); c ? ok++ : bad++; };

const cookieOf = (res) => {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const s = (all || []).find((c) => c.startsWith('fuel_sess='));
  return s ? s.split(';')[0] : '';
};
async function req(method, p, { cookie = '', body } = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j, cookie: cookieOf(r) };
}

const GATED = ['/api/parse-label', '/api/plate-scan', '/api/coach', '/api/coach/chat', '/api/mealplan', '/api/recipes', '/api/weekly'];

/* ── register a free account ── */
const email = `plan${Date.now()}@qa.test`;
const reg = await req('POST', '/api/auth/register', { body: { name: 'Plan QA', email, password: 'password-1' } });
T(reg.status === 200 && reg.j.ok, 'register returns ok');
T(reg.j.user?.plan === 'free', 'a new account defaults to plan free on the auth payload');
const cookie = reg.cookie;

const me = await req('GET', '/api/auth/me', { cookie });
T(me.status === 200 && me.j.user?.plan === 'free', '/api/auth/me exposes plan: free');

/* ── gating matrix: free user, every Pro route → 403 plan_required ── */
let gateOk = 0;
for (const p of GATED) {
  const r = await req('POST', p, { cookie, body: {} });
  if (r.status === 403 && r.j.error === 'plan_required' && /FUEL Pro unlocks/.test(r.j.message || '')) gateOk++;
  else console.log(`  FAIL detail ${p}: ${r.status} ${JSON.stringify(r.j).slice(0, 120)}`);
}
T(gateOk === GATED.length, `free user gets 403 plan_required on all ${GATED.length} gated routes (${gateOk}/${GATED.length})`);

/* ── free tier stays open ── */
const pin = await req('POST', '/api/auth/pin', { cookie, body: { pin: '1234' } });
T(pin.status === 200, 'free user can set a PIN (200)');
const sync = await req('GET', '/api/sync/state', { cookie });
T(sync.status === 200 && sync.j.ok, 'free user passes requireUser on /api/sync/state (200, not 403)');
const gaps = await req('POST', '/api/nutrition-gaps', { cookie, body: {} });
T(gaps.status !== 403, 'nutrition-gaps stays open for free users (got ' + gaps.status + ', not 403)');
const ev = await req('POST', '/api/analytics/event', { cookie, body: { ev: 'app_open' } });
T(ev.status === 200, 'analytics events work for free users');
const ab = await req('GET', '/api/autobak', { cookie });
T(ab.status === 200 && ab.j.ok, 'autobak reads work for free users');

/* ── demo-style request: no session → 401, never 403 (demo unaffected) ── */
const anon = await req('POST', '/api/coach', { body: {} });
T(anon.status === 401 && anon.j.error === 'auth_required', 'unauthenticated (demo-style) request hits requireUser 401 — the gate never sees it');
const anonLabel = await req('POST', '/api/parse-label', { body: {} });
T(anonLabel.status === 401, 'demo-style label scan also 401s at the auth boundary (unchanged behaviour)');

/* ── owner grant/revoke ── */
const usersNoOwner = await req('GET', '/api/owner/users');
T(usersNoOwner.status === 401 && usersNoOwner.j.error === 'owner_required', '/api/owner/users requires the owner session');
const ownEmail = 'owner@qa.test';
await AN.ownerSetup({ code: 'FUEL-OWNER-1234-5678', email: ownEmail, password: 'owner-password-1' });
const ownerCookie = 'fuel_owner_sess=' + AN.makeOwnerToken();
const users = await req('GET', '/api/owner/users', { cookie: ownerCookie });
const meRow = (users.j.users || []).find((u) => u.email.includes('@qa.test') && u.email.startsWith('pl'));
T(users.status === 200 && !!meRow, 'owner can list users');
T(meRow && meRow.email.includes('•••') && !meRow.email.startsWith(email.slice(0, 3)) && !users.j.users.some((u) => u.email === email), 'owner list masks every email');
T(meRow && meRow.plan === 'free', 'owner list shows the stored plan (free)');

const grant = await req('POST', '/api/owner/set-plan', { cookie: ownerCookie, body: { uid: reg.j.user.id, plan: 'pro' } });
T(grant.status === 200 && grant.j.plan === 'pro', 'owner grants Pro');
const mePro = await req('GET', '/api/auth/me', { cookie });
T(mePro.status === 200 && mePro.j.user?.plan === 'pro', '/api/auth/me flips to plan pro after the grant');
const coachAsPro = await req('POST', '/api/coach', { cookie, body: {} });
T(coachAsPro.status !== 403, 'a Pro user passes the gate (got ' + coachAsPro.status + ', not 403)');
const stored = await AUTH.byId(reg.j.user.id);
T(stored.plan === 'pro', 'the grant persists on the stored user record (gist shape)');

const revoke = await req('POST', '/api/owner/set-plan', { cookie: ownerCookie, body: { uid: reg.j.user.id, plan: 'free' } });
T(revoke.status === 200 && revoke.j.plan === 'free', 'owner revokes Pro');
const coachAgain = await req('POST', '/api/coach', { cookie, body: {} });
T(coachAgain.status === 403, 'revoking Pro re-locks the gate');
const noUser = await req('POST', '/api/owner/set-plan', { cookie: ownerCookie, body: { uid: 'u_missing', plan: 'pro' } });
T(noUser.status === 404, 'granting a missing uid → 404');
const badPlan = await req('POST', '/api/owner/set-plan', { cookie: ownerCookie, body: { uid: reg.j.user.id, plan: 'diamond' } });
T(badPlan.status === 400, 'invalid plan value → 400');

/* ── FUEL_PRO_EMAILS auto-pro ── */
process.env.FUEL_PRO_EMAILS = `someoneelse@qa.test, ${email} , third@qa.test`;
const autoMe = await req('GET', '/api/auth/me', { cookie });
T(autoMe.status === 200 && autoMe.j.user?.plan === 'pro', 'FUEL_PRO_EMAILS (with spaces/case-insensitive) auto-grants Pro on /api/auth/me');
const autoCoach = await req('POST', '/api/coach', { cookie, body: {} });
T(autoCoach.status !== 403, 'FUEL_PRO_EMAILS opens the gated routes (got ' + autoCoach.status + ', not 403)');
const stillFreeStored = await AUTH.byId(reg.j.user.id);
T(stillFreeStored.plan === 'free', 'env auto-pro never rewrites the stored plan');
process.env.FUEL_PRO_EMAILS = '';
const backToFree = await req('POST', '/api/coach', { cookie, body: {} });
T(backToFree.status === 403, 'clearing FUEL_PRO_EMAILS re-locks the gate');

/* ── planOf sanity ── */
T(AUTH.planOf(null) === 'free' && AUTH.planOf(undefined) === 'free', 'planOf treats a missing user as free (defense in depth)');
T(AUTH.planOf({ email: 'x@y.z' }) === 'free' && AUTH.planOf({ email: 'x@y.z', plan: 'pro' }) === 'pro', 'planOf defaults a plan-less user record to free, honors stored pro');
process.env.FUEL_PRO_EMAILS = 'OWNER@QA.TEST';
T(AUTH.planOf({ email: 'owner@qa.test' }) === 'pro', 'planOf matches env emails case-insensitively');
delete process.env.FUEL_PRO_EMAILS;

console.log(`\n${ok} passed, ${bad} failed`);
server.close();
process.exit(bad ? 1 : 0);
