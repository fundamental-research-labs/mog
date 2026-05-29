import { useEffect, useState } from 'react';

import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';
import { PivotContextMenu } from '../pivot/PivotContextMenu';
import { CellContextMenu } from './CellContextMenu';
import { ObjectContextMenu } from './ObjectContextMenu';

export function GridContextMenuContent() {
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const contextMenuState = useUIStore((s) => s.contextMenu);
  const objectContextMenuIsOpen = useUIStore((s) => s.objectContextMenu.isOpen);
  const closeContextMenu = useUIStore((s) => s.closeContextMenu);
  const [pivotId, setPivotId] = useState<string | null>(null);

  useEffect(() => {
    if (
      !contextMenuState.isOpen ||
      contextMenuState.targetRow == null ||
      contextMenuState.targetCol == null ||
      (contextMenuState.target !== 'cell' && contextMenuState.target !== 'selection')
    ) {
      setPivotId(null);
      return;
    }

    let cancelled = false;
    const { targetRow, targetCol } = contextMenuState;
    void (async () => {
      try {
        const worksheet = wb.getSheetById(activeSheetId);
        const pivots = await wb.pivot.getAllPivots(activeSheetId);
        for (const pivot of pivots) {
          const range = await worksheet.pivots.getRange(pivot.name).catch(() => null);
          if (
            range &&
            targetRow >= range.startRow &&
            targetRow <= range.endRow &&
            targetCol >= range.startCol &&
            targetCol <= range.endCol
          ) {
            if (!cancelled) setPivotId(pivot.id);
            return;
          }
        }
      } catch {
        // Use the ordinary cell context menu when pivot lookup is unavailable.
      }
      if (!cancelled) setPivotId(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSheetId,
    contextMenuState.isOpen,
    contextMenuState.target,
    contextMenuState.targetCol,
    contextMenuState.targetRow,
    wb,
  ]);

  if (objectContextMenuIsOpen) {
    return <ObjectContextMenu />;
  }

  if (contextMenuState.isOpen && pivotId) {
    return <PivotContextMenu target="pivot" pivotId={pivotId} onClose={closeContextMenu} />;
  }

  if (contextMenuState.isOpen) {
    return (
      <CellContextMenu
        target={contextMenuState.target}
        targetRow={contextMenuState.targetRow}
        targetCol={contextMenuState.targetCol}
        onClose={closeContextMenu}
      />
    );
  }

  return null;
}
