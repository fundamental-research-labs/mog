import type { VersionDomainCapabilityStateMap } from '@mog-sdk/contracts/versioning';

import { validateDomainSupportManifest } from '../domain-support-manifest-validator';
import { capabilityStates, domainRow, NOW } from './domain-support-manifest-validator-fixtures';
import { manifestWithAdditionalDomain } from './domain-support-manifest-validator-capabilities-test-helpers';

export function registerCapabilityStateMapScenarios(): void {
  it('fails closed when a domain references an unknown capability state', () => {
    const manifest = manifestWithAdditionalDomain(
      domainRow('filters', {
        capabilityStates: {
          ...capabilityStates(),
          // @ts-expect-error intentionally invalid state
          merge: 'mostly-supported',
        },
      }),
    );

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'unknown-capability-state');
      expect(diag?.domainId).toBe('filters');
    }
  });

  it('fails closed when capabilityStates is missing', () => {
    const row = domainRow('filters') as any;
    delete row.capabilityStates;
    const manifest = manifestWithAdditionalDomain(row);

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'capability-states-missing');
      expect(diag?.domainId).toBe('filters');
    }
  });

  it('fails closed when a row only carries the legacy scalar capabilityState', () => {
    const row = domainRow('filters') as any;
    delete row.capabilityStates;
    row.capabilityState = 'supported';
    const manifest = manifestWithAdditionalDomain(row);

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'capability-states-missing');
      expect(diag?.domainId).toBe('filters');
    }
  });

  it('fails closed when a capability state key is missing', () => {
    const states = { ...capabilityStates() };
    delete (states as Partial<VersionDomainCapabilityStateMap>).checkout;
    const manifest = manifestWithAdditionalDomain(
      domainRow('filters', {
        capabilityStates: states as VersionDomainCapabilityStateMap,
      }),
    );

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'capability-state-missing');
      expect(diag?.domainId).toBe('filters');
      expect(diag?.message).toContain('checkout');
    }
  });

  it('fails closed when a capability state map has an unknown key', () => {
    const manifest = manifestWithAdditionalDomain(
      domainRow('filters', {
        capabilityStates: {
          ...capabilityStates(),
          // @ts-expect-error intentionally invalid capability key
          importExportMaybe: 'supported',
        },
      }),
    );

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'unknown-capability-key');
      expect(diag?.domainId).toBe('filters');
      expect(diag?.message).toContain('importExportMaybe');
    }
  });
}
