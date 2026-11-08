export function calendarSummary({ civil, assertion, lag, perspective, originChoice }, proposal) {
  const gregorian = [civil.gregorian_year, civil.gregorian_month, civil.gregorian_day].join('-');
  const hebrew = [civil.hebrew_year, civil.hebrew_month, civil.hebrew_day].join('-');
  const delta = `${lag.sign < 0 ? '−' : ''}${lag.days}d ${lag.seconds}s ${lag.milliseconds}ms`;
  const summary = `${assertion.id} · Gregorian ${gregorian} · Hebrew ${hebrew} · JANUS epoch day ${civil.epoch_day} · occurrence → receipt ${delta}`;
  if (proposal) return `${summary} · Origin proposed for ${proposal.agent}: ${proposal.originId}`;
  if (!perspective) return summary;
  const days = perspective.coordinates.age_days;
  const age = `${days} calendar ${Math.abs(days) === 1 ? 'day' : 'days'} from ${perspective.originId}`;
  return originChoice ? `${summary} · ${age} · chosen by ${originChoice.subject} (${originChoice.id})`
    : `${summary} · ${age} (this read)`;
}
