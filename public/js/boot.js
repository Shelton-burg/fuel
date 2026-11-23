// FUEL — boot gate. Loads the app only after the session (and PIN) checks out.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const resetToken = params.get('reset');
if (demo) { window.__fuelDemo = true; start(); }
else if (resetToken) { document.getElementById('app')?.setAttribute('hidden', ''); resetLinkScreen(resetToken); }
else gate();

function start() {
  const root = $('#auth-gate');
  if (root) root.remove();
  document.getElementById('app')?.removeAttribute('hidden');
  if (!window.__fuelTrainLoaded) { window.__fuelTrainLoaded = true; import('./train.js'); }
  import('./app.js').catch((e) => console.error('[boot] app failed to start:', e && (e.stack || e.message || e)));
}

function screen(html) {
  let root = $('#auth-gate');
  if (!root) {
    root = document.createElement('div');
    root.id = 'auth-gate';
    document.body.appendChild(root);
  }
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card">${html}</div></div>`;
  document.getElementById('app')?.setAttribute('hidden', '');
  return root;
}

async function gate() {
  document.getElementById('app')?.setAttribute('hidden', '');
  let user = null;
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (r.ok) user = (await r.json()).user;
  } catch {}
  if (!user) return loginScreen();
  if (!user.hasPin) {
    window.__fuelUser = user;
    if (!user.emailVerified) return verifyScreen(user, false);
    return start();
  }
  return pinScreen(user);
}

function loginScreen(msg) {
  const root = screen(`
    <div class="auth-logo">FUEL</div>
    <h1 class="auth-h1">Your food, your numbers.</h1>
    <p class="auth-sub">Sign in to open your log. Nothing is shown until you do.</p>
    <div class="auth-tabs"><button class="auth-tab on" data-tab="login" type="button">Sign in</button><button class="auth-tab" data-tab="register" type="button">Create account</button></div>
    <form id="auth-form" class="auth-form" autocomplete="on">
      <label class="field auth-name" hidden><span>Name</span><input id="au-name" type="text" maxlength="40" autocomplete="name"></label>
      <label class="field"><span>Email</span><input id="au-email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input id="au-pass" type="password" minlength="8" autocomplete="current-password" required></label>
      <p class="auth-err" id="au-err" hidden></p>
      <button class="btn primary wide" type="submit" id="au-go">Sign in</button>
    </form>
    <button class="link-btn auth-forgot" id="forgot" type="button">Forgot password?</button>
    <p class="auth-fine">${msg ? esc(msg) : 'Your data is stored against your account — nobody else can read it, even with the link.'}</p>
  `);
  let mode = 'login';
  const form = $('#auth-form', root), err = $('#au-err', root), nameField = $('.auth-name', root), go = $('#au-go', root);
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    nameField.hidden = mode !== 'register';
    $('input', nameField).required = mode === 'register';
    go.textContent = mode === 'register' ? 'Create my account' : 'Sign in';
    $('#au-pass').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    err.hidden = true;
  }));
  $('#forgot', root).addEventListener('click', () => forgotScreen());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true; err.hidden = true;
    const body = { email: $('#au-email').value.trim(), password: $('#au-pass').value, name: $('#au-name').value.trim() };
    try {
      const r = await fetch(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Could not sign in.');
      window.__fuelUser = j.user;
      if (j.recoveryCode) return recoveryScreen(j.user, j.recoveryCode);
      if (j.user.hasPin) return pinScreen(j.user);
      return start();
    } catch (ex) {
      err.textContent = String(ex.message || ex);
      err.hidden = false;
      go.disabled = false;
    }
  });
}

function recoveryScreen(user, code) {
  const root = screen(`
    <div class="auth-logo">FUEL</div>
    <h1 class="auth-h1">Save your recovery code.</h1>
    <p class="auth-sub">It is the way back in if you forget your password and can't get the email. <b>It is shown once.</b></p>
    <div class="recovery-code" id="rec-code">${esc(code)}</div>
    <button class="btn ghost wide" id="rec-copy" type="button">Copy code</button>
    <p class="auth-warn">Keep it secret — anyone with this code and your email can get into your account.</p>
    <label class="rec-check"><input type="checkbox" id="rec-ok"> I've saved it somewhere safe</label>
    <button class="btn primary wide" id="rec-done" type="button" disabled>Open FUEL</button>
  `);
  $('#rec-ok', root).addEventListener('change', (e) => { $('#rec-done').disabled = !e.target.checked; });
  $('#rec-copy', root).addEventListener('click', () => {
    navigator.clipboard?.writeText(code).then(() => { $('#rec-copy').textContent = 'Copied ✓'; }).catch(() => {});
  });
  $('#rec-done', root).addEventListener('click', () => {
    window.__fuelUser = user;
    if (user.emailVerified) return start();
    return verifyScreen(user, true);
  });
}

function verifyScreen(user, justSent) {
  const root = screen(`
    <div class="auth-logo">FUEL</div>
    <h1 class="auth-h1">Confirm your email.</h1>
    <p class="auth-sub">${justSent ? `We sent a 6-digit code to <b>${esc(user.email)}</b>.` : `Enter the 6-digit code sent to <b>${esc(user.email)}</b>.`}</p>
    <form id="vf-form" class="auth-form">
      <label class="field"><span>Code</span><input id="vf-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456" required></label>
      <p class="auth-msg" id="vf-msg" hidden></p>
      <p class="auth-err" id="vf-err" hidden></p>
      <button class="btn primary wide" type="submit" id="vf-go">Verify email</button>
    </form>
    <button class="btn ghost wide auth-spaced" id="vf-resend" type="button">Send a new code</button>
    <button class="link-btn auth-forgot" id="vf-later" type="button">I'll do this later</button>
  `);
  const msg = $('#vf-msg', root), err = $('#vf-err', root);
  $('#vf-later', root).addEventListener('click', () => { window.__fuelUser = user; start(); });
  $('#vf-resend', root).addEventListener('click', async () => {
    $('#vf-resend').disabled = true;
    try {
      const r = await fetch('/api/auth/verify/send', { method: 'POST', credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      msg.textContent = j.mailed ? 'New code sent — check your inbox.' : 'Could not send it right now — try again in a minute.';
      msg.hidden = false;
    } catch { msg.textContent = 'Could not send it right now.'; msg.hidden = false; }
    $('#vf-resend').disabled = false;
  });
  $('#vf-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    $('#vf-go').disabled = true;
    try {
      const r = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ code: $('#vf-code').value.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Could not verify that code.');
      user.emailVerified = true;
      window.__fuelUser = user;
      start();
    } catch (ex) {
      err.textContent = String(ex.message || ex);
      err.hidden = false;
      $('#vf-go').disabled = false;
    }
  });
}

function forgotScreen(msg) {
  const root = screen(`
    <div class="auth-logo">FUEL</div>
    <h1 class="auth-h1">Reset your password.</h1>
    <p class="auth-sub">Use the 6-digit code we email you, or the recovery code you saved when you signed up.</p>
    <form id="fg-form" class="auth-form">
      <label class="field"><span>Email</span><input id="fg-email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Code</span><input id="fg-code" type="text" autocapitalize="characters" autocomplete="one-time-code" placeholder="123456 or FUEL-XXXX-XXXX-XXXX" required></label>
      <label class="field"><span>New password</span><input id="fg-pass" type="password" minlength="8" autocomplete="new-password" required></label>
      <p class="auth-msg" id="fg-msg" ${msg ? '' : 'hidden'}>${esc(msg || '')}</p>
      <p class="auth-err" id="fg-err" hidden></p>
      <button class="btn primary wide" type="submit" id="fg-go">Set new password</button>
    </form>
    <button class="btn ghost wide auth-spaced" id="fg-send" type="button">Email me a code</button>
    <button class="link-btn auth-forgot" id="fg-back" type="button">Back to sign in</button>
  `);
  const msgEl = $('#fg-msg', root), err = $('#fg-err', root);
  $('#fg-send', root).addEventListener('click', async () => {
    const email = $('#fg-email').value.trim();
    if (!email) { err.textContent = 'Type your email first.'; err.hidden = false; return; }
    $('#fg-send').disabled = true;
    try {
      const r = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const j = await r.json().catch(() => ({}));
      msgEl.textContent = j.mailed ? 'Code sent — check your inbox (and spam).' : 'If that email has an account, a code is on its way.';
      msgEl.hidden = false;
    } catch {
      msgEl.textContent = 'Could not send the email — use your recovery code instead.';
      msgEl.hidden = false;
    }
    $('#fg-send').disabled = false;
  });
  $('#fg-back', root).addEventListener('click', () => loginScreen());
  $('#fg-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const email = $('#fg-email').value.trim();
    const code = $('#fg-code').value.trim();
    const password = $('#fg-pass').value;
    const isRecovery = /^FUEL-/i.test(code);
    const body = isRecovery ? { email, recovery: code, password } : { email, code, password };
    $('#fg-go').disabled = true;
    try {
      const r = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Could not reset the password.');
      loginScreen('Password changed. Sign in with the new one.');
    } catch (ex) {
      err.textContent = String(ex.message || ex);
      err.hidden = false;
      $('#fg-go').disabled = false;
    }
  });
}

function resetLinkScreen(token) {
  const root = screen(`
    <div class="auth-logo">FUEL</div>
    <h1 class="auth-h1">Choose a new password.</h1>
    <p class="auth-sub">This link works once and expires in 20 minutes.</p>
    <form id="rl-form" class="auth-form">
      <label class="field"><span>New password</span><input id="rl-pass" type="password" minlength="8" autocomplete="new-password" required></label>
      <p class="auth-err" id="rl-err" hidden></p>
      <button class="btn primary wide" type="submit" id="rl-go">Save password</button>
    </form>
  `);
  const err = $('#rl-err', root);
  $('#rl-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    $('#rl-go').disabled = true;
    try {
      const r = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: $('#rl-pass').value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'That link has expired — request a new code.');
      history.replaceState({}, '', location.pathname);
      loginScreen('Password changed. Sign in with the new one.');
    } catch (ex) {
      err.textContent = String(ex.message || ex);
      err.hidden = false;
      $('#rl-go').disabled = false;
    }
  });
}

function pinScreen(user) {
  const root = screen(`
    <div class="auth-logo">FUEL</div>
    <h1 class="auth-h1">Welcome back, ${esc(user.name.split(' ')[0])}.</h1>
    <p class="auth-sub">Enter your PIN to unlock.</p>
    <div class="pin-dots" id="pin-dots"></div>
    <div class="pin-pad" id="pin-pad">
      ${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="pin-key" data-k="${n}" type="button">${n}</button>`).join('')}
      <button class="pin-key ghost" data-k="back" type="button">⌫</button>
      <button class="pin-key" data-k="0" type="button">0</button>
      <button class="pin-key ghost" data-k="out" type="button">Exit</button>
    </div>
    <p class="auth-err" id="pin-err" hidden></p>
    <button class="link-btn" id="use-pass" type="button">Use password instead</button>
  `);
  let pin = '';
  const dots = $('#pin-dots', root), err = $('#pin-err', root);
  const paint = () => { dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
  paint();
  root.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k === 'out' || e.target.closest('#use-pass')) return logout();
    if (!k) return;
    if (k === 'back') { pin = pin.slice(0, -1); paint(); return; }
    if (pin.length >= 6) return;
    pin += k; paint();
    if (pin.length < 4) return;
    err.hidden = true;
    const r = await fetch('/api/auth/pin/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pin }) });
    if (r.ok) { window.__fuelUser = user; if (!user.emailVerified) return verifyScreen(user, false); start(); }
    else if (pin.length === 6) { err.textContent = 'That PIN is wrong.'; err.hidden = false; pin = ''; paint(); }
  });
}

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
  location.reload();
}
