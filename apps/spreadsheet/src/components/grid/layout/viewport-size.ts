import { SCROLL_BAR_WIDTH } from '@mog-sdk/contracts/rendering';

export interface GridViewportLayoutSettings {
  showHorizontalScrollbar: boolean;
  showVerticalScrollbar: boolean;
  reservedRightInset: number;
}

export function getGridViewportSize(
  width: number,
  height: number,
  settings: GridViewportLayoutSettings,
): { width: number; height: number } {
  const inset = getGridViewportInset(settings);

  return {
    width: Math.max(0, width - inset.right),
    height: Math.max(0, height - inset.bottom),
  };
}

export function getGridViewportInset(settings: GridViewportLayoutSettings): {
  right: number;
  bottom: number;
} {
  const reservedRightInset = Math.max(0, settings.reservedRightInset ?? 0);

  return {
    right: (settings.showVerticalScrollbar ? SCROLL_BAR_WIDTH : 0) + reservedRightInset,
    bottom: settings.showHorizontalScrollbar ? SCROLL_BAR_WIDTH : 0,
  };
}
