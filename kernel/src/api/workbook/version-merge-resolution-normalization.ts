import type { VersionApplyMergeResolution, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { normalizeSealedResolutionPayloadRefInput } from './version/merge-review/version-merge-sealed-payload-normalization';

const RESOLUTION_KEYS = new Set([
  'conflictId',
  'expectedConflictDigest',
  'optionId',
  'kind',
  'sealedPayloadRef',
]);

type InvalidDiagnostic = (path: string, safeMessage: string) => VersionStoreDiagnostic;

export function normalizeVersionApplyMergeResolutions(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
  options: {
    readonly allowUndefined: boolean;
    readonly invalidDiagnostic: InvalidDiagnostic;
  },
): readonly VersionApplyMergeResolution[] | null {
  if (value === undefined) {
    if (options.allowUndefined) return [];
    diagnostics.push(options.invalidDiagnostic('resolutions', 'resolutions must be an array.'));
    return null;
  }
  if (!Array.isArray(value)) {
    diagnostics.push(options.invalidDiagnostic('resolutions', 'resolutions must be an array.'));
    return null;
  }

  const resolutions: VersionApplyMergeResolution[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (!isRecord(item) || Array.isArray(item)) {
      diagnostics.push(
        options.invalidDiagnostic(`resolutions[${index}]`, 'resolution entries must be objects.'),
      );
      continue;
    }
    for (const key of Object.keys(item)) {
      if (RESOLUTION_KEYS.has(key)) continue;
      diagnostics.push(
        options.invalidDiagnostic(
          `resolutions[${index}].${key}`,
          `Unknown resolution field "${key}".`,
        ),
      );
    }

    const conflictId =
      typeof item.conflictId === 'string' && item.conflictId.length > 0 ? item.conflictId : null;
    const expectedConflictDigest =
      typeof item.expectedConflictDigest === 'string' && item.expectedConflictDigest.length > 0
        ? item.expectedConflictDigest
        : null;
    const optionId =
      typeof item.optionId === 'string' && item.optionId.length > 0 ? item.optionId : null;
    const kind =
      item.kind === 'acceptOurs' || item.kind === 'acceptTheirs' || item.kind === 'acceptBase'
        ? item.kind
        : null;
    const sealedPayloadRef =
      item.sealedPayloadRef === undefined
        ? undefined
        : normalizeSealedResolutionPayloadRefInput(
            item.sealedPayloadRef,
            `resolutions[${index}].sealedPayloadRef`,
            options.invalidDiagnostic,
            diagnostics,
          );

    if (!conflictId) {
      diagnostics.push(
        options.invalidDiagnostic(`resolutions[${index}].conflictId`, 'conflictId is required.'),
      );
    }
    if (!expectedConflictDigest) {
      diagnostics.push(
        options.invalidDiagnostic(
          `resolutions[${index}].expectedConflictDigest`,
          'expectedConflictDigest is required.',
        ),
      );
    }
    if (!optionId) {
      diagnostics.push(
        options.invalidDiagnostic(`resolutions[${index}].optionId`, 'optionId is required.'),
      );
    }
    if (!kind) {
      diagnostics.push(
        options.invalidDiagnostic(
          `resolutions[${index}].kind`,
          'resolution kind must be acceptOurs, acceptTheirs, or acceptBase.',
        ),
      );
    }
    if (
      conflictId &&
      expectedConflictDigest &&
      optionId &&
      kind &&
      (item.sealedPayloadRef === undefined || sealedPayloadRef)
    ) {
      resolutions.push({
        conflictId,
        expectedConflictDigest,
        optionId,
        kind,
        ...(sealedPayloadRef ? { sealedPayloadRef } : {}),
      });
    }
  }
  return diagnostics.length === 0 ? resolutions : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
