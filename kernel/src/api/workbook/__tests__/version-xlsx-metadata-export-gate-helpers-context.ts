import { type maybeAddMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';

export function metadataExportContext(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly provider?: unknown;
}): Parameters<typeof maybeAddMogVersionMetadataToXlsx>[0] {
  return {
    clock: { dateNow: () => Date.parse('2026-06-23T00:00:00.000Z') },
    workbookLinkScope: () => ({
      requestingDocumentId: input.documentId,
      ...(input.workspaceId ? { requestingWorkspaceId: input.workspaceId } : {}),
    }),
    ...(input.provider ? { versioning: { provider: input.provider } } : {}),
  } as Parameters<typeof maybeAddMogVersionMetadataToXlsx>[0];
}
