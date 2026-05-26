/**
 * Custom Lists Constants
 *
 * Built-in custom fill lists that are always available.
 * These can be used as fill patterns for autofill operations.
 *
 * Extracted from @mog-sdk/contracts/fill (purity extraction).
 * Types (CustomList, CustomListRegistry) remain in contracts.
 *
 */

import type { CustomList } from '@mog-sdk/contracts/fill';

// =============================================================================
// Built-in Lists (Default Custom Lists)
// =============================================================================

/**
 * Built-in custom lists that are always available.
 * These can be used as fill patterns.
 */
export const BUILT_IN_LISTS: readonly CustomList[] = [
  {
    id: 'builtin-priority',
    name: 'Priority',
    values: ['High', 'Medium', 'Low'],
    isBuiltIn: true,
  },
  {
    id: 'builtin-directions',
    name: 'Directions',
    values: ['North', 'South', 'East', 'West'],
    isBuiltIn: true,
  },
  {
    id: 'builtin-status',
    name: 'Status',
    values: ['Not Started', 'In Progress', 'Complete'],
    isBuiltIn: true,
  },
  {
    id: 'builtin-traffic-light',
    name: 'Traffic Light',
    values: ['Red', 'Yellow', 'Green'],
    isBuiltIn: true,
  },
  {
    id: 'builtin-size',
    name: 'Size',
    values: ['Small', 'Medium', 'Large', 'Extra Large'],
    isBuiltIn: true,
  },
  {
    id: 'builtin-rating',
    name: 'Rating',
    values: ['Poor', 'Fair', 'Good', 'Excellent'],
    isBuiltIn: true,
  },
  {
    id: 'builtin-weekdays-abbrev',
    name: 'Weekdays (Abbreviated)',
    values: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    isBuiltIn: true,
  },
  {
    id: 'builtin-weekdays-full',
    name: 'Weekdays (Full)',
    values: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    isBuiltIn: true,
  },
] as const;
