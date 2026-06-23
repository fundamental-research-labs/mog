import { jest } from '@jest/globals';

import {
  DETECTOR_SHEET_ID,
  MUTABLE_DOMAIN_DETECTOR_CASES,
  SHEET_SCOPED_MUTABLE_DOMAIN_DETECTOR_CASES,
  expectDetectorPublicDiagnostic,
  mutableDomainDetectorBridgeWithMissingMethods,
  mutableDomainDetectorBridgeWithThrowingMethod,
  mutableDomainDetectorNoopBridge,
  versionWithMutableDomainDetectorBridge,
} from './version-domain-support-gate-test-helpers';

export function registerMutableDetectorFailClosedScenarios(): void {
  it('fails closed before invoking the write service when mutable domain detector methods are missing', async () => {
    for (const detector of MUTABLE_DOMAIN_DETECTOR_CASES) {
      const commit = jest.fn();
      const version = versionWithMutableDomainDetectorBridge(
        mutableDomainDetectorBridgeWithMissingMethods(detector),
        commit,
      );

      const result = await version.commit();

      expectDetectorPublicDiagnostic(
        result,
        'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE',
        detector,
        'none',
      );
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it('fails closed before invoking the write service when getAllSheetIds is unavailable or malformed', async () => {
    const cases = [
      {
        code: 'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE' as const,
        recoverability: 'none' as const,
        bridge: () => {
          const bridge = mutableDomainDetectorNoopBridge();
          delete bridge.getAllSheetIds;
          return bridge;
        },
      },
      {
        code: 'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED' as const,
        recoverability: 'retry' as const,
        bridge: () => ({
          ...mutableDomainDetectorNoopBridge(),
          getAllSheetIds: jest.fn(async () => ({
            leakedSheetName: 'SecretSheetIds',
          })),
        }),
      },
      {
        code: 'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED' as const,
        recoverability: 'retry' as const,
        bridge: () => ({
          ...mutableDomainDetectorNoopBridge(),
          getAllSheetIds: jest.fn(async () => [DETECTOR_SHEET_ID, { id: 'SecretSheetIds' }]),
        }),
      },
    ];

    for (const testCase of cases) {
      const commit = jest.fn();
      const version = versionWithMutableDomainDetectorBridge(testCase.bridge(), commit);

      const result = await version.commit();

      for (const { detector } of SHEET_SCOPED_MUTABLE_DOMAIN_DETECTOR_CASES) {
        expectDetectorPublicDiagnostic(
          result,
          testCase.code,
          detector,
          testCase.recoverability,
          SHEET_SCOPED_MUTABLE_DOMAIN_DETECTOR_CASES.length,
        );
      }
      expect(JSON.stringify(result)).not.toContain('SecretSheetIds');
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it('fails closed before invoking the write service when sheet-scoped detectors return non-array rows', async () => {
    for (const { detector, rowReadMethod } of SHEET_SCOPED_MUTABLE_DOMAIN_DETECTOR_CASES) {
      const commit = jest.fn();
      const bridge = mutableDomainDetectorNoopBridge();
      bridge[rowReadMethod] = jest.fn(async () => ({
        leakedRowName: `SecretDetectorRows-${detector.label}`,
      }));
      const version = versionWithMutableDomainDetectorBridge(bridge, commit);

      const result = await version.commit();

      expectDetectorPublicDiagnostic(
        result,
        'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
        detector,
        'retry',
      );
      expect(JSON.stringify(result)).not.toContain('SecretDetectorRows');
      expect(commit).not.toHaveBeenCalled();
    }
  });

  it('fails closed with redacted public diagnostics when mutable domain detector methods throw', async () => {
    for (const detector of MUTABLE_DOMAIN_DETECTOR_CASES) {
      const commit = jest.fn();
      const version = versionWithMutableDomainDetectorBridge(
        mutableDomainDetectorBridgeWithThrowingMethod(
          detector,
          `Detector read leaked ConfidentialDealRoom42 from https://private.example.invalid/customer-42 while checking ${detector.label}.`,
        ),
        commit,
      );

      const result = await version.commit();

      expectDetectorPublicDiagnostic(
        result,
        'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
        detector,
        'retry',
      );
      expect(JSON.stringify(result)).not.toContain('ConfidentialDealRoom42');
      expect(JSON.stringify(result)).not.toContain('https://private.example.invalid/customer-42');
      expect(commit).not.toHaveBeenCalled();
    }
  });
}
