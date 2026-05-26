/**
 * GalleryViewContainer
 *
 * React component that wraps GalleryView for direct rendering.
 * This container creates and manages the view's state machine and data operations.
 */

import { toColId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import React, { useEffect, useMemo, useState } from 'react';
import { createActor } from 'xstate';
import { useWorkbook } from '../../infra/context';
import type { TableId, ViewId } from '../types';
import { GalleryView } from './GalleryView';
import type { GalleryViewConfig } from './config';
import { createGalleryConfig } from './config';
import { galleryMachine, type GalleryActor } from './machines';
export interface GalleryViewContainerProps {
  viewId: ViewId;
  tableId?: TableId;
  sheetId: SheetId;
  config: Record<string, unknown>;
}

function configColId(value: unknown, fallback = ''): ColId {
  return toColId(typeof value === 'string' ? value : fallback);
}

function optionalConfigColId(value: unknown): ColId | undefined {
  return typeof value === 'string' ? toColId(value) : undefined;
}

function configColIds(value: unknown): ColId[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string').map(toColId)
    : [];
}

/**
 * Gallery View Container
 *
 * Creates a fully self-contained gallery view instance that can be rendered
 * directly in the React tree without using createRoot().
 */
export function GalleryViewContainer({
  viewId,
  tableId,
  sheetId,
  config,
}: GalleryViewContainerProps): React.ReactElement {
  const wb = useWorkbook();

  // Build gallery config, using Worksheet API for table column auto-detection
  const [galleryConfig, setGalleryConfig] = useState<GalleryViewConfig>(() =>
    createGalleryConfig(
      viewId,
      sheetId,
      tableId ?? ('' as TableId),
      configColId(config.titleColumn),
      {
        coverImageColumn: optionalConfigColId(config.coverImageColumn),
        cardFields: configColIds(config.cardFields),
        cardSize: (config.cardSize as 'small' | 'medium' | 'large') ?? 'medium',
        fitMode: (config.fitMode as 'cover' | 'contain') ?? 'cover',
      },
    ),
  );

  useEffect(() => {
    const titleColumn = configColId(config.titleColumn);
    const coverImageColumn = optionalConfigColId(config.coverImageColumn);
    const cardFields = configColIds(config.cardFields);
    const cardSize = (config.cardSize as 'small' | 'medium' | 'large') ?? 'medium';
    const fitMode = (config.fitMode as 'cover' | 'contain') ?? 'cover';

    let finalTitleColumn = titleColumn;

    if (!finalTitleColumn && tableId) {
      // Fetch table via Worksheet API (async)
      void (async () => {
        try {
          const ws = wb.getSheetById(sheetId);
          const tables = await ws.tables.list();
          const table = tables.find((t: any) => t.id === tableId);
          if (table?.columns && table.columns.length > 0) {
            finalTitleColumn = toColId(table.columns[0].name);
          }
          setGalleryConfig(
            createGalleryConfig(viewId, sheetId, tableId ?? ('' as TableId), finalTitleColumn, {
              coverImageColumn,
              cardFields,
              cardSize,
              fitMode,
            }),
          );
        } catch {
          // Keep default config on error
        }
      })();
    } else {
      setGalleryConfig(
        createGalleryConfig(viewId, sheetId, tableId ?? ('' as TableId), finalTitleColumn, {
          coverImageColumn,
          cardFields,
          cardSize,
          fitMode,
        }),
      );
    }
  }, [viewId, sheetId, tableId, config, wb]);

  // Create actor once
  const actor = useMemo(() => {
    const a = createActor(galleryMachine) as GalleryActor;
    a.start();
    return a;
  }, []);

  // Cleanup actor on unmount
  useEffect(() => {
    return () => {
      actor.stop();
    };
  }, [actor]);

  // Create a lightweight adapter-like object for GalleryView
  const adapter = useMemo(() => {
    return {
      getActor: () => actor,
      getTableId: () => tableId ?? ('' as TableId),
      setAllCardIds: (_cardIds: RowId[]) => {
        // This is used by the adapter for selectAll functionality
        // For now, we can skip this as it's handled by the machine
      },
      handleKeyboard: (_event: KeyboardEvent) => {
        // Basic keyboard handling - view will manage internally
        return false;
      },
    };
  }, [actor, tableId]);

  return (
    <GalleryView
      adapter={adapter}
      config={galleryConfig}
      workbook={wb}
      onCardClick={(rowId) => {
        // Could wire to shell actions here
        console.log('Card clicked:', rowId);
      }}
      onCardDoubleClick={(rowId) => {
        // Could open record detail here
        console.log('Card double-clicked:', rowId);
      }}
    />
  );
}
