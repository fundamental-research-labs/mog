import type { ObjectDigest, VersionHead, VersionResult } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  namespaceForDocumentScope,
  type VersionStoreProvider,
} from '../../document/version-store/provider';
import type { MogVersionMetadataExportBlockReason } from './version-xlsx-metadata-export-gate';

type VersionMetadataHeadIdentity = {
  readonly commitId: VersionHead['id'];
  readonly refName?: VersionHead['refName'];
  readonly resolvedFrom?: VersionHead['resolvedFrom'];
  readonly refRevision?: VersionHead['refRevision'];
};

export type MogVersionMetadataAuthoritativeHeadIdentity = VersionMetadataHeadIdentity & {
  readonly refName: NonNullable<VersionHead['refName']>;
  readonly resolvedFrom: NonNullable<VersionHead['resolvedFrom']>;
  readonly refRevision: NonNullable<VersionHead['refRevision']>;
};

export type MogVersionMetadataHeadAuthorityResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly semanticChangeSetDigest: ObjectDigest;
        readonly snapshotRootDigest: ObjectDigest;
        readonly currentHead: MogVersionMetadataAuthoritativeHeadIdentity;
      };
    }
  | { readonly ok: false; readonly reason: MogVersionMetadataExportBlockReason };

export async function readCurrentHeadLocalObjectStoreAuthority(
  ctx: DocumentContext,
  head: VersionResult<VersionHead>,
): Promise<MogVersionMetadataHeadAuthorityResult> {
  if (!head.ok) return { ok: false, reason: 'head-read-failed' };
  const expectedHead = graphHeadIdentity(head.value);
  if (!hasAuthoritativeHeadIdentity(expectedHead)) {
    return { ok: false, reason: 'head-unverified' };
  }

  const provider = versionStoreProviderFromContext(ctx);
  if (!provider) return { ok: false, reason: 'head-unverified' };

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') return { ok: false, reason: 'head-unverified' };

    const graph = await provider.openGraph(
      namespaceForDocumentScope(provider.documentScope, registry.registry.currentGraphId),
      provider.accessContext,
    );
    const currentHead = await graph.readHead();
    if (currentHead.status !== 'success') return { ok: false, reason: 'head-unverified' };
    const currentHeadIdentity = graphHeadIdentity(currentHead.head);
    if (!hasAuthoritativeHeadIdentity(currentHeadIdentity)) {
      return { ok: false, reason: 'head-unverified' };
    }
    if (!metadataHeadIdentityMatchesExpected(currentHeadIdentity, expectedHead)) {
      return { ok: false, reason: 'stale-head' };
    }

    const commit = await graph.readCommit(head.value.id);
    if (commit.status !== 'success') return { ok: false, reason: 'commit-missing' };
    return {
      ok: true,
      value: {
        semanticChangeSetDigest: commit.commit.payload.semanticChangeSetDigest,
        snapshotRootDigest: commit.commit.payload.snapshotRootDigest,
        currentHead: currentHeadIdentity,
      },
    };
  } catch {
    return { ok: false, reason: 'head-unverified' };
  }
}

function graphHeadIdentity(head: {
  readonly id: unknown;
  readonly refName?: unknown;
  readonly resolvedFrom?: unknown;
  readonly refRevision?: unknown;
}): VersionMetadataHeadIdentity {
  return {
    commitId: head.id as VersionHead['id'],
    ...(typeof head.refName === 'string'
      ? { refName: head.refName as VersionHead['refName'] }
      : {}),
    ...(typeof head.resolvedFrom === 'string'
      ? { resolvedFrom: head.resolvedFrom as VersionHead['resolvedFrom'] }
      : {}),
    ...(isVersionRecordRevision(head.refRevision) ? { refRevision: head.refRevision } : {}),
  };
}

function metadataHeadIdentityMatchesExpected(
  actual: VersionMetadataHeadIdentity,
  expected: VersionMetadataHeadIdentity,
): boolean {
  return (
    actual.commitId === expected.commitId &&
    optionalStringMatches(actual.refName, expected.refName) &&
    optionalStringMatches(actual.resolvedFrom, expected.resolvedFrom) &&
    versionRecordRevisionMatches(actual.refRevision, expected.refRevision)
  );
}

function optionalStringMatches(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function versionRecordRevisionMatches(
  left: VersionHead['refRevision'] | undefined,
  right: VersionHead['refRevision'] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.kind === right.kind && left.value === right.value;
}

function hasAuthoritativeHeadIdentity(
  value: VersionMetadataHeadIdentity,
): value is MogVersionMetadataAuthoritativeHeadIdentity {
  return (
    isNonEmptyString(value.commitId) &&
    isNonEmptyString(value.refName) &&
    isNonEmptyString(value.resolvedFrom) &&
    isVersionRecordRevision(value.refRevision)
  );
}

function versionStoreProviderFromContext(ctx: DocumentContext): VersionStoreProvider | undefined {
  const runtime = ctx as {
    readonly versioning?: unknown;
    readonly versionStore?: unknown;
    readonly version?: unknown;
  };
  for (const services of [runtime.versioning, runtime.versionStore, runtime.version]) {
    if (!isRecord(services)) continue;
    if (isVersionStoreProvider(services.provider)) return services.provider;
  }
  return undefined;
}

function isVersionStoreProvider(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    isRecord(value.documentScope) &&
    isRecord(value.accessContext) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

function isVersionRecordRevision(value: unknown): value is NonNullable<VersionHead['refRevision']> {
  return (
    isRecord(value) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string'
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
