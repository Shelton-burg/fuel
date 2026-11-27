// FUEL v69 — exercise media bundle coverage + on-disk asset integrity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { EX_LIB } from '../public/js/programs.js';
import { exMedia } from '../public/js/exercise-media.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '../public');

// Distinct FUEL exercise names from EX_LIB (deduped, same keying the app uses).
const names = [...new Set(EX_LIB.map((x) => x.name))];

test('slug map covers >= 85% of distinct EX_LIB names', () => {
  const mapped = names.filter((n) => exMedia(n)).length;
  const pct = (mapped / names.length) * 100;
  assert.ok(mapped >= 0.85 * names.length, `only ${mapped}/${names.length} (${pct.toFixed(1)}%) mapped`);
});

test('every mapped exercise has a start frame (f0)', () => {
  for (const n of names) {
    const m = exMedia(n);
    if (m) assert.ok(m.f0, `${n}: missing f0`);
  }
});

test('every mapped asset path exists on disk', () => {
  const seen = new Set();
  for (const n of names) {
    const m = exMedia(n);
    if (!m) continue;
    for (const k of ['f0', 'f1']) {
      const p = m[k];
      if (!p) continue;
      if (p.startsWith('/')) {
        const abs = join(PUBLIC, p.slice(1));
        assert.ok(existsSync(abs), `${n}: ${k} missing on disk at ${p}`);
        seen.add(p);
      }
    }
  }
  assert.ok(seen.size > 0, 'no asset paths were validated');
});

test('mapped exercises carry step-by-step instructions', () => {
  const withSteps = names.filter((n) => exMedia(n)?.steps?.length).length;
  const mapped = names.filter((n) => exMedia(n)).length;
  // The majority of mapped entries should have form cues.
  assert.ok(withSteps >= 0.8 * mapped, `only ${withSteps}/${mapped} mapped entries have steps`);
});
