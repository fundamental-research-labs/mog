/**
 * Clipboard Group
 *
 * Self-sufficient toolbar group for clipboard operations.
 * Excel layout: large Paste on left, stacked Cut/Copy/Format Painter on right.
 *
 * Features:
 * - Large Paste button with dropdown (Paste, Paste Values, Paste Formulas, etc.)
 * - Cut button (Ctrl+X)
 * - Copy button (Ctrl+C)
 * - Format Painter button (click to copy format, double-click to lock)
 *
 * COLLAPSE SUPPORT (
 * - Passes CLIPBOARD_COLLAPSE_CONFIG to ToolbarGroup
 * - Priority 1 (highest) - core operations, collapse last
 *
 * KEYTIPS:
 * - V = Paste
 * - X = Cut
 * - C = Copy
 * - FP = Format Painter
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 *
 */

import React, { useCallback, useEffect } from 'react';

import { Tooltip } from '@mog/shell';
import { useFeatureGate, useUIStore } from '../../../internal-api';
import { CLIPBOARD_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { PasteDropdown } from '../galleries/PasteDropdown';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { keyTipRegistry } from '../keytips';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { CopyIcon, CutIcon, FormatPainterIcon, PasteIcon } from '../primitives/ToolbarIcons';

// =============================================================================
// Component
// =============================================================================

/**
 * Clipboard toolbar group - self-sufficient, no props required.
 *
 * Layout matches Excel:
 * - Left: Large Paste dropdown (full height)
 * - Right: Stacked Cut, Copy, Format Painter buttons
 *
 * All state and actions come from useClipboardActions hook.
 * Memoized to prevent re-renders when parent re-renders.
 */
export const ClipboardGroup = React.memo(function ClipboardGroup() {
  const isEnabled = useFeatureGate('groups', 'clipboard');

  // ===========================================================================
  // State + dispatch hook
  // ===========================================================================

  const isFormatPainterActive = useUIStore((s) => s.formatPainter.isActive);
  const dispatchAction = useDispatch();

  // PasteDropdown receives bound callbacks. Defining them via useCallback
  // keeps the prop identity stable across renders (the dropdown is memoized
  // downstream by React.memo elsewhere in the toolbar tree).
  const handleCut = useCallback(() => dispatchAction('CUT'), [dispatchAction]);
  const handleCopy = useCallback(() => dispatchAction('COPY'), [dispatchAction]);
  const handlePaste = useCallback(() => dispatchAction('PASTE'), [dispatchAction]);
  const handlePasteValues = useCallback(() => dispatchAction('PASTE_VALUES'), [dispatchAction]);
  const handlePasteFormulas = useCallback(() => dispatchAction('PASTE_FORMULAS'), [dispatchAction]);
  const handlePasteFormats = useCallback(
    () => dispatchAction('PASTE_FORMATTING'),
    [dispatchAction],
  );
  const handlePasteSpecial = useCallback(
    () => dispatchAction('OPEN_PASTE_SPECIAL_DIALOG'),
    [dispatchAction],
  );
  const handleToggleFormatPainter = useCallback(
    () => dispatchAction('TOGGLE_FORMAT_PAINTER'),
    [dispatchAction],
  );
  const handleLockFormatPainter = useCallback(
    () => dispatchAction('TOGGLE_FORMAT_PAINTER_LOCKED'),
    [dispatchAction],
  );

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-home-groups.ts`.)
  // ===========================================================================

  useEffect(() => {
    keyTipRegistry.register({ key: 'V', tabId: 'home', elementId: 'clipboard-paste' });
    keyTipRegistry.register({ key: 'X', tabId: 'home', elementId: 'clipboard-cut' });
    keyTipRegistry.register({ key: 'C', tabId: 'home', elementId: 'clipboard-copy' });
    keyTipRegistry.register({ key: 'FP', tabId: 'home', elementId: 'clipboard-format-painter' });

    return () => {
      keyTipRegistry.unregister('V', 'home');
      keyTipRegistry.unregister('X', 'home');
      keyTipRegistry.unregister('C', 'home');
      keyTipRegistry.unregister('FP', 'home');
    };
  }, []);

  // ===========================================================================
  // Render
  // ===========================================================================

  if (!isEnabled) return null;

  return (
    <ToolbarGroup
      label="Clipboard"
      collapseConfig={CLIPBOARD_COLLAPSE_CONFIG}
      dropdownIcon={<PasteIcon />}
    >
      <div className="flex flex-row items-center gap-1">
        {/* Left: Paste dropdown (large button spanning full height) */}
        {/* Always enabled - unifiedPaste() handles empty clipboard gracefully (Excel behavior) */}
        <PasteDropdown
          id="clipboard-paste"
          onPaste={handlePaste}
          onPasteValues={handlePasteValues}
          onPasteFormulas={handlePasteFormulas}
          onPasteFormats={handlePasteFormats}
          onPasteSpecial={handlePasteSpecial}
        />

        {/* Right: Stacked Cut, Copy, Format Painter */}
        <div className="flex flex-col justify-center gap-[var(--ribbon-button-gap)]">
          <Tooltip title="Cut" shortcut="Ctrl+X">
            <RibbonButton
              id="clipboard-cut"
              layout="icon-only"
              icon={<CutIcon />}
              onClick={handleCut}
              aria-label="Cut"
            />
          </Tooltip>

          <Tooltip title="Copy" shortcut="Ctrl+C">
            <RibbonButton
              id="clipboard-copy"
              layout="icon-only"
              icon={<CopyIcon />}
              onClick={handleCopy}
              aria-label="Copy"
            />
          </Tooltip>

          <Tooltip title="Format Painter" description="Click to copy format, double-click to lock">
            <RibbonButton
              id="clipboard-format-painter"
              layout="icon-only"
              icon={<FormatPainterIcon />}
              onClick={handleToggleFormatPainter}
              onDoubleClick={handleLockFormatPainter}
              isOpen={isFormatPainterActive}
              aria-label="Format Painter"
              aria-pressed={isFormatPainterActive}
              data-format-painter-active={isFormatPainterActive || undefined}
            />
          </Tooltip>
        </div>
      </div>
    </ToolbarGroup>
  );
});
