import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeInput,
  VersionMergeResult,
  VersionRedactedValue,
  VersionSemanticValue,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { mapVersionMergeAttemptMetadata } from './version-attempt-metadata';
import {
  mapGraphDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
} from './version-merge-public-diagnostics';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_MERGE_RESOLUTION_OPTION_KINDS = new Set<VersionMergeConflictResolutionOptionKind>([
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
]);
const REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS = [
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
] as const satisfies readonly VersionMergeConflictResolutionOptionKind[];
const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

export function mapMergeResult(value: unknown, fallback: VersionMergeInput): VersionMergeResult {
  if (!isRecord(value)) {
    return blockedMergeResult(fallback.base, fallback.ours, fallback.theirs, [
      providerErrorDiagnostic(),
    ]);
  }

  if (value.status === 'failed' || value.status === 'degraded' || value.status === 'blocked') {
    return blockedMergeResult(
      toCommitId(value.base) ?? fallback.base,
      toCommitId(value.ours) ?? fallback.ours,
      toCommitId(value.theirs) ?? fallback.theirs,
      mapGraphDiagnostics(value.diagnostics),
    );
  }

  if (
    value.status !== 'clean' &&
    value.status !== 'conflicted' &&
    value.status !== 'fastForward' &&
    value.status !== 'alreadyMerged'
  ) {
    return blockedMergeResult(fallback.base, fallback.ours, fallback.theirs, [
      providerErrorDiagnostic(),
    ]);
  }

  const base = toCommitId(value.base);
  const ours = toCommitId(value.ours);
  const theirs = toCommitId(value.theirs);
  const changes = Array.isArray(value.changes) ? mapMergeChanges(value.changes) : null;
  const conflicts = Array.isArray(value.conflicts) ? mapMergeConflicts(value.conflicts) : null;
  const metadata = mapVersionMergeAttemptMetadata(value);
  const mutationGuarantee = value.mutationGuarantee === 'preview-only';
  const diagnostics =
    Array.isArray(value.diagnostics) && value.diagnostics.length > 0
      ? mapGraphDiagnostics(value.diagnostics)
      : [];

  if (
    !base ||
    !ours ||
    !theirs ||
    !changes ||
    !conflicts ||
    !metadata ||
    !mutationGuarantee ||
    diagnostics.length > 0
  ) {
    return blockedMergeResult(
      base ?? fallback.base,
      ours ?? fallback.ours,
      theirs ?? fallback.theirs,
      [
        ...diagnostics,
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version merge service did not return a valid public merge preview.',
          { recoverability: 'repair' },
        ),
      ],
    );
  }

  if (value.status === 'clean') {
    if (conflicts.length > 0) {
      return blockedMergeResult(base, ours, theirs, [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version merge service returned clean status with conflicts.',
          { recoverability: 'repair' },
        ),
      ]);
    }
    return {
      ...metadata,
      status: 'clean',
      base,
      ours,
      theirs,
      changes,
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
  }

  if (value.status === 'fastForward' || value.status === 'alreadyMerged') {
    if (changes.length > 0 || conflicts.length > 0) {
      return blockedMergeResult(base, ours, theirs, [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version merge service returned ancestry status with merge changes.',
          { recoverability: 'repair' },
        ),
      ]);
    }
    return {
      ...metadata,
      status: value.status,
      base,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
  }

  return {
    ...metadata,
    status: 'conflicted',
    base,
    ours,
    theirs,
    changes,
    conflicts,
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

function mapMergeChanges(values: readonly unknown[]): readonly VersionMergeChange[] | null {
  const changes = values.map(mapMergeChange);
  return changes.some((change) => change === null) ? null : (changes as VersionMergeChange[]);
}

function mapMergeChange(value: unknown): VersionMergeChange | null {
  if (!isRecord(value)) return null;

  const structural = mapStructuralMetadata(value.structural);
  const base = mapDiffValue(value.base);
  const merged = mapDiffValue(value.merged);
  const ours = value.ours === undefined ? undefined : mapDiffValue(value.ours);
  const theirs = value.theirs === undefined ? undefined : mapDiffValue(value.theirs);
  if (
    !structural ||
    !base ||
    !merged ||
    (value.ours !== undefined && !ours) ||
    (value.theirs !== undefined && !theirs)
  ) {
    return null;
  }

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    structural,
    base,
    ...(ours ? { ours } : {}),
    ...(theirs ? { theirs } : {}),
    merged,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function mapMergeConflicts(values: readonly unknown[]): readonly VersionMergeConflict[] | null {
  const conflicts = values.map(mapMergeConflict);
  return conflicts.some((conflict) => conflict === null)
    ? null
    : (conflicts as VersionMergeConflict[]);
}

function mapMergeConflict(value: unknown): VersionMergeConflict | null {
  if (!isRecord(value) || value.conflictKind !== 'same-property') return null;

  const conflictId = typeof value.conflictId === 'string' ? value.conflictId : null;
  const conflictDigest = typeof value.conflictDigest === 'string' ? value.conflictDigest : null;
  const structural = mapStructuralMetadata(value.structural);
  const base = mapDiffValue(value.base);
  const ours = mapDiffValue(value.ours);
  const theirs = mapDiffValue(value.theirs);
  const resolutionOptions = Array.isArray(value.resolutionOptions)
    ? mapMergeResolutionOptions(value.resolutionOptions, conflictId)
    : null;
  if (
    conflictId === null ||
    conflictDigest === null ||
    !structural ||
    !base ||
    !ours ||
    !theirs ||
    !resolutionOptions
  ) {
    return null;
  }

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    conflictId,
    conflictDigest,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function mapMergeResolutionOptions(
  values: readonly unknown[],
  conflictId: string | null,
): readonly VersionMergeConflictResolutionOption[] | null {
  if (!conflictId) return null;
  const options = values.map((value) => mapMergeResolutionOption(value, conflictId));
  if (options.some((option) => option === null)) return null;
  const mapped = options as VersionMergeConflictResolutionOption[];
  const kinds = new Set(mapped.map((option) => option.kind));
  if (
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.some((kind) => !kinds.has(kind)) ||
    mapped.length !== kinds.size
  ) {
    return null;
  }
  return [...mapped].sort((left, right) => compareResolutionOptionKinds(left.kind, right.kind));
}

function mapMergeResolutionOption(
  value: unknown,
  conflictId: string,
): VersionMergeConflictResolutionOption | null {
  if (!isRecord(value)) return null;

  const optionId = typeof value.optionId === 'string' ? value.optionId : null;
  const optionConflictId = typeof value.conflictId === 'string' ? value.conflictId : null;
  const kind = isMergeResolutionOptionKind(value.kind) ? value.kind : null;
  const optionValue = mapDiffValue(value.value);
  const recalcRequired = typeof value.recalcRequired === 'boolean' ? value.recalcRequired : null;
  if (
    !optionId ||
    optionConflictId !== conflictId ||
    !kind ||
    !optionValue ||
    recalcRequired === null
  ) {
    return null;
  }

  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    optionId,
    conflictId,
    kind,
    value: optionValue,
    recalcRequired,
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function isMergeResolutionOptionKind(
  value: unknown,
): value is VersionMergeConflictResolutionOptionKind {
  return typeof value === 'string' && VERSION_MERGE_RESOLUTION_OPTION_KINDS.has(value as never);
}

function compareResolutionOptionKinds(
  left: VersionMergeConflictResolutionOptionKind,
  right: VersionMergeConflictResolutionOptionKind,
): number {
  return (
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.indexOf(left) -
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.indexOf(right)
  );
}

function mapStructuralMetadata(value: unknown): VersionDiffStructuralMetadata | null {
  if (mapRedactedValue(value)) return null;
  if (!isRecord(value)) return null;

  if (
    typeof value.changeId !== 'string' ||
    typeof value.domain !== 'string' ||
    typeof value.entityId !== 'string' ||
    !Array.isArray(value.propertyPath) ||
    !value.propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }

  return {
    kind: 'metadata',
    changeId: value.changeId,
    domain: value.domain,
    entityId: value.entityId,
    propertyPath: [...value.propertyPath],
  };
}

function mapDiffValue(value: unknown): VersionDiffValue | null {
  if (mapRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}

function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value)) return null;
  const display: {
    sheetName?: VersionDiffDisplayValue;
    address?: VersionDiffDisplayValue;
    entityLabel?: VersionDiffDisplayValue;
  } = {};

  for (const key of ['sheetName', 'address', 'entityLabel'] as const) {
    if (value[key] === undefined) continue;
    const displayValue = mapDiffDisplayValue(value[key]);
    if (!displayValue) return null;
    display[key] = displayValue;
  }
  return display;
}

function mapDiffDisplayValue(value: unknown): VersionDiffDisplayValue | null {
  if (mapRedactedValue(value)) return null;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}

function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return {
    kind: 'redacted',
    reason: value.reason as VersionRedactedValue['reason'],
  };
}

function mapSemanticValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;

  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'dateTime':
      return typeof value.iso === 'string' ? { kind: 'dateTime', iso: value.iso } : undefined;
    case 'duration':
      return typeof value.iso === 'string' ? { kind: 'duration', iso: value.iso } : undefined;
    case 'error':
      if (typeof value.code !== 'string') return undefined;
      return {
        kind: 'error',
        code: value.code,
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
    case 'formula': {
      if (typeof value.formula !== 'string') return undefined;
      if (!('result' in value)) return { kind: 'formula', formula: value.formula };
      const result = mapSemanticValue(value.result, depth + 1);
      return result === undefined ? undefined : { kind: 'formula', formula: value.formula, result };
    }
    case 'array': {
      if (!Array.isArray(value.values)) return undefined;
      const values = mapSemanticValues(value.values, depth + 1);
      return values ? { kind: 'array', values } : undefined;
    }
    case 'richText': {
      if (!Array.isArray(value.runs)) return undefined;
      const runs = value.runs.map((run) => {
        if (!isRecord(run) || typeof run.text !== 'string') return null;
        return {
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        };
      });
      if (runs.some((run) => run === null)) return undefined;
      return {
        kind: 'richText',
        runs: runs as { readonly text: string; readonly styleRef?: string }[],
      };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields = value.fields.map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null;
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        return mappedValue === undefined ? null : { key: field.key, value: mappedValue };
      });
      if (fields.some((field) => field === null)) return undefined;
      return {
        kind: 'object',
        fields: fields as { readonly key: string; readonly value: VersionSemanticValue }[],
      };
    }
    default:
      return undefined;
  }
}

function mapSemanticValues(
  values: readonly unknown[],
  depth: number,
): readonly VersionSemanticValue[] | undefined {
  const mapped = values.map((value) => mapSemanticValue(value, depth));
  return mapped.some((value) => value === undefined)
    ? undefined
    : (mapped as readonly VersionSemanticValue[]);
}

export function blockedMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
