import { jest } from '@jest/globals';

import type { Scenario } from '@mog-sdk/contracts/api';
import { sheetId, type SheetId } from '@mog-sdk/contracts/core';

const createScenarioMock = jest.fn();
const getAllScenariosMock = jest.fn();
const updateScenarioMock = jest.fn();
const deleteScenarioMock = jest.fn();
const getActiveScenarioStateMock = jest.fn();
const applyScenarioFullMock = jest.fn();
const restoreScenarioValuesMock = jest.fn();
const restoreScenarioBaselineMock = jest.fn();

jest.unstable_mockModule('../operations/scenario-operations', () => ({
  createScenario: createScenarioMock,
  updateScenario: updateScenarioMock,
  deleteScenario: deleteScenarioMock,
  getAllScenarios: getAllScenariosMock,
  getActiveScenarioState: getActiveScenarioStateMock,
  applyScenarioFull: applyScenarioFullMock,
  restoreScenarioValues: restoreScenarioValuesMock,
  restoreScenarioBaseline: restoreScenarioBaselineMock,
}));

const ScenarioOps = await import('../operations/scenario-operations');
const { WorkbookScenariosImpl } = await import('../scenarios');

function createDeps() {
  const activeSheetId = sheetId('sheet-1');
  const otherSheetId = sheetId('sheet-2');
  const sheets = [activeSheetId, otherSheetId];

  const computeBridge = {
    getCellIdAt: jest.fn(async (_sheetId: SheetId, row: number, col: number) => {
      if (row === 19 && col === 23) return 'cell-x20';
      return null;
    }),
    getOrCreateCellId: jest.fn(async () => ({ data: 'created-cell-id' })),
    getCellPosition: jest.fn(async (targetSheetId: SheetId, cellRef: string) => {
      if (targetSheetId === activeSheetId && cellRef === 'cell-x20') {
        return { row: 19, col: 23 };
      }
      return null;
    }),
  };

  return {
    ctx: {
      computeBridge,
      writeGate: { assertWritable: jest.fn() },
    } as any,
    getActiveSheetId: () => activeSheetId,
    getSheetOrder: jest.fn(async () => sheets),
    getSheetName: jest.fn(async (targetSheetId: SheetId) =>
      targetSheetId === activeSheetId ? 'Sheet1' : 'Sheet2',
    ),
    resolveSheetNameToId: jest.fn(async (nameLower: string) => {
      if (nameLower === 'sheet1') return activeSheetId;
      if (nameLower === 'sheet2') return otherSheetId;
      return undefined;
    }),
  };
}

describe('WorkbookScenariosImpl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('translates public A1 changing-cell references to stable CellIds when adding', async () => {
    const deps = createDeps();
    (ScenarioOps.createScenario as jest.Mock).mockResolvedValue({
      success: true,
      data: 'sc-1',
    });
    const scenarios = new WorkbookScenariosImpl(deps);

    await expect(
      scenarios.add({ name: 'Scenario20', changingCells: ['X20'], values: [20] }),
    ).resolves.toBe('sc-1');

    expect(ScenarioOps.createScenario).toHaveBeenCalledWith(
      deps.ctx,
      expect.objectContaining({
        name: 'Scenario20',
        changingCells: ['cell-x20'],
        values: [20],
      }),
    );
  });

  it('translates stored CellIds back to public A1 references when listing', async () => {
    const deps = createDeps();
    (ScenarioOps.getAllScenarios as jest.Mock).mockResolvedValue([
      {
        id: 'sc-1',
        name: 'Scenario20',
        comment: '',
        changingCells: ['cell-x20'],
        values: [20],
        createdAt: 1,
      } satisfies Scenario,
    ]);
    const scenarios = new WorkbookScenariosImpl(deps);

    await expect(scenarios.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'sc-1',
        changingCells: ['X20'],
      }),
    ]);
  });
});
