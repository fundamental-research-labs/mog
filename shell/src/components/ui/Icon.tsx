/**
 * Icon Component
 *
 * Unified icon system for UI elements.
 * All icons sourced from @mog/icons - single source of truth.
 *
 * Use this for icons in dialogs, forms, and general UI.
 * For toolbar icons, continue using ToolbarIcons.tsx directly.
 *
 * @example
 * ```tsx
 * import { Icon } from '../ui';
 *
 * <Icon name="edit" />
 * <Icon name="delete" size="sm" className="text-ss-error" />
 * ```
 */

import {
  AddSvg,
  ArrowDownSvg,
  ArrowUpSvg,
  CheckmarkSvg,
  ChevronDownSvg,
  ChevronUpSvg,
  CollapseSvg,
  DeleteSvg,
  DocumentListSvg,
  EditSvg,
  InfoSvg,
  LockSvg,
  SearchSvg,
  WarningSvg,
} from '@mog/icons';

import type { ComponentType, SVGProps } from 'react';

// =============================================================================
// Types
// =============================================================================

export type IconName =
  | 'add'
  | 'arrow-down'
  | 'arrow-up'
  | 'checkmark'
  | 'chevron-down'
  | 'chevron-up'
  | 'collapse'
  | 'delete'
  | 'document-list'
  | 'edit'
  | 'info'
  | 'lock'
  | 'search'
  | 'warning';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg';

export interface IconProps {
  /** Icon name from the available set */
  name: IconName;
  /** Size variant */
  size?: IconSize;
  /** Additional CSS classes */
  className?: string;
  /** Accessible label (required for standalone icons without text) */
  'aria-label'?: string;
}

// =============================================================================
// Icon Mappings
// =============================================================================

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>;

const iconMap: Record<IconName, SvgIcon> = {
  add: AddSvg,
  'arrow-down': ArrowDownSvg,
  'arrow-up': ArrowUpSvg,
  checkmark: CheckmarkSvg,
  'chevron-down': ChevronDownSvg,
  'chevron-up': ChevronUpSvg,
  collapse: CollapseSvg,
  delete: DeleteSvg,
  'document-list': DocumentListSvg,
  edit: EditSvg,
  info: InfoSvg,
  lock: LockSvg,
  search: SearchSvg,
  warning: WarningSvg,
};

const sizeMap: Record<IconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
};

// =============================================================================
// Component
// =============================================================================

/**
 * Icon - Renders an icon with consistent sizing.
 *
 * Icons inherit text color by default via `currentColor`.
 * Use className to override color (e.g., `className="text-ss-error"`).
 */
export function Icon({ name, size = 'md', className = '', 'aria-label': ariaLabel }: IconProps) {
  const IconComponent = iconMap[name];
  const iconSize = sizeMap[size];

  if (!IconComponent) {
    console.warn(`Icon "${name}" not found in icon map`);
    return null;
  }

  return (
    <IconComponent
      className={`shrink-0 ${className}`}
      style={{ width: iconSize, height: iconSize }}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
    />
  );
}
