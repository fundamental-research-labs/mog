/**
 * WorkbookScenariosImpl — Implementation of the WorkbookScenarios sub-API.
 *
 * Delegates to ScenarioOps for actual operations.
 * Dependencies are injected from WorkbookImpl to avoid exposing internals.
 */
import type {
  ActiveScenarioState,
  ApplyScenarioResult,
  OperationDiagnostic,
  OperationEffect,
  OriginalCellValue,
  Scenario,
  ScenarioConfig,
  WorkbookScenarioApplyReceipt,
  WorkbookScenarios,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../../context';
import { getOrCreateCellId } from '../../domain/cells/cell-identity';
import { KernelError } from '../../errors';
import { createSheetNotFoundError } from '../internal/sheet-lookup-diagnostics';
import { parseCellAddress, toA1, toSheetA1 } from '../internal/utils';
import * as ScenarioOps from './operations/scenario-operations';

export interface WorkbookScenariosDeps {
  ctx: DocumentContext;
  getActiveSheetId: () => SheetId;
  getSheetOrder: () => Promise<SheetId[]>;
  getSheetName: (sheetId: SheetId) => Promise<string | undefined>;
  resolveSheetNameToId: (nameLower: string) => Promise<SheetId | undefined>;
}

function unwrapResult<T>(result: { success: boolean; data?: T; error?: any }): T {
  if (!result.success) {
    if (result.error instanceof KernelError) throw result.error;
    throw KernelError.from(
      result.error,
      'COMPUTE_ERROR',
      String(result.error?.message ?? result.error ?? 'Operation failed'),
    );
  }
  return result.data as T;
}

function operationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scenarioApplyDiagnostics(
  scenarioId: string,
  result: ApplyScenarioResult,
): OperationDiagnostic[] {
  if (result.skippedCells.length === 0) return [];
  return [
    {
      severity: 'warning',
      code: 'SCENARIO_APPLY_SKIPPED_CELLS',
      message: 'Scenario apply skipped one or more missing cells.',
      target: {
        objectId: scenarioId,
        stage: 'apply',
      },
      recoverable: true,
      nextAction: 'Update the scenario changing-cell references and apply it again.',
      details: {
        skippedCells: result.skippedCells,
      },
    },
  ];
}

function scenarioApplyEffects(scenarioId: string, result: ApplyScenarioResult): OperationEffect[] {
  const effects: OperationEffect[] = [
    {
      type: 'computedGrid',
      count: result.cellsUpdated,
      details: {
        operation: 'scenarioApply',
        scenarioId,
      },
    },
    {
      type: 'updatedRuntimeMetadata',
      objectId: scenarioId,
      details: {
        metadata: 'activeScenario',
        durable: false,
        baselineId: result.baselineId,
        documentId: result.documentId,
      },
    },
  ];

  if (result.cellsUpdated > 0) {
    effects.push(
      {
        type: 'wroteStaticValues',
        count: result.cellsUpdated,
        details: {
          source: 'scenarioValues',
          scenarioId,
        },
      },
      {
        type: 'materializedCells',
        count: result.cellsUpdated,
        details: {
          source: 'scenarioValues',
          scenarioId,
        },
      },
    );
  } else {
    effects.push({
      type: 'worksheetUnchanged',
      details: {
        reason: 'scenarioAppliedNoCellUpdates',
        scenarioId,
      },
    });
  }

  return effects;
}

function buildScenarioApplyReceipt(
  scenarioId: string,
  result: ApplyScenarioResult,
): WorkbookScenarioApplyReceipt {
  const diagnostics = scenarioApplyDiagnostics(scenarioId, result);
  const status: 'applied' | 'noOp' | 'partial' =
    result.cellsUpdated === 0 ? 'noOp' : diagnostics.length > 0 ? 'partial' : 'applied';

  return {
    kind: 'workbook.scenarios.apply',
    status,
    effects: scenarioApplyEffects(scenarioId, result),
    diagnostics,
    scenarioId,
    result,
    baselineId: result.baselineId,
    documentId: result.documentId,
    cellsUpdated: result.cellsUpdated,
    skippedCells: result.skippedCells,
    originalValues: result.originalValues,
  };
}

function buildScenarioApplyFailureReceipt(
  scenarioId: string,
  error: unknown,
): WorkbookScenarioApplyReceipt {
  return {
    kind: 'workbook.scenarios.apply',
    status: 'failed',
    effects: [],
    diagnostics: [
      {
        severity: 'error',
        code: 'SCENARIO_APPLY_FAILED',
        message: operationErrorMessage(error),
        target: {
          objectId: scenarioId,
          stage: 'apply',
        },
        recoverable: true,
        nextAction: 'Fix the scenario definition and apply it again.',
      },
    ],
    scenarioId,
    result: null,
  };
}

export class WorkbookScenariosImpl implements WorkbookScenarios {
  constructor(private readonly deps: WorkbookScenariosDeps) {}

  private get ctx(): DocumentContext {
    return this.deps.ctx;
  }

  private async resolveAddressSheetId(ref: string, sheetName?: string): Promise<SheetId> {
    if (!sheetName) return this.deps.getActiveSheetId();
    const resolved = await this.deps.resolveSheetNameToId(sheetName.toLowerCase());
    if (resolved) return resolved;
    throw createSheetNotFoundError({
      target: sheetName,
      knownSheetNames: await this.getKnownSheetNames(),
      context: {
        lookupKind: 'scenarioReference',
        reference: ref,
      },
    });
  }

  private async getKnownSheetNames(): Promise<string[]> {
    const order = await this.deps.getSheetOrder();
    const names = await Promise.all(order.map((id) => this.deps.getSheetName(id)));
    return names.filter((name): name is string => name != null);
  }

  private async toStorageCellRef(ref: string): Promise<string> {
    const trimmed = ref.trim();
    const parsed = parseCellAddress(trimmed);
    if (!parsed) return ref;

    const targetSheetId = await this.resolveAddressSheetId(trimmed, parsed.sheetName);
    return String(await getOrCreateCellId(this.ctx, targetSheetId, parsed.row, parsed.col));
  }

  private async toStorageConfig(config: ScenarioConfig): Promise<ScenarioConfig> {
    return {
      ...config,
      changingCells: await Promise.all(
        config.changingCells.map((ref) => this.toStorageCellRef(ref)),
      ),
    };
  }

  private async toStorageConfigPatch(
    config: Partial<ScenarioConfig>,
  ): Promise<Partial<ScenarioConfig>> {
    if (!config.changingCells) return config;
    return {
      ...config,
      changingCells: await Promise.all(
        config.changingCells.map((ref) => this.toStorageCellRef(ref)),
      ),
    };
  }

  private async getCellRefPosition(
    cellRef: string,
  ): Promise<{ sheetId: SheetId; row: number; col: number } | null> {
    const activeSheetId = this.deps.getActiveSheetId();
    const activePos = await this.ctx.computeBridge.getCellPosition(activeSheetId, cellRef);
    if (activePos) return { sheetId: activeSheetId, row: activePos.row, col: activePos.col };

    for (const candidateId of await this.deps.getSheetOrder()) {
      const candidateSheetId = candidateId;
      if (candidateSheetId === activeSheetId) continue;
      const pos = await this.ctx.computeBridge.getCellPosition(candidateSheetId, cellRef);
      if (pos) return { sheetId: candidateSheetId, row: pos.row, col: pos.col };
    }
    return null;
  }

  private async toPublicCellRef(cellRef: string): Promise<string> {
    if (parseCellAddress(cellRef.trim())) return cellRef;

    const pos = await this.getCellRefPosition(cellRef);
    if (!pos) return cellRef;

    const activeSheetId = this.deps.getActiveSheetId();
    if (pos.sheetId === activeSheetId) return toA1(pos.row, pos.col);

    const sheetName = await this.deps.getSheetName(pos.sheetId);
    return sheetName ? toSheetA1(pos.row, pos.col, sheetName) : toA1(pos.row, pos.col);
  }

  private async toPublicScenario(raw: Scenario): Promise<Scenario> {
    if (!Array.isArray(raw.changingCells)) return raw;
    return {
      ...raw,
      changingCells: await Promise.all(
        raw.changingCells.map((cellRef) => this.toPublicCellRef(cellRef)),
      ),
    };
  }

  async add(config: ScenarioConfig): Promise<string> {
    return unwrapResult(
      await ScenarioOps.createScenario(this.ctx, await this.toStorageConfig(config)),
    );
  }

  async list(): Promise<Scenario[]> {
    const raw = await ScenarioOps.getAllScenarios(this.ctx);
    return Promise.all((raw as Scenario[]).map((scenario) => this.toPublicScenario(scenario)));
  }

  async getActiveScenarioId(): Promise<string | null> {
    return (await this.getActiveScenarioState())?.scenarioId ?? null;
  }

  async getActiveScenarioState(): Promise<ActiveScenarioState | null> {
    return unwrapResult(await ScenarioOps.getActiveScenarioState(this.ctx));
  }

  async apply(id: string): Promise<WorkbookScenarioApplyReceipt> {
    const result = await ScenarioOps.applyScenarioFull(this.ctx, id);
    if (!result.success) {
      return buildScenarioApplyFailureReceipt(id, result.error);
    }
    return buildScenarioApplyReceipt(id, result.data as ApplyScenarioResult);
  }

  async restore(baselineIdOrOriginals: string | OriginalCellValue[]): Promise<void> {
    if (typeof baselineIdOrOriginals === 'string') {
      unwrapResult(await ScenarioOps.restoreScenarioBaseline(this.ctx, baselineIdOrOriginals));
      return;
    }
    unwrapResult(await ScenarioOps.restoreScenarioValues(this.ctx, baselineIdOrOriginals));
  }

  async update(scenarioId: string, config: Partial<ScenarioConfig>): Promise<void> {
    unwrapResult(
      await ScenarioOps.updateScenario(
        this.ctx,
        scenarioId,
        await this.toStorageConfigPatch(config),
      ),
    );
  }

  async remove(id: string): Promise<void> {
    unwrapResult(await ScenarioOps.deleteScenario(this.ctx, id));
  }
}
