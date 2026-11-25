// FUEL — owner dashboard. Logs in as the owner, renders aggregate usage stats.
// Data comes from /api/owner/stats behind the owner session cookie.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n ?? 0).toLocaleString('en-AU');

const LABELS = {
  app_open: 'App opens', tab_today: 'Today tab', tab_train: 'Train tab', tab_history: 'History tab',
  tab_body: 'Body tab', tab_food: 'Food tab', tab_recovery: 'Recovery tab', tab_settings: 'Settings tab',
  log_food: 'Foods logged', scan_barcode: 'Barcode scans', scan_label: 'Label photo scans', plate_scan: 'Plate photo scans',
  coach_call: 'Coach plans', coach_chat_msg: 'Coach chat messages', mealplan: 'Meal plans', weekly_checkin: 'Weekly check-ins',
  recipe_ideas: 'Recipe ideas', workout_start: 'Workouts started', workout_finish: 'Workouts finished',
  checkin_log: 'Daily check-ins', sync_push: 'Cloud backups', pin_used: 'PIN unlocks',
};
const AI_ROWS = [
  ['label', 'Label scans', 'scan_label'],
  ['coach', 'Coach', 'coach_call'],
  ['chat', 'Coach chat', 'coach_chat_msg'],
  ['weekly', 'Weekly', 'weekly_checkin'],
  ['meal', 'Meal plans', 'mealplan'],
];

let mode = 'login';

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const go = $('#o-go'); const err = $('#o-err');
  go.disabled = true; err.textContent = '';
  const url = mode === 'setup' ? '/api/owner/setup' : '/api/owner/login';
  const body = { email: $('#o-email').value.trim(), password: $('#o-pass').value };
  if (mode === 'setup') body.code = $('#o-code').value.trim();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Could not sign in.');
    enterDashboard(j.owner?.email || body.email);
  } catch (ex) {
    err.textContent = String(ex.message || ex);
  } finally { go.disabled = false; }
});
document.querySelectorAll('.auth-tab').forEach((b) => b.addEventListener('click', () => {
  mode = b.dataset.tab;
  document.querySelectorAll('.auth-tab').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelector('.setup-only').classList.toggle('hidden', mode !== 'setup');
  $('#o-go').textContent = mode === 'setup' ? 'Create owner account' : 'Sign in';
  $('#o-pass').autocomplete = mode === 'setup' ? 'new-password' : 'current-password';
  $('#o-err').textContent = '';
}));

$('#btn-logout').addEventListener('click', async () => {
  await fetch('/api/owner/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  location.reload();
});
$('#btn-refresh').addEventListener('click', () => loadStats().catch(() => {}));

async function enterDashboard(email) {
  $('#auth-wrap').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  if (email) $('#dash-email').textContent = esc(email);
  try { await loadStats(); } catch {}
  setInterval(() => loadStats().catch(() => {}), 60 * 1000);
}

function level(n) {
  if (n <= 0) return '';
  if (n <= 2) return 'l1';
  if (n <= 5) return 'l2';
  if (n <= 10) return 'l3';
  if (n <= 20) return 'l4';
  return 'l5';
}

async function loadStats() {
  const r = await fetch('/api/owner/stats', { credentials: 'same-origin' });
  if (r.status === 401) { location.reload(); return; }
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error('stats failed');
  render(j);
}

function render(s) {
  // stat cards
  const cards = [
    ['Total users', fmt(s.totals.users), 'all-time'],
    ['Active · 7 days', fmt(s.totals.active7d), 'users who opened the app'],
    ['Active · 30 days', fmt(s.totals.active30d), 'users who opened the app'],
    ['Events today', fmt(s.eventsToday), `7d: ${fmt(s.events7d)} events`],
  ];
  $('#stat-cards').innerHTML = cards.map(([k, v, d]) =>
    `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');

  // signups trend
  const maxN = Math.max(1, ...s.signups.map((x) => x.n));
  $('#signups').innerHTML = s.signups.map((x) => {
    const h = Math.round((x.n / maxN) * 86);
    return `<div class="bar"><b>${x.n}</b><i style="height:${Math.max(2, h)}px"></i><span>${x.week.slice(5)}</span></div>`;
  }).join('');

  // heat map: 12 weeks (columns) × 7 days (rows), Mon–Sun
  const cols = [];
  for (let w = 0; w < 12; w++) cols.push(s.heat.slice(w * 7, w * 7 + 7));
  $('#heat-title').textContent = s.heatLabel || 'Activity heat map';
  $('#heat').innerHTML = cols.map((week, wi) =>
    `<div class="col">${week.map((d) => {
      const t = `${d.day} · ${d.count} event${d.count === 1 ? '' : 's'} · ${d.users} user${d.users === 1 ? '' : 's'}`;
      return `<span class="hcell ${level(d.count)}" title="${t}"></span>`;
    }).join('')}</div>`).join('');

  // feature ranking
  $('#feat-body').innerHTML = s.features.map((f) => {
    const d = f.delta7 > 0 ? `<span class="up">+${fmt(f.delta7)}</span>` : f.delta7 < 0 ? `<span class="down">${fmt(f.delta7)}</span>` : `<span class="flat">0</span>`;
    return `<tr><td>${esc(LABELS[f.ev] || f.ev)}</td><td class="num"><span class="pill">${fmt(f.count)}</span></td><td class="num">${d}</td></tr>`;
  }).join('') || '<tr><td colspan="3" style="color:var(--muted)">No events yet — usage appears here once people use the app.</td></tr>';

  // AI budgets
  $('#ai-body').innerHTML = AI_ROWS.map(([key, name, ev]) => {
    const a = s.ai[key] || { used: 0, cap: 0 };
    const pct = a.cap ? Math.min(100, Math.round((a.used / a.cap) * 100)) : 0;
    return `<div class="ai-row"><span class="name">${name}</span><div class="track"><i class="${a.used > a.cap ? 'over' : ''}" style="width:${pct}%"></i></div><span class="num">${fmt(a.used)} / ${fmt(a.cap)}</span></div>`;
  }).join('');

  $('#dash-fine').textContent = `${s.disclaimer || 'Aggregate counts only — never personal data.'} · updated ${new Date(s.updatedAt).toLocaleTimeString('en-AU')}`;
}

// who's already signed in?
(async () => {
  try {
    const r = await fetch('/api/owner/me', { credentials: 'same-origin' });
    if (r.ok) { const j = await r.json(); enterDashboard(j.owner?.email); }
  } catch {}
})();
