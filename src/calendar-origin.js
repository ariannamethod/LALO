import { calendarTimestampSupported } from './janus-calendar.js';

// An agent fixes one witnessed receipt as its calendar origin in this journal.
export const DON_EDUARDO = 'agent:don-eduardo';
export const ORIGIN_SOURCE = 'lalo:action/calendar-origin/v1';
export const ORIGIN_PREDICATE = 'calendar_origin';
export const isAgent = value => typeof value === 'string' && /^agent:[a-zA-Z0-9_-]{1,100}$/.test(value);

export function calendarOrigins(records) {
  const seen = new Map(), origins = new Map();
  for (const fact of records) {
    if (seen.get(fact.supersedes)?.source === ORIGIN_SOURCE)
      throw new Error('A recorded calendar origin is fixed');
    if (fact.source === ORIGIN_SOURCE) {
      const anchor = seen.get(fact.value);
      if (!anchor || !calendarTimestampSupported(anchor.validFrom) || !calendarTimestampSupported(anchor.recordedAt)
        || !isAgent(fact.subject) || fact.predicate !== ORIGIN_PREDICATE
        || fact.validFrom !== fact.recordedAt || fact.validTo !== null || fact.supersedes !== null)
        throw new Error('Invalid calendar origin receipt or missing prior anchor');
      if (origins.has(fact.subject)) throw new Error('Agent already has a calendar origin');
      origins.set(fact.subject, { choice: fact, anchor });
    }
    seen.set(fact.id, fact);
  }
  return origins;
}

export function originFact({ agent, id, receivedAt, trace }, anchor, prior) {
  const args = trace.call.arguments, data = trace.result?.data;
  const proposal = data?.originProposal, perspective = data?.calendar?.perspective;
  if (!anchor || data.calendar.error || data.calendar.originId !== anchor.id
    || perspective?.originId !== anchor.id || perspective.validFrom !== anchor.validFrom
    || perspective.recordedAt !== anchor.recordedAt || perspective.source !== anchor.source
    || perspective.coordinates?.age_days !== 0 || proposal?.originId !== anchor.id)
    throw new Error('Calendar origin action differs from its known anchor');
  if ((args.agent ?? DON_EDUARDO) !== agent || proposal.agent !== agent || args.originId !== undefined
    || args.knownAt !== data.knownAt || !Number.isSafeInteger(receivedAt) || args.knownAt > receivedAt)
    throw new Error('Calendar origin action differs from its agent or cutoff');
  if (prior) {
    if (prior.id === id && prior.value === anchor.id && prior.recordedAt === receivedAt) return null;
    throw new Error('Agent already has a calendar origin');
  }
  return { id, subject: agent, predicate: ORIGIN_PREDICATE, value: anchor.id, source: ORIGIN_SOURCE,
    validFrom: receivedAt, validTo: null, recordedAt: receivedAt, supersedes: null };
}
