import { useEffect, useMemo } from 'react';

import { useUIStore } from '../../../infra/context';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import type {
  GridScrollbarVisibilitySettings,
  GridViewportLayoutSettings,
} from '../layout/viewport-size';

export function usePivotAwareGridViewportLayout({
  scrollbarVisibility,
  coordinator,
  isReady,
}: {
  scrollbarVisibility: GridScrollbarVisibilitySettings;
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
      showHorizontalScrollbar: scrollbarVisibility.showHorizontalScrollbar,
      showVerticalScrollbar: scrollbarVisibility.showVerticalScrollbar,
      reservedRightInset,
    }),
    [
      scrollbarVisibility.showHorizontalScrollbar,
      scrollbarVisibility.showVerticalScrollbar,
      reservedRightInset,
    ],
  );
}
