import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  validateDomainSupportManifest,
} from '../domain-support-manifest-validator';
import { domainRow, freshManifest, NOW } from './domain-support-manifest-validator-fixtures';

export function registerCoreMatrixRowCoverageScenarios(): void {
  it('fails closed when a required first-slice matrix row is absent', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.filter((id) => id !== 'cells.formulas').map((id) =>
        domainRow(id),
      ),
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.diagnostics.find((d) => d.code === 'required-matrix-row-missing');
      expect(missing).toBeDefined();
      expect(missing?.matrixRowId).toBe('cells.formulas');
    }
  });

  it('does not let a broad domain row stand in for a required subtype matrix row', () => {
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [
          ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
          domainRow('cells.formats', { matrixRowId: 'cells.formats' }),
        ],
      }),
      {
        now: NOW,
        requiredMatrixRowIds: ['cells.formats.direct'],
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.diagnostics.find((d) => d.code === 'required-matrix-row-missing');
      expect(missing).toMatchObject({ matrixRowId: 'cells.formats.direct' });
    }
  });

  it('accepts multiple subtype rows for the same broad domain when matrix row ids differ', () => {
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [
          ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
          domainRow('cells.formats', { matrixRowId: 'cells.formats.direct' }),
          domainRow('cells.formats', { matrixRowId: 'cells.formats.catalogs' }),
        ],
      }),
      {
        now: NOW,
        requiredMatrixRowIds: ['cells.formats.direct', 'cells.formats.catalogs'],
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.presentMatrixRowIds).toEqual(
        expect.arrayContaining(['cells.formats.direct', 'cells.formats.catalogs']),
      );
      expect(result.presentDomainIds).toContain('cells.formats');
    }
  });
}
