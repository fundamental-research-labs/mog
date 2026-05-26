/**
 * TableStyleGallery Component
 *
 * Excel-like "Format as Table" gallery with:
 * - Custom styles section (user-created)
 * - Light, Medium, Dark style categories
 * - Visual mini-table preview of each style
 * - One-click style application
 * - Keyboard navigation
 * - "New Table Style" option
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DARK_STYLES,
  LIGHT_STYLES,
  MEDIUM_STYLES,
  type TableStyleColors,
} from '@mog/grid-renderer';
import type { TableStyleInfoWithReadOnly } from '@mog-sdk/contracts/api';
import type { TableStylePreset } from '@mog-sdk/contracts/tables';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useWorkbook } from '../../infra/context';
import { Button, SectionLabel } from '@mog/shell/components/ui';

/** Local type for custom table style config returned by workbook API. */
interface CustomTableStyleConfig {
  id: string;
  name: string;
  headerRow?: Record<string, any>;
  totalRow?: Record<string, any>;
  firstColumn?: Record<string, any>;
  lastColumn?: Record<string, any>;
  rowStripes?: Record<string, any>;
  columnStripes?: Record<string, any>;
  wholeTable?: Record<string, any>;
  [key: string]: unknown;
}

function toCustomTableStyleConfigs(
  styles: readonly TableStyleInfoWithReadOnly[],
): CustomTableStyleConfig[] {
  return styles
    .filter((style) => !style.readOnly)
    .map(
      (style) =>
        ({
          ...style,
          id: style.name,
          name: style.name,
        }) as CustomTableStyleConfig,
    );
}

// =============================================================================
// Types
// =============================================================================

interface StyleCategory {
  label: string;
  styles: Array<{ id: TableStylePreset; colors: TableStyleColors }>;
}

// =============================================================================
// Style Categories
// =============================================================================

const STYLE_CATEGORIES: StyleCategory[] = [
  {
    label: 'Light',
    styles: Object.entries(LIGHT_STYLES).map(([id, colors]) => ({
      id: id as TableStylePreset,
      colors,
    })),
  },
  {
    label: 'Medium',
    styles: Object.entries(MEDIUM_STYLES).map(([id, colors]) => ({
      id: id as TableStylePreset,
      colors,
    })),
  },
  {
    label: 'Dark',
    styles: Object.entries(DARK_STYLES).map(([id, colors]) => ({
      id: id as TableStylePreset,
      colors,
    })),
  },
];

// Build flat array for keyboard navigation
const ALL_STYLE_IDS = STYLE_CATEGORIES.flatMap((cat) => cat.styles.map((s) => s.id));

// =============================================================================
// TableStylePreview Component
// =============================================================================

interface TableStylePreviewProps {
  colors: TableStyleColors;
  isFocused: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onFocus: () => void;
  title: string;
  /** Stable per-style id rendered as `data-value` for the chrome-symmetry contract. */
  styleId: string;
}

/**
 * Mini table preview showing header + 2 data rows with alternating colors.
 */
function TableStylePreview({
  colors,
  isFocused,
  onClick,
  onMouseEnter,
  onFocus,
  title,
  styleId,
}: TableStylePreviewProps) {
  // 3x4 mini grid: 1 header row + 3 data rows, 4 columns
  const rows = [
    // Header row
    Array(4).fill(colors.headerBackground),
    // Data rows (alternating)
    Array(4).fill(colors.rowBackground1),
    Array(4).fill(colors.rowBackground2),
    Array(4).fill(colors.rowBackground1),
  ];

  return (
    <button
      type="button"
      data-value={styleId}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={`
 flex flex-col items-stretch justify-start
 w-[52px] h-[36px] p-0.5
 border border-ss-border rounded cursor-pointer
 transition-shadow duration-ss-fast outline-none
 overflow-hidden
 bg-ss-surface
 ${isFocused ? 'ring-2 ring-ss-primary z-ss-sticky' : 'hover:ring-2 hover:ring-ss-primary/50'}
 `}
      title={title}
      aria-label={`Apply ${title} table style`}
      tabIndex={isFocused ? 0 : -1}
    >
      <div className="flex flex-col w-full h-full">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex flex-1">
            {row.map((color, colIndex) => (
              <div
                key={colIndex}
                className="flex-1"
                style={{
                  backgroundColor: color,
                  borderBottom: rowIndex === 0 ? `1px solid ${colors.headerBorder}` : 'none',
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

interface TableStyleGalleryProps {
  /** Called when a built-in table style is selected */
  onSelectStyle: (styleId: TableStylePreset) => void;
  /** Called when the picker should close */
  onClose?: () => void;
  /** Optional: Called when a custom style is selected (for applying custom styles) */
  onSelectCustomStyle?: (styleId: string) => void;
}

export function TableStyleGallery({
  onSelectStyle,
  onClose,
  onSelectCustomStyle,
}: TableStyleGalleryProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const deps = useActionDependencies();
  const wb = useWorkbook();

  // Load custom table styles via Workbook API (async)
  const [customStyles, setCustomStyles] = useState<CustomTableStyleConfig[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const styles = await wb.tableStyles.list();
        if (!cancelled) {
          setCustomStyles(Array.isArray(styles) ? toCustomTableStyleConfigs(styles) : []);
        }
      } catch {
        // API not ready yet
        if (!cancelled) setCustomStyles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wb]);

  const handleStyleClick = useCallback(
    (styleId: TableStylePreset) => {
      onSelectStyle(styleId);
      onClose?.();
    },
    [onSelectStyle, onClose],
  );

  const handleCustomStyleClick = useCallback(
    (styleId: string) => {
      if (onSelectCustomStyle) {
        onSelectCustomStyle(styleId);
      } else {
        // Custom styles need the onSelectCustomStyle callback to be applied
        // For now, log a warning - custom style application requires additional wiring
        console.warn(
          '[TableStyleGallery] Custom style selected but no onSelectCustomStyle handler provided:',
          styleId,
        );
      }
      onClose?.();
    },
    [onSelectCustomStyle, onClose],
  );

  // Open the New Table Style dialog
  const handleNewTableStyle = useCallback(() => {
    dispatch('OPEN_CUSTOM_TABLE_STYLE_DIALOG', deps);
    onClose?.();
  }, [deps, onClose]);

  // Context menu actions for custom styles
  const handleModifyStyle = useCallback(
    (styleId: string) => {
      const style = customStyles.find((s) => s.id === styleId);
      if (style) {
        // The UIStore action will populate the dialog with style data
        const uiStore = deps.uiStore as {
          getState: () => {
            openModifyTableStyleDialog: (id: string, data: CustomTableStyleConfig) => void;
          };
        };
        if (uiStore) {
          uiStore.getState().openModifyTableStyleDialog(styleId, {
            ...style,
            headerRow: style.headerRow || {},
            totalRow: style.totalRow || {},
            firstColumn: style.firstColumn || {},
            lastColumn: style.lastColumn || {},
            rowStripes: style.rowStripes || { stripeSize: 1 },
            columnStripes: style.columnStripes || { stripeSize: 1 },
            wholeTable: style.wholeTable || {},
          });
        }
      }
      onClose?.();
    },
    [customStyles, deps, onClose],
  );

  const handleDuplicateStyle = useCallback(
    (styleId: string) => {
      dispatch('DUPLICATE_TABLE_STYLE', deps, { styleId });
      // Refresh custom styles list via Workbook API (async)
      void (async () => {
        try {
          const styles = await wb.tableStyles.list();
          setCustomStyles(Array.isArray(styles) ? toCustomTableStyleConfigs(styles) : []);
        } catch {
          // Ignore
        }
      })();
    },
    [wb, deps],
  );

  const handleDeleteStyle = useCallback(
    (styleId: string) => {
      dispatch('DELETE_CUSTOM_TABLE_STYLE', deps, { styleId });
      // Refresh custom styles list via Workbook API (async)
      void (async () => {
        try {
          const styles = await wb.tableStyles.list();
          setCustomStyles(Array.isArray(styles) ? toCustomTableStyleConfigs(styles) : []);
        } catch {
          // Ignore
        }
      })();
    },
    [wb, deps],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const cols = 7;
      const totalStyles = ALL_STYLE_IDS.length;

      if (focusedIndex === null) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          setFocusedIndex(0);
          e.preventDefault();
        }
        return;
      }

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
          setFocusedIndex(Math.min(focusedIndex + cols, totalStyles - 1));
          e.preventDefault();
          break;
        case 'ArrowUp':
          setFocusedIndex(Math.max(focusedIndex - cols, 0));
          e.preventDefault();
          break;
        case 'Enter':
        case ' ':
          handleStyleClick(ALL_STYLE_IDS[focusedIndex]);
          e.preventDefault();
          break;
        case 'Escape':
          onClose?.();
          e.preventDefault();
          break;
      }
    },
    [focusedIndex, handleStyleClick, onClose],
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
      aria-label="Table Styles Gallery"
    >
      {/* Custom Styles Section */}
      {customStyles.length > 0 && (
        <div className="mb-3">
          <SectionLabel className="uppercase tracking-wide">Custom</SectionLabel>
          <div className="grid grid-cols-7 gap-1">
            {customStyles.map((style) => (
              <CustomStylePreview
                key={style.id}
                style={style}
                onClick={() => handleCustomStyleClick(style.id)}
                onModify={() => handleModifyStyle(style.id)}
                onDuplicate={() => handleDuplicateStyle(style.id)}
                onDelete={() => handleDeleteStyle(style.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Built-in Style Categories */}
      {STYLE_CATEGORIES.map((category) => (
        <div key={category.label} className="mb-3">
          <SectionLabel className="uppercase tracking-wide">{category.label}</SectionLabel>
          <div className="grid grid-cols-7 gap-1">
            {category.styles.map((style) => {
              const currentIndex = globalIndex++;
              // Format display name: "Light 1", "Medium 2", etc.
              const displayName = style.id
                .replace(/([a-z])(\d+)/, '$1 $2')
                .replace(/^./, (c) => c.toUpperCase());

              return (
                <TableStylePreview
                  key={style.id}
                  styleId={style.id}
                  colors={style.colors}
                  isFocused={focusedIndex === currentIndex}
                  onClick={() => handleStyleClick(style.id)}
                  onMouseEnter={() => setFocusedIndex(currentIndex)}
                  onFocus={() => setFocusedIndex(currentIndex)}
                  title={displayName}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* New Table Style Button */}
      <div className="mt-3 pt-3 border-t border-ss-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewTableStyle}
          className="w-full justify-start text-body-sm"
        >
          + New Table Style...
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Custom Style Preview Component
// =============================================================================

interface CustomStylePreviewProps {
  style: CustomTableStyleConfig;
  onClick: () => void;
  onModify: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Preview for custom table styles with context menu support.
 */
function CustomStylePreview({
  style,
  onClick,
  onModify,
  onDuplicate,
  onDelete,
}: CustomStylePreviewProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (showContextMenu) {
      const handleClick = () => setShowContextMenu(false);
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [showContextMenu]);

  // Build preview colors from style
  const headerBg = style.headerRow?.fill || '#4472C4';
  const row1Bg = style.rowStripes?.stripe1Fill || '#ffffff';
  const row2Bg = style.rowStripes?.stripe2Fill || '#D9E2F3';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className="flex flex-col items-stretch justify-start w-[52px] h-[36px] p-0.5 border border-ss-border rounded cursor-pointer transition-shadow duration-ss-fast outline-none overflow-hidden bg-ss-surface hover:ring-2 hover:ring-ss-primary/50"
        title={style.name}
        aria-label={`Apply ${style.name} table style`}
      >
        <div className="flex flex-col w-full h-full">
          {/* Header row */}
          <div className="flex flex-1" style={{ backgroundColor: headerBg }} />
          {/* Data rows */}
          <div className="flex flex-1" style={{ backgroundColor: row1Bg }} />
          <div className="flex flex-1" style={{ backgroundColor: row2Bg }} />
          <div className="flex flex-1" style={{ backgroundColor: row1Bg }} />
        </div>
      </button>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          className="fixed bg-ss-surface border border-ss-border rounded shadow-ss-lg py-1 z-ss-popover min-w-[140px]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            onClick={() => {
              setShowContextMenu(false);
              onModify();
            }}
            className="w-full text-left px-3 py-1.5 text-body-sm hover:bg-ss-surface-hover"
          >
            Modify...
          </button>
          <button
            onClick={() => {
              setShowContextMenu(false);
              onDuplicate();
            }}
            className="w-full text-left px-3 py-1.5 text-body-sm hover:bg-ss-surface-hover"
          >
            Duplicate
          </button>
          <div className="border-t border-ss-border my-1" />
          <button
            onClick={() => {
              setShowContextMenu(false);
              onDelete();
            }}
            className="w-full text-left px-3 py-1.5 text-body-sm hover:bg-ss-surface-hover text-ss-error"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
