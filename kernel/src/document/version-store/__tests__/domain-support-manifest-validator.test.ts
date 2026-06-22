import type {
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
} from '@mog-sdk/contracts/versioning';
import {
  DomainSupportManifestError,
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  assertDomainSupportManifest,
  validateDomainSupportManifest,
  type DomainSupportDetectorRow,
} from '../domain-support-manifest-validator';

function capabilityStates(
  state: VersionDomainCapabilityState = 'supported',
): VersionDomainCapabilityStateMap {
  return {
    capture: state,
    replay: state,
    diff: state,
    reviewAccess: state,
    checkout: state,
    merge: state,
    persistence: state,
    import: state,
    export: state,
  };
}

function domainRow(
  domainId: string,
  overrides: Partial<DomainCapabilityPolicyManifest> = {},
): DomainCapabilityPolicyManifest {
  return {
    domainId,
    domainClass: 'authored',
    capabilityStates: capabilityStates(),
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    rolloutStage: 'headless-local',
    historyAccess: {
      readMode: 'full',
      writeMode: 'full',
      redactionPolicy: 'none',
    },
    redactionPolicy: 'none',
    ...overrides,
  };
}

function freshManifest(
  overrides: Partial<DomainSupportManifest> = {},
): DomainSupportManifest {
  return {
    schemaVersion: '1',
    generatedAt: '2026-06-21T00:00:00.000Z',
    workbookId: 'wb-1',
    domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
    ...overrides,
  };
}

const NOW = new Date('2026-06-21T00:05:00.000Z');
const ONE_HOUR_MS = 60 * 60 * 1000;

describe('validateDomainSupportManifest (fail-closed)', () => {
  it('accepts a well-formed, fresh, complete manifest', () => {
    const result = validateDomainSupportManifest(freshManifest(), {
      now: NOW,
      maxAgeMs: ONE_HOUR_MS,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.presentDomainIds).toEqual([...REQUIRED_FIRST_SLICE_DOMAIN_IDS]);
    }
  });

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
    const result = validateDomainSupportManifest(
      freshManifest({ schemaVersion: '999' }),
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('schema-version-unsupported');
    }
  });

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

  it('fails closed when a required first-slice domain row is absent', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.filter((id) => id !== 'cells.formulas').map(
        (id) => domainRow(id),
      ),
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.diagnostics.find((d) => d.code === 'required-domain-missing');
      expect(missing).toBeDefined();
      expect(missing?.domainId).toBe('cells.formulas');
    }
  });

  it('fails closed when a domain references an unknown domainClass', () => {
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('tables', {
          // @ts-expect-error intentionally invalid class
          domainClass: 'not-a-real-class',
        }),
      ],
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'unknown-domain-class');
      expect(diag?.domainId).toBe('tables');
    }
  });

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

  it('fails closed when a detected-present domain has no policy row', () => {
    const detectorRows: readonly DomainSupportDetectorRow[] = [
      { domainId: 'pivots', present: true, detectorId: 'detector.pivots' },
    ];

    const result = validateDomainSupportManifest(freshManifest(), {
      now: NOW,
      detectorRows,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const diag = result.diagnostics.find((d) => d.code === 'detector-row-missing');
      expect(diag?.domainId).toBe('pivots');
    }
  });

  it('accepts when a detected-present domain has a matching policy row', () => {
    const manifest = freshManifest({
      domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), domainRow('pivots')],
    });
    const detectorRows: readonly DomainSupportDetectorRow[] = [
      { domainId: 'pivots', present: true, detectorId: 'detector.pivots' },
      { domainId: 'charts', present: false },
    ];

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      maxAgeMs: ONE_HOUR_MS,
      detectorRows,
    });

    expect(result.ok).toBe(true);
  });

  it('fails closed on a non-object manifest without throwing', () => {
    const result = validateDomainSupportManifest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('manifest-malformed');
    }
  });

  it('reports duplicate domain rows', () => {
    const manifest = freshManifest({
      domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), domainRow('sheets')],
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toContain('duplicate-domain');
    }
  });
});

describe('assertDomainSupportManifest', () => {
  it('returns present domain ids on a valid manifest', () => {
    const ids = assertDomainSupportManifest(freshManifest(), {
      now: NOW,
      maxAgeMs: ONE_HOUR_MS,
    });
    expect(ids).toEqual([...REQUIRED_FIRST_SLICE_DOMAIN_IDS]);
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
});
