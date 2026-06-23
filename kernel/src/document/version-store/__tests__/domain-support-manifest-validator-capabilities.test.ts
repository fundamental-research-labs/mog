import type { VersionDomainCapabilityStateMap } from '@mog-sdk/contracts/versioning';
import {
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  validateDomainSupportManifest,
} from '../domain-support-manifest-validator';
import {
  capabilityStates,
  domainRow,
  freshManifest,
  NOW,
} from './domain-support-manifest-validator-fixtures';

describe('validateDomainSupportManifest capability states', () => {
  it('fails closed when a domain references an unknown capability state', () => {
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('filters', {
          capabilityStates: {
            ...capabilityStates(),
            // @ts-expect-error intentionally invalid state
            merge: 'mostly-supported',
          },
        }),
      ],
    });

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
    const manifest = freshManifest({
      domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
    });

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
    const manifest = freshManifest({
      domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
    });

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
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('filters', {
          capabilityStates: states as VersionDomainCapabilityStateMap,
        }),
      ],
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'capability-state-missing');
      expect(diag?.domainId).toBe('filters');
      expect(diag?.message).toContain('checkout');
    }
  });

  it('fails closed when a capability state map has an unknown key', () => {
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('filters', {
          capabilityStates: {
            ...capabilityStates(),
            // @ts-expect-error intentionally invalid capability key
            importExportMaybe: 'supported',
          },
        }),
      ],
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'unknown-capability-key');
      expect(diag?.domainId).toBe('filters');
      expect(diag?.message).toContain('importExportMaybe');
    }
  });

  it('fails closed for commit when a required capability is contracted', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
        id === 'cells.values'
          ? domainRow(id, {
              capabilityStates: {
                ...capabilityStates(),
                capture: 'contracted',
              },
            })
          : domainRow(id),
      ),
    });

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      operation: 'commit',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'capability-state-blocked');
      expect(diag).toMatchObject({
        domainId: 'cells.values',
        capabilityKey: 'capture',
        capabilityState: 'contracted',
      });
    }
  });

  it('fails closed for checkout when checkout support is not started', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
        id === 'sheets'
          ? domainRow(id, {
              capabilityStates: {
                ...capabilityStates(),
                checkout: 'not-started',
              },
            })
          : domainRow(id),
      ),
    });

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      operation: 'checkout',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'capability-state-blocked');
      expect(diag).toMatchObject({
        domainId: 'sheets',
        capabilityKey: 'checkout',
        capabilityState: 'not-started',
      });
    }
  });

  it('allows derived capability states only for derived domains', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
        id === 'recalc-caches'
          ? domainRow(id, {
              domainClass: 'derived',
              capabilityStates: capabilityStates('derived'),
            })
          : domainRow(id),
      ),
    });

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      operation: 'commit',
    });

    expect(result.ok).toBe(true);
  });

  it('blocks opaque-preserved without preservation proof', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
        id === 'cells.formulas'
          ? domainRow(id, {
              capabilityStates: {
                ...capabilityStates(),
                persistence: 'opaque-preserved',
              },
            })
          : domainRow(id),
      ),
    });

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      operation: 'commit',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'capability-state-blocked');
      expect(diag).toMatchObject({
        domainId: 'cells.formulas',
        capabilityKey: 'persistence',
        capabilityState: 'opaque-preserved',
      });
    }
  });
});
