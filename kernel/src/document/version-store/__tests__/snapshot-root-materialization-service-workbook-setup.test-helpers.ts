import type { Workbook } from '@mog-sdk/contracts/api';
import { jest } from '@jest/globals';

import { DocumentFactory } from '../../../api/document/document-factory';
import type { DocumentHandleInternal } from '../../../api/document/document-handle-types';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../../../api/document/snapshot-root-lifecycle-hydrator';
import { createInMemoryVersionStoreProvider, namespaceForDocumentScope } from '../provider';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { createSnapshotRootMaterializationService } from '../snapshot-root-materialization-service';

import { expectMaterializationSuccess } from './snapshot-root-materialization-service-assertions.test-helpers';
import { DOCUMENT_SCOPE } from './snapshot-root-materialization-service-constants.test-helpers';
import { initializeGraphWithSnapshotRoot } from './snapshot-root-materialization-service-graph-builders.test-helpers';

export async function materializeAuthoredWorkbook<TArtifacts>(options: {
  readonly sourceDocumentId: string;
  readonly materializedDocumentId: string;
  readonly graphId?: string;
  readonly author: (workbook: Workbook) => Promise<TArtifacts>;
}) {
  const graphId = options.graphId ?? 'graph-1';
  const sourceHandle = await DocumentFactory.create({
    documentId: options.sourceDocumentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let materialized: SnapshotRootFreshLifecycleMaterialization | undefined;

  try {
    const sourceWorkbook = await sourceHandle.workbook();
    const artifacts = await options.author(sourceWorkbook);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
    const snapshotRootPayload = createYrsFullStateSnapshotRootPayload(
      await (sourceHandle as DocumentHandleInternal)
        .createSyncPort()
        .encodeDiff(new Uint8Array([0])),
    );
    const snapshotRootRecord = await createWorkbookSnapshotRootRecord(
      namespace,
      snapshotRootPayload,
    );
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await initializeGraphWithSnapshotRoot(
      provider,
      namespace,
      snapshotRootRecord,
    );

    const lifecycleHydrator = createDocumentLifecycleSnapshotRootHydrator({
      userTimezone: 'UTC',
      documentIdFactory: () => options.materializedDocumentId,
    });
    const hydrateYrsFullState = jest.fn(
      lifecycleHydrator.hydrateYrsFullState.bind(lifecycleHydrator),
    );
    const service = createSnapshotRootMaterializationService({
      provider,
      hydrator: { hydrateYrsFullState },
    });

    const result = await service.materializeSnapshotRoot({ target: 'ref', refName: 'main' });
    expectMaterializationSuccess(result);
    materialized = result.materialized;

    return Object.freeze({
      sourceHandle,
      sourceWorkbook,
      artifacts,
      provider,
      initialized,
      snapshotRootPayload,
      snapshotRootRecord,
      hydrateYrsFullState,
      result,
      materialized,
      dispose: async () => {
        await materialized?.dispose();
        await sourceHandle.dispose();
      },
    });
  } catch (error) {
    if (materialized) await materialized.dispose();
    await sourceHandle.dispose();
    throw error;
  }
}
