import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  validateDomainSupportManifest,
} from '../domain-support-manifest-validator';
import { freshManifest, NOW, ONE_HOUR_MS } from './domain-support-manifest-validator-fixtures';

export function registerCoreValidScenarios(): void {
  it('accepts a well-formed, fresh, complete manifest', () => {
    const result = validateDomainSupportManifest(freshManifest(), {
      now: NOW,
      maxAgeMs: ONE_HOUR_MS,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.presentMatrixRowIds).toEqual([...REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS]);
      expect(result.presentDomainIds).toEqual([...REQUIRED_FIRST_SLICE_DOMAIN_IDS]);
    }
  });
}
