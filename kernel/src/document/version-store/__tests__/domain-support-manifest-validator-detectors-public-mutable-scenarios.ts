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

export function registerDetectorPublicMutableScenarios(): void {
  it('fails closed when detected public mutable domain rows have no policy row', () => {
    const detectorRows: readonly DomainSupportDetectorRow[] = [
      {
        matrixRowId: 'tables',
        domainId: 'tables',
        present: true,
        detectorId: 'detector.tables',
      },
      {
        matrixRowId: 'filters.auto-filter',
        domainId: 'filters',
        present: true,
        detectorId: 'detector.filters.auto-filter',
      },
      {
        matrixRowId: 'named-ranges',
        domainId: 'named-ranges',
        present: true,
        detectorId: 'detector.named-ranges',
      },
      {
        matrixRowId: 'data-validation',
        domainId: 'data-validation',
        present: true,
        detectorId: 'detector.data-validation',
      },
      {
        matrixRowId: 'external-links',
        domainId: 'external-links',
        present: true,
        detectorId: 'detector.external-links',
      },
    ];

    const result = validateDomainSupportManifest(freshManifest(), {
      now: NOW,
      detectorRows,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const detector of detectorRows) {
        expect(
          result.diagnostics.find((d) => d.matrixRowId === detector.matrixRowId),
        ).toMatchObject({
          code: 'detector-row-missing',
          matrixRowId: detector.matrixRowId,
          domainId: detector.domainId,
        });
      }
    }
  });

  it('accepts detected public mutable domain rows with matching policy rows', () => {
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('tables'),
        domainRow('filters', { matrixRowId: 'filters.auto-filter' }),
        domainRow('named-ranges'),
        domainRow('data-validation'),
        domainRow('external-links'),
      ],
    });
    const detectorRows: readonly DomainSupportDetectorRow[] = [
      { matrixRowId: 'tables', domainId: 'tables', present: true, detectorId: 'detector.tables' },
      {
        matrixRowId: 'filters.auto-filter',
        domainId: 'filters',
        present: true,
        detectorId: 'detector.filters.auto-filter',
      },
      {
        matrixRowId: 'named-ranges',
        domainId: 'named-ranges',
        present: true,
        detectorId: 'detector.named-ranges',
      },
      {
        matrixRowId: 'data-validation',
        domainId: 'data-validation',
        present: true,
        detectorId: 'detector.data-validation',
      },
      {
        matrixRowId: 'external-links',
        domainId: 'external-links',
        present: true,
        detectorId: 'detector.external-links',
      },
    ];

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      maxAgeMs: ONE_HOUR_MS,
      detectorRows,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.presentMatrixRowIds).toEqual(
        expect.arrayContaining([
          'tables',
          'filters.auto-filter',
          'named-ranges',
          'data-validation',
          'external-links',
        ]),
      );
    }
  });
}
