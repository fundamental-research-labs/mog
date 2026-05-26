/**
 * ThemesGroup Component
 *
 * Self-sufficient Themes group for the Page Layout ribbon.
 * Contains the ThemeGallery, Colors, and Fonts buttons.
 *
 * This follows the HomeRibbon group pattern - no props, all state
 * comes from hooks and context.
 *
 */

import { THEMES_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { ThemeFontsGallery } from '../galleries/ThemeFontsGallery';
import { ThemeGallery } from '../galleries/ThemeGallery';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { ThemeColorsIcon } from '../primitives/ToolbarIcons';

// =============================================================================
// Component
// =============================================================================

/**
 * ThemesGroup - Self-sufficient themes group.
 *
 * This component wraps the existing ThemeGallery (which uses useWorkbookSettings
 * hook internally) and adds Colors/Fonts buttons.
 *
 * No props required - ThemeGallery and ThemeFontsGallery get their state from hooks.
 */
export function ThemesGroup() {
  return (
    <ToolbarGroup
      label="Themes"
      collapseConfig={THEMES_COLLAPSE_CONFIG}
      dropdownIcon={<ThemeColorsIcon />}
    >
      <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
        {/* Theme Gallery - functional theme picker (uses useWorkbookSettings internally) */}
        <ThemeGallery />

        {/* Colors - stub for now (would need custom color scheme editing) */}
        <RibbonButton
          layout="vertical"
          height="full"
          data-testid="ribbon-dropdown-theme-colors"
          icon={<ThemeColorsIcon />}
          label="Colors"
          hasDropdown
          dropdownPosition="inline"
          disabled
          title="Theme Colors (coming soon)"
          aria-label="Colors"
        />

        {/* Fonts - Theme font pair selection */}
        <ThemeFontsGallery />
      </div>
    </ToolbarGroup>
  );
}
