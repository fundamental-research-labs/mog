/**
 * Parameter Utilities
 *
 * Type-safe accessors for reading algorithm parameters from the generic
 * `Map<string, string>` param maps. These helpers validate that parameter
 * values belong to a known set before returning them, avoiding unsafe
 * `as` casts scattered across algorithm implementations.
 *
 * @module param-utils
 */

// =============================================================================
// Typed Parameter Accessor
// =============================================================================

/**
 * Read a typed parameter from a `Map<string, string>`, validating that
 * the value belongs to the given set of valid values.
 *
 * Returns `defaultValue` when:
 * - The key is not present in the map
 * - The value is not a member of `validValues`
 *
 * @param params - The algorithm parameter map
 * @param key - The parameter key to look up
 * @param validValues - The set of acceptable string values
 * @param defaultValue - Fallback when the key is missing or invalid
 * @returns The validated parameter value or the default
 *
 * @complexity O(1) - single Map.get + Set.has
 * @sideEffects None - pure function
 *
 * @example
 * ```ts
 * const VALID_FLOW_DIRS = new Set<FlowDirectionValue>(['row', 'col']);
 * const flowDir = getTypedParam(params, 'flowDir', VALID_FLOW_DIRS, 'row');
 * ```
 */
export function getTypedParam<T extends string>(
  params: Map<string, string>,
  key: string,
  validValues: ReadonlySet<T>,
  defaultValue: T,
): T {
  const value = params.get(key);
  if (value !== undefined && validValues.has(value as T)) return value as T;
  return defaultValue;
}

/**
 * Read an optional typed parameter from a `Map<string, string>`.
 *
 * Same as `getTypedParam` but returns `undefined` instead of a default
 * when the key is not present. Still validates against `validValues`
 * when the key IS present.
 *
 * @param params - The algorithm parameter map
 * @param key - The parameter key to look up
 * @param validValues - The set of acceptable string values
 * @returns The validated parameter value or undefined
 *
 * @complexity O(1) - single Map.get + Set.has
 * @sideEffects None - pure function
 */
export function getOptionalTypedParam<T extends string>(
  params: Map<string, string>,
  key: string,
  validValues: ReadonlySet<T>,
): T | undefined {
  const value = params.get(key);
  if (value !== undefined && validValues.has(value as T)) return value as T;
  return undefined;
}
