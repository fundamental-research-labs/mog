import { validateDomainSupportManifest } from '../domain-support-manifest-validator';
import { freshManifest, NOW, ONE_HOUR_MS } from './domain-support-manifest-validator-fixtures';

export function registerCoreFreshnessScenarios(): void {
  it('fails closed when the manifest is stale by maxAgeMs', () => {
    const stale = freshManifest({ generatedAt: '2026-06-20T00:00:00.000Z' });

    const result = validateDomainSupportManifest(stale, {
      now: NOW,
      maxAgeMs: ONE_HOUR_MS,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('manifest-stale');
    }
  });

  it('fails closed when the manifest predates the minGeneratedAt bound', () => {
    const result = validateDomainSupportManifest(freshManifest(), {
      now: NOW,
      minGeneratedAt: new Date('2026-06-21T00:01:00.000Z'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('manifest-stale');
    }
  });
}
