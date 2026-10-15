import { crossingDemo, START, SUBJECT, PREDICATE } from '../src/crossing-demo.js';
import { createToolHost } from '../src/tools.js';

const world = crossingDemo();
world.receive(); world.receive(); world.receive();
const host = createToolHost(world.ledger);
const call = { name: 'lalo_reading', arguments: {
  subject: SUBJECT, predicate: PREDICATE, rule: 'unanimous-boolean/v1',
  validAt: START, knownAt: world.latest, limit: 1,
} };
const first = host.call(call.name, call.arguments);
console.log(JSON.stringify(first, null, 2));
// The first page already reports the conflict. Follow the evidence to its source.
let next = first.data.nextOffset;
while (next !== null) {
  const result = host.call(call.name, { ...call.arguments, offset: next });
  console.log(JSON.stringify(result, null, 2)); next = result.data.nextOffset;
}
