/**
 * @mog-sdk/embed/internal/views-host
 *
 * Workspace-private dev/eval friend surface for @mog/views-host. This is not
 * part of the public @mog-sdk/embed SDK and is stripped from packed public
 * manifests.
 */

import { MogClient } from '../client/index';
import { createEmbedRenderer } from '../renderer/index';
import type { EmbedRendererOptions } from '../types';

export interface EmbedDevHostMountOptions extends EmbedRendererOptions {
  readonly sourceBytes: ArrayBuffer | Uint8Array;
  readonly sheet?: number | string;
}

export interface EmbedDevSheetMetadata {
  readonly id: string;
  readonly name: string;
  readonly index: number;
}

export interface EmbedDevCellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EmbedDevLayoutSnapshot {
  readonly regionCount: number;
  readonly regions: readonly EmbedDevLayoutRegion[];
}

export interface EmbedDevLayoutRegion {
  readonly id: string;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface EmbedDevDimensionSnapshot {
  readonly rowTops: readonly number[];
  readonly colLefts: readonly number[];
  readonly hiddenRows: readonly number[];
  readonly hiddenCols: readonly number[];
}

export interface EmbedDevRendererDebugHandle {
  onCellSelect(listener: (cell: { row: number; col: number }) => void): () => void;
  onScrollPositionReset(listener: (position: { x: number; y: number }) => void): () => void;
  getCurrentSheetId(): string | null;
  getVisibleBounds(): { startRow: number; startCol: number; endRow: number; endCol: number } | null;
  getScrollPosition(): { x: number; y: number };
  setScrollPosition(position: { x: number; y: number }): void;
  getZoom(): number;
  getFrozenPanes(): { rows: number; cols: number };
  setFrozenPanes(rows: number, cols: number): void;
  switchSheet(sheetId: string): void;
  scrollTo(row: number, col: number): void;
  getCellRect(row: number, col: number): EmbedDevCellRect | null;
  getDimensionSnapshot(limit?: number): EmbedDevDimensionSnapshot;
  getMergesInViewport(
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number } | null,
  ): readonly { startRow: number; startCol: number; endRow: number; endCol: number }[];
  getLayoutSnapshot(): EmbedDevLayoutSnapshot;
  isDisposed(): boolean;
  dispose(): void;
}

export interface EmbedDevClientDebugHandle {
  getActiveSheet(): EmbedDevSheetMetadata | null;
  getSheetIds(): readonly string[];
  dispose(): void;
}

export interface EmbedDevHostMountResult {
  readonly client: EmbedDevClientDebugHandle;
  readonly renderer: EmbedDevRendererDebugHandle;
  dispose(): void;
}

interface InternalWorkbookForViewsHost {
  readonly activeSheet: InternalWorksheetForViewsHost;
  getSheets?(): Promise<readonly InternalWorksheetForViewsHost[]>;
  dispose(): void;
}

interface InternalWorksheetForViewsHost {
  readonly sheetId?: string;
  readonly name?: string;
  readonly index?: number;
  getSheetId?(): string;
  getName?(): Promise<string> | string;
  getIndex?(): number;
}

export async function mountEmbedDevHost(
  container: HTMLElement,
  options: EmbedDevHostMountOptions,
): Promise<EmbedDevHostMountResult> {
  if (!container.style.display) container.style.display = 'flex';
  if (!container.style.flexDirection) container.style.flexDirection = 'column';

  const client = new MogClient({ sourceBytes: options.sourceBytes, sheet: options.sheet });
  const renderer = createEmbedRenderer(container, {
    headers: options.headers,
    gridlines: options.gridlines,
    formulaBar: options.formulaBar,
    sheetTabs: options.sheetTabs,
    scrollable: options.scrollable,
    scrollbars: options.scrollbars,
    zoomControls: options.zoomControls,
    hoverHighlight: options.hoverHighlight,
    dpr: options.dpr,
    theme: options.theme,
  });

  await client.ready;
  renderer.attach(client);

  const workbook = client.workbook as InternalWorkbookForViewsHost | null;
  const sheetIds = workbook?.getSheets
    ? await Promise.all((await workbook.getSheets()).map(readSheetId))
    : [];

  const clientHandle: EmbedDevClientDebugHandle = {
    getActiveSheet(): EmbedDevSheetMetadata | null {
      const active = (client.workbook as InternalWorkbookForViewsHost | null)?.activeSheet;
      if (!active) return null;
      return readSheetMetadataSync(active);
    },
    getSheetIds(): readonly string[] {
      return [...sheetIds];
    },
    dispose(): void {
      client.dispose();
    },
  };

  const rendererHandle: EmbedDevRendererDebugHandle = {
    onCellSelect(listener) {
      return renderer.on('cellSelect', listener);
    },
    onScrollPositionReset(listener) {
      return renderer.on('scrollPositionReset', (event) => listener(event.position));
    },
    getCurrentSheetId: () => renderer.getCurrentSheetId(),
    getVisibleBounds: () => renderer.getVisibleBounds(),
    getScrollPosition: () => renderer.getScrollPosition(),
    setScrollPosition: (position) => renderer.setScrollPosition(position),
    getZoom: () => renderer.getZoom(),
    getFrozenPanes: () => renderer.getFrozenPanes(),
    setFrozenPanes: (rows, cols) => renderer.setFrozenPanes(rows, cols),
    switchSheet: (sheetId) => renderer.updateSheet(sheetId),
    scrollTo: (row, col) => renderer.scrollTo(row, col),
    getCellRect: (row, col) => renderer.getCellRect(row, col),
    getDimensionSnapshot: (limit) => renderer.getDimensionSnapshot(limit),
    getMergesInViewport: (bounds) => renderer.getMergesInViewport(bounds),
    getLayoutSnapshot: () => normalizeLayout(renderer.getViewportLayout()),
    isDisposed: () => renderer.isDisposed(),
    dispose: () => renderer.dispose(),
  };

  let disposed = false;
  return {
    client: clientHandle,
    renderer: rendererHandle,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      renderer.dispose();
      client.dispose();
    },
  };
}

async function readSheetId(sheet: InternalWorksheetForViewsHost): Promise<string> {
  return sheet.getSheetId?.() ?? sheet.sheetId ?? '';
}

function readSheetMetadataSync(sheet: InternalWorksheetForViewsHost): EmbedDevSheetMetadata {
  return {
    id: sheet.getSheetId?.() ?? sheet.sheetId ?? '',
    name: sheet.name ?? '',
    index: sheet.getIndex?.() ?? sheet.index ?? 0,
  };
}

function normalizeLayout(layout: unknown): EmbedDevLayoutSnapshot {
  const regions: EmbedDevLayoutRegion[] = [];
  const viewports = (layout as { readonly viewports?: readonly unknown[] } | null)?.viewports ?? [];
  for (const viewport of viewports) {
    const vp = viewport as {
      readonly id?: string;
      readonly pixelBounds?: {
        readonly top?: number;
        readonly left?: number;
        readonly x?: number;
        readonly y?: number;
        readonly width?: number;
        readonly height?: number;
      };
      readonly bounds?: {
        readonly top?: number;
        readonly left?: number;
        readonly x?: number;
        readonly y?: number;
        readonly width?: number;
        readonly height?: number;
      };
    };
    const bounds = vp.pixelBounds ?? vp.bounds;
    regions.push({
      id: vp.id ?? '',
      top: bounds?.top ?? bounds?.y ?? 0,
      left: bounds?.left ?? bounds?.x ?? 0,
      width: bounds?.width ?? 0,
      height: bounds?.height ?? 0,
    });
  }
  return { regionCount: regions.length, regions };
}
