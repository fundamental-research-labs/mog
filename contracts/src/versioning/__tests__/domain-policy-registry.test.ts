import {
  PUBLIC_VERSION_DOMAIN_POLICY_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
  PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT,
  VERSION_DOMAIN_CAPABILITY_KEYS,
  VERSION_DOMAIN_POLICY_ID_PATTERN,
  VERSION_DOMAIN_POLICY_REGISTRY_SCHEMA_VERSION,
} from '../index';

const INTERNAL_ONLY_FIELDS = Object.freeze([
  'ownerWorkstream',
  'requiredOracles',
  'requiredOracleByCapability',
  'supportEvidenceByCapability',
  'scenarioIds',
  'notes',
  'reportPath',
  'acceptedRisk',
  'evidenceDigest',
] as const);

describe('PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY', () => {
  it('exports a closed public-safe policy id set for the current matrix projection', () => {
    expect(PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.schemaVersion).toBe(
      VERSION_DOMAIN_POLICY_REGISTRY_SCHEMA_VERSION,
    );
    expect(PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains).toHaveLength(44);
    expect(PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT).toBe(44);
    expect(PUBLIC_VERSION_DOMAIN_POLICY_IDS).toHaveLength(44);
    expect(new Set(PUBLIC_VERSION_DOMAIN_POLICY_IDS).size).toBe(44);

    const idPattern = new RegExp(VERSION_DOMAIN_POLICY_ID_PATTERN);
    for (const row of PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains) {
      expect(row.domainPolicyId).toBe(row.matrixRowId);
      expect(row.domainPolicyId).toMatch(idPattern);
      expect(Object.values(row.capabilityStates)).not.toContain('expected-failing');
      expect(Object.keys(row.capabilityStates).sort()).toEqual(
        [...VERSION_DOMAIN_CAPABILITY_KEYS].sort(),
      );
      for (const internalField of INTERNAL_ONLY_FIELDS) {
        expect(row).not.toHaveProperty(internalField);
      }
    }
    expect(JSON.stringify(PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY)).not.toContain(
      'expected-failing',
    );
  });

  it('keeps first-slice public runtime states conservative and explicit', () => {
    const rows = new Map(
      PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => [row.domainPolicyId, row]),
    );

    expect(rows.get('workbook-metadata')?.capabilityStates).toMatchObject({
      capture: 'supported',
      replay: 'supported',
      checkout: 'supported',
      persistence: 'supported',
      merge: 'contracted',
      export: 'contracted',
    });
    expect(rows.get('cells.values')?.capabilityStates).toMatchObject({
      capture: 'supported',
      replay: 'supported',
      diff: 'supported',
      checkout: 'supported',
      persistence: 'supported',
      merge: 'contracted',
    });
    expect(rows.get('recalc-caches')?.capabilityStates).toMatchObject({
      capture: 'derived',
      replay: 'derived',
      checkout: 'derived',
      export: 'derived',
    });
    expect(rows.get('protection')?.capabilityStates).toMatchObject({
      capture: 'opaque-blocking',
      checkout: 'opaque-blocking',
      export: 'opaque-blocking',
    });
  });
});
