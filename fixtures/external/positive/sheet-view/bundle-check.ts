/**
 * Browser bundle smoke for @mog-sdk/sheet-view.
 *
 * This is intentionally import-only: bundling should prove the published root
 * entry is self-contained without constructing a DOM-backed SheetView.
 */

import { createSheetView } from '@mog-sdk/sheet-view';
import type {
  SheetViewCallbacks,
  SheetViewMountOptions,
  SheetViewVisibleBounds,
} from '@mog-sdk/sheet-view';

export { createSheetView };
export type { SheetViewCallbacks, SheetViewMountOptions, SheetViewVisibleBounds };

const factory: typeof createSheetView = createSheetView;
void factory;
