import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  validateDomainSupportManifest,
} from '../domain-support-manifest-validator';
import { domainRow, freshManifest, NOW } from './domain-support-manifest-validator-fixtures';

export function registerCoreMatrixRowIntegrityScenarios(): void {
  it('reports duplicate matrix row ids', () => {
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('cells.formats', { matrixRowId: 'sheets' }),
      ],
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('duplicate-matrix-row');
    }
  });
}
