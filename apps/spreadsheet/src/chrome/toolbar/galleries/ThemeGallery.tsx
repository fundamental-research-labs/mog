/**
 * ThemeGallery Component
 *
 * Displays a gallery of available themes for selection.
 * Wired to the Themes button in PageLayoutRibbon.
 *
 *
 *
 * Architecture:
 * - Uses BUILT_IN_THEMES array from built-in-themes.ts
 * - Uses useWorkbookSettings for current theme and setting
 * - Shows theme preview swatches (accent colors)
 */

import { useCallback, useMemo, useState } from 'react';

import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { useWorkbookSettings } from '../../../hooks/settings/use-workbook-settings';
import { BUILT_IN_THEMES, getBuiltInTheme } from '../../../infra/styles/built-in-themes';
import { PRODUCT_VOCABULARY } from '../../../ux/product-vocabulary';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdown, RibbonDropdownDivider } from '../primitives/RibbonDropdown';
import { ThemesIcon } from '../primitives/ToolbarIcons';

// =============================================================================
// Types
// =============================================================================

export interface ThemeGalleryProps {
  className?: string;
}

// =============================================================================
// ThemePreview - Shows a theme's color swatches
// =============================================================================

interface ThemePreviewProps {
  theme: ThemeDefinition;
  isSelected: boolean;
  onClick: () => void;
}

function ThemePreview({ theme, isSelected, onClick }: ThemePreviewProps) {
  return (
    <button
      type="button"
      data-value={theme.id}
      onClick={onClick}
      className={`
 flex flex-col items-start p-2 rounded border transition-all
 hover:bg-ss-surface-hover
 ${isSelected ? 'border-ss-primary bg-ss-primary/5' : 'border-transparent'}
 `}
      title={theme.name}
    >
      {/* Color swatches - shows accent colors */}
      <div className="flex gap-0.5 mb-1">
        {/* Accent colors 1-6 */}
        <div className="w-3 h-3 rounded-ss-sm" style={{ backgroundColor: theme.colors.accent1 }} />
        <div className="w-3 h-3 rounded-ss-sm" style={{ backgroundColor: theme.colors.accent2 }} />
        <div className="w-3 h-3 rounded-ss-sm" style={{ backgroundColor: theme.colors.accent3 }} />
        <div className="w-3 h-3 rounded-ss-sm" style={{ backgroundColor: theme.colors.accent4 }} />
        <div className="w-3 h-3 rounded-ss-sm" style={{ backgroundColor: theme.colors.accent5 }} />
        <div className="w-3 h-3 rounded-ss-sm" style={{ backgroundColor: theme.colors.accent6 }} />
      </div>
      {/* Theme name */}
      <span className="text-caption text-text truncate w-full text-left">{theme.name}</span>
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export function ThemeGallery({ className = '' }: ThemeGalleryProps) {
  const { settings, setSetting } = useWorkbookSettings();
  const [isOpen, setIsOpen] = useState(false);

  // Current theme
  const currentTheme = useMemo(
    () => getBuiltInTheme(settings.themeId) ?? BUILT_IN_THEMES[0],
    [settings.themeId],
  );

  // Handle theme selection
  const handleSelectTheme = useCallback(
    (themeId: string) => {
      setSetting('themeId', themeId);
      setIsOpen(false);
    },
    [setSetting],
  );

  // Trigger button
  const trigger = (
    <RibbonButton
      layout="vertical"
      height="full"
      data-testid="ribbon-dropdown-themes"
      icon={<ThemesIcon />}
      label="Themes"
      hasDropdown
      dropdownPosition="inline"
      isOpen={isOpen}
      title={`Current theme: ${currentTheme.name}`}
      aria-label="Themes"
      aria-expanded={isOpen}
      aria-haspopup="menu"
      visibilityKey="themes"
    />
  );

  return (
    <RibbonDropdown
      open={isOpen}
      onOpenChange={setIsOpen}
      menuTestId="ribbon-dropdown-menu-themes"
      trigger={trigger}
      width={280}
      menuLabel={`Select ${PRODUCT_VOCABULARY.workbookThemes.label}`}
      className={className}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-ss-border">
        <span className="text-ribbon text-ss-text-secondary font-medium">
          {PRODUCT_VOCABULARY.workbookThemes.label}
        </span>
      </div>

      {/* Theme grid */}
      <div className="p-2 grid grid-cols-4 gap-1 max-h-[280px] overflow-y-auto">
        {BUILT_IN_THEMES.map((theme) => (
          <ThemePreview
            key={theme.id}
            theme={theme}
            isSelected={settings.themeId === theme.id}
            onClick={() => handleSelectTheme(theme.id)}
          />
        ))}
      </div>

      <RibbonDropdownDivider />

      {/* Footer - current theme info */}
      <div className="px-3 py-2 flex items-center gap-2">
        <div className="flex gap-0.5">
          <div
            className="w-3 h-3 rounded-ss-sm"
            style={{ backgroundColor: currentTheme.colors.accent1 }}
          />
          <div
            className="w-3 h-3 rounded-ss-sm"
            style={{ backgroundColor: currentTheme.colors.accent2 }}
          />
          <div
            className="w-3 h-3 rounded-ss-sm"
            style={{ backgroundColor: currentTheme.colors.accent3 }}
          />
        </div>
        <span className="text-caption text-ss-text-tertiary">
          Current: <span className="text-text font-medium">{currentTheme.name}</span>
        </span>
      </div>
    </RibbonDropdown>
  );
}
