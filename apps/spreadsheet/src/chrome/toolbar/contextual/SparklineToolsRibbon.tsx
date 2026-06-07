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

import { useCallback, useMemo, useState } from 'react';
import { useActiveCell, useActiveSheetId, useSparklineManager } from '../../../internal-api';

import { Checkbox } from '@mog/shell';
import type {
  Sparkline,
  SparklineGroup,
  SparklineType,
  SparklineVisualSettings,
} from '@mog-sdk/contracts/sparklines';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownItem, RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import { DeleteIcon } from '../primitives/ToolbarIcons';
import type { ContextualTabProps } from './contextual-tab-registry';

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

const DEFAULT_VISUAL: SparklineVisualSettings = {
  color: '#4472C4',
};

const DEFAULT_NEGATIVE_COLOR = '#C00000';
const DEFAULT_HIGH_POINT_COLOR = '#00B050';
const DEFAULT_LOW_POINT_COLOR = '#FF0000';
const DEFAULT_FIRST_POINT_COLOR = '#4472C4';
const DEFAULT_LAST_POINT_COLOR = '#4472C4';

type SparklinePointColorKey =
  | 'negativeColor'
  | 'highPointColor'
  | 'lowPointColor'
  | 'firstPointColor'
  | 'lastPointColor';

const DEFAULT_POINT_COLORS: Record<SparklinePointColorKey, string> = {
  negativeColor: DEFAULT_NEGATIVE_COLOR,
  highPointColor: DEFAULT_HIGH_POINT_COLOR,
  lowPointColor: DEFAULT_LOW_POINT_COLOR,
  firstPointColor: DEFAULT_FIRST_POINT_COLOR,
  lastPointColor: DEFAULT_LAST_POINT_COLOR,
};

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
  const { activeCell } = useActiveCell();
  const activeSheetId = useActiveSheetId();
  const { sparklineManager } = useSparklineManager();
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [sparklineRevision, setSparklineRevision] = useState(0);

  const { selectedSparkline, selectedGroup } = useMemo(() => {
    const sparkline =
      sparklineManager.getSparklineAtCell(activeSheetId, activeCell.row, activeCell.col) ?? null;
    const group =
      sparkline?.groupId != null
        ? (sparklineManager.getSparklineGroup(sparkline.groupId) ?? null)
        : null;
    return { selectedSparkline: sparkline, selectedGroup: group };
  }, [activeCell.col, activeCell.row, activeSheetId, sparklineManager, sparklineRevision]);

  const currentType: SparklineType = selectedGroup?.type ?? selectedSparkline?.type ?? 'line';
  const currentVisual: SparklineVisualSettings =
    selectedGroup?.visual ?? selectedSparkline?.visual ?? DEFAULT_VISUAL;
  const canEditSparkline = selectedSparkline != null;
  const canUngroupSparkline = selectedSparkline?.groupId != null;

  const showHighPoint = Boolean(currentVisual.highPointColor);
  const showLowPoint = Boolean(currentVisual.lowPointColor);
  const showFirstPoint = Boolean(currentVisual.firstPointColor);
  const showLastPoint = Boolean(currentVisual.lastPointColor);
  const showNegativePoints = Boolean(currentVisual.negativeColor);
  const showMarkers = currentVisual.showMarkers === true;

  // ==========================================================================
  // Handlers
  // ==========================================================================

  const updateSelectedSparkline = useCallback(
    async (updates: Pick<Partial<Sparkline>, 'type' | 'visual'>) => {
      if (!selectedSparkline) {
        return;
      }

      if (selectedGroup) {
        await sparklineManager.updateSparklineGroup(
          selectedGroup.id,
          updates as Pick<Partial<SparklineGroup>, 'type' | 'visual'>,
        );
      } else {
        await sparklineManager.updateSparkline(selectedSparkline.id, updates);
      }

      setSparklineRevision((revision) => revision + 1);
    },
    [selectedGroup, selectedSparkline, sparklineManager],
  );

  const handleChangeType = useCallback(
    (type: SparklineType) => {
      void updateSelectedSparkline({ type });
      setTypeDropdownOpen(false);
    },
    [updateSelectedSparkline],
  );

  const handleTogglePointColor = useCallback(
    (key: SparklinePointColorKey, checked: boolean) => {
      const nextVisual: SparklineVisualSettings = {
        ...currentVisual,
        [key]: checked ? (currentVisual[key] ?? DEFAULT_POINT_COLORS[key]) : undefined,
      };
      void updateSelectedSparkline({ visual: nextVisual });
    },
    [currentVisual, updateSelectedSparkline],
  );

  const handleToggleMarkers = useCallback(
    (checked: boolean) => {
      void updateSelectedSparkline({
        visual: {
          ...currentVisual,
          showMarkers: checked,
        },
      });
    },
    [currentVisual, updateSelectedSparkline],
  );

  const handleUngroup = useCallback(() => {
    if (!selectedSparkline?.groupId) {
      return;
    }
    void sparklineManager.ungroupSparklines(selectedSparkline.groupId).then(() => {
      setSparklineRevision((revision) => revision + 1);
    });
  }, [selectedSparkline?.groupId, sparklineManager]);

  const handleClear = useCallback(() => {
    if (!selectedSparkline) {
      return;
    }
    void sparklineManager.deleteSparkline(selectedSparkline.id).then(() => {
      setSparklineRevision((revision) => revision + 1);
    });
  }, [selectedSparkline, sparklineManager]);

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
              disabled={!canEditSparkline}
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
              onChange={(checked) => handleTogglePointColor('highPointColor', checked)}
              label="High Point"
              disabled={!canEditSparkline}
            />
            <Checkbox
              id="sparkline-low-point"
              checked={showLowPoint}
              onChange={(checked) => handleTogglePointColor('lowPointColor', checked)}
              label="Low Point"
              disabled={!canEditSparkline}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="sparkline-first-point"
              checked={showFirstPoint}
              onChange={(checked) => handleTogglePointColor('firstPointColor', checked)}
              label="First Point"
              disabled={!canEditSparkline}
            />
            <Checkbox
              id="sparkline-last-point"
              checked={showLastPoint}
              onChange={(checked) => handleTogglePointColor('lastPointColor', checked)}
              label="Last Point"
              disabled={!canEditSparkline}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="sparkline-negative-points"
              checked={showNegativePoints}
              onChange={(checked) => handleTogglePointColor('negativeColor', checked)}
              label="Negative Points"
              disabled={!canEditSparkline}
            />
            <Checkbox
              id="sparkline-markers"
              checked={showMarkers}
              onChange={handleToggleMarkers}
              label="Markers"
              disabled={!canEditSparkline}
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
            disabled
            title="Group selected sparklines"
            aria-label="Group sparklines"
            role="button"
          />
          <RibbonButton
            id="sparkline-ungroup"
            layout="vertical"
            height="full"
            icon={<UngroupIcon />}
            label="Ungroup"
            onClick={handleUngroup}
            disabled={!canUngroupSparkline}
            title="Ungroup selected sparklines"
            aria-label="Ungroup sparklines"
            role="button"
          />
          <RibbonButton
            id="sparkline-clear"
            layout="vertical"
            height="full"
            icon={<DeleteIcon />}
            label="Clear"
            onClick={handleClear}
            disabled={!canEditSparkline}
            title="Clear selected sparklines"
            aria-label="Clear sparklines"
            role="button"
          />
        </div>
      </ToolbarGroup>
    </div>
  );
}
