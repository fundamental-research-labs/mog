/**
 * SparklineToolsRibbon
 *
 * Contextual ribbon tab shown when a sparkline is selected.
 * Provides sparkline type, style, and display controls.
 *
 * Groups:
 * - Type: Line, Column, Win/Loss sparkline types
 * - Show: High Point, Low Point, First Point, Last Point, Negative Points, Markers toggles
 * - Style: Sparkline color, marker color
 * - Group: Group, Ungroup, Clear sparklines
 */

import { useCallback, useState } from 'react';
import { useDocumentContext } from '../../../internal-api';

import { Checkbox } from '@mog/shell';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownItem, RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { DeleteIcon } from '../primitives/ToolbarIcons';
import type { ContextualTabProps } from './contextual-tab-registry';

// =============================================================================
// Types
// =============================================================================

type SparklineType = 'line' | 'column' | 'winLoss';

interface SparklineTypeOption {
  type: SparklineType;
  label: string;
}

// =============================================================================
// Constants
// =============================================================================

const SPARKLINE_TYPES: SparklineTypeOption[] = [
  { type: 'line', label: 'Line' },
  { type: 'column', label: 'Column' },
  { type: 'winLoss', label: 'Win/Loss' },
];

// =============================================================================
// Icons (inline until added to ToolbarIcons.tsx)
// =============================================================================

/** Sparkline icon */
const SparklineIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M2 10L5 7L8 9L14 4" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="5" cy="7" r="1" fill="currentColor" />
    <circle cx="8" cy="9" r="1" fill="currentColor" />
    <circle cx="14" cy="4" r="1" fill="currentColor" />
  </svg>
);

/** Column sparkline icon */
const SparklineColumnIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="2" y="6" width="2" height="8" fill="currentColor" />
    <rect x="5" y="3" width="2" height="11" fill="currentColor" />
    <rect x="8" y="7" width="2" height="7" fill="currentColor" />
    <rect x="11" y="5" width="2" height="9" fill="currentColor" />
  </svg>
);

/** Win/Loss sparkline icon */
const SparklineWinLossIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="2" y="4" width="2" height="4" fill="var(--color-success, #4caf50)" />
    <rect x="5" y="8" width="2" height="4" fill="var(--color-error, #f44336)" />
    <rect x="8" y="4" width="2" height="4" fill="var(--color-success, #4caf50)" />
    <rect x="11" y="4" width="2" height="4" fill="var(--color-success, #4caf50)" />
  </svg>
);

/** Group icon */
const GroupIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="2" y="2" width="4" height="4" rx="0.5" />
    <rect x="10" y="2" width="4" height="4" rx="0.5" />
    <rect x="2" y="10" width="4" height="4" rx="0.5" />
    <rect x="10" y="10" width="4" height="4" rx="0.5" />
    <path d="M6 4H10M4 6V10M12 6V10M6 12H10" strokeLinecap="round" />
  </svg>
);

/** Ungroup icon */
const UngroupIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="2" y="2" width="4" height="4" rx="0.5" />
    <rect x="10" y="2" width="4" height="4" rx="0.5" />
    <rect x="2" y="10" width="4" height="4" rx="0.5" />
    <rect x="10" y="10" width="4" height="4" rx="0.5" />
  </svg>
);

// =============================================================================
// Component
// =============================================================================

export function SparklineToolsRibbon(_props: ContextualTabProps) {
  const deps = useActionDependencies();
  useDocumentContext();
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);

  // TODO: Get selected sparkline state from hooks when sparkline selection is implemented
  const selectedSparklineId: string | null = null;
  const currentType: SparklineType = 'line';

  // Show options state (will be connected to sparkline data)
  const [showHighPoint, setShowHighPoint] = useState(false);
  const [showLowPoint, setShowLowPoint] = useState(false);
  const [showFirstPoint, setShowFirstPoint] = useState(false);
  const [showLastPoint, setShowLastPoint] = useState(false);
  const [showNegativePoints, setShowNegativePoints] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false);

  // ==========================================================================
  // Handlers
  // ==========================================================================

  const handleChangeType = useCallback(
    (type: SparklineType) => {
      // TODO: Implement when sparkline type change action is added
      console.log('Change sparkline type to:', type);
      setTypeDropdownOpen(false);
    },
    [selectedSparklineId, deps],
  );

  const handleGroup = useCallback(() => {
    // TODO: Implement sparkline group action
    console.log('Group sparklines');
  }, [deps]);

  const handleUngroup = useCallback(() => {
    // TODO: Implement sparkline ungroup action
    console.log('Ungroup sparklines');
  }, [deps]);

  const handleClear = useCallback(() => {
    // TODO: Implement sparkline clear action
    console.log('Clear sparklines');
  }, [deps]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex items-center h-full gap-2 px-2">
      {/* Type Group */}
      <ToolbarGroup label="Type">
        <div className="flex items-center gap-0.5">
          <div className="relative">
            <RibbonButton
              id="sparkline-type"
              layout="vertical"
              height="full"
              data-testid="ribbon-dropdown-sparkline-type"
              icon={
                currentType === 'line' ? (
                  <SparklineIcon />
                ) : currentType === 'column' ? (
                  <SparklineColumnIcon />
                ) : (
                  <SparklineWinLossIcon />
                )
              }
              label="Type"
              onClick={() => setTypeDropdownOpen(!typeDropdownOpen)}
              title="Change sparkline type"
              aria-label="Change sparkline type"
              aria-haspopup="listbox"
              aria-expanded={typeDropdownOpen}
              hasDropdown
            />

            <RibbonDropdownPanel open={typeDropdownOpen} onClose={() => setTypeDropdownOpen(false)}>
              <div data-testid="ribbon-dropdown-menu-sparkline-type">
                {SPARKLINE_TYPES.map((option) => (
                  <RibbonDropdownItem
                    key={option.type}
                    dataValue={option.type}
                    onClick={() => handleChangeType(option.type)}
                    isSelected={option.type === currentType}
                  >
                    {option.label}
                  </RibbonDropdownItem>
                ))}
              </div>
            </RibbonDropdownPanel>
          </div>
        </div>
      </ToolbarGroup>

      {/* Show Group */}
      <ToolbarGroup label="Show">
        <div className="flex flex-col gap-1 py-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id="sparkline-high-point"
              checked={showHighPoint}
              onChange={(checked) => setShowHighPoint(checked)}
              label="High Point"
            />
            <Checkbox
              id="sparkline-low-point"
              checked={showLowPoint}
              onChange={(checked) => setShowLowPoint(checked)}
              label="Low Point"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="sparkline-first-point"
              checked={showFirstPoint}
              onChange={(checked) => setShowFirstPoint(checked)}
              label="First Point"
            />
            <Checkbox
              id="sparkline-last-point"
              checked={showLastPoint}
              onChange={(checked) => setShowLastPoint(checked)}
              label="Last Point"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="sparkline-negative-points"
              checked={showNegativePoints}
              onChange={(checked) => setShowNegativePoints(checked)}
              label="Negative Points"
            />
            <Checkbox
              id="sparkline-markers"
              checked={showMarkers}
              onChange={(checked) => setShowMarkers(checked)}
              label="Markers"
            />
          </div>
        </div>
      </ToolbarGroup>

      {/* Group Group */}
      <ToolbarGroup label="Group" isLast>
        <div className="flex items-center gap-0.5">
          <RibbonButton
            id="sparkline-group"
            layout="vertical"
            height="full"
            icon={<GroupIcon />}
            label="Group"
            onClick={handleGroup}
            title="Group selected sparklines"
            aria-label="Group sparklines"
          />
          <RibbonButton
            id="sparkline-ungroup"
            layout="vertical"
            height="full"
            icon={<UngroupIcon />}
            label="Ungroup"
            onClick={handleUngroup}
            title="Ungroup selected sparklines"
            aria-label="Ungroup sparklines"
          />
          <RibbonButton
            id="sparkline-clear"
            layout="vertical"
            height="full"
            icon={<DeleteIcon />}
            label="Clear"
            onClick={handleClear}
            title="Clear selected sparklines"
            aria-label="Clear sparklines"
          />
        </div>
      </ToolbarGroup>
    </div>
  );
}
