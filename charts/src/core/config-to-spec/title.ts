import type { TitleSpec } from '../../grammar/spec';
import type { ChartConfig } from '../../types';
import { resolveChartTextColor } from '../../utils/chart-colors';
import { resolveChartColor, resolveChartFillPaint, resolverContextFromConfig } from '../style-resolver';
import { pointsToCanvasPx } from './units';

/**
 * Build a TitleSpec from config.title / config.subtitle.
 */
export function buildTitle(config: ChartConfig): TitleSpec | string | undefined {
  if (!config.title) return undefined;
  const context = resolverContextFromConfig(config, 'title');
  const font = config.titleFormat?.font;
  const titleSpec: TitleSpec = {
    text: config.title,
    ...(config.subtitle ? { subtitle: config.subtitle } : {}),
  };
  if (font?.size !== undefined) titleSpec.fontSize = pointsToCanvasPx(font.size);
  if (font?.name) titleSpec.fontFamily = font.name;
  if (font?.bold) titleSpec.fontWeight = 'bold';
  if (font?.italic !== undefined) titleSpec.fontStyle = font.italic ? 'italic' : 'normal';
  if (font?.underline !== undefined && font.underline !== 'none') titleSpec.underline = true;
  if (font?.strikethrough !== undefined) titleSpec.strikethrough = true;
  const titleColor = resolveChartTextColor(font?.color, context);
  if (titleColor) titleSpec.color = titleColor;
  const titleFill = resolveChartFillPaint(config.titleFormat?.fill, context);
  if (titleFill) titleSpec.fill = titleFill;
  if (config.titleRichText?.length) {
    titleSpec.richText = config.titleRichText.map((run) => ({
      text: run.text,
      fontFamily: run.font?.name,
      fontSize: run.font?.size !== undefined ? pointsToCanvasPx(run.font.size) : undefined,
      fontWeight: run.font?.bold ? 'bold' : undefined,
      fontStyle: run.font?.italic === undefined ? undefined : run.font.italic ? 'italic' : 'normal',
      fill: run.font?.color
        ? { type: 'solid', color: resolveChartColor(run.font.color, context) ?? '#000000' }
        : undefined,
      underline: run.font?.underline !== undefined && run.font.underline !== 'none',
      strikethrough: run.font?.strikethrough !== undefined,
    }));
  }

  if (
    !config.subtitle &&
    titleSpec.fontSize === undefined &&
    titleSpec.fontWeight === undefined &&
    titleSpec.fontStyle === undefined &&
    titleSpec.color === undefined &&
    titleSpec.fill === undefined &&
    titleSpec.richText === undefined
  ) {
    return config.title;
  }
  if (!config.subtitle) return titleSpec;
  return {
    ...titleSpec,
  };
}
