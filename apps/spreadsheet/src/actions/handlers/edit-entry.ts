import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { MutationResult } from '@mog-sdk/contracts/protection';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

export interface EditEntryActionRequest {
  sheetId: SheetId;
  cell: CellCoord;
  entryMode: 'F2' | 'doubleClick' | 'typing' | 'formulaBar';
  initialTextHint?: string;
  cursorPositionHint?: number;
  openDropdown?: boolean;
}

export function beginEditSessionFromAction(
  deps: ActionDependencies,
  request: EditEntryActionRequest,
): Promise<MutationResult> {
  const coordinator = deps.coordinator as
    | {
        grid?: {
          beginEditSession?: (request: EditEntryActionRequest) => Promise<MutationResult>;
        };
      }
    | undefined;
  if (!coordinator?.grid?.beginEditSession) {
    throw new Error('Grid edit-entry service is not available');
  }
  return coordinator.grid.beginEditSession(request);
}
