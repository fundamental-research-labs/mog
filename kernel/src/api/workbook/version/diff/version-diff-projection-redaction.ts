import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffEntry,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
} from '@mog-sdk/contracts/api';

type RedactableDiffValue =
  | VersionDiffStructuralMetadata
  | VersionDiffValue
  | VersionDiffDisplayValue;

export function redactDiffEntry(entry: VersionDiffEntry): VersionDiffEntry {
  return redactCellEntry(redactHiddenStructuralEntry(entry));
}

function redactHiddenStructuralEntry(entry: VersionDiffEntry): VersionDiffEntry {
  const reason = redactedReason(entry.structural);
  if (!reason) return entry;
  return {
    ...entry,
    before: redactVisibleValue(entry.before, reason),
    after: redactVisibleValue(entry.after, reason),
    ...(entry.display ? { display: redactVisibleDisplay(entry.display, reason) } : {}),
  };
}

function redactCellEntry(entry: VersionDiffEntry): VersionDiffEntry {
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

function redactVisibleDisplay(
  display: VersionDiffDisplay,
  reason: VersionRedactedValue['reason'],
): VersionDiffDisplay {
  return {
    ...(display.sheetName ? { sheetName: redactVisibleValue(display.sheetName, reason) } : {}),
    ...(display.address ? { address: redactVisibleValue(display.address, reason) } : {}),
    ...(display.entityLabel
      ? { entityLabel: redactVisibleValue(display.entityLabel, reason) }
      : {}),
  };
}

function redactVisibleValue<T extends RedactableDiffValue>(
  value: T,
  reason: VersionRedactedValue['reason'],
): T | VersionRedactedValue {
  return value.kind === 'redacted' ? value : redactedValue(reason);
}

function redactedReason(value: RedactableDiffValue): VersionRedactedValue['reason'] | null {
  return value.kind === 'redacted' ? value.reason : null;
}

function redactedValue(reason: VersionRedactedValue['reason']): VersionRedactedValue {
  return { kind: 'redacted', reason };
}
