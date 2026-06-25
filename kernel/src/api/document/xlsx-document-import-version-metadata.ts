import type { ObjectDigest, VersionHead } from '@mog-sdk/contracts/api';
import type { DocumentSource } from '@mog-sdk/contracts/document';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionStoreProvider,
} from '../../document/version-store/provider';
import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from '../../document/version-store/graph';
import { selectVersionStoreProvider } from '../../document/version-store/provider-registry';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../document/version-store/provider-indexeddb/backend';
import type { XlsxVersionImportRootProvenance } from '../../document/version-store/xlsx-import-root';
import {
  MOG_VERSION_METADATA_PART,
  readAndValidateMogVersionMetadataFromXlsx,
  type MogWorkbookVersionXlsxMetadata,
  type MogWorkbookVersionXlsxMetadataExpectedHead,
} from '../workbook/version/xlsx-metadata/xlsx-version-metadata';
import type { XlsxDocumentImportOptions } from './xlsx-document-import-types';

export async function xlsxVersionMetadataTrust(
  source: DocumentSource,
  documentId: string,
  options: XlsxDocumentImportOptions | undefined,
): Promise<{
  readonly trust: NonNullable<XlsxVersionImportRootProvenance['versionMetadataTrust']>;
  readonly diagnostics: XlsxVersionImportRootProvenance['diagnostics'];
  readonly versionMetadataHeadCandidate?: XlsxVersionImportRootProvenance['versionMetadataHeadCandidate'];
}> {
  if (source.type !== 'bytes') {
    return {
      trust: {
        status: 'absent',
        sidecarPart: MOG_VERSION_METADATA_PART,
      },
      diagnostics: [],
    };
  }

  const selected = selectLocalVersionMetadataAuthorityProvider(documentId, options);
  const expectedWorkspaceId = selected.provider.documentScope.workspaceId;
  const baseContext = {
    expectedDocumentId: documentId,
    ...(expectedWorkspaceId ? { expectedWorkspaceId } : {}),
  };
  try {
    const preliminary = readAndValidateMogVersionMetadataFromXlsx(source.data, baseContext);
    if (
      preliminary.status !== 'untrusted' ||
      preliminary.reason !== 'head-unverified' ||
      !preliminary.metadata?.head ||
      !metadataHeadNamesSupportedLocalRef(preliminary.metadata.head)
    ) {
      return versionMetadataTrustPayload(preliminary);
    }

    const authority = await readLocalVersionMetadataAuthority(
      selected.provider,
      preliminary.metadata.head,
    );
    const result = readAndValidateMogVersionMetadataFromXlsx(source.data, {
      ...baseContext,
      ...(authority.expectedHead ? { expectedHead: authority.expectedHead } : {}),
      ...(authority.currentHead ? { currentHead: authority.currentHead } : {}),
      ...(authority.expectedHeadFailureReason
        ? { expectedHeadFailureReason: authority.expectedHeadFailureReason }
        : {}),
    });
    return versionMetadataTrustPayload(result);
  } finally {
    if (selected.owned) {
      await selected.provider.close('dispose').catch(() => {});
    }
  }
}

function versionMetadataTrustPayload(
  result: ReturnType<typeof readAndValidateMogVersionMetadataFromXlsx>,
): {
  readonly trust: NonNullable<XlsxVersionImportRootProvenance['versionMetadataTrust']>;
  readonly diagnostics: XlsxVersionImportRootProvenance['diagnostics'];
  readonly versionMetadataHeadCandidate?: XlsxVersionImportRootProvenance['versionMetadataHeadCandidate'];
} {
  return {
    trust: result.trust,
    diagnostics: result.diagnostics,
    ...((result.status === 'trusted' || result.status === 'trusted-stale-base') &&
    result.metadata.head
      ? {
          versionMetadataHeadCandidate: {
            documentId: result.metadata.documentId,
            head: result.metadata.head,
          },
        }
      : {}),
  };
}

type LocalVersionMetadataAuthority = {
  readonly expectedHeadFailureReason?: 'commit-missing';
  readonly currentHead?: MogWorkbookVersionXlsxMetadataExpectedHead;
  readonly expectedHead?: {
    readonly commitId: VersionHead['id'];
    readonly refName?: VersionHead['refName'];
    readonly resolvedFrom?: VersionHead['resolvedFrom'];
    readonly refRevision?: VersionHead['refRevision'];
    readonly semanticChangeSetDigest: ObjectDigest;
    readonly snapshotRootDigest: ObjectDigest;
  };
};

async function readLocalVersionMetadataAuthority(
  provider: VersionStoreProvider,
  metadataHead: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
): Promise<LocalVersionMetadataAuthority> {
  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') return {};

    const graph = await provider.openGraph(
      namespaceForDocumentScope(provider.documentScope, registry.registry.currentGraphId),
      provider.accessContext,
    );
    const head = await graph.readHead();
    if (head.status !== 'success') return {};

    const commit = await graph.readCommit(head.head.id);
    if (commit.status !== 'success') return {};
    const currentHead = {
      commitId: head.head.id as VersionHead['id'],
      refName: head.head.refName as VersionHead['refName'],
      resolvedFrom: head.head.resolvedFrom as VersionHead['resolvedFrom'],
      refRevision: head.head.refRevision,
      semanticChangeSetDigest: commit.commit.payload.semanticChangeSetDigest as ObjectDigest,
      snapshotRootDigest: commit.commit.payload.snapshotRootDigest as ObjectDigest,
    };

    const baseCommit = await graph.readCommit(metadataHead.commitId);
    if (baseCommit.status !== 'success') {
      return { currentHead, expectedHeadFailureReason: 'commit-missing' };
    }

    return {
      currentHead,
      expectedHead: {
        commitId: baseCommit.commit.id as VersionHead['id'],
        refName: metadataHead.refName as VersionHead['refName'],
        resolvedFrom: metadataHead.resolvedFrom as VersionHead['resolvedFrom'],
        refRevision: metadataHead.refRevision,
        semanticChangeSetDigest: baseCommit.commit.payload.semanticChangeSetDigest as ObjectDigest,
        snapshotRootDigest: baseCommit.commit.payload.snapshotRootDigest as ObjectDigest,
      },
    };
  } catch {
    return {};
  }
}

function metadataHeadNamesSupportedLocalRef(
  head: NonNullable<MogWorkbookVersionXlsxMetadata['head']>,
): boolean {
  return head.refName === VERSION_GRAPH_MAIN_REF && head.resolvedFrom === VERSION_GRAPH_HEAD_REF;
}

function selectLocalVersionMetadataAuthorityProvider(
  documentId: string,
  options: XlsxDocumentImportOptions | undefined,
): { readonly provider: VersionStoreProvider; readonly owned: boolean } {
  const configured = options?.versioning;
  if (isVersionStoreProvider(configured?.provider)) {
    return { provider: configured.provider, owned: false };
  }

  const providerSelection = configured?.providerSelection;
  const documentScope: VersionDocumentScope = {
    ...(providerSelection?.workspaceId ? { workspaceId: providerSelection.workspaceId } : {}),
    documentId,
    ...(providerSelection?.principalScope
      ? { principalScope: providerSelection.principalScope }
      : {}),
  };

  return {
    provider: selectVersionStoreProvider({
      kind: providerSelection?.kind ?? INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      documentScope,
      readOnly: true,
      requireDurablePersistence: providerSelection?.requireDurablePersistence,
    }),
    owned: true,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
