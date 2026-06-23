import { validateDomainSupportManifest } from '../domain-support-manifest-validator';
import { freshManifest, NOW } from './domain-support-manifest-validator-fixtures';

export function registerCoreSchemaScenarios(): void {
  it('fails closed when schemaVersion is missing', () => {
    const manifest = freshManifest();
    // @ts-expect-error intentionally removing a required field
    delete manifest.schemaVersion;

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('schema-version-missing');
    }
  });

  it('fails closed when schemaVersion is unsupported', () => {
    const result = validateDomainSupportManifest(freshManifest({ schemaVersion: '999' }), {
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('schema-version-unsupported');
    }
  });

  it('fails closed on legacy v1 manifests without subtype matrix row authority', () => {
    const result = validateDomainSupportManifest(
      freshManifest({ schemaVersion: 'domain-support-manifest.v1' }),
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('schema-version-unsupported');
    }
  });
}
