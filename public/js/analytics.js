// FUEL — privacy-safe usage events (names + counts only, never content).
// fireEvent(ev) posts an allowlisted event name to /api/analytics/event.
// - Silent: never blocks, never throws, never retries, failures are ignored.
// - Demo mode (?demo=1) never fires anything (window.__fuelDemo).
// - app_open is deduped per browser session (and again server-side per 60 min).
const URL = '/api/analytics/event';
const OPEN_KEY = 'fuel-an-app-open';
const OPEN_WINDOW = 60 * 60 * 1000;

const isDemo = () => !!window.__fuelDemo;

function post(ev, ts) {
  const url = URL + '?ev=' + encodeURIComponent(ev); // name in the URL aids tests; body carries the payload
  const body = JSON.stringify({ ev, ts });
  // sendBeacon first (fire-and-forget, survives page unload); fetch keepalive fallback.
  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
  } catch {}
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'include',
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function fireEvent(ev) {
  if (isDemo()) return;
  if (typeof ev !== 'string' || !ev) return;
  if (ev === 'app_open') {
    // one app_open per browser session per hour — real opens only
    try {
      const now = Date.now();
      const last = Number(sessionStorage.getItem(OPEN_KEY) || 0);
      if (now - last < OPEN_WINDOW) return;
      sessionStorage.setItem(OPEN_KEY, String(now));
      post(ev, now);
    } catch { post(ev, Date.now()); }
    return;
  }
  post(ev, Date.now());
}
