import { useCallback, useEffect } from 'react';

import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import { useUIStore } from '../../../infra/context';
import { zoomLevelToScale, zoomScaleToLevel } from '../../../infra/utils/zoom-utils';

export function useSheetZoomState(wb: WorkbookInternal, activeSheetId: SheetId) {
  const uiZoomLevel = useUIStore((s) => s.zoomLevels[activeSheetId]);
  const setZoomLevel = useUIStore((s) => s.setZoomLevel);
  const persistedZoomLevel =
    zoomScaleToLevel(wb.mirror.getViewOptions(activeSheetId).zoomScale) ?? 1.0;
  const currentZoom = uiZoomLevel ?? persistedZoomLevel;

  const persistZoomLevel = useCallback(
    (sheetId: string, level: number) => {
      void wb
        .getSheetById(sheetId as SheetId)
        .settings.set('zoomScale', zoomLevelToScale(level))
        .catch((error) => {
          console.warn('[SpreadsheetGrid] Failed to persist sheet zoom:', error);
        });
    },
    [wb],
  );

  useEffect(() => {
    if (uiZoomLevel === undefined && persistedZoomLevel !== 1.0) {
      setZoomLevel(activeSheetId, persistedZoomLevel);
    }
  }, [activeSheetId, persistedZoomLevel, setZoomLevel, uiZoomLevel]);

  return { currentZoom, setZoomLevel, persistZoomLevel };
}
