import { useEffect, useMemo } from 'react';

import { useUIStore } from '../../../infra/context';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import type { GridScrollbarSettings } from '../layout/viewport-size';

export function usePivotFieldPanelViewportSettings<TSettings extends GridScrollbarSettings>({
  workbookSettings,
  coordinator,
  isReady,
}: {
  workbookSettings: TSettings;
  coordinator: SheetCoordinator;
  isReady: boolean;
}): TSettings & { reservedRightInset: number } {
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
      ...workbookSettings,
      reservedRightInset,
    }),
    [workbookSettings, reservedRightInset],
  );
}
