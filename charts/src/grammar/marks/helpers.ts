/**
 * Shared helpers for mark generators.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { groupByAccessor } from '../../algebra/group-by';
import type { MarkStyle } from '../../primitives/types';
import type { AnyScale, ResolvedEncodings } from '../encoding-resolver';
import { BLANK_VALUE_FIELD, LINE_SEGMENT_FIELD } from '../internal-fields';
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
 * Position zero-width/zero-height marks on the visual center of band scales.
 *
 * Band scales return the leading edge of a category slot, which rect/bar/heatmap
 * marks need. Line, area, point, text, rule, and tick marks represent a datum at
 * a category value, so they must align with axis ticks and labels at band center.
 */
export function centeredScalePosition(scale: AnyScale | undefined, value: unknown): number {
  if (!scale) return NaN;
  const position = scale(value);
  if (typeof position !== 'number' || !Number.isFinite(position)) return NaN;
  const bandwidth = typeof scale.bandwidth === 'function' ? scale.bandwidth() : undefined;
  return typeof bandwidth === 'number' && Number.isFinite(bandwidth) && bandwidth > 0
    ? position + bandwidth / 2
    : position;
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

export function isBlankValueDatum(datum: DataRow): boolean {
  return datum[BLANK_VALUE_FIELD] === true;
}

export function renderableDataRows(data: DataRow[]): DataRow[] {
  return data.filter((datum) => !isBlankValueDatum(datum));
}

export function splitDataByLineSegment(data: DataRow[]): DataRow[][] {
  if (!data.some((datum) => datum[LINE_SEGMENT_FIELD] !== undefined)) return [data];

  const groups = new Map<string, DataRow[]>();
  for (const datum of data) {
    const key = String(datum[LINE_SEGMENT_FIELD] ?? '__blank__');
    const group = groups.get(key);
    if (group) {
      group.push(datum);
    } else {
      groups.set(key, [datum]);
    }
  }
  return [...groups.values()];
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
