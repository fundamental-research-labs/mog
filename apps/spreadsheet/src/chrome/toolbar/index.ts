/**
 * Toolbar Module
 *
 * Re-exports all toolbar-related components and utilities.
 */

// Main toolbar components
export { TabbedToolbar, type TabbedToolbarProps } from './primitives/TabbedToolbar';
export { Toolbar } from './primitives/Toolbar';

// Ribbon components
export { TabBar, type TabBarProps } from './primitives/TabBar';
export { ToolbarGroup, type ToolbarGroupProps } from './primitives/ToolbarGroup';
export { HomeRibbon } from './tabs/HomeRibbon';
export { InsertRibbon } from './tabs/InsertRibbon';
// Re-export SparklineType from the canonical spreadsheet contract.
export type { SparklineType } from '@mog-sdk/contracts/sparklines';

// Foundation Components (RIBBON-GROUP-ORDERING.md)
// SINGLE SOURCE OF TRUTH for all ribbon buttons - use this for ALL ribbon buttons
export { RibbonButton, type RibbonButtonProps } from './primitives/RibbonButton';
// Split button with main action + dropdown (Font Color, Borders, etc.)
// Use SplitButton for two-click-zone patterns; use RibbonButton for single-click
export { SplitButton } from './primitives/SplitButton';
// Gallery dropdown for visual galleries (Chart types, Table Styles, Cell Styles)
export { GalleryDropdown } from './galleries/GalleryDropdown';
// Section within gallery with optional title
export { GallerySection } from './galleries/GallerySection';
// Individual item in gallery with preview + label
export { GalleryItem } from './galleries/GalleryItem';

// Shape Preview Components
export { ShapePreviewThumbnail } from './galleries/ShapePreviewThumbnail';

// Constants (styles migrated to Tailwind - see ui/Button.tsx, ui/Select.tsx)
// Icons - DropdownArrowIcon exported from ToolbarIcons.tsx
export {} from './primitives/ToolbarIcons';
