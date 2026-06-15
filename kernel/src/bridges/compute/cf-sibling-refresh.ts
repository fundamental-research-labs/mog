import type { BridgeTransport } from '@rust-bridge/client';

import type { CellChange, CfChange } from './compute-types.gen';
import type { ViewportFetchManager } from './viewport-fetch-manager';

export interface CfSiblingRefreshOptions {
  transport: BridgeTransport;
  docId: string;
  fetchManager: ViewportFetchManager | null;
  sheetsWithCfRules: Map<string, boolean>;
  changedCells: CellChange[];
  cfChanges: CfChange[] | undefined;
}

async function sheetHasCfRules(
  transport: BridgeTransport,
  docId: string,
  cache: Map<string, boolean>,
  sheetId: string,
): Promise<boolean> {
  const cached = cache.get(sheetId);
  if (cached !== undefined) return cached;

  const rules = await transport.call<unknown[]>('compute_get_all_cf_rules', {
    docId,
    sheetId,
  });
  const hasRules = Array.isArray(rules) && rules.length > 0;
  cache.set(sheetId, hasRules);
  return hasRules;
}

export async function refreshViewportForCfSiblings({
  transport,
  docId,
  fetchManager,
  sheetsWithCfRules,
  changedCells,
  cfChanges,
}: CfSiblingRefreshOptions): Promise<void> {
  if (cfChanges?.length) {
    for (const change of cfChanges) {
      sheetsWithCfRules.delete(change.sheetId);
    }
  }

  if (!fetchManager) return;

  const sheetIds = new Set(changedCells.map((cell) => cell.sheetId));
  const refreshes: Promise<void>[] = [];
  for (const sheetId of sheetIds) {
    if (await sheetHasCfRules(transport, docId, sheetsWithCfRules, sheetId)) {
      refreshes.push(fetchManager.forceRefreshSheetViewports(sheetId));
    }
  }
  await Promise.all(refreshes);
}
