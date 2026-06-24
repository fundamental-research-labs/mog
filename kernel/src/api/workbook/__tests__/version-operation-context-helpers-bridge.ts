import { jest } from '@jest/globals';

import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { BridgeTransport } from '@rust-bridge/client';

import { ComputeBridge } from '../../../bridges/compute/compute-bridge';
import type { MutationAdmissionDiagnostic } from '../../../bridges/compute/mutation-admission';
import { CREATED_AT_MS, DOCUMENT_ID } from './version-operation-context-helpers-constants';
import { mutationResult } from './version-operation-context-helpers-mutation-result';

function createTransport(): BridgeTransport & { call: jest.Mock } {
  return {
    call: jest.fn(async (command: string) => {
      switch (command) {
        case 'compute_batch_set_cells_by_position':
          return [new Uint8Array(), mutationResult()];
        case 'compute_create_data_table':
          return [
            new Uint8Array(),
            mutationResult({
              data: {
                regionId: 'sheet-1:0:0:1:1',
                tableRange: 'A1:B2',
                bodyRange: 'B2:B2',
                rowInputCell: null,
                colInputCell: 'C1',
                rowsComputed: 1,
                colsComputed: 1,
                cellCount: 1,
              },
            }),
          ];
        case 'compute_data_table':
          return {
            results: [[10]],
            cellCount: 1,
            cancelled: false,
          };
        case 'compute_get_all_column_schemas':
        case 'compute_get_range_schemas_for_sheet':
          return [];
        case 'compute_get_cell_id_at':
          return 'cell-id';
        case 'compute_create_sheet_with_default_col_width':
          return ['sheet-created', mutationResult()];
        case 'compute_copy_sheet':
          return ['sheet-copied', mutationResult()];
        case 'compute_rename_compute_sheet':
        case 'compute_delete_sheet':
        case 'compute_move_sheet':
          return [new Uint8Array(), mutationResult()];
        case 'compute_full_recalc':
          return mutationResult().recalc;
        case 'compute_begin_undo_group':
        case 'compute_end_undo_group':
          return undefined;
        default:
          throw new Error(`unexpected transport command: ${command}`);
      }
    }),
  } as unknown as BridgeTransport & { call: jest.Mock };
}

export function createBridgeFixture() {
  const capture = {
    recordPreMutation: jest.fn(async () => undefined),
    recordMutationResult: jest.fn(),
  };
  const diagnostics: MutationAdmissionDiagnostic[] = [];
  const ctx = {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
    services: {
      undo: {
        notifyForwardMutation: jest.fn(async () => undefined),
      },
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    clock: {
      now: jest.fn(() => CREATED_AT_MS),
    },
    workbookLinkScope: jest.fn(() => ({
      actor: 'user-1',
      requestingDocumentId: DOCUMENT_ID,
      requestingSessionId: 'session-1',
    })),
    awaitMaterialized: jest.fn(async () => undefined),
    mirror: {
      getSheetSettings: jest.fn(() => ({ isProtected: false })),
      getFrozenPanes: jest.fn(() => ({ rows: 0, cols: 0 })),
      getViewOptions: jest.fn(() => ({
        showGridlines: true,
        showRowHeaders: true,
        showColumnHeaders: true,
      })),
    },
    versioning: {
      mutationCapture: capture,
    },
    versioningAdmissionDiagnostics: {
      record: (diagnostic: MutationAdmissionDiagnostic) => diagnostics.push(diagnostic),
    },
  } as unknown as IKernelContext & {
    computeBridge: ComputeBridge;
    writeGate: { assertWritable: jest.Mock };
  };
  const transport = createTransport();
  const bridge = new ComputeBridge(ctx, DOCUMENT_ID, transport);
  (bridge as any).core._phase = 'STARTED';
  (bridge as any).core.engineCreated = true;
  ctx.computeBridge = bridge;

  bridge.canEditCell = jest.fn(async () => true) as any;
  bridge.isSheetProtected = jest.fn(async () => false) as any;
  bridge.getTableAtCell = jest.fn(async () => null) as any;
  bridge.getAllTablesInSheet = jest.fn(async () => []) as any;
  bridge.getActiveFilters = jest.fn(async () => []) as any;
  bridge.applyFilter = jest.fn(async () => undefined) as any;
  bridge.isWorkbookProtected = jest.fn(async () => false) as any;
  bridge.isSheetHidden = jest.fn(async () => false) as any;
  bridge.findCellsByFormula = jest.fn(async () => []) as any;

  return { bridge, capture, ctx, diagnostics, transport };
}
