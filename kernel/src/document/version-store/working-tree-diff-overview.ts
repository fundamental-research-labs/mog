import type {
  ObjectDigest,
  VersionMainRefName,
  VersionRefName,
  VersionWorkingTreeDiffId,
  VersionWorkingTreeDiffOptions,
  VersionWorkingTreeDiffOverview,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { canonicalJsonStringify, sha256ObjectDigest, utf8Encode } from './object-store-canonical';
import type { DiffServiceDegradedResult } from './diff-service-diagnostics';
import { buildDiffOverview, type DiffSemanticContext } from './diff-service-overview';

export type WorkingTreeDiffOverviewObservation = {
  readonly active: {
    readonly head: {
      readonly id: WorkbookCommitId;
    };
  };
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly basis: {
    readonly revision: number;
  };
  readonly surface: {
    readonly dirty: {
      readonly statusRevision: string;
      readonly checkoutPreflightToken: string;
    };
  };
  readonly baseSemanticStateDigest: ObjectDigest;
  readonly currentSemanticStateDigest: ObjectDigest;
};

export type WorkingTreeDiffOverviewEntries = {
  readonly semanticPayload: unknown;
  readonly changeSetDigest: ObjectDigest;
};

export type WorkingTreeDiffOverviewIdentity = {
  readonly workingTreeDiffId: VersionWorkingTreeDiffId;
};

export async function buildWorkingTreeDiffOverview(
  observation: WorkingTreeDiffOverviewObservation,
  entries: WorkingTreeDiffOverviewEntries,
  identity: WorkingTreeDiffOverviewIdentity,
  options: VersionWorkingTreeDiffOptions['overview'] = {},
): Promise<VersionWorkingTreeDiffOverview | DiffServiceDegradedResult> {
  const syntheticTargetCommitId = syntheticWorkingTreeTargetCommitId(identity.workingTreeDiffId);
  const readRevision = {
    kind: 'opaque' as const,
    value: identity.workingTreeDiffId,
  };
  const overview = await buildDiffOverview(
    {
      baseCommitId: observation.active.head.id,
      targetCommitId: syntheticTargetCommitId,
      changeSetDigest: entries.changeSetDigest,
      readRevision,
      semanticPayload: entries.semanticPayload,
    } satisfies DiffSemanticContext,
    options,
  );
  if (isDiffServiceDegradedResult(overview)) return overview;

  const publicOverview = { ...overview };
  delete (publicOverview as { targetCommitId?: WorkbookCommitId }).targetCommitId;
  return {
    ...publicOverview,
    kind: 'workingTree',
    workingTreeDiffId: identity.workingTreeDiffId,
    ...(observation.targetRef ? { targetRef: observation.targetRef } : {}),
    captureRevision: observation.basis.revision,
    dirtyStatusRevision: observation.surface.dirty.statusRevision,
    checkoutPreflightToken: observation.surface.dirty.checkoutPreflightToken,
    baseSemanticStateDigest: observation.baseSemanticStateDigest,
    currentSemanticStateDigest: observation.currentSemanticStateDigest,
  };
}

export function workingTreeSemanticPayload(input: {
  readonly schemaVersion?: 1;
  readonly source: Readonly<Record<string, unknown>>;
  readonly changes: readonly unknown[];
  readonly semanticDiff?: unknown;
}): unknown {
  return {
    schemaVersion: input.schemaVersion ?? 1,
    source: input.source,
    changes: input.changes,
    ...(input.semanticDiff ? { semanticDiff: input.semanticDiff } : {}),
  };
}

export async function workingTreeSemanticPayloadDigest(payload: unknown): Promise<ObjectDigest> {
  return sha256ObjectDigest(
    utf8Encode(
      canonicalJsonStringify({
        schemaVersion: 1,
        kind: 'workingTreeSemanticChangeSet',
        payload,
      }),
    ),
  );
}

export function isDiffServiceDegradedResult(
  value: unknown,
): value is DiffServiceDegradedResult {
  return isRecord(value) && value.status === 'degraded';
}

function syntheticWorkingTreeTargetCommitId(
  workingTreeDiffId: VersionWorkingTreeDiffId,
): WorkbookCommitId {
  const digest = workingTreeDiffId.slice('working-tree-diff:sha256:'.length);
  return `commit:sha256:${digest}` as WorkbookCommitId;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
