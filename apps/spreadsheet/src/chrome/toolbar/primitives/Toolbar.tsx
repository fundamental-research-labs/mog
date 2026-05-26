/**
 * Toolbar Component
 *
 * Provides formatting controls for the selected cell(s).
 * Implements ToolbarProps contract from contracts/index.ts
 *
 * All icons are sourced from @mog/icons via ToolbarIcons.tsx -
 * the single source of truth for icon components.
 */

import { useCallback, useState } from 'react';

import type { ChartType } from '@mog/charts';

import { ChartToolbar } from '../../../components/charts/ChartToolbar';
import { ColorPicker } from '../../../components/pickers/ColorPicker';
import type { ToolbarProps } from '../../../internal-api';
import { RibbonDropdownPanel } from './RibbonDropdown';
import {
  AlignBottomIcon,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignMiddleIcon,
  AlignRightIcon,
  AlignTopIcon,
  BoldIcon,
  ConditionalFormatIcon,
  DownloadIcon,
  DropdownArrowIcon,
  FillColorIcon,
  FontColorIcon,
  ItalicIcon,
  PivotTableIcon,
  RedoIcon,
  SpinnerIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UndoIcon,
  WordWrapIcon,
} from './ToolbarIcons';

// =============================================================================
// Font Constants
// =============================================================================

const FONT_FAMILIES = [
  'Arial',
  'Calibri',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'Comic Sans MS',
  'Impact',
  'Trebuchet MS',
  'Palatino Linotype',
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const DEFAULT_FONT_FAMILY = 'Arial';
const DEFAULT_FONT_SIZE = 11;

// =============================================================================
// Component
// =============================================================================

interface ExtendedToolbarProps extends ToolbarProps {
  /** Called when insert chart is selected (with optional subType and config) */
  onInsertChart?: (type: ChartType, subType?: string, config?: Record<string, unknown>) => void;
  /** Whether chart insertion is disabled (no selection) */
  chartDisabled?: boolean;
  /** Called when pivot table button is clicked */
  onPivotTable?: () => void;
}

export function Toolbar({
  isBold,
  isItalic,
  isUnderline,
  isStrikethrough,
  textAlign,
  verticalAlign,
  wordWrap,
  numberFormat,
  fontFamily,
  fontSize,
  fontColor,
  backgroundColor,
  onBoldClick,
  onItalicClick,
  onUnderlineClick,
  onStrikethroughClick,
  onTextAlignChange,
  onVerticalAlignChange,
  onWordWrapClick,
  onNumberFormatChange,
  onFontFamilyChange,
  onFontSizeChange,
  onFontColorChange,
  onBackgroundColorChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExport,
  isExporting = false,
  onConditionalFormat,
  onPivotTable,
  onInsertChart,
  chartDisabled = false,
}: ExtendedToolbarProps) {
  // Color picker dropdown state
  const [fontColorOpen, setFontColorOpen] = useState(false);
  const [bgColorOpen, setBgColorOpen] = useState(false);

  const handleFormatChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onNumberFormatChange(e.target.value);
    },
    [onNumberFormatChange],
  );

  const handleFontFamilyChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onFontFamilyChange?.(e.target.value);
    },
    [onFontFamilyChange],
  );

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const size = parseInt(e.target.value, 10);
      if (!isNaN(size)) {
        onFontSizeChange?.(size);
      }
    },
    [onFontSizeChange],
  );

  return (
    <div className="flex items-center h-9 px-2 bg-ss-surface-secondary gap-1">
      {/* Undo/Redo */}
      <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <RedoIcon />
        </button>
      </div>

      <div className="w-px h-5 bg-ss-surface-tertiary mx-2" />

      {/* Font Family & Size */}
      {onFontFamilyChange && (
        <select
          value={fontFamily ?? DEFAULT_FONT_FAMILY}
          onChange={handleFontFamilyChange}
          className="h-7 px-2 border border-transparent rounded bg-transparent text-ribbon text-ss-text-secondary cursor-pointer outline-none min-w-[100px] max-w-[140px]"
          style={{ fontFamily: fontFamily ?? DEFAULT_FONT_FAMILY }}
          title="Font family"
          aria-label="Font family"
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </select>
      )}

      {onFontSizeChange && (
        <select
          value={fontSize ?? DEFAULT_FONT_SIZE}
          onChange={handleFontSizeChange}
          className="h-7 px-1 border border-transparent rounded bg-transparent text-ribbon text-ss-text-secondary cursor-pointer outline-none w-[52px] text-center"
          title="Font size"
          aria-label="Font size"
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      )}

      <div className="w-px h-5 bg-ss-surface-tertiary mx-2" />

      {/* Font Formatting */}
      <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
        <button
          type="button"
          onClick={onBoldClick}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Bold (Ctrl+B)"
          aria-label="Bold"
          aria-pressed={isBold}
        >
          <BoldIcon />
        </button>
        <button
          type="button"
          onClick={onItalicClick}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Italic (Ctrl+I)"
          aria-label="Italic"
          aria-pressed={isItalic}
        >
          <ItalicIcon />
        </button>
        <button
          type="button"
          onClick={onUnderlineClick}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Underline (Ctrl+U)"
          aria-label="Underline"
          aria-pressed={isUnderline}
        >
          <UnderlineIcon />
        </button>
        <button
          type="button"
          onClick={onStrikethroughClick}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Strikethrough (Ctrl+5)"
          aria-label="Strikethrough"
          aria-pressed={isStrikethrough}
        >
          <StrikethroughIcon />
        </button>

        {/* Font Color */}
        {onFontColorChange && (
          <div className="relative inline-flex">
            <button
              type="button"
              onClick={() => setFontColorOpen(!fontColorOpen)}
              className="flex items-center justify-center h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary px-0.5 pl-1.5 gap-[var(--ribbon-button-icon-gap)]"
              title="Font color"
              aria-label="Font color"
              aria-expanded={fontColorOpen}
              aria-pressed={fontColorOpen}
            >
              <FontColorIcon color={fontColor} />
              <DropdownArrowIcon />
            </button>
            <RibbonDropdownPanel open={fontColorOpen} onClose={() => setFontColorOpen(false)}>
              <ColorPicker
                value={fontColor}
                onChange={(color) => {
                  if (color !== null) {
                    onFontColorChange(color);
                  }
                  setFontColorOpen(false);
                }}
                onClose={() => setFontColorOpen(false)}
                showNoColor={true}
                noColorLabel="Automatic"
              />
            </RibbonDropdownPanel>
          </div>
        )}

        {/* Background Color */}
        {onBackgroundColorChange && (
          <div className="relative inline-flex">
            <button
              type="button"
              onClick={() => setBgColorOpen(!bgColorOpen)}
              className="flex items-center justify-center h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary px-0.5 pl-1.5 gap-[var(--ribbon-button-icon-gap)]"
              title="Fill color"
              aria-label="Fill color"
              aria-expanded={bgColorOpen}
              aria-pressed={bgColorOpen}
            >
              <FillColorIcon color={backgroundColor} />
              <DropdownArrowIcon />
            </button>
            <RibbonDropdownPanel open={bgColorOpen} onClose={() => setBgColorOpen(false)}>
              <ColorPicker
                value={backgroundColor}
                onChange={(color) => {
                  if (color !== null) {
                    onBackgroundColorChange(color);
                  }
                  setBgColorOpen(false);
                }}
                onClose={() => setBgColorOpen(false)}
                showNoColor={true}
                noColorLabel="No Fill"
              />
            </RibbonDropdownPanel>
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-ss-surface-tertiary mx-2" />

      {/* Text Alignment */}
      <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
        <button
          type="button"
          onClick={() => onTextAlignChange('left')}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Align left"
          aria-label="Align left"
          aria-pressed={textAlign === 'left'}
        >
          <AlignLeftIcon />
        </button>
        <button
          type="button"
          onClick={() => onTextAlignChange('center')}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Align center"
          aria-label="Align center"
          aria-pressed={textAlign === 'center'}
        >
          <AlignCenterIcon />
        </button>
        <button
          type="button"
          onClick={() => onTextAlignChange('right')}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Align right"
          aria-label="Align right"
          aria-pressed={textAlign === 'right'}
        >
          <AlignRightIcon />
        </button>
      </div>

      {/* Vertical Alignment */}
      <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
        <button
          type="button"
          onClick={() => onVerticalAlignChange('top')}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Align top"
          aria-label="Align top"
          aria-pressed={verticalAlign === 'top'}
        >
          <AlignTopIcon />
        </button>
        <button
          type="button"
          onClick={() => onVerticalAlignChange('middle')}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Align middle"
          aria-label="Align middle"
          aria-pressed={verticalAlign === 'middle'}
        >
          <AlignMiddleIcon />
        </button>
        <button
          type="button"
          onClick={() => onVerticalAlignChange('bottom')}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Align bottom"
          aria-label="Align bottom"
          aria-pressed={verticalAlign === 'bottom'}
        >
          <AlignBottomIcon />
        </button>
        <button
          type="button"
          onClick={onWordWrapClick}
          className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover aria-pressed:bg-ss-primary-light aria-pressed:text-ss-primary"
          title="Word wrap"
          aria-label="Word wrap"
          aria-pressed={wordWrap}
        >
          <WordWrapIcon />
        </button>
      </div>

      <div className="w-px h-5 bg-ss-surface-tertiary mx-2" />

      {/* Number Format */}
      <select
        value={numberFormat}
        onChange={handleFormatChange}
        className="h-7 px-2 border border-transparent rounded bg-transparent text-ribbon text-ss-text-secondary cursor-pointer outline-none"
        title="Number format"
        aria-label="Number format"
      >
        <option value="General">General</option>
        <option value="Number">Number</option>
        <option value="Currency">Currency</option>
        <option value="Percent">Percent</option>
        <option value="Date">Date</option>
        <option value="Time">Time</option>
        <option value="Text">Text</option>
      </select>

      {/* Conditional Formatting Button */}
      {onConditionalFormat && (
        <>
          <div className="w-px h-5 bg-ss-surface-tertiary mx-2" />
          <button
            type="button"
            onClick={onConditionalFormat}
            className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover"
            title="Conditional Formatting"
            aria-label="Conditional Formatting"
          >
            <ConditionalFormatIcon />
          </button>
        </>
      )}

      {/* Pivot Table Button */}
      {onPivotTable && (
        <>
          <div className="w-px h-5 bg-ss-surface-tertiary mx-2" />
          <button
            type="button"
            onClick={onPivotTable}
            className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover"
            title="Insert Pivot Table (Alt+D P)"
            aria-label="Insert Pivot Table"
          >
            <PivotTableIcon />
          </button>
        </>
      )}

      {/* Chart Button */}
      {onInsertChart && (
        <>
          <div className="w-px h-5 bg-ss-surface-tertiary mx-2" />
          <ChartToolbar disabled={chartDisabled} onInsertChart={onInsertChart} />
        </>
      )}

      {/* Export Button */}
      {onExport && (
        <>
          <div className="w-px h-5 bg-ss-surface-tertiary mx-2" />
          <button
            type="button"
            onClick={onExport}
            disabled={isExporting}
            className="flex items-center justify-center w-7 h-7 border-none rounded bg-transparent cursor-pointer text-ss-text-secondary text-ribbon font-normal transition-colors hover:bg-ss-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
            title="Export to XLSX (Ctrl+Shift+S)"
            aria-label="Export to XLSX"
          >
            {isExporting ? <SpinnerIcon /> : <DownloadIcon />}
          </button>
        </>
      )}
    </div>
  );
}
