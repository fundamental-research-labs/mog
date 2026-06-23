import type {
  VersionDiffDisplay,
  VersionDiffEntry,
  VersionDiffValue,
  VersionRedactedValue,
} from '@mog-sdk/contracts/api';

export function redactCellEntry(entry: VersionDiffEntry): VersionDiffEntry {
  if (entry.structural.kind !== 'metadata' || entry.structural.domain !== 'cell') return entry;
  const reason = redactedReason(entry.before) ?? redactedReason(entry.after);
  if (!reason) return entry;
  const structural = redactedValue(reason);
  return {
    ...entry,
    structural,
    ...(entry.display ? { display: redactDisplay(entry.display, reason) } : {}),
  };
}

function redactDisplay(
  display: VersionDiffDisplay,
  reason: VersionRedactedValue['reason'],
): VersionDiffDisplay {
  const redacted = redactedValue(reason);
  return {
    ...(display.sheetName ? { sheetName: redacted } : {}),
    ...(display.address ? { address: redacted } : {}),
    ...(display.entityLabel ? { entityLabel: redacted } : {}),
  };
}

function redactedReason(value: VersionDiffValue): VersionRedactedValue['reason'] | null {
  return value.kind === 'redacted' ? value.reason : null;
}

function redactedValue(reason: VersionRedactedValue['reason']): VersionRedactedValue {
  return { kind: 'redacted', reason };
}
