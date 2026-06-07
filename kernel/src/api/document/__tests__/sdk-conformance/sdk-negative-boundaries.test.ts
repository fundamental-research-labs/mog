/**
 * SDK Negative Boundary Tests
 *
 * Verify that internal types do NOT leak through the public SDK barrel
 * (`@mog-sdk/kernel`) or package export map.
 *
 * Also verifies MogSdkError stable contract surface.
 */

import { MogSdkError } from '../../../../errors/mog-sdk-error';
import { readFileSync } from 'node:fs';

// Use a star-import of the public barrel to check what IS and ISN'T exported.
import * as publicBarrel from '../../../../index';
import { DocumentFactory } from '../../../../index';

// ---------------------------------------------------------------------------
// Negative boundary — internal types must NOT appear in public barrel
// ---------------------------------------------------------------------------

describe('SDK negative boundaries — internal types not in public barrel', () => {
  const exported = publicBarrel as Record<string, unknown>;

  it('does not export DocumentContext', () => {
    expect('DocumentContext' in exported).toBe(false);
  });

  it('does not export DocumentHandleInternal', () => {
    expect('DocumentHandleInternal' in exported).toBe(false);
  });

  it('does not export raw ComputeBridge', () => {
    expect('ComputeBridge' in exported).toBe(false);
  });

  it('does not export raw IEventBus', () => {
    expect('IEventBus' in exported).toBe(false);
  });

  it('does not expose the legacy host-context DocumentFactory bypass', () => {
    expect('DocumentFactory' in exported).toBe(true);
    expect('createFromHostContext' in (exported.DocumentFactory as Record<string, unknown>)).toBe(
      false,
    );
  });

  it('does not export SpreadsheetEventType', () => {
    expect('SpreadsheetEventType' in exported).toBe(false);
  });

  it.each([
    'AppKernelAPI',
    'createAppKernelAPI',
    'createCapabilityGatedApi',
    'createUngatedAdapter',
    'Cells',
    'Records',
    'Sheets',
    'WorkbookConfig',
    'createDocumentContext',
    'ComputeBridge',
    'createCapabilityRegistry',
    'createMemoryGrantsStore',
    'MemoryGrantsStore',
  ])('does not export %s', (name) => {
    expect(name in exported).toBe(false);
  });

  it('does not expose app API construction on runtime DocumentHandle objects', async () => {
    const handle = await DocumentFactory.create({
      documentId: 'sdk-negative-boundary-handle-app-api',
      runtime: { kind: 'headless', userTimezone: 'UTC' },
    });
    try {
      expect('createAppKernelAPI' in (handle as Record<string, unknown>)).toBe(false);
    } finally {
      await handle.disposeAsync();
    }
  });
});

describe('SDK negative boundaries — source declarations', () => {
  it('does not re-export app API runtime or type symbols from the root barrel source', () => {
    const source = readFileSync(new URL('../../../../index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bAppKernelAPI\b/);
    expect(source).not.toMatch(/\bAppKernelAPIOptions\b/);
    expect(source).not.toMatch(/\bCapabilityGatedAPIOptions\b/);
    expect(source).not.toMatch(/\bCreateCapabilityGatedAPIOptions\b/);
    expect(source).not.toMatch(/\bScopedAPIContext\b/);
    expect(source).not.toMatch(/\bcreateAppKernelAPI\b/);
    expect(source).not.toMatch(/\bcreateCapabilityGatedApi\b/);
    expect(source).not.toMatch(/\bcreateUngatedAdapter\b/);
  });

  it('does not include createAppKernelAPI on the public DocumentHandle interface', () => {
    const source = readFileSync(new URL('../../document-handle-types.ts', import.meta.url), 'utf8');
    const documentHandleBlock = source.match(/export interface DocumentHandle \{[\s\S]*?\n\}/)?.[0];
    expect(documentHandleBlock).toBeDefined();
    expect(documentHandleBlock).not.toMatch(/\bcreateAppKernelAPI\s*\(/);
  });
});

describe('SDK boundaries — package export map', () => {
  it('exposes only the documented public and friend subpaths', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8'),
    ) as {
      exports?: Record<string, unknown>;
    };

    expect(manifest.exports).toBeDefined();
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual([
      '.',
      './api',
      './app-api',
      './contracts/api',
      './host-lifecycle-internal',
      './internal',
      './keyboard',
      './security',
      './services/capabilities',
      './storage',
      './testing',
    ]);
  });
});

// ---------------------------------------------------------------------------
// MogSdkError stable contract
// ---------------------------------------------------------------------------

describe('MogSdkError — stable error codes', () => {
  const EXPECTED_CODES = [
    'INVALID_ARGUMENT',
    'NOT_FOUND',
    'CONFLICT',
    'AUTHORIZATION_DENIED',
    'READ_ONLY',
    'DISPOSED',
    'IMPORT_ERROR',
    'EXPORT_ERROR',
    'COMPUTE_ERROR',
    'TRANSPORT_ERROR',
    'PROVIDER_ERROR',
    'INTERNAL_ERROR',
  ] as const;

  it.each(EXPECTED_CODES)('accepts error code %s', (code) => {
    const err = new MogSdkError(code, `test ${code}`);
    expect(err.code).toBe(code);
    expect(err.message).toBe(`test ${code}`);
    expect(err.name).toBe('MogSdkError');
    expect(err).toBeInstanceOf(Error);
  });

  it('all 12 stable codes are accounted for', () => {
    expect(EXPECTED_CODES).toHaveLength(12);
  });
});

describe('MogSdkError.toJSON() — serializable output', () => {
  it('produces an object with code and message fields', () => {
    const err = new MogSdkError('NOT_FOUND', 'sheet missing', {
      operation: 'getSheet',
      details: { sheetId: 'abc' },
    });
    const json = err.toJSON();

    expect(json.code).toBe('NOT_FOUND');
    expect(json.message).toBe('sheet missing');
    expect(json.operation).toBe('getSheet');
    expect(json.details).toEqual({ sheetId: 'abc' });
  });

  it('output is JSON.stringify-safe (no circular refs)', () => {
    const err = new MogSdkError('INTERNAL_ERROR', 'boom', {
      details: { nested: { a: 1 } },
    });
    const json = err.toJSON();

    expect(() => JSON.stringify(json)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(json));
    expect(parsed.code).toBe('INTERNAL_ERROR');
    expect(parsed.message).toBe('boom');
  });

  it('serializes cause chain when cause is also MogSdkError', () => {
    const inner = new MogSdkError('TRANSPORT_ERROR', 'bridge down');
    const outer = new MogSdkError('COMPUTE_ERROR', 'calc failed', { cause: inner });
    const json = outer.toJSON();

    expect(json.cause).toBeDefined();
    expect(json.cause!.code).toBe('TRANSPORT_ERROR');
    expect(json.cause!.message).toBe('bridge down');
  });

  it('omits cause when cause is not a MogSdkError', () => {
    const outer = new MogSdkError('INTERNAL_ERROR', 'wrapped', {
      cause: new TypeError('raw'),
    });
    const json = outer.toJSON();
    expect(json.cause).toBeUndefined();
  });
});

describe('MogSdkError.from() — wraps unknown errors', () => {
  it('returns MogSdkError as-is', () => {
    const original = new MogSdkError('CONFLICT', 'already exists');
    const result = MogSdkError.from(original);
    expect(result).toBe(original);
  });

  it('wraps a plain Error as INTERNAL_ERROR', () => {
    const err = new Error('something broke');
    const result = MogSdkError.from(err);
    expect(result).toBeInstanceOf(MogSdkError);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('something broke');
  });

  it('wraps a string as INTERNAL_ERROR', () => {
    const result = MogSdkError.from('unexpected string');
    expect(result).toBeInstanceOf(MogSdkError);
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('unexpected string');
  });

  it('wraps null/undefined as INTERNAL_ERROR', () => {
    const fromNull = MogSdkError.from(null);
    expect(fromNull.code).toBe('INTERNAL_ERROR');

    const fromUndefined = MogSdkError.from(undefined);
    expect(fromUndefined.code).toBe('INTERNAL_ERROR');
  });

  it('attaches operation when provided', () => {
    const err = new Error('fail');
    const result = MogSdkError.from(err, 'setCellValue');
    expect(result.operation).toBe('setCellValue');
  });
});
