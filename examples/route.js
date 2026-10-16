import { crossingDemo, START, SUBJECT, PREDICATE } from '../src/crossing-demo.js';
import { createToolHost } from '../src/tools.js';
import { createRouteSession } from '../src/route.js';
import { createNativeRouter } from '../scripts/native-router.mjs';

const world = crossingDemo(); world.receive(); world.receive(); world.receive();
const router = await createNativeRouter();
try {
  const session = createRouteSession(createToolHost(world.ledger), router);
  const trace = await session.call({ text: 'please check the conflicting evidence', arguments: {
    subject: SUBJECT, predicate: PREDICATE, rule: 'unanimous-boolean/v1',
    validAt: START, knownAt: world.latest,
  } });
  console.log(JSON.stringify(trace, null, 2));
  if (trace.status !== 'executed' || trace.result.data.reading.state !== 'contested') process.exitCode = 1;
} finally { await router.close(); }
