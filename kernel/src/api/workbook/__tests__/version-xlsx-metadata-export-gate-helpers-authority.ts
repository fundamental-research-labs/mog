import type { VersionHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { maybeAddMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';

import { expectMogMetadataExportBlocked } from './version-xlsx-metadata-export-gate-helpers-assertions';
import {
  METADATA_EXPORT_DOCUMENT_ID,
  METADATA_EXPORT_GRAPH_ID,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
} from './version-xlsx-metadata-export-gate-helpers-constants';
import { metadataExportContext } from './version-xlsx-metadata-export-gate-helpers-context';
import { blockedMetadataSink } from './version-xlsx-metadata-export-gate-helpers-sinks';
import { createSourceXlsx } from './version-xlsx-metadata-export-gate-helpers-xlsx';

export function metadataExportAuthorityProvider(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly head: VersionHead;
  readonly registryDocumentId?: string;
  readonly registryWorkspaceId?: string;
  readonly registryRootCommitId?: WorkbookCommitId;
  readonly sourceRootInClosure?: boolean;
  readonly graphNamespaceGraphId?: string;
  readonly graphNamespaceWorkspaceId?: string;
  readonly registryDiagnostics?: readonly unknown[];
  readonly headDiagnostics?: readonly unknown[];
  readonly closureDiagnostics?: readonly unknown[];
}) {
  const rootCommitId = input.registryRootCommitId ?? (input.head.id as WorkbookCommitId);
  const registryWorkspaceId = input.registryWorkspaceId ?? input.workspaceId;
  const graphWorkspaceId = input.graphNamespaceWorkspaceId ?? registryWorkspaceId;
  const graphNamespace = {
    ...(graphWorkspaceId ? { workspaceId: graphWorkspaceId } : {}),
    documentId: input.documentId,
    graphId: input.graphNamespaceGraphId ?? METADATA_EXPORT_GRAPH_ID,
  };
  const rootCommit = testCommit({
    id: rootCommitId,
    documentId: input.documentId,
    parentCommitIds: [],
  });
  const headCommit = testCommit({
    id: input.head.id as WorkbookCommitId,
    documentId: input.documentId,
    parentCommitIds: input.head.id === rootCommitId ? [] : [rootCommitId],
  });
  const commitClosure =
    input.sourceRootInClosure === false
      ? [headCommit]
      : input.head.id === rootCommitId
        ? [headCommit]
        : [headCommit, rootCommit];

  return {
    documentScope: {
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      documentId: input.documentId,
    },
    accessContext: {},
    readGraphRegistry: async () => ({
      status: 'ok',
      ...(input.registryDiagnostics ? { diagnostics: input.registryDiagnostics } : {}),
      registry: {
        ...(registryWorkspaceId ? { workspaceId: registryWorkspaceId } : {}),
        documentId: input.registryDocumentId ?? input.documentId,
        currentGraphId: METADATA_EXPORT_GRAPH_ID,
        rootCommitId,
      },
    }),
    openGraph: async () => ({
      namespace: graphNamespace,
      readHead: async () => ({
        status: 'success',
        head: input.head,
        ...(input.headDiagnostics ? { diagnostics: input.headDiagnostics } : {}),
      }),
      readCommitClosure: async () => ({
        status: 'success',
        commits: commitClosure,
        diagnostics: input.closureDiagnostics ?? [],
      }),
    }),
  };
}

export async function expectAuthorityExportBlocked(
  input: {
    readonly contextWorkspaceId?: string;
    readonly exportedHead?: VersionHead;
    readonly provider: Parameters<typeof metadataExportAuthorityProvider>[0];
  },
  metadataIssue: string,
): Promise<void> {
  const exportedHead = input.exportedHead ?? input.provider.head;
  await expectMogMetadataExportBlocked(
    maybeAddMogVersionMetadataToXlsx(
      metadataExportContext({
        documentId: METADATA_EXPORT_DOCUMENT_ID,
        ...(input.contextWorkspaceId ? { workspaceId: input.contextWorkspaceId } : {}),
        provider: metadataExportAuthorityProvider(input.provider),
      }),
      { getHead: async () => ({ ok: true, value: exportedHead }) } as Parameters<
        typeof maybeAddMogVersionMetadataToXlsx
      >[1],
      await createSourceXlsx(),
      { versionMetadata: 'include' },
      blockedMetadataSink(),
    ),
    metadataIssue,
  );
}

function testCommit(input: {
  readonly id: WorkbookCommitId;
  readonly documentId: string;
  readonly parentCommitIds: readonly WorkbookCommitId[];
}) {
  return {
    id: input.id,
    payload: {
      documentId: input.documentId,
      parentCommitIds: input.parentCommitIds,
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    },
  };
}
