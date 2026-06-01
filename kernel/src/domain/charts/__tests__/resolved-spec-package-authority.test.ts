import {
  importStatusUnsupportedDiagnostics,
  packageAuthorityDiagnostics,
  packageAuthorityStatus,
  snapshotPackageAuthority,
} from '../bridge/resolved-spec-package-authority';

const currentAuthority = {
  schemaVersion: 3,
  validity: 'current',
  chartPartRevision: 1,
  relationshipClosureCurrent: true,
} as const;

describe('resolved spec package authority helpers', () => {
  it('classifies package authority status from validity and relationship closure', () => {
    expect(packageAuthorityStatus(undefined)).toBe('unknown');
    expect(packageAuthorityStatus(currentAuthority)).toBe('current');
    expect(
      packageAuthorityStatus({
        ...currentAuthority,
        relationshipClosureCurrent: false,
      }),
    ).toBe('stale');
    expect(
      packageAuthorityStatus({
        ...currentAuthority,
        validity: 'unverified',
      }),
    ).toBe('unknown');
    expect(
      packageAuthorityStatus({
        ...currentAuthority,
        validity: 'unsafe',
      }),
    ).toBe('stale');
  });

  it('snapshots package authority provenance and stale diagnostics', () => {
    const chart = {
      ooxml: {
        standardChartProvenance: {
          originalPath: 'xl/charts/chart2.xml',
          relsPath: 'xl/charts/_rels/chart2.xml.rels',
          projectionSchemaVersion: 3,
          projectionFingerprint: 'fp-import',
          relationships: [{ rId: 'rId1', target: '../media/image1.png' }],
          auxiliaryPaths: ['xl/media/image1.png'],
        },
        standardChartExportAuthority: {
          ...currentAuthority,
          validity: 'unsafe',
          packageOwner: 'xl/charts/chart2.xml',
          relationshipClosureCurrent: false,
          projectionFingerprint: 'fp-current',
        },
      },
    } as any;

    expect(snapshotPackageAuthority(chart)).toMatchObject({
      source: 'xl/charts/chart2.xml',
      fingerprint: 'fp-current',
      status: 'stale',
      details: {
        kind: 'standardChart',
        validity: 'unsafe',
        projectionSchemaVersion: 3,
        originalPath: 'xl/charts/chart2.xml',
        relsPath: 'xl/charts/_rels/chart2.xml.rels',
        auxiliaryPaths: ['xl/media/image1.png'],
        relationshipCount: 1,
      },
    });
    expect(packageAuthorityDiagnostics(chart)).toEqual([
      'standard chart package authority is unsafe: chart relationship graph is not closed',
    ]);
  });

  it('deduplicates import-status unsupported diagnostics with concrete messages', () => {
    expect(
      importStatusUnsupportedDiagnostics({
        diagnostics: [
          { code: 'unsupportedFeature', message: 'Preserved but not rendered' },
          { code: 'unsupportedFeature', message: 'Preserved but not rendered' },
          { code: 'missingMessage' },
          { code: 'blankMessage', message: '   ' },
          null,
        ],
      }),
    ).toEqual(['Preserved but not rendered']);
  });
});
