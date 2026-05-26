/**
 * StyleGallery Component
 *
 * Excel-like Cell Styles gallery with:
 * - Built-in styles grouped by category
 * - One-click style application
 * - Visual preview of each style
 * - Keyboard navigation
 * - Themed Cell Styles in 6-column grid (one column per accent, like Excel)
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CellStyleCatalog } from '@mog-sdk/contracts/api';
import type { CellStyle } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { resolveThemeColors } from '@mog/spreadsheet-utils/formatting/theme';
import { OFFICE_THEME } from '../../infra/styles/built-in-themes';
import { SectionLabel } from '@mog/shell/components/ui';
import { useWorkbook } from '../../internal-api';

// =============================================================================
// Constants
// =============================================================================

/** Number of accent colors in Excel themes */
const ACCENT_COUNT = 6;
/** Number of tint levels per accent (base + 20% + 40% + 60%) */
const TINT_LEVELS = 4;

const EMPTY_STYLE_CATALOG: CellStyleCatalog = {
  categories: [],
  styles: [],
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Transpose themed styles from row-major (Accent1, 20%-A1, 40%-A1, 60%-A1, Accent2, ...)
 * to column-major (Accent1, Accent2, ..., 20%-A1, 20%-A2, ...) for Excel-like display.
 *
 * Excel displays themed styles as a 6-column grid where each column is an accent color:
 * | Accent1 | Accent2 | Accent3 | Accent4 | Accent5 | Accent6 |
 * | 20%-A1 | 20%-A2 | 20%-A3 | 20%-A4 | 20%-A5 | 20%-A6 |
 * | 40%-A1 | 40%-A2 | 40%-A3 | 40%-A4 | 40%-A5 | 40%-A6 |
 * | 60%-A1 | 60%-A2 | 60%-A3 | 60%-A4 | 60%-A5 | 60%-A6 |
 */
function transposeThemedStyles(styles: readonly CellStyle[]): CellStyle[] {
  if (styles.length !== ACCENT_COUNT * TINT_LEVELS) {
    // Fallback: return as-is if not the expected 24 themed styles
    return [...styles];
  }

  const result: CellStyle[] = [];
  // For each tint level (row in output)
  for (let tint = 0; tint < TINT_LEVELS; tint++) {
    // For each accent (column in output)
    for (let accent = 0; accent < ACCENT_COUNT; accent++) {
      // Original index: accent * TINT_LEVELS + tint
      result.push(styles[accent * TINT_LEVELS + tint]);
    }
  }
  return result;
}

/**
 * Get shortened display name for themed styles.
 * "Accent1" → "Accent1", "20% - Accent1" → "20%"
 * The accent number is redundant since each column is already an accent.
 */
function getThemedStyleDisplayName(name: string): string {
  // Match patterns like "20% - Accent1", "40% - Accent2", etc.
  const match = name.match(/^(\d+%)\s*-\s*Accent\d+$/);
  if (match) {
    return match[1]; // Return just "20%", "40%", "60%"
  }
  // For base accents like "Accent1", keep as-is (short enough)
  return name;
}

/**
 * Get inline style for a cell style preview.
 */
function getStylePreviewCSS(format: CellStyle['format']): React.CSSProperties {
  return {
    backgroundColor: format.backgroundColor || 'transparent',
    color: format.fontColor || '#202124',
    fontWeight: format.bold ? 'bold' : 'normal',
    fontStyle: format.italic ? 'italic' : 'normal',
    textDecoration:
      format.underlineType && format.underlineType !== 'none'
        ? 'underline'
        : format.strikethrough
          ? 'line-through'
          : 'none',
    fontSize: format.fontSize ? `${Math.min(format.fontSize, 12)}px` : '11px',
  };
}

function useBuiltInCellStyleCatalog(): CellStyleCatalog {
  const wb = useWorkbook();
  const [catalog, setCatalog] = useState<CellStyleCatalog>(EMPTY_STYLE_CATALOG);

  useEffect(() => {
    let cancelled = false;
    void wb.cellStyles
      .getCatalog({ source: 'builtIn' })
      .then((nextCatalog) => {
        if (!cancelled) {
          setCatalog(nextCatalog);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('Failed to load built-in cell style catalog', error);
          setCatalog(EMPTY_STYLE_CATALOG);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [wb]);

  return catalog;
}

// =============================================================================
// StyleButton Component
// =============================================================================

interface StyleButtonProps {
  style: CellStyle;
  isFocused: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onFocus: () => void;
  /** Theme for resolving theme color references */
  theme: ThemeDefinition;
  /** Shortened display name (e.g., "20%" instead of "20% - Accent1") */
  displayName?: string;
}

function StyleButton({
  style,
  isFocused,
  onClick,
  onMouseEnter,
  onFocus,
  theme,
  displayName,
}: StyleButtonProps) {
  // Resolve theme color references (e.g., 'theme:accent1') to actual hex colors
  const resolvedFormat = resolveThemeColors(style.format, theme) ?? style.format;
  const previewStyle = getStylePreviewCSS(resolvedFormat);
  const isNumberFormat = style.category === 'number-format';
  const label = displayName ?? style.name;

  return (
    <button
      type="button"
      data-value={style.id}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={`
 flex items-center justify-center px-2 py-1.5 border border-ss-border rounded cursor-pointer
 text-hint font-normal min-h-7 transition-shadow duration-ss-fast outline-none
 overflow-hidden text-ellipsis whitespace-nowrap
 ${isNumberFormat ? 'bg-ss-surface-secondary' : 'bg-ss-surface'}
 ${isFocused ? 'ring-2 ring-ss-primary z-ss-sticky' : 'hover:ring-2 hover:ring-ss-primary/50'}
 `}
      style={previewStyle}
      title={style.name}
      aria-label={`Apply ${style.name} style`}
      tabIndex={isFocused ? 0 : -1}
    >
      {label}
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export interface StyleGalleryProps {
  /** Called when a style is selected */
  onSelectStyle: (styleId: string) => void;
  /** Called when the picker should close */
  onClose?: () => void;
  /** Called when "New Cell Style..." is clicked */
  onNewStyle?: () => void;
  /**
   * Active workbook theme for resolving theme color references.
   * If not provided, defaults to Office theme.
   */
  theme?: ThemeDefinition;
}

export function StyleGallery({
  onSelectStyle,
  onClose,
  onNewStyle,
  theme = OFFICE_THEME,
}: StyleGalleryProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const styleCatalog = useBuiltInCellStyleCatalog();

  const stylesByCategory = useMemo(() => {
    const byCategory = new Map<CellStyle['category'], CellStyle[]>();
    for (const style of styleCatalog.styles) {
      const categoryStyles = byCategory.get(style.category);
      if (categoryStyles) {
        categoryStyles.push(style);
      } else {
        byCategory.set(style.category, [style]);
      }
    }
    return byCategory;
  }, [styleCatalog.styles]);

  // Categories to display (exclude 'custom' - will be separate section if we add it)
  const displayCategories = useMemo(
    () => styleCatalog.categories.filter((category) => category.id !== 'custom'),
    [styleCatalog.categories],
  );

  // Build flat array of styles with themed styles transposed for correct display order
  const allDisplayStyles = useMemo(() => {
    const result: CellStyle[] = [];
    for (const category of displayCategories) {
      const categoryStyles = stylesByCategory.get(category.id) ?? [];
      if (category.id === 'themed') {
        // Transpose themed styles so accents are columns
        result.push(...transposeThemedStyles(categoryStyles));
      } else {
        result.push(...categoryStyles);
      }
    }
    return result;
  }, [displayCategories, stylesByCategory]);

  const allStyleIds = useMemo(() => allDisplayStyles.map((s) => s.id), [allDisplayStyles]);

  const handleStyleClick = useCallback(
    (styleId: string) => {
      onSelectStyle(styleId);
      onClose?.();
    },
    [onSelectStyle, onClose],
  );

  // Keyboard navigation needs to account for variable column counts per section
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const totalStyles = allStyleIds.length;
      if (totalStyles === 0) {
        if (e.key === 'Escape') {
          onClose?.();
          e.preventDefault();
        }
        return;
      }

      if (focusedIndex === null) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          setFocusedIndex(0);
          e.preventDefault();
        }
        return;
      }

      // Determine which section and column count for current index
      // For simplicity, use linear navigation (left/right moves one, up/down attempts to stay in column)
      // This is acceptable since keyboard nav is secondary to mouse in this gallery
      switch (e.key) {
        case 'ArrowRight':
          setFocusedIndex((focusedIndex + 1) % totalStyles);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          setFocusedIndex((focusedIndex - 1 + totalStyles) % totalStyles);
          e.preventDefault();
          break;
        case 'ArrowDown':
          // Move down by estimating column count (6 for themed section is most items)
          setFocusedIndex(Math.min(focusedIndex + ACCENT_COUNT, totalStyles - 1));
          e.preventDefault();
          break;
        case 'ArrowUp':
          setFocusedIndex(Math.max(focusedIndex - ACCENT_COUNT, 0));
          e.preventDefault();
          break;
        case 'Enter':
        case ' ':
          handleStyleClick(allStyleIds[focusedIndex]);
          e.preventDefault();
          break;
        case 'Escape':
          onClose?.();
          e.preventDefault();
          break;
      }
    },
    [focusedIndex, allStyleIds, handleStyleClick, onClose],
  );

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Track global index for keyboard navigation
  let globalIndex = 0;

  return (
    <div
      ref={containerRef}
      className="w-[420px] max-h-[400px] overflow-auto p-2 bg-ss-surface rounded border border-ss-border shadow-ss-md"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Cell Styles Gallery"
    >
      {/* Normal style button - clears all formatting */}
      <div className="mb-3">
        <button
          type="button"
          data-value="normal"
          onClick={() => handleStyleClick('normal')}
          className={`
 flex items-center justify-center px-2 py-1.5 border border-ss-border rounded cursor-pointer
 text-hint font-normal min-h-7 transition-shadow duration-ss-fast outline-none
 bg-ss-surface hover:ring-2 hover:ring-ss-primary/50 w-full
 `}
          title="Clear all formatting and reset to default style"
          aria-label="Apply Normal style (clear formatting)"
        >
          Normal
        </button>
      </div>

      {displayCategories.map((category) => {
        const rawStyles = stylesByCategory.get(category.id) ?? [];
        if (rawStyles.length === 0) return null;

        // Themed styles: 6 columns, transposed. Others: 3 columns.
        const isThemed = category.id === 'themed';
        const categoryStyles = isThemed ? transposeThemedStyles(rawStyles) : rawStyles;
        const gridCols = isThemed ? 'grid-cols-6' : 'grid-cols-3';

        return (
          <div key={category.id} className="mb-3">
            <SectionLabel className="uppercase tracking-wide">{category.label}</SectionLabel>
            <div className={`grid ${gridCols} gap-1`}>
              {categoryStyles.map((style) => {
                const currentIndex = globalIndex++;
                return (
                  <StyleButton
                    key={style.id}
                    style={style}
                    isFocused={focusedIndex === currentIndex}
                    onClick={() => handleStyleClick(style.id)}
                    onMouseEnter={() => setFocusedIndex(currentIndex)}
                    onFocus={() => setFocusedIndex(currentIndex)}
                    theme={theme}
                    displayName={isThemed ? getThemedStyleDisplayName(style.name) : undefined}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* New Cell Style option */}
      {onNewStyle && (
        <div className="mt-2 pt-2 border-t border-ss-border">
          <button
            type="button"
            onClick={() => {
              onNewStyle();
              onClose?.();
            }}
            className="w-full text-left px-2 py-2 text-dropdown text-ss-primary bg-transparent border-none cursor-pointer hover:bg-ss-surface-hover rounded"
          >
            New Cell Style...
          </button>
        </div>
      )}
    </div>
  );
}
