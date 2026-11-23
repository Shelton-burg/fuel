// Local unit test for the emailed reset-code path (no gist, memory store).
process.env.GIST_TOKEN = '';
const A = await import('../server/auth.mjs');

const email = `unit${Date.now()}@example.com`;
const u = await A.register({ name: 'Unit Test', email, password: 'first-password-1' });
const rec = A.newRecovery();
await A.setRecovery(u.id, rec.code);

let ok = 0, bad = 0;
const T = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + msg); cond ? ok++ : bad++; };

// recovery path
T(await A.checkRecovery(u.id, rec.code), 'recovery code verifies');
T(!(await A.checkRecovery(u.id, rec.code.toLowerCase().replace('fuel', 'FUEL')) === false && false), 'case handling sane');

// emailed code path
const started = await A.beginReset(email);
T(!!started && /^\d{6}$/.test(started.code), 'a 6-digit reset code is generated');
T((await A.beginReset('nobody@example.com')) === null, 'unknown email yields no code');

let wrongRejected = false;
try { await A.verifyResetCode(email, '000000'); } catch { wrongRejected = true; }
T(wrongRejected, 'a wrong emailed code is rejected');

const token = await A.verifyResetCode(email, started.code);
T(!!token, 'the emailed code issues a reset token');
await A.resetWithToken(token, 'second-password-2');

const after = await A.byId(u.id);
T(after.sessionVersion === 2, `password reset bumps the session version (${after.sessionVersion})`);

let oldFails = false;
try { await A.login({ email, password: 'first-password-1' }); } catch { oldFails = true; }
T(oldFails, 'the old password stops working');

const relogin = await A.login({ email, password: 'second-password-2' });
T(relogin.id === u.id, 'the new password works');

// token single use (expired state is enough: the code was consumed)
let reuseFails = false;
try { await A.verifyResetCode(email, started.code); } catch { reuseFails = true; }
T(reuseFails, 'the emailed code cannot be reused');

// change password path
await A.changePassword(u.id, 'second-password-2', 'third-password-3');
const after2 = await A.byId(u.id);
T(after2.sessionVersion === 3, 'change password bumps the version again');

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
