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
  VERSION_DOMAIN_POLICY_CONTRACT_VERSION,
  VERSION_DOMAIN_PUBLIC_DIAGNOSTIC_CODE_PATTERN,
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
const DEPRECATED_SCALAR_SUPPORT_FIELDS = Object.freeze([
  'capabilityState',
  'capabilityStateWhenPresent',
] as const);

const PUBLIC_SAFE_SINK_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const UNSAFE_PUBLIC_DIAGNOSTIC_PAYLOAD =
  /ownerWorkstream|requiredOracles|requiredOracleByCapability|supportEvidenceByCapability|scenarioIds|reportPath|acceptedRisk|evidenceDigest|mog-internal|dev\/version-control-eval|plans\/|\/Users\/|xl\/|\.xml\b|https?:\/\/|password\s*=|token\s*=/i;

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
      expect(row.policyContractVersion).toBe(VERSION_DOMAIN_POLICY_CONTRACT_VERSION);
      expect(row.publicDiagnosticCodes ?? []).toBeDefined();
      expect(row.surfaceRedactionPolicies ?? []).toBeDefined();
      expect(row.historyAccess.diagnosticProjection).toEqual(
        VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY,
      );
      for (const internalField of INTERNAL_ONLY_FIELDS) {
        expect(row).not.toHaveProperty(internalField);
      }
      for (const deprecatedScalarSupportField of DEPRECATED_SCALAR_SUPPORT_FIELDS) {
        expect(row).not.toHaveProperty(deprecatedScalarSupportField);
      }
    }
    expect(JSON.stringify(PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY)).not.toContain('expected-failing');
  });

  it('keeps table and filter public policy identities explicit and map-backed', () => {
    const rows = new Map(
      PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => [row.matrixRowId, row]),
    );

    expect(rows.get('tables')).toMatchObject({
      domainPolicyId: 'tables',
      matrixRowId: 'tables',
      domainId: 'tables',
    });
    expect(rows.get('filters.auto-filter')).toMatchObject({
      domainPolicyId: 'filters.auto-filter',
      matrixRowId: 'filters.auto-filter',
      domainId: 'filters',
    });
    expect(rows.get('filters.auto-filter')?.domainPolicyId).not.toBe(
      rows.get('filters.auto-filter')?.domainId,
    );

    for (const matrixRowId of ['tables', 'filters.auto-filter'] as const) {
      const row = rows.get(matrixRowId);
      expect(row).toBeDefined();
      expect(row?.capabilityStates).toBeDefined();
      expect(Object.keys(row?.capabilityStates ?? {}).sort()).toEqual(
        [...VERSION_DOMAIN_CAPABILITY_KEYS].sort(),
      );
      for (const deprecatedScalarSupportField of DEPRECATED_SCALAR_SUPPORT_FIELDS) {
        expect(row).not.toHaveProperty(deprecatedScalarSupportField);
      }
    }
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

  it('publishes redaction-scoped diagnostics for every opaque public row', () => {
    const diagnosticCodePattern = new RegExp(VERSION_DOMAIN_PUBLIC_DIAGNOSTIC_CODE_PATTERN);
    const rows = PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.filter((row) =>
      Object.values(row.capabilityStates).some(
        (state) => state === 'opaque-preserved' || state === 'opaque-blocking',
      ),
    );

    expect(rows.map((row) => row.domainPolicyId).sort()).toEqual([
      'cells.formats.catalogs',
      'external-links',
      'ooxml-sidecars',
      'pivots',
      'protection',
    ]);

    for (const row of rows) {
      expect(row.publicDiagnosticCodes?.length).toBeGreaterThan(0);
      expect(row.surfaceRedactionPolicies?.length).toBeGreaterThan(0);
      for (const diagnosticCode of row.publicDiagnosticCodes ?? []) {
        expect(diagnosticCode).toMatch(diagnosticCodePattern);
      }
      for (const policy of row.surfaceRedactionPolicies ?? []) {
        expect(policy.sinks.length).toBeGreaterThan(0);
        for (const sink of policy.sinks) {
          expect(sink).toMatch(PUBLIC_SAFE_SINK_PATTERN);
        }
      }
      expect(
        JSON.stringify({
          publicDiagnosticCodes: row.publicDiagnosticCodes,
          surfaceRedactionPolicies: row.surfaceRedactionPolicies,
        }),
      ).not.toMatch(UNSAFE_PUBLIC_DIAGNOSTIC_PAYLOAD);
    }
  });

  it('keeps concrete opaque diagnostic policies public-safe for pivots, charts, and external links', () => {
    const rows = new Map(
      PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains.map((row) => [row.domainPolicyId, row]),
    );

    expect(rows.get('pivots')?.publicDiagnosticCodes).toEqual(
      expect.arrayContaining([
        'version.domain.pivots.opaque-preserved',
        'version.domain.pivots.review-blocked',
        'version.domain.pivots.merge-blocked',
      ]),
    );
    expect(rows.get('pivots')?.surfaceRedactionPolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceKind: 'object-store',
          sensitivity: 'opaque-payload',
          requiredPolicy: 'opaque-digest-only',
          sinks: ['version-object-store'],
        }),
        expect.objectContaining({
          surfaceKind: 'merge',
          sensitivity: 'opaque-payload',
          requiredPolicy: 'metadata-only',
          sinks: ['merge-preview'],
        }),
      ]),
    );

    expect(rows.get('charts.source-range')?.publicDiagnosticCodes).toEqual(
      expect.arrayContaining([
        'version.domain.charts.unsupported-sidecar-redacted',
        'version.domain.charts.opaque-payload-blocked',
      ]),
    );
    expect(rows.get('charts.source-range')?.surfaceRedactionPolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceKind: 'diagnostics',
          sensitivity: 'opaque-payload',
          requiredPolicy: 'metadata-only',
          sinks: ['version-history', 'domain-support-manifest'],
        }),
        expect.objectContaining({
          surfaceKind: 'export',
          sensitivity: 'opaque-payload',
          requiredPolicy: 'metadata-only',
          sinks: ['xlsx-export-metadata'],
        }),
      ]),
    );

    expect(rows.get('external-links')?.publicDiagnosticCodes).toEqual(
      expect.arrayContaining([
        'version.domain.external-links.opaque-preserved',
        'version.domain.external-links.review-blocked',
        'version.domain.external-links.export-blocked',
        'version.domain.external-links.redacted-target',
      ]),
    );
    expect(rows.get('external-links')?.surfaceRedactionPolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceKind: 'diagnostics',
          sensitivity: 'external-target',
          requiredPolicy: 'content-redacted',
          sinks: ['version-history', 'domain-support-manifest'],
        }),
        expect.objectContaining({
          surfaceKind: 'object-store',
          sensitivity: 'credential',
          requiredPolicy: 'opaque-digest-only',
          sinks: ['version-object-store'],
        }),
        expect.objectContaining({
          surfaceKind: 'export',
          sensitivity: 'external-target',
          requiredPolicy: 'content-redacted',
          sinks: ['xlsx-export-metadata'],
        }),
      ]),
    );
  });
});
