import { jest } from '@jest/globals';

import {
  MUTABLE_DOMAIN_DETECTOR_CASES,
  mutableDomainDetectorBridgeWithPresentRows,
  versionWithMutableDomainDetectorBridge,
} from './version-domain-support-gate-test-helpers';

export function registerMutableDetectorManifestRowScenarios(): void {
  it('maps present mutable detector rows to required manifest rows before invoking the write service', async () => {
    for (const detector of MUTABLE_DOMAIN_DETECTOR_CASES) {
      const commit = jest.fn();
      const version = versionWithMutableDomainDetectorBridge(
        mutableDomainDetectorBridgeWithPresentRows(detector),
        commit,
      );

      const result = await version.commit();

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.commit',
        },
      });
      if (result.ok) {
        throw new Error('expected version.commit to fail');
      }
      expect(result.error.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'required-matrix-row-missing',
                matrixRowId: detector.matrixRowId,
              }),
            }),
          }),
          expect.objectContaining({
            code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            data: expect.objectContaining({
              operation: 'commit',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                diagnosticCode: 'detector-row-missing',
                matrixRowId: detector.matrixRowId,
                domainId: detector.domainId,
              }),
            }),
          }),
        ]),
      );
      expect(commit).not.toHaveBeenCalled();
    }
  });
}
