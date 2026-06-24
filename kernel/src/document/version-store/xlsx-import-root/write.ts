import type { VersionGraphInitializeInput } from '../provider';
import { createVersionObjectRecord, type VersionGraphNamespace } from '../object-store';
import type { SnapshotRootByteSyncPort } from '../snapshot-root-capture';
import type { VersionSemanticStateReaderPort } from '../semantic-state-reader';
import { XLSX_IMPORT_ROOT_AUTHOR } from './constants';
import type { XlsxVersionImportRootProvenance } from './provenance';
import { captureXlsxImportSnapshotRootRecord } from './snapshot-root';

export async function buildXlsxVersionImportRootWrite(input: {
  readonly namespace: VersionGraphNamespace;
  readonly snapshotRootByteSyncPort: SnapshotRootByteSyncPort;
  readonly semanticStateReader: VersionSemanticStateReaderPort;
  readonly provenance: XlsxVersionImportRootProvenance;
  readonly createdAt: string;
}): Promise<VersionGraphInitializeInput['rootWrite']> {
  const semanticState = await input.semanticStateReader.readCurrentSemanticState();
  const snapshotRootRecord = await captureXlsxImportSnapshotRootRecord(
    input.namespace,
    input.snapshotRootByteSyncPort,
  );
  const semanticChangeSetRecord = await createVersionObjectRecord(input.namespace, {
    objectType: 'workbook.semanticChangeSet.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'xlsxImportRoot',
        source: input.provenance.source,
        ...(input.provenance.versionMetadataTrust
          ? { versionMetadataTrust: input.provenance.versionMetadataTrust }
          : {}),
        semanticStateDigest: semanticState.stateDigest,
      },
      importDiagnostics: input.provenance.diagnostics,
      semanticState,
      changes: [],
    },
  });

  return {
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: XLSX_IMPORT_ROOT_AUTHOR,
    createdAt: input.createdAt,
    completenessDiagnostics: [],
  };
}
