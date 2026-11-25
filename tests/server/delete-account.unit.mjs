// Unit test for the account-deletion flow (gist/memory fallback mode —
// GIST_TOKEN unset): the signed one-time delete token, its guards, and the
// full wipe (user + sync blob + autobak + analytics) being idempotent.
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const tag = `del-unit-${Date.now()}`;
process.env.GIST_TOKEN = '';
process.env.FUEL_USERS_CACHE = path.join(os.tmpdir(), `fuel-users-${tag}.json`);
process.env.FUEL_ANALYTICS_CACHE = path.join(os.tmpdir(), `fuel-an-${tag}.json`);
process.env.FUEL_OWNER_SETUP_CODE = '';
process.env.FUEL_SESSION_SECRET = 'delete-unit-secret';

const AUTH = await import('../../server/auth.mjs');
const SYNC = await import('../../server/sync.mjs');
const AN = await import('../../server/analytics.mjs');

let ok = 0, bad = 0;
const T = (c, msg) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + msg); c ? ok++ : bad++; };

/* ── token flow ── */
const { user } = await AUTH.createAccount({ name: 'QA', email: 'del@fuel.test', password: 'password-1' });
const tok = AUTH.makeDeleteToken(user.id);
const p = AUTH.readDeleteToken(tok);
T(p && p.uid === user.id && p.purpose === 'delete' && p.exp > Date.now(), 'delete token signs and reads back (uid + purpose + expiry)');
T(AUTH.readDeleteToken(tok + 'x') === null, 'tampered delete token rejected');
T(AUTH.readDeleteToken('garbage') === null, 'garbage delete token rejected');
T(AUTH.readDeleteToken('') === null && AUTH.readDeleteToken(undefined) === null, 'missing token rejected');
T(AUTH.readDeleteToken(AUTH.makeDeleteToken(user.id, -1000)) === null, 'expired delete token rejected');

const hit = await AUTH.beginReset(user.email);
const resetTok = await AUTH.verifyResetCode(user.email, hit.code);
T(AUTH.readDeleteToken(resetTok) === null, 'a password-reset token is NOT a delete token (purpose guard)');

const other = AUTH.makeDeleteToken('some-other-uid');
T(AUTH.readDeleteToken(other).uid !== user.id, 'token carries the target uid (route rejects uid mismatch)');

/* ── full wipe in fallback mode ── */
await SYNC.writeSync('CIPHERTEXT-BLOB', 'k'.repeat(64), user.slot);
await SYNC.writeAuto({ logs: { '2026-11-26': { meals: {} } } }, user.slot);
AN.recordEvent(user.id, 'log_food');
AN.recordEvent(user.id, 'tab_today');
AN.recordEvent('other-user', 'log_food');

await AUTH.deleteAccount(user.id);
await SYNC.deleteSlot(user.slot);
await AN.purgeUserAnalytics(user.id);

T((await AUTH.byId(user.id)) === null, 'user removed from the account store');
T((await SYNC.readSync(user.slot)).blob === null, 'client-encrypted sync blob wiped');
T((await SYNC.readAuto(user.slot)) === null, 'automatic safety backup wiped');
const h = createHash('sha256').update(user.id).digest('hex');
const days = AN.__test.peekDays();
const gone = Object.values(days).every((evs) => Object.values(evs).every((cell) => !(cell.u || []).includes(h)));
T(gone, 'analytics purged for the deleted user (hash removed from every cell)');
const still = Object.values(days).some((evs) => Object.values(evs).some((cell) => (cell.u || []).includes(createHash('sha256').update('other-user').digest('hex'))));
T(still, "other users' analytics rows untouched");

/* ── idempotency ── */
const again = await AUTH.deleteAccount(user.id);
T(again === true, 'deleting an already-deleted account is a no-op (idempotent)');
const again2 = await SYNC.deleteSlot(user.slot);
T(again2 === true, 'deleting an already-deleted slot is a no-op (idempotent)');

/* ── token dies with the account: readDeleteToken still parses, but the
     route's requireUser 401s because byId returns null ── */
const late = AUTH.readDeleteToken(tok);
T(late && late.uid === user.id, 'an old token still parses — account absence (requireUser) is what blocks it');
T((await AUTH.byId(user.id)) === null, '…and the account itself is gone, so requireUser rejects it');

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
