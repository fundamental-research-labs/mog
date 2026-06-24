import { expect, it } from '@jest/globals';

import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

export function registerOperationColumnPublicDiagnosticsScenarios(): void {
  it('identifies public matrix row ids without exposing raw workbook or detector state', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest({
            workbookId: 'ConfidentialWorkbookState-42',
          }),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
            detectorRows: [
              {
                matrixRowId: 'charts.source-range',
                domainId: 'charts',
                present: true,
                detectorId: 'detector.ConfidentialChartDetector-42',
              },
            ],
          },
        },
      } as any,
      'import',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
          payload: expect.objectContaining({
            operation: 'import',
            diagnosticCode: 'detector-row-missing',
            matrixRowId: 'charts.source-range',
            domainId: 'charts',
          }),
        }),
      ]),
    );
    expect(JSON.stringify(diagnostics)).toContain('charts.source-range');
    expect(JSON.stringify(diagnostics)).not.toContain('ConfidentialWorkbookState-42');
    expect(JSON.stringify(diagnostics)).not.toContain('ConfidentialChartDetector-42');
  });
}
