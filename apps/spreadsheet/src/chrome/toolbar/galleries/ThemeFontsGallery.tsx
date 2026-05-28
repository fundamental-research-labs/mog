/**
 * ThemeFontsGallery Component
 *
 * Displays a gallery of font theme pairs for selection.
 * Allows selecting font pair independently from the color theme.
 *
 * Architecture:
 * - Uses BUILT_IN_FONT_THEMES array from built-in-themes.ts
 * - Uses useWorkbookSettings for current font theme and setting
 * - Shows font preview in the actual font
 */

import { useCallback, useMemo, useState } from 'react';

import type { FontThemeDefinition } from '@mog-sdk/contracts/theme';
import { useWorkbookSettings } from '../../../hooks/settings/use-workbook-settings';
import {
  BUILT_IN_FONT_THEMES,
  getBuiltInFontTheme,
  getBuiltInTheme,
  OFFICE_FONT_THEME,
} from '../../../infra/styles/built-in-themes';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdown, RibbonDropdownDivider } from '../primitives/RibbonDropdown';
import { ThemeFontsIcon } from '../primitives/ToolbarIcons';

// =============================================================================
// Types
// =============================================================================

export interface ThemeFontsGalleryProps {
  className?: string;
}

// =============================================================================
// FontThemePreview - Shows a font theme's fonts
// =============================================================================

interface FontThemePreviewProps {
  fontTheme: FontThemeDefinition;
  isSelected: boolean;
  onClick: () => void;
}

function FontThemePreview({ fontTheme, isSelected, onClick }: FontThemePreviewProps) {
  return (
    <button
      type="button"
      data-value={fontTheme.id}
      onClick={onClick}
      className={`
 flex flex-col items-start w-full p-2 rounded border transition-all text-left
 hover:bg-ss-surface-hover
 ${isSelected ? 'border-ss-primary bg-ss-primary/5' : 'border-transparent'}
 `}
      title={`${fontTheme.name}: ${fontTheme.fonts.majorFont} / ${fontTheme.fonts.minorFont}`}
    >
      {/* Theme name with heading font */}
      <span
        className="text-body font-medium text-text truncate w-full"
        style={{ fontFamily: fontTheme.fonts.majorFont }}
      >
        {fontTheme.name}
      </span>
      {/* Font pair info with body font */}
      <span
        className="text-caption text-ss-text-secondary truncate w-full"
        style={{ fontFamily: fontTheme.fonts.minorFont }}
      >
        {fontTheme.fonts.majorFont === fontTheme.fonts.minorFont
          ? fontTheme.fonts.minorFont
          : `${fontTheme.fonts.majorFont} / ${fontTheme.fonts.minorFont}`}
      </span>
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function ThemeFontsGallery({ className = '' }: ThemeFontsGalleryProps) {
  const { settings, setSetting } = useWorkbookSettings();
  const [isOpen, setIsOpen] = useState(false);

  // Get current font theme (either from override or from the theme itself)
  const currentFontTheme = useMemo(() => {
    // If there's an explicit font theme override, use it
    if (settings.themeFontsId) {
      return getBuiltInFontTheme(settings.themeFontsId) ?? OFFICE_FONT_THEME;
    }
    // Otherwise, derive from the current theme
    const theme = getBuiltInTheme(settings.themeId);
    if (theme) {
      // Find a matching font theme or create a virtual one
      const matchingFontTheme = BUILT_IN_FONT_THEMES.find(
        (ft) =>
          ft.fonts.majorFont === theme.fonts.majorFont &&
          ft.fonts.minorFont === theme.fonts.minorFont,
      );
      if (matchingFontTheme) {
        return matchingFontTheme;
      }
      // No exact match, use theme's fonts as a virtual font theme
      return {
        id: 'from-theme',
        name: theme.name,
        builtIn: false,
        fonts: theme.fonts,
      } as FontThemeDefinition;
    }
    return OFFICE_FONT_THEME;
  }, [settings.themeFontsId, settings.themeId]);

  // Handle font theme selection
  const handleSelectFontTheme = useCallback(
    (fontThemeId: string) => {
      // If selecting a font theme that matches the current theme's fonts,
      // clear the override
      const theme = getBuiltInTheme(settings.themeId);
      const fontTheme = getBuiltInFontTheme(fontThemeId);
      if (
        theme &&
        fontTheme &&
        theme.fonts.majorFont === fontTheme.fonts.majorFont &&
        theme.fonts.minorFont === fontTheme.fonts.minorFont
      ) {
        setSetting('themeFontsId', undefined);
      } else {
        setSetting('themeFontsId', fontThemeId);
      }
      setIsOpen(false);
    },
    [setSetting, settings.themeId],
  );

  // Determine which font theme ID is selected
  const selectedFontThemeId = useMemo(() => {
    if (settings.themeFontsId) {
      return settings.themeFontsId;
    }
    // Check if current theme's fonts match any built-in font theme
    const theme = getBuiltInTheme(settings.themeId);
    if (theme) {
      const matchingFontTheme = BUILT_IN_FONT_THEMES.find(
        (ft) =>
          ft.fonts.majorFont === theme.fonts.majorFont &&
          ft.fonts.minorFont === theme.fonts.minorFont,
      );
      return matchingFontTheme?.id;
    }
    return undefined;
  }, [settings.themeFontsId, settings.themeId]);

  // Trigger button
  const trigger = (
    <RibbonButton
      layout="vertical"
      height="full"
      data-testid="ribbon-dropdown-theme-fonts"
      icon={<ThemeFontsIcon />}
      label="Fonts"
      hasDropdown
      dropdownPosition="inline"
      isOpen={isOpen}
      title={`Current fonts: ${currentFontTheme.fonts.majorFont} / ${currentFontTheme.fonts.minorFont}`}
      aria-label="Fonts"
      aria-expanded={isOpen}
      aria-haspopup="menu"
      visibilityKey="themeFonts"
    />
  );

  return (
    <RibbonDropdown
      open={isOpen}
      onOpenChange={setIsOpen}
      menuTestId="ribbon-dropdown-menu-theme-fonts"
      trigger={trigger}
      width={240}
      menuLabel="Select Font Theme"
      className={className}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-ss-border">
        <span className="text-ribbon text-ss-text-secondary font-medium">Theme Fonts</span>
      </div>

      {/* Font theme list */}
      <div className="p-2 flex flex-col gap-1 max-h-[320px] overflow-y-auto">
        {BUILT_IN_FONT_THEMES.map((fontTheme) => (
          <FontThemePreview
            key={fontTheme.id}
            fontTheme={fontTheme}
            isSelected={selectedFontThemeId === fontTheme.id}
            onClick={() => handleSelectFontTheme(fontTheme.id)}
          />
        ))}
      </div>

      <RibbonDropdownDivider />

      {/* Footer - current font info */}
      <div className="px-3 py-2 flex flex-col gap-0.5">
        <span className="text-caption text-ss-text-tertiary">
          Current: <span className="text-text font-medium">{currentFontTheme.fonts.majorFont}</span>
          {currentFontTheme.fonts.majorFont !== currentFontTheme.fonts.minorFont && (
            <>
              {' '}
              / <span className="text-text font-medium">{currentFontTheme.fonts.minorFont}</span>
            </>
          )}
        </span>
      </div>
    </RibbonDropdown>
  );
}
