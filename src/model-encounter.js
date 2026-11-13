// One optional activity of Don: a model asks, receives receipts, and answers.
// This portable module starts no process, network request, clock or learning.
import { createBackground, isQuake, isAgent } from './background.js';
import { decodeJournal, encodeJournal } from './journal.js';
import { createToolHost, sameToolResult } from './tools.js';
import { createRouteSession } from './route.js';
import { createActionReplay } from './action-replay.js';
import { validateModelComparison, compareModelSources, modelChangePrompt, comparisonReferences } from './model-comparison.js';

const copy = value => JSON.parse(JSON.stringify(value));
const fail = (code, message) => Object.assign(new Error(message), { code });
const text = (v, n) => typeof v === 'string' && v.trim() && v.isWellFormed() && !v.includes('\0') && v.length <= n;
function checkedScope(scope, activity = 'magnitude') {
  const history = activity !== 'magnitude';
  if (!scope || Object.keys(scope).sort().join(',') !== (history ? 'knownAt,subject' : 'knownAt,subject,validAt')
    || !(activity === 'self-history' ? isAgent(scope.subject) : isQuake(scope.subject))
    || !history && !Number.isSafeInteger(scope.validAt) || !Number.isSafeInteger(scope?.knownAt))
    throw fail('MODEL_SCOPE', 'Supply the activity subject and knowledge cutoff; magnitude also needs validAt');
  return copy(scope);
}

// An intentionally small first language contract. Match the whole question:
// a different date, location, second question or constraint cannot disappear.
export function bindModelQuestion(question, scope, version = 4) {
  if (![1, 2, 3, 4].includes(version)) throw fail('MODEL_BINDING', 'Unsupported question binding');
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
  let activity = 'magnitude', rule = 'focused-quake-magnitude', predicate = 'magnitude';
  if (version >= 4 && /^(?:why did my answer change|why has my answer changed|what caused my answer to change|what was the (?:most significant )?change in the two saved answers)\?$/.test(normalized)) {
    activity = 'answer-change'; rule = 'saved-answer-change';
  } else if (version >= 3 && /^(?:what did i say(?: to you)? earlier(?: about my previous statements)?\?|(?:please )?(?:show|read) my (?:earlier|previous) (?:statements|utterances)[.!?]?)$/.test(normalized)) {
    activity = 'self-history'; rule = 'own-utterance-history'; predicate = 'utterance';
  } else if (version >= 3 && /^(?:(?:what (?:is|was) the magnitude history of|how did the magnitude change for) (?:this|the)(?: reported)? earthquake\?|(?:please )?(?:read|show) (?:this|the) earthquake(?:'s)? magnitude history[.!?]?)$/.test(normalized)) {
    activity = 'quake-history'; rule = 'quake-magnitude-history';
  } else if (!forms.some(re => re.test(normalized)))
    throw fail('MODEL_QUESTION_UNRESOLVED', 'Question is outside the focused magnitude and history language contracts');
  scope = checkedScope(scope, activity);
  const argumentSources = { subject: 'scope.subject', knownAt: 'scope.knownAt', predicate: `question:${predicate}` };
  if (activity === 'answer-change') argumentSources.predicate = 'comparison.saved-magnitude-encounters';
  if (activity === 'magnitude') argumentSources.validAt = 'scope.validAt';
  return { format: 'lalo/model-question', version, rule: `${rule}/v${version}`, question,
    scope, argumentSources,
    ...(version >= 3 ? { activity, tool: activity === 'magnitude' ? 'lalo_facts' : 'lalo_history' } : {}),
    request: { text: version === 1 ? 'read active facts' : question, arguments: { ...scope, predicate } } };
}

export const MODEL_QUESTION_PROMPT = 'You can ask Don Eduardo about an earthquake. You need its magnitude. '
  + 'Write one short question to Don. Do not answer it.';
const questionPrompts = {
  magnitude: MODEL_QUESTION_PROMPT,
  'answer-change': 'You have two saved answers. Ask Don Eduardo what changed between them. Write only a question.',
  'self-history': 'Write a short question beginning with "What did I" to ask Don Eduardo about your earlier statements.',
  'quake-history': 'You want to know how the reported earthquake magnitude changed. Ask Don Eduardo for the magnitude history. Write only a question.',
};

export function modelAnswerPrompt(question, read, activity = 'magnitude', comparison) {
  if (!Object.hasOwn(questionPrompts, activity)) throw fail('MODEL_ACTIVITY', 'Unknown model activity');
  const tool = activity === 'magnitude' ? 'lalo_facts' : 'lalo_history';
  if (read?.status !== 'executed' || read.call?.name !== tool || !read.result?.ok
    || !read.result.data?.complete) throw fail('MODEL_EVIDENCE', 'Answer needs a complete successful facts read');
  if (activity === 'answer-change') return modelChangePrompt(question, comparison, read);
  if (activity !== 'magnitude') {
    // The complete source rows remain in read. Present their ordered values
    // without clock/identifier digits competing with magnitude values.
    const items = read.result.data.items;
    if (!items.length) return `Question: ${question}\nDon found no matching history at this cutoff. State that result in one sentence.`;
    if (activity === 'self-history')
      return `Your earlier statements:\n${items.map(f => JSON.stringify(f.value)).join('\n')}\nQuote your earlier statements.`;
    return `Question: ${question}\nReported magnitudes in receipt order:\n${JSON.stringify(items.map(f => ({ magnitude: f.value })))}\nState the earlier and later magnitude values in one sentence.`;
  }
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

export async function runModelEncounter({ journal, id, agent, scope, model, router, clock, activity = 'magnitude', comparisonContext }) {
  if (!text(id, 160) || !/^[a-zA-Z0-9_-]+$/.test(id) || !isAgent(agent) || typeof clock !== 'function')
    throw fail('MODEL_ENCOUNTER', 'Supply an encounter ID, agent and host clock');
  if (!Object.hasOwn(questionPrompts, activity)) throw fail('MODEL_ACTIVITY', 'Unknown model activity');
  scope = checkedScope(scope, activity);
  if (activity === 'self-history' && scope.subject !== agent)
    throw fail('MODEL_SCOPE', 'A self-history query must name the querying agent');
  const identity = copy(model?.identity);
  if (!text(identity?.name, 200) || !/^[a-f0-9]{64}$/.test(identity.sha256)
    || typeof model.generate !== 'function') throw fail('MODEL_IDENTITY', 'Model identity must name its exact weights');
  const original = decodeJournal(journal), snapshot = encodeJournal(original);
  if (activity === 'answer-change') {
    comparisonContext = await validateModelComparison(snapshot, comparisonContext, agent, identity, replayModelEncounter);
    const later = comparisonContext.after.action.result.scope;
    if (!sameToolResult(scope, { subject: later.subject, knownAt: later.knownAt }))
      throw fail('MODEL_SCOPE', 'Comparison scope must match the later saved encounter');
  } else if (comparisonContext !== undefined) throw fail('MODEL_COMPARISON', 'Comparison context belongs to answer-change');
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
  const result = { format: 'lalo/model-encounter', version: activity === 'answer-change' ? 3 : 2, id, agent, scope, activity, identity,
    ...(activity === 'answer-change' ? { comparisonContext, comparison: null } : {}),
    startedAt: tick(), question: null, binding: null, read: null, answer: null, receipts: [], error: null };
  const action = { format: 'lalo/action', version: 1, status: 'model_error',
    request: { kind: 'model-encounter', id, agent, scope, activity,
      ...(comparisonContext ? { comparison: comparisonReferences(comparisonContext) } : {}) }, route: null, call: null, result };
  async function observe(phase, output, at) {
    const candidate = await createBackground(world.journal()), receipts = [];
    for (const fact of observationFacts(result, phase, output, at)) {
      await candidate.receive({ kind: 'signal', fact }); receipts.push(fact.id);
    }
    world = candidate; result.receipts.push(...receipts);
  }
  try {
    const question = checkedGeneration(await model.generate({ prompt: questionPrompts[activity], phase: 'question' }));
    result.question = { prompt: questionPrompts[activity], output: question, observedAt: tick() };
    await observe('question', question, result.question.observedAt);
    if (question.metadata.finishReason !== 'stop') throw fail('MODEL_TOKEN_LIMIT', 'Question exhausted its token budget');
    result.binding = bindModelQuestion(question.text, scope);
    if (result.binding.activity !== activity) throw fail('MODEL_QUESTION_UNRESOLVED', 'Question does not match the requested activity');
    const session = createRouteSession(createToolHost(original), router);
    result.read = await session.call(result.binding.request);
    if (result.read.status !== 'executed' || result.read.call?.name !== result.binding.tool
      || !result.read.result?.data?.complete) throw fail('MODEL_READ', `Don returned ${result.read.status} or an incomplete/wrong read`);
    if (activity === 'answer-change') result.comparison = compareModelSources(comparisonContext, result.read);
    const prompt = modelAnswerPrompt(question.text, result.read, activity, result.comparison);
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
    || action.result?.format !== 'lalo/model-encounter' || ![1, 2, 3].includes(action.result.version))
    throw fail('MODEL_REPLAY', 'Expected a saved model encounter');
  const saved = copy(action), data = saved.result, world = decodeJournal(journal);
  if (data.error || saved.status !== 'executed' || !data.question || !data.answer || !data.read)
    throw fail('MODEL_REPLAY', 'This encounter did not complete both directions');
  const activity = data.version === 1 ? 'magnitude' : data.activity;
  checkedScope(data.scope, activity);
  if (data.version === 3) {
    if (activity !== 'answer-change') throw fail('MODEL_REPLAY', 'Version 3 requires a saved answer comparison');
    const context = await validateModelComparison(journal, data.comparisonContext, data.agent, data.identity, replayModelEncounter);
    const comparison = compareModelSources(context, data.read);
    if (!sameToolResult(comparison, data.comparison)) throw fail('MODEL_REPLAY', 'Saved source comparison differs');
  } else if (activity === 'answer-change') throw fail('MODEL_REPLAY', 'Answer comparison requires encounter version 3');
  if (activity === 'self-history' && data.scope.subject !== data.agent)
    throw fail('MODEL_REPLAY', 'Saved self-history names another agent');
  if (!Object.hasOwn(questionPrompts, activity) || data.question.prompt !== questionPrompts[activity]
    || !sameToolResult(saved.request, { kind: 'model-encounter', id: data.id, agent: data.agent, scope: data.scope,
      ...(data.version >= 2 ? { activity } : {}),
      ...(data.version === 3 ? { comparison: comparisonReferences(data.comparisonContext) } : {}) }))
    throw fail('MODEL_REPLAY', 'Saved encounter identity or scope differs');
  const bound = bindModelQuestion(data.question.output.text, data.scope, data.binding?.version);
  if (!sameToolResult(bound, data.binding) || !sameToolResult(bound.request, data.read.request)
    || data.binding.version >= 3 && data.binding.activity !== activity
    || data.answer.prompt !== modelAnswerPrompt(data.question.output.text, data.read, activity, data.comparison))
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
    read, identity: data.identity, receipts: data.receipts,
    ...(data.version === 3 ? { sourceComparison: data.comparison } : {}) };
}
