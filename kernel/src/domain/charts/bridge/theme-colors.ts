import type { ChartConfig, ChartWorkbookThemeData } from '@mog-sdk/contracts/data/charts';
import {
  createChartWorkbookThemeColorPalette,
  type ChartWorkbookThemeColorPalette,
} from '@mog/charts/utils';

import type { ThemeData } from '../../../bridges/compute/compute-types.gen';

export type WorkbookThemeBridge = {
  getWorkbookTheme?: () => Promise<ThemeData | null | undefined>;
};

export type { ChartWorkbookThemeColorPalette };

export async function loadWorkbookTheme(
  bridge: WorkbookThemeBridge | null | undefined,
): Promise<ChartWorkbookThemeData | null> {
  if (!bridge?.getWorkbookTheme) return null;

  try {
    return ((await bridge.getWorkbookTheme()) ?? null) as ChartWorkbookThemeData | null;
  } catch {
    return null;
  }
}

export async function loadWorkbookThemeColorPalette(
  bridge: WorkbookThemeBridge | null | undefined,
): Promise<ChartWorkbookThemeColorPalette | null> {
  return createChartWorkbookThemeColorPalette((await loadWorkbookTheme(bridge))?.colors);
}

export async function applyWorkbookThemeColors(
  config: ChartConfig,
  getTheme: () => Promise<ChartWorkbookThemeData | null>,
): Promise<ChartConfig> {
  const workbookTheme = await getTheme();
  if (!workbookTheme) return config;
  return {
    ...config,
    workbookTheme,
  };
}
