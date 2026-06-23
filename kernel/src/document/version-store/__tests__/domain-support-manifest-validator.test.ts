import {
  DomainSupportManifestError,
  REQUIRED_FIRST_SLICE_DOMAIN_IDS,
  REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  assertDomainSupportManifest,
  validateDomainSupportManifest,
} from '../domain-support-manifest-validator';
import {
  domainRow,
  freshManifest,
  NOW,
  ONE_HOUR_MS,
} from './domain-support-manifest-validator-fixtures';

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
