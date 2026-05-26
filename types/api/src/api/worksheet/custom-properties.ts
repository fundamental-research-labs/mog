/**
 * WorksheetCustomProperties — Sub-API for sheet-level custom properties.
 *
 * Provides a key-value store scoped to a single worksheet.
 * Properties are persisted via sheet settings as a JSON-serialized object.
 */

/** Sub-API for worksheet custom property operations. */
export interface WorksheetCustomProperties {
  /**
   * Get a custom property value by key.
   *
   * @param key - Property key
   * @returns The property value, or undefined if not set
   */
  get(key: string): Promise<string | number | boolean | undefined>;

  /**
   * Set a custom property.
   *
   * @param key - Property key
   * @param value - Property value (string, number, or boolean)
   */
  set(key: string, value: string | number | boolean): Promise<void>;

  /**
   * Delete a custom property.
   *
   * @param key - Property key to delete
   * @returns True if the property existed and was deleted, false otherwise
   */
  delete(key: string): Promise<boolean>;

  /**
   * Get all custom properties as a record.
   *
   * @returns Record of all custom property key-value pairs
   */
  getAll(): Promise<Record<string, string | number | boolean>>;

  /**
   * Get the count of custom properties.
   *
   * @returns Number of custom properties currently set
   */
  count(): Promise<number>;
}
