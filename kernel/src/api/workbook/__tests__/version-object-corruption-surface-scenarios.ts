import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import {
  expectNoLeaks,
  expectRepairDiagnostic,
  RAW_OBJECT_PREIMAGE_CANARY,
  RAW_OBJECT_PREIMAGE_PATH,
} from './version-object-corruption-test-utils';

const COMMIT_A = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const COMMIT_B = `commit:sha256:${'b'.repeat(64)}` as WorkbookCommitId;

export function registerVersionObjectCorruptionSurfaceScenarios(): void {
  it('preserves repair recoverability and redacts corrupt object details on the diff surface', async () => {
    const version = new WorkbookVersionImpl({
      versioning: {
        diffService: {
          diff: async () => ({
            status: 'degraded',
            diagnostics: [
              {
                code: 'VERSION_OBJECT_CORRUPTION',
                severity: 'corruption',
                recoverability: 'retry',
                safeMessage: `Do not expose ${RAW_OBJECT_PREIMAGE_CANARY}`,
                details: {
                  path: RAW_OBJECT_PREIMAGE_PATH,
                  source: RAW_OBJECT_PREIMAGE_CANARY,
                },
              },
            ],
          }),
        },
      },
    } as any);

    const result = await version.diff(COMMIT_A, COMMIT_B);

    expectRepairDiagnostic(result, {
      target: 'workbook.version.diff',
      code: 'VERSION_OBJECT_CORRUPTION',
    });
    expectNoLeaks(result);
  });

  it('redacts raw object preimage text on the disabled revert surface', async () => {
    const version = new WorkbookVersionImpl({} as any);

    const result = await version.revert(
      {
        target: { kind: 'commit', commitId: COMMIT_A },
        preflight: {
          gaps: [
            {
              gapId: 'gap-1',
              reason: `${RAW_OBJECT_PREIMAGE_PATH}:${RAW_OBJECT_PREIMAGE_CANARY}`,
            },
          ],
        },
      },
      { includeDiagnostics: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_REVERT_HISTORY_GAP',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({ reason: 'redacted' }),
            }),
          }),
        ]),
      },
    });
    expectNoLeaks(result);
  });
}
