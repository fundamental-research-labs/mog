/**
 * FontPicker Component
 *
 * Enhanced font picker with:
 * - Extended font list with system fonts
 * - Recent fonts section (localStorage persisted)
 * - Font preview (each option rendered in its font)
 * - Search/filter functionality
 * - Keyboard navigation
 * - Theme fonts (+Headings, +Body) for Excel parity
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { useUIStore, useWorkbook } from '../../infra/context';
import {
  CJK_FONTS,
  EXTENDED_FONTS,
  MACOS_FONTS,
  MONOSPACE_FONTS,
  SCRIPT_FONTS,
  SYMBOL_FONTS,
  SYSTEM_FONTS,
  addRecentFont,
  getRecentFonts,
  isFontAvailable,
} from '../../infra/styles/fonts';
import { Input, SectionLabel } from '@mog/shell/components/ui';
import { FontPreviewTooltip } from './FontPreviewTooltip';
// =============================================================================
// Font Category Icons
// =============================================================================

/**
 * Get icon for a font based on its category.
 * Returns emoji icon to help users identify font types.
 */
function getFontCategoryIcon(font: string): string | null {
  // Monospace fonts (code/terminal)
  if (MONOSPACE_FONTS.includes(font as (typeof MONOSPACE_FONTS)[number])) {
    return '⌨'; // Keyboard icon for monospace
  }

  // Script/Handwriting fonts
  if (SCRIPT_FONTS.includes(font as (typeof SCRIPT_FONTS)[number])) {
    return '✍'; // Writing hand for script
  }

  // Symbol fonts
  if (SYMBOL_FONTS.includes(font as (typeof SYMBOL_FONTS)[number])) {
    return '☺'; // Smiley for symbols/wingdings
  }

  // CJK fonts
  if (CJK_FONTS.includes(font as (typeof CJK_FONTS)[number])) {
    return '文'; // Chinese character for CJK fonts
  }

  // No icon for system/extended/macOS fonts (too generic)
  return null;
}

/** Delay in ms before showing the font preview tooltip */
const PREVIEW_DELAY_MS = 200;

// =============================================================================
// FontItem Component
// =============================================================================

interface FontItemProps {
  font: string;
  isSelected: boolean;
  isFocused: boolean;
  isAvailable?: boolean;
  icon?: string | null;
  onClick: () => void;
  onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave: () => void;
  onFocus: () => void;
}

function FontItem({
  font,
  isSelected,
  isFocused,
  isAvailable = true,
  icon,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onFocus,
}: FontItemProps) {
  const baseClasses =
    'flex items-center w-full px-2 py-1.5 border-none rounded bg-transparent cursor-pointer text-dropdown text-ss-text text-left outline-none transition-colors duration-ss-fast my-px';
  const stateClasses = isSelected
    ? 'bg-ss-primary-light text-ss-primary'
    : isFocused
      ? 'bg-ss-primary-light outline outline-2 outline-ss-primary -outline-offset-2'
      : 'hover:bg-ss-surface-hover';

  // Build title with availability warning if needed
  const title = isAvailable ? font : `${font} (not installed)`;

  return (
    <button
      type="button"
      id={`font-item-${font}`}
      data-font-item
      data-value={font}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      className={`${baseClasses} ${stateClasses}`}
      style={{ fontFamily: `"${font}", sans-serif` }}
      title={title}
      aria-label={font}
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      role="option"
    >
      {/* Category icon */}
      {icon && <span className="mr-1.5 text-ss-text-tertiary text-body-sm">{icon}</span>}
      <span className={!isAvailable ? 'opacity-60' : ''}>{font}</span>
      {!isAvailable && (
        <span className="ml-1 text-ss-warning text-body-sm" title="Font not installed">
          ⚠
        </span>
      )}
      {isSelected && <span className="ml-auto text-ss-primary text-body-lg font-bold">✓</span>}
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * Theme font selection result.
 * When user selects +Headings or +Body, we return the fontTheme value
 * instead of a concrete font family.
 */
export type FontPickerResult =
  | { type: 'font'; fontFamily: string }
  | { type: 'theme'; fontTheme: 'major' | 'minor' };

export interface FontPickerProps {
  /** Currently selected font (concrete font family) */
  value?: string;
  /** Currently selected theme font ('major' = +Headings, 'minor' = +Body) */
  themeFontValue?: 'major' | 'minor';
  /** Current workbook theme (for resolving theme font names in display) */
  theme?: ThemeDefinition;
  /** Called when a font is selected (legacy callback for backward compatibility) */
  onChange: (fontFamily: string) => void;
  /**
   * Called when any font selection is made (theme font or concrete font).
   * When provided, this is called instead of onChange for theme font selections.
   */
  onSelect?: (result: FontPickerResult) => void;
  /** Called when the picker should close */
  onClose?: () => void;
}

export function FontPicker({
  value,
  themeFontValue,
  theme,
  onChange,
  onSelect,
  onClose,
}: FontPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [recentFonts, setRecentFonts] = useState<string[]>([]);
  const [searchResultsAnnouncement, setSearchResultsAnnouncement] = useState('');

  // Compute theme font display names
  const themeFonts = useMemo(() => {
    const majorFont = theme?.fonts.majorFont ?? 'Calibri Light';
    const minorFont = theme?.fonts.minorFont ?? 'Calibri';
    return {
      headings: { id: 'theme:major', display: `+Headings (${majorFont})`, font: majorFont },
      body: { id: 'theme:minor', display: `+Body (${minorFont})`, font: minorFont },
    };
  }, [theme]);

  // Font preview tooltip state (using local React state per architecture guidelines)
  const [hoveredFont, setHoveredFont] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Kernel notifications service for font warnings
  const wb = useWorkbook();

  // Font preview handlers
  // NOTE: Must select functions separately to avoid creating new object references
  // that would cause infinite render loops with useSyncExternalStore
  const setPreviewFont = useUIStore((s) => s.setPreviewFont);
  const clearPreviewFont = useUIStore((s) => s.clearPreviewFont);

  // Load recent fonts on mount
  useEffect(() => {
    setRecentFonts(getRecentFonts());
  }, []);

  // Cleanup preview timer on unmount
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  // Handle font item hover for preview
  const handleFontMouseEnter = useCallback(
    (font: string, event: React.MouseEvent<HTMLButtonElement>) => {
      // Clear any existing timer
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }

      // Get position from the event target
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setPreviewPosition({
        top: rect.top,
        left: rect.right,
      });
      setHoveredFont(font);

      // Start delay timer before showing preview
      previewTimerRef.current = setTimeout(() => {
        setShowPreview(true);
        // Apply preview font to selected cells
        setPreviewFont(font);
      }, PREVIEW_DELAY_MS);
    },
    [setPreviewFont],
  );

  // Handle font item mouse leave
  const handleFontMouseLeave = useCallback(() => {
    // Clear timer and hide preview
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setShowPreview(false);
    setHoveredFont(null);
    // Clear preview font from selected cells
    clearPreviewFont();
  }, [clearPreviewFont]);

  // Filter fonts by category based on search query
  const filteredFontsByCategory = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filter = (fonts: readonly string[]) =>
      query ? fonts.filter((font) => font.toLowerCase().includes(query)) : [...fonts];

    return {
      system: filter(SYSTEM_FONTS),
      extended: filter(EXTENDED_FONTS),
      script: filter(SCRIPT_FONTS),
      symbol: filter(SYMBOL_FONTS),
      monospace: filter(MONOSPACE_FONTS),
      macos: filter(MACOS_FONTS),
      cjk: filter(CJK_FONTS),
    };
  }, [searchQuery]);

  // Filter recent fonts based on search
  const filteredRecentFonts = useMemo(() => {
    if (!searchQuery.trim()) return recentFonts;
    const query = searchQuery.toLowerCase().trim();
    return recentFonts.filter((font) => font.toLowerCase().includes(query));
  }, [searchQuery, recentFonts]);

  // Filter theme fonts based on search
  const filteredThemeFonts = useMemo(() => {
    if (!searchQuery.trim()) return ['headings', 'body'] as const;
    const query = searchQuery.toLowerCase().trim();

    const results: Array<'headings' | 'body'> = [];
    // Match against both the display names and resolved font names
    if (
      'headings'.includes(query) ||
      '+headings'.includes(query) ||
      themeFonts.headings.font.toLowerCase().includes(query)
    ) {
      results.push('headings');
    }
    if (
      'body'.includes(query) ||
      '+body'.includes(query) ||
      themeFonts.body.font.toLowerCase().includes(query)
    ) {
      results.push('body');
    }
    return results;
  }, [searchQuery, themeFonts]);

  // Build flat list for keyboard navigation (theme fonts first, then recent, then all categories)
  const allVisibleFonts = useMemo(() => {
    const result: string[] = [];

    // Add theme fonts (using special IDs)
    for (const themeType of filteredThemeFonts) {
      result.push(`theme:${themeType}`);
    }

    // Add filtered recent fonts
    for (const font of filteredRecentFonts) {
      if (!result.includes(font)) {
        result.push(font);
      }
    }

    // Add fonts from all categories (excluding those already in recent)
    for (const categoryFonts of Object.values(filteredFontsByCategory)) {
      for (const font of categoryFonts) {
        if (!result.includes(font)) {
          result.push(font);
        }
      }
    }

    return result;
  }, [filteredThemeFonts, filteredRecentFonts, filteredFontsByCategory]);

  // Cache font availability checks for performance
  const fontAvailability = useMemo(() => {
    const cache = new Map<string, boolean>();
    // Check all fonts that might be displayed
    const allFontsToCheck = [...allVisibleFonts, themeFonts.headings.font, themeFonts.body.font];
    for (const font of allFontsToCheck) {
      if (!cache.has(font)) {
        cache.set(font, isFontAvailable(font));
      }
    }
    return cache;
  }, [allVisibleFonts, themeFonts]);

  // Handle theme font selection (+Headings, +Body)
  const handleThemeFontSelect = useCallback(
    (fontTheme: 'major' | 'minor') => {
      if (onSelect) {
        onSelect({ type: 'theme', fontTheme });
      }
      // Also call legacy onChange with the resolved font for backward compatibility
      const resolvedFont = fontTheme === 'major' ? themeFonts.headings.font : themeFonts.body.font;
      onChange(resolvedFont);
      onClose?.();
    },
    [onSelect, onChange, onClose, themeFonts],
  );

  const handleFontSelect = useCallback(
    (fontFamily: string) => {
      // Check if font is available, show warning if not
      const available = isFontAvailable(fontFamily);
      if (!available) {
        // Use kernel notifications service for font warning (if available)
        wb.notifications.warning(
          `"${fontFamily}" is not installed. Text will display in a fallback font.`,
        );
      }

      // Announce selection to screen readers
      setSearchResultsAnnouncement(
        `Selected ${fontFamily}${!available ? ' (font not installed)' : ''}`,
      );

      // Add to recent fonts
      addRecentFont(fontFamily);
      setRecentFonts(getRecentFonts());

      // Clear preview font before committing
      clearPreviewFont();

      // Notify parent via new API if available
      if (onSelect) {
        onSelect({ type: 'font', fontFamily });
      }

      // Notify parent via legacy callback
      onChange(fontFamily);
      onClose?.();
    },
    [onChange, onSelect, onClose, wb.notifications, clearPreviewFont],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const totalFonts = allVisibleFonts.length;
      if (totalFonts === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (focusedIndex === null) {
            setFocusedIndex(0);
          } else {
            setFocusedIndex(Math.min(focusedIndex + 1, totalFonts - 1));
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (focusedIndex === null) {
            setFocusedIndex(totalFonts - 1);
          } else {
            setFocusedIndex(Math.max(focusedIndex - 1, 0));
          }
          break;

        case 'Home':
          e.preventDefault();
          setFocusedIndex(0);
          break;

        case 'End':
          e.preventDefault();
          setFocusedIndex(totalFonts - 1);
          break;

        case 'Enter':
          e.preventDefault();
          if (focusedIndex !== null && allVisibleFonts[focusedIndex]) {
            const focusedItem = allVisibleFonts[focusedIndex];
            if (focusedItem.startsWith('theme:')) {
              const themeType = focusedItem.replace('theme:', '') as 'headings' | 'body';
              handleThemeFontSelect(themeType === 'headings' ? 'major' : 'minor');
            } else {
              handleFontSelect(focusedItem);
            }
          }
          break;

        case 'Escape':
          e.preventDefault();
          onClose?.();
          break;

        case 'Tab':
          // Allow tab to close picker naturally
          onClose?.();
          break;
      }
    },
    [focusedIndex, allVisibleFonts, handleFontSelect, onClose],
  );

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex !== null && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-font-item]');
      const focusedItem = items[focusedIndex] as HTMLElement | undefined;
      if (focusedItem && typeof focusedItem.scrollIntoView === 'function') {
        focusedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [focusedIndex]);

  // Focus search input on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Announce search results to screen readers
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResultsAnnouncement('');
      return;
    }

    const totalResults =
      filteredThemeFonts.length +
      filteredRecentFonts.length +
      Object.values(filteredFontsByCategory).reduce((sum, fonts) => sum + fonts.length, 0);

    if (totalResults === 0) {
      setSearchResultsAnnouncement(`No fonts found matching "${searchQuery}"`);
    } else if (totalResults === 1) {
      setSearchResultsAnnouncement('1 font found');
    } else {
      setSearchResultsAnnouncement(`${totalResults} fonts found`);
    }
  }, [searchQuery, filteredThemeFonts, filteredRecentFonts, filteredFontsByCategory]);

  // NOTE: Click-outside handling is now managed by the parent Popover/RibbonDropdownPanel.
  // This component is a pure content component and doesn't need its own dismiss logic.

  // Track current index for rendering
  let currentIndex = 0;

  const hasThemeFonts = filteredThemeFonts.length > 0;
  const hasRecentFonts = filteredRecentFonts.length > 0;
  const hasAnyFonts = Object.values(filteredFontsByCategory).some((fonts) => fonts.length > 0);
  const hasNoResults = !hasThemeFonts && !hasRecentFonts && !hasAnyFonts && searchQuery.trim();

  // Define category order and labels
  const categoryOrder: Array<keyof typeof filteredFontsByCategory> = [
    'system',
    'extended',
    'script',
    'symbol',
    'monospace',
    'macos',
    'cjk',
  ];

  const categoryLabels: Record<keyof typeof filteredFontsByCategory, string> = {
    system: 'System Fonts',
    extended: 'Extended Fonts',
    script: 'Script Fonts',
    symbol: 'Symbol Fonts',
    monospace: 'Monospace',
    macos: 'macOS Fonts',
    cjk: 'CJK Fonts',
  };

  return (
    <div
      className="w-[220px] max-h-[360px] flex flex-col bg-ss-surface rounded border border-ss-border shadow-ss-md overflow-hidden"
      onKeyDown={handleKeyDown}
      role="listbox"
      aria-label="Font picker"
      aria-activedescendant={
        focusedIndex !== null && allVisibleFonts[focusedIndex]
          ? `font-item-${allVisibleFonts[focusedIndex]}`
          : undefined
      }
    >
      {/* Screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {searchResultsAnnouncement}
      </div>

      {/* Search Input */}
      <div className="p-2 border-b border-ss-border">
        <Input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setFocusedIndex(null); // Reset focus on search change
          }}
          placeholder="Search fonts..."
          className="w-full !px-2 !py-1.5 text-dropdown"
          aria-label="Search fonts"
          aria-controls="font-list"
        />
      </div>

      {/* Font List */}
      <div id="font-list" ref={listRef} className="flex-1 overflow-y-auto py-1">
        {/* Theme Fonts Section (Excel-parity: +Headings, +Body) */}
        {hasThemeFonts && (
          <div className="px-2 mb-1">
            <SectionLabel className="uppercase tracking-wide text-ss-text-tertiary">
              Theme Fonts
            </SectionLabel>
            {filteredThemeFonts.map((themeType) => {
              const itemIndex = currentIndex++;
              const fontInfo = themeType === 'headings' ? themeFonts.headings : themeFonts.body;
              const isSelected = themeFontValue === (themeType === 'headings' ? 'major' : 'minor');

              return (
                <button
                  key={`theme-${themeType}`}
                  id={`font-item-theme:${themeType}`}
                  type="button"
                  data-font-item
                  data-value={themeType === 'headings' ? 'major' : 'minor'}
                  onClick={() =>
                    handleThemeFontSelect(themeType === 'headings' ? 'major' : 'minor')
                  }
                  onMouseEnter={(e) => {
                    setFocusedIndex(itemIndex);
                    handleFontMouseEnter(fontInfo.font, e);
                  }}
                  onMouseLeave={handleFontMouseLeave}
                  onFocus={() => setFocusedIndex(itemIndex)}
                  className={`flex items-center w-full px-2 py-1.5 border-none rounded bg-transparent cursor-pointer text-dropdown text-ss-text text-left outline-none transition-colors duration-ss-fast my-px ${
                    isSelected
                      ? 'bg-ss-primary-light text-ss-primary'
                      : focusedIndex === itemIndex
                        ? 'bg-ss-primary-light outline outline-2 outline-ss-primary -outline-offset-2'
                        : 'hover:bg-ss-surface-hover'
                  }`}
                  style={{ fontFamily: `"${fontInfo.font}", sans-serif` }}
                  title={fontInfo.display}
                  aria-label={`Select ${fontInfo.display}`}
                  aria-selected={isSelected}
                  tabIndex={focusedIndex === itemIndex ? 0 : -1}
                  role="option"
                >
                  {fontInfo.display}
                  {isSelected && (
                    <span className="ml-auto text-ss-primary text-body-lg font-bold">✓</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Recent Fonts Section */}
        {hasRecentFonts && (
          <div className="px-2 mb-1">
            <SectionLabel className="uppercase tracking-wide text-ss-text-tertiary">
              Recent
            </SectionLabel>
            {filteredRecentFonts.map((font) => {
              const itemIndex = currentIndex++;
              return (
                <FontItem
                  key={`recent-${font}`}
                  font={font}
                  isSelected={value === font}
                  isFocused={focusedIndex === itemIndex}
                  isAvailable={fontAvailability.get(font) ?? true}
                  icon={getFontCategoryIcon(font)}
                  onClick={() => handleFontSelect(font)}
                  onMouseEnter={(e) => {
                    setFocusedIndex(itemIndex);
                    handleFontMouseEnter(font, e);
                  }}
                  onMouseLeave={handleFontMouseLeave}
                  onFocus={() => setFocusedIndex(itemIndex)}
                />
              );
            })}
          </div>
        )}

        {/* Font Categories */}
        {categoryOrder.map((category, idx) => {
          const categoryFonts = filteredFontsByCategory[category];
          // Filter out fonts already shown in recent
          const fontsToShow = categoryFonts.filter((font) => !filteredRecentFonts.includes(font));

          if (fontsToShow.length === 0) return null;

          // Add divider before first category if theme fonts or recent fonts exist
          const needsDivider = idx === 0 && (hasThemeFonts || hasRecentFonts);

          return (
            <div key={category}>
              {needsDivider && <div className="h-px bg-ss-surface-tertiary mx-2 my-1" />}
              <div className="px-2">
                <SectionLabel className="uppercase tracking-wide text-ss-text-tertiary">
                  {categoryLabels[category]}
                </SectionLabel>
                {fontsToShow.map((font) => {
                  const itemIndex = currentIndex++;
                  return (
                    <FontItem
                      key={font}
                      font={font}
                      isSelected={value === font}
                      isFocused={focusedIndex === itemIndex}
                      isAvailable={fontAvailability.get(font) ?? true}
                      icon={getFontCategoryIcon(font)}
                      onClick={() => handleFontSelect(font)}
                      onMouseEnter={(e) => {
                        setFocusedIndex(itemIndex);
                        handleFontMouseEnter(font, e);
                      }}
                      onMouseLeave={handleFontMouseLeave}
                      onFocus={() => setFocusedIndex(itemIndex)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* No Results Message */}
        {hasNoResults && (
          <div className="p-4 text-center text-ss-text-secondary text-body-sm">
            No fonts matching "{searchQuery}"
          </div>
        )}
      </div>

      {/* Font Preview Tooltip */}
      {hoveredFont && (
        <FontPreviewTooltip
          fontFamily={hoveredFont}
          position={previewPosition}
          visible={showPreview}
        />
      )}
    </div>
  );
}
