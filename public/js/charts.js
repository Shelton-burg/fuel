// FUEL — canvas chart helpers: rounded bars (+goal line) and a line chart.
// Sizing note: pass cssH (logical px). Canvas CSS is width:100% with height auto —
// the element keeps its intrinsic ratio, so the drawing scales like an image.
// Only render while the element is VISIBLE (clientWidth is 0 when display:none).

const AMBER = '#FFB224';
const OVER = '#FF5D6C';
const MUT = 'rgba(255,255,255,.35)';

const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

export function setup(canvas, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(canvas.clientWidth || 0, 240);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, cssH);
  return { ctx, W, H: cssH };
}

function roundBar(ctx, x, yTop, w, h, r, strokeOnly = false) {
  ctx.beginPath();
  ctx.moveTo(x + r, yTop);
  ctx.arcTo(x + w, yTop, x + w, yTop + h, r);
  ctx.arcTo(x + w, yTop + h, x, yTop + h, r);
  ctx.arcTo(x, yTop + h, x, yTop, r);
  ctx.arcTo(x, yTop, x + w, yTop, r);
  ctx.closePath();
  if (strokeOnly) ctx.stroke(); else ctx.fill();
}

/* Rounded bars with a dashed goal line. data: [{ label, value }] */
export function bars(canvas, { data, goal = 0, cssH = 120, labelEvery = 3, highlight = -1, padB = 14, padT = 12, overColor = true }) {
  const { ctx, W, H } = setup(canvas, cssH);
  const n = Math.max(data.length, 1);
  const gap = 4;
  const bw = (W - gap * (n - 1)) / n;
  const maxV = Math.max(goal * 1.4, ...data.map((d) => d.value || 0), 1);
  const y = (v) => H - padB - (v / maxV) * (H - padB - padT);

  if (goal > 0) {
    ctx.strokeStyle = 'rgba(255,161,23,.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, y(goal)); ctx.lineTo(W, y(goal)); ctx.stroke();
    ctx.setLineDash([]);
  }

  data.forEach((d, i) => {
    const v = d.value || 0;
    const x = i * (bw + gap);
    const over = overColor && goal > 0 && v > goal;
    const by = y(Math.max(v, 0));
    const bh = v ? Math.max(H - padB - by, 3) : 3;
    const r = Math.max(1, Math.min(bw / 2, 5, bh / 2));
    if (v) {
      const grad = ctx.createLinearGradient(0, by, 0, H - padB);
      grad.addColorStop(0, over ? OVER : AMBER);
      grad.addColorStop(1, over ? 'rgba(255,93,108,.25)' : 'rgba(255,122,0,.25)');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.05)';
    }
    roundBar(ctx, x, by, bw, bh, r);
    if (i === highlight) {
      ctx.strokeStyle = 'rgba(255,178,36,.95)';
      ctx.lineWidth = 1.5;
      roundBar(ctx, x - 2, by - 2, bw + 4, bh + 4, r + 2, true);
      ctx.lineWidth = 1;
    }
  });

  ctx.fillStyle = MUT;
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  data.forEach((d, i) => {
    if (labelEvery === 1 || i % labelEvery === 0 || i === n - 1) ctx.fillText(d.label, i * (bw + gap) + bw / 2, H - 2);
  });
  ctx.textAlign = 'start';
  return { W, H };
}

/* Line chart with area fill, dots and a last-value callout. data: [{ label, value }] */
export function line(canvas, { data, cssH = 150, unit = '', minPad = 1 }) {
  const { ctx, W, H } = setup(canvas, cssH);
  const n = data.length;
  if (!n) return { W, H };
  const vals = data.map((d) => d.value);
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals);
  const span = Math.max(vmax - vmin, minPad);
  const padL = 10, padR = 10, padT = 20, padB = 18;
  const lo = vmin - span * 0.18;
  const hi = vmax + span * 0.18;
  const y = (v) => H - padB - ((v - lo) / (hi - lo)) * (H - padB - padT);
  const x = (i) => (n === 1 ? W / 2 : padL + (i / (n - 1)) * (W - padL - padR));

  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach((f) => {
    const gy = padT + f * (H - padB - padT);
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  });

  if (n > 1) {
    const g = ctx.createLinearGradient(0, padT, 0, H - padB);
    g.addColorStop(0, 'rgba(255,161,23,.20)');
    g.addColorStop(1, 'rgba(255,161,23,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x(0), y(data[0].value));
    for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(data[i].value));
    ctx.lineTo(x(n - 1), H - padB);
    ctx.lineTo(x(0), H - padB);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x(0), y(data[0].value));
    for (let i = 1; i < n; i++) ctx.lineTo(x(i), y(data[i].value));
    ctx.stroke();
  }

  data.forEach((d, i) => {
    ctx.fillStyle = AMBER;
    ctx.beginPath(); ctx.arc(x(i), y(d.value), 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(7,9,15,.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x(i), y(d.value), 3, 0, Math.PI * 2); ctx.stroke();
  });

  const last = data[n - 1];
  ctx.fillStyle = AMBER;
  ctx.font = '700 12.5px "Space Grotesk", Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${fmtNum(last.value)}${unit ? ' ' + unit : ''}`, W - 6, Math.max(y(last.value) - 9, 13));

  const every = Math.max(1, Math.ceil(n / 6));
  ctx.fillStyle = MUT;
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  data.forEach((d, i) => {
    if (i % every === 0 || i === n - 1) ctx.fillText(d.label, x(i), H - 4);
  });
  ctx.textAlign = 'start';
  return { W, H };
}
