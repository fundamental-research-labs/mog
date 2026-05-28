/**
 * SheetOptionsGroup Component
 *
 * Self-sufficient Sheet Options group for the Page Layout ribbon.
 * Contains: Gridlines (View/Print), Headings (View/Print)
 *
 * Page Layout dispatch — dispatch compliance.
 *
 * Architecture:
 * - Toggles route through `dispatch()` (4 dedicated ActionTypes:
 * `TOGGLE_VIEW_GRIDLINES`, `TOGGLE_VIEW_HEADINGS`,
 * `TOGGLE_PRINT_GRIDLINES`, `TOGGLE_PRINT_HEADINGS`).
 * - Read state for `checked` rendering comes from focused read-only hooks
 * (`useSheetViewOptions` for the view side, `usePrintSettings` for
 * the print side).
 */

import { Checkbox } from '@mog/shell';
import { SHEET_OPTIONS_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import {
  useActiveSheetId,
  useDispatch,
  usePrintSettings,
  useSheetViewOptions,
} from '../../../internal-api';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { GridlinesIcon, HeadingsIcon } from '../primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';

// =============================================================================
// Component
// =============================================================================

/**
 * SheetOptionsGroup - Self-sufficient sheet options group.
 *
 * Shows View and Print checkboxes for Gridlines and Headings. Each
 * checkbox dispatches a toggle action; the displayed `checked` state
 * comes directly from the corresponding read-only state hook.
 */
export function SheetOptionsGroup() {
  // ===========================================================================
  // Dispatch + Read-only state
  // ===========================================================================

  const dispatch = useDispatch();
  const activeSheetId = useActiveSheetId();
  const { viewOptions } = useSheetViewOptions(activeSheetId);
  const { settings: printSettings } = usePrintSettings(activeSheetId);

  const showViewGridlines = viewOptions.showGridlines;
  // Combined-row/col semantics: matches the handler's TOGGLE_VIEW_HEADINGS
  // logic (treat as one boolean — show both or hide both).
  const showViewHeadings = viewOptions.showRowHeaders && viewOptions.showColumnHeaders;
  const showPrintGridlines = printSettings.gridlines;
  const showPrintHeadings = printSettings.headings;

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <ToolbarGroup
      label="Sheet Options"
      isLast
      collapseConfig={SHEET_OPTIONS_COLLAPSE_CONFIG}
      dropdownIcon={<GridlinesIcon />}
    >
      <div className="flex gap-4 px-2 py-1">
        {/* Gridlines column */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1 mb-0.5">
            <GridlinesIcon />
            <span className="text-ribbon text-ss-text-tertiary font-medium">Gridlines</span>
          </div>
          <RibbonVisibilityItem item="gridlinesView">
            <label className="flex items-center gap-1 text-ribbon text-ss-text-secondary cursor-pointer">
              <Checkbox
                checked={showViewGridlines}
                onChange={() => dispatch('TOGGLE_VIEW_GRIDLINES')}
                className="m-0"
              />
              <span>View</span>
            </label>
          </RibbonVisibilityItem>
          <RibbonVisibilityItem item="gridlinesPrint">
            <label className="flex items-center gap-1 text-ribbon text-ss-text-secondary cursor-pointer">
              <Checkbox
                checked={showPrintGridlines}
                onChange={() => dispatch('TOGGLE_PRINT_GRIDLINES')}
                className="m-0"
              />
              <span>Print</span>
            </label>
          </RibbonVisibilityItem>
        </div>

        {/* Headings column */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1 mb-0.5">
            <HeadingsIcon />
            <span className="text-ribbon text-ss-text-tertiary font-medium">Headings</span>
          </div>
          <RibbonVisibilityItem item="headingsView">
            <label className="flex items-center gap-1 text-ribbon text-ss-text-secondary cursor-pointer">
              <Checkbox
                checked={showViewHeadings}
                onChange={() => dispatch('TOGGLE_VIEW_HEADINGS')}
                className="m-0"
              />
              <span>View</span>
            </label>
          </RibbonVisibilityItem>
          <RibbonVisibilityItem item="headingsPrint">
            <label className="flex items-center gap-1 text-ribbon text-ss-text-secondary cursor-pointer">
              <Checkbox
                checked={showPrintHeadings}
                onChange={() => dispatch('TOGGLE_PRINT_HEADINGS')}
                className="m-0"
              />
              <span>Print</span>
            </label>
          </RibbonVisibilityItem>
        </div>
      </div>
    </ToolbarGroup>
  );
}
