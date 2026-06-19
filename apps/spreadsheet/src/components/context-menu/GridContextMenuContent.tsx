import { useEffect, useState } from 'react';

import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';
import { findPivotContextAtCell } from '../../pivot/pivot-view-records';
import { PivotContextMenu } from '../pivot/PivotContextMenu';
import { CellContextMenu } from './CellContextMenu';
import { ObjectContextMenu } from './ObjectContextMenu';

export function GridContextMenuContent() {
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const contextMenuState = useUIStore((s) => s.contextMenu);
  const objectContextMenuIsOpen = useUIStore((s) => s.objectContextMenu.isOpen);
  const closeContextMenu = useUIStore((s) => s.closeContextMenu);
  const setContextMenuPivotContext = useUIStore((s) => s.setContextMenuPivotContext);
  const [pendingPivotResolutionInstanceId, setPendingPivotResolutionInstanceId] = useState<
    number | null
  >(null);

  useEffect(() => {
    if (
      !contextMenuState.isOpen ||
      contextMenuState.targetRow == null ||
      contextMenuState.targetCol == null ||
      (contextMenuState.target !== 'cell' && contextMenuState.target !== 'selection')
    ) {
      setPendingPivotResolutionInstanceId(null);
      return;
    }

    let cancelled = false;
    const { instanceId, targetRow, targetCol } = contextMenuState;
    setPendingPivotResolutionInstanceId(instanceId);
    void (async () => {
      const pivotContext = await findPivotContextAtCell(wb, activeSheetId, targetRow, targetCol);
      if (!cancelled && pivotContext) {
        setContextMenuPivotContext(pivotContext);
      }
      if (!cancelled) {
        setPendingPivotResolutionInstanceId((current) => (current === instanceId ? null : current));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSheetId,
    contextMenuState.isOpen,
    contextMenuState.instanceId,
    contextMenuState.target,
    contextMenuState.targetCol,
    contextMenuState.targetRow,
    setContextMenuPivotContext,
    wb,
  ]);

  if (objectContextMenuIsOpen) {
    return <ObjectContextMenu />;
  }

  if (contextMenuState.isOpen && contextMenuState.pivotId) {
    return (
      <PivotContextMenu
        target={contextMenuState.target}
        pivotId={contextMenuState.pivotId}
        headerKey={contextMenuState.pivotHeaderKey}
        fieldId={contextMenuState.pivotFieldId}
        placementId={contextMenuState.pivotPlacementId}
        onClose={closeContextMenu}
      />
    );
  }

  if (
    contextMenuState.isOpen &&
    contextMenuState.targetRow != null &&
    contextMenuState.targetCol != null &&
    pendingPivotResolutionInstanceId === contextMenuState.instanceId
  ) {
    return null;
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
