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

describe('validateDomainSupportManifest detector rows', () => {
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
});
