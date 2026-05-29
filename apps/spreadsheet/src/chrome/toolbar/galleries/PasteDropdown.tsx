/**
 * PasteDropdown
 *
 * Dropdown menu for paste operations including:
 * - Paste (all)
 * - Paste Values
 * - Paste Formulas
 * - Paste Formatting
 * - Paste Special... (opens dialog)
 *
 * Uses SplitButton (large variant) for Excel-like appearance:
 * - Main button triggers default paste
 * - Dropdown arrow opens paste options menu
 *
 * Paste Preview on Hover:
 * - When hovering over a paste option, shows a live preview of what the paste would look like
 * - Preview is rendered as a semi-transparent overlay on the grid
 * - Cleared when mouse leaves or when paste is executed
 *
 */

import React, { useCallback, useState } from 'react';

import { PasteDefaultsDialog } from '../../../components/paste/PasteDefaultsDialog';
import {
  ENABLE_PASTE_DEFAULTS_V1,
  getPasteDefaultLabel,
} from '../../../domain/clipboard/paste-defaults';
import { usePastePreview } from '../../../hooks/view/use-paste-preview';
import { usePasteDefaultsPreference } from '../../../infra/state/paste-defaults-store';
import {
  RibbonDropdown,
  RibbonDropdownDivider,
  RibbonDropdownItem,
} from '../primitives/RibbonDropdown';
import { SplitButton } from '../primitives/SplitButton';
import { PasteIcon } from '../primitives/ToolbarIcons';

// =============================================================================
// Types
// =============================================================================

interface PasteDropdownProps {
  /** Optional ID for keytip positioning */
  id?: string;
  /** Paste all (default paste) */
  onPaste: () => void;
  /** Paste values only */
  onPasteValues: () => void;
  /** Paste formulas only */
  onPasteFormulas: () => void;
  /** Paste formatting only */
  onPasteFormats: () => void;
  /** Open Paste Special dialog */
  onPasteSpecial: () => void;
}

// =============================================================================
// Icons for menu items
// =============================================================================

function ValuesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <text x="3" y="12" fontSize="10" fontWeight="bold">
        123
      </text>
    </svg>
  );
}

function FormulasIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <text x="2" y="12" fontSize="10" fontStyle="italic">
        fx
      </text>
    </svg>
  );
}

function FormattingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="4" y="10" width="8" height="2" fill="var(--color-ss-warning)" />
    </svg>
  );
}

function PasteSpecialIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect
        x="2"
        y="2"
        width="8"
        height="10"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <rect
        x="6"
        y="4"
        width="8"
        height="10"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <circle cx="12" cy="12" r="3" fill="var(--color-ss-primary)" />
      <text x="10.5" y="14" fontSize="6" fill="var(--color-ss-surface)">
        ...
      </text>
    </svg>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * Paste dropdown component with memo for performance optimization.
 * Prevents unnecessary re-renders when parent component updates.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const PasteDropdown = React.memo(function PasteDropdown({
  id,
  onPaste,
  onPasteValues,
  onPasteFormulas,
  onPasteFormats,
  onPasteSpecial,
}: PasteDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDefaultsDialogOpen, setIsDefaultsDialogOpen] = useState(false);
  const pasteDefaultsPreference = usePasteDefaultsPreference();
  const activeDefaultLabel = getPasteDefaultLabel(pasteDefaultsPreference);

  // Paste Preview on Hover
  const { showPreview, hidePreview } = usePastePreview();

  // Handle main paste button click
  // Always enabled - unifiedPaste() handles empty clipboard gracefully (Excel behavior)
  const handleMainPaste = useCallback(() => {
    hidePreview(); // Clear preview before pasting
    onPaste();
  }, [onPaste, hidePreview]);

  // Handle dropdown toggle
  const handleDropdownClick = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Handle dropdown close - clear preview
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (!open) {
        hidePreview();
      }
    },
    [hidePreview],
  );

  // Wrap paste actions to clear preview first
  const handlePaste = useCallback(() => {
    hidePreview();
    onPaste();
  }, [hidePreview, onPaste]);

  const handlePasteValues = useCallback(() => {
    hidePreview();
    onPasteValues();
  }, [hidePreview, onPasteValues]);

  const handlePasteFormulas = useCallback(() => {
    hidePreview();
    onPasteFormulas();
  }, [hidePreview, onPasteFormulas]);

  const handlePasteFormats = useCallback(() => {
    hidePreview();
    onPasteFormats();
  }, [hidePreview, onPasteFormats]);

  const handlePasteSpecial = useCallback(() => {
    hidePreview();
    onPasteSpecial();
  }, [hidePreview, onPasteSpecial]);

  const handleOpenDefaults = useCallback(() => {
    hidePreview();
    setIsDefaultsDialogOpen(true);
  }, [hidePreview]);

  // Trigger element - SplitButton with large variant for Excel-like appearance
  // Always enabled - paste reads system clipboard and handles empty case gracefully (Excel behavior)
  const trigger = (
    <SplitButton
      id={id}
      icon={<PasteIcon />}
      label="Paste"
      variant="large"
      isOpen={isOpen}
      title="Paste (Ctrl+V)"
      aria-label="Paste"
      visibilityKey="paste"
      onMainClick={handleMainPaste}
      onDropdownClick={handleDropdownClick}
      mainTestId="toolbar-paste-button"
      dropdownTestId="toolbar-paste-dropdown"
    />
  );

  return (
    <>
      <RibbonDropdown
        open={isOpen}
        onOpenChange={handleOpenChange}
        menuTestId="ribbon-dropdown-menu-paste"
        trigger={trigger}
        width={180}
        manualTrigger
      >
        {ENABLE_PASTE_DEFAULTS_V1 && (
          <>
            <div
              className="px-3 py-1.5 text-dropdown-header text-ss-text-tertiary"
              data-testid="paste-default-active-label"
            >
              {activeDefaultLabel}
            </div>
            <RibbonDropdownItem
              dataValue="set-default"
              testId="toolbar-paste-defaults-trigger"
              onClick={handleOpenDefaults}
            >
              Set Default Paste...
            </RibbonDropdownItem>
            <RibbonDropdownDivider />
          </>
        )}
        {/* Paste (all) */}
        <RibbonDropdownItem
          dataValue="all"
          onClick={handlePaste}
          icon={<PasteIcon />}
          onMouseEnter={() => showPreview('all')}
          onMouseLeave={hidePreview}
        >
          <span className="flex-1">Paste</span>
          <span className="ml-auto text-ribbon text-ss-text-disabled">Ctrl+V</span>
        </RibbonDropdownItem>

        <RibbonDropdownDivider />

        {/* Paste Values */}
        <RibbonDropdownItem
          dataValue="values"
          onClick={handlePasteValues}
          icon={<ValuesIcon />}
          onMouseEnter={() => showPreview('valuesOnly')}
          onMouseLeave={hidePreview}
        >
          Paste Values
        </RibbonDropdownItem>

        {/* Paste Formulas */}
        <RibbonDropdownItem
          dataValue="formulas"
          testId="toolbar-paste-formulas"
          onClick={handlePasteFormulas}
          icon={<FormulasIcon />}
          onMouseEnter={() => showPreview('formulas')}
          onMouseLeave={hidePreview}
        >
          Paste Formulas
        </RibbonDropdownItem>

        {/* Paste Formatting */}
        <RibbonDropdownItem
          dataValue="formats"
          testId="toolbar-paste-formats"
          onClick={handlePasteFormats}
          icon={<FormattingIcon />}
          onMouseEnter={() => showPreview('formatting')}
          onMouseLeave={hidePreview}
        >
          Paste Formatting
        </RibbonDropdownItem>

        <RibbonDropdownDivider />

        {/* Paste Special - no preview, opens dialog */}
        <RibbonDropdownItem
          dataValue="special"
          onClick={handlePasteSpecial}
          icon={<PasteSpecialIcon />}
        >
          <span className="flex-1">Paste Special...</span>
          <span className="ml-auto text-ribbon text-ss-text-disabled">Ctrl+Shift+V</span>
        </RibbonDropdownItem>
      </RibbonDropdown>
      <PasteDefaultsDialog
        open={isDefaultsDialogOpen}
        preference={pasteDefaultsPreference}
        onClose={() => setIsDefaultsDialogOpen(false)}
      />
    </>
  );
});
