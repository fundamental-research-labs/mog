/**
 * RangeMetadataCache — Document-scoped cache for Range metadata.
 *
 * Populated from RangeChange entries in MutationResult and maintained
 * incrementally. NOT viewport-scoped — unlike CellMetadataCache, this
 * cache is never cleared on evaluateViewport().
 *
 * Flat Map per sheet, not an interval tree. O(N) scan where N <= 100
 * Ranges per sheet in practice.
 */

import type {
  AxisIdentityRef,
  PayloadEncoding,
  RangeAnchor,
  RangeId,
  RangeKind,
  SheetId,
} from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Metadata for a single Range, decoded from RangeChange.data JSON payload.
 * Fields match the Rust RangeMetadata struct (camelCase via serde rename_all).
 * This is metadata only — no bulk payload bytes. Bulk data lives in Yrs
 * rangePayloads and is consumed by Rust compute directly.
 */
export interface RangeMeta {
  rangeId: RangeId;
  kind: RangeKind;
  anchor: RangeAnchor;
  encoding: PayloadEncoding;
  rowAxis?: AxisIdentityRef<string>;
  colAxis?: AxisIdentityRef<string>;
  rowIds: string[];
  colIds: string[];
}

type JsonRecord = Record<string, unknown>;

const RANGE_KINDS = new Set<string>([
  'Data',
  'Format',
  'NamedRange',
  'CondFormat',
  'Validation',
  'Protection',
  'PrintArea',
  'Table',
]);

const PAYLOAD_ENCODINGS = new Set<string>(['None', 'F64Le', 'I64Le', 'MixedCbor']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Range metadata field ${field} must be a string`);
  }
  return value;
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new TypeError(`Range metadata field ${field} must be a string array`);
  }
  return value;
}

function assertU32(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError(`Range metadata field ${field} must be a u32`);
  }
  return value;
}

function assertSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Range metadata field ${field} must be a non-negative safe integer`);
  }
  return value;
}

function decodeRunRef(
  value: unknown,
  field: string,
): { runId: number; startOffset: number; len: number } {
  if (!isRecord(value)) {
    throw new TypeError(`Range metadata field ${field} must be an axis run ref`);
  }
  return {
    runId: assertSafeInteger(value.runId, `${field}.runId`),
    startOffset: assertU32(value.startOffset, `${field}.startOffset`),
    len: assertU32(value.len, `${field}.len`),
  };
}

function decodeAxisRef(value: unknown, field: string): AxisIdentityRef<string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new TypeError(`Range metadata field ${field} must be an axis identity ref`);
  }

  const variants = ['StoreRun', 'Runs', 'Explicit'].filter((variant) =>
    Object.prototype.hasOwnProperty.call(value, variant),
  );
  if (variants.length !== 1) {
    throw new TypeError(
      `Range metadata field ${field} must contain exactly one AxisIdentityRef variant`,
    );
  }

  switch (variants[0]) {
    case 'StoreRun':
      return { StoreRun: decodeRunRef(value.StoreRun, `${field}.StoreRun`) };
    case 'Runs': {
      const runs = value.Runs;
      if (!Array.isArray(runs)) {
        throw new TypeError(`Range metadata field ${field}.Runs must be an array`);
      }
      return { Runs: runs.map((run, index) => decodeRunRef(run, `${field}.Runs[${index}]`)) };
    }
    case 'Explicit':
      return { Explicit: assertStringArray(value.Explicit, `${field}.Explicit`) };
    default:
      throw new TypeError(`Range metadata field ${field} has an unknown AxisIdentityRef variant`);
  }
}

function decodeRangeAnchor(value: unknown): RangeAnchor {
  if (!isRecord(value)) {
    throw new TypeError('Range metadata field anchor must be a RangeAnchor');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'Elastic')) {
    const elastic = value.Elastic;
    if (!isRecord(elastic)) {
      throw new TypeError('Range metadata field anchor.Elastic must be an object');
    }
    return {
      Elastic: {
        startRow: assertString(elastic.startRow, 'anchor.Elastic.startRow'),
        endRow: assertString(elastic.endRow, 'anchor.Elastic.endRow'),
        startCol: assertString(elastic.startCol, 'anchor.Elastic.startCol'),
        endCol: assertString(elastic.endCol, 'anchor.Elastic.endCol'),
      },
    };
  }
  if (Object.prototype.hasOwnProperty.call(value, 'Strict')) {
    const strict = value.Strict;
    if (!isRecord(strict)) {
      throw new TypeError('Range metadata field anchor.Strict must be an object');
    }
    return {
      Strict: {
        rowIds: assertStringArray(strict.rowIds, 'anchor.Strict.rowIds'),
        colIds: assertStringArray(strict.colIds, 'anchor.Strict.colIds'),
      },
    };
  }
  throw new TypeError('Range metadata field anchor has an unknown RangeAnchor variant');
}

export function decodeRangeMetaJson(value: unknown): RangeMeta {
  if (!isRecord(value)) {
    throw new TypeError('Range metadata must be a JSON object');
  }

  const kind = assertString(value.kind, 'kind');
  if (!RANGE_KINDS.has(kind)) {
    throw new TypeError(`Range metadata field kind has unknown value: ${kind}`);
  }

  const encoding = assertString(value.encoding, 'encoding');
  if (!PAYLOAD_ENCODINGS.has(encoding)) {
    throw new TypeError(`Range metadata field encoding has unknown value: ${encoding}`);
  }

  return {
    rangeId: assertString(value.rangeId, 'rangeId') as RangeId,
    kind: kind as RangeKind,
    anchor: decodeRangeAnchor(value.anchor),
    encoding: encoding as PayloadEncoding,
    rowAxis: decodeAxisRef(value.rowAxis, 'rowAxis'),
    colAxis: decodeAxisRef(value.colAxis, 'colAxis'),
    rowIds: assertStringArray(value.rowIds, 'rowIds'),
    colIds: assertStringArray(value.colIds, 'colIds'),
  };
}

// =============================================================================
// RangeMetadataCache Class
// =============================================================================

/**
 * Document-scoped cache for Range metadata.
 *
 * Lifecycle:
 * 1. Created when a document is opened
 * 2. Populated from RangeChange entries in MutationResult
 * 3. Maintained incrementally via set/delete as ranges change
 * 4. dispose() clears all data on document close
 *
 * Unlike CellMetadataCache (viewport-scoped, cleared every evaluateViewport()),
 * this cache persists for the document lifetime and is only modified by
 * explicit mutations.
 */
export class RangeMetadataCache {
  private rangesBySheet: Map<SheetId, Map<RangeId, RangeMeta>> = new Map();

  set(sheetId: SheetId, rangeId: RangeId, meta: RangeMeta): void {
    let sheetMap = this.rangesBySheet.get(sheetId);
    if (!sheetMap) {
      sheetMap = new Map();
      this.rangesBySheet.set(sheetId, sheetMap);
    }
    sheetMap.set(rangeId, meta);
  }

  get(sheetId: SheetId, rangeId: RangeId): RangeMeta | undefined {
    return this.rangesBySheet.get(sheetId)?.get(rangeId);
  }

  delete(sheetId: SheetId, rangeId: RangeId): void {
    const sheetMap = this.rangesBySheet.get(sheetId);
    if (sheetMap) {
      sheetMap.delete(rangeId);
      if (sheetMap.size === 0) {
        this.rangesBySheet.delete(sheetId);
      }
    }
  }

  deleteSheet(sheetId: SheetId): void {
    this.rangesBySheet.delete(sheetId);
  }

  getAll(sheetId: SheetId): Map<RangeId, RangeMeta> | undefined {
    return this.rangesBySheet.get(sheetId);
  }

  dispose(): void {
    this.rangesBySheet.clear();
  }
}
