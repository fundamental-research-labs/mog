import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { RangeSchema } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';
import { parseRefIdSimple } from './operations/validation-helpers';

type SheetValidationCacheEntry =
  | {
      status: 'hydrating';
      generation: number;
      promise: Promise<SheetValidationIndex>;
    }
  | {
      status: 'ready';
      generation: number;
      index: SheetValidationIndex;
    };

class SheetValidationIndex {
  constructor(readonly schemas: readonly RangeSchema[]) {}

  schemaForCell(row: number, col: number): RangeSchema | null {
    for (const schema of this.schemas) {
      if (schemaCoversCell(schema, row, col)) {
        return schema;
      }
    }
    return null;
  }

  schemasOverlappingRange(bounds: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  }): RangeSchema[] {
    return this.schemas.filter((schema) => schemaOverlapsRange(schema, bounds));
  }
}

export class WorksheetValidationCache {
  private readonly sheets = new Map<SheetId, SheetValidationCacheEntry>();
  private readonly generations = new Map<SheetId, number>();
  private readonly unsubscribeEvents: () => void;
  private readonly unsubscribeUndo?: () => void;
  private disposed = false;

  constructor(private readonly ctx: DocumentContext) {
    this.unsubscribeEvents = ctx.eventBus.onMany(
      [
        'range-schema:created',
        'range-schema:updated',
        'range-schema:deleted',
        'schema:changed',
        'sheet:created',
        'sheet:deleted',
        'sheet:copied',
        'import:complete',
      ],
      (event) => {
        if (event.type === 'import:complete') {
          this.invalidateAll();
        } else if (event.type === 'sheet:copied') {
          if (typeof event.sourceSheetId === 'string') {
            this.invalidateSheet(toSheetId(event.sourceSheetId));
          }
          if (typeof event.newSheetId === 'string') {
            this.invalidateSheet(toSheetId(event.newSheetId));
          }
        } else if ('sheetId' in event && typeof event.sheetId === 'string') {
          this.invalidateSheet(toSheetId(event.sheetId));
        }
      },
    );

    this.unsubscribeUndo = ctx.services?.undo.subscribe((event) => {
      if (event.trigger === 'external') return;
      this.invalidateAll();
    });
  }

  peekSchemaForCell(sheetId: SheetId, row: number, col: number): RangeSchema | null | undefined {
    const entry = this.sheets.get(sheetId);
    if (entry?.status !== 'ready') return undefined;
    return entry.index.schemaForCell(row, col);
  }

  peekSchemasForSheet(sheetId: SheetId): readonly RangeSchema[] | undefined {
    const entry = this.sheets.get(sheetId);
    return entry?.status === 'ready' ? entry.index.schemas : undefined;
  }

  async getSchemaForCell(sheetId: SheetId, row: number, col: number): Promise<RangeSchema | null> {
    const index = await this.hydrateSheet(sheetId);
    return index.schemaForCell(row, col);
  }

  async getSchemasForSheet(sheetId: SheetId): Promise<RangeSchema[]> {
    const index = await this.hydrateSheet(sheetId);
    return [...index.schemas];
  }

  async getSchemasOverlappingRange(
    sheetId: SheetId,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<RangeSchema[]> {
    const index = await this.hydrateSheet(sheetId);
    return index.schemasOverlappingRange(bounds);
  }

  invalidateSheet(sheetId: SheetId): void {
    this.generations.set(sheetId, this.nextGeneration(sheetId));
    this.sheets.delete(sheetId);
  }

  invalidateAll(): void {
    for (const sheetId of this.sheets.keys()) {
      this.generations.set(sheetId, this.nextGeneration(sheetId));
    }
    this.sheets.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeEvents();
    this.unsubscribeUndo?.();
    this.invalidateAll();
    this.sheets.clear();
    this.generations.clear();
  }

  private async hydrateSheet(sheetId: SheetId): Promise<SheetValidationIndex> {
    if (this.disposed) return new SheetValidationIndex([]);

    const existing = this.sheets.get(sheetId);
    if (existing?.status === 'ready') return existing.index;
    if (existing?.status === 'hydrating') return existing.promise;

    const generation = this.generations.get(sheetId) ?? 0;
    const promise = this.ctx.computeBridge
      .getRangeSchemasForSheet(sheetId)
      .then((schemas) => {
        const index = new SheetValidationIndex(schemas);
        const current = this.sheets.get(sheetId);
        if (
          !this.disposed &&
          current?.status === 'hydrating' &&
          current.generation === generation &&
          (this.generations.get(sheetId) ?? 0) === generation
        ) {
          this.sheets.set(sheetId, { status: 'ready', generation, index });
        }
        return index;
      })
      .catch((error) => {
        const current = this.sheets.get(sheetId);
        if (
          current?.status === 'hydrating' &&
          current.generation === generation &&
          (this.generations.get(sheetId) ?? 0) === generation
        ) {
          this.sheets.delete(sheetId);
        }
        throw error;
      });

    this.sheets.set(sheetId, { status: 'hydrating', generation, promise });
    return promise;
  }

  private nextGeneration(sheetId: SheetId): number {
    return (this.generations.get(sheetId) ?? 0) + 1;
  }
}

const caches = new WeakMap<DocumentContext, WorksheetValidationCache>();

export function getWorksheetValidationCache(ctx: DocumentContext): WorksheetValidationCache {
  let cache = caches.get(ctx);
  if (!cache) {
    cache = new WorksheetValidationCache(ctx);
    caches.set(ctx, cache);
  }
  return cache;
}

export function invalidateWorksheetValidationCache(ctx: DocumentContext, sheetId: SheetId): void {
  caches.get(ctx)?.invalidateSheet(sheetId);
}

export function invalidateAllWorksheetValidationCaches(ctx: DocumentContext): void {
  caches.get(ctx)?.invalidateAll();
}

export function disposeWorksheetValidationCache(ctx: DocumentContext): void {
  const cache = caches.get(ctx);
  if (!cache) return;
  cache.dispose();
  caches.delete(ctx);
}

function schemaCoversCell(schema: RangeSchema, row: number, col: number): boolean {
  return schema.ranges.some((ref) => {
    const start = parseRefIdSimple(ref.startId);
    const end = parseRefIdSimple(ref.endId);
    if (!start || !end) return false;
    return row >= start.row && row <= end.row && col >= start.col && col <= end.col;
  });
}

function schemaOverlapsRange(
  schema: RangeSchema,
  bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
): boolean {
  return schema.ranges.some((ref) => {
    const start = parseRefIdSimple(ref.startId);
    const end = parseRefIdSimple(ref.endId);
    if (!start || !end) return false;
    return (
      start.row <= bounds.endRow &&
      end.row >= bounds.startRow &&
      start.col <= bounds.endCol &&
      end.col >= bounds.startCol
    );
  });
}
