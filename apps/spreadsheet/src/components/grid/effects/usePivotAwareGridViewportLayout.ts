import { useEffect, useMemo, type RefObject } from 'react';

import { useUIStore } from '../../../infra/context';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import type { GridViewportLayoutSettings } from '../layout/viewport-size';

export function usePivotAwareGridViewportLayout({
  showHorizontalScrollbar,
  showVerticalScrollbar,
  containerRef,
  resize,
  coordinator,
  isReady,
}: {
  showHorizontalScrollbar: boolean;
  showVerticalScrollbar: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  resize: (width: number, height: number) => void;
  coordinator: SheetCoordinator;
  isReady: boolean;
}): GridViewportLayoutSettings {
  const editingPivotId = useUIStore((s) => s.pivot.editingPivotId);
  const pivotFieldPanelWidth = useUIStore((s) => s.pivot.fieldPanelWidth);
  const reservedRightInset = editingPivotId ? pivotFieldPanelWidth : 0;

  useEffect(() => {
    if (!isReady) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      resize(rect.width, rect.height);
    }
    coordinator.renderer.getSheetView()?.viewport.invalidateLayout();
    coordinator.renderer.invalidate('pivot-field-panel-inset');
  }, [containerRef, coordinator, isReady, reservedRightInset, resize]);

  return useMemo(
    () => ({
      showHorizontalScrollbar,
      showVerticalScrollbar,
      reservedRightInset,
    }),
    [showHorizontalScrollbar, showVerticalScrollbar, reservedRightInset],
  );
}
