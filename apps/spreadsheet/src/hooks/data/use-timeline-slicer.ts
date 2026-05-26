/**
 * useTimelineSlicer Hook
 *
 * Slicers Implementation
 *
 * Manages timeline slicer state and interactions.
 *
 * Architecture:
 * - Reads: Worksheet API (getAllSlicersInSheet, getSlicerState)
 * - Writes: Worksheet API (updateSlicerConfig, removeSlicer)
 * - Subscriptions: EventBus for slicer change notifications
 *
 * @module hooks/use-timeline-slicer
 */

import { useCallback, useEffect, useState } from 'react';

import type { SheetId } from '@mog-sdk/contracts/core';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import type {
  TimelineLevel,
  TimelinePeriod,
  TimelineSlicerConfig,
} from '@mog-sdk/contracts/slicers';

import type { SlicerInfo, Workbook } from '@mog-sdk/contracts/api';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseTimelineSlicerOptions {
  /** Current sheet ID */
  sheetId: SheetId;
}

/**
 * Timeline slicer definition with computed periods for rendering.
 */
export interface TimelineSlicerDefinition {
  /** Timeline slicer configuration */
  config: TimelineSlicerConfig;
  /** Computed periods with states */
  periods: TimelinePeriod[];
  /** Whether the slicer is connected to its data source */
  isConnected: boolean;
  /** Whether any filter is active (date range selected) */
  hasActiveFilter: boolean;
}

export interface UseTimelineSlicerReturn {
  /** Timeline slicers for the current sheet */
  timelineSlicers: TimelineSlicerDefinition[];

  /** Currently selected timeline slicer ID (for UI focus) */
  selectedTimelineSlicerId: string | null;

  /** Select a timeline slicer */
  selectTimelineSlicer: (slicerId: string | null) => void;

  /** Set date range selection */
  setDateRangeSelection: (slicerId: string, startDate: number, endDate: number) => void;

  /** Clear selection */
  clearSelection: (slicerId: string) => void;

  /** Change aggregation level */
  setLevel: (slicerId: string, level: TimelineLevel) => void;

  /** Update timeline slicer position */
  updateTimelineSlicerPosition: (
    slicerId: string,
    position: Partial<TimelineSlicerConfig['position']>,
  ) => void;

  /** Delete a timeline slicer */
  deleteTimelineSlicer: (slicerId: string) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a TimelineSlicerDefinition from a SlicerInfo and Worksheet API state.
 */
async function infoToDefinitionAsync(
  wb: Workbook,
  info: SlicerInfo,
  sheetId: SheetId,
): Promise<TimelineSlicerDefinition> {
  const ws = wb.getSheetById(sheetId);
  const state = await ws.slicers.getState(info.id);
  const slicer = await ws.slicers.get(info.id);

  // Map API TimelinePeriod (label/start/end/selected) to data TimelinePeriod
  const periods: TimelinePeriod[] = (state?.periods ?? []).map((p) => ({
    startDate: Date.parse(p.start) || 0,
    endDate: Date.parse(p.end) || 0,
    label: p.label,
    shortLabel: p.label,
    isSelected: p.selected,
    hasData: true,
    count: 0,
  }));
  const isConnected: boolean = state?.isConnected ?? true;

  // Build an absolute ObjectPosition from the API slicer position
  const apiPos = slicer?.position ?? { x: 0, y: 0, width: 200, height: 300 };
  const position: ObjectPosition = {
    anchorType: 'absolute',
    from: { cellId: toCellId(''), xOffset: 0, yOffset: 0 },
    x: apiPos.x,
    y: apiPos.y,
    width: apiPos.width,
    height: apiPos.height,
  };

  // Build a TimelineSlicerConfig from the API data
  const config: TimelineSlicerConfig = {
    id: info.id,
    sheetId,
    source: { type: 'table', tableId: info.tableName, columnCellId: toCellId(info.columnName) },
    caption: info.name,
    style: {
      columnCount: 1,
      buttonHeight: 24,
      showSelectionIndicator: true,
      crossFilter: 'showItemsWithDataAtTop',
      customListSort: true,
      showItemsWithNoData: true,
      sortOrder: 'ascending',
    },
    position,
    zIndex: 0,
    locked: false,
    showHeader: true,
    sourceType: 'timeline',
    timelineLevel: 'months',
    showLevelSelector: true,
    showDateRangeLabel: true,
    multiSelect: true,
  };

  const hasActiveFilter =
    config.selectedStartDate !== undefined && config.selectedEndDate !== undefined;

  return {
    config,
    periods,
    isConnected,
    hasActiveFilter,
  };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing timeline slicers in the spreadsheet.
 *
 * All reads/writes go through Worksheet API (async).
 */
export function useTimelineSlicer({ sheetId }: UseTimelineSlicerOptions): UseTimelineSlicerReturn {
  const wb = useWorkbook();

  // Load timeline slicers via Worksheet API (async)
  const [timelineSlicerDefs, setTimelineSlicerDefs] = useState<TimelineSlicerDefinition[]>([]);

  // Version counter for re-rendering when data changes
  const [dataVersion, setDataVersion] = useState(0);

  // Selected timeline slicer for UI focus
  const [selectedTimelineSlicerId, setSelectedTimelineSlicerId] = useState<string | null>(null);

  // Load slicers asynchronously via Worksheet API, filter to timeline types
  useEffect(() => {
    let cancelled = false;

    async function loadTimelineSlicers() {
      const ws = wb.getSheetById(sheetId);
      const allSlicers = await ws.slicers.list();
      if (cancelled) return;

      // Filter to timeline slicers using the API sourceType discriminator
      const timelineInfos = allSlicers.filter((s) => s.sourceType === 'timeline');

      // Build definitions from timeline slicer info
      const defs = await Promise.all(
        timelineInfos.map((info) => infoToDefinitionAsync(wb, info, sheetId)),
      );
      if (cancelled) return;
      setTimelineSlicerDefs(defs);
    }

    void loadTimelineSlicers();

    return () => {
      cancelled = true;
    };
  }, [sheetId, wb, dataVersion]);

  // Subscribe to events that affect timeline rendering
  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    const handler = () => setDataVersion((v) => v + 1);

    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(ws.on('filter:applied', handler));
    unsubscribers.push(ws.on('filter:cleared', handler));
    unsubscribers.push(ws.on('slicer:cacheInvalidated', handler));
    unsubscribers.push(ws.on('slicer:selectionChanged', handler));
    unsubscribers.push(ws.on('slicer:updated', handler));

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [wb, sheetId]);

  // Select a timeline slicer
  const selectTimelineSlicer = useCallback((slicerId: string | null) => {
    setSelectedTimelineSlicerId(slicerId);
  }, []);

  // Set date range selection via Worksheet API updateSlicerConfig.
  // No dedicated setTimelineSelection method exists — approximated by updating config fields.
  const setDateRangeSelection = useCallback(
    (slicerId: string, startDate: number, endDate: number) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        await ws.slicers.update(slicerId, {
          selectedStartDate: startDate,
          selectedEndDate: endDate,
        });
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Clear selection via Worksheet API updateSlicerConfig.
  const clearSelection = useCallback(
    (slicerId: string) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        await ws.slicers.update(slicerId, {
          selectedStartDate: undefined,
          selectedEndDate: undefined,
        });
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Set aggregation level via Worksheet API updateSlicerConfig.
  const setLevel = useCallback(
    (slicerId: string, level: TimelineLevel) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        await ws.slicers.update(slicerId, { timelineLevel: level });
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Update position via Worksheet API
  const updateTimelineSlicerPosition = useCallback(
    (slicerId: string, position: Partial<TimelineSlicerConfig['position']>) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        const slicer = await ws.slicers.get(slicerId);
        if (!slicer) return;

        await ws.slicers.update(slicerId, {
          position: { ...slicer.position, ...position },
        });
        setDataVersion((v) => v + 1);
      })();
    },
    [wb, sheetId],
  );

  // Worksheet API: Delete timeline slicer
  const deleteTimelineSlicer = useCallback(
    (slicerId: string) => {
      void (async () => {
        const ws = wb.getSheetById(sheetId);
        await ws.slicers.remove(slicerId);
        setDataVersion((v) => v + 1);

        if (selectedTimelineSlicerId === slicerId) {
          setSelectedTimelineSlicerId(null);
        }
      })();
    },
    [wb, sheetId, selectedTimelineSlicerId],
  );

  return {
    timelineSlicers: timelineSlicerDefs,
    selectedTimelineSlicerId,
    selectTimelineSlicer,
    setDateRangeSelection,
    clearSelection,
    setLevel,
    updateTimelineSlicerPosition,
    deleteTimelineSlicer,
  };
}

// Re-export types
export type { TimelineLevel, TimelinePeriod, TimelineSlicerConfig };
