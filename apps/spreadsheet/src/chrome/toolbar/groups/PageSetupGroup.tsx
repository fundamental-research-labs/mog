/**
 * PageSetupGroup Component
 *
 * Self-sufficient Page Setup group for the Page Layout ribbon.
 * Contains: Margins, Orientation, Size, Print Area, Breaks, Print Titles
 *
 * Page Layout dispatch — dispatch compliance.
 *
 * Architecture:
 * - All user actions route through `dispatch()` (Unified Action System).
 * - Read state for `aria-pressed` / disabled flags comes from small,
 * focused read-only hooks (`usePrintArea`, `usePageBreaks`) — no
 * `usePageLayoutActions` wrapper, no parallel A1 conversion in the UI.
 */

import { useCallback, useEffect } from 'react';

import { PAGE_SETUP_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import {
  useActiveSheetId,
  useDispatch,
  usePageBreaks,
  usePrintArea,
  useUIStore,
} from '../../../internal-api';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import {
  RibbonDropdown,
  RibbonDropdownDivider,
  RibbonDropdownItem,
} from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  MarginsIcon,
  OrientationIcon,
  PageBreaksIcon,
  PrintAreaIcon,
  PrintTitlesIcon,
  SizeIcon,
} from '../primitives/ToolbarIcons';

// =============================================================================
// Component
// =============================================================================

/**
 * PageSetupGroup - Self-sufficient page setup group.
 *
 * All actions go through `dispatch()`. Read-only state (whether a print
 * area / page breaks exist) comes from focused state hooks for `aria-pressed`
 * / disabled rendering only.
 */
export function PageSetupGroup() {
  // ===========================================================================
  // Dispatch + Read-only State
  // ===========================================================================

  const dispatch = useDispatch();
  const activeSheetId = useActiveSheetId();
  const { hasPrintArea } = usePrintArea(activeSheetId);
  const { hasPageBreaks } = usePageBreaks(activeSheetId);

  // ===========================================================================
  // Local UI State (dropdown visibility)
  //
  // lifted into the ribbonDropdowns slice so the keytip chords
  // (Alt+P,M / Alt+P,O / Alt+P,S / Alt+P,A / Alt+P,B) can open these via
  // OPEN_RIBBON_DROPDOWN.
  // ===========================================================================

  const isPrintAreaOpen = useUIStore((s) => s.ribbonDropdowns['page.print-area'] ?? false);
  const isBreaksOpen = useUIStore((s) => s.ribbonDropdowns['page.breaks'] ?? false);
  const isMarginsOpen = useUIStore((s) => s.ribbonDropdowns['page.margins'] ?? false);
  const isOrientationOpen = useUIStore((s) => s.ribbonDropdowns['page.orientation'] ?? false);
  const isSizeOpen = useUIStore((s) => s.ribbonDropdowns['page.size'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const setIsPrintAreaOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('page.print-area') : closeRibbonDropdown('page.print-area'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setIsBreaksOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('page.breaks') : closeRibbonDropdown('page.breaks'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setIsMarginsOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('page.margins') : closeRibbonDropdown('page.margins'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setIsOrientationOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('page.orientation') : closeRibbonDropdown('page.orientation'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setIsSizeOpen = useCallback(
    (open: boolean) => (open ? openRibbonDropdown('page.size') : closeRibbonDropdown('page.size')),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-page.ts`.)
  // ===========================================================================

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // tabId is the kebab-case `page` (matching BASE_TABS); the previous
    // camelCase `pageLayout` value never matched anything (it wasn't a
    // valid tab id and the legacy `page-layout` id has been removed).
    keyTipRegistry.register({ key: 'M', tabId: 'page', elementId: 'page-margins' });
    cleanups.push(() => keyTipRegistry.unregister('M', 'page'));

    keyTipRegistry.register({ key: 'O', tabId: 'page', elementId: 'page-orientation' });
    cleanups.push(() => keyTipRegistry.unregister('O', 'page'));

    keyTipRegistry.register({ key: 'S', tabId: 'page', elementId: 'page-size' });
    cleanups.push(() => keyTipRegistry.unregister('S', 'page'));

    keyTipRegistry.register({ key: 'A', tabId: 'page', elementId: 'page-print-area' });
    cleanups.push(() => keyTipRegistry.unregister('A', 'page'));

    keyTipRegistry.register({ key: 'B', tabId: 'page', elementId: 'page-breaks' });
    cleanups.push(() => keyTipRegistry.unregister('B', 'page'));

    keyTipRegistry.register({ key: 'T', tabId: 'page', elementId: 'page-print-titles' });
    cleanups.push(() => keyTipRegistry.unregister('T', 'page'));

    return () => cleanups.forEach((c) => c());
  }, []);

  // ===========================================================================
  // Render - Trigger buttons
  // ===========================================================================

  // Margins trigger button
  const marginsTrigger = (
    <RibbonButton
      id="page-margins"
      layout="vertical"
      height="full"
      data-testid="ribbon-dropdown-margins"
      icon={<MarginsIcon />}
      label="Margins"
      hasDropdown
      dropdownPosition="inline"
      isOpen={isMarginsOpen}
      title="Set page margins"
      aria-label="Margins"
      aria-expanded={isMarginsOpen}
      aria-haspopup="menu"
    />
  );

  // Orientation trigger button
  const orientationTrigger = (
    <RibbonButton
      id="page-orientation"
      layout="vertical"
      height="full"
      // Distinct testid (page-orientation vs orientation) because both
      // ribbons can be in the DOM during tab-switch transitions: Home's
      // AlignmentGroup carries `ribbon-dropdown-orientation`, and the
      // momentary mount overlap during a switch would otherwise produce
      // duplicate matches for the harness.
      data-testid="ribbon-dropdown-page-orientation"
      icon={<OrientationIcon />}
      label="Orientation"
      hasDropdown
      dropdownPosition="inline"
      isOpen={isOrientationOpen}
      title="Set page orientation"
      aria-label="Orientation"
      aria-expanded={isOrientationOpen}
      aria-haspopup="menu"
      visibilityKey="orientation"
    />
  );

  // Size trigger button
  const sizeTrigger = (
    <RibbonButton
      id="page-size"
      layout="vertical"
      height="full"
      data-testid="ribbon-dropdown-size"
      icon={<SizeIcon />}
      label="Size"
      hasDropdown
      dropdownPosition="inline"
      isOpen={isSizeOpen}
      title="Set paper size"
      aria-label="Size"
      aria-expanded={isSizeOpen}
      aria-haspopup="menu"
    />
  );

  // Print Area trigger button
  const printAreaTrigger = (
    <RibbonButton
      id="page-print-area"
      layout="vertical"
      height="full"
      data-testid="ribbon-dropdown-print-area"
      icon={<PrintAreaIcon />}
      label="Print Area"
      hasDropdown
      dropdownPosition="inline"
      isOpen={hasPrintArea || isPrintAreaOpen}
      title={hasPrintArea ? 'Print Area is set - click to modify' : 'Set Print Area'}
      aria-label="Print Area"
      aria-expanded={isPrintAreaOpen}
      aria-haspopup="menu"
    />
  );

  // Page Breaks trigger button
  const breaksTrigger = (
    <RibbonButton
      id="page-breaks"
      layout="vertical"
      height="full"
      data-testid="ribbon-dropdown-breaks"
      icon={<PageBreaksIcon />}
      label="Breaks"
      hasDropdown
      dropdownPosition="inline"
      isOpen={hasPageBreaks || isBreaksOpen}
      title={hasPageBreaks ? 'Page breaks exist - click to manage' : 'Manage Page Breaks'}
      aria-label="Breaks"
      aria-expanded={isBreaksOpen}
      aria-haspopup="menu"
    />
  );

  return (
    <ToolbarGroup
      label="Page Setup"
      collapseConfig={PAGE_SETUP_COLLAPSE_CONFIG}
      dropdownIcon={<MarginsIcon />}
      onDialogLaunch={() => dispatch('OPEN_PAGE_SETUP_DIALOG')}
      dialogLaunchTitle="Page Setup"
    >
      <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
        {/* Margins Dropdown */}
        <RibbonDropdown
          open={isMarginsOpen}
          onOpenChange={setIsMarginsOpen}
          menuTestId="ribbon-dropdown-menu-margins"
          trigger={marginsTrigger}
          width={200}
          menuLabel="Margins"
        >
          <RibbonDropdownItem
            dataValue="normal"
            onClick={() => {
              dispatch('SET_PAGE_MARGINS', { preset: 'normal' });
              setIsMarginsOpen(false);
            }}
          >
            Normal (0.75" top/bottom, 0.7" left/right)
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="wide"
            onClick={() => {
              dispatch('SET_PAGE_MARGINS', { preset: 'wide' });
              setIsMarginsOpen(false);
            }}
          >
            Wide (1.0" all sides)
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="narrow"
            onClick={() => {
              dispatch('SET_PAGE_MARGINS', { preset: 'narrow' });
              setIsMarginsOpen(false);
            }}
          >
            Narrow (0.75" top/bottom, 0.25" left/right)
          </RibbonDropdownItem>
          <RibbonDropdownDivider />
          <RibbonDropdownItem
            dataValue="custom"
            onClick={() => {
              setIsMarginsOpen(false);
              dispatch('OPEN_PAGE_SETUP_DIALOG', { initialTab: 'margins' });
            }}
          >
            Custom Margins...
          </RibbonDropdownItem>
        </RibbonDropdown>

        {/* Orientation Dropdown */}
        <RibbonDropdown
          open={isOrientationOpen}
          onOpenChange={setIsOrientationOpen}
          menuTestId="ribbon-dropdown-menu-page-orientation"
          trigger={orientationTrigger}
          width={150}
          menuLabel="Orientation"
        >
          <RibbonDropdownItem
            dataValue="portrait"
            onClick={() => {
              dispatch('SET_PAGE_ORIENTATION', { orientation: 'portrait' });
              setIsOrientationOpen(false);
            }}
          >
            Portrait
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="landscape"
            onClick={() => {
              dispatch('SET_PAGE_ORIENTATION', { orientation: 'landscape' });
              setIsOrientationOpen(false);
            }}
          >
            Landscape
          </RibbonDropdownItem>
        </RibbonDropdown>

        {/* Size Dropdown */}
        <RibbonDropdown
          open={isSizeOpen}
          onOpenChange={setIsSizeOpen}
          menuTestId="ribbon-dropdown-menu-size"
          trigger={sizeTrigger}
          width={180}
          menuLabel="Paper Size"
        >
          <RibbonDropdownItem
            dataValue="letter"
            onClick={() => {
              dispatch('SET_PAPER_SIZE', { paperSize: 'letter' });
              setIsSizeOpen(false);
            }}
          >
            Letter (8.5" x 11")
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="legal"
            onClick={() => {
              dispatch('SET_PAPER_SIZE', { paperSize: 'legal' });
              setIsSizeOpen(false);
            }}
          >
            Legal (8.5" x 14")
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="a4"
            onClick={() => {
              dispatch('SET_PAPER_SIZE', { paperSize: 'a4' });
              setIsSizeOpen(false);
            }}
          >
            A4 (210mm x 297mm)
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="a3"
            onClick={() => {
              dispatch('SET_PAPER_SIZE', { paperSize: 'a3' });
              setIsSizeOpen(false);
            }}
          >
            A3 (297mm x 420mm)
          </RibbonDropdownItem>
          <RibbonDropdownDivider />
          <RibbonDropdownItem
            dataValue="more"
            onClick={() => {
              setIsSizeOpen(false);
              dispatch('OPEN_PAGE_SETUP_DIALOG');
            }}
          >
            More Paper Sizes...
          </RibbonDropdownItem>
        </RibbonDropdown>

        {/* Print Area Dropdown */}
        <RibbonDropdown
          open={isPrintAreaOpen}
          onOpenChange={setIsPrintAreaOpen}
          menuTestId="ribbon-dropdown-menu-print-area"
          trigger={printAreaTrigger}
          width={180}
          menuLabel="Print Area Options"
        >
          <RibbonDropdownItem
            dataValue="set"
            onClick={() => {
              dispatch('SET_PRINT_AREA');
              setIsPrintAreaOpen(false);
            }}
          >
            Set Print Area
          </RibbonDropdownItem>
          <RibbonDropdownDivider />
          <RibbonDropdownItem
            dataValue="clear"
            onClick={() => {
              dispatch('CLEAR_PRINT_AREA');
              setIsPrintAreaOpen(false);
            }}
            disabled={!hasPrintArea}
          >
            Clear Print Area
          </RibbonDropdownItem>
        </RibbonDropdown>

        {/* Page Breaks Dropdown */}
        <RibbonDropdown
          open={isBreaksOpen}
          onOpenChange={setIsBreaksOpen}
          menuTestId="ribbon-dropdown-menu-breaks"
          trigger={breaksTrigger}
          width={180}
          menuLabel="Page Breaks Options"
        >
          <RibbonDropdownItem
            dataValue="insert"
            onClick={() => {
              dispatch('INSERT_HORIZONTAL_PAGE_BREAK');
              setIsBreaksOpen(false);
            }}
          >
            Insert Page Break
          </RibbonDropdownItem>
          <RibbonDropdownItem
            dataValue="remove"
            onClick={() => {
              dispatch('REMOVE_HORIZONTAL_PAGE_BREAK');
              setIsBreaksOpen(false);
            }}
            disabled={!hasPageBreaks}
          >
            Remove Page Break
          </RibbonDropdownItem>
          <RibbonDropdownDivider />
          <RibbonDropdownItem
            dataValue="reset-all"
            onClick={() => {
              dispatch('RESET_PAGE_BREAKS');
              setIsBreaksOpen(false);
            }}
            disabled={!hasPageBreaks}
          >
            Reset All Page Breaks
          </RibbonDropdownItem>
        </RibbonDropdown>

        {/* Print Titles - direct action button (opens dialog), not a
 dropdown. Test selector retained for chrome-symmetry parity
 with the other Page Setup affordances. */}
        <RibbonButton
          id="page-print-titles"
          layout="vertical"
          height="full"
          data-testid="ribbon-button-print-titles"
          icon={<PrintTitlesIcon />}
          label="Print Titles"
          onClick={() => dispatch('OPEN_PAGE_SETUP_DIALOG', { initialTab: 'sheet' })}
          title="Print Titles - Set rows/columns to repeat on each page"
          aria-label="Print Titles"
        />
      </div>
    </ToolbarGroup>
  );
}
