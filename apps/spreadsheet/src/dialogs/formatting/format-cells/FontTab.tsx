/**
 * FontTab Component
 *
 * Font tab for Format Cells dialog (Ctrl+1).
 * Provides comprehensive font formatting options including:
 * - Font family picker (SYSTEM_FONTS)
 * - Font style selector (Regular, Bold, Italic, Bold Italic)
 * - Font size picker (8-72pt standard sizes)
 * - Underline type dropdown (4 Excel types)
 * - Color picker (reuse ColorPicker)
 * - Effects checkboxes (Strikethrough, Superscript, Subscript)
 * - Live preview area showing "AaBbCcYyZz"
 *
 * Architecture:
 * - Uses Draft + Apply pattern with forwardRef
 * - Changes accumulate in local state
 * - Exposes getChanges() ref method for parent dialog to call on Apply/OK
 * - Parent dialog owns ALL dispatch calls - this tab never calls dispatch directly
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 *
 * Mixed-state handling:
 * - When `initialFormat?.<key>` is undefined, the property has mixed values across
 * the selection. Selects render placeholder, ColorPicker renders "no color",
 * Checkboxes render indeterminate. Only properties the user actually modifies
 * are returned from getChanges (via dirtyRef).
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Draft + Apply Pattern
 */

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { Checkbox, Label, SectionLabel, Select } from '@mog/shell';
import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { ColorPicker } from '../../../components/pickers/ColorPicker';
import { OFFICE_THEME } from '../../../infra/styles/built-in-themes';
import { SYSTEM_FONTS } from '../../../infra/styles/fonts';
// =============================================================================
// Types
// =============================================================================

/**
 * Ref handle exposed by FontTab for parent dialog to call.
 */
export interface FontTabRef {
  /** Get the pending format changes to apply */
  getChanges: () => Partial<CellFormat>;
  /** Check if there are any changes to apply */
  hasChanges: () => boolean;
}

export interface FontTabProps {
  /** Current cell format (for initializing draft state) */
  initialFormat?: Partial<CellFormat>;
  /** Recent colors for color picker */
  recentColors?: string[];
  /** Called when a color is selected (for tracking recent colors - D5) */
  onColorSelect?: (color: string) => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Excel standard font sizes */
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/** Font style options (combinations of bold/italic) */
const FONT_STYLES = [
  { value: 'regular', label: 'Regular', bold: false, italic: false },
  { value: 'bold', label: 'Bold', bold: true, italic: false },
  { value: 'italic', label: 'Italic', bold: false, italic: true },
  { value: 'bold-italic', label: 'Bold Italic', bold: true, italic: true },
];

/** Underline type options (Excel 4 types) */
const UNDERLINE_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'singleAccounting', label: 'Single Accounting' },
  { value: 'doubleAccounting', label: 'Double Accounting' },
] as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get current font style value from bold/italic flags.
 * Returns undefined when either flag is undefined (mixed state) so the Select
 * displays its placeholder.
 */
function getFontStyleValue(bold?: boolean, italic?: boolean): string | undefined {
  if (bold === undefined || italic === undefined) return undefined;
  if (bold && italic) return 'bold-italic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

/**
 * Build CSS text-decoration string from draft format.
 * Treats indeterminate strikethrough as off so the preview renders something.
 */
function buildTextDecoration(
  underlineType: CellFormat['underlineType'] | undefined,
  strikethrough: boolean | 'indeterminate',
): string {
  const parts = [];
  if (underlineType && underlineType !== 'none') {
    parts.push('underline');
  }
  if (strikethrough === true) {
    parts.push('line-through');
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

// =============================================================================
// Component
// =============================================================================

/**
 * FontTab - Cell font settings.
 *
 * Architecture:
 * - Uses forwardRef to expose getChanges() method to parent
 * - Parent dialog (FormatCellsDialog) owns the dispatch call
 * - Tab does NOT call dispatch - only accumulates changes locally
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 */
export const FontTab = forwardRef<FontTabRef, FontTabProps>(function FontTab(
  { initialFormat, recentColors, onColorSelect },
  ref,
) {
  // Draft state: undefined entries indicate mixed state across the selection.
  const [draftFormat, setDraftFormat] = useState<Partial<CellFormat>>({
    fontFamily: initialFormat?.fontFamily,
    fontSize: initialFormat?.fontSize,
    bold: initialFormat?.bold,
    italic: initialFormat?.italic,
    underlineType: initialFormat?.underlineType,
    fontColor: initialFormat?.fontColor,
  });

  // Tri-state checkboxes: 'indeterminate' when initial value is undefined.
  const [strikethrough, setStrikethrough] = useState<boolean | 'indeterminate'>(() =>
    initialFormat?.strikethrough === undefined ? 'indeterminate' : initialFormat.strikethrough,
  );
  const [superscript, setSuperscript] = useState<boolean | 'indeterminate'>(() =>
    initialFormat?.superscript === undefined ? 'indeterminate' : initialFormat.superscript,
  );
  const [subscript, setSubscript] = useState<boolean | 'indeterminate'>(() =>
    initialFormat?.subscript === undefined ? 'indeterminate' : initialFormat.subscript,
  );

  // Track which properties the user actually modified.
  const dirtyRef = useRef(new Set<keyof CellFormat>());
  const markDirty = useCallback((key: keyof CellFormat) => {
    dirtyRef.current.add(key);
  }, []);

  // Get current theme for color picker
  const theme: ThemeDefinition = useMemo(() => {
    // TODO: Get actual theme from workbook when theme support is added
    return OFFICE_THEME;
  }, []);

  // ===========================================================================
  // Expose ref methods for parent dialog
  // ===========================================================================

  useImperativeHandle(
    ref,
    () => ({
      getChanges: (): Partial<CellFormat> => {
        const changes: Partial<CellFormat> = {};
        const dirty = dirtyRef.current;

        if (dirty.has('fontFamily') && draftFormat.fontFamily !== undefined) {
          changes.fontFamily = draftFormat.fontFamily;
        }
        if (dirty.has('fontSize') && draftFormat.fontSize !== undefined) {
          changes.fontSize = draftFormat.fontSize;
        }
        if (dirty.has('bold') && draftFormat.bold !== undefined) {
          changes.bold = draftFormat.bold;
        }
        if (dirty.has('italic') && draftFormat.italic !== undefined) {
          changes.italic = draftFormat.italic;
        }
        if (dirty.has('underlineType') && draftFormat.underlineType !== undefined) {
          changes.underlineType = draftFormat.underlineType;
        }
        if (dirty.has('fontColor')) {
          // fontColor may be undefined (cleared) - that's a valid change.
          changes.fontColor = draftFormat.fontColor;
        }
        if (dirty.has('strikethrough') && strikethrough !== 'indeterminate') {
          changes.strikethrough = strikethrough;
        }
        if (dirty.has('superscript') && superscript !== 'indeterminate') {
          changes.superscript = superscript;
        }
        if (dirty.has('subscript') && subscript !== 'indeterminate') {
          changes.subscript = subscript;
        }

        return changes;
      },
      hasChanges: () => dirtyRef.current.size > 0,
    }),
    [draftFormat, strikethrough, superscript, subscript],
  );

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  const handleFontFamilyChange = useCallback(
    (value: string) => {
      markDirty('fontFamily');
      setDraftFormat((prev) => ({ ...prev, fontFamily: value }));
    },
    [markDirty],
  );

  const handleFontSizeChange = useCallback(
    (value: string) => {
      markDirty('fontSize');
      setDraftFormat((prev) => ({ ...prev, fontSize: Number(value) }));
    },
    [markDirty],
  );

  const handleFontStyleChange = useCallback(
    (value: string) => {
      const style = FONT_STYLES.find((s) => s.value === value);
      if (style) {
        markDirty('bold');
        markDirty('italic');
        setDraftFormat((prev) => ({ ...prev, bold: style.bold, italic: style.italic }));
      }
    },
    [markDirty],
  );

  const handleUnderlineChange = useCallback(
    (value: string) => {
      markDirty('underlineType');
      setDraftFormat((prev) => ({
        ...prev,
        underlineType: value as CellFormat['underlineType'],
      }));
    },
    [markDirty],
  );

  const handleColorChange = useCallback(
    (color: string | null) => {
      markDirty('fontColor');
      setDraftFormat((prev) => ({ ...prev, fontColor: color || undefined }));
      // Track color selection for recent colors
      if (color) {
        onColorSelect?.(color);
      }
    },
    [markDirty, onColorSelect],
  );

  const handleStrikethroughChange = useCallback(
    (checked: boolean) => {
      markDirty('strikethrough');
      setStrikethrough(checked);
    },
    [markDirty],
  );

  const handleSuperscriptChange = useCallback(
    (checked: boolean) => {
      // Superscript and subscript are mutually exclusive.
      markDirty('superscript');
      setSuperscript(checked);
      if (checked) {
        markDirty('subscript');
        setSubscript(false);
      }
    },
    [markDirty],
  );

  const handleSubscriptChange = useCallback(
    (checked: boolean) => {
      // Superscript and subscript are mutually exclusive.
      markDirty('subscript');
      setSubscript(checked);
      if (checked) {
        markDirty('superscript');
        setSuperscript(false);
      }
    },
    [markDirty],
  );

  // ===========================================================================
  // Render
  // ===========================================================================

  const fontStyleValue = getFontStyleValue(draftFormat.bold, draftFormat.italic);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Font Family */}
      <div className="flex flex-col gap-1">
        <Label htmlFor="font-family">Font</Label>
        <Select
          id="font-family"
          value={draftFormat.fontFamily}
          placeholder=" "
          onChange={handleFontFamilyChange}
          options={SYSTEM_FONTS.map((font) => ({ value: font, label: font }))}
          size="sm"
        />
      </div>

      {/* Font Style and Size Row */}
      <div className="flex gap-4">
        {/* Font Style */}
        <div className="flex flex-col gap-1 flex-1">
          <Label htmlFor="font-style">Font Style</Label>
          <Select
            id="font-style"
            value={fontStyleValue}
            placeholder=" "
            onChange={handleFontStyleChange}
            options={FONT_STYLES.map((s) => ({ value: s.value, label: s.label }))}
            size="sm"
          />
        </div>

        {/* Font Size */}
        <div className="flex flex-col gap-1 w-20">
          <Label htmlFor="font-size">Size</Label>
          <Select
            id="font-size"
            value={draftFormat.fontSize === undefined ? undefined : String(draftFormat.fontSize)}
            placeholder=" "
            onChange={handleFontSizeChange}
            options={FONT_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
            size="sm"
          />
        </div>
      </div>

      {/* Underline */}
      <div className="flex flex-col gap-1">
        <Label htmlFor="underline">Underline</Label>
        <Select
          id="underline"
          value={draftFormat.underlineType}
          placeholder=" "
          onChange={handleUnderlineChange}
          options={UNDERLINE_TYPES.map((u) => ({ value: u.value, label: u.label }))}
          size="sm"
        />
      </div>

      {/* Color */}
      <div className="flex flex-col gap-1">
        <SectionLabel>Color</SectionLabel>
        <ColorPicker
          value={draftFormat.fontColor}
          onChange={handleColorChange}
          theme={theme}
          recentColors={recentColors}
          onClose={() => {
            /* no-op */
          }}
        />
      </div>

      {/* Effects */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Effects</SectionLabel>
        <Checkbox
          checked={strikethrough}
          onChange={handleStrikethroughChange}
          label="Strikethrough"
        />
        <Checkbox checked={superscript} onChange={handleSuperscriptChange} label="Superscript" />
        <Checkbox checked={subscript} onChange={handleSubscriptChange} label="Subscript" />
      </div>

      {/* Preview */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Preview</SectionLabel>
        <div
          className="border border-ss-border rounded p-4 text-center bg-ss-surface"
          style={{
            fontFamily: draftFormat.fontFamily ?? 'Calibri',
            fontSize: `${draftFormat.fontSize ?? 11}px`,
            fontWeight: draftFormat.bold === true ? 'bold' : 'normal',
            fontStyle: draftFormat.italic === true ? 'italic' : 'normal',
            textDecoration: buildTextDecoration(draftFormat.underlineType, strikethrough),
            color: draftFormat.fontColor ?? '#000000',
            verticalAlign: superscript === true ? 'super' : subscript === true ? 'sub' : 'baseline',
          }}
        >
          AaBbCcYyZz
        </div>
      </div>
    </div>
  );
});
