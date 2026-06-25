import {
  DomainSupportManifestError,
  REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  assertDomainSupportManifest,
} from '../domain-support-manifest-validator';
import { freshManifest, NOW, ONE_HOUR_MS } from './domain-support-manifest-validator-fixtures';

export function registerCoreAssertionScenarios(): void {
  it('returns present matrix row ids on a valid manifest', () => {
    const ids = assertDomainSupportManifest(freshManifest(), {
      now: NOW,
      maxAgeMs: ONE_HOUR_MS,
    });
    expect(ids).toEqual([...REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS]);
  });

  it('throws a typed DomainSupportManifestError carrying diagnostics', () => {
    expect(() =>
      assertDomainSupportManifest(freshManifest({ schemaVersion: '999' }), { now: NOW }),
    ).toThrow(DomainSupportManifestError);

    try {
      assertDomainSupportManifest(freshManifest({ schemaVersion: '999' }), { now: NOW });
    } catch (error) {
      expect(error).toBeInstanceOf(DomainSupportManifestError);
      expect((error as DomainSupportManifestError).diagnostics.map((d) => d.code)).toContain(
        'schema-version-unsupported',
      );
    }
  });
}
