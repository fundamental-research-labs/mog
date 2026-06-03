import type { GroupDefinition, SheetGroupingConfig } from '@mog-sdk/contracts/grouping';
import { DEFAULT_SHEET_GROUPING_CONFIG } from '@mog-sdk/contracts/grouping';
import type { CoordinateSystem } from '@mog-sdk/contracts/rendering';
import {
  type OutlineRenderConfig,
  type OutlineRenderContext,
  hitTestOutline,
} from '../outline-renderer';

const SHEET_ID = 'sheet-1';
const ROW_HEIGHT = 20;
const COL_WIDTH = 64;
const GRID_TOP = 40;
const GRID_LEFT = 60;

function group(overrides: Partial<GroupDefinition>): GroupDefinition {
  return {
    id: 'group-1',
    sheetId: SHEET_ID,
    axis: 'row',
    start: 1,
    end: 3,
    level: 1,
    collapsed: false,
    ...overrides,
  };
}

function coordinateSystem(): CoordinateSystem {
  return {
    getVisibleRegions: () => ({
      frozenCorner: null,
      frozenRows: null,
      frozenCols: null,
      main: { startRow: 0, startCol: 0, endRow: 10, endCol: 10 },
    }),
    cellToViewport: (_sheetId, cell) => ({
      x: GRID_LEFT + cell.col * COL_WIDTH,
      y: GRID_TOP + cell.row * ROW_HEIGHT,
      width: COL_WIDTH,
      height: ROW_HEIGHT,
    }),
    getHeaderVisibility: () => ({ showRowHeaders: true, showColumnHeaders: true }),
    getViewport: () => ({ scrollTop: 0, scrollLeft: 0, width: 800, height: 600 }),
  } as unknown as CoordinateSystem;
}

function renderContext(): OutlineRenderContext {
  return {
    viewport: { scrollTop: 0, scrollLeft: 0, width: 800, height: 600 },
    coords: coordinateSystem(),
    currentSheetId: SHEET_ID,
    showRowHeaders: true,
    showColumnHeaders: true,
  };
}

function outlineConfig(overrides: Partial<OutlineRenderConfig>): OutlineRenderConfig {
  const groupingConfig: SheetGroupingConfig = {
    ...DEFAULT_SHEET_GROUPING_CONFIG,
    rowGroups: [],
    columnGroups: [],
  };

  return {
    groupingConfig,
    rowGroups: [],
    columnGroups: [],
    maxRowLevel: 0,
    maxColLevel: 0,
    rowOutlineLevels: [],
    columnOutlineLevels: [],
    ...overrides,
  };
}

describe('outline renderer adjacent summary hit testing', () => {
  it('hits row collapse buttons on the adjacent summary row, not the detail endpoint', () => {
    const rowGroup = group({ axis: 'row', start: 1, end: 3 });
    const config = outlineConfig({
      rowGroups: [rowGroup],
      maxRowLevel: 1,
      groupingConfig: {
        ...DEFAULT_SHEET_GROUPING_CONFIG,
        rowGroups: [rowGroup],
        columnGroups: [],
      },
    });
    const ctx = renderContext();

    expect(hitTestOutline(8, GRID_TOP + 3 * ROW_HEIGHT + 10, config, ctx).type).toBe('none');
    expect(hitTestOutline(8, GRID_TOP + 4 * ROW_HEIGHT + 10, config, ctx)).toMatchObject({
      type: 'collapse-button',
      axis: 'row',
      groupId: rowGroup.id,
    });
  });

  it('hits column collapse buttons on the adjacent summary column, not the detail endpoint', () => {
    const colGroup = group({ axis: 'column', start: 1, end: 3 });
    const config = outlineConfig({
      columnGroups: [colGroup],
      maxColLevel: 1,
      groupingConfig: {
        ...DEFAULT_SHEET_GROUPING_CONFIG,
        rowGroups: [],
        columnGroups: [colGroup],
      },
    });
    const ctx = renderContext();

    expect(hitTestOutline(GRID_LEFT + 3 * COL_WIDTH + 32, 8, config, ctx).type).toBe('none');
    expect(hitTestOutline(GRID_LEFT + 4 * COL_WIDTH + 32, 8, config, ctx)).toMatchObject({
      type: 'collapse-button',
      axis: 'column',
      groupId: colGroup.id,
    });
  });
});
