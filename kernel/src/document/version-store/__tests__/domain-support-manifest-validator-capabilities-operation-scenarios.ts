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

export function registerCapabilityOperationScenarios(): void {
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

  it('enforces extra manifest row capabilities only when the row is detector-present', () => {
    const blockedNamedRangeRow = domainRow('named-ranges', {
      capabilityStates: {
        ...capabilityStates(),
        capture: 'contracted',
      },
    });
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        blockedNamedRangeRow,
      ],
    });

    expect(
      validateDomainSupportManifest(manifest, {
        now: NOW,
        operation: 'commit',
      }).ok,
    ).toBe(true);

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      operation: 'commit',
      detectorRows: [
        {
          matrixRowId: 'named-ranges',
          domainId: 'named-ranges',
          present: true,
          detectorId: 'detector.named-ranges',
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'capability-state-blocked',
            matrixRowId: 'named-ranges',
            capabilityKey: 'capture',
            capabilityState: 'contracted',
          }),
        ]),
      );
    }
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
}
