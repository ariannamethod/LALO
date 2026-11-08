export function calendarSummary({ civil, assertion, lag }) {
  const gregorian = [civil.gregorian_year, civil.gregorian_month, civil.gregorian_day].join('-');
  const hebrew = [civil.hebrew_year, civil.hebrew_month, civil.hebrew_day].join('-');
  const delta = `${lag.sign < 0 ? '−' : ''}${lag.days}d ${lag.seconds}s ${lag.milliseconds}ms`;
  return `${assertion.id} · Gregorian ${gregorian} · Hebrew ${hebrew} · JANUS epoch day ${civil.epoch_day} · occurrence → receipt ${delta}`;
}
