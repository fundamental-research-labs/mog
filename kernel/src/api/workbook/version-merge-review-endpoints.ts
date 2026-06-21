import type {
  VersionGetMergeConflictDetailRequest,
  VersionMergeConflictDetailResult,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  getVersionMergeCapabilityDecision,
  type VersionMergePublicOperation,
  type VersionMergePublicCapability,
  versionMergeCapabilityDisabledDiagnostic,
} from './version-merge-capability';
import {
  versionFailureFromStoreDiagnostics,
  versionResultFromMergeEndpointDiagnostics,
} from './version-result';

export function saveMergeResolutionsWorkbookVersion(
  ctx: DocumentContext,
  _input: VersionSaveMergeResolutionsRequest,
): VersionResult<VersionSaveMergeResolutionsResult> {
  return mergeEndpointPreflight(ctx, 'saveMergeResolutions')
    ?? mergeEndpointUnavailable('saveMergeResolutions');
}

export function getMergeConflictDetailWorkbookVersion(
  ctx: DocumentContext,
  _input: VersionGetMergeConflictDetailRequest,
): VersionResult<VersionMergeConflictDetailResult> {
  return mergeEndpointPreflight(ctx, 'getMergeConflictDetail')
    ?? mergeEndpointUnavailable('getMergeConflictDetail');
}

export function putMergeResolutionPayloadWorkbookVersion(
  ctx: DocumentContext,
  _input: VersionPutMergeResolutionPayloadRequest,
): VersionResult<VersionPutMergeResolutionPayloadResult> {
  return mergeEndpointPreflight(ctx, 'putMergeResolutionPayload')
    ?? mergeEndpointUnavailable('putMergeResolutionPayload');
}

function mergeEndpointPreflight<T>(
  ctx: DocumentContext,
  operation: VersionMergePublicOperation,
): VersionResult<T> | null {
  const decision = getVersionMergeCapabilityDecision(ctx, capabilityForOperation(operation));
  if (decision.enabled) return null;
  return versionResultFromMergeEndpointDiagnostics(operation, [
    versionMergeCapabilityDisabledDiagnostic(operation, decision),
  ]);
}

function capabilityForOperation(operation: VersionMergePublicOperation): VersionMergePublicCapability {
  switch (operation) {
    case 'merge':
    case 'getMergeConflictDetail':
      return 'version:mergePreview';
    case 'applyMerge':
    case 'saveMergeResolutions':
    case 'putMergeResolutionPayload':
      return 'version:mergeApply';
  }
}

function mergeEndpointUnavailable<T>(operation: VersionMergePublicOperation): VersionResult<T> {
  return versionFailureFromStoreDiagnostics(operation, [mergeReviewEndpointUnavailable(operation)]);
}

function mergeReviewEndpointUnavailable(operation: VersionMergePublicOperation): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_MERGE_REVIEW_ENDPOINT_UNAVAILABLE',
    severity: 'error',
    recoverability: 'unsupported',
    messageTemplateId: `version.${operation}.endpointUnavailable`,
    safeMessage: 'Version-control merge review endpoint storage is not attached in this surface slice.',
    payload: {
      operation,
      endpointStatus: 'blocked',
      capability: 'versionControl.merge',
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}
