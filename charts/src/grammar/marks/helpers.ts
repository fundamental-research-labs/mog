/**
 * Shared helpers for mark generators.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { groupByAccessor } from '../../algebra/group-by';
import type { MarkStyle } from '../../primitives/types';
import type { AnyScale, ResolvedEncodings } from '../encoding-resolver';
import type { DataRow } from '../spec';

/**
 * Safely invoke a scale function with a value.
 * ChartScale accepts unknown, so no type cast is needed for invocation.
 */
export function invokeScale<T>(scale: AnyScale | undefined, value: unknown): T | undefined {
  if (!scale) return undefined;

  return scale(value) as T;
}

/**
 * Group data by a color/detail encoding.
 */
export function groupDataByEncoding(
  data: DataRow[],
  encoding?: ResolvedEncodings[keyof ResolvedEncodings],
): Map<string, DataRow[]> {
  // No grouping - return all data as single group
  if (!encoding || Array.isArray(encoding) || !encoding.field) {
    const groups = new Map<string, DataRow[]>();
    groups.set('__all__', data);
    return groups;
  }

  return groupByAccessor(data, encoding.accessor);
}

/**
 * Keep advanced optional style slots out of generated mark snapshots unless
 * a spec actually supplied them.
 */
export function definedStyle(style: Partial<MarkStyle>): Partial<MarkStyle> {
  const result: Partial<MarkStyle> = {};
  if (style.fillPaint !== undefined) result.fillPaint = style.fillPaint;
  if (style.strokePaint !== undefined) result.strokePaint = style.strokePaint;
  if (style.line !== undefined) result.line = style.line;
  if (style.strokeDash !== undefined) result.strokeDash = style.strokeDash;
  if (style.effects !== undefined) result.effects = style.effects;
  if (style.shadow !== undefined) result.shadow = style.shadow;
  return result;
}
