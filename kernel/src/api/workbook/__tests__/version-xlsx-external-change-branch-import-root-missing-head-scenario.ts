import { expect, it } from '@jest/globals';

import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  CREATED_AT,
  initializeExistingGraphFixture,
  semanticState,
  semanticStateReader,
  SIDE_CAR_PART,
  snapshotPort,
  staleTrustedBaseDiagnostic,
} from './version-xlsx-external-change-branch-test-utils';
import {
  expectCommittedImportRootResult,
  readImportRootCommitAndSemanticPayload,
} from './version-xlsx-external-change-branch-import-root-helpers';

export function registerTrustedMissingHeadImportRootScenario() {
  it('downgrades a trusted summary without a head candidate to missing-head', async () => {
    const baseState = semanticState('base', 'm');
    const localState = semanticState('local-main', 'n');
    const importedState = semanticState('trusted-missing-candidate', 'o');
    const { namespace, graph } = await initializeExistingGraphFixture({
      documentId: 'vc10-xlsx-trusted-missing-candidate',
      baseState,
      localState,
      localLabel: 'local-main',
    });

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x44),
      semanticStateReader: semanticStateReader(importedState, baseState),
      provenance: {
        kind: 'xlsx',
        source: { sourceType: 'bytes', byteLength: 640 },
        diagnostics: [staleTrustedBaseDiagnostic()],
        versionMetadataTrust: {
          status: 'trusted',
          sidecarPart: SIDE_CAR_PART,
          redacted: true,
        },
      },
      createdAt: CREATED_AT,
    });

    expectCommittedImportRootResult(result, 'missing-candidate import root');

    const { semanticPayload } = await readImportRootCommitAndSemanticPayload({
      graph,
      commitId: result.commitId,
      readableDescription: 'missing-candidate root',
    });
    expect(semanticPayload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'untrusted',
          reason: 'missing-head',
          redacted: true,
        },
      },
      importDiagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason: 'missing-head',
          details: expect.objectContaining({ redacted: true }),
        }),
      ],
    });
    expect(JSON.stringify(semanticPayload)).not.toContain('trusted-stale-base');
  });
}
