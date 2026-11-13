// One optional activity of Don: a model asks, receives receipts, and answers.
// This portable module starts no process, network request, clock or learning.
import { createBackground, isQuake, isAgent } from './background.js';
import { decodeJournal, encodeJournal } from './journal.js';
import { createToolHost, sameToolResult } from './tools.js';
import { createRouteSession } from './route.js';
import { createActionReplay } from './action-replay.js';

const copy = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => Object.assign(new Error(message), { code });
const text = (v, n) => typeof v === 'string' && v.trim() && v.isWellFormed() && !v.includes('\0') && v.length <= n;
function checkedScope(scope) {
  if (!scope || Object.keys(scope).sort().join(',') !== 'knownAt,subject,validAt' || !isQuake(scope.subject)
    || !Number.isSafeInteger(scope.validAt) || !Number.isSafeInteger(scope.knownAt))
    throw fail('MODEL_SCOPE', 'Supply one USGS subject, validAt and knownAt explicitly');
  return copy(scope);
}

// An intentionally small first language contract. Match the whole question:
// a different date, location, second question or constraint cannot disappear.
export function bindModelQuestion(question, scope, version = 2) {
  if (version !== 1 && version !== 2) throw fail('MODEL_BINDING', 'Unsupported question binding');
  scope = checkedScope(scope);
  if (!text(question, 2047)) throw fail('MODEL_QUESTION', 'Question must fit the routing text budget');
  let normalized = question.trim().replace(/\s+/g, ' ').toLowerCase();
  normalized = normalized.replace(/^(?:don(?: eduardo)?[,!:]?\s+)/, '');
  const forms = [
    /^(?:what is|what was|what's) the (?:reported |current )?magnitude of (?:this|the) earthquake(?: you are referring to)?\?$/,
    /^(?:can|could) you tell me the (?:reported |current )?magnitude of (?:this|the) earthquake\?$/,
    /^what (?:is|was) (?:this|the) earthquake's (?:reported |current )?magnitude\?$/,
    /^(?:please )?(?:read|show|give me) the (?:reported |current )?magnitude of (?:this|the) earthquake[.!?]?$/,
  ];
  if (version >= 2) forms.push(/^how strong (?:is|was) (?:this|the) earthquake\?$/);
  if (!forms.some(re => re.test(normalized)))
    throw fail('MODEL_QUESTION_UNRESOLVED', 'Question is outside the focused earthquake-magnitude language contract');
  return { format: 'lalo/model-question', version, rule: `focused-quake-magnitude/v${version}`, question,
    scope, argumentSources: { subject: 'scope.subject', validAt: 'scope.validAt', knownAt: 'scope.knownAt', predicate: 'question:magnitude' },
    request: { text: version === 1 ? 'read active facts' : question, arguments: { ...scope, predicate: 'magnitude' } } };
}

export const MODEL_QUESTION_PROMPT = 'You can ask Don Eduardo about an earthquake. You need its magnitude. '
  + 'Write one short question to Don. Do not answer it.';

export function modelAnswerPrompt(question, read) {
  if (read?.status !== 'executed' || read.call?.name !== 'lalo_facts' || !read.result?.ok
    || !read.result.data?.complete) throw fail('MODEL_EVIDENCE', 'Answer needs a complete successful facts read');
  return `Question: ${question}\nDon Eduardo returned these source receipts:\n${JSON.stringify(read.result.data.items)}\n`
    + 'Answer the question in one short sentence using only these receipts. If they contain no magnitude, say it is unavailable.';
}

function checkedGeneration(value) {
  const output = copy(value);
  if (!text(output?.text, 4096) || !output.metadata || !['stop', 'length'].includes(output.metadata.finishReason)
    || new TextEncoder().encode(JSON.stringify(output)).length > 16_384)
    throw fail('MODEL_OUTPUT', 'Expected a bounded utterance and its generation metadata');
  for (const key of ['inputTokens', 'outputTokens'])
    if (!Number.isSafeInteger(output.metadata[key]) || output.metadata[key] < 0)
      throw fail('MODEL_OUTPUT', `Invalid measured ${key}`);
  return output;
}

function observationFacts({ id, agent, identity }, phase, output, at) {
  const values = { utterance: output.text, phase, model_sha256: identity.sha256,
    input_tokens: output.metadata.inputTokens, output_tokens: output.metadata.outputTokens,
    finish_reason: output.metadata.finishReason };
  for (const key of ['stateBefore', 'stateAfter']) {
    const value = output.metadata[key];
    if (value !== undefined && value !== null) {
      if (!/^[a-f0-9]{64}$/.test(value)) throw fail('MODEL_STATE', 'Expert state must be content-addressed');
      values[key === 'stateBefore' ? 'expert_state_before' : 'expert_state_after'] = value;
    }
  }
  return Object.entries(values).map(([predicate, value]) => ({ id: `model:${id}:${phase}:${predicate}`,
    subject: agent, predicate, value, source: `model-runtime:${identity.sha256}`,
    validFrom: at, validTo: at + 1, recordedAt: at, supersedes: null }));
}

export async function runModelEncounter({ journal, id, agent, scope, model, router, clock }) {
  if (!text(id, 160) || !/^[a-zA-Z0-9_-]+$/.test(id) || !isAgent(agent) || typeof clock !== 'function')
    throw fail('MODEL_ENCOUNTER', 'Supply an encounter ID, agent and host clock');
  scope = checkedScope(scope);
  const identity = copy(model?.identity);
  if (!text(identity?.name, 200) || !/^[a-f0-9]{64}$/.test(identity.sha256)
    || typeof model.generate !== 'function') throw fail('MODEL_IDENTITY', 'Model identity must name its exact weights');
  const original = decodeJournal(journal), snapshot = encodeJournal(original);
  const prefix = `model:${id}:`, previous = original.entries();
  if (previous.some(f => f.id.startsWith(prefix))) throw fail('MODEL_DUPLICATE', 'Encounter ID already exists');
  let last = Math.max(scope.knownAt, previous.at(-1)?.recordedAt ?? Number.MIN_SAFE_INTEGER);
  const tick = () => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < last || now >= Number.MAX_SAFE_INTEGER)
      throw fail('MODEL_CLOCK', 'Model observation must follow the world and its knowledge cutoff');
    last = now; return now;
  };
  let world = await createBackground(snapshot);
  const result = { format: 'lalo/model-encounter', version: 1, id, agent, scope, identity,
    startedAt: tick(), question: null, binding: null, read: null, answer: null, receipts: [], error: null };
  const action = { format: 'lalo/action', version: 1, status: 'model_error',
    request: { kind: 'model-encounter', id, agent, scope }, route: null, call: null, result };
  async function observe(phase, output, at) {
    const candidate = await createBackground(world.journal()), receipts = [];
    for (const fact of observationFacts(result, phase, output, at)) {
      await candidate.receive({ kind: 'signal', fact }); receipts.push(fact.id);
    }
    world = candidate; result.receipts.push(...receipts);
  }
  try {
    const question = checkedGeneration(await model.generate({ prompt: MODEL_QUESTION_PROMPT, phase: 'question' }));
    result.question = { prompt: MODEL_QUESTION_PROMPT, output: question, observedAt: tick() };
    await observe('question', question, result.question.observedAt);
    if (question.metadata.finishReason !== 'stop') throw fail('MODEL_TOKEN_LIMIT', 'Question exhausted its token budget');
    result.binding = bindModelQuestion(question.text, scope);
    const session = createRouteSession(createToolHost(original), router);
    result.read = await session.call(result.binding.request);
    if (result.read.status !== 'executed' || result.read.call?.name !== 'lalo_facts'
      || !result.read.result?.data?.complete) throw fail('MODEL_READ', `Don returned ${result.read.status} or an incomplete/wrong read`);
    const prompt = modelAnswerPrompt(question.text, result.read);
    const answer = checkedGeneration(await model.generate({ prompt, phase: 'answer' }));
    result.answer = { prompt, output: answer, observedAt: tick() };
    await observe('answer', answer, result.answer.observedAt);
    if (answer.metadata.finishReason !== 'stop') throw fail('MODEL_TOKEN_LIMIT', 'Answer exhausted its token budget');
    action.status = 'executed';
  } catch (error) {
    result.error = { code: error.code || 'MODEL_FAILURE', message: String(error.message || error).slice(0, 400) };
  }
  return { action, journal: world.journal() };
}

// Reopen the recorded encounter and recompute Don's read. Model speech is
// recovered verbatim from memory; no generation or expert learning runs here.
export async function replayModelEncounter(journal, action) {
  if (action?.format !== 'lalo/action' || action.version !== 1 || action.request?.kind !== 'model-encounter'
    || action.result?.format !== 'lalo/model-encounter' || action.result.version !== 1)
    throw fail('MODEL_REPLAY', 'Expected a saved model encounter');
  const saved = copy(action), data = saved.result, world = decodeJournal(journal);
  if (data.error || saved.status !== 'executed' || !data.question || !data.answer || !data.read)
    throw fail('MODEL_REPLAY', 'This encounter did not complete both directions');
  if (!sameToolResult(saved.request, { kind: 'model-encounter', id: data.id, agent: data.agent, scope: data.scope }))
    throw fail('MODEL_REPLAY', 'Saved encounter identity or scope differs');
  const bound = bindModelQuestion(data.question.output.text, data.scope, data.binding?.version);
  if (!sameToolResult(bound, data.binding) || !sameToolResult(bound.request, data.read.request)
    || data.answer.prompt !== modelAnswerPrompt(data.question.output.text, data.read))
    throw fail('MODEL_REPLAY', 'Saved question, scope, read or answer input differs');
  const receipts = [];
  for (const phase of ['question', 'answer']) {
    const generation = checkedGeneration(data[phase].output);
    for (const expected of observationFacts(data, phase, generation, data[phase].observedAt)) {
      const row = world.entries().find(f => f.id === expected.id);
      if (!row || !sameToolResult(row, expected)) throw fail('MODEL_REPLAY', 'Model observation differs from its source receipt');
      receipts.push(expected.id);
    }
  }
  if (!sameToolResult(receipts, data.receipts)) throw fail('MODEL_REPLAY', 'Saved model receipt list differs');
  const read = await createActionReplay(world, data.read).read();
  return { format: 'lalo/model-replay', version: 1, comparison: read.comparison,
    question: data.question.output.text, answer: data.answer.output.text, binding: data.binding,
    read, identity: data.identity, receipts: data.receipts };
}
