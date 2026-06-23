import { validateDomainSupportManifest } from '../domain-support-manifest-validator';

export function registerCoreMalformedScenarios(): void {
  it('fails closed on a non-object manifest without throwing', () => {
    const result = validateDomainSupportManifest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('manifest-malformed');
    }
  });
}
