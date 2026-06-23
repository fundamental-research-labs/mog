import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';
import type {
  DomainCapabilityPolicyManifest,
  DomainSupportManifest,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
} from '@mog-sdk/contracts/versioning';
import {
  DomainSupportManifestError,
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
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
    domainPolicyId: overrides.domainPolicyId ?? overrides.matrixRowId ?? domainId,
    matrixRowId: overrides.matrixRowId ?? domainId,
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

function freshManifest(overrides: Partial<DomainSupportManifest> = {}): DomainSupportManifest {
  return {
    schemaVersion: 'domain-support-manifest.v2',
    generatedAt: '2026-06-21T00:00:00.000Z',
    workbookId: 'wb-1',
    domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
    ...overrides,
  };
}

function registryManifest(
  matrixRowIds: readonly string[] = REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
): DomainSupportManifest {
  const wanted = new Set(matrixRowIds);
  return freshManifest({
    domains: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.filter((row) =>
      wanted.has(row.matrixRowId),
    ),
  });
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
      expect(result.presentMatrixRowIds).toEqual([...REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS]);
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

  it('fails closed when a required first-slice matrix row is absent', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.filter((id) => id !== 'cells.formulas').map((id) =>
        domainRow(id),
      ),
    });

    const result = validateDomainSupportManifest(manifest, { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.diagnostics.find((d) => d.code === 'required-matrix-row-missing');
      expect(missing).toBeDefined();
      expect(missing?.matrixRowId).toBe('cells.formulas');
    }
  });

  it('does not let a broad domain row stand in for a required subtype matrix row', () => {
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [
          ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
          domainRow('cells.formats', { matrixRowId: 'cells.formats' }),
        ],
      }),
      {
        now: NOW,
        requiredMatrixRowIds: ['cells.formats.direct'],
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.diagnostics.find((d) => d.code === 'required-matrix-row-missing');
      expect(missing).toMatchObject({ matrixRowId: 'cells.formats.direct' });
    }
  });

  it('accepts multiple subtype rows for the same broad domain when matrix row ids differ', () => {
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [
          ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
          domainRow('cells.formats', { matrixRowId: 'cells.formats.direct' }),
          domainRow('cells.formats', { matrixRowId: 'cells.formats.catalogs' }),
        ],
      }),
      {
        now: NOW,
        requiredMatrixRowIds: ['cells.formats.direct', 'cells.formats.catalogs'],
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.presentMatrixRowIds).toEqual(
        expect.arrayContaining(['cells.formats.direct', 'cells.formats.catalogs']),
      );
      expect(result.presentDomainIds).toContain('cells.formats');
    }
  });

  it('fails closed when a policy row omits matrixRowId', () => {
    const row = domainRow('filters') as any;
    delete row.matrixRowId;
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
      }),
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'matrix-row-id-missing')).toMatchObject({
        domainId: 'filters',
      });
    }
  });

  it('fails closed when a policy row omits domainPolicyId', () => {
    const row = domainRow('filters') as any;
    delete row.domainPolicyId;
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
      }),
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'domain-policy-id-missing')).toMatchObject({
        domainId: 'filters',
        matrixRowId: 'filters',
        policyField: 'domainPolicyId',
      });
    }
  });

  it('fails closed when a policy row uses a non-public-safe domainPolicyId', () => {
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [
          ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
          domainRow('filters', { domainPolicyId: 'internal/Plan VC-06' }),
        ],
      }),
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'domain-policy-id-malformed')).toMatchObject(
        {
          domainId: 'filters',
          matrixRowId: 'filters',
          policyField: 'domainPolicyId',
          policyValue: 'internal/Plan VC-06',
        },
      );
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

  it('fails closed when required policy fields are missing', () => {
    const row = domainRow('filters') as any;
    delete row.capturePolicy;
    delete row.writeAdmissionMode;
    delete row.rolloutStage;
    delete row.historyAccess;
    delete row.redactionPolicy;
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
      }),
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(
        expect.arrayContaining([
          'capture-policy-missing',
          'write-admission-mode-missing',
          'rollout-stage-missing',
          'history-access-missing',
          'redaction-policy-missing',
        ]),
      );
      expect(result.diagnostics.find((d) => d.code === 'history-access-missing')).toMatchObject({
        domainId: 'filters',
        matrixRowId: 'filters',
        policyField: 'historyAccess',
      });
    }
  });

  it('fails closed when policy fields reference unknown values', () => {
    const row = domainRow('filters') as any;
    row.capturePolicy = 'captureEventually';
    row.writeAdmissionMode = 'bestEffort';
    row.rolloutStage = 'surprise';
    row.historyAccess = {
      readMode: 'everything',
      writeMode: 'sometimes',
      redactionPolicy: 'trust-me',
    };
    row.redactionPolicy = 'unknown';
    const result = validateDomainSupportManifest(
      freshManifest({
        domains: [...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)), row],
      }),
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(
        expect.arrayContaining([
          'unknown-capture-policy',
          'unknown-write-admission-mode',
          'unknown-rollout-stage',
          'unknown-history-read-mode',
          'unknown-history-write-mode',
          'unknown-history-redaction-policy',
          'unknown-redaction-policy',
        ]),
      );
      expect(
        result.diagnostics.find((d) => d.code === 'unknown-write-admission-mode'),
      ).toMatchObject({
        domainId: 'filters',
        matrixRowId: 'filters',
        policyField: 'writeAdmissionMode',
        policyValue: 'bestEffort',
      });
    }
  });

  it('blocks durable operations when policy write admission is block', () => {
    const manifest = freshManifest({
      domains: REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) =>
        id === 'cells.values'
          ? domainRow(id, {
              writeAdmissionMode: 'block',
            })
          : domainRow(id),
      ),
    });

    expect(validateDomainSupportManifest(manifest, { now: NOW }).ok).toBe(true);

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      operation: 'commit',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.find((d) => d.code === 'write-admission-mode-blocked'),
      ).toMatchObject({
        domainId: 'cells.values',
        matrixRowId: 'cells.values',
        policyField: 'writeAdmissionMode',
        policyValue: 'block',
      });
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

  it('fails closed when a detected-present subtype matrix row has no policy row', () => {
    const detectorRows: readonly DomainSupportDetectorRow[] = [
      {
        matrixRowId: 'cells.formats.direct',
        domainId: 'cells.formats',
        present: true,
        detectorId: 'detector.formats',
      },
    ];
    const manifest = freshManifest({
      domains: [
        ...REQUIRED_FIRST_SLICE_DOMAIN_IDS.map((id) => domainRow(id)),
        domainRow('cells.formats', { matrixRowId: 'cells.formats.catalogs' }),
      ],
    });

    const result = validateDomainSupportManifest(manifest, {
      now: NOW,
      detectorRows,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'detector-row-missing')).toMatchObject({
        matrixRowId: 'cells.formats.direct',
        domainId: 'cells.formats',
      });
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

  it('accepts first-slice rows that match the public domain policy registry', () => {
    const result = validateDomainSupportManifest(registryManifest(), {
      now: NOW,
      operation: 'checkout',
      domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
    });

    expect(result.ok).toBe(true);
  });

  it('fails closed when a manifest references an unknown public domain policy id', () => {
    const manifest = registryManifest();
    const cells = manifest.domains.find((row) => row.domainPolicyId === 'cells.values');
    if (!cells) throw new Error('missing cells.values registry row');
    const drifted = {
      ...cells,
      domainPolicyId: 'cells.values.unregistered',
    } as DomainCapabilityPolicyManifest;

    const result = validateDomainSupportManifest(
      {
        ...manifest,
        domains: manifest.domains.map((row) =>
          row.domainPolicyId === 'cells.values' ? drifted : row,
        ),
      },
      {
        now: NOW,
        domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.find((d) => d.code === 'unknown-domain-policy')).toMatchObject({
        matrixRowId: 'cells.values',
        domainId: 'cells.values',
        policyField: 'domainPolicyId',
        policyValue: 'cells.values.unregistered',
      });
    }
  });

  it('fails closed when a manifest row drifts from the public registry policy', () => {
    const manifest = registryManifest();
    const cells = manifest.domains.find((row) => row.domainPolicyId === 'cells.values');
    if (!cells) throw new Error('missing cells.values registry row');
    const drifted = {
      ...cells,
      capabilityStates: {
        ...cells.capabilityStates,
        capture: 'contracted',
      },
    } as DomainCapabilityPolicyManifest;

    const result = validateDomainSupportManifest(
      {
        ...manifest,
        domains: manifest.domains.map((row) =>
          row.domainPolicyId === 'cells.values' ? drifted : row,
        ),
      },
      {
        now: NOW,
        domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.diagnostics.find((d) => d.code === 'domain-policy-registry-mismatch'),
      ).toMatchObject({
        matrixRowId: 'cells.values',
        domainId: 'cells.values',
        policyField: 'capabilityStates.capture',
        policyValue: 'contracted',
      });
    }
  });

  it('does not echo eval-only expected-failing capability states in diagnostics', () => {
    const manifest = registryManifest();
    const cells = manifest.domains.find((row) => row.domainPolicyId === 'cells.values');
    if (!cells) throw new Error('missing cells.values registry row');
    const drifted = {
      ...cells,
      capabilityStates: {
        ...cells.capabilityStates,
        capture: 'expected-failing',
      },
    } as unknown as DomainCapabilityPolicyManifest;

    const result = validateDomainSupportManifest(
      {
        ...manifest,
        domains: manifest.domains.map((row) =>
          row.domainPolicyId === 'cells.values' ? drifted : row,
        ),
      },
      {
        now: NOW,
        operation: 'commit',
        domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
      },
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('expected-failing');
    if (!result.ok) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(
        expect.arrayContaining(['unknown-capability-state', 'domain-policy-registry-mismatch']),
      );
      expect(
        result.diagnostics.find(
          (d) =>
            d.code === 'domain-policy-registry-mismatch' &&
            d.policyField === 'capabilityStates.capture',
        ),
      ).not.toHaveProperty('policyValue');
    }
  });
});

describe('assertDomainSupportManifest', () => {
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
});
