import { jest } from '@jest/globals';

import * as ScenarioOps from '../scenario-operations';

function createMockCtx(overrides: Record<string, jest.Mock> = {}): any {
  return {
    computeBridge: {
      createScenario: jest.fn(),
      updateScenario: jest.fn(),
      removeScenario: jest.fn(),
      getAllScenarios: jest.fn(),
      getActiveScenarioState: jest.fn(),
      applyScenario: jest.fn(),
      restoreScenario: jest.fn(),
      setCells: jest.fn(),
      setActiveScenario: jest.fn(),
      ...overrides,
    },
  };
}

describe('scenario operations', () => {
  describe('createScenario', () => {
    it('returns the Rust-created scenario id', async () => {
      const ctx = createMockCtx({
        createScenario: jest.fn().mockResolvedValue({
          data: { success: true, scenarioId: 'sc-1' },
        }),
      });

      const result = await ScenarioOps.createScenario(ctx, {
        name: 'Best',
        changingCells: ['cell-1'],
        values: [100],
      });

      expect(result).toEqual({ success: true, data: 'sc-1' });
    });

    it('does not fabricate an id when Rust validation fails', async () => {
      const ctx = createMockCtx({
        createScenario: jest.fn().mockResolvedValue({
          data: {
            success: false,
            errors: [{ field: 'changingCells', message: 'At least one changing cell is required' }],
          },
        }),
      });

      const result = await ScenarioOps.createScenario(ctx, {
        name: 'Bad',
        changingCells: [],
        values: [],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('changingCells');
      }
    });

    it('fails when Rust success omits scenarioId', async () => {
      const ctx = createMockCtx({
        createScenario: jest.fn().mockResolvedValue({ data: { success: true } }),
      });

      const result = await ScenarioOps.createScenario(ctx, {
        name: 'Bad',
        changingCells: ['cell-1'],
        values: [100],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('missing scenarioId');
      }
    });
  });

  describe('updateScenario', () => {
    it('surfaces Rust validation failures', async () => {
      const ctx = createMockCtx({
        updateScenario: jest.fn().mockResolvedValue({
          data: {
            success: false,
            errors: [{ field: 'name', message: 'duplicate scenario name' }],
          },
        }),
      });

      const result = await ScenarioOps.updateScenario(ctx, 'sc-1', { name: 'Duplicate' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('duplicate scenario name');
      }
    });
  });

  describe('deleteScenario', () => {
    it('surfaces Rust not-found results', async () => {
      const ctx = createMockCtx({
        removeScenario: jest.fn().mockResolvedValue({
          data: {
            success: false,
            errors: [{ field: 'scenarioId', message: 'Scenario not found' }],
          },
        }),
      });

      const result = await ScenarioOps.deleteScenario(ctx, 'missing');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Scenario not found');
      }
    });
  });

  describe('active scenario state', () => {
    it('returns Rust session active state without reading persisted active state', async () => {
      const ctx = createMockCtx({
        getActiveScenarioState: jest.fn().mockResolvedValue({
          scenarioId: 'sc-1',
          baselineId: 'baseline-1',
          documentId: 'local-compute-session',
          definitionStatus: 'current',
          cellMutationStatus: 'clean',
        }),
      });

      const result = await ScenarioOps.getActiveScenarioState(ctx);

      expect(result).toEqual({
        success: true,
        data: {
          scenarioId: 'sc-1',
          baselineId: 'baseline-1',
          documentId: 'local-compute-session',
          definitionStatus: 'current',
          cellMutationStatus: 'clean',
        },
      });
      expect(ctx.computeBridge.getAllScenarios).not.toHaveBeenCalled();
      expect(ctx.computeBridge.setActiveScenario).not.toHaveBeenCalled();
    });
  });

  describe('applyScenarioFull', () => {
    it('delegates to Rust apply and returns baseline data', async () => {
      const ctx = createMockCtx({
        applyScenario: jest.fn().mockResolvedValue({
          data: {
            success: true,
            scenarioId: 'sc-1',
            baselineId: 'baseline-1',
            documentId: 'local-compute-session',
            cellsUpdated: 1,
            skippedCells: [],
            originalValues: [{ sheetId: 'sheet-1', cellId: 'cell-1', value: 42 }],
          },
        }),
      });

      const result = await ScenarioOps.applyScenarioFull(ctx, 'sc-1');

      expect(result).toEqual({
        success: true,
        data: {
          baselineId: 'baseline-1',
          documentId: 'local-compute-session',
          cellsUpdated: 1,
          skippedCells: [],
          originalValues: [{ sheetId: 'sheet-1', cellId: 'cell-1', value: 42 }],
        },
      });
      expect(ctx.computeBridge.applyScenario).toHaveBeenCalledWith('sc-1');
      expect(ctx.computeBridge.setCells).not.toHaveBeenCalled();
      expect(ctx.computeBridge.setActiveScenario).not.toHaveBeenCalled();
    });

    it('surfaces Rust validation failures', async () => {
      const ctx = createMockCtx({
        applyScenario: jest.fn().mockResolvedValue({
          data: {
            success: false,
            scenarioId: 'missing',
            cellsUpdated: 0,
            errors: [{ field: 'scenarioId', message: 'Scenario not found' }],
          },
        }),
      });

      const result = await ScenarioOps.applyScenarioFull(ctx, 'missing');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Scenario not found');
      }
    });
  });

  describe('restoreScenarioValues', () => {
    it('restores the active Rust baseline and ignores TS original values', async () => {
      const ctx = createMockCtx({
        getActiveScenarioState: jest.fn().mockResolvedValue({
          scenarioId: 'sc-1',
          baselineId: 'baseline-1',
          documentId: 'local-compute-session',
        }),
        restoreScenario: jest.fn().mockResolvedValue({
          data: {
            success: true,
            baselineId: 'baseline-1',
            scenarioId: 'sc-1',
            cellsRestored: 1,
            skippedCells: [],
          },
        }),
      });

      const result = await ScenarioOps.restoreScenarioValues(ctx, [
        { sheetId: 'sheet-1', cellId: 'cell-1', value: 42 },
      ]);

      expect(result).toEqual({ success: true, data: undefined });
      expect(ctx.computeBridge.restoreScenario).toHaveBeenCalledWith('baseline-1');
      expect(ctx.computeBridge.setCells).not.toHaveBeenCalled();
      expect(ctx.computeBridge.setActiveScenario).not.toHaveBeenCalled();
    });
  });
});
