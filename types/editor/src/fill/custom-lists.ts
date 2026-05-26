/**
 * Custom Lists Types
 *
 * Type definitions for user-defined fill lists.
 * Runtime constant (BUILT_IN_LISTS) has been moved to
 * @mog-sdk/kernel/domain/fill/custom-lists.
 *
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A custom fill list.
 */
export interface CustomList {
  /** Unique ID for the list */
  id: string;
  /** Display name for the list */
  name: string;
  /** The list values in order */
  values: string[];
  /** Whether this is a built-in list (cannot be deleted) */
  isBuiltIn?: boolean;
}

/**
 * Custom list registry interface.
 * Implementations provide storage and lookup for custom lists.
 */
export interface CustomListRegistry {
  /** All custom lists */
  lists: CustomList[];
  /** Get list by ID */
  getList(id: string): CustomList | undefined;
  /** Find list that contains a value */
  findListContainingValue(value: string): CustomList | undefined;
  /** Add a new list */
  addList(name: string, values: string[]): CustomList;
  /** Remove a list */
  removeList(id: string): boolean;
  /** Update a list */
  updateList(id: string, values: string[]): boolean;
}
