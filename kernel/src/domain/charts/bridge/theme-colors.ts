import type { ChartConfig } from '@mog-sdk/contracts/data/charts';
import {
  applyWorkbookThemePalette,
  createChartWorkbookThemeColorPalette,
  type ChartWorkbookThemeColorPalette,
} from '@mog/charts/utils';

import type { ThemeData } from '../../../bridges/compute/compute-types.gen';

export type WorkbookThemeBridge = {
  getWorkbookTheme?: () => Promise<ThemeData | null | undefined>;
};

export type { ChartWorkbookThemeColorPalette };

export async function loadWorkbookThemeColorPalette(
  bridge: WorkbookThemeBridge | null | undefined,
): Promise<ChartWorkbookThemeColorPalette | null> {
  if (!bridge?.getWorkbookTheme) return null;

  try {
    return createChartWorkbookThemeColorPalette((await bridge.getWorkbookTheme())?.colors);
  } catch {
    return null;
  }
}

export async function applyWorkbookThemeColors(
  config: ChartConfig,
  getPalette: () => Promise<ChartWorkbookThemeColorPalette | null>,
): Promise<ChartConfig> {
  const palette = await getPalette();
  if (!palette) return config;
  return applyWorkbookThemePalette(config, palette);
}
