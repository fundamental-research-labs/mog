/**
 * Text effects format tab
 *
 * Contextual command tab shown when a text-effects object is selected.
 * Provides styling and formatting options for text-effects text.
 *
 * ARCHITECTURE:
 * - Uses useSelectedTextEffectDebounced() for display (prevents re-renders during drag)
 * - Uses deps.accessors for reading current selection in handlers (on-demand reads)
 * - All state mutations go through dispatch() for proper action tracking
 * - Follows coordinator/machine architecture patterns
 *
 * UI Components - Format Tab
 * Format Tab Button Actions
 * @see docs/ARCHITECTURE-CHECKLIST.md (Section 15: Render Isolation)
 */

import React, { useCallback, useMemo, useState } from 'react';
import { dispatch, useActionDependencies } from '../../../internal-api';

import type { TextEffectOutline } from '@mog-sdk/contracts/text-effects';
import { ColorPicker } from '../../../components/pickers/ColorPicker';
import { EffectsPicker } from '../../../components/text-effects/EffectsPicker';
import { FillPicker } from '../../../components/text-effects/FillPicker';
import { TransformPicker } from '../../../components/text-effects/TransformPicker';
import { useSelectedTextEffectDebounced } from '../../../hooks/objects/useSelectedTextEffects';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdown, RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  BoldIcon,
  BringToFrontIcon,
  FontSizeIcon,
  ItalicIcon,
  SendToBackIcon,
} from '../primitives/ToolbarIcons';
// =============================================================================
// Constants
// =============================================================================

/** Standard font size options matching Excel */
const FONT_SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

// =============================================================================
// Icon Components
// =============================================================================

/**
 * Transform (Warp) icon for TextEffect text transformations.
 * Uses a simple curved path to indicate text warping.
 */
function TransformIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 14 Q10 4 17 14" />
      <text x="10" y="12" fontSize="6" textAnchor="middle" fill="currentColor" stroke="none">
        A
      </text>
    </svg>
  );
}

/**
 * Text Fill icon for TextEffect fill color/gradient.
 */
function TextFillIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <text x="10" y="13" fontSize="12" textAnchor="middle" fill="currentColor" stroke="none">
        A
      </text>
      <rect x="3" y="15" width="14" height="3" fill="#4472C4" stroke="none" rx="0.5" />
    </svg>
  );
}

/**
 * Text Outline icon for TextEffect stroke styling.
 */
function TextOutlineIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <text
        x="10"
        y="13"
        fontSize="12"
        textAnchor="middle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        A
      </text>
      <rect x="3" y="15" width="14" height="3" fill="none" stroke="#4472C4" rx="0.5" />
    </svg>
  );
}

/**
 * Text Effects icon for shadows, glow, reflection, etc.
 */
function TextEffectsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Shadow offset */}
      <text x="11" y="14" fontSize="12" textAnchor="middle" fill="#999" stroke="none" opacity="0.5">
        A
      </text>
      {/* Main letter */}
      <text x="10" y="13" fontSize="12" textAnchor="middle" fill="currentColor" stroke="none">
        A
      </text>
    </svg>
  );
}

// =============================================================================
// Font Size Dropdown Component
// =============================================================================

interface FontSizeDropdownProps {
  value: number;
  onChange: (size: number) => void;
}

function FontSizeDropdown({ value, onChange }: FontSizeDropdownProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <RibbonDropdown
      open={isOpen}
      onOpenChange={setIsOpen}
      menuTestId="ribbon-dropdown-menu-text-effects-font-size"
      trigger={
        <RibbonButton
          id="text-effects-font-size"
          layout="horizontal"
          height="third"
          data-testid="ribbon-dropdown-text-effects-font-size"
          icon={<FontSizeIcon />}
          label={String(value)}
          hasDropdown
          isOpen={isOpen}
          title="Font Size"
          aria-label="Font Size"
        />
      }
    >
      <div className="py-1 max-h-64 overflow-y-auto">
        {FONT_SIZE_OPTIONS.map((size) => (
          <button
            key={size}
            data-value={String(size)}
            className={`
 w-full px-3 py-1 text-left text-body-sm
 ${size === value ? 'bg-ss-primary-light text-ss-primary' : 'hover:bg-ss-surface-hover'}
 `}
            onClick={() => {
              onChange(size);
              setIsOpen(false);
            }}
          >
            {size}
          </button>
        ))}
      </div>
    </RibbonDropdown>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * TextEffect Format Tab - Contextual ribbon tab for TextEffect formatting.
 *
 * This tab only renders when a TextEffect object is selected. It provides:
 * - Text Styles group: Bold, Italic, Font Size
 * - TextEffect Styles group: Transform, Fill, Outline, Effects
 * - Arrange group: Bring to Front, Send to Back
 *
 * RENDER ISOLATION (Architecture Checklist Section 15):
 * - Uses useSelectedTextEffectDebounced() for display to prevent re-renders during drag
 * - Handlers read current selection on-demand via deps.accessors
 */
export const TextEffectFormatTab = React.memo(
  function TextEffectFormatTab(): React.JSX.Element | null {
    const deps = useActionDependencies();

    // Use debounced selection for display to prevent re-renders during drag
    // Handlers will read current selection on-demand via deps.accessors
    const selectedTextEffect = useSelectedTextEffectDebounced();

    // ===========================================================================
    // Picker Panel State (local state for UI panels)
    // ===========================================================================

    const [transformPickerOpen, setTransformPickerOpen] = useState(false);
    const [fillPickerOpen, setFillPickerOpen] = useState(false);
    const [outlinePickerOpen, setOutlinePickerOpen] = useState(false);
    const [effectsPickerOpen, setEffectsPickerOpen] = useState(false);

    // Get current format values for display (from debounced selection)
    const currentFormat = useMemo(() => {
      if (!selectedTextEffect) return null;
      const textFormat = selectedTextEffect.text?.format;
      return {
        fontSize: textFormat?.fontSize ?? 36,
        isBold: textFormat?.bold === true,
        isItalic: textFormat?.italic === true,
      };
    }, [selectedTextEffect]);

    // Get current outline color for display
    const currentOutlineColor = useMemo(() => {
      const outline = selectedTextEffect?.textEffects?.outline;
      if (!outline) return undefined;
      return outline.color;
    }, [selectedTextEffect?.textEffects?.outline]);

    // ===========================================================================
    // Handler Functions (read current selection on-demand via deps.accessors)
    // ===========================================================================

    const handleToggleBold = useCallback(() => {
      // Read current selection from deps.accessors (not from debounced hook)
      const selectedIds = deps.accessors.object.getSelectedIds();
      if (selectedIds.length !== 1) return;

      const objectId = selectedIds[0];

      // Get current bold state from the debounced value for toggle
      const currentBold = selectedTextEffect?.text?.format?.bold ?? false;

      dispatch('UPDATE_TEXT_EFFECT_FORMAT', deps, {
        objectId,
        bold: !currentBold,
      });
    }, [deps, selectedTextEffect?.text?.format?.bold]);

    const handleToggleItalic = useCallback(() => {
      const selectedIds = deps.accessors.object.getSelectedIds();
      if (selectedIds.length !== 1) return;

      const objectId = selectedIds[0];

      // Get current italic state from the debounced value for toggle
      const currentItalic = selectedTextEffect?.text?.format?.italic ?? false;

      dispatch('UPDATE_TEXT_EFFECT_FORMAT', deps, {
        objectId,
        italic: !currentItalic,
      });
    }, [deps, selectedTextEffect?.text?.format?.italic]);

    const handleFontSizeChange = useCallback(
      (size: number) => {
        const selectedIds = deps.accessors.object.getSelectedIds();
        if (selectedIds.length !== 1) return;

        const objectId = selectedIds[0];

        dispatch('UPDATE_TEXT_EFFECT_FORMAT', deps, {
          objectId,
          fontSize: size,
        });
      },
      [deps],
    );

    const handleTransformPickerClose = useCallback(() => {
      setTransformPickerOpen(false);
    }, []);

    const handleOutlineColorChange = useCallback(
      (color: string | null) => {
        const selectedIds = deps.accessors.object.getSelectedIds();
        if (selectedIds.length !== 1) return;

        const objectId = selectedIds[0];

        if (color === null) {
          // Remove outline
          dispatch('UPDATE_TEXT_EFFECT_OUTLINE', deps, {
            objectId,
            outline: undefined,
          });
        } else {
          // Set or update outline with color
          const currentOutline = selectedTextEffect?.textEffects?.outline;
          const newOutline: TextEffectOutline = {
            color,
            width: currentOutline?.width ?? 12700, // Default 1pt in EMUs
          };
          dispatch('UPDATE_TEXT_EFFECT_OUTLINE', deps, {
            objectId,
            outline: newOutline,
          });
        }
        setOutlinePickerOpen(false);
      },
      [deps, selectedTextEffect?.textEffects?.outline],
    );

    const handleEffectsPickerClose = useCallback(() => {
      setEffectsPickerOpen(false);
    }, []);

    const handleBringToFront = useCallback(() => {
      dispatch('BRING_OBJECT_TO_FRONT', deps);
    }, [deps]);

    const handleSendToBack = useCallback(() => {
      dispatch('SEND_OBJECT_TO_BACK', deps);
    }, [deps]);

    // Don't render if no TextEffect is selected
    if (!selectedTextEffect || !currentFormat) return null;

    // ===========================================================================
    // Render
    // ===========================================================================

    return (
      <div className="flex items-center gap-1 px-2">
        {/* Text Styles Group */}
        <ToolbarGroup label="Text">
          <div className="flex items-center gap-0.5">
            <RibbonButton
              id="text-effects-bold"
              layout="icon-only"
              icon={<BoldIcon />}
              onClick={handleToggleBold}
              isOpen={currentFormat.isBold}
              title="Bold (Ctrl+B)"
              aria-label="Bold"
              aria-pressed={currentFormat.isBold}
            />
            <RibbonButton
              id="text-effects-italic"
              layout="icon-only"
              icon={<ItalicIcon />}
              onClick={handleToggleItalic}
              isOpen={currentFormat.isItalic}
              title="Italic (Ctrl+I)"
              aria-label="Italic"
              aria-pressed={currentFormat.isItalic}
            />
          </div>
          <FontSizeDropdown value={currentFormat.fontSize} onChange={handleFontSizeChange} />
        </ToolbarGroup>

        {/* Text effects styles group */}
        <ToolbarGroup label="Text effects styles">
          {/* Transform Picker */}
          <div className="relative inline-flex">
            <RibbonButton
              id="text-effects-transform"
              layout="vertical"
              height="full"
              data-testid="ribbon-dropdown-text-effects-transform"
              icon={<TransformIcon />}
              label="Transform"
              hasDropdown
              dropdownPosition="inline"
              isOpen={transformPickerOpen}
              onClick={() => setTransformPickerOpen(!transformPickerOpen)}
              title="Text Transform"
              aria-label="Text Transform"
            />
            <RibbonDropdownPanel open={transformPickerOpen} onClose={handleTransformPickerClose}>
              <div data-testid="ribbon-dropdown-menu-text-effects-transform">
                <TransformPicker onSelect={handleTransformPickerClose} />
              </div>
            </RibbonDropdownPanel>
          </div>

          {/* Fill Picker */}
          <FillPicker
            trigger={
              <RibbonButton
                id="text-effects-fill"
                layout="vertical"
                height="full"
                data-testid="ribbon-dropdown-text-effects-fill"
                icon={<TextFillIcon />}
                label="Text Fill"
                hasDropdown
                dropdownPosition="inline"
                isOpen={fillPickerOpen}
                title="Text Fill"
                aria-label="Text Fill"
              />
            }
            open={fillPickerOpen}
            onOpenChange={setFillPickerOpen}
          />

          {/* Outline Picker */}
          <div className="relative inline-flex">
            <RibbonButton
              id="text-effects-outline"
              layout="vertical"
              height="full"
              data-testid="ribbon-dropdown-text-effects-outline"
              icon={<TextOutlineIcon />}
              label="Text Outline"
              hasDropdown
              dropdownPosition="inline"
              isOpen={outlinePickerOpen}
              onClick={() => setOutlinePickerOpen(!outlinePickerOpen)}
              title="Text Outline"
              aria-label="Text Outline"
            />
            <RibbonDropdownPanel
              open={outlinePickerOpen}
              onClose={() => setOutlinePickerOpen(false)}
            >
              <div data-testid="ribbon-dropdown-menu-text-effects-outline">
                <ColorPicker
                  value={currentOutlineColor}
                  onChange={handleOutlineColorChange}
                  onClose={() => setOutlinePickerOpen(false)}
                  showNoColor
                  noColorLabel="No Outline"
                />
              </div>
            </RibbonDropdownPanel>
          </div>

          {/* Effects Picker */}
          <div className="relative inline-flex">
            <RibbonButton
              id="text-effects-effects"
              layout="vertical"
              height="full"
              data-testid="ribbon-dropdown-text-effects-effects"
              icon={<TextEffectsIcon />}
              label="Text Effects"
              hasDropdown
              dropdownPosition="inline"
              isOpen={effectsPickerOpen}
              onClick={() => setEffectsPickerOpen(!effectsPickerOpen)}
              title="Text Effects"
              aria-label="Text Effects"
            />
            <RibbonDropdownPanel open={effectsPickerOpen} onClose={handleEffectsPickerClose}>
              <div
                data-testid="ribbon-dropdown-menu-text-effects-effects"
                className="w-80 max-h-96 overflow-y-auto"
              >
                <EffectsPicker />
              </div>
            </RibbonDropdownPanel>
          </div>
        </ToolbarGroup>

        {/* Arrange Group */}
        <ToolbarGroup label="Arrange" isLast>
          <RibbonButton
            id="text-effects-bring-front"
            layout="icon-only"
            icon={<BringToFrontIcon />}
            onClick={handleBringToFront}
            title="Bring to Front"
            aria-label="Bring to Front"
          />
          <RibbonButton
            id="text-effects-send-back"
            layout="icon-only"
            icon={<SendToBackIcon />}
            onClick={handleSendToBack}
            title="Send to Back"
            aria-label="Send to Back"
          />
        </ToolbarGroup>
      </div>
    );
  },
);
