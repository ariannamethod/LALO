const utc = ms => new Date(ms).toISOString();

export function timelineSummary(timeline) {
  return `Baseline ${timeline.baselineState} at ${utc(timeline.sinceKnownAt)} · ${timeline.changeCount} ${timeline.changeCount === 1 ? 'change' : 'changes'}`;
}

export function stepHeading(row) {
  if (row.kind === 'baseline') return `Baseline · ${row.state} · ${utc(row.knownAt)}`;
  const change = row.kind === 'evidence' ? `${row.state} · evidence changed` : `${row.previousState} → ${row.state}`;
  return `${utc(row.knownAt)} · ${change}`;
}

export function evidenceSource(row, fact) {
  const removed = row.removedRole ? ` · replaces ${fact.supersedes} (${row.removedRole})` : '';
  return `${fact.source} · received ${fact.recordedAt}${removed}`;
}
