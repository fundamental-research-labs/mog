import { SCROLL_BAR_WIDTH } from '@mog-sdk/contracts/rendering';

export interface GridScrollbarSettings {
  showHorizontalScrollbar: boolean;
  showVerticalScrollbar: boolean;
  reservedRightInset?: number;
}

export function getGridViewportSize(
  width: number,
  height: number,
  settings: GridScrollbarSettings,
): { width: number; height: number } {
  const inset = getGridViewportInset(settings);

  return {
    width: Math.max(0, width - inset.right),
    height: Math.max(0, height - inset.bottom),
  };
}

export function getGridViewportInset(settings: GridScrollbarSettings): {
  right: number;
  bottom: number;
} {
  const reservedRightInset = Math.max(0, settings.reservedRightInset ?? 0);

  return {
    right: (settings.showVerticalScrollbar ? SCROLL_BAR_WIDTH : 0) + reservedRightInset,
    bottom: settings.showHorizontalScrollbar ? SCROLL_BAR_WIDTH : 0,
  };
}
