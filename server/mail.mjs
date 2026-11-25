// FUEL — transactional email (Resend). No key = no email; the caller falls back
// to the recovery code, so the app still works without this configured.
const KEY = process.env.RESEND_API_KEY || null;
const FROM = process.env.FUEL_MAIL_FROM || 'FUEL <shelton@tradedesk.now>';

export const mailConfigured = () => !!KEY;

export async function sendMail({ to, subject, text, html }) {
  if (!KEY) return { ok: false, skipped: 'not_configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('[mail] resend', r.status, (j && j.message) || ''); return { ok: false, status: r.status }; }
    return { ok: true, id: j.id };
  } catch (e) {
    console.error('[mail] failed', e.message);
    return { ok: false };
  }
}

export function resetEmail({ code, minutes }) {
  const text = `Your FUEL reset code is ${code}\n\nIt works for ${minutes} minutes. If you didn't ask for this, ignore it — your password stays as it is.`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0d0d0f;padding:32px;color:#f5f5f7">
    <div style="max-width:440px;margin:0 auto;background:#16161a;border:1px solid #2a2a30;border-radius:16px;padding:28px">
      <div style="letter-spacing:.3em;color:#ff9f1c;font-weight:700;font-size:12px">FUEL</div>
      <h1 style="font-size:22px;margin:14px 0 8px">Your reset code</h1>
      <p style="color:#a8a8b3;font-size:14px;line-height:1.5;margin:0 0 18px">Enter this in the app to set a new password. It expires in ${minutes} minutes.</p>
      <div style="font-size:30px;letter-spacing:.22em;font-weight:700;background:#0d0d0f;border:1px solid #2a2a30;border-radius:12px;padding:14px 10px;text-align:center">${code}</div>
      <p style="color:#6f6f7b;font-size:12px;line-height:1.5;margin:18px 0 0">If you didn't ask for this, ignore this email — nothing has changed.</p>
    </div>
  </div>`;
  return { text, html };
}

export function verifyEmailMessage({ code }) {
  const text = `Confirm your FUEL email with this code: ${code}

It works for 24 hours. If you didn't create a FUEL account, ignore this email.`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0d0d0f;padding:32px;color:#f5f5f7">
    <div style="max-width:440px;margin:0 auto;background:#16161a;border:1px solid #2a2a30;border-radius:16px;padding:28px">
      <div style="letter-spacing:.3em;color:#ff9f1c;font-weight:700;font-size:12px">FUEL</div>
      <h1 style="font-size:22px;margin:14px 0 8px">Confirm your email</h1>
      <p style="color:#a8a8b3;font-size:14px;line-height:1.5;margin:0 0 18px">Enter this code in the app to verify your address. It expires in 24 hours.</p>
      <div style="font-size:30px;letter-spacing:.22em;font-weight:700;background:#0d0d0f;border:1px solid #2a2a30;border-radius:12px;padding:14px 10px;text-align:center">${code}</div>
      <p style="color:#6f6f7b;font-size:12px;line-height:1.5;margin:18px 0 0">If you didn't create a FUEL account, ignore this email.</p>
    </div>
  </div>`;
  return { text, html };
}

export function deleteEmail({ link }) {
  const text = `Delete your FUEL account

Open this link to permanently delete your FUEL account:

${link}

The link works for 60 minutes and can only be used once. Deleting is
irreversible — your account, food and exercise history, photos and encrypted
backups are destroyed.

If you didn't ask for this, ignore this email — nothing will change.`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0d0d0f;padding:32px;color:#f5f5f7">
    <div style="max-width:440px;margin:0 auto;background:#16161a;border:1px solid #2a2a30;border-radius:16px;padding:28px">
      <div style="letter-spacing:.3em;color:#ff9f1c;font-weight:700;font-size:12px">FUEL</div>
      <h1 style="font-size:22px;margin:14px 0 8px">Delete your account</h1>
      <p style="color:#a8a8b3;font-size:14px;line-height:1.5;margin:0 0 18px">Open this link to permanently delete your FUEL account. The link works for 60 minutes and can only be used once.</p>
      <div style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#b3261e;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px">Delete my account</a></div>
      <p style="color:#a8a8b3;font-size:13px;line-height:1.5;margin:0 0 8px"><b style="color:#f5f5f7">This cannot be undone.</b> Your account, food and exercise history, photos and encrypted backups are destroyed.</p>
      <p style="color:#6f6f7b;font-size:12px;line-height:1.5;margin:0">If you didn't ask for this, ignore this email — nothing will change.</p>
    </div>
  </div>`;
  return { text, html };
}
