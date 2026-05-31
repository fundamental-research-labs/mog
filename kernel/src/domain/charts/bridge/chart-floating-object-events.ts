import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  FloatingObjectCreatedEvent,
  FloatingObjectDeletedEvent,
  FloatingObjectUpdatedEvent,
} from '@mog-sdk/contracts/events';

import { hasImportStatus, isChartPayload } from './import-render-status';
import { isPositionOnlyUpdate } from './position-only-update';

export interface ChartFloatingObjectEventRenderCache {
  getSheetId(chartId: string): SheetId | undefined;
  setSheetId(chartId: string, sheetId: SheetId): void;
  deleteSheetId(chartId: string, sheetId?: SheetId): boolean;
  deleteSheet(sheetId: SheetId): string[];
  deleteChartCaches(chartId: string, sheetId?: SheetId): void;
  syncImportRenderStatus(chartId: string, payload: unknown, sheetId?: SheetId): boolean;
}

export interface ChartFloatingObjectEventContext {
  renderCache: ChartFloatingObjectEventRenderCache;
  invalidateChart(chartId: string, sheetId?: SheetId): void;
}

type ChartFloatingObjectCreatedPolicyEvent = {
  objectId: FloatingObjectCreatedEvent['objectId'];
  objectType: FloatingObjectCreatedEvent['objectType'];
  data: FloatingObjectCreatedEvent['data'];
};

type ChartFloatingObjectUpdatedPolicyEvent = {
  objectId: FloatingObjectUpdatedEvent['objectId'];
  data: FloatingObjectUpdatedEvent['data'];
  changes: FloatingObjectUpdatedEvent['changes'];
  changedFields: FloatingObjectUpdatedEvent['changedFields'];
};

type ChartFloatingObjectDeletedPolicyEvent = {
  objectId: FloatingObjectDeletedEvent['objectId'];
  objectType: FloatingObjectDeletedEvent['objectType'];
};

export function handleChartFloatingObjectCreated(
  deps: ChartFloatingObjectEventContext,
  event: ChartFloatingObjectCreatedPolicyEvent,
  sheetId: SheetId,
): void {
  if (event.objectType !== 'chart' && !isChartPayload(event.data)) return;

  deps.renderCache.setSheetId(event.objectId, sheetId);
  if (!deps.renderCache.syncImportRenderStatus(event.objectId, event.data, sheetId)) {
    deps.invalidateChart(event.objectId, sheetId);
  }
}

export function handleChartFloatingObjectUpdated(
  deps: ChartFloatingObjectEventContext,
  event: ChartFloatingObjectUpdatedPolicyEvent,
  sheetId: SheetId,
): void {
  if (!isChartPayload(event.data)) return;

  if (deps.renderCache.getSheetId(event.objectId) !== sheetId) {
    deps.renderCache.setSheetId(event.objectId, sheetId);
  }

  const importStatusPayload = hasImportStatus(event.changes) ? event.changes : event.data;
  const hasTerminalImportStatus = deps.renderCache.syncImportRenderStatus(
    event.objectId,
    importStatusPayload,
    sheetId,
  );
  if (hasTerminalImportStatus) return;

  const fields = event.changedFields ?? [];
  if (!isPositionOnlyUpdate(fields)) {
    deps.invalidateChart(event.objectId, sheetId);
  }
}

export function handleChartFloatingObjectDeleted(
  deps: ChartFloatingObjectEventContext,
  event: ChartFloatingObjectDeletedPolicyEvent,
  sheetId: SheetId,
): void {
  if (event.objectType !== 'chart') return;

  deps.renderCache.deleteSheetId(event.objectId, sheetId);
  deps.renderCache.deleteChartCaches(event.objectId, sheetId);
}

export function handleChartSheetDeleted(
  deps: ChartFloatingObjectEventContext,
  sheetId: SheetId,
): void {
  deps.renderCache.deleteSheet(sheetId);
}
