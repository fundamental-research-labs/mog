import type { DocumentWorkbookVersioningLifecycleConfig } from './lifecycle';
import {
  namespaceForDocumentScope,
  normalizeVersionDocumentScope,
} from './provider';
import {
  BLANK_WORKBOOK_ROOT_GRAPH_ID,
  buildBlankWorkbookRootWrite,
} from './blank-workbook-root';
import {
  buildXlsxVersionImportRootWrite,
  XLSX_IMPORT_ROOT_GRAPH_ID,
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
  const namespace = namespaceForDocumentScope(documentScope, graphId);

  return {
    ...input.versioning,
    providerSelection: {
      ...providerSelection,
      initialize: {
        graphId,
        rootWrite: input.xlsxImportRoot
          ? await buildXlsxVersionImportRootWrite({
              namespace,
              snapshotRootByteSyncPort: input.versioning.snapshotRootByteSyncPort,
              semanticStateReader: input.versioning.semanticStateReader,
              provenance: input.xlsxImportRoot,
              createdAt: input.createdAt,
            })
          : await buildBlankWorkbookRootWrite({
              namespace,
              snapshotRootByteSyncPort: input.versioning.snapshotRootByteSyncPort,
              semanticStateReader: input.versioning.semanticStateReader,
              createdAt: input.createdAt,
            }),
      },
    },
  };
}
