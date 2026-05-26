/**
 * Data sanitization utilities for the charts package.
 *
 * Extracted from compiler.ts — provides helpers for cleaning data before
 * scale domain computation. These functions ensure that non-finite numeric
 * values and mismatched layer fields don't break scale computation.
 *
 * All functions are pure — no side effects.
 */

import type { ChannelSpec, ChartSpec, DataRow, EncodingSpec } from '../grammar/spec';

/**
 * Sanitize data for scale domain computation.
 *
 * Replaces non-finite numeric values (Infinity, -Infinity, NaN) with undefined
 * in quantitative encoding fields so they don't pollute the scale domain.
 * Without this, a single Infinity value makes the entire y-scale return NaN,
 * causing all marks (even for finite values) to be filtered out.
 *
 * Performance: scans data once to check if sanitization is needed. If no
 * non-finite values exist, returns the original array without cloning.
 *
 * @param data - Input data rows
 * @param encoding - Encoding specification (to identify quantitative fields)
 * @returns Sanitized data rows (new array if changes were made, original otherwise)
 */
export function sanitizeDataForScales(data: DataRow[], encoding?: EncodingSpec): DataRow[] {
  if (!encoding) return data;

  // Collect quantitative field names that need sanitization
  const quantFields: string[] = [];
  for (const [_key, spec] of Object.entries(encoding)) {
    const channelSpec = spec as ChannelSpec | undefined;
    if (channelSpec?.type === 'quantitative' && channelSpec.field) {
      quantFields.push(channelSpec.field);
    }
  }

  if (quantFields.length === 0) return data;

  // Check if any data actually has non-finite values
  let needsSanitization = false;
  for (const row of data) {
    for (const field of quantFields) {
      const val = (row as Record<string, unknown>)[field];
      if (typeof val === 'number' && !isFinite(val)) {
        needsSanitization = true;
        break;
      }
    }
    if (needsSanitization) break;
  }

  if (!needsSanitization) return data;

  // Clone rows, replacing non-finite quantitative values with undefined
  return data.map((row) => {
    const cleaned = { ...row } as Record<string, unknown>;
    for (const field of quantFields) {
      const val = cleaned[field];
      if (typeof val === 'number' && !isFinite(val)) {
        cleaned[field] = undefined;
      }
    }
    return cleaned as DataRow;
  });
}

/**
 * Extend merged data for scale domain computation in layered charts.
 *
 * When different layers map different fields to the same channel (e.g., layer 1
 * has y: 'bar_value', layer 2 has y: 'line_value'), the merged encoding only
 * keeps the first field. To ensure the shared scale domain covers ALL layers'
 * values, this function creates synthetic data rows that map each alternative
 * field's values into the merged field name.
 *
 * @param mergedData - All data rows from all layers
 * @param mergedEncoding - The merged encoding spec (first-wins per channel)
 * @param layers - The individual layer ChartSpecs
 * @returns Extended data rows with synthetic rows for alternative fields
 */
export function extendDataForLayerFields(
  mergedData: DataRow[],
  mergedEncoding: EncodingSpec,
  layers: ChartSpec[],
): DataRow[] {
  // Positional channels that need shared scale domains
  const channels: (keyof EncodingSpec)[] = ['x', 'y'];

  // Collect alternative fields per channel: fields used by layers that differ
  // from the merged encoding's field for that channel
  const altFieldsByChannel = new Map<string, Set<string>>();

  for (const channel of channels) {
    const mergedChannel = mergedEncoding[channel] as ChannelSpec | undefined;
    if (!mergedChannel?.field) continue;

    const mergedField = mergedChannel.field;
    const altFields = new Set<string>();

    for (const layer of layers) {
      const layerChannel = layer.encoding?.[channel] as ChannelSpec | undefined;
      if (layerChannel?.field && layerChannel.field !== mergedField) {
        altFields.add(layerChannel.field);
      }
    }

    if (altFields.size > 0) {
      altFieldsByChannel.set(mergedField, altFields);
    }
  }

  // If no channels have alternative fields, return the original data unchanged
  if (altFieldsByChannel.size === 0) {
    return mergedData;
  }

  // Create synthetic rows: for each alternative field, project its values
  // into the merged field name so createScales computes a domain that covers
  // all layers' data ranges
  const syntheticRows: DataRow[] = [];

  for (const row of mergedData) {
    const record = row as Record<string, unknown>;
    for (const [mergedField, altFields] of altFieldsByChannel) {
      for (const altField of altFields) {
        const altValue = record[altField];
        if (altValue !== undefined && altValue !== null) {
          // Create a minimal synthetic row with just the merged field
          // set to the alternative field's value
          syntheticRows.push({ [mergedField]: altValue } as DataRow);
        }
      }
    }
  }

  if (syntheticRows.length === 0) {
    return mergedData;
  }

  return [...mergedData, ...syntheticRows];
}
