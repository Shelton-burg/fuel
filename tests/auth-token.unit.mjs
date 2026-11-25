// FUEL v63 — bearer API tokens for the native shell (memory store, no gist).
// Proves: cookie auth unchanged; bearer accepted on /api/auth/me + requireUser
// routes; tampered / expired / wrong-family / stale tokens rejected; minting
// requires the session cookie.
process.env.GIST_TOKEN = '';
import http from 'node:http';
const { app } = await import('../server/server.mjs');
const A = await import('../server/auth.mjs');

const email = `api${Date.now()}@example.com`;
const password = 'token-test-pass-1';

const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let ok = 0, bad = 0;
const T = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + msg); cond ? ok++ : bad++; };

async function call(method, path, { headers = {}, body } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  const setCookie = (r.headers.getSetCookie?.() || [])[0] || '';
  return { status: r.status, j, cookie: setCookie };
}

// --- register (plain web): cookie set, NO token in the body ---------------
const reg = await call('POST', '/api/auth/register', { body: { name: 'API Test', email, password } });
T(reg.status === 200 && !!reg.j.user, 'register succeeds');
T(!reg.j.token, 'plain web register response carries no token');
const cookie = reg.cookie;
T(cookie.includes('fuel_sess='), 'session cookie set');

// --- login with the native header returns a signed token -------------------
const login = await call('POST', '/api/auth/login', { headers: { 'x-fuel-native': '1' }, body: { email, password } });
T(login.status === 200 && typeof login.j.token === 'string', 'native login returns an API token');
const token = login.j.token;
T(token.split('.').length === 2, 'token is body.signature shaped');

// --- minting requires the cookie session -----------------------------------
const noSess = await call('GET', '/api/auth/token');
T(noSess.status === 401, 'minting without a session is rejected');
const mint = await call('GET', '/api/auth/token', { headers: { Cookie: cookie.split(';')[0] } });
T(mint.status === 200 && typeof mint.j.token === 'string', 'minting with the cookie session returns a token');
T(typeof mint.j.expiresIn === 'number', 'mint reports the token lifetime');

// --- bearer accepted on /api/auth/me ---------------------------------------
const me1 = await call('GET', '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
T(me1.status === 200 && me1.j.user.email === email, 'bearer token authenticates /api/auth/me');

// --- bearer accepted on a requireUser route ---------------------------------
const anon = await call('POST', '/api/analytics/event', { body: { ev: 'app_open' } });
T(anon.status === 401, 'requireUser route rejects without auth');
const an = await call('POST', '/api/analytics/event', { headers: { Authorization: 'Bearer ' + token }, body: { ev: 'not_a_real_event' } });
T(an.status === 400, 'requireUser route accepts the bearer (400 = allowlist check past auth)');

// --- tampered / bad-signature tokens rejected --------------------------------
const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
const tam = await call('GET', '/api/auth/me', { headers: { Authorization: 'Bearer ' + tampered } });
T(tam.status === 401, 'tampered bearer is rejected');
const badsig = token.split('.')[0] + '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const bs = await call('GET', '/api/auth/me', { headers: { Authorization: 'Bearer ' + badsig } });
T(bs.status === 401, 'wrong-signature bearer is rejected');

// --- the session-cookie token cannot double as an API token ------------------
const sessTok = cookie.split(';')[0].replace('fuel_sess=', '');
const sc = await call('GET', '/api/auth/me', { headers: { Authorization: 'Bearer ' + sessTok } });
T(sc.status === 401, 'a session-cookie token is NOT accepted as a bearer (separate token families)');

// --- expired bearer rejected ---------------------------------------------------
const expired = A.makeApiToken(reg.j.user.id, 1, -1000);
const ex = await call('GET', '/api/auth/me', { headers: { Authorization: 'Bearer ' + expired } });
T(ex.status === 401, 'an expired bearer is rejected');

// --- cookie auth still works ----------------------------------------------------
const ck = await call('GET', '/api/auth/me', { headers: { Cookie: cookie.split(';')[0] } });
T(ck.status === 200, 'cookie auth still works');

// --- password change invalidates API tokens + blocks minting ---------------------
await A.changePassword(reg.j.user.id, password, 'token-test-pass-2');
const afterReset = await call('GET', '/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
T(afterReset.status === 401, 'a password change invalidates existing API tokens');
const mintStale = await call('GET', '/api/auth/token', { headers: { Cookie: cookie.split(';')[0] } });
T(mintStale.status === 401, 'a stale session cookie cannot mint');

server.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
