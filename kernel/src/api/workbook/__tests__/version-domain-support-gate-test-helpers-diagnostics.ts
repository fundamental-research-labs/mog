import { expect } from '@jest/globals';

import type { WorkbookVersionImpl } from '../version';
import type { MutableDomainDetectorCase } from './version-domain-support-gate-test-helpers-detector-cases';

export function expectDetectorPublicDiagnostic(
  result: Awaited<ReturnType<WorkbookVersionImpl['commit']>>,
  code:
    | 'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE'
    | 'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
  detector: MutableDomainDetectorCase,
  recoverability: 'none' | 'retry',
  expectedDiagnosticCount = 1,
): void {
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

  expect(result.error.diagnostics).toHaveLength(expectedDiagnosticCount);
  const diagnostic = result.error.diagnostics.find(
    (item) =>
      item.code === code &&
      item.data?.payload?.detectorId === detector.detectorId &&
      item.data.payload.matrixRowId === detector.matrixRowId &&
      item.data.payload.domainId === detector.domainId,
  );
  expect(diagnostic).toMatchObject({
    code,
    severity: 'error',
    message: expect.any(String),
    data: expect.objectContaining({
      operation: 'commit',
      recoverability,
      messageTemplateId: `version.commit.${code}`,
      redacted: true,
      mutationGuarantee: 'no-write-attempted',
    }),
  });
  expect(diagnostic?.data?.payload).toEqual({
    operation: 'commit',
    detectorId: detector.detectorId,
    matrixRowId: detector.matrixRowId,
    domainId: detector.domainId,
  });
}
