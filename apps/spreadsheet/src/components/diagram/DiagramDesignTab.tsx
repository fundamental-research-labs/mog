/**
 * Diagram design tab component
 *
 * UI Components
 *
 * Contextual command tab shown when a diagram object is selected.
 * Provides controls for:
 * - Create Graphic: Add Shape split button for node operations
 * - Layouts: Gallery to change diagram layout type
 * - Quick Styles: Gallery for visual style presets (subtle, moderate, intense)
 * - Color Themes: Gallery for color scheme selection
 * - Reset: Reset graphic to defaults or convert to shapes
 *
 * ARCHITECTURE:
 * - Uses dispatch() for ALL UIStore mutations (NO direct calls)
 * - Follow ChartToolsRibbon pattern for consistency
 * - Use existing ToolbarGroup and RibbonButton components
 *
 * NOTE: Some action types (DIAGRAM_CHANGE_LAYOUT, DIAGRAM_SET_QUICK_STYLE, etc.)
 * are not yet registered in the dispatcher. This component uses DIAGRAM_UPDATE_STYLE
 * and DIAGRAM_UPDATE_LAYOUT which are defined handlers, with placeholders for
 * gallery-specific actions.
 *
 * @module components/diagram/DiagramDesignTab
 */

import React, { memo, useCallback, useMemo, useState } from 'react';

import type { DiagramObject } from '@mog-sdk/contracts/floating-objects';
import type { DiagramLayoutDefinition } from '@mog-sdk/contracts/diagram';
import { dispatch } from '../../actions';
import type { ContextualTabProps } from '../../chrome/toolbar/contextual';
import { RibbonButton } from '../../chrome/toolbar/primitives/RibbonButton';
import {
  RibbonDropdownItem,
  RibbonDropdownPanel,
} from '../../chrome/toolbar/primitives/RibbonDropdown';
import { ToolbarGroup } from '../../chrome/toolbar/primitives/ToolbarGroup';
import { DeleteIcon } from '../../chrome/toolbar/primitives/ToolbarIcons';
import { useActionDependencies } from '../../hooks';
import { useFloatingObject } from '../../hooks/objects';
import { useUIStore } from '../../infra/context';
import { PRODUCT_VOCABULARY } from '../../ux/product-vocabulary';
import { AddShapeButton } from './NodeActionButtons';

// =============================================================================
// Types
// =============================================================================

/**
 * Props for DiagramDesignTab.
 * Extended from ContextualTabProps if needed.
 */
export interface DiagramDesignTabProps extends ContextualTabProps {
  /** The Diagram object being edited (optional - will fetch from UIStore if not provided) */
  diagram?: DiagramObject;
}

// =============================================================================
// Helper Hook: Get Selected Diagram
// =============================================================================

/**
 * Get the currently selected Diagram object from the FloatingObjectCache.
 * Returns undefined if no Diagram is selected.
 */
function useSelectedDiagram(): DiagramObject | undefined {
  const selectedDiagramId = useUIStore((s) => s.selectedDiagramId);
  const obj = useFloatingObject(selectedDiagramId ?? '');
  if (!obj || obj.type !== 'diagram') return undefined;
  return obj as DiagramObject;
}

/**
 * Quick style option for display in gallery.
 */
interface QuickStyleOption {
  id: string;
  label: string;
  category: 'subtle' | 'moderate' | 'intense' | '3d';
}

/**
 * Color theme option for display in gallery.
 */
interface ColorThemeOption {
  id: string;
  label: string;
  category: 'colorful' | 'accent' | 'transparent';
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Quick style options for the gallery.
 * Maps QUICK_STYLE_IDS to display information.
 */
const QUICK_STYLE_OPTIONS: QuickStyleOption[] = [
  { id: 'subtle-effect', label: 'Subtle Effect', category: 'subtle' },
  { id: 'subtle-line', label: 'Subtle Line', category: 'subtle' },
  { id: 'moderate-effect', label: 'Moderate Effect', category: 'moderate' },
  { id: 'polished', label: 'Polished', category: 'moderate' },
  { id: 'inset', label: 'Inset', category: 'moderate' },
  { id: 'intense-effect', label: 'Intense Effect', category: 'intense' },
  { id: 'metallic-scene', label: 'Metallic Scene', category: 'intense' },
  { id: 'powder', label: 'Powder', category: 'intense' },
  { id: '3d-cartoon', label: '3D Cartoon', category: '3d' },
  { id: '3d-polished', label: '3D Polished', category: '3d' },
  { id: '3d-flat-scene', label: '3D Flat Scene', category: '3d' },
  { id: '3d-powder', label: '3D Powder', category: '3d' },
];

/**
 * Color theme options for the gallery (first 8 for inline display).
 */
const COLOR_THEME_OPTIONS: ColorThemeOption[] = [
  { id: 'colorful-1', label: 'Colorful Range 1', category: 'colorful' },
  { id: 'colorful-2', label: 'Colorful Range 2', category: 'colorful' },
  { id: 'colorful-3', label: 'Colorful Range 3', category: 'colorful' },
  { id: 'colorful-4', label: 'Colorful Range 4', category: 'colorful' },
  { id: 'colorful-5', label: 'Colorful Range 5', category: 'colorful' },
  { id: 'accent-1-fill', label: 'Accent 1', category: 'accent' },
  { id: 'accent-2-fill', label: 'Accent 2', category: 'accent' },
  { id: 'accent-3-fill', label: 'Accent 3', category: 'accent' },
];

// =============================================================================
// Icons
// =============================================================================

/**
 * Diagram layout icon for the ribbon.
 */
function LayoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <rect x="10" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="10" width="6" height="6" rx="1" />
      <rect x="10" y="10" width="6" height="6" rx="1" />
    </svg>
  );
}

/**
 * Diagram styles icon for the ribbon.
 */
function StylesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <circle cx="6" cy="10" r="4" opacity="0.6" />
      <circle cx="10" cy="10" r="4" opacity="0.8" />
      <circle cx="14" cy="10" r="4" />
    </svg>
  );
}

/**
 * Color palette icon for color themes button.
 */
function ColorPaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="4" r="2.5" fill="#4285F4" />
      <circle cx="12" cy="4" r="2.5" fill="#EA4335" />
      <circle cx="4" cy="12" r="2.5" fill="#34A853" />
      <circle cx="12" cy="12" r="2.5" fill="#FBBC05" />
    </svg>
  );
}

/**
 * Reset icon for reset button.
 */
function ResetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 2a6 6 0 0 0-6 6h2a4 4 0 1 1 .5 1.9L3 12l-1.5-3H0l2.5 4 2.5-4H3.5l1.5 2a6 6 0 1 0 3-10z" />
    </svg>
  );
}

/**
 * Convert to shapes icon.
 */
function ConvertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 2h5v5H2V2zm0 7h5v5H2V9zm7-7h5v5H9V2zm0 7h5v5H9V9z" opacity="0.7" />
      <path d="M6 8l2-2 2 2M8 6v6" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

// =============================================================================
// Helper Hook: Get Available Layouts
// =============================================================================

/**
 * Get available layouts for the current Diagram category.
 * Returns layouts from the layout registry filtered by category.
 */
function useAvailableLayouts(_category: string): DiagramLayoutDefinition[] {
  // The Diagram layout registry would be accessed through ws.diagrams API.
  // For now, return empty and the "More Layouts" button will open the full gallery.
  // TODO: Implement once ws.diagrams exposes getLayoutsByCategory().
  return useMemo(() => [], []);
}

// =============================================================================
// Component Implementation
// =============================================================================

/**
 * Diagram Design Tab Component
 *
 * Contextual ribbon tab providing design controls for Diagram diagrams.
 * Follows the ChartToolsRibbon pattern for consistency.
 */
export const DiagramDesignTab = memo(function DiagramDesignTab({
  diagram: diagramProp,
}: DiagramDesignTabProps): React.ReactElement | null {
  const deps = useActionDependencies();

  // Get selected Diagram from UIStore if not provided as prop
  const selectedDiagram = useSelectedDiagram();
  const diagram = diagramProp ?? selectedDiagram;

  // Dropdown state - hooks must be called unconditionally
  const [layoutDropdownOpen, setLayoutDropdownOpen] = useState(false);
  const [stylesDropdownOpen, setStylesDropdownOpen] = useState(false);
  const [colorsDropdownOpen, setColorsDropdownOpen] = useState(false);

  // Get current diagram properties (use defaults when diagram is null)
  const currentLayoutId = diagram?.diagram?.layoutId ?? '';
  const currentQuickStyleId = diagram?.diagram?.quickStyleId ?? 'subtle-effect';
  const currentColorThemeId = diagram?.diagram?.colorThemeId ?? 'colorful-1';
  const category = diagram?.diagram?.category ?? 'list';

  // Get available layouts for the category
  const availableLayouts = useAvailableLayouts(category);

  // ==========================================================================
  // Handlers - use diagram?.id with early returns for safety
  // ==========================================================================

  /**
   * Handle layout change.
   * Uses DIAGRAM_UPDATE_LAYOUT action.
   */
  const handleChangeLayout = useCallback(
    (layoutId: string) => {
      if (!diagram) return;
      dispatch('DIAGRAM_UPDATE_LAYOUT', deps, {
        objectId: diagram.id,
        layoutId,
      });
      setLayoutDropdownOpen(false);
    },
    [deps, diagram],
  );

  /**
   * Handle quick style change.
   * Uses DIAGRAM_UPDATE_STYLE action.
   */
  const handleChangeQuickStyle = useCallback(
    (quickStyleId: string) => {
      if (!diagram) return;
      dispatch('DIAGRAM_UPDATE_STYLE', deps, {
        objectId: diagram.id,
        quickStyleId,
      });
      setStylesDropdownOpen(false);
    },
    [deps, diagram],
  );

  /**
   * Handle color theme change.
   * Uses DIAGRAM_UPDATE_STYLE action.
   */
  const handleChangeColorTheme = useCallback(
    (colorThemeId: string) => {
      if (!diagram) return;
      dispatch('DIAGRAM_UPDATE_STYLE', deps, {
        objectId: diagram.id,
        colorThemeId,
      });
      setColorsDropdownOpen(false);
    },
    [deps, diagram],
  );

  /**
   * Handle opening the full layout gallery dialog.
   * NOTE: OPEN_DIAGRAM_LAYOUT_GALLERY is not yet implemented.
   */
  const handleOpenLayoutGallery = useCallback(() => {
    // For now, just open the Diagram dialog which has the layout gallery
    dispatch('OPEN_DIAGRAM_DIALOG', deps);
    setLayoutDropdownOpen(false);
  }, [deps]);

  /**
   * Handle reset graphic action.
   * NOTE: DIAGRAM_RESET_GRAPHIC is not yet implemented - placeholder.
   */
  const handleResetGraphic = useCallback(() => {
    if (!diagram) return;
    // Reset to default style and color theme
    dispatch('DIAGRAM_UPDATE_STYLE', deps, {
      objectId: diagram.id,
      quickStyleId: 'subtle-effect',
      colorThemeId: 'colorful-1',
    });
  }, [deps, diagram]);

  /**
   * Handle convert to shapes action.
   * NOTE: DIAGRAM_CONVERT_TO_SHAPES is not yet implemented - placeholder.
   */
  const handleConvertToShapes = useCallback(() => {
    // This would delete the Diagram and create individual shape objects
    // TODO: Implement DIAGRAM_CONVERT_TO_SHAPES action
  }, []);

  /**
   * Handle delete Diagram action.
   */
  const handleDelete = useCallback(() => {
    if (!diagram) return;
    dispatch('DIAGRAM_DELETE', deps, { objectId: diagram.id });
  }, [deps, diagram]);

  // Determine if this is an org chart layout (shows "Add Assistant" option)
  const isOrgChart = category === 'hierarchy';

  // Don't render if no diagram is selected - placed AFTER all hooks
  if (!diagram) return null;

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <>
      {/* Create Graphic Group */}
      <ToolbarGroup label="Create Graphic">
        <AddShapeButton diagramId={diagram.id} showAssistant={isOrgChart} />
      </ToolbarGroup>

      {/* Layouts Group */}
      <ToolbarGroup label="Layouts">
        <div className="relative inline-flex">
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<LayoutIcon />}
            label="Change Layout"
            hasDropdown
            isOpen={layoutDropdownOpen}
            onClick={() => setLayoutDropdownOpen(!layoutDropdownOpen)}
            title={`Change ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} layout`}
            aria-label={`Change ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} layout`}
          />

          <RibbonDropdownPanel
            open={layoutDropdownOpen}
            onClose={() => setLayoutDropdownOpen(false)}
          >
            <div className="bg-ss-surface border border-ss-border rounded shadow-ss-md py-1 min-w-[200px]">
              <div className="px-3 py-1 text-caption text-ss-text-secondary font-medium">
                Layouts for {category.charAt(0).toUpperCase() + category.slice(1)}
              </div>

              {/* Show available layouts if any */}
              {availableLayouts.length > 0 ? (
                availableLayouts.slice(0, 6).map((layout) => (
                  <RibbonDropdownItem
                    key={layout.id}
                    onClick={() => handleChangeLayout(layout.id)}
                    isSelected={currentLayoutId === layout.id}
                    closeOnClick
                  >
                    {layout.name}
                  </RibbonDropdownItem>
                ))
              ) : (
                <div className="px-3 py-2 text-body-sm text-ss-text-secondary">
                  No layouts loaded
                </div>
              )}

              <div className="border-t border-ss-border my-1" />

              <RibbonDropdownItem onClick={handleOpenLayoutGallery} closeOnClick>
                More Layouts...
              </RibbonDropdownItem>
            </div>
          </RibbonDropdownPanel>
        </div>
      </ToolbarGroup>

      {/* Diagram Styles Group */}
      <ToolbarGroup label={`${PRODUCT_VOCABULARY.diagram.label} Styles`}>
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          {/* Quick Styles Dropdown */}
          <div className="relative inline-flex">
            <RibbonButton
              layout="vertical"
              height="full"
              icon={<StylesIcon />}
              label="Quick Styles"
              hasDropdown
              isOpen={stylesDropdownOpen}
              onClick={() => setStylesDropdownOpen(!stylesDropdownOpen)}
              title={`Change ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} style`}
              aria-label={`Change ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} style`}
            />

            <RibbonDropdownPanel
              open={stylesDropdownOpen}
              onClose={() => setStylesDropdownOpen(false)}
            >
              <div className="bg-ss-surface border border-ss-border rounded shadow-ss-md py-1 min-w-[180px]">
                {/* Subtle styles */}
                <div className="px-3 py-1 text-caption text-ss-text-secondary font-medium">
                  Subtle
                </div>
                {QUICK_STYLE_OPTIONS.filter((s) => s.category === 'subtle').map((style) => (
                  <RibbonDropdownItem
                    key={style.id}
                    onClick={() => handleChangeQuickStyle(style.id)}
                    isSelected={currentQuickStyleId === style.id}
                    closeOnClick
                  >
                    {style.label}
                  </RibbonDropdownItem>
                ))}

                {/* Moderate styles */}
                <div className="px-3 py-1 text-caption text-ss-text-secondary font-medium mt-1">
                  Moderate
                </div>
                {QUICK_STYLE_OPTIONS.filter((s) => s.category === 'moderate').map((style) => (
                  <RibbonDropdownItem
                    key={style.id}
                    onClick={() => handleChangeQuickStyle(style.id)}
                    isSelected={currentQuickStyleId === style.id}
                    closeOnClick
                  >
                    {style.label}
                  </RibbonDropdownItem>
                ))}

                {/* Intense styles */}
                <div className="px-3 py-1 text-caption text-ss-text-secondary font-medium mt-1">
                  Intense
                </div>
                {QUICK_STYLE_OPTIONS.filter((s) => s.category === 'intense').map((style) => (
                  <RibbonDropdownItem
                    key={style.id}
                    onClick={() => handleChangeQuickStyle(style.id)}
                    isSelected={currentQuickStyleId === style.id}
                    closeOnClick
                  >
                    {style.label}
                  </RibbonDropdownItem>
                ))}

                {/* 3D styles */}
                <div className="px-3 py-1 text-caption text-ss-text-secondary font-medium mt-1">
                  3D
                </div>
                {QUICK_STYLE_OPTIONS.filter((s) => s.category === '3d').map((style) => (
                  <RibbonDropdownItem
                    key={style.id}
                    onClick={() => handleChangeQuickStyle(style.id)}
                    isSelected={currentQuickStyleId === style.id}
                    closeOnClick
                  >
                    {style.label}
                  </RibbonDropdownItem>
                ))}
              </div>
            </RibbonDropdownPanel>
          </div>

          {/* Color Themes Dropdown */}
          <div className="relative inline-flex">
            <RibbonButton
              layout="vertical"
              height="full"
              icon={<ColorPaletteIcon />}
              label="Change Colors"
              hasDropdown
              isOpen={colorsDropdownOpen}
              onClick={() => setColorsDropdownOpen(!colorsDropdownOpen)}
              title={`Change ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} color theme`}
              aria-label={`Change ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} color theme`}
            />

            <RibbonDropdownPanel
              open={colorsDropdownOpen}
              onClose={() => setColorsDropdownOpen(false)}
            >
              <div className="bg-ss-surface border border-ss-border rounded shadow-ss-md py-1 min-w-[200px]">
                {/* Colorful themes */}
                <div className="px-3 py-1 text-caption text-ss-text-secondary font-medium">
                  Colorful
                </div>
                {COLOR_THEME_OPTIONS.filter((t) => t.category === 'colorful').map((theme) => (
                  <RibbonDropdownItem
                    key={theme.id}
                    onClick={() => handleChangeColorTheme(theme.id)}
                    isSelected={currentColorThemeId === theme.id}
                    closeOnClick
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5">
                        {/* Color preview dots - using design system accent colors */}
                        <div className="w-3 h-3 rounded-full bg-ss-accent-1" />
                        <div className="w-3 h-3 rounded-full bg-ss-accent-2" />
                        <div className="w-3 h-3 rounded-full bg-ss-accent-6" />
                      </div>
                      <span>{theme.label}</span>
                    </div>
                  </RibbonDropdownItem>
                ))}

                {/* Accent themes */}
                <div className="px-3 py-1 text-caption text-ss-text-secondary font-medium mt-1">
                  Accent Colors
                </div>
                {COLOR_THEME_OPTIONS.filter((t) => t.category === 'accent').map((theme) => (
                  <RibbonDropdownItem
                    key={theme.id}
                    onClick={() => handleChangeColorTheme(theme.id)}
                    isSelected={currentColorThemeId === theme.id}
                    closeOnClick
                  >
                    {theme.label}
                  </RibbonDropdownItem>
                ))}

                <div className="border-t border-ss-border my-1" />

                {/* More Colors option */}
                <RibbonDropdownItem
                  onClick={() => {
                    // Open full color gallery - placeholder
                    // TODO: Implement full color gallery dialog
                    setColorsDropdownOpen(false);
                  }}
                  closeOnClick
                >
                  More Colors...
                </RibbonDropdownItem>
              </div>
            </RibbonDropdownPanel>
          </div>
        </div>
      </ToolbarGroup>

      {/* Reset Group */}
      <ToolbarGroup label="Reset">
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<ResetIcon />}
            label="Reset Graphic"
            onClick={handleResetGraphic}
            title={`Reset ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} to default styling`}
            aria-label="Reset Graphic"
          />
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<ConvertIcon />}
            label="Convert to Shapes"
            onClick={handleConvertToShapes}
            title={`Convert ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} to individual shapes`}
            aria-label="Convert to Shapes"
          />
        </div>
      </ToolbarGroup>

      {/* Actions Group */}
      <ToolbarGroup label="Actions" isLast>
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<DeleteIcon />}
          label="Delete"
          onClick={handleDelete}
          title={`Delete selected ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()}`}
          aria-label={`Delete ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()}`}
        />
      </ToolbarGroup>
    </>
  );
});

// =============================================================================
// Default Export
// =============================================================================

export default DiagramDesignTab;
