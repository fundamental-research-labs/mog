import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';
import type { VersionDomainCapabilityKey } from '@mog-sdk/contracts/versioning';

import { validateVersionDomainSupportManifestGate } from '../version-domain-support-gate';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
} from './version-domain-support-test-utils';

type PublicGateOperation = 'commit' | 'checkout' | 'merge' | 'review' | 'export' | 'import';

const PUBLIC_GATE_CAPABILITY_CASES = [
  { operation: 'commit', capabilityKeys: ['capture', 'persistence'] },
  { operation: 'checkout', capabilityKeys: ['checkout'] },
  { operation: 'merge', capabilityKeys: ['merge'] },
  { operation: 'review', capabilityKeys: ['reviewAccess'] },
  { operation: 'export', capabilityKeys: ['export'] },
  { operation: 'import', capabilityKeys: ['import'] },
] as const satisfies readonly {
  readonly operation: PublicGateOperation;
  readonly capabilityKeys: readonly VersionDomainCapabilityKey[];
}[];

const PUBLIC_PARTIAL_SUPPORT_SUPPORTED_OPERATIONS = [
  'commit',
  'checkout',
  'merge',
  'export',
] as const;
const PUBLIC_PARTIAL_SUPPORT_BLOCKED_OPERATIONS = [
  { operation: 'review', capabilityKey: 'reviewAccess' },
  { operation: 'import', capabilityKey: 'import' },
] as const satisfies readonly {
  readonly operation: 'review' | 'import';
  readonly capabilityKey: VersionDomainCapabilityKey;
}[];

describe('WorkbookVersion domain support gate operation capability columns', () => {
  it('maps each public operation to its exact manifest capability keys', async () => {
    for (const { operation, capabilityKeys } of PUBLIC_GATE_CAPABILITY_CASES) {
      const diagnostics = await validateVersionDomainSupportManifestGate(
        {
          versioning: {
            requireDomainSupportManifest: true,
          },
        } as any,
        operation,
      );

      expect(diagnostics).toHaveLength(capabilityKeys.length);
      expect(new Set(diagnostics.map((diagnostic) => diagnostic.payload.capabilityKey))).toEqual(
        new Set(capabilityKeys),
      );
      for (const diagnostic of diagnostics) {
        expect(diagnostic).toMatchObject({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
          payload: expect.objectContaining({
            operation,
          }),
        });
      }
    }
  });

  it('allows public partially supported domains for operations whose capability columns are supported', async () => {
    for (const operation of PUBLIC_PARTIAL_SUPPORT_SUPPORTED_OPERATIONS) {
      await expect(
        validateVersionDomainSupportManifestGate(
          {
            versioning: {
              domainSupportManifest: freshManifest(),
              domainSupportManifestOptions: {
                now: NOW,
                maxAgeMs: TEN_MINUTES_MS,
              },
            },
          } as any,
          operation,
        ),
      ).resolves.toEqual([]);
    }
  });

  it('blocks public partially supported domains only for the requested unsupported operation', async () => {
    for (const { operation, capabilityKey } of PUBLIC_PARTIAL_SUPPORT_BLOCKED_OPERATIONS) {
      const diagnostics = await validateVersionDomainSupportManifestGate(
        {
          versioning: {
            domainSupportManifest: freshManifest(),
            domainSupportManifestOptions: {
              now: NOW,
              maxAgeMs: TEN_MINUTES_MS,
            },
          },
        } as any,
        operation,
      );
      const capabilityBlocks = capabilityStateBlocks(diagnostics);

      expect(capabilityBlocks.length).toBeGreaterThan(0);
      expect(
        new Set(capabilityBlocks.map((diagnostic) => diagnostic.payload.capabilityKey)),
      ).toEqual(new Set([capabilityKey]));
      expect(capabilityBlocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
            payload: expect.objectContaining({
              operation,
              diagnosticCode: 'capability-state-blocked',
              matrixRowId: 'workbook-metadata',
              capabilityKey,
              capabilityState: 'contracted',
            }),
          }),
        ]),
      );
    }
  });

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
});

function capabilityStateBlocks(
  diagnostics: readonly VersionStoreDiagnostic[],
): readonly VersionStoreDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.issueCode === 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID' &&
      diagnostic.payload.diagnosticCode === 'capability-state-blocked',
  );
}
