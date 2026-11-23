// FUEL — boot gate. Loads the app only after the session (and PIN) checks out.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const demo = new URLSearchParams(location.search).has('demo');
if (demo) { window.__fuelDemo = true; start(); }
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
  if (!user.hasPin) { window.__fuelUser = user; return start(); }
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
      if (j.user.hasPin) return pinScreen(j.user);
      return start();
    } catch (ex) {
      err.textContent = String(ex.message || ex);
      err.hidden = false;
      go.disabled = false;
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
    if (r.ok) { window.__fuelUser = user; start(); }
    else if (pin.length === 6) { err.textContent = 'That PIN is wrong.'; err.hidden = false; pin = ''; paint(); }
  });
}

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
  location.reload();
}
