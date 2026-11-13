import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedTextFile } from './io.mjs';
import { actionMemory } from './action-memory.mjs';
import { createNativeRouter } from './native-router.mjs';
import { createNoTorchModel } from './notorch-model.mjs';
import { runModelEncounter, replayModelEncounter } from '../src/model-encounter.js';

export async function main(args) {
  const allowed = new Set(['--model', '--journal', '--scope', '--memory', '--id', '--agent',
    '--experts-output', '--spore-in', '--replay']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, args[i]))
      throw new Error('Expected unique named flags with values; see docs/MODEL_ENCOUNTERS.md');
    options[args[i]] = args[i + 1];
  }
  if (!options['--memory']) throw new Error('--memory is required');
  const memory = await actionMemory(options['--memory']);
  if (options['--replay']) {
    if (Object.keys(options).some(k => !['--memory', '--replay'].includes(k)))
      throw new Error('Replay takes only --memory and --replay SEQUENCE');
    const saved = await memory.recall({ sequence: Number(options['--replay']), snapshot: true });
    return replayModelEncounter(JSON.stringify(saved.journal), saved.receipt.action);
  }
  for (const flag of ['--model', '--journal', '--scope', '--id']) if (!options[flag]) throw new Error(`${flag} is required`);
  const journal = await boundedTextFile(options['--journal']);
  const scope = JSON.parse(await boundedTextFile(options['--scope'], 4096));
  const model = await createNoTorchModel({ model: options['--model'], expertsDirectory: options['--experts-output'], sporeIn: options['--spore-in'] });
  const router = await createNativeRouter();
  try {
    const outcome = await runModelEncounter({ journal, scope, model, router, clock: Date.now,
      id: options['--id'], agent: options['--agent'] || 'agent:gemma-270m' });
    let acknowledgment;
    try { acknowledgment = await memory.append(outcome.action, outcome.journal); }
    catch (error) {
      return { status: 'persistence_error', actionStatus: outcome.action.status,
        memory: { state: 'failed', error: { code: error.code || 'MODEL_MEMORY', message: error.message } },
        encounter: outcome.action.result, unsavedJournal: JSON.parse(outcome.journal), expertState: model.state() };
    }
    return { status: outcome.action.status, memory: acknowledgment, encounter: outcome.action.result, expertState: model.state() };
  } finally { await router.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(JSON.stringify(result));
    if (result.status && result.status !== 'executed' || result.comparison && result.comparison !== 'match'
      || result.memory && result.memory.state !== 'saved') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ error: { code: error.code || 'MODEL_CLI', message: error.message } })); process.exitCode = 1;
  }
}
