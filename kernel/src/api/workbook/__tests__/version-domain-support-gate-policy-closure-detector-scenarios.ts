import { expect, it, jest } from '@jest/globals';

import { REQUIRED_FIRST_SLICE_DOMAIN_IDS } from '../../../document/version-store/domain-support-manifest-validator';
import { validateVersionDomainSupportManifestGate } from '../version-domain-support-gate';
import {
  POLICY_CLOSURE_DETECTOR_SHEET_ID,
  mutableDomainDetectorBridge,
} from './version-domain-support-gate-policy-closure-test-utils';
import {
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  versionDomainSupportManifestRow as domainRow,
} from './version-domain-support-test-utils';

const DETECTED_MUTABLE_DOMAIN_ROWS = [
  ['tables', 'tables'],
  ['filters.auto-filter', 'filters'],
  ['named-ranges', 'named-ranges'],
  ['external-links', 'external-links'],
  ['data-validation', 'data-validation'],
] as const;

const DETECTOR_UNAVAILABLE_ROWS = [
  ['detector.tables', 'tables', 'tables'],
  ['detector.filters.auto-filter', 'filters.auto-filter', 'filters'],
  ['detector.named-ranges', 'named-ranges', 'named-ranges'],
  ['detector.external-links', 'external-links', 'external-links'],
  ['detector.data-validation', 'data-validation', 'data-validation'],
] as const;

export function registerPolicyClosureDetectorScenarios(): void {
  it('auto-detects public mutable domains as required manifest rows', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: mutableDomainDetectorBridge(),
      } as any,
      'commit',
    );

    for (const [matrixRowId, domainId] of DETECTED_MUTABLE_DOMAIN_ROWS) {
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              operation: 'commit',
              diagnosticCode: 'required-matrix-row-missing',
              matrixRowId,
            }),
          }),
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              operation: 'commit',
              diagnosticCode: 'detector-row-missing',
              matrixRowId,
              domainId,
            }),
          }),
        ]),
      );
    }
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueTable');
    expect(JSON.stringify(diagnostics)).not.toContain('filter-secret-1');
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueRange');
    expect(JSON.stringify(diagnostics)).not.toContain('https://secret.example.invalid');
    expect(JSON.stringify(diagnostics)).not.toContain('validation-secret-1');
  });

  it('auto-detected mutable domains enforce their public policy capability states', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest({
            domains: [
              ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
              domainRow('tables'),
              domainRow('filters', { matrixRowId: 'filters.auto-filter' }),
              domainRow('named-ranges'),
              domainRow('external-links'),
              domainRow('data-validation'),
            ],
          }),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: mutableDomainDetectorBridge(),
      } as any,
      'commit',
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'named-ranges',
            domainId: 'named-ranges',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'tables',
            domainId: 'tables',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'filters.auto-filter',
            domainId: 'filters',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'external-links',
            domainId: 'external-links',
            capabilityKey: 'capture',
            capabilityState: 'opaque-preserved',
          }),
        }),
        expect.objectContaining({
          issueCode: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
          mutationGuarantee: 'no-write-attempted',
          payload: expect.objectContaining({
            operation: 'commit',
            diagnosticCode: 'capability-state-blocked',
            matrixRowId: 'data-validation',
            domainId: 'data-validation',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        }),
      ]),
    );
  });

  it('fails closed with public-safe diagnostics when detector bridge methods are absent', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: {},
      } as any,
      'commit',
    );

    for (const [detectorId, matrixRowId, domainId] of DETECTOR_UNAVAILABLE_ROWS) {
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issueCode: 'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE',
            recoverability: 'none',
            mutationGuarantee: 'no-write-attempted',
            redacted: true,
            payload: expect.objectContaining({
              operation: 'commit',
              detectorId,
              matrixRowId,
              domainId,
            }),
          }),
        ]),
      );
    }
  });

  it('fails closed with redacted diagnostics when mutable domain detection cannot read workbook state', async () => {
    const diagnostics = await validateVersionDomainSupportManifestGate(
      {
        versioning: {
          domainSupportManifest: freshManifest(),
          domainSupportManifestOptions: {
            now: NOW,
            maxAgeMs: TEN_MINUTES_MS,
          },
        },
        computeBridge: {
          getAllSheetIds: jest.fn(async () => [POLICY_CLOSURE_DETECTOR_SHEET_ID]),
          getAllTablesInSheet: jest.fn(async () => []),
          getFiltersInSheet: jest.fn(async () => []),
          getAllNamedRangesWire: jest.fn(async () => {
            throw new Error('SecretRevenueRange read failed for https://secret.example.invalid');
          }),
          getHyperlinks: jest.fn(async () => []),
          getRangeSchemasForSheet: jest.fn(async () => []),
        },
      } as any,
      'commit',
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        issueCode: 'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
        redacted: true,
        payload: expect.objectContaining({
          operation: 'commit',
          detectorId: 'detector.named-ranges',
          matrixRowId: 'named-ranges',
          domainId: 'named-ranges',
        }),
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('SecretRevenueRange');
    expect(JSON.stringify(diagnostics)).not.toContain('https://secret.example.invalid');
  });
}
