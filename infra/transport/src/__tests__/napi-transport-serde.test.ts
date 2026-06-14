import { createNapiTransport, DEFAULT_NAPI_SERDE_PARAMS } from '../napi-transport';
import type { NapiComputeEngine } from '../types';

describe('DEFAULT_NAPI_SERDE_PARAMS', () => {
  it('JSON-encodes workbook protection serde params', async () => {
    const calls: unknown[][] = [];
    const engine = {
      compute_protect_workbook: (...args: unknown[]) => {
        calls.push(args);
      },
      compute_unprotect_workbook: (...args: unknown[]) => {
        calls.push(args);
      },
    } as NapiComputeEngine;

    const transport = createNapiTransport(engine, DEFAULT_NAPI_SERDE_PARAMS);

    await transport.call('compute_protect_workbook', {
      docId: 'doc-1',
      passwordHash: 'DAA7',
      options: { structure: true },
    });
    await transport.call('compute_unprotect_workbook', {
      docId: 'doc-1',
      passwordHash: 'DAA7',
    });

    expect(calls).toEqual([
      [JSON.stringify('DAA7'), JSON.stringify({ structure: true })],
      [JSON.stringify('DAA7')],
    ]);
  });

  it('keeps addComment str params raw while JSON-encoding serde params', async () => {
    const calls: unknown[][] = [];
    const engine = {
      compute_add_comment: (...args: unknown[]) => {
        calls.push(args);
      },
    } as NapiComputeEngine;

    const transport = createNapiTransport(engine, DEFAULT_NAPI_SERDE_PARAMS);

    await transport.call('compute_add_comment', {
      docId: 'doc-1',
      sheetId: 'sheet-1',
      cellId: 'cell-1',
      text: 'hello',
      author: 'Ada',
      authorId: 'user-1',
      parentId: null,
      commentType: 'note',
    });

    expect(calls).toEqual([
      [
        JSON.stringify('sheet-1'),
        'cell-1',
        'hello',
        'Ada',
        JSON.stringify('user-1'),
        JSON.stringify(null),
        JSON.stringify('note'),
      ],
    ]);
  });

  it('JSON-encodes screenshot sheet and optional max dimensions', async () => {
    const calls: unknown[][] = [];
    const engine = {
      compute_capture_screenshot: (...args: unknown[]) => {
        calls.push(args);
        return new Uint8Array();
      },
    } as NapiComputeEngine;

    const transport = createNapiTransport(engine, DEFAULT_NAPI_SERDE_PARAMS);

    await transport.call('compute_capture_screenshot', {
      docId: 'doc-1',
      sheetId: 'sheet-1',
      startRow: 0,
      startCol: 1,
      endRow: 9,
      endCol: 5,
      dpr: 2,
      showHeaders: true,
      showGridlines: false,
      maxWidth: 640,
      maxHeight: null,
    });

    expect(calls).toEqual([
      [
        JSON.stringify('sheet-1'),
        0,
        1,
        9,
        5,
        2,
        true,
        false,
        JSON.stringify(640),
        JSON.stringify(null),
      ],
    ]);
  });

  it('JSON-encodes serde byte vectors as arrays for table dropdown visibility', async () => {
    const calls: unknown[][] = [];
    const addon = {
      tableBuildFilterDropdown: (...args: unknown[]) => {
        calls.push(args);
      },
      tableComposeBitmaps: (...args: unknown[]) => {
        calls.push(args);
      },
    };
    const transport = createNapiTransport(
      {} as NapiComputeEngine,
      DEFAULT_NAPI_SERDE_PARAMS,
      addon,
    );

    await transport.call('table_build_filter_dropdown', {
      columnData: ['A', null],
      currentFilter: null,
      rowVisibility: new Uint8Array([1, 0]),
    });
    await transport.call('table_compose_bitmaps', {
      bitmaps: [new Uint8Array([1, 0]), new Uint8Array([0, 1])],
    });

    expect(calls).toEqual([
      [JSON.stringify(['A', null]), JSON.stringify(null), JSON.stringify([1, 0])],
      [
        JSON.stringify([
          [1, 0],
          [0, 1],
        ]),
      ],
    ]);
  });
});
