/**
 * CF Rule Row Component
 *
 * Displays a single conditional formatting rule in the Rules Manager.
 * Shows rule type, visual preview, range, and action buttons.
 *
 *
 *
 * Refactored to use IconButton instead of emoji buttons for professional appearance.
 */

import { useMemo } from 'react';

import { DialogTableRow, IconButton } from '@mog/shell';
import type {
  CFAboveAverageRule,
  CFCellValueRule,
  CFColorScaleRule,
  CFContainsTextRule,
  CFDataBarRule,
  CFDuplicateValuesRule,
  CFIconSetRule,
  CFRule,
  CFRuleType,
  CFTop10Rule,
  ConditionalFormat,
} from '@mog-sdk/contracts/conditional-format';

// =============================================================================
// Types
// =============================================================================

interface CFRuleRowProps {
  format: ConditionalFormat;
  rule: CFRule;
  /** Display index of this row inside the Rules Manager list (0-based). Used
   * to mint stable test selectors like `cf-rule-0-stop-if-true`. */
  index: number;
  rangeDisplay: string;
  sheetName?: string;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** Handler for Stop If True checkbox toggle (12.2: Stop If True UI) */
  onToggleStopIfTrue: (checked: boolean) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get display name for a rule type
 */
function getRuleTypeName(type: CFRuleType): string {
  switch (type) {
    case 'dataBar':
      return 'Data Bar';
    case 'colorScale':
      return 'Color Scale';
    case 'iconSet':
      return 'Icon Set';
    case 'cellValue':
      return 'Cell Value';
    case 'top10':
      return 'Top/Bottom';
    case 'aboveAverage':
      return 'Above/Below Average';
    case 'duplicateValues':
      return 'Duplicates';
    case 'containsText':
      return 'Text Contains';
    case 'containsBlanks':
      return 'Blanks';
    case 'containsErrors':
      return 'Errors';
    case 'formula':
      return 'Formula';
    default:
      return 'Unknown';
  }
}

function getRuleDisplayName(rule: CFRule): string {
  if (rule.type !== 'cellValue') {
    return getRuleTypeName(rule.type);
  }

  const cvRule = rule as CFCellValueRule;
  const operatorNames: Record<string, string> = {
    greaterThan: 'Greater Than',
    lessThan: 'Less Than',
    greaterThanOrEqual: 'Greater Than Or Equal',
    lessThanOrEqual: 'Less Than Or Equal',
    equal: 'Equal To',
    notEqual: 'Not Equal To',
    between: 'Between',
    notBetween: 'Not Between',
  };

  return operatorNames[cvRule.operator] ?? getRuleTypeName(rule.type);
}

/**
 * Get description for a rule
 */
function getRuleDescription(rule: CFRule): string {
  switch (rule.type) {
    case 'dataBar': {
      const dbRule = rule as CFDataBarRule;
      return dbRule.dataBar.gradient ? 'Gradient fill' : 'Solid fill';
    }
    case 'colorScale': {
      const csRule = rule as CFColorScaleRule;
      return csRule.colorScale.midPoint ? '3-color scale' : '2-color scale';
    }
    case 'iconSet': {
      const isRule = rule as CFIconSetRule;
      return isRule.iconSet.iconSetName.replace(/(\d)/, ' $1 ');
    }
    case 'cellValue': {
      const cvRule = rule as CFCellValueRule;
      const opDisplay: Record<string, string> = {
        greaterThan: '>',
        lessThan: '<',
        greaterThanOrEqual: '>=',
        lessThanOrEqual: '<=',
        equal: '=',
        notEqual: '!=',
        between: 'between',
        notBetween: 'not between',
      };
      return `${opDisplay[cvRule.operator] || cvRule.operator} ${cvRule.value1}`;
    }
    case 'top10': {
      const t10Rule = rule as CFTop10Rule;
      const prefix = t10Rule.bottom ? 'Bottom' : 'Top';
      const suffix = t10Rule.percent ? '%' : ' items';
      return `${prefix} ${t10Rule.rank}${suffix}`;
    }
    case 'aboveAverage': {
      const aaRule = rule as CFAboveAverageRule;
      return aaRule.aboveAverage ? 'Above average' : 'Below average';
    }
    case 'duplicateValues': {
      const dvRule = rule as CFDuplicateValuesRule;
      return dvRule.unique ? 'Unique values' : 'Duplicate values';
    }
    case 'containsText': {
      const ctRule = rule as CFContainsTextRule;
      return `"${ctRule.text}"`;
    }
    default:
      return '';
  }
}

/**
 * Get preview style for a rule
 */
function getPreviewStyle(rule: CFRule): React.CSSProperties {
  const baseStyle: React.CSSProperties = {
    width: '32px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  switch (rule.type) {
    case 'dataBar': {
      const dbRule = rule as CFDataBarRule;
      const color = dbRule.dataBar.positiveColor || '#638EC6';
      return {
        ...baseStyle,
        background: dbRule.dataBar.gradient
          ? `linear-gradient(to right, ${color}CC 0%, ${color}40 60%, transparent 60%)`
          : `linear-gradient(to right, ${color} 60%, transparent 60%)`,
        border: '1px solid var(--color-ss-border)',
      };
    }
    case 'colorScale': {
      const csRule = rule as CFColorScaleRule;
      const { minPoint, midPoint, maxPoint } = csRule.colorScale;
      const gradient = midPoint
        ? `linear-gradient(to right, ${minPoint.color}, ${midPoint.color}, ${maxPoint.color})`
        : `linear-gradient(to right, ${minPoint.color}, ${maxPoint.color})`;
      return {
        ...baseStyle,
        background: gradient,
        border: '1px solid var(--color-ss-border)',
      };
    }
    case 'iconSet': {
      return {
        ...baseStyle,
        fontSize: '14px',
        border: '1px solid var(--color-ss-border)',
        backgroundColor: 'var(--color-ss-surface)',
      };
    }
    case 'cellValue':
    case 'top10':
    case 'aboveAverage':
    case 'duplicateValues':
    case 'containsText': {
      // Try to get background color from style
      const styleRule = rule as { style?: { backgroundColor?: string } };
      const bgColor = styleRule.style?.backgroundColor || '#FCE8E6';
      return {
        ...baseStyle,
        backgroundColor: bgColor,
        border: '1px solid var(--color-ss-border)',
      };
    }
    default:
      return {
        ...baseStyle,
        backgroundColor: 'var(--color-ss-surface-tertiary)',
        border: '1px solid var(--color-ss-border)',
      };
  }
}

/**
 * Get icon preview content for icon set rules
 */
function getIconPreviewContent(rule: CFRule): string {
  if (rule.type !== 'iconSet') return '';

  const isRule = rule as CFIconSetRule;
  const iconSetName = isRule.iconSet.iconSetName;

  // Simple icon representations
  if (iconSetName.includes('Arrow')) return '↑→↓';
  if (iconSetName.includes('TrafficLight')) return '🔴🟡🟢';
  if (iconSetName.includes('Flag')) return '🚩';
  if (iconSetName.includes('Star')) return '⭐';
  if (iconSetName.includes('Rating')) return '★★★';
  if (iconSetName.includes('Symbol')) return '✓✗';
  if (iconSetName.includes('Sign')) return '⚠';
  if (iconSetName.includes('Triangle')) return '▲▬▼';
  if (iconSetName.includes('Quarter')) return '◔◑◕';
  if (iconSetName.includes('Box')) return '▪▪▪';

  return '📊';
}

// =============================================================================
// Component
// =============================================================================

// Table column configuration (must match DialogTable in CFRulesManager)
// Updated for 12.2: Added Stop If True column
const COLUMN_WIDTHS = '1fr 90px 80px 100px';

export function CFRuleRow({
  format: _format,
  rule,
  index,
  rangeDisplay,
  sheetName,
  isSelected,
  isFirst,
  isLast,
  onSelect,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onToggleStopIfTrue,
}: CFRuleRowProps) {
  void _format; // Suppress unused variable warning
  const previewStyle = useMemo(() => getPreviewStyle(rule), [rule]);
  const iconContent = useMemo(() => getIconPreviewContent(rule), [rule]);

  // Handler for delete
  const handleDelete = () => {
    onDelete();
  };

  return (
    <DialogTableRow columnWidths={COLUMN_WIDTHS} isSelected={isSelected} onClick={onSelect}>
      {/* Rule Info */}
      <div className="flex items-center gap-3">
        <div className="rounded-ss-sm text-caption" style={previewStyle}>
          {rule.type === 'iconSet' && iconContent}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-body-sm font-medium text-text whitespace-nowrap overflow-hidden text-ellipsis">
            {getRuleDisplayName(rule)}
            {sheetName && (
              <span className="text-caption text-ss-text-secondary bg-ss-surface-secondary px-1.5 py-0.5 rounded-full ml-2">
                {sheetName}
              </span>
            )}
          </div>
          <div className="text-caption text-ss-text-secondary whitespace-nowrap overflow-hidden text-ellipsis">
            {getRuleDescription(rule)}
          </div>
        </div>
      </div>

      {/* Range */}
      <div className="text-caption text-ss-text-secondary font-ss-mono">{rangeDisplay}</div>

      {/* Stop If True (12.2: Stop If True UI in Rules Manager) */}
      <div className="flex items-center justify-center">
        <input
          type="checkbox"
          checked={rule.stopIfTrue ?? false}
          onChange={(e) => {
            e.stopPropagation(); // Prevent row selection
            onToggleStopIfTrue(e.target.checked);
          }}
          className="h-4 w-4 rounded border-ss-border-default text-ss-brand-primary focus:ring-brand-primary"
          title="When checked, stop evaluating more rules for cells matching this rule"
          data-testid={`cf-rule-${index}-stop-if-true`}
        />
      </div>

      {/* Actions - using IconButton instead of emoji buttons */}
      <div className="flex gap-1 justify-end">
        <IconButton
          icon="arrow-up"
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up (higher priority)"
          size="sm"
          testId={`cf-rule-${index}-move-up`}
        />
        <IconButton
          icon="arrow-down"
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down (lower priority)"
          size="sm"
          testId={`cf-rule-${index}-move-down`}
        />
        <IconButton
          icon="edit"
          onClick={onEdit}
          title="Edit rule"
          size="sm"
          testId={`cf-rule-${index}-edit`}
        />
        <IconButton
          icon="delete"
          onClick={handleDelete}
          title="Delete rule"
          variant="danger"
          size="sm"
          testId={`cf-rule-${index}-delete`}
        />
      </div>
    </DialogTableRow>
  );
}
