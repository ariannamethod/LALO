const COLORS = { supporting: '#d4aa65', opposing: '#83b5aa', ghost: '#66706a', ink: '#ddd3bb' };
const color = state => state === 'supported' ? COLORS.supporting
  : state === 'contested' || state === 'contradicted' ? COLORS.opposing : COLORS.ghost;

function contour(ctx, cx, cy, radius, pressure, stretch = 1) {
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const angle = i / 96 * Math.PI * 2;
    const r = radius * (1 + .06 * Math.sin(3 * angle + .8)
      + .035 * Math.cos(7 * angle) + pressure * .045 * Math.sin(11 * angle));
    const x = cx + Math.cos(angle) * r * stretch, y = cy + Math.sin(angle) * r;
    if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function paint(ctx, { width, height, view, selected, pulse = 0, previous, progress = 1, actionIDs = [] }) {
  ctx.clearRect(0, 0, width, height);
  const cx = width * .5, cy = height * .59;
  const unit = Math.min(width * .29, height * .23);
  const shape = reading => ({
    radius: unit * (.66 + .055 * Math.min(8, reading.premises.length)),
    pressure: reading.opposing.length / Math.max(1, reading.premises.length),
  });
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // Display up to six historical outlines; the receipt list retains every row.
  const layers = view.layers.slice(0, -1).slice(-6);
  layers.forEach((layer, i) => {
    const { radius, pressure } = shape(layer);
    ctx.strokeStyle = color(layer.state); ctx.globalAlpha = .13 + i * .025;
    ctx.lineWidth = .8; ctx.setLineDash([2, 5]);
    contour(ctx, cx - (layers.length - i) * 4, cy + (layers.length - i) * 3,
      radius + (layers.length - i) * 5, pressure);
    ctx.stroke();
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  const target = shape(view.current), origin = shape(previous?.current || view.current);
  const ease = 1 - (1 - progress) ** 3;
  const radius = origin.radius + (target.radius - origin.radius) * ease;
  const pressure = origin.pressure + (target.pressure - origin.pressure) * ease;
  const nodes = view.records.map(({ fact, state, label }, index) => {
    const angle = -2.5 + index * 2.399963229728653;
    const ring = unit * (1.25 + (index % 3) * .25);
    return { fact, state, label, x: cx + Math.cos(angle) * ring,
      y: cy + Math.sin(angle) * ring * .82 };
  });
  for (const edge of view.corrections) {
    const a = nodes.find(n => n.fact.id === edge.from), b = nodes.find(n => n.fact.id === edge.to);
    if (!a || !b) continue;
    ctx.strokeStyle = COLORS.ghost; ctx.globalAlpha = .55; ctx.lineWidth = .8;
    ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const node of nodes) {
    const active = node.state === 'supporting' || node.state === 'opposing';
    if (!active) continue;
    ctx.strokeStyle = COLORS[node.state]; ctx.globalAlpha = .28; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.moveTo(node.x, node.y); ctx.lineTo(cx, cy); ctx.stroke();
  }
  ctx.globalAlpha = .055;
  ctx.fillStyle = color(view.current.state);
  contour(ctx, cx, cy, radius, pressure); ctx.fill();
  ctx.globalAlpha = .8; ctx.lineWidth = 1.2;
  ctx.strokeStyle = color(view.current.state); ctx.stroke();
  // Each opposing premise opens a visible fracture in the current outline.
  view.current.opposing.forEach((_, i) => {
    const a = .3 + i * .9;
    ctx.strokeStyle = COLORS.opposing; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * radius * .8, cy + Math.sin(a) * radius * .8);
    ctx.lineTo(cx + Math.cos(a + .03) * radius * 1.15, cy + Math.sin(a + .03) * radius * 1.15);
    ctx.stroke();
  });
  ctx.textAlign = 'center'; ctx.globalAlpha = .8; ctx.fillStyle = COLORS.ink;
  ctx.font = 'italic 18px Georgia'; ctx.fillText((view.title || 'north crossing').slice(0, 32), cx, cy - 4, unit * 2.2);
  ctx.font = '10px sans-serif'; ctx.globalAlpha = .6;
  ctx.fillText(view.current.state.toUpperCase(), cx, cy + 17);
  for (const node of nodes) {
    const active = node.state === 'supporting' || node.state === 'opposing';
    ctx.globalAlpha = active ? .95 : .5;
    ctx.strokeStyle = ctx.fillStyle = COLORS[node.state] || COLORS.ghost;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(node.x, node.y, active ? 4 : 3, 0, Math.PI * 2);
    active ? ctx.fill() : ctx.stroke();
    if (node.state === 'opposing') {
      ctx.beginPath(); ctx.moveTo(node.x - 7, node.y + 7); ctx.lineTo(node.x + 7, node.y - 7); ctx.stroke();
    }
    ctx.globalAlpha = node.fact.id === selected ? .9 : .25;
    ctx.beginPath(); ctx.arc(node.x, node.y, 10 + (node.fact.id === selected ? pulse * 9 : 0), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = active ? .8 : .45; ctx.font = '11px Georgia';
    const label = node.label || node.fact.id, maxLabelWidth = Math.max(1, width - 16);
    const half = Math.min(maxLabelWidth, ctx.measureText(label).width) / 2;
    const labelX = Math.max(half + 8, Math.min(width - half - 8, node.x));
    ctx.fillText(label, labelX, node.y - 17, maxLabelWidth);
    if (actionIDs.includes(node.fact.id)) {
      ctx.globalAlpha = .95; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(node.x, node.y, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'start';
  return nodes;
}
