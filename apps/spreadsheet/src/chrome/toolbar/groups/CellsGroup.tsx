/**
 * Cells Group
 *
 * Self-sufficient toolbar group for cell structure operations.
 * Includes Insert, Delete, and Format dropdown menus for managing
 * cells, rows, columns, and sheets.
 *
 * COLLAPSE SUPPORT (
 * - Passes CELLS_COLLAPSE_CONFIG to ToolbarGroup
 * - Priority 4 - can be accessed via dropdown (lower priority)
 *
 * KEYTIPS:
 * - I = Insert dropdown
 * - D = Delete dropdown
 * - O = Format dropdown
 *
 */

import React, { useCallback, useEffect } from 'react';
import { useSelector } from '@xstate/react';
import {
  dispatch,
  useActionDependencies,
  useActiveSheetId,
  useCoordinator,
  useFeatureGate,
  useUIStore,
} from '../../../internal-api';

import { Tooltip } from '@mog/shell';
import type { ClipboardState } from '@mog-sdk/contracts/actors';
import { CELLS_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { clipboardSelectors } from '../../../selectors';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useSheetProtectionPermissions } from '../../../hooks/structure/use-sheet-protection';
import { useWorkbookStructureProtection } from '../../../hooks/structure/use-workbook-protection';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import {
  RibbonDropdown,
  RibbonDropdownDivider,
  RibbonDropdownHeader,
  RibbonDropdownItem,
} from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  ColumnWidthIcon,
  DeleteCellsIcon,
  DeleteColumnIcon,
  DeleteRowIcon,
  DeleteSheetIcon,
  FormatCellsIcon,
  HideColumnIcon,
  HideRowIcon,
  InsertCellsIcon,
  InsertColumnIcon,
  InsertRowIcon,
  InsertSheetIcon,
  RowHeightIcon,
} from '../primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';

// =============================================================================
// Component
// =============================================================================

/**
 * Cells toolbar group - self-sufficient, no props required.
 *
 * Features:
 * - Insert dropdown: cells, rows, columns, sheets
 * - Delete dropdown: cells, rows, columns, sheets
 * - Format dropdown: row height, column width, visibility
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const CellsGroup = React.memo(function CellsGroup() {
  const isEnabled = useFeatureGate('groups', 'cells');

  // ===========================================================================
  // Action Dependencies for Dialog Launcher + dispatch hook
  // ===========================================================================

  const deps = useActionDependencies();
  const dispatchAction = useDispatch();
  const coordinator = useCoordinator();
  const activeSheetId = useActiveSheetId();
  const sheetPermissions = useSheetProtectionPermissions(activeSheetId);
  const workbookStructureLocked = useWorkbookStructureProtection();
  const hasCutCells = useSelector(coordinator.grid.access.actors.clipboard, (state) => {
    const clipboardState = state as ClipboardState;
    return (
      clipboardSelectors.hasCut(clipboardState) &&
      clipboardSelectors.cutSource(clipboardState) !== null
    );
  });

  // ===========================================================================
  // Local State (dropdown visibility)
  //
  // lifted into the ribbonDropdowns slice so the keytip chords (Alt+H,I
  // / Alt+H,D / Alt+H,O) can open these via OPEN_RIBBON_DROPDOWN.
  // ===========================================================================

  const insertDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.insert'] ?? false);
  const deleteDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.delete'] ?? false);
  const formatDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.format'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const setInsertDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.insert') : closeRibbonDropdown('home.insert'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setDeleteDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.delete') : closeRibbonDropdown('home.delete'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setFormatDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.format') : closeRibbonDropdown('home.format'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-home-groups.ts`.)
  // ===========================================================================

  useEffect(() => {
    keyTipRegistry.register({ key: 'I', tabId: 'home', elementId: 'cells-insert' });
    keyTipRegistry.register({ key: 'D', tabId: 'home', elementId: 'cells-delete' });
    keyTipRegistry.register({ key: 'O', tabId: 'home', elementId: 'cells-format' });

    return () => {
      keyTipRegistry.unregister('I', 'home');
      keyTipRegistry.unregister('D', 'home');
      keyTipRegistry.unregister('O', 'home');
    };
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  if (!isEnabled) return null;

  return (
    <ToolbarGroup
      label="Cells"
      collapseConfig={CELLS_COLLAPSE_CONFIG}
      dropdownIcon={<InsertCellsIcon />}
      onDialogLaunch={() => dispatch('OPEN_FORMAT_CELLS_DIALOG', deps)}
      dialogLaunchTitle="Format Cells"
    >
      {/* Vertical stack of three dropdown rows - matches Excel's Cells group layout */}
      <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
        {/* Insert Row - Split button: main area inserts immediately, arrow opens dropdown */}
        <RibbonVisibilityItem item="insert">
          <RibbonDropdown
            open={insertDropdownOpen}
            onOpenChange={setInsertDropdownOpen}
            menuTestId="ribbon-dropdown-menu-insert"
            trigger={
              <Tooltip title="Insert" description="Insert cells, rows, columns, or sheets">
                {/* TODO retire ribbon-insert-button after specs migrate to
 ribbon-dropdown-insert. Active consumers:
 insert-cells and form-control-styling coverage. The
 contract-aligned testid `ribbon-dropdown-insert` lives
 on the arrow button below. */}
                <div className="flex items-center" data-testid="ribbon-insert-button">
                  {/* Main click area: insert cells immediately (shift down) */}
                  <button
                    type="button"
                    disabled={!sheetPermissions.insertRows}
                    className={`flex items-center gap-1 px-1.5 h-[var(--ribbon-button-height-third)] rounded-l select-none bg-transparent text-ss-text-secondary hover:bg-ss-surface-hover active:bg-ss-surface-active disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed disabled:pointer-events-none ${
                      sheetPermissions.insertRows ? 'cursor-pointer' : 'cursor-not-allowed'
                    }`}
                    aria-label="Insert"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasCutCells) {
                        setTimeout(() => dispatchAction('INSERT_CUT_CELLS_SHIFT_DOWN'), 0);
                      } else {
                        dispatchAction('INSERT_CELLS_SHIFT_DOWN');
                      }
                    }}
                  >
                    <span className="flex items-center justify-center w-4 h-4">
                      <InsertCellsIcon />
                    </span>
                    <span className="text-ribbon-compact leading-tight whitespace-nowrap">
                      Insert
                    </span>
                  </button>
                  {/* Arrow area: opens dropdown menu (click bubbles to PopoverTrigger) */}
                  <button
                    type="button"
                    data-testid="ribbon-dropdown-insert"
                    className="flex items-center justify-center h-[var(--ribbon-button-height-third)] px-0.5 rounded-r cursor-pointer select-none bg-transparent text-ss-text-secondary hover:bg-ss-surface-hover active:bg-ss-surface-active"
                    aria-label="Insert options"
                    aria-expanded={insertDropdownOpen}
                    aria-haspopup="menu"
                  >
                    <svg width="8" height="4" viewBox="0 0 8 4" fill="currentColor">
                      <path d="M0 0l4 4 4-4z" />
                    </svg>
                  </button>
                </div>
              </Tooltip>
            }
            width="sm"
            menuLabel="Insert options"
          >
            <RibbonDropdownItem
              dataValue={hasCutCells ? 'insert-cut-cells' : 'insert-cells'}
              icon={<InsertCellsIcon />}
              onClick={() => {
                if (hasCutCells) {
                  setInsertDropdownOpen(false);
                  queueMicrotask(() => dispatchAction('OPEN_INSERT_CELLS_DIALOG'));
                } else {
                  dispatchAction('OPEN_INSERT_CELLS_DIALOG');
                }
              }}
            >
              {hasCutCells ? 'Insert Cut Cells' : 'Insert Cells...'}
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="insert-rows"
              icon={<InsertRowIcon />}
              onClick={() => dispatchAction('INSERT_ROW_ABOVE')}
              disabled={!sheetPermissions.insertRows}
            >
              Insert Sheet Rows
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="insert-columns"
              icon={<InsertColumnIcon />}
              onClick={() => dispatchAction('INSERT_COLUMN_LEFT')}
              disabled={!sheetPermissions.insertColumns}
            >
              Insert Sheet Columns
            </RibbonDropdownItem>
            <RibbonDropdownDivider />
            <RibbonDropdownItem
              dataValue="insert-sheet"
              icon={<InsertSheetIcon />}
              onClick={() => dispatchAction('INSERT_SHEET')}
              disabled={workbookStructureLocked}
            >
              Insert Sheet
            </RibbonDropdownItem>
          </RibbonDropdown>
        </RibbonVisibilityItem>

        {/* Delete Row */}
        <RibbonDropdown
          open={deleteDropdownOpen}
          onOpenChange={setDeleteDropdownOpen}
          menuTestId="ribbon-dropdown-menu-delete"
          trigger={
            <Tooltip title="Delete" description="Delete cells, rows, columns, or sheets">
              <RibbonButton
                layout="horizontal"
                height="third"
                data-testid="ribbon-dropdown-delete"
                icon={<DeleteCellsIcon />}
                label="Delete"
                hasDropdown
                isOpen={deleteDropdownOpen}
                aria-label="Delete"
              />
            </Tooltip>
          }
          width="sm"
          menuLabel="Delete options"
        >
          <RibbonDropdownItem
            dataValue="delete-cells"
            icon={<DeleteCellsIcon />}
            onClick={() => dispatchAction('OPEN_DELETE_CELLS_DIALOG')}
          >
            Delete Cells...
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="delete-rows"
            icon={<DeleteRowIcon />}
            onClick={() => dispatchAction('DELETE_ROWS')}
            disabled={!sheetPermissions.deleteRows}
          >
            Delete Sheet Rows
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="delete-columns"
            icon={<DeleteColumnIcon />}
            onClick={() => dispatchAction('DELETE_COLUMNS')}
            disabled={!sheetPermissions.deleteColumns}
          >
            Delete Sheet Columns
          </RibbonDropdownItem>
          <RibbonDropdownDivider />
          <RibbonDropdownItem
            dataValue="delete-sheet"
            icon={<DeleteSheetIcon />}
            onClick={() => dispatchAction('DELETE_SHEET')}
            disabled={workbookStructureLocked}
          >
            Delete Sheet
          </RibbonDropdownItem>
        </RibbonDropdown>

        {/* Format Row */}
        <RibbonDropdown
          open={formatDropdownOpen}
          onOpenChange={setFormatDropdownOpen}
          menuTestId="ribbon-dropdown-menu-format"
          trigger={
            <Tooltip title="Format" description="Format row height, column width, visibility">
              <RibbonButton
                layout="horizontal"
                height="third"
                data-testid="ribbon-dropdown-format"
                icon={<FormatCellsIcon />}
                label="Format"
                hasDropdown
                isOpen={formatDropdownOpen}
                aria-label="Format"
              />
            </Tooltip>
          }
          width="md"
          menuLabel="Format options"
        >
          {/* Row Height Section */}
          <RibbonDropdownHeader>Row Height</RibbonDropdownHeader>
          <RibbonDropdownItem
            dataValue="row-height"
            icon={<RowHeightIcon />}
            onClick={() => dispatchAction('OPEN_ROW_HEIGHT_DIALOG')}
            disabled={!sheetPermissions.formatRows}
          >
            Row Height...
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="autofit-row-height"
            icon={<RowHeightIcon />}
            onClick={() => dispatchAction('AUTO_FIT_ROW_HEIGHT')}
            disabled={!sheetPermissions.formatRows}
          >
            AutoFit Row Height
          </RibbonDropdownItem>

          {/* Column Width Section */}
          <RibbonDropdownDivider />
          <RibbonDropdownHeader>Column Width</RibbonDropdownHeader>
          <RibbonDropdownItem
            dataValue="column-width"
            icon={<ColumnWidthIcon />}
            onClick={() => dispatchAction('OPEN_COLUMN_WIDTH_DIALOG')}
            disabled={!sheetPermissions.formatColumns}
          >
            Column Width...
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="autofit-column-width"
            icon={<ColumnWidthIcon />}
            onClick={() => dispatchAction('AUTO_FIT_COLUMN_WIDTH')}
            disabled={!sheetPermissions.formatColumns}
          >
            AutoFit Column Width
          </RibbonDropdownItem>

          {/* Visibility Section */}
          <RibbonDropdownDivider />
          <RibbonDropdownHeader>Visibility</RibbonDropdownHeader>
          <RibbonDropdownItem
            dataValue="hide-rows"
            icon={<HideRowIcon />}
            onClick={() => dispatchAction('HIDE_ROW')}
            disabled={!sheetPermissions.formatRows}
          >
            Hide Rows
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="unhide-rows"
            icon={<HideRowIcon />}
            onClick={() => dispatchAction('UNHIDE_ROW')}
            disabled={!sheetPermissions.formatRows}
          >
            Unhide Rows
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="hide-columns"
            icon={<HideColumnIcon />}
            onClick={() => dispatchAction('HIDE_COLUMN')}
            disabled={!sheetPermissions.formatColumns}
          >
            Hide Columns
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="unhide-columns"
            icon={<HideColumnIcon />}
            onClick={() => dispatchAction('UNHIDE_COLUMN')}
            disabled={!sheetPermissions.formatColumns}
          >
            Unhide Columns
          </RibbonDropdownItem>
        </RibbonDropdown>
      </div>
    </ToolbarGroup>
  );
});
