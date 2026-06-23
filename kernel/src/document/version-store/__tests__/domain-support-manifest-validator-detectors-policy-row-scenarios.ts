import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  validateDomainSupportManifest,
  type DomainSupportDetectorRow,
} from '../domain-support-manifest-validator';
import {
  domainRow,
  freshManifest,
  NOW,
  ONE_HOUR_MS,
} from './domain-support-manifest-validator-fixtures';

export function registerDetectorPolicyRowMissingScenarios(): void {
  it('fails closed when a detected-present domain has no policy row', () => {
    const detectorRows: readonly DomainSupportDetectorRow[] = [
      { domainId: 'pivots', present: true, detectorId: 'detector.pivots' },
    ];

    const result = validateDomainSupportManifest(freshManifest(), {
      now: NOW,
      detectorRows,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'detector-row-missing');
      expect(diag?.domainId).toBe('pivots');
    }
  });

  it('fails closed when a detected-present subtype matrix row has no policy row', () => {
    const detectorRows: readonly DomainSupportDetectorRow[] = [
      {
        matrixRowId: 'cells.formats.direct',
        domainId: 'cells.formats',
        present: true,
        detectorId: 'detector.formats',
      },
    ];
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('cells.formats', { matrixRowId: 'cells.formats.catalogs' }),
      ],
    });

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      detectorRows,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'detector-row-missing')).toMatchObject({
        matrixRowId: 'cells.formats.direct',
        domainId: 'cells.formats',
      });
    }
  });
}

export function registerDetectorPolicyRowAcceptanceScenarios(): void {
  it('accepts when a detected-present domain has a matching policy row', () => {
    const manifest = freshManifest({
      domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), domainRow('pivots')],
    });
    const detectorRows: readonly DomainSupportDetectorRow[] = [
      { domainId: 'pivots', present: true, detectorId: 'detector.pivots' },
      { domainId: 'charts', present: false },
    ];

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      maxAgeMs: ONE_HOUR_MS,
      detectorRows,
    });

    expect(result.ok).toBe(true);
  });
}
