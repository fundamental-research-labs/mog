/**
 * WorkbookScenariosImpl — Implementation of the WorkbookScenarios sub-API.
 *
 * Delegates to ScenarioOps for actual operations.
 * Dependencies are injected from WorkbookImpl to avoid exposing internals.
 */
import type {
  ActiveScenarioState,
  ApplyScenarioResult,
  OriginalCellValue,
  Scenario,
  ScenarioConfig,
  WorkbookScenarios,
} from '@mog-sdk/contracts/api';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import * as ScenarioOps from './operations/scenario-operations';

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

export class WorkbookScenariosImpl implements WorkbookScenarios {
  constructor(private readonly ctx: DocumentContext) {}

  async add(config: ScenarioConfig): Promise<string> {
    return unwrapResult(await ScenarioOps.createScenario(this.ctx, config));
  }

  async list(): Promise<Scenario[]> {
    const raw = await ScenarioOps.getAllScenarios(this.ctx);
    return raw as Scenario[];
  }

  async getActiveScenarioId(): Promise<string | null> {
    return (await this.getActiveScenarioState())?.scenarioId ?? null;
  }

  async getActiveScenarioState(): Promise<ActiveScenarioState | null> {
    return unwrapResult(await ScenarioOps.getActiveScenarioState(this.ctx));
  }

  async apply(id: string): Promise<ApplyScenarioResult> {
    return unwrapResult(await ScenarioOps.applyScenarioFull(this.ctx, id));
  }

  async restore(baselineIdOrOriginals: string | OriginalCellValue[]): Promise<void> {
    if (typeof baselineIdOrOriginals === 'string') {
      unwrapResult(await ScenarioOps.restoreScenarioBaseline(this.ctx, baselineIdOrOriginals));
      return;
    }
    unwrapResult(await ScenarioOps.restoreScenarioValues(this.ctx, baselineIdOrOriginals));
  }

  async update(scenarioId: string, config: Partial<ScenarioConfig>): Promise<void> {
    unwrapResult(await ScenarioOps.updateScenario(this.ctx, scenarioId, config));
  }

  async remove(id: string): Promise<void> {
    unwrapResult(await ScenarioOps.deleteScenario(this.ctx, id));
  }
}
