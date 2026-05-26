/**
 * Custom Lists - User-defined fill lists
 *
 * This module provides support for user-defined fill lists like:
 * - High, Medium, Low
 * - North, South, East, West
 * - Custom team names, project phases, etc.
 *
 * Custom lists are stored per workbook and synced via Yjs for collaboration.
 *
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import type { CustomList, CustomListRegistry } from '@mog-sdk/contracts/fill';

import type { FillPattern } from './types';

export type { CustomList, CustomListRegistry };

// =============================================================================
// Custom List Registry Implementation
// =============================================================================

/**
 * In-memory custom list registry.
 * For persistence, this should be backed by Yjs in a real implementation.
 */
export class InMemoryCustomListRegistry implements CustomListRegistry {
  private _lists: CustomList[] = [];
  private nextId = 1;

  constructor(initialLists: readonly CustomList[] = []) {
    this._lists = [...initialLists];
  }

  get lists(): CustomList[] {
    return this._lists;
  }

  getList(id: string): CustomList | undefined {
    return this._lists.find((l) => l.id === id);
  }

  findListContainingValue(value: string): CustomList | undefined {
    const normalizedValue = value.toLowerCase().trim();
    return this._lists.find((list) =>
      list.values.some((v) => v.toLowerCase().trim() === normalizedValue),
    );
  }

  addList(name: string, values: string[]): CustomList {
    const id = `custom-${this.nextId++}`;
    const list: CustomList = { id, name, values };
    this._lists.push(list);
    return list;
  }

  removeList(id: string): boolean {
    const index = this._lists.findIndex((l) => l.id === id);
    if (index === -1) return false;
    const list = this._lists[index];
    if (list.isBuiltIn) return false; // Cannot delete built-in lists
    this._lists.splice(index, 1);
    return true;
  }

  updateList(id: string, values: string[]): boolean {
    const list = this._lists.find((l) => l.id === id);
    if (!list) return false;
    if (list.isBuiltIn) return false; // Cannot modify built-in lists
    list.values = values;
    return true;
  }
}

// =============================================================================
// Pattern Detection for Custom Lists
// =============================================================================

/**
 * Detect if values match a custom list pattern.
 *
 * @param values - Cell values to check
 * @param registry - Custom list registry to search in
 * @returns FillPattern if values match a custom list, null otherwise
 */
export function detectCustomListPattern(
  values: CellValue[],
  registry: CustomListRegistry,
): FillPattern | null {
  // All values must be strings
  if (!values.every((v) => typeof v === 'string')) return null;
  if (values.length < 1) return null;

  const strings = values as string[];
  const normalizedStrings = strings.map((s) => s.toLowerCase().trim());

  // Find a list that contains the first value
  const list = registry.findListContainingValue(strings[0]);
  if (!list) return null;

  // Get the index of the first value in the list
  const normalizedListValues = list.values.map((v) => v.toLowerCase().trim());
  const firstIndex = normalizedListValues.indexOf(normalizedStrings[0]);
  if (firstIndex === -1) return null;

  // Verify all values are from this list in sequence
  for (let i = 1; i < strings.length; i++) {
    const expectedIndex = (firstIndex + i) % list.values.length;
    const actualValue = normalizedStrings[i];
    if (normalizedListValues[expectedIndex] !== actualValue) return null;
  }

  return {
    type: 'customList',
    listId: list.id,
    startIndex: firstIndex,
  };
}

/**
 * Generate values for a custom list pattern.
 *
 * @param pattern - The custom list pattern
 * @param startValues - Source values
 * @param count - Number of values to generate
 * @param registry - Custom list registry
 * @param direction - 'forward' or 'backward'
 * @returns Generated values
 */
export function generateCustomListSeries(
  pattern: FillPattern,
  startValues: CellValue[],
  count: number,
  registry: CustomListRegistry,
  direction: 'forward' | 'backward',
): CellValue[] {
  if (pattern.type !== 'customList' || !pattern.listId) return [];

  const list = registry.getList(pattern.listId);
  if (!list) return [];

  const result: CellValue[] = [];
  const mult = direction === 'forward' ? 1 : -1;

  // Get the anchor value (last for forward, first for backward)
  const anchorValue =
    direction === 'forward' ? startValues[startValues.length - 1] : startValues[0];
  const normalizedAnchor = String(anchorValue).toLowerCase().trim();
  const normalizedListValues = list.values.map((v) => v.toLowerCase().trim());

  let index = normalizedListValues.indexOf(normalizedAnchor);
  if (index === -1) return [];

  for (let i = 0; i < count; i++) {
    index = (((index + mult) % list.values.length) + list.values.length) % list.values.length;
    result.push(list.values[index]);
  }

  return result;
}

// =============================================================================
// Default Registry Instance
// =============================================================================

/**
 * Default custom list registry.
 *
 * Production workbook-scoped custom lists are owned by kernel and should be
 * passed in through the constructor. This empty registry remains a pure helper
 * default for tests and callers that explicitly opt into local-only behavior.
 */
export const defaultCustomListRegistry = new InMemoryCustomListRegistry();
