import { crossingDemo, START, END, SUBJECT, PREDICATE } from '../src/crossing-demo.js';
import { worldView } from '../src/hypothesis.js';
import { paint } from './paint.js';

const $ = id => document.getElementById(id);
const canvas = $('field'), ctx = canvas.getContext('2d');
const knowledge = $('knowledge'), world = $('world');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const time = value => new Date(Number(value)).toISOString().slice(11, 16) + ' UTC';
let demo, view, selected, nodes = [], width = 1, height = 1, animation = 0;
let receiptSignature = '';
knowledge.min = START; world.min = START - 60_000; world.max = END + 60_000;
function element(tag, text, className) {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
}
function draw(pulse = 0, previous, progress = 1) {
  if (view) nodes = paint(ctx, { width, height, view, selected, pulse, previous, progress });
}
function resize() {
  const box = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  width = box.width; height = box.height;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
}
function inspect() {
  const target = $('inspector'); target.replaceChildren();
  const record = view.records.find(r => r.fact.id === selected);
  if (!record) return;
  const f = record.fact;
  target.append(element('p', `${f.id} · ${f.source}`, 'eyebrow'),
    element('strong', `“The crossing is ${f.value ? 'open' : 'closed'}.”`),
    element('p', `Received ${time(f.recordedAt)} · ${record.state}`),
    element('p', `World interval ${time(f.validFrom)}–${time(f.validTo)}`, 'trace'),
    element('p', `Lineage: ${demo.ledger.lineage(f.id).map(r => r.id).join(' → ')}`, 'trace'),
    element('p', `Rule: ${view.current.rule}`, 'trace'));
}
function select(id) {
  selected = id;
  for (const button of $('receipts').querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.dataset.id === selected));
  inspect(); draw();
}
function receipts() {
  const signature = view.records.map(r => `${r.fact.id}:${r.state}`).join('|');
  if (signature !== receiptSignature) {
    const list = $('receipts'); list.replaceChildren();
    for (const { fact, state } of [...view.records].reverse()) {
      const li = element('li', ''), button = element('button', '', 'receipt');
      button.dataset.id = fact.id; button.dataset.state = state;
      const label = element('span', fact.source.replace('fixture:', ''));
      label.append(element('small', `${fact.id} · ${fact.value ? 'open' : 'closed'} · ${state}`));
      button.append(element('span', state === 'opposing' ? '╱' : state === 'supporting' ? '●' : '◌', 'mark'),
        label, element('time', time(fact.recordedAt).replace(' UTC', '')));
      button.addEventListener('click', () => select(fact.id));
      li.append(button); list.append(li);
    }
    receiptSignature = signature;
  }
  select(selected);
}
function render(animate = false) {
  cancelAnimationFrame(animation);
  const previous = view;
  view = worldView(demo.ledger, { subject: SUBJECT, predicate: PREDICATE,
    expected: true, validAt: Number(world.value), knownAt: Number(knowledge.value) });
  if (!view.records.some(r => r.fact.id === selected)) selected = view.records.at(-1)?.fact.id;
  const current = view.current;
  $('state').textContent = current.state; $('state').dataset.state = current.state;
  $('basis').textContent = `${current.supporting.length} supporting · ${current.opposing.length} opposing · ${current.premises.length} active premises`;
  $('receipt-count').textContent = `${view.records.length} known`;
  $('field-count').textContent = `${view.records.length} receipts · ${view.corrections.length} revisions`;
  $('knowledge-time').textContent = time(knowledge.value);
  $('world-time').textContent = time(world.value);
  knowledge.setAttribute('aria-valuetext', time(knowledge.value));
  world.setAttribute('aria-valuetext', time(world.value));
  $('budget').textContent = `${demo.ledger.size} / 64 receipts · memory only`;
  $('receive').disabled = demo.remaining === 0 || demo.ledger.size >= 64;
  $('open').disabled = $('closed').disabled = demo.ledger.size >= 64;
  $('next-note').textContent = demo.remaining ? `${demo.remaining} scripted reports remain.` : 'All scripted reports have arrived. Add your own reading.';
  receipts(); draw();
  if (animate && !motion.matches) {
    const start = performance.now();
    function frame(now) {
      const p = Math.min(1, (now - start) / 800); draw(1 - p, previous, p);
      if (p < 1) animation = requestAnimationFrame(frame);
    }
    animation = requestAnimationFrame(frame);
  }
}
function receive(action) {
  try {
    const fact = action(); if (!fact) return;
    selected = fact.id; knowledge.max = demo.latest; knowledge.value = demo.latest;
    $('error').hidden = true; render(true);
  } catch (error) {
    $('error').textContent = error.message; $('error').hidden = false;
  }
}
function reset() {
  demo = crossingDemo(); demo.receive(); demo.receive();
  knowledge.max = demo.latest; knowledge.value = demo.latest; world.value = START + 300_000;
  selected = 'b1'; receiptSignature = ''; $('error').hidden = true; render();
}
$('receive').addEventListener('click', () => receive(() => demo.receive()));
$('open').addEventListener('click', () => receive(() => demo.observe(true)));
$('closed').addEventListener('click', () => receive(() => demo.observe(false)));
$('reset').addEventListener('click', reset);
$('present').addEventListener('click', () => { knowledge.value = demo.latest; render(); });
for (const slider of [knowledge, world]) slider.addEventListener('input', () => render());
canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const closest = nodes.map(n => ({ n, distance: Math.hypot(n.x - x, n.y - y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (closest?.distance <= 24) select(closest.n.fact.id);
});
motion.addEventListener('change', () => render());
new ResizeObserver(resize).observe(canvas);
reset(); resize();
document.documentElement.dataset.ready = 'true';
