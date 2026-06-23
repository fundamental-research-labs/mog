import {
  PUBLIC_VERSION_DOMAIN_POLICY_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
  PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT,
  VERSION_DOMAIN_CAPABILITY_KEYS,
  VERSION_DOMAIN_POLICY_ID_PATTERN,
  VERSION_DOMAIN_POLICY_REGISTRY_SCHEMA_VERSION,
  VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY,
} from '../index';
import {
  PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS,
} from '../domain-policy-registry';

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
    expect(PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS).toEqual([
      'workbook-metadata',
      'sheets',
      'rows-columns',
      'cells.values',
      'cells.formulas',
      'recalc-caches',
    ]);

    const idPattern = new RegExp(VERSION_DOMAIN_POLICY_ID_PATTERN);
    for (const row of PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains) {
      expect(row.domainPolicyId).toBe(row.matrixRowId);
      expect(row.domainPolicyId).toMatch(idPattern);
      expect(Object.values(row.capabilityStates)).not.toContain('expected-failing');
      expect(Object.keys(row.capabilityStates).sort()).toEqual(
        [...VERSION_DOMAIN_CAPABILITY_KEYS].sort(),
      );
      expect(row.historyAccess.diagnosticProjection).toEqual(
        VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY,
      );
      for (const internalField of INTERNAL_ONLY_FIELDS) {
        expect(row).not.toHaveProperty(internalField);
      }
    }
    expect(JSON.stringify(PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY)).not.toContain('expected-failing');
  });

  it('keeps first-slice public runtime states promoted and explicit', () => {
    const rows = new Map(
      PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => [row.domainPolicyId, row]),
    );

    expect(rows.get('workbook-metadata')?.capabilityStates).toMatchObject({
      capture: 'supported',
      replay: 'supported',
      checkout: 'supported',
      persistence: 'supported',
      merge: 'supported',
      export: 'supported',
    });
    expect(rows.get('sheets')?.capabilityStates).toMatchObject({
      capture: 'supported',
      replay: 'supported',
      diff: 'supported',
      checkout: 'supported',
      persistence: 'supported',
      merge: 'supported',
      export: 'supported',
    });
    expect(rows.get('cells.values')?.capabilityStates).toMatchObject({
      capture: 'supported',
      replay: 'supported',
      diff: 'supported',
      checkout: 'supported',
      persistence: 'supported',
      merge: 'supported',
      export: 'supported',
    });
    expect(rows.get('cells.formulas')?.capabilityStates).toMatchObject({
      capture: 'supported',
      replay: 'supported',
      diff: 'supported',
      checkout: 'supported',
      persistence: 'supported',
      merge: 'supported',
      export: 'supported',
    });
    expect(rows.get('rows-columns')?.capabilityStates).toMatchObject({
      capture: 'supported',
      replay: 'supported',
      diff: 'supported',
      checkout: 'supported',
      persistence: 'supported',
      merge: 'supported',
      export: 'supported',
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

  it('keeps the required public export floor supported', () => {
    const rows = new Map(
      PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => [row.matrixRowId, row]),
    );

    expect(PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS).toBe(true);
    for (const matrixRowId of PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS) {
      const exportState = rows.get(matrixRowId)?.capabilityStates.export;
      expect(exportState === 'supported' || exportState === 'derived').toBe(true);
    }
  });

  it('reports when the full public registry still contains rows outside the export floor', () => {
    const unsupportedRows = PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.filter(
      (row) => row.capabilityStates.export !== 'supported',
    );

    expect(PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS).toBe(
      unsupportedRows.length === 0,
    );
    expect(PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_ALL_ROWS).toBe(false);
    expect(unsupportedRows.length).toBeGreaterThan(0);
    expect(unsupportedRows.length).toBeLessThanOrEqual(PUBLIC_VERSION_DOMAIN_POLICY_ROW_COUNT);
  });
});
