// FUEL — Telegram notifier: sends a message through the configured bot.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const CHAT = process.env.TELEGRAM_CHAT_ID || null;

export function telegramConfigured() { return !!(TOKEN && CHAT); }

export async function sendTelegram(text) {
  if (!telegramConfigured()) throw new Error('telegram_not_configured');
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: String(text).slice(0, 3000), disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    const e = new Error('telegram_failed');
    e.detail = JSON.stringify(j).replace(/\s+/g, ' ').slice(0, 200);
    throw e;
  }
  return true;
}
