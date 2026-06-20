import { useEffect, useMemo } from 'react';

import { useUIStore } from '../../../infra/context';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import type { GridViewportLayoutSettings } from '../layout/viewport-size';

export function usePivotAwareGridViewportLayout({
  showHorizontalScrollbar,
  showVerticalScrollbar,
  coordinator,
  isReady,
}: {
  showHorizontalScrollbar: boolean;
  showVerticalScrollbar: boolean;
  coordinator: SheetCoordinator;
  isReady: boolean;
}): GridViewportLayoutSettings {
  const editingPivotId = useUIStore((s) => s.pivot.editingPivotId);
  const pivotFieldPanelWidth = useUIStore((s) => s.pivot.fieldPanelWidth);
  const reservedRightInset = editingPivotId ? pivotFieldPanelWidth : 0;

  useEffect(() => {
    if (!isReady) return;
    coordinator.renderer.getSheetView()?.viewport.invalidateLayout();
    coordinator.renderer.invalidate('pivot-field-panel-inset');
  }, [coordinator, isReady, reservedRightInset]);

  return useMemo(
    () => ({
      showHorizontalScrollbar,
      showVerticalScrollbar,
      reservedRightInset,
    }),
    [showHorizontalScrollbar, showVerticalScrollbar, reservedRightInset],
  );
}
