/**
 * Chart Toolbar Component
 *
 * Provides chart insertion controls for the toolbar.
 * Displays a dropdown menu with chart type options.
 *
 * All icons are sourced from @mog/icons via ToolbarIcons.tsx -
 * the single source of truth for icon components.
 *
 * @module components/ChartToolbar
 */

import React, { useCallback, useState } from 'react';

import type { ChartType } from '@mog/charts';

import { RibbonDropdownPanel } from '../../chrome/toolbar/primitives/RibbonDropdown';
import {
  ChartAreaIcon,
  ChartBarIcon,
  ChartColumnIcon,
  ChartComboIcon,
  ChartDoughnutIcon,
  ChartLineIcon,
  ChartPieIcon,
  ChartScatterIcon,
  ChevronDownIcon,
} from '../../chrome/toolbar/primitives/ToolbarIcons';

// =============================================================================
// Types
// =============================================================================

export interface ChartToolbarProps {
  /** Whether chart insertion is enabled (requires selection) */
  disabled?: boolean;
  /** Called when a chart type is selected */
  onInsertChart: (type: ChartType) => void;
  /** Optional class name */
  className?: string;
}

interface ChartTypeOption {
  type: ChartType;
  label: string;
  icon: React.ReactNode;
  description: string;
}

// =============================================================================
// Chart Type Options
// All icons sourced from @mog/icons via ToolbarIcons
// =============================================================================

const CHART_TYPE_OPTIONS: ChartTypeOption[] = [
  {
    type: 'column',
    label: 'Column',
    icon: <ChartColumnIcon />,
    description: 'Compare values across categories',
  },
  {
    type: 'bar',
    label: 'Bar',
    icon: <ChartBarIcon />,
    description: 'Horizontal comparison',
  },
  {
    type: 'line',
    label: 'Line',
    icon: <ChartLineIcon />,
    description: 'Show trends over time',
  },
  {
    type: 'area',
    label: 'Area',
    icon: <ChartAreaIcon />,
    description: 'Show magnitude and trends',
  },
  {
    type: 'pie',
    label: 'Pie',
    icon: <ChartPieIcon />,
    description: 'Show parts of a whole',
  },
  {
    type: 'doughnut',
    label: 'Doughnut',
    icon: <ChartDoughnutIcon />,
    description: 'Pie chart with center hole',
  },
  {
    type: 'scatter',
    label: 'Scatter',
    icon: <ChartScatterIcon />,
    description: 'Show correlation between values',
  },
  {
    type: 'combo',
    label: 'Combo',
    icon: <ChartComboIcon />,
    description: 'Mix columns and lines',
  },
];

// =============================================================================
// Component
// =============================================================================

export function ChartToolbar({
  disabled = false,
  onInsertChart,
  className = '',
}: ChartToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = useCallback(() => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  }, [disabled]);

  const handleSelectType = useCallback(
    (type: ChartType) => {
      setIsOpen(false);
      onInsertChart(type);
    },
    [onInsertChart],
  );

  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={toggleDropdown}
        disabled={disabled}
        className={`flex items-center gap-1 h-7 px-2 border-none rounded cursor-pointer text-ribbon font-medium transition-colors ${
          disabled
            ? 'opacity-40 cursor-not-allowed'
            : isOpen
              ? 'bg-ss-surface-hover text-ss-text-secondary'
              : 'bg-transparent text-ss-text-secondary hover:bg-ss-surface-hover'
        }`}
        title={disabled ? 'Select cells to insert a chart' : 'Insert Chart'}
        aria-label="Insert Chart"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <ChartColumnIcon />
        <span>Chart</span>
        <span className={`ml-0.5 transition-transform ${isOpen ? 'rotate-180' : 'rotate-0'}`}>
          <ChevronDownIcon />
        </span>
      </button>

      {/* Portal-based dropdown - escapes stacking context issues */}
      <RibbonDropdownPanel open={isOpen} onClose={() => setIsOpen(false)}>
        <div
          className="min-w-[220px] bg-ss-surface rounded-ss-lg shadow-ss-md border border-ss-border overflow-hidden"
          role="menu"
        >
          <div className="px-3 py-2 text-dropdown-header font-semibold text-ss-text-secondary uppercase tracking-wide border-b border-ss-border">
            Insert Chart
          </div>
          {CHART_TYPE_OPTIONS.map((option) => (
            <div
              key={option.type}
              role="menuitem"
              tabIndex={0}
              onClick={() => handleSelectType(option.type)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleSelectType(option.type);
                }
              }}
              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-ss-surface-tertiary"
            >
              <div className="flex items-center justify-center w-8 h-8 bg-ss-surface-tertiary rounded text-ss-primary">
                {option.icon}
              </div>
              <div className="flex-1">
                <div className="text-dropdown font-medium text-text">{option.label}</div>
                <div className="text-ribbon-group text-ss-text-secondary mt-0.5">
                  {option.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </RibbonDropdownPanel>
    </div>
  );
}
