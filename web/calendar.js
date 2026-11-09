export function receiptTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? `${value} ms` : date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

export function calendarSummary({ civil, assertion, lag, perspective, originChoice, comparison }, proposal) {
  const gregorian = [civil.gregorian_year, civil.gregorian_month, civil.gregorian_day].join('-');
  const hebrew = [civil.hebrew_year, civil.hebrew_month, civil.hebrew_day].join('-');
  const delta = `${lag.sign < 0 ? '−' : ''}${lag.days}d ${lag.seconds}s ${lag.milliseconds}ms`;
  let summary = `${assertion.id} · Gregorian ${gregorian} · Hebrew ${hebrew} · JANUS epoch day ${civil.epoch_day} · occurrence → receipt ${delta}`;
  if (comparison) {
    summary += ` · Compared with ${comparison.assertion.id}`;
    const first = order => order < 0 ? assertion.id : comparison.assertion.id;
    const occurrence = comparison.occurrence.order, receipt = comparison.receipt.order;
    summary += occurrence === 0 ? ' · Occurred at the same instant' : ` · Occurred first: ${first(occurrence)}`;
    summary += receipt === 0 ? ' · Received at the same instant' : ` · Received first: ${first(receipt)}`;
  }
  if (proposal) return `${summary} · Origin proposed for ${proposal.agent}: ${proposal.originId}`;
  if (!perspective) return summary;
  const days = perspective.coordinates.age_days;
  const age = `${days} calendar ${Math.abs(days) === 1 ? 'day' : 'days'} from ${perspective.originId}`;
  return originChoice ? `${summary} · ${age} · chosen by ${originChoice.subject} (${originChoice.id})`
    : `${summary} · ${age} (this read)`;
}
