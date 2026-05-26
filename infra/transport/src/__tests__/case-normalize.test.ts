/**
 * Regression tests for the snake_case → camelCase boundary normalizer.
 *
 * Guarantees the WASM transport produces identical-shape (camelCase-keyed)
 * results as the NAPI transport, eliminating the need for `?? snake_case`
 * fallbacks at every consumer call site.
 */
import { jest } from '@jest/globals';

import { createCaseNormalizingTransport, deepSnakeToCamel, snakeToCamel } from '../case-normalize';
import type { BridgeTransport } from '@rust-bridge/client';

describe('snakeToCamel', () => {
  it('converts simple snake_case to camelCase', () => {
    expect(snakeToCamel('start_id')).toBe('startId');
    expect(snakeToCamel('start_row_id')).toBe('startRowId');
    expect(snakeToCamel('id')).toBe('id');
  });

  it('matches NAPI behavior on leading underscores (folds into next letter)', () => {
    // Bridge result keys never start with `_` (Rust serde wouldn't produce
    // that), so the exact leading-underscore semantics don't matter for
    // correctness — only that NAPI and WASM agree. Both use the same regex.
    expect(snakeToCamel('_internal')).toBe('Internal');
  });

  it('leaves already-camel keys unchanged', () => {
    expect(snakeToCamel('startId')).toBe('startId');
    expect(snakeToCamel('startRowAbsolute')).toBe('startRowAbsolute');
  });

  it('handles all-caps trailing segments by lowercasing the leading char', () => {
    // Rust serde rename_all = "camelCase" lowercases the segment after `_`.
    // We mirror that — it's the same conversion convention.
    expect(snakeToCamel('start_a')).toBe('startA');
  });
});

describe('deepSnakeToCamel', () => {
  it('renames keys recursively in plain objects', () => {
    expect(
      deepSnakeToCamel({
        start_id: 'A1',
        nested: { end_row_absolute: true, deep: { col_id: 'C1' } },
      }),
    ).toEqual({
      startId: 'A1',
      nested: { endRowAbsolute: true, deep: { colId: 'C1' } },
    });
  });

  it('renames keys inside arrays', () => {
    expect(
      deepSnakeToCamel([
        { start_id: 'A1', end_id: 'A5' },
        { start_id: 'B1', end_id: 'B5' },
      ]),
    ).toEqual([
      { startId: 'A1', endId: 'A5' },
      { startId: 'B1', endId: 'B5' },
    ]);
  });

  it('preserves Uint8Array (binary payloads)', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = deepSnakeToCamel(bytes);
    expect(result).toBe(bytes);
  });

  it('preserves Uint8Array inside a tuple metadata', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = deepSnakeToCamel<[Uint8Array, { changed_cells: number }]>([
      bytes,
      { changed_cells: 7 },
    ]);
    expect(result[0]).toBe(bytes);
    expect(result[1]).toEqual({ changedCells: 7 });
  });

  it('passes primitives through unchanged', () => {
    expect(deepSnakeToCamel(42)).toBe(42);
    expect(deepSnakeToCamel('hello')).toBe('hello');
    expect(deepSnakeToCamel(true)).toBe(true);
    expect(deepSnakeToCamel(null)).toBe(null);
    expect(deepSnakeToCamel(undefined)).toBe(undefined);
  });

  it('preserves class instances (does not key-rewrite)', () => {
    class Custom {
      snake_field = 1;
    }
    const inst = new Custom();
    const result = deepSnakeToCamel(inst);
    // We deliberately do not rewrite class instances — Rust serde never
    // produces these, and renaming would corrupt the class.
    expect(result).toBe(inst);
  });

  it('handles representative DefinedNameWire shape (named-ranges regression)', () => {
    // This shape is what mapRustNamedRange used to need `?? snake_case`
    // fallbacks for. Verify the normalizer produces the camelCase keys
    // the TS contracts expect.
    const wasmRaw = {
      id: 'name_1',
      name: 'SalesData',
      refers_to: {
        template: 'Sheet1!$A$1:$C$10',
        refs: [
          {
            Range: {
              start_id: 'cell_a1',
              end_id: 'cell_c10',
              start_row_absolute: true,
              start_col_absolute: true,
              end_row_absolute: true,
              end_col_absolute: true,
            },
          },
          { FullRow: { row_id: 'row_5', absolute: false } },
          {
            RowRange: {
              start_row_id: 'row_1',
              end_row_id: 'row_10',
              start_absolute: false,
              end_absolute: false,
            },
          },
          { FullCol: { col_id: 'col_b', absolute: true } },
          {
            ColRange: {
              start_col_id: 'col_a',
              end_col_id: 'col_c',
              start_absolute: false,
              end_absolute: false,
            },
          },
        ],
      },
    };

    const result = deepSnakeToCamel<{
      refersTo: {
        refs: Array<Record<string, Record<string, unknown>>>;
      };
    }>(wasmRaw);

    expect(result.refersTo.refs[0].Range).toEqual({
      startId: 'cell_a1',
      endId: 'cell_c10',
      startRowAbsolute: true,
      startColAbsolute: true,
      endRowAbsolute: true,
      endColAbsolute: true,
    });
    expect(result.refersTo.refs[1].FullRow).toEqual({ rowId: 'row_5', absolute: false });
    expect(result.refersTo.refs[2].RowRange).toEqual({
      startRowId: 'row_1',
      endRowId: 'row_10',
      startAbsolute: false,
      endAbsolute: false,
    });
    expect(result.refersTo.refs[3].FullCol).toEqual({ colId: 'col_b', absolute: true });
    expect(result.refersTo.refs[4].ColRange).toEqual({
      startColId: 'col_a',
      endColId: 'col_c',
      startAbsolute: false,
      endAbsolute: false,
    });
  });

  it('handles representative GoalSeekResult shape (goal-seek regression)', () => {
    const wasmRaw = {
      found: true,
      solution_value: 42,
      achieved_value: 41.99999,
      iterations: 7,
    };
    expect(deepSnakeToCamel(wasmRaw)).toEqual({
      found: true,
      solutionValue: 42,
      achievedValue: 41.99999,
      iterations: 7,
    });
  });
});

describe('createCaseNormalizingTransport', () => {
  function makeStubTransport(handler: (cmd: string, args: unknown) => unknown): BridgeTransport {
    return {
      async call<T>(command: string, args: Record<string, unknown>): Promise<T> {
        return handler(command, args) as T;
      },
    };
  }

  it('normalizes plain-object responses', async () => {
    const inner = makeStubTransport(() => ({ start_id: 'A1', end_id: 'A5' }));
    const wrapped = createCaseNormalizingTransport(inner);
    const result = await wrapped.call('compute_get_named_range', { docId: 'd' });
    expect(result).toEqual({ startId: 'A1', endId: 'A5' });
  });

  it('normalizes array responses element-wise', async () => {
    const inner = makeStubTransport(() => [
      { sheet_id: 's1', cell_id: 'A1' },
      { sheet_id: 's2', cell_id: 'B2' },
    ]);
    const wrapped = createCaseNormalizingTransport(inner);
    const result = await wrapped.call('compute_get_all_cells', { docId: 'd' });
    expect(result).toEqual([
      { sheetId: 's1', cellId: 'A1' },
      { sheetId: 's2', cellId: 'B2' },
    ]);
  });

  it('preserves [Uint8Array, MutationResult] tuple shapes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const inner = makeStubTransport(() => [bytes, { changed_cells: ['A1'] }]);
    const wrapped = createCaseNormalizingTransport(inner);
    const result = await wrapped.call<[Uint8Array, { changedCells: string[] }]>(
      'compute_set_cell',
      { docId: 'd' },
    );
    expect(result[0]).toBe(bytes);
    expect(result[1]).toEqual({ changedCells: ['A1'] });
  });

  it('passes primitive responses through', async () => {
    const inner = makeStubTransport(() => true);
    const wrapped = createCaseNormalizingTransport(inner);
    expect(await wrapped.call('compute_can_undo', { docId: 'd' })).toBe(true);
  });

  it('passes Uint8Array responses through (sync state vector)', async () => {
    const bytes = new Uint8Array([0x42, 0x07]);
    const inner = makeStubTransport(() => bytes);
    const wrapped = createCaseNormalizingTransport(inner);
    const result = await wrapped.call<Uint8Array>('compute_encode_state_vector', { docId: 'd' });
    expect(result).toBe(bytes);
  });

  it('forwards command + args verbatim to inner transport', async () => {
    const spy = jest.fn(() => ({}));
    const inner = makeStubTransport(spy as never);
    const wrapped = createCaseNormalizingTransport(inner);
    await wrapped.call('compute_set_cell', { docId: 'd', sheetId: 's1', value: 42 });
    expect(spy).toHaveBeenCalledWith('compute_set_cell', {
      docId: 'd',
      sheetId: 's1',
      value: 42,
    });
  });

  it('produces NAPI-equivalent shape for representative WASM result (parity test)', async () => {
    // The point of the boundary fix: WASM and NAPI must yield the same
    // camelCase shape so consumers don't branch on transport.
    //
    // NAPI path: ComputeEngine method returns JSON string of snake_case
    //   struct → JSON.parse → deepSnakeToCamel inside napi-transport.
    // WASM path: serde_wasm_bindgen returns JS object (often snake_case
    //   for inner enum payloads) → createCaseNormalizingTransport.
    //
    // Both paths must produce the same final object.
    const rustNamedRange = {
      id: 'nr1',
      name: 'Total',
      refers_to: {
        template: 'Sheet1!$A$1',
        refs: [{ Cell: { id: 'cell_xyz', row_absolute: true, col_absolute: false } }],
      },
      scope: 'Workbook',
      visible: true,
    };

    // Simulated NAPI path (matches napi-transport.ts exactly).
    const napiResult = deepSnakeToCamel(rustNamedRange);

    // Simulated WASM path through the new normalizing transport.
    const wasmInner = makeStubTransport(() => rustNamedRange);
    const wasmWrapped = createCaseNormalizingTransport(wasmInner);
    const wasmResult = await wasmWrapped.call('compute_get_named_range', { docId: 'd' });

    expect(wasmResult).toEqual(napiResult);
  });
});
