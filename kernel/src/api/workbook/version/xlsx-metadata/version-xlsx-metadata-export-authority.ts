import type { ObjectDigest, VersionHead, VersionResult } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import {
  isObjectDigest,
  isWorkbookCommitId,
  type WorkbookCommitId,
} from '../../../../document/version-store/object-digest';
import {
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from '../../../../document/version-store/object-store';
import {
  namespaceForRegistry,
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../../../../document/version-store/registry';
import type { WorkbookCommit } from '../../../../document/version-store/commit-store';
import type { MogVersionMetadataExportBlockReason } from './version-xlsx-metadata-export-gate';

const REF_REVISION_COUNTER_RE = /^(0|[1-9][0-9]*)$/;

type VersionMetadataHeadIdentity = {
  readonly commitId?: VersionHead['id'];
  readonly refName?: VersionHead['refName'];
  readonly resolvedFrom?: VersionHead['resolvedFrom'];
  readonly refRevision?: VersionHead['refRevision'];
};

export type MogVersionMetadataAuthoritativeHeadIdentity = VersionMetadataHeadIdentity & {
  readonly commitId: VersionHead['id'];
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
  if (!hasNoSidecarDiagnostics(head.value)) {
    return { ok: false, reason: 'redaction-failed' };
  }
  const expectedHead = graphHeadIdentity(head.value);
  if (!hasAuthoritativeHeadIdentity(expectedHead)) {
    return { ok: false, reason: 'head-unverified' };
  }

  const provider = versionStoreProviderFromContext(ctx);
  if (!provider) return { ok: false, reason: 'head-unverified' };
  const providerScope = normalizeProviderDocumentScope(provider);
  if (!providerScope || !documentScopeMatchesWorkbookContext(ctx, providerScope)) {
    return { ok: false, reason: 'head-unverified' };
  }

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') return { ok: false, reason: 'head-unverified' };
    if (!hasNoSidecarDiagnostics(registry)) {
      return { ok: false, reason: 'redaction-failed' };
    }
    const registryScope = normalizeRegistryDocumentScope(registry.registry);
    if (!registryScope || !documentScopesMatch(registryScope, providerScope)) {
      return { ok: false, reason: 'head-unverified' };
    }
    const sourceRootCommitId = registry.registry.rootCommitId;
    if (!isWorkbookCommitId(sourceRootCommitId)) {
      return { ok: false, reason: 'head-unverified' };
    }
    const namespace = namespaceForRegistry(registry.registry);

    const graph = await provider.openGraph(namespace, provider.accessContext);
    if (!graphNamespaceMatches(graph.namespace, namespace)) {
      return { ok: false, reason: 'head-unverified' };
    }

    const currentHead = await graph.readHead();
    if (currentHead.status !== 'success') return { ok: false, reason: 'head-unverified' };
    if (!hasNoSidecarDiagnostics(currentHead)) {
      return { ok: false, reason: 'redaction-failed' };
    }
    const currentHeadIdentity = graphHeadIdentity(currentHead.head);
    if (!hasAuthoritativeHeadIdentity(currentHeadIdentity)) {
      return { ok: false, reason: 'head-unverified' };
    }
    if (!metadataHeadIdentityMatchesExpected(currentHeadIdentity, expectedHead)) {
      return { ok: false, reason: 'stale-head' };
    }

    const closure = await graph.readCommitClosure(expectedHead.commitId);
    if (closure.status !== 'success') return { ok: false, reason: 'commit-missing' };
    if (!hasNoSidecarDiagnostics(closure)) {
      return { ok: false, reason: 'redaction-failed' };
    }
    const sourceRoot = closure.commits.find((commit) => commit.id === sourceRootCommitId);
    if (
      !sourceRoot ||
      !commitClosureContainsAncestor(closure.commits, expectedHead.commitId, sourceRootCommitId) ||
      sourceRoot.payload.parentCommitIds.length !== 0
    ) {
      return { ok: false, reason: 'stale-head' };
    }
    if (!commitPayloadMatchesAuthority(sourceRoot, sourceRootCommitId, providerScope.documentId)) {
      return { ok: false, reason: 'head-unverified' };
    }
    const commit = closure.commits.find((candidate) => candidate.id === expectedHead.commitId);
    if (!commit) return { ok: false, reason: 'commit-missing' };
    if (!commitPayloadMatchesAuthority(commit, expectedHead.commitId, providerScope.documentId)) {
      return { ok: false, reason: 'head-unverified' };
    }

    return {
      ok: true,
      value: {
        semanticChangeSetDigest: commit.payload.semanticChangeSetDigest,
        snapshotRootDigest: commit.payload.snapshotRootDigest,
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
    ...(isWorkbookCommitId(head.id) ? { commitId: head.id as VersionHead['id'] } : {}),
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
    isWorkbookCommitId(value.commitId) &&
    isNonEmptyString(value.refName) &&
    isNonEmptyString(value.resolvedFrom) &&
    isVersionRecordRevision(value.refRevision)
  );
}

function normalizeProviderDocumentScope(
  provider: VersionStoreProvider,
): VersionDocumentScope | null {
  try {
    return normalizeVersionDocumentScope(provider.documentScope);
  } catch {
    return null;
  }
}

function normalizeRegistryDocumentScope(registry: {
  readonly workspaceId?: unknown;
  readonly documentId?: unknown;
  readonly principalScope?: unknown;
}): VersionDocumentScope | null {
  if (typeof registry.documentId !== 'string') return null;
  if (registry.workspaceId !== undefined && typeof registry.workspaceId !== 'string') return null;
  if (registry.principalScope !== undefined && typeof registry.principalScope !== 'string') {
    return null;
  }
  try {
    return normalizeVersionDocumentScope({
      ...(registry.workspaceId === undefined ? {} : { workspaceId: registry.workspaceId }),
      documentId: registry.documentId,
      ...(registry.principalScope === undefined ? {} : { principalScope: registry.principalScope }),
    });
  } catch {
    return null;
  }
}

function documentScopeMatchesWorkbookContext(
  ctx: DocumentContext,
  providerScope: VersionDocumentScope,
): boolean {
  const contextScope = workbookContextDocumentScope(ctx);
  return (
    contextScope !== null &&
    providerScope.documentId === contextScope.documentId &&
    optionalStringMatches(providerScope.workspaceId, contextScope.workspaceId)
  );
}

function documentScopesMatch(left: VersionDocumentScope, right: VersionDocumentScope): boolean {
  return versionDocumentScopeKey(left) === versionDocumentScopeKey(right);
}

function graphNamespaceMatches(
  actual: VersionGraphNamespace,
  expected: VersionGraphNamespace,
): boolean {
  try {
    return versionGraphNamespaceKey(actual) === versionGraphNamespaceKey(expected);
  } catch {
    return false;
  }
}

function commitPayloadMatchesAuthority(
  commit: WorkbookCommit,
  expectedCommitId: VersionHead['id'],
  expectedDocumentId: string,
): boolean {
  return (
    commit.id === expectedCommitId &&
    commit.payload.documentId === expectedDocumentId &&
    isObjectDigest(commit.payload.semanticChangeSetDigest) &&
    isObjectDigest(commit.payload.snapshotRootDigest)
  );
}

function commitClosureContainsAncestor(
  commits: readonly WorkbookCommit[],
  headCommitId: VersionHead['id'],
  ancestorCommitId: WorkbookCommitId,
): boolean {
  const commitsById = new Map(commits.map((commit) => [commit.id, commit]));
  const pending = [headCommitId as WorkbookCommitId];
  const seen = new Set<WorkbookCommitId>();

  while (pending.length > 0) {
    const commitId = pending.shift() as WorkbookCommitId;
    if (seen.has(commitId)) continue;
    seen.add(commitId);
    if (commitId === ancestorCommitId) return true;

    const commit = commitsById.get(commitId);
    if (!commit) return false;
    pending.push(...commit.payload.parentCommitIds);
  }

  return false;
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

function workbookContextDocumentScope(ctx: DocumentContext): VersionDocumentScope | null {
  const linkScope = ctx.workbookLinkScope();
  if (!isRecord(linkScope) || !isNonEmptyString(linkScope.requestingDocumentId)) {
    return null;
  }
  const workspaceId =
    readNestedString(linkScope, ['workspaceId']) ??
    readNestedString(linkScope, ['requestingWorkspaceId']) ??
    readNestedString(ctx, ['kernelHostContext', 'storage', 'resourceContext', 'workspaceId']) ??
    readNestedString(ctx, ['kernelHostContext', 'session', 'workspaceId']);
  return {
    documentId: linkScope.requestingDocumentId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
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
  if (!isRecord(value) || typeof value.value !== 'string') return false;
  if (value.kind === 'counter') return REF_REVISION_COUNTER_RE.test(value.value);
  if (value.kind === 'opaque') return value.value.length > 0;
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasNoSidecarDiagnostics(value: unknown): boolean {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'diagnostics')) return true;
  return Array.isArray(value.diagnostics) && value.diagnostics.length === 0;
}

function readNestedString(value: unknown, path: readonly string[]): string | undefined {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return isNonEmptyString(current) ? current : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
