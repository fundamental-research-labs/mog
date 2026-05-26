/**
 * ChartsGroup
 *
 * The Charts group for the Insert ribbon:
 *
 * [Charts▼] | [Column▼] [Line▼] ... (two stable category rows)
 *
 * - "Charts" opens the ribbon chart gallery grouped by chart type
 * - Category icons provide direct dropdowns for each fixed chart category
 *
 * @module components/charts/ChartsGroup
 */

import { useCallback } from 'react';

import type { ChartType } from '@mog/charts';

import { useGroupRenderMode, useRibbonCollapseLevel } from '../../chrome/toolbar/collapse/context';
import { CHART_CATEGORY_BUTTON_ROWS, CHART_DROPDOWN_CATEGORIES } from './chart-ribbon-layout';
import type { ChartVariant } from './chart-variants';
import { ChartTypesDropdownButton } from './ChartTypesDropdownButton';
import { ChartTypeButton } from './ChartTypeButton';

// =============================================================================
// Types
// =============================================================================

export interface ChartsGroupProps {
  /** Whether chart insertion is disabled (no selection) */
  disabled?: boolean;
  /** Called when a chart is selected for insertion */
  onInsertChart: (type: ChartType, subType?: string, config?: Record<string, unknown>) => void;
  /** Called when the user asks for the full chart wizard */
  onOpenChartWizard?: () => void;
  /** Optional class name */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ChartsGroup - chart insertion buttons
 *
 * Layout:
 * - "Charts" as one ribbon category dropdown on the left
 * - two rows of fixed category dropdown icons
 */
export function ChartsGroup({
  disabled = false,
  onInsertChart,
  onOpenChartWizard,
  className = '',
}: ChartsGroupProps) {
  const groupMode = useGroupRenderMode();
  const { containerWidth } = useRibbonCollapseLevel();
  const showCategoryShortcuts = groupMode !== 'compact' && containerWidth >= 1800;

  const handleSelectVariant = useCallback(
    (variant: ChartVariant) => {
      onInsertChart(variant.type, variant.subType, variant.config);
    },
    [onInsertChart],
  );

  return (
    <div className={`flex items-center gap-[var(--ribbon-group-items-gap)] ${className}`}>
      <ChartTypesDropdownButton
        categories={CHART_DROPDOWN_CATEGORIES}
        onSelectVariant={handleSelectVariant}
        disabled={disabled}
        onOpenWizard={onOpenChartWizard}
      />
      {showCategoryShortcuts && (
        <div className="flex flex-col justify-center gap-[var(--ribbon-button-gap)]">
          {CHART_CATEGORY_BUTTON_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="flex items-center gap-[var(--ribbon-button-gap)]">
              {row.map((category) => (
                <ChartTypeButton
                  key={category.id}
                  category={category}
                  onSelectVariant={handleSelectVariant}
                  disabled={disabled}
                  onOpenWizard={onOpenChartWizard}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
