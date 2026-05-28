/**
 * ChartTypeButton
 *
 * A button representing a chart category (Column, Line, Pie, etc.) with a
 * dropdown arrow indicator. Opens a ChartGallery when clicked.
 *
 * Matches Excel 365 ribbon pattern where each chart type has its own button
 * that opens a gallery of subtypes.
 *
 * IMPORTANT: Uses RibbonButton as the single source of truth for button
 * styling, ensuring visual consistency across all ribbon groups.
 *
 * All icons are sourced from @mog/icons via ToolbarIcons.tsx -
 * the single source of truth for icon components.
 *
 * @module components/charts/ChartTypeButton
 */

import React, { useCallback, useState } from 'react';

import type { ChartType } from '@mog/charts';

import { RibbonButton } from '../../chrome/toolbar/primitives/RibbonButton';
import {
  ChartAreaIcon,
  ChartBarIcon,
  ChartBubbleIcon,
  ChartColumnIcon,
  ChartComboIcon,
  ChartDoughnutIcon,
  ChartFunnelIcon,
  ChartLineIcon,
  ChartPieIcon,
  ChartRadarIcon,
  ChartScatterIcon,
  ChartStockIcon,
  ChartWaterfallIcon,
} from '../../chrome/toolbar/primitives/ToolbarIcons';

import type { ChartCategory, ChartVariant } from './chart-variants';
import { ChartGallery } from './ChartGallery';

// =============================================================================
// Types
// =============================================================================

export interface ChartTypeButtonProps {
  /** Chart category for this button */
  category: ChartCategory;
  /** Called when a variant is selected */
  onSelectVariant: (variant: ChartVariant) => void;
  /** Called when the user opens the full chart wizard from the gallery */
  onOpenWizard?: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Optional class name */
  className?: string;
}

// =============================================================================
// Chart Type Icon Mapping
// =============================================================================

/**
 * Map chart type to icon component
 * All icons sourced from @mog/icons via ToolbarIcons
 */
const CHART_ICONS: Record<ChartType, React.FC> = {
  column: ChartColumnIcon,
  bar: ChartBarIcon,
  line: ChartLineIcon,
  area: ChartAreaIcon,
  pie: ChartPieIcon,
  doughnut: ChartDoughnutIcon,
  scatter: ChartScatterIcon,
  bubble: ChartBubbleIcon,
  combo: ChartComboIcon,
  radar: ChartRadarIcon,
  stock: ChartStockIcon,
  funnel: ChartFunnelIcon,
  waterfall: ChartWaterfallIcon,
  // 3D variants reuse the same icons as their 2D counterparts
  bar3d: ChartBarIcon,
  column3d: ChartColumnIcon,
  line3d: ChartLineIcon,
  pie3d: ChartPieIcon,
  area3d: ChartAreaIcon,
  // Surface and ofPie use closest available icons
  surface: ChartAreaIcon,
  surface3d: ChartAreaIcon,
  ofPie: ChartPieIcon,
  // Statistical chart types reuse closest available icons
  histogram: ChartColumnIcon,
  boxplot: ChartStockIcon,
  heatmap: ChartAreaIcon,
  violin: ChartAreaIcon,
  pareto: ChartComboIcon,
  // Hierarchical chart types
  treemap: ChartAreaIcon,
  sunburst: ChartPieIcon,
  // Geographic chart types
  regionMap: ChartScatterIcon,
  // Exploded pie variants
  pieExploded: ChartPieIcon,
  pie3dExploded: ChartPieIcon,
  doughnutExploded: ChartDoughnutIcon,
  // Bubble with 3D effect
  bubble3DEffect: ChartBubbleIcon,
  // Surface variants
  surfaceWireframe: ChartAreaIcon,
  surfaceTopView: ChartAreaIcon,
  surfaceTopViewWireframe: ChartAreaIcon,
  // Line with markers
  lineMarkers: ChartLineIcon,
  lineMarkersStacked: ChartLineIcon,
  lineMarkersStacked100: ChartLineIcon,
  // Decorative 3D shape charts (cylinder)
  cylinderColClustered: ChartColumnIcon,
  cylinderColStacked: ChartColumnIcon,
  cylinderColStacked100: ChartColumnIcon,
  cylinderBarClustered: ChartBarIcon,
  cylinderBarStacked: ChartBarIcon,
  cylinderBarStacked100: ChartBarIcon,
  cylinderCol: ChartColumnIcon,
  // Decorative 3D shape charts (cone)
  coneColClustered: ChartColumnIcon,
  coneColStacked: ChartColumnIcon,
  coneColStacked100: ChartColumnIcon,
  coneBarClustered: ChartBarIcon,
  coneBarStacked: ChartBarIcon,
  coneBarStacked100: ChartBarIcon,
  coneCol: ChartColumnIcon,
  // Decorative 3D shape charts (pyramid)
  pyramidColClustered: ChartColumnIcon,
  pyramidColStacked: ChartColumnIcon,
  pyramidColStacked100: ChartColumnIcon,
  pyramidBarClustered: ChartBarIcon,
  pyramidBarStacked: ChartBarIcon,
  pyramidBarStacked100: ChartBarIcon,
  pyramidCol: ChartColumnIcon,
};

// =============================================================================
// Component
// =============================================================================

/**
 * ChartTypeButton - Button for a chart category that opens a variant gallery
 *
 * Features:
 * - Uses RibbonButton for consistent styling with other ribbon buttons
 * - Icon representing the chart type
 * - Inline dropdown arrow indicator (compact style)
 * - Opens ChartGallery on click
 * - Disabled state support
 */
export function ChartTypeButton({
  category,
  onSelectVariant,
  onOpenWizard,
  disabled = false,
  className = '',
}: ChartTypeButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  }, [disabled]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const IconComponent = CHART_ICONS[category.id];

  // The button element that triggers the gallery - uses RibbonButton for consistency
  // Uses icon-only layout to match Excel's compact chart button style
  // Excel shows chart icons as small icon-only buttons in a 2-row grid
  const triggerButton = (
    <RibbonButton
      layout="icon-only"
      icon={<IconComponent />}
      hasDropdown
      isOpen={isOpen}
      disabled={disabled}
      onClick={handleToggle}
      title={
        disabled ? 'Select cells to insert a chart' : `${category.label}: ${category.description}`
      }
      aria-label={`Insert ${category.label} Chart`}
      className={className}
      visibilityKey={category.id}
    />
  );

  return (
    <ChartGallery
      open={isOpen}
      onClose={handleClose}
      trigger={triggerButton}
      category={category}
      onSelectVariant={onSelectVariant}
      disabled={disabled}
      onOpenWizard={onOpenWizard}
    />
  );
}
