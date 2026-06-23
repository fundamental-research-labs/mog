import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';

import type { DocumentWorkbookVersioningLifecycleConfig } from './lifecycle';
import { namespaceForDocumentScope, normalizeVersionDocumentScope } from './provider';
import { BLANK_WORKBOOK_ROOT_GRAPH_ID, buildBlankWorkbookRootWrite } from './blank-workbook-root';
import {
  buildXlsxVersionImportRootWrite,
  XLSX_IMPORT_ROOT_GRAPH_ID,
  type XlsxVersionExistingGraphImportInput,
  type XlsxVersionImportRootProvenance,
} from './xlsx-import-root';

type VersioningWithRootCapturePorts = DocumentWorkbookVersioningLifecycleConfig & {
  readonly snapshotRootByteSyncPort: NonNullable<
    DocumentWorkbookVersioningLifecycleConfig['snapshotRootByteSyncPort']
  >;
  readonly semanticStateReader: NonNullable<
    DocumentWorkbookVersioningLifecycleConfig['semanticStateReader']
  >;
};

export async function withDocumentRootInitializer(input: {
  readonly documentId: string;
  readonly versioning: VersioningWithRootCapturePorts;
  readonly xlsxImportRoot?: XlsxVersionImportRootProvenance;
  readonly blankWorkbookRootInitializerEnabled: boolean;
  readonly createdAt: string;
}): Promise<DocumentWorkbookVersioningLifecycleConfig> {
  const providerSelection = input.versioning.providerSelection;
  if (!providerSelection || providerSelection.initialize || providerSelection.readOnly) {
    return input.versioning;
  }
  if (!input.xlsxImportRoot && !input.blankWorkbookRootInitializerEnabled) {
    return input.versioning;
  }

  const documentScope = normalizeVersionDocumentScope({
    ...(providerSelection.workspaceId === undefined
      ? {}
      : { workspaceId: providerSelection.workspaceId }),
    documentId: input.documentId,
    ...(providerSelection.principalScope === undefined
      ? {}
      : { principalScope: providerSelection.principalScope }),
  });
  const graphId = input.xlsxImportRoot ? XLSX_IMPORT_ROOT_GRAPH_ID : BLANK_WORKBOOK_ROOT_GRAPH_ID;
  const historyRootPolicy = PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.defaultHistoryRootPolicy;
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const buildRootWrite = () =>
    input.xlsxImportRoot
      ? buildXlsxVersionImportRootWrite({
          namespace,
          snapshotRootByteSyncPort: input.versioning.snapshotRootByteSyncPort,
          semanticStateReader: input.versioning.semanticStateReader,
          provenance: input.xlsxImportRoot,
          createdAt: input.createdAt,
        })
      : buildBlankWorkbookRootWrite({
          namespace,
          snapshotRootByteSyncPort: input.versioning.snapshotRootByteSyncPort,
          semanticStateReader: input.versioning.semanticStateReader,
          createdAt: input.createdAt,
        });

  return {
    ...input.versioning,
    ...(input.xlsxImportRoot
      ? {
          xlsxImportRootExistingGraph: {
            namespace,
            snapshotRootByteSyncPort: input.versioning.snapshotRootByteSyncPort,
            semanticStateReader: input.versioning.semanticStateReader,
            provenance: input.xlsxImportRoot,
            createdAt: input.createdAt,
            historyRootPolicy,
          } satisfies Omit<XlsxVersionExistingGraphImportInput, 'graph'>,
        }
      : {}),
    providerSelection: {
      ...providerSelection,
      initialize: {
        graphId,
        historyRootKind: input.xlsxImportRoot ? 'import' : 'new',
        historyRootPolicy,
        buildRootWrite,
      },
    },
  };
}
