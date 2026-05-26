/**
 * PageLayoutRibbon
 *
 * Page Layout tab content matching Excel 365 group order:
 * 1. Themes (ThemeGallery)
 * 2. Page Setup: Margins, Orientation, Size, Print Area, Breaks, Print Titles
 * 3. Scale to Fit: Width, Height, Scale
 * 4. Sheet Options: Gridlines (View/Print), Headings (View/Print)
 * 5. Arrange: Bring Forward/Back, Align, Group/Ungroup, Rotate
 *
 * ARCHITECTURE:
 * Follows the HomeRibbon pattern:
 * - No props - all state comes from hooks/context
 * - Composed of self-sufficient groups
 * - Each group dispatches via the Unified Action System (`useDispatch()`)
 * and reads state via small focused hooks (`usePrintArea`,
 * `usePrintSettings`, `usePageBreaks`, `useSheetViewOptions`).
 *
 */

import { ArrangeGroup } from '../groups/ArrangeGroup';
import { PageSetupGroup } from '../groups/PageSetupGroup';
import { ScaleToFitGroup } from '../groups/ScaleToFitGroup';
import { SheetOptionsGroup } from '../groups/SheetOptionsGroup';
import { ThemesGroup } from '../groups/ThemesGroup';

/**
 * Page Layout ribbon - composition of self-sufficient groups.
 *
 * Each group manages its own dropdown UI state and routes user actions
 * through `dispatch()`. Read-only state hooks back the displayed
 * `aria-pressed` / `checked` flags.
 */
export function PageLayoutRibbon() {
  return (
    <>
      <ThemesGroup />
      <PageSetupGroup />
      <ScaleToFitGroup />
      <SheetOptionsGroup />
      <ArrangeGroup />
    </>
  );
}
