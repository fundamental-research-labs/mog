/**
 * CapabilityItem - Individual capability display component
 *
 * Shows a single capability with:
 * - Icon based on capability type
 * - Name and description
 * - Risk badge (color-coded)
 * - Toggle for optional capabilities
 * - Tooltip with full details
 *
 */

import React from 'react';

import { getCapabilityInfo } from '@mog-sdk/kernel/security';
import type { CapabilityRiskLevel, CapabilityType } from '@mog-sdk/contracts/capabilities';
import { Checkbox } from '../ui/radix/Checkbox';
import { Tooltip } from '../ui/radix/Tooltip';

// =============================================================================
// Types
// =============================================================================

export interface CapabilityItemProps {
  /** The capability to display */
  capability: CapabilityType;
  /** Optional reason why this capability is requested */
  reason?: string;
  /** Whether this is an optional capability (shows toggle) */
  isOptional?: boolean;
  /** Whether the capability is selected (for optional) */
  isSelected?: boolean;
  /** Callback when selection changes (for optional) */
  onSelectionChange?: (selected: boolean) => void;
  /** Whether the capability is disabled */
  disabled?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Whether to show a compact version */
  compact?: boolean;
}

// =============================================================================
// Risk Level Configuration
// =============================================================================

interface RiskConfig {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
}

const RISK_CONFIGS: Record<CapabilityRiskLevel, RiskConfig> = {
  low: {
    label: 'Low',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
    borderClass: 'border-green-200',
  },
  medium: {
    label: 'Medium',
    bgClass: 'bg-yellow-50',
    textClass: 'text-yellow-700',
    borderClass: 'border-yellow-200',
  },
  high: {
    label: 'High',
    bgClass: 'bg-orange-50',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-200',
  },
  critical: {
    label: 'Critical',
    bgClass: 'bg-red-50',
    textClass: 'text-red-700',
    borderClass: 'border-red-200',
  },
};

// =============================================================================
// Capability Icons
// =============================================================================

/**
 * Get icon for a capability based on its category.
 */
function getCapabilityIcon(capability: CapabilityType): React.JSX.Element {
  const category = capability.split(':')[0];

  const iconProps = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (category) {
    case 'cells':
      // Grid icon for cells
      return (
        <svg {...iconProps}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      );

    case 'sheets':
      // Layers icon for sheets
      return (
        <svg {...iconProps}>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      );

    case 'tables':
    case 'allTables':
      // Table icon
      return (
        <svg {...iconProps}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
      );

    case 'formulas':
      // Function icon
      return (
        <svg {...iconProps}>
          <path d="M4 4h6v6H4z" />
          <path d="M14 4h6v6h-6z" />
          <path d="M4 14h6v6H4z" />
          <path d="M17 14v4h-4" />
          <line x1="14" y1="17" x2="17" y2="14" />
        </svg>
      );

    case 'formatting':
      // Paint brush icon
      return (
        <svg {...iconProps}>
          <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
          <path d="M9 9h.01" />
          <path d="M15 9h.01" />
          <path d="M9 15c.83 1.17 2.08 2 3.5 2s2.67-.83 3.5-2" />
        </svg>
      );

    case 'events':
      // Bell icon for events
      return (
        <svg {...iconProps}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );

    case 'clipboard':
      // Clipboard icon
      return (
        <svg {...iconProps}>
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>
      );

    case 'undo':
      // Undo icon
      return (
        <svg {...iconProps}>
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
      );

    case 'notifications':
      // Bell/notification icon
      return (
        <svg {...iconProps}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );

    case 'checkpoints':
      // Save/checkpoint icon
      return (
        <svg {...iconProps}>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      );

    case 'filesystem':
      // Folder icon
      return (
        <svg {...iconProps}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );

    case 'dialogs':
      // Window icon
      return (
        <svg {...iconProps}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
        </svg>
      );

    case 'shell':
      // Terminal icon
      return (
        <svg {...iconProps}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );

    case 'network':
      // Globe icon
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );

    case 'connections':
      // Database icon
      return (
        <svg {...iconProps}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );

    case 'credentials':
      // Key/lock icon
      return (
        <svg {...iconProps}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );

    case 'allCells':
      // Grid with star for all cells
      return (
        <svg {...iconProps}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
          <polygon points="12 14 13.5 17 17 17.5 14.5 20 15 23 12 21.5 9 23 9.5 20 7 17.5 10.5 17" />
        </svg>
      );

    case 'recalc':
      // Refresh icon
      return (
        <svg {...iconProps}>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );

    default:
      // Default shield icon
      return (
        <svg {...iconProps}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
  }
}

// =============================================================================
// Risk Badge Component
// =============================================================================

interface RiskBadgeProps {
  riskLevel: CapabilityRiskLevel;
  compact?: boolean;
}

function RiskBadge({ riskLevel, compact = false }: RiskBadgeProps): React.JSX.Element {
  const config = RISK_CONFIGS[riskLevel];

  return (
    <span
      className={`
        inline-flex items-center rounded-full font-medium
        ${config.bgClass} ${config.textClass} border ${config.borderClass}
        ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-caption'}
      `}
    >
      {config.label}
    </span>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * CapabilityItem - Display a single capability with its details.
 *
 * @example Required capability
 * ```tsx
 * <CapabilityItem
 *   capability="cells:write"
 *   reason="To modify spreadsheet data"
 * />
 * ```
 *
 * @example Optional capability with toggle
 * ```tsx
 * <CapabilityItem
 *   capability="filesystem:write"
 *   isOptional
 *   isSelected={selected}
 *   onSelectionChange={setSelected}
 *   reason="To save exports to disk"
 * />
 * ```
 */
export function CapabilityItem({
  capability,
  reason,
  isOptional = false,
  isSelected = true,
  onSelectionChange,
  disabled = false,
  className = '',
  compact = false,
}: CapabilityItemProps): React.JSX.Element {
  const info = getCapabilityInfo(capability);
  const icon = getCapabilityIcon(capability);

  const handleChange = (checked: boolean) => {
    if (!disabled && onSelectionChange) {
      onSelectionChange(checked);
    }
  };

  const content = (
    <div
      className={`
        flex items-start gap-3 p-3 rounded-ss-md border border-ss-border
        ${disabled ? 'opacity-50' : 'hover:bg-ss-surface-hover'}
        ${info.riskLevel === 'critical' ? 'border-red-200 bg-red-50/30' : ''}
        ${info.riskLevel === 'high' ? 'border-orange-200 bg-orange-50/30' : ''}
        ${className}
      `}
    >
      {/* Optional checkbox */}
      {isOptional && (
        <div className="pt-0.5">
          <Checkbox checked={isSelected} onChange={handleChange} disabled={disabled} />
        </div>
      )}

      {/* Icon */}
      <div
        className={`
          flex-shrink-0 p-2 rounded-ss-md
          ${info.riskLevel === 'critical' ? 'bg-red-100 text-red-600' : ''}
          ${info.riskLevel === 'high' ? 'bg-orange-100 text-orange-600' : ''}
          ${info.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-600' : ''}
          ${info.riskLevel === 'low' ? 'bg-green-100 text-green-600' : ''}
        `}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium text-text ${compact ? 'text-body-sm' : 'text-body'}`}>
            {info.name}
          </span>
          <RiskBadge riskLevel={info.riskLevel} compact={compact} />
          {info.sessionOnly && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 border border-blue-200">
              Session Only
            </span>
          )}
          {info.requiresAuth && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-50 text-purple-600 border border-purple-200">
              Requires Auth
            </span>
          )}
        </div>
        <p className={`text-ss-text-secondary mt-0.5 ${compact ? 'text-caption' : 'text-body-sm'}`}>
          {info.description}
        </p>
        {reason && (
          <p
            className={`text-ss-text-tertiary mt-1 italic ${compact ? 'text-[10px]' : 'text-caption'}`}
          >
            Reason: {reason}
          </p>
        )}
      </div>
    </div>
  );

  // Wrap in tooltip for more details
  if (!compact) {
    let tooltipDescription = `Tier ${info.tier} capability`;
    if (info.sessionOnly) {
      tooltipDescription += ' - This permission expires when you close the app.';
    }
    if (info.requiresAuth) {
      tooltipDescription += ' - This permission requires re-authentication.';
    }

    return (
      <Tooltip title={capability} description={tooltipDescription} side="right">
        {content}
      </Tooltip>
    );
  }

  return content;
}

// =============================================================================
// Exports
// =============================================================================

export { getCapabilityIcon, RISK_CONFIGS, RiskBadge };
export type { RiskBadgeProps, RiskConfig };
