import type { TitleSpec } from '../../grammar/spec';
import type { ChartConfig } from '../../types';
import { resolveChartTextColor } from '../../utils/chart-colors';
import { pointsToCanvasPx } from './units';

/**
 * Build a TitleSpec from config.title / config.subtitle.
 */
export function buildTitle(config: ChartConfig): TitleSpec | string | undefined {
  if (!config.title) return undefined;
  const font = config.titleFormat?.font;
  const titleSpec: TitleSpec = {
    text: config.title,
    ...(config.subtitle ? { subtitle: config.subtitle } : {}),
  };
  if (font?.size !== undefined) titleSpec.fontSize = pointsToCanvasPx(font.size);
  if (font?.name) titleSpec.fontFamily = font.name;
  if (font?.bold) titleSpec.fontWeight = 'bold';
  if (font?.italic !== undefined) titleSpec.fontStyle = font.italic ? 'italic' : 'normal';
  const titleColor = resolveChartTextColor(font?.color);
  if (titleColor) titleSpec.color = titleColor;

  if (
    !config.subtitle &&
    titleSpec.fontSize === undefined &&
    titleSpec.fontWeight === undefined &&
    titleSpec.fontStyle === undefined &&
    titleSpec.color === undefined
  ) {
    return config.title;
  }
  if (!config.subtitle) return titleSpec;
  return {
    ...titleSpec,
  };
}
