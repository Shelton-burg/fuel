// FUEL — cloud sync: keeps an ENCRYPTED state blob in a private GitHub gist.
// The blob is encrypted client-side (AES-GCM, key derived from the user's sync key);
// the server only ever sees ciphertext + a SHA-256 key hash used to stop a different
// device from silently overwriting the slot.

const GH = 'https://api.github.com';
const TOKEN = process.env.GIST_TOKEN || null;
const DEFAULT_SLOT = process.env.SYNC_SLOT || 'prod';
const FILE = 'fuel-sync.json';
const descFor = (slot) => `FUEL sync ${slot}`;
const gistCache = new Map(); // slot -> gist id

async function gh(method, path, body) {
  const r = await fetch(GH + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fuel-sync',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = new Error('gist_http_' + r.status);
    e.detail = (await r.text()).replace(/\s+/g, ' ').slice(0, 200);
    throw e;
  }
  return r.json();
}

async function findGist(slot) {
  if (gistCache.has(slot)) return gistCache.get(slot);
  const desc = descFor(slot);
  for (let page = 1; page <= 3; page++) {
    const list = await gh('GET', `/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => (g.description || '') === desc);
    if (hit) { gistCache.set(slot, hit.id); return hit.id; }
    if (list.length < 100) break;
  }
  const created = await gh('POST', '/gists', { description: desc, public: false, files: { [FILE]: { content: '{}' } } });
  gistCache.set(slot, created.id);
  return created.id;
}

// No GitHub token (local dev): keep everything in memory so the flow still works
// end-to-end — never touches the real gist.
const mem = new Map();

export async function readSync(slot = DEFAULT_SLOT) {
  if (!TOKEN) return mem.get(slot) || { blob: null, keyHash: null, updatedAt: null };
  const id = await findGist(slot);
  const g = await gh('GET', `/gists/${id}`);
  const f = g.files && g.files[FILE];
  let content = '{}';
  if (f && typeof f.content === 'string' && f.content) content = f.content;
  else if (f && f.raw_url) content = await (await fetch(f.raw_url, { headers: { Authorization: `Bearer ${TOKEN}` } })).text();
  let parsed;
  try { parsed = JSON.parse(content || '{}'); } catch { parsed = {}; }
  return { blob: parsed.blob || null, keyHash: parsed.k || null, updatedAt: parsed.u || null };
}

export async function writeSync(blob, keyHash, slot = DEFAULT_SLOT) {
  if (!TOKEN) {
    const cur = mem.get(slot) || {};
    if (cur.keyHash && cur.keyHash !== keyHash) { const e = new Error('key_mismatch'); throw e; }
    const rec = { blob, keyHash, updatedAt: Date.now() };
    mem.set(slot, rec);
    return { updatedAt: rec.updatedAt };
  }
  const cur = await readSync(slot);
  if (cur.keyHash && cur.keyHash !== keyHash) { const e = new Error('key_mismatch'); throw e; }
  const id = await findGist(slot);
  const updatedAt = Date.now();
  await gh('PATCH', `/gists/${id}`, { files: { [FILE]: { content: JSON.stringify({ k: keyHash, u: updatedAt, blob }) } } });
  return { updatedAt };
}

export function syncConfigured() { return true; }
