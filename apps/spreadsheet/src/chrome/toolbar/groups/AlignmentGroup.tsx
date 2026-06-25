/**
 * Alignment Group
 *
 * Self-sufficient toolbar group for alignment operations.
 * Includes horizontal/vertical alignment, word wrap, merge cells,
 * text orientation, and indent controls.
 *
 * Text formatting dispatch: every onClick routes through `useDispatch`
 * — the same hook form ArrangeGroup uses.
 *
 * COLLAPSE SUPPORT (
 * - Passes ALIGNMENT_COLLAPSE_CONFIG to ToolbarGroup
 * - Priority 2 - essential formatting
 *
 * KEYTIPS:
 * - AL = Align Left
 * - AC = Align Center
 * - AR = Align Right
 * - AT = Align Top
 * - AM = Align Middle
 * - AB = Align Bottom
 * - W = Word Wrap
 * - M = Merge & Center
 * - O = Orientation
 * - 5 = Decrease Indent
 * - 6 = Increase Indent
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 *
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useActiveSheetId, useFeatureGate, useUIStore, useWorkbook } from '../../../internal-api';

import { Tooltip } from '@mog/shell';
import { ALIGNMENT_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useSheetProtectionPermissions } from '../../../hooks/structure/use-sheet-protection';
import { getCenterAcrossSelectionAvailability } from '../../../actions/handlers/formatting/center-across-selection';
import { keyTipRegistry } from '../keytips';
import {
  AngleClockwiseIcon,
  AngleCounterclockwiseIcon,
  DecreaseIndentIcon,
  IncreaseIndentIcon,
  RotateTextDownIcon,
  RotateTextUpIcon,
  TextOrientationIcon,
  VerticalTextIcon,
} from '../primitives/HomeAlignmentIcons';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { SplitButton } from '../primitives/SplitButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { useRibbonVisibilityPathVisible } from '../visibility/RibbonVisibilityContext';
import {
  AlignBottomIcon,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignMiddleIcon,
  AlignRightIcon,
  AlignTopIcon,
  MergeAcrossIcon,
  MergeAndCenterIcon,
  MergeCellsIcon,
  UnmergeCellsIcon,
  WordWrapIcon,
} from '../primitives/ToolbarIcons';

// =============================================================================
// Types
// =============================================================================

type VerticalAlign = 'top' | 'middle' | 'bottom';

// =============================================================================
// Component
// =============================================================================

/**
 * Alignment toolbar group - self-sufficient, no props required.
 *
 * Features:
 * - Row 1: Horizontal alignment (left, center, right)
 * - Row 2: Vertical alignment (top, middle, bottom) + word wrap + merge dropdown
 * - Row 3: Text orientation dropdown + indent controls
 *
 * Memoized to prevent re-renders when parent re-renders.
 */
export const AlignmentGroup = React.memo(function AlignmentGroup() {
  const isEnabled = useFeatureGate('groups', 'alignment');

  // ===========================================================================
  // Dispatch (unified action system - hook form per ArrangeGroup convention)
  // ===========================================================================

  const dispatch = useDispatch();

  // ===========================================================================
  // Derived alignment state. Horizontal alignment binds to the raw engine
  // value so non-rendered values such as general/fill/centerContinuous leave
  // the three icon buttons unhighlighted, matching Excel's unset state.
  // ===========================================================================

  const rawHAlign = useUIStore((s) => s.activeCellFormat?.horizontalAlign ?? 'general');

  // CellFormat uses canonical tokens (top|middle|bottom|justify|distributed).
  // The button row UI is icon-labelled "Middle" (CSS naming), so we collapse the
  // unrenderable "justify"/"distributed" variants onto the middle icon for
  // active-state highlighting. Legacy raw `center` is treated as middle.
  const rawVAlign = useUIStore((s) => s.activeCellFormat?.verticalAlign ?? 'bottom');
  const verticalAlign: VerticalAlign =
    rawVAlign === 'top' ? 'top' : rawVAlign === 'bottom' ? 'bottom' : 'middle';

  const wordWrap = useUIStore((s) => s.activeCellFormat?.wrapText ?? false);
  const textRotation = useUIStore((s) => s.activeCellFormat?.textRotation ?? 0);
  const indent = useUIStore((s) => s.activeCellFormat?.indent ?? 0);

  // ===========================================================================
  // Merge state derivation — inlined from the deleted use-merge hook. Reads
  // toolbarRanges (idle-gated by the
  // coordinator so this only updates when selection settles) and viewport
  // merges for sync detection.
  //
  // PERFORMANCE: same toolbarRanges path as the deleted hook used; idle
  // gating prevents cascading re-renders during selection drag.
  // @see engine/src/state/coordinator/setup/toolbar-coordination-builder.ts
  // @see docs/spreadsheet/ARCHITECTURE-CHECKLIST.md §15 (Render Isolation)
  // ===========================================================================

  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ranges = useUIStore((s) => s.toolbarRanges);
  const canFormatCells = useSheetProtectionPermissions(activeSheetId).formatCells;

  const { canMerge, canUnmerge, isMerged } = useMemo(() => {
    if (!ranges || ranges.length === 0) {
      return { canMerge: false, canUnmerge: false, isMerged: false };
    }
    const r = ranges[0];
    const startRow = Math.min(r.startRow, r.endRow);
    const startCol = Math.min(r.startCol, r.endCol);
    const endRow = Math.max(r.startRow, r.endRow);
    const endCol = Math.max(r.startCol, r.endCol);

    const ws = wb.getSheetById(activeSheetId);
    const viewportMerges = ws.viewport.getMerges();
    const findMergeForCell = (row: number, col: number) =>
      viewportMerges.find(
        (m) => row >= m.start_row && row <= m.end_row && col >= m.start_col && col <= m.end_col,
      ) ?? null;

    const isSingleCell = startRow === endRow && startCol === endCol;
    if (isSingleCell) {
      const merge = findMergeForCell(startRow, startCol);
      return { canMerge: false, canUnmerge: merge !== null, isMerged: merge !== null };
    }

    const originMerge = findMergeForCell(startRow, startCol);
    const exactMerged =
      originMerge !== null &&
      originMerge.start_row === startRow &&
      originMerge.start_col === startCol &&
      originMerge.end_row === endRow &&
      originMerge.end_col === endCol;

    let overlapsMerge = false;
    for (const region of viewportMerges) {
      if (
        region.start_row <= endRow &&
        region.end_row >= startRow &&
        region.start_col <= endCol &&
        region.end_col >= startCol
      ) {
        overlapsMerge = true;
        break;
      }
    }

    return {
      canMerge: !exactMerged,
      canUnmerge: overlapsMerge,
      isMerged: exactMerged,
    };
  }, [wb, activeSheetId, ranges]);

  const centerAcrossAvailability = useMemo(() => {
    const shapeAvailability = getCenterAcrossSelectionAvailability(ranges ?? []);
    if (!shapeAvailability.enabled) return shapeAvailability;
    if (!canFormatCells) {
      return {
        enabled: false,
        reason: 'Formatting cells is disabled on this protected sheet' as const,
      };
    }
    return shapeAvailability;
  }, [ranges, canFormatCells]);

  // ===========================================================================
  // Local State (dropdown visibility)
  //
  // lifted into the ribbonDropdowns slice so the keytip chords (Alt+H,M
  // for merge, Alt+H,O for orientation) can open them via OPEN_RIBBON_DROPDOWN.
  // ===========================================================================

  const mergeDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.merge'] ?? false);
  const orientationDropdownOpen = useUIStore((s) => s.ribbonDropdowns['home.orientation'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const setMergeDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.merge') : closeRibbonDropdown('home.merge'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setOrientationDropdownOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('home.orientation') : closeRibbonDropdown('home.orientation'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-home-groups.ts`.)
  // ===========================================================================

  useEffect(() => {
    keyTipRegistry.register({ key: 'AL', tabId: 'home', elementId: 'align-left' });
    keyTipRegistry.register({ key: 'AC', tabId: 'home', elementId: 'align-center' });
    keyTipRegistry.register({ key: 'AR', tabId: 'home', elementId: 'align-right' });
    keyTipRegistry.register({ key: 'AT', tabId: 'home', elementId: 'align-top' });
    keyTipRegistry.register({ key: 'AM', tabId: 'home', elementId: 'align-middle' });
    keyTipRegistry.register({ key: 'AB', tabId: 'home', elementId: 'align-bottom' });
    keyTipRegistry.register({ key: 'W', tabId: 'home', elementId: 'word-wrap' });
    keyTipRegistry.register({ key: 'M', tabId: 'home', elementId: 'merge-center' });
    keyTipRegistry.register({ key: 'FQ', tabId: 'home', elementId: 'orientation' });
    keyTipRegistry.register({ key: '5', tabId: 'home', elementId: 'decrease-indent' });
    keyTipRegistry.register({ key: '6', tabId: 'home', elementId: 'increase-indent' });

    return () => {
      keyTipRegistry.unregister('AL', 'home');
      keyTipRegistry.unregister('AC', 'home');
      keyTipRegistry.unregister('AR', 'home');
      keyTipRegistry.unregister('AT', 'home');
      keyTipRegistry.unregister('AM', 'home');
      keyTipRegistry.unregister('AB', 'home');
      keyTipRegistry.unregister('W', 'home');
      keyTipRegistry.unregister('M', 'home');
      keyTipRegistry.unregister('FQ', 'home');
      keyTipRegistry.unregister('5', 'home');
      keyTipRegistry.unregister('6', 'home');
    };
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  const showAlignLeft = useRibbonVisibilityPathVisible(['home', 'alignment', 'alignLeft']);
  const showAlignCenter = useRibbonVisibilityPathVisible(['home', 'alignment', 'center']);
  const showAlignRight = useRibbonVisibilityPathVisible(['home', 'alignment', 'alignRight']);

  if (!isEnabled) return null;

  return (
    <ToolbarGroup
      label="Alignment"
      collapseConfig={ALIGNMENT_COLLAPSE_CONFIG}
      dropdownIcon={<AlignCenterIcon />}
    >
      <div className="flex h-full items-start gap-2">
        <div className="flex h-[calc(var(--ribbon-content-height)-4px)] flex-col justify-between">
          <div className="flex h-7 items-center gap-[var(--ribbon-button-inline-gap)]">
            {showAlignLeft && (
              <Tooltip title="Align Left">
                <RibbonButton
                  id="align-left"
                  layout="icon-only"
                  icon={<AlignLeftIcon />}
                  onClick={() => dispatch('SET_HORIZONTAL_ALIGN', { align: 'left' })}
                  isOpen={rawHAlign === 'left'}
                  disabled={!canFormatCells}
                  aria-label="Align left"
                  aria-pressed={rawHAlign === 'left'}
                />
              </Tooltip>
            )}
            {showAlignCenter && (
              <Tooltip title="Align Center">
                <RibbonButton
                  id="align-center"
                  layout="icon-only"
                  icon={<AlignCenterIcon />}
                  onClick={() => dispatch('SET_HORIZONTAL_ALIGN', { align: 'center' })}
                  isOpen={rawHAlign === 'center'}
                  disabled={!canFormatCells}
                  aria-label="Align center"
                  aria-pressed={rawHAlign === 'center'}
                />
              </Tooltip>
            )}
            {showAlignRight && (
              <Tooltip title="Align Right">
                <RibbonButton
                  id="align-right"
                  layout="icon-only"
                  icon={<AlignRightIcon />}
                  onClick={() => dispatch('SET_HORIZONTAL_ALIGN', { align: 'right' })}
                  isOpen={rawHAlign === 'right'}
                  disabled={!canFormatCells}
                  aria-label="Align right"
                  aria-pressed={rawHAlign === 'right'}
                />
              </Tooltip>
            )}
          </div>
          <div className="flex h-[var(--ribbon-button-height-third)] items-center gap-[var(--ribbon-button-inline-gap)]">
            <Tooltip title="Align Top">
              <RibbonButton
                id="align-top"
                layout="icon-only"
                icon={<AlignTopIcon />}
                onClick={() => dispatch('SET_VERTICAL_ALIGN', { align: 'top' })}
                isOpen={verticalAlign === 'top'}
                disabled={!canFormatCells}
                aria-label="Align top"
                aria-pressed={verticalAlign === 'top'}
              />
            </Tooltip>
            <Tooltip title="Align Middle">
              <RibbonButton
                id="align-middle"
                layout="icon-only"
                icon={<AlignMiddleIcon />}
                onClick={() => dispatch('SET_VERTICAL_ALIGN', { align: 'middle' })}
                isOpen={verticalAlign === 'middle'}
                disabled={!canFormatCells}
                aria-label="Align middle"
                aria-pressed={verticalAlign === 'middle'}
              />
            </Tooltip>
            <Tooltip title="Align Bottom">
              <RibbonButton
                id="align-bottom"
                layout="icon-only"
                icon={<AlignBottomIcon />}
                onClick={() => dispatch('SET_VERTICAL_ALIGN', { align: 'bottom' })}
                isOpen={verticalAlign === 'bottom'}
                disabled={!canFormatCells}
                aria-label="Align bottom"
                aria-pressed={verticalAlign === 'bottom'}
              />
            </Tooltip>
          </div>
        </div>

        <div className="w-px h-11 self-center bg-ss-surface-tertiary" />

        <div className="flex h-[calc(var(--ribbon-content-height)-4px)] flex-col justify-between">
          <div className="flex h-7 items-center gap-1.5">
            <Tooltip title="Word Wrap">
              <RibbonButton
                id="word-wrap"
                layout="icon-only"
                icon={<WordWrapIcon />}
                onClick={() => dispatch('TOGGLE_WRAP_TEXT')}
                isOpen={wordWrap}
                disabled={!canFormatCells}
                aria-label="Word wrap"
                aria-pressed={wordWrap}
              />
            </Tooltip>

            {/* Merge Cells split button: direct action plus menu options. */}
            <div className="relative inline-flex">
              <Tooltip title="Merge & Center" shortcut="Ctrl+Shift+M">
                <SplitButton
                  id="merge-center"
                  icon={<MergeCellsIcon />}
                  variant="small"
                  isOpen={isMerged || mergeDropdownOpen}
                  disabled={!canFormatCells || (!canMerge && !canUnmerge)}
                  visibilityKey="mergeCenter"
                  aria-label="Merge & Center"
                  onMainClick={() => {
                    setMergeDropdownOpen(false);
                    dispatch('MERGE_AND_CENTER');
                  }}
                  onDropdownClick={() => setMergeDropdownOpen(!mergeDropdownOpen)}
                  dropdownTestId="merge-dropdown-trigger"
                />
              </Tooltip>
              <RibbonDropdownPanel
                open={mergeDropdownOpen}
                onClose={() => setMergeDropdownOpen(false)}
              >
                <div data-testid="ribbon-dropdown-menu-merge" className="py-1 min-w-[180px]">
                  {/* Merge & Center */}
                  <button
                    type="button"
                    data-value="merge-and-center"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
                  ${canFormatCells && canMerge ? 'hover:bg-ss-surface-hover text-text-ss-primary' : 'text-ss-text-disabled cursor-not-allowed'}
 `}
                    onClick={() => {
                      if (canFormatCells && canMerge) {
                        dispatch('MERGE_AND_CENTER');
                        setMergeDropdownOpen(false);
                      }
                    }}
                    disabled={!canFormatCells || !canMerge}
                  >
                    <MergeAndCenterIcon />
                    <span>Merge & Center</span>
                  </button>
                  {/* Merge Across */}
                  <button
                    type="button"
                    data-value="merge-across"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
                  ${canFormatCells && canMerge ? 'hover:bg-ss-surface-hover text-text-ss-primary' : 'text-ss-text-disabled cursor-not-allowed'}
 `}
                    onClick={() => {
                      if (canFormatCells && canMerge) {
                        dispatch('MERGE_ACROSS');
                        setMergeDropdownOpen(false);
                      }
                    }}
                    disabled={!canFormatCells || !canMerge}
                  >
                    <MergeAcrossIcon />
                    <span>Merge Across</span>
                  </button>
                  {/* Merge Cells (plain — no center alignment) */}
                  <button
                    type="button"
                    data-value="merge-cells"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
                  ${canFormatCells && canMerge ? 'hover:bg-ss-surface-hover text-text-ss-primary' : 'text-ss-text-disabled cursor-not-allowed'}
 `}
                    onClick={() => {
                      if (canFormatCells && canMerge) {
                        dispatch('MERGE_CELLS');
                        setMergeDropdownOpen(false);
                      }
                    }}
                    disabled={!canFormatCells || !canMerge}
                  >
                    <MergeCellsIcon />
                    <span>Merge Cells</span>
                  </button>
                  {/* Divider */}
                  <div className="h-px bg-ss-surface-tertiary my-1" />
                  {/* Unmerge Cells */}
                  <button
                    type="button"
                    data-value="unmerge"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
                  ${canFormatCells && canUnmerge ? 'hover:bg-ss-surface-hover text-text-ss-primary' : 'text-ss-text-disabled cursor-not-allowed'}
 `}
                    onClick={() => {
                      if (canFormatCells && canUnmerge) {
                        dispatch('UNMERGE_CELLS');
                        setMergeDropdownOpen(false);
                      }
                    }}
                    disabled={!canFormatCells || !canUnmerge}
                  >
                    <UnmergeCellsIcon />
                    <span>Unmerge Cells</span>
                  </button>
                  {/* Center Across Selection */}
                  <button
                    type="button"
                    data-value="center-across-selection"
                    data-testid="merge-menu-center-across-selection"
                    aria-describedby={
                      !centerAcrossAvailability.enabled
                        ? 'merge-center-across-disabled-reason'
                        : undefined
                    }
                    data-disabled-reason={centerAcrossAvailability.reason}
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
 ${centerAcrossAvailability.enabled ? 'hover:bg-ss-surface-hover text-text-ss-primary' : 'text-ss-text-disabled cursor-not-allowed'}
 `}
                    onClick={() => {
                      if (centerAcrossAvailability.enabled) {
                        dispatch('SET_HORIZONTAL_ALIGN', { align: 'centerContinuous' });
                        setMergeDropdownOpen(false);
                      }
                    }}
                    disabled={!centerAcrossAvailability.enabled}
                  >
                    <AlignCenterIcon />
                    <span>Center Across Selection</span>
                  </button>
                  {!centerAcrossAvailability.enabled && (
                    <span id="merge-center-across-disabled-reason" className="sr-only">
                      {centerAcrossAvailability.reason}
                    </span>
                  )}
                </div>
              </RibbonDropdownPanel>
            </div>
          </div>

          <div className="flex h-[var(--ribbon-button-height-third)] items-center gap-[var(--ribbon-button-inline-gap)]">
            {/* Text Orientation Dropdown */}
            <div className="relative inline-flex">
              <Tooltip title="Orientation">
                <RibbonButton
                  id="orientation"
                  layout="icon-only"
                  data-testid="ribbon-dropdown-orientation"
                  icon={<TextOrientationIcon />}
                  onClick={() => setOrientationDropdownOpen(!orientationDropdownOpen)}
                  isOpen={orientationDropdownOpen}
                  hasDropdown
                  disabled={!canFormatCells}
                  aria-label="Text orientation"
                  aria-expanded={orientationDropdownOpen}
                />
              </Tooltip>
              <RibbonDropdownPanel
                open={orientationDropdownOpen}
                onClose={() => setOrientationDropdownOpen(false)}
              >
                <div data-testid="ribbon-dropdown-menu-orientation" className="py-1 min-w-[180px]">
                  <button
                    type="button"
                    data-value="angle-counterclockwise"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
 ${canFormatCells ? 'hover:bg-ss-surface-hover' : 'text-ss-text-disabled cursor-not-allowed'}
 ${textRotation === 45 ? 'bg-ss-surface-selected' : ''}
 `}
                    onClick={() => {
                      if (!canFormatCells) return;
                      dispatch('SET_TEXT_ROTATION', { rotation: 45 });
                      setOrientationDropdownOpen(false);
                    }}
                    disabled={!canFormatCells}
                  >
                    <AngleCounterclockwiseIcon />
                    <span>Angle Counterclockwise</span>
                  </button>
                  <button
                    type="button"
                    data-value="angle-clockwise"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
 ${canFormatCells ? 'hover:bg-ss-surface-hover' : 'text-ss-text-disabled cursor-not-allowed'}
 ${textRotation === -45 ? 'bg-ss-surface-selected' : ''}
 `}
                    onClick={() => {
                      if (!canFormatCells) return;
                      dispatch('SET_TEXT_ROTATION', { rotation: -45 });
                      setOrientationDropdownOpen(false);
                    }}
                    disabled={!canFormatCells}
                  >
                    <AngleClockwiseIcon />
                    <span>Angle Clockwise</span>
                  </button>
                  <button
                    type="button"
                    data-value="vertical-text"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
 ${canFormatCells ? 'hover:bg-ss-surface-hover' : 'text-ss-text-disabled cursor-not-allowed'}
 ${textRotation === 255 ? 'bg-ss-surface-selected' : ''}
 `}
                    onClick={() => {
                      if (!canFormatCells) return;
                      dispatch('SET_TEXT_ROTATION', { rotation: 255 });
                      setOrientationDropdownOpen(false);
                    }}
                    disabled={!canFormatCells}
                  >
                    <VerticalTextIcon />
                    <span>Vertical Text</span>
                  </button>
                  <button
                    type="button"
                    data-value="rotate-text-up"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
 ${canFormatCells ? 'hover:bg-ss-surface-hover' : 'text-ss-text-disabled cursor-not-allowed'}
 ${textRotation === 90 ? 'bg-ss-surface-selected' : ''}
 `}
                    onClick={() => {
                      if (!canFormatCells) return;
                      dispatch('SET_TEXT_ROTATION', { rotation: 90 });
                      setOrientationDropdownOpen(false);
                    }}
                    disabled={!canFormatCells}
                  >
                    <RotateTextUpIcon />
                    <span>Rotate Text Up</span>
                  </button>
                  <button
                    type="button"
                    data-value="rotate-text-down"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
 ${canFormatCells ? 'hover:bg-ss-surface-hover' : 'text-ss-text-disabled cursor-not-allowed'}
 ${textRotation === -90 ? 'bg-ss-surface-selected' : ''}
 `}
                    onClick={() => {
                      if (!canFormatCells) return;
                      dispatch('SET_TEXT_ROTATION', { rotation: -90 });
                      setOrientationDropdownOpen(false);
                    }}
                    disabled={!canFormatCells}
                  >
                    <RotateTextDownIcon />
                    <span>Rotate Text Down</span>
                  </button>
                  <div className="h-px bg-ss-surface-tertiary my-1" />
                  <button
                    type="button"
                    data-value="no-rotation"
                    className={`
 w-full px-3 py-2 text-left text-dropdown
 flex items-center gap-2
 transition-colors
 ${canFormatCells ? 'hover:bg-ss-surface-hover' : 'text-ss-text-disabled cursor-not-allowed'}
 ${textRotation === 0 ? 'bg-ss-surface-selected' : ''}
 `}
                    onClick={() => {
                      if (!canFormatCells) return;
                      dispatch('SET_TEXT_ROTATION', { rotation: 0 });
                      setOrientationDropdownOpen(false);
                    }}
                    disabled={!canFormatCells}
                  >
                    <span className="w-4" />
                    <span>No Rotation</span>
                  </button>
                </div>
              </RibbonDropdownPanel>
            </div>

            {/* Decrease Indent */}
            <Tooltip title="Decrease Indent">
              <RibbonButton
                id="decrease-indent"
                layout="icon-only"
                icon={<DecreaseIndentIcon />}
                onClick={() => dispatch('DECREASE_INDENT')}
                disabled={!canFormatCells || indent === 0}
                aria-label="Decrease indent"
              />
            </Tooltip>

            {/* Increase Indent */}
            <Tooltip title="Increase Indent">
              <RibbonButton
                id="increase-indent"
                layout="icon-only"
                icon={<IncreaseIndentIcon />}
                onClick={() => dispatch('INCREASE_INDENT')}
                disabled={!canFormatCells}
                aria-label="Increase indent"
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </ToolbarGroup>
  );
});
