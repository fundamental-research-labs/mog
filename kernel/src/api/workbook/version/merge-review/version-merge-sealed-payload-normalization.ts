import type {
  VersionMergeResultId,
  VersionSealedResolutionPayloadRef,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { mapPublicObjectDigest } from '../../version-attempt-metadata';
import { isRecord } from './version-merge-sealed-payload-utils';

const SEALED_REF_KEYS = new Set([
  'schemaVersion',
  'kind',
  'payloadId',
  'payloadDigest',
  'storageMode',
  'resultId',
  'resultDigest',
  'conflictId',
  'optionId',
  'resolutionKind',
  'expiresAt',
]);

type InvalidDiagnostic = (path: string, safeMessage: string) => VersionStoreDiagnostic;

export function normalizeSealedResolutionPayloadRefInput(
  value: unknown,
  path: string,
  invalidDiagnostic: InvalidDiagnostic,
  diagnostics: VersionStoreDiagnostic[],
): VersionSealedResolutionPayloadRef | null {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidDiagnostic(path, 'sealedPayloadRef must be an object.'));
    return null;
  }
  for (const key of Object.keys(value)) {
    if (SEALED_REF_KEYS.has(key)) continue;
    diagnostics.push(
      invalidDiagnostic(`${path}.${key}`, `Unknown sealedPayloadRef field "${key}".`),
    );
  }

  const schemaVersion = value.schemaVersion === 1 ? 1 : null;
  const kind = value.kind === 'sealedResolutionPayload' ? value.kind : null;
  const payloadId =
    typeof value.payloadId === 'string' && value.payloadId.startsWith('merge-payload:')
      ? (value.payloadId as `merge-payload:${string}`)
      : null;
  const payloadDigest = mapPublicObjectDigest(value.payloadDigest);
  const storageMode =
    value.storageMode === 'serverEncrypted' || value.storageMode === 'localOnly'
      ? value.storageMode
      : null;
  const resultId =
    typeof value.resultId === 'string' && value.resultId.startsWith('merge-result:')
      ? (value.resultId as VersionMergeResultId)
      : null;
  const resultDigest = mapPublicObjectDigest(value.resultDigest);
  const conflictId =
    typeof value.conflictId === 'string' && value.conflictId.length > 0 ? value.conflictId : null;
  const optionId =
    typeof value.optionId === 'string' && value.optionId.length > 0 ? value.optionId : null;
  const resolutionKind =
    value.resolutionKind === 'acceptOurs' ||
    value.resolutionKind === 'acceptTheirs' ||
    value.resolutionKind === 'acceptBase'
      ? value.resolutionKind
      : null;
  const expiresAt =
    value.expiresAt === undefined
      ? undefined
      : typeof value.expiresAt === 'string' && value.expiresAt.length > 0
        ? value.expiresAt
        : null;

  if (!schemaVersion)
    diagnostics.push(invalidDiagnostic(`${path}.schemaVersion`, 'schemaVersion must be 1.'));
  if (!kind)
    diagnostics.push(invalidDiagnostic(`${path}.kind`, 'kind must be sealedResolutionPayload.'));
  if (!payloadId) diagnostics.push(invalidDiagnostic(`${path}.payloadId`, 'payloadId is invalid.'));
  if (!payloadDigest)
    diagnostics.push(invalidDiagnostic(`${path}.payloadDigest`, 'payloadDigest is invalid.'));
  if (!storageMode)
    diagnostics.push(invalidDiagnostic(`${path}.storageMode`, 'storageMode is invalid.'));
  if (!resultId) diagnostics.push(invalidDiagnostic(`${path}.resultId`, 'resultId is invalid.'));
  if (!resultDigest)
    diagnostics.push(invalidDiagnostic(`${path}.resultDigest`, 'resultDigest is invalid.'));
  if (!conflictId)
    diagnostics.push(invalidDiagnostic(`${path}.conflictId`, 'conflictId is required.'));
  if (!optionId) diagnostics.push(invalidDiagnostic(`${path}.optionId`, 'optionId is required.'));
  if (!resolutionKind) {
    diagnostics.push(invalidDiagnostic(`${path}.resolutionKind`, 'resolutionKind is invalid.'));
  }
  if (expiresAt === null)
    diagnostics.push(invalidDiagnostic(`${path}.expiresAt`, 'expiresAt is invalid.'));

  if (
    !schemaVersion ||
    !kind ||
    !payloadId ||
    !payloadDigest ||
    !storageMode ||
    !resultId ||
    !resultDigest ||
    !conflictId ||
    !optionId ||
    !resolutionKind ||
    expiresAt === null
  ) {
    return null;
  }

  return {
    schemaVersion,
    kind,
    payloadId,
    payloadDigest,
    storageMode,
    resultId,
    resultDigest,
    conflictId,
    optionId,
    resolutionKind,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}
