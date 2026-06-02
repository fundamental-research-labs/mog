import type {
  ChartSeriesStockRole,
  SeriesConfig,
  StockExactnessEvidenceStatus,
  StockSourceComposition,
} from '../types';

export type StockRole = NonNullable<SeriesConfig['stockRole']>;
export type StockRolePlan = Partial<Record<StockRole, number>> & {
  high: number;
  low: number;
  close: number;
};

export interface StockRolePlanWithEvidence {
  roles: StockRolePlan;
  sourceRoleOrder: ChartSeriesStockRole[];
  sourceRoleSemanticStatus: StockExactnessEvidenceStatus;
  sourceRoleSemanticSource: string;
  sourceRoleSemanticReason?: string;
}

const STOCK_ROLE_ORDER: ChartSeriesStockRole[] = ['volume', 'open', 'high', 'low', 'close'];

export function stockRolePlan(seriesConfigs: readonly SeriesConfig[]): StockRolePlan | null {
  return stockRolePlanWithEvidence(seriesConfigs)?.roles ?? null;
}

export function stockRolePlanWithEvidence(
  seriesConfigs: readonly SeriesConfig[],
  composition?: StockSourceComposition,
): StockRolePlanWithEvidence | null {
  const explicitPlan = explicitStockRolePlan(seriesConfigs);
  if (explicitPlan) {
    return withCompositionSemanticEvidence(
      {
        roles: explicitPlan,
        sourceRoleOrder: sourceRoleOrderFromPlan(explicitPlan, seriesConfigs.length),
        sourceRoleSemanticStatus: 'exact',
        sourceRoleSemanticSource: 'explicitStockRoles',
      },
      composition,
    );
  }

  const importedPlan = importedStockRolePlan(seriesConfigs);
  if (importedPlan) {
    return withCompositionSemanticEvidence(
      {
        roles: importedPlan,
        sourceRoleOrder: sourceRoleOrderFromPlan(importedPlan, seriesConfigs.length),
        sourceRoleSemanticStatus: 'verifiedDefault',
        sourceRoleSemanticSource: 'importedStockChartOrder',
        sourceRoleSemanticReason: 'stockRoleOrderFromImportedStockSeriesTypes',
      },
      composition,
    );
  }

  const fallbackPlan = fallbackStockRolePlan(seriesConfigs.length);
  if (!fallbackPlan) return null;
  return withCompositionSemanticEvidence(
    {
      roles: fallbackPlan,
      sourceRoleOrder: sourceRoleOrderFromPlan(fallbackPlan, seriesConfigs.length),
      sourceRoleSemanticStatus: 'approximate',
      sourceRoleSemanticSource: 'seriesLengthFallback',
      sourceRoleSemanticReason: 'stockRoleOrderInferredFromSeriesCount',
    },
    composition,
  );
}

export function isStockVolumeSeriesType(chartType: string | undefined): boolean {
  return (
    chartType === 'bar' ||
    chartType === 'column' ||
    chartType === 'bar3D' ||
    chartType === 'bar3d' ||
    chartType === 'column3D' ||
    chartType === 'column3d'
  );
}

function withCompositionSemanticEvidence(
  plan: StockRolePlanWithEvidence,
  composition: StockSourceComposition | undefined,
): StockRolePlanWithEvidence {
  if (!composition?.sourceRoleSemanticStatus) return plan;
  return {
    ...plan,
    sourceRoleOrder: composition.sourceRoleOrder.length > 0
      ? [...composition.sourceRoleOrder]
      : plan.sourceRoleOrder,
    sourceRoleSemanticStatus: composition.sourceRoleSemanticStatus,
    sourceRoleSemanticSource: composition.sourceRoleSemanticSource ?? plan.sourceRoleSemanticSource,
    ...(composition.sourceRoleSemanticReason !== undefined
      ? { sourceRoleSemanticReason: composition.sourceRoleSemanticReason }
      : plan.sourceRoleSemanticReason !== undefined
        ? { sourceRoleSemanticReason: plan.sourceRoleSemanticReason }
        : {}),
  };
}

function explicitStockRolePlan(seriesConfigs: readonly SeriesConfig[]): StockRolePlan | null {
  const roles: Partial<Record<StockRole, number>> = {};
  let explicitRoleCount = 0;

  for (let index = 0; index < seriesConfigs.length; index += 1) {
    const role = seriesConfigs[index].stockRole;
    if (!role) continue;
    if (roles[role] !== undefined) return null;
    roles[role] = index;
    explicitRoleCount += 1;
  }

  if (explicitRoleCount === 0 || explicitRoleCount !== seriesConfigs.length) return null;
  return completeStockRolePlan(roles);
}

function importedStockRolePlan(seriesConfigs: readonly SeriesConfig[]): StockRolePlan | null {
  const stockIndices: number[] = [];
  const volumeIndices: number[] = [];

  seriesConfigs.forEach((seriesConfig, index) => {
    if (seriesConfig.type === 'stock') stockIndices.push(index);
    if (isStockVolumeSeriesType(seriesConfig.type)) volumeIndices.push(index);
  });

  if (
    volumeIndices.length === 1 &&
    (stockIndices.length === 3 || stockIndices.length === 4) &&
    stockIndices.length + volumeIndices.length === seriesConfigs.length
  ) {
    return completeStockRolePlan(
      stockIndices.length === 4
        ? {
            volume: volumeIndices[0],
            open: stockIndices[0],
            high: stockIndices[1],
            low: stockIndices[2],
            close: stockIndices[3],
          }
        : {
            volume: volumeIndices[0],
            high: stockIndices[0],
            low: stockIndices[1],
            close: stockIndices[2],
          },
    );
  }

  if (
    volumeIndices.length === 0 &&
    (stockIndices.length === 3 || stockIndices.length === 4) &&
    stockIndices.length === seriesConfigs.length
  ) {
    return completeStockRolePlan(
      stockIndices.length === 4
        ? {
            open: stockIndices[0],
            high: stockIndices[1],
            low: stockIndices[2],
            close: stockIndices[3],
          }
        : { high: stockIndices[0], low: stockIndices[1], close: stockIndices[2] },
    );
  }

  return null;
}

function fallbackStockRolePlan(seriesCount: number): StockRolePlan | null {
  if (seriesCount >= 5) {
    return { volume: 0, open: 1, high: 2, low: 3, close: 4 };
  }
  if (seriesCount >= 4) {
    return { open: 0, high: 1, low: 2, close: 3 };
  }
  if (seriesCount >= 3) {
    return { high: 0, low: 1, close: 2 };
  }
  return null;
}

function completeStockRolePlan(
  roles: Partial<Record<StockRole, number>>,
): StockRolePlan | null {
  if (roles.high === undefined || roles.low === undefined || roles.close === undefined) {
    return null;
  }
  return {
    ...(roles.volume !== undefined ? { volume: roles.volume } : {}),
    ...(roles.open !== undefined ? { open: roles.open } : {}),
    high: roles.high,
    low: roles.low,
    close: roles.close,
  };
}

function sourceRoleOrderFromPlan(
  roles: StockRolePlan,
  seriesCount: number,
): ChartSeriesStockRole[] {
  return STOCK_ROLE_ORDER
    .map((role) => ({ role, index: roles[role] }))
    .filter(
      (entry): entry is { role: ChartSeriesStockRole; index: number } =>
        entry.index !== undefined && entry.index >= 0 && entry.index < seriesCount,
    )
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.role);
}
