import type {
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionRedactedValue,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import {
  stableReviewConflictIdentity,
  stableReviewResolutionOptionId,
} from './version-merge-review-conflicts-identity';
import {
  canonicalJson,
  isRecord,
  mapRedactedValue,
  projectReviewValue,
} from './version-merge-review-conflicts-projection';
import {
  invalidPreviewArtifactDiagnostic,
  mergeReviewDiagnostic,
} from './version-merge-review-artifacts';

const REQUIRED_RESOLUTION_OPTION_KINDS = [
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
] as const satisfies readonly VersionMergeConflictResolutionOptionKind[];
const UNSUPPORTED_GROUP_OR_APPROVAL_FIELDS = new Set([
  'approval',
  'approvals',
  'conflictGroup',
  'conflictGroupDigest',
  'conflictGroupId',
  'conflictOwner',
  'expectedGroupDigest',
  'groupCoreDigest',
  'groupDigest',
  'groupId',
  'groupResolutionValidation',
  'owner',
  'ownerApproval',
  'ownerApprovals',
  'owners',
  'policyVersions',
  'requiredOwnerVoteDigest',
  'requiredOwnerVotes',
]);

export type NormalizedMergeReviewConflict = {
  readonly conflict: VersionMergeConflict;
  readonly originalConflictId: string;
  readonly originalConflictDigest: string;
  readonly originalOptionIds: ReadonlyMap<VersionMergeConflictResolutionOptionKind, string>;
};

export async function normalizeMergeReviewConflict(
  operation: VersionMergePublicOperation,
  value: unknown,
): Promise<
  | ({ readonly ok: true } & NormalizedMergeReviewConflict)
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (!isRecord(value) || value.conflictKind !== 'same-property') {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }
  if (hasUnsupportedGroupOrApprovalFields(value)) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }
  if (typeof value.conflictId !== 'string' || typeof value.conflictDigest !== 'string') {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }
  const structural = mapStructuralMetadataForReview(operation, value.structural);
  if (!structural.ok) return structural;

  const base = projectReviewValue(operation, structural.structural, value.base);
  if (!base.ok) return base;
  const ours = projectReviewValue(operation, structural.structural, value.ours);
  if (!ours.ok) return ours;
  const theirs = projectReviewValue(operation, structural.structural, value.theirs);
  if (!theirs.ok) return theirs;

  const identity = await stableReviewConflictIdentity(
    structural.structural,
    base.value,
    ours.value,
    theirs.value,
  );
  const options = await normalizeMergeReviewResolutionOptions(
    operation,
    value.resolutionOptions,
    value.conflictId,
    structural.structural,
    identity,
    { acceptBase: base.value, acceptOurs: ours.value, acceptTheirs: theirs.value },
  );
  if (!options.ok) return options;

  return {
    ok: true,
    originalConflictId: value.conflictId,
    originalConflictDigest: value.conflictDigest,
    originalOptionIds: options.originalOptionIds,
    conflict: {
      conflictId: identity.conflictId,
      conflictDigest: identity.conflictDigest,
      conflictKind: 'same-property',
      structural: structural.structural,
      base: base.value,
      ours: ours.value,
      theirs: theirs.value,
      resolutionOptions: options.options,
    },
  };
}

function mapStructuralMetadataForReview(
  operation: VersionMergePublicOperation,
  value: unknown,
):
  | {
      readonly ok: true;
      readonly structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (mapRedactedValue(value)) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_REDACTION_VIOLATION',
          'Persisted merge preview conflict identity is redacted.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }
  if (
    !isRecord(value) ||
    value.kind !== 'metadata' ||
    typeof value.changeId !== 'string' ||
    typeof value.domain !== 'string' ||
    typeof value.entityId !== 'string' ||
    !isDenseStringArray(value.propertyPath)
  ) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }
  return {
    ok: true,
    structural: {
      kind: 'metadata',
      changeId: value.changeId,
      domain: value.domain,
      entityId: value.entityId,
      propertyPath: [...value.propertyPath],
    },
  };
}

async function normalizeMergeReviewResolutionOptions(
  operation: VersionMergePublicOperation,
  value: unknown,
  sourceConflictId: string,
  structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>,
  identity: { readonly conflictId: string; readonly conflictDigest: string },
  expectedValues: Record<VersionMergeConflictResolutionOptionKind, VersionDiffValue>,
): Promise<
  | {
      readonly ok: true;
      readonly options: readonly VersionMergeConflictResolutionOption[];
      readonly originalOptionIds: ReadonlyMap<VersionMergeConflictResolutionOptionKind, string>;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (!Array.isArray(value)) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }

  const byKind = new Map<VersionMergeConflictResolutionOptionKind, VersionDiffValue>();
  const recalcRequired = new Map<VersionMergeConflictResolutionOptionKind, boolean>();
  const originalOptionIds = new Map<VersionMergeConflictResolutionOptionKind, string>();
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const option = value[index];
    if (!isRecord(option) || hasUnsupportedGroupOrApprovalFields(option)) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const kind = mapResolutionOptionKind(option.kind);
    if (!kind || byKind.has(kind) || typeof option.recalcRequired !== 'boolean') {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    if (
      typeof option.conflictId !== 'string' ||
      option.conflictId !== sourceConflictId ||
      typeof option.optionId !== 'string'
    ) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const projected = projectReviewValue(operation, structural, option.value);
    if (!projected.ok) return projected;
    if (canonicalJson(projected.value) !== canonicalJson(expectedValues[kind])) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    byKind.set(kind, projected.value);
    recalcRequired.set(kind, option.recalcRequired);
    originalOptionIds.set(kind, option.optionId);
  }

  if (REQUIRED_RESOLUTION_OPTION_KINDS.some((kind) => !byKind.has(kind))) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }

  return {
    ok: true,
    originalOptionIds,
    options: await Promise.all(
      REQUIRED_RESOLUTION_OPTION_KINDS.map(async (kind) => ({
        optionId: await stableReviewResolutionOptionId(identity, kind),
        conflictId: identity.conflictId,
        kind,
        value: byKind.get(kind) ?? expectedValues[kind],
        recalcRequired: recalcRequired.get(kind) ?? true,
      })),
    ),
  };
}

function mapResolutionOptionKind(value: unknown): VersionMergeConflictResolutionOptionKind | null {
  return REQUIRED_RESOLUTION_OPTION_KINDS.includes(
    value as VersionMergeConflictResolutionOptionKind,
  )
    ? (value as VersionMergeConflictResolutionOptionKind)
    : null;
}

function hasUnsupportedGroupOrApprovalFields(value: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(value).some((key) => UNSUPPORTED_GROUP_OR_APPROVAL_FIELDS.has(key));
}

function isDenseStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index) || typeof value[index] !== 'string') {
      return false;
    }
  }
  return true;
}
