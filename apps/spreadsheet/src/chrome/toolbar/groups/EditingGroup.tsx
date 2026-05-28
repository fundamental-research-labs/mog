/**
 * Editing Group
 *
 * Self-sufficient toolbar group for editing operations.
 * Contains: AutoSum, Fill, Clear, Sort & Filter, Find & Select dropdowns.
 *
 * Layout: 5 dropdown buttons in a row, each with its submenu.
 *
 * COLLAPSE SUPPORT (
 * - Passes EDITING_COLLAPSE_CONFIG to ToolbarGroup
 * - Priority 3 - Find/Select used frequently
 *
 * KEYTIPS:
 * - U = AutoSum (Excel uses Alt+H, U, S for Sum)
 * - FI = Fill dropdown
 * - E = Clear dropdown
 * - SO = Sort & Filter dropdown
 * - FD = Find & Select dropdown
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 *
 */

import React, { useCallback, useEffect } from 'react';

import { Tooltip } from '@mog/shell';
import { useFeatureGate, useUIStore } from '../../../internal-api';
import { EDITING_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import {
  RibbonDropdown,
  RibbonDropdownDivider,
  RibbonDropdownItem,
} from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  AutoSumIcon,
  ClearAllIcon,
  ClearCommentsIcon,
  ClearContentsIcon,
  ClearFormatsIcon,
  FillDownIcon,
  FillLeftIcon,
  FillRightIcon,
  FillSeriesIcon,
  FillUpIcon,
  FilterIcon,
  FindAndReplaceIcon,
  GoToIcon,
  SortAscIcon,
  SortDescIcon,
} from '../primitives/ToolbarIcons';

// =============================================================================
// Component
// =============================================================================

/**
 * Editing toolbar group - self-sufficient, no props required.
 *
 * Layout matches Excel (two-column vertical stack):
 * - Left column: AutoSum, Fill, Clear
 * - Right column: Sort & Filter, Find & Select
 *
 * Each dropdown shows icon + text label + arrow, consistent with CellsGroup pattern.
 *
 * All state and actions come from useEditingActions hook.
 * Memoized to prevent re-renders when parent re-renders.
 */
export const EditingGroup = React.memo(function EditingGroup() {
  const isEnabled = useFeatureGate('groups', 'editing');

  // ===========================================================================
  // Dispatch hook
  // ===========================================================================

  const dispatchAction = useDispatch();

  // ===========================================================================
  // Local State (dropdown open states)
  //
  // lifted into the ribbonDropdowns slice so the keytip chords
  // (Alt+H,U / Alt+H,F,I / Alt+H,E / Alt+H,S,O / Alt+H,F,D) can open
  // these via OPEN_RIBBON_DROPDOWN.
  // ===========================================================================

  const autoSumDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.autosum'] ?? false);
  const fillDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.fill'] ?? false);
  const clearDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.clear'] ?? false);
  const sortFilterDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.sort-filter'] ?? false);
  const findSelectDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.find-select'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const setAutoSumDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.autosum') : closeRibbonDropdown('home.autosum'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setFillDropdownOpen = useCallback(
    (open: boolean) => (open ? openRibbonDropdown('home.fill') : closeRibbonDropdown('home.fill')),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setClearDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.clear') : closeRibbonDropdown('home.clear'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setSortFilterDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.sort-filter') : closeRibbonDropdown('home.sort-filter'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setFindSelectDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.find-select') : closeRibbonDropdown('home.find-select'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-home-groups.ts`.)
  // ===========================================================================

  useEffect(() => {
    keyTipRegistry.register({ key: 'U', tabId: 'home', elementId: 'editing-autosum' });
    keyTipRegistry.register({ key: 'FI', tabId: 'home', elementId: 'editing-fill' });
    keyTipRegistry.register({ key: 'E', tabId: 'home', elementId: 'editing-clear' });
    keyTipRegistry.register({ key: 'SO', tabId: 'home', elementId: 'editing-sort-filter' });
    keyTipRegistry.register({ key: 'FD', tabId: 'home', elementId: 'editing-find-select' });

    return () => {
      keyTipRegistry.unregister('U', 'home');
      keyTipRegistry.unregister('FI', 'home');
      keyTipRegistry.unregister('E', 'home');
      keyTipRegistry.unregister('SO', 'home');
      keyTipRegistry.unregister('FD', 'home');
    };
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  if (!isEnabled) return null;

  return (
    <ToolbarGroup
      label="Editing"
      isLast
      collapseConfig={EDITING_COLLAPSE_CONFIG}
      dropdownIcon={<FindAndReplaceIcon />}
    >
      {/* Two columns of vertical stacks - matches Excel's Editing group layout */}
      <div className="flex gap-[var(--ribbon-group-items-gap)]">
        {/* Left column: AutoSum, Fill, Clear */}
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          {/* AutoSum Dropdown */}
          <RibbonDropdown
            open={autoSumDropdownOpen}
            onOpenChange={setAutoSumDropdownOpen}
            menuTestId="ribbon-dropdown-menu-autosum"
            trigger={
              <Tooltip
                title="AutoSum"
                shortcut="Alt+="
                description="Quickly insert common functions"
              >
                <RibbonButton
                  layout="horizontal"
                  height="third"
                  data-testid="ribbon-dropdown-autosum"
                  icon={<AutoSumIcon />}
                  label="AutoSum"
                  hasDropdown
                  isOpen={autoSumDropdownOpen}
                  aria-label="AutoSum"
                />
              </Tooltip>
            }
            width="auto"
            menuLabel="AutoSum functions"
          >
            <RibbonDropdownItem
              dataValue="sum"
              onClick={() => dispatchAction('AUTO_SUM')}
              shortcut="Alt+="
            >
              Sum
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="average"
              onClick={() => dispatchAction('INSERT_AUTO_FUNCTION', { functionName: 'AVERAGE' })}
            >
              Average
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="count"
              onClick={() => dispatchAction('INSERT_AUTO_FUNCTION', { functionName: 'COUNT' })}
            >
              Count Numbers
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="max"
              onClick={() => dispatchAction('INSERT_AUTO_FUNCTION', { functionName: 'MAX' })}
            >
              Max
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="min"
              onClick={() => dispatchAction('INSERT_AUTO_FUNCTION', { functionName: 'MIN' })}
            >
              Min
            </RibbonDropdownItem>
          </RibbonDropdown>

          {/* Fill Dropdown */}
          <RibbonDropdown
            open={fillDropdownOpen}
            onOpenChange={setFillDropdownOpen}
            menuTestId="ribbon-dropdown-menu-fill"
            trigger={
              <Tooltip title="Fill" description="Fill cells with values or series">
                <RibbonButton
                  layout="horizontal"
                  height="third"
                  data-testid="ribbon-dropdown-fill"
                  icon={<FillDownIcon />}
                  label="Fill"
                  hasDropdown
                  isOpen={fillDropdownOpen}
                  aria-label="Fill"
                />
              </Tooltip>
            }
            width="auto"
            menuLabel="Fill options"
          >
            <RibbonDropdownItem
              dataValue="down"
              icon={<FillDownIcon />}
              onClick={() => dispatchAction('FILL_DOWN')}
              shortcut="Ctrl+D"
            >
              Down
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="right"
              icon={<FillRightIcon />}
              onClick={() => dispatchAction('FILL_RIGHT')}
              shortcut="Ctrl+R"
            >
              Right
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="up"
              icon={<FillUpIcon />}
              onClick={() => dispatchAction('FILL_UP')}
            >
              Up
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="left"
              icon={<FillLeftIcon />}
              onClick={() => dispatchAction('FILL_LEFT')}
            >
              Left
            </RibbonDropdownItem>
            <RibbonDropdownDivider />
            <RibbonDropdownItem
              dataValue="series"
              icon={<FillSeriesIcon />}
              onClick={() => dispatchAction('OPEN_FILL_SERIES_DIALOG')}
            >
              Series...
            </RibbonDropdownItem>
          </RibbonDropdown>

          {/* Clear Dropdown */}
          <RibbonDropdown
            open={clearDropdownOpen}
            onOpenChange={setClearDropdownOpen}
            menuTestId="ribbon-dropdown-menu-clear"
            trigger={
              <Tooltip title="Clear" description="Clear cell contents, formats, or comments">
                <RibbonButton
                  layout="horizontal"
                  height="third"
                  data-testid="ribbon-dropdown-clear"
                  icon={<ClearAllIcon />}
                  label="Clear"
                  hasDropdown
                  isOpen={clearDropdownOpen}
                  aria-label="Clear"
                />
              </Tooltip>
            }
            width="sm"
            menuLabel="Clear options"
          >
            <RibbonDropdownItem
              dataValue="all"
              icon={<ClearAllIcon />}
              onClick={() => dispatchAction('CLEAR_ALL')}
            >
              Clear All
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="formats"
              icon={<ClearFormatsIcon />}
              onClick={() => dispatchAction('CLEAR_FORMATS')}
            >
              Clear Formats
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="contents"
              icon={<ClearContentsIcon />}
              onClick={() => dispatchAction('CLEAR_CONTENTS')}
              shortcut="Del"
            >
              Clear Contents
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="comments"
              icon={<ClearCommentsIcon />}
              onClick={() => dispatchAction('CLEAR_COMMENTS')}
            >
              Clear Comments
            </RibbonDropdownItem>
          </RibbonDropdown>
        </div>

        {/* Right column: Sort & Filter, Find & Select */}
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          {/* Sort & Filter Dropdown */}
          <RibbonDropdown
            open={sortFilterDropdownOpen}
            onOpenChange={setSortFilterDropdownOpen}
            menuTestId="ribbon-dropdown-menu-sort-filter"
            trigger={
              <Tooltip title="Sort & Filter" description="Sort data or apply filters">
                <RibbonButton
                  layout="horizontal"
                  height="half"
                  data-testid="ribbon-dropdown-sort-filter"
                  icon={<SortAscIcon />}
                  label="Sort & Filter"
                  hasDropdown
                  isOpen={sortFilterDropdownOpen}
                  aria-label="Sort & Filter"
                />
              </Tooltip>
            }
            width="sm"
            menuLabel="Sort and filter options"
          >
            <RibbonDropdownItem
              dataValue="sort-asc"
              icon={<SortAscIcon />}
              onClick={() => dispatchAction('SORT_ASCENDING')}
            >
              Sort A to Z
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="sort-desc"
              icon={<SortDescIcon />}
              onClick={() => dispatchAction('SORT_DESCENDING')}
            >
              Sort Z to A
            </RibbonDropdownItem>
            <RibbonDropdownDivider />
            <RibbonDropdownItem
              dataValue="filter"
              icon={<FilterIcon />}
              onClick={() => dispatchAction('TOGGLE_AUTO_FILTER')}
            >
              Filter
            </RibbonDropdownItem>
          </RibbonDropdown>

          {/* Find & Select Dropdown */}
          <RibbonDropdown
            open={findSelectDropdownOpen}
            onOpenChange={setFindSelectDropdownOpen}
            menuTestId="ribbon-dropdown-menu-find-select"
            trigger={
              <Tooltip title="Find & Select" shortcut="Ctrl+F" description="Find text, go to cells">
                <RibbonButton
                  layout="horizontal"
                  height="half"
                  data-testid="ribbon-dropdown-find-select"
                  icon={<FindAndReplaceIcon />}
                  label="Find & Select"
                  hasDropdown
                  isOpen={findSelectDropdownOpen}
                  aria-label="Find & Select"
                />
              </Tooltip>
            }
            width="sm"
            menuLabel="Find and select options"
          >
            <RibbonDropdownItem
              dataValue="find"
              icon={<FindAndReplaceIcon />}
              onClick={() => dispatchAction('OPEN_FIND_DIALOG')}
              shortcut="Ctrl+F"
            >
              Find...
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="replace"
              icon={<FindAndReplaceIcon />}
              onClick={() => dispatchAction('OPEN_FIND_REPLACE_DIALOG')}
              shortcut="Ctrl+H"
            >
              Replace...
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="goto"
              icon={<GoToIcon />}
              onClick={() => dispatchAction('OPEN_GO_TO_DIALOG')}
              shortcut="Ctrl+G"
            >
              Go To...
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="goto-special"
              icon={<GoToIcon />}
              onClick={() => dispatchAction('OPEN_GO_TO_SPECIAL_DIALOG')}
            >
              Go To Special...
            </RibbonDropdownItem>
          </RibbonDropdown>
        </div>
      </div>
    </ToolbarGroup>
  );
});
