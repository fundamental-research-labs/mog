import type { TitleSpec } from '../../grammar/spec';
import type { ChartConfig } from '../../types';
import { resolveChartTextColor } from '../../utils/chart-colors';
import {
  mergeChartFormats,
  resolveChartColor,
  resolveChartFillPaint,
  resolveChartOwnerFormat,
  resolveChartOwnerRichText,
  resolveChartShadow,
  resolverContextFromConfig,
} from '../style-resolver';
import { pointsToCanvasPx } from './units';

/**
 * Build a TitleSpec from config.title / config.subtitle.
 */
export function buildTitle(config: ChartConfig): TitleSpec | string | undefined {
  const text = config.chartTitle?.text ?? config.title;
  if (!text) return undefined;
  const context = resolverContextFromConfig(config, 'title');
  const titleConfig = config.chartTitle;
  const titleDirectFormat = mergeChartFormats(
    mergeChartFormats(
      titleConfig?.font ? { font: titleConfig.font } : undefined,
      titleConfig?.format,
    ),
    config.titleFormat,
  );
  const titleFormat = resolveChartOwnerFormat(config, 'title', titleDirectFormat);
  const font = titleFormat?.font ?? titleConfig?.font;
  const titleSpec: TitleSpec = {
    text,
    ...(config.subtitle ? { subtitle: config.subtitle } : {}),
  };
  const anchor = titleAnchor(titleConfig?.horizontalAlignment);
  if (anchor) titleSpec.anchor = anchor;
  if (titleConfig?.verticalAlignment) titleSpec.verticalAlign = titleConfig.verticalAlignment;
  if (font?.size !== undefined) titleSpec.fontSize = pointsToCanvasPx(font.size);
  if (font?.name) titleSpec.fontFamily = font.name;
  if (font?.bold) titleSpec.fontWeight = 'bold';
  if (font?.italic !== undefined) titleSpec.fontStyle = font.italic ? 'italic' : 'normal';
  if (font?.underline !== undefined && font.underline !== 'none') titleSpec.underline = true;
  if (font?.strikethrough !== undefined) titleSpec.strikethrough = true;
  const titleColor = resolveChartTextColor(font?.color, context);
  if (titleColor) titleSpec.color = titleColor;
  const titleFill = resolveChartFillPaint(titleFormat?.fill, context);
  if (titleFill) titleSpec.fill = titleFill;
  const shadow = resolveChartShadow(titleFormat?.shadow, context);
  if (shadow) titleSpec.shadow = shadow;
  const richText =
    config.titleRichText ?? titleConfig?.richText ?? resolveChartOwnerRichText(config, 'title');
  if (richText?.length) {
    titleSpec.richText = richText.map((run) => ({
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
    titleSpec.shadow === undefined &&
    titleSpec.richText === undefined &&
    titleSpec.anchor === undefined &&
    titleSpec.verticalAlign === undefined
  ) {
    return text;
  }
  if (!config.subtitle) return titleSpec;
  return {
    ...titleSpec,
  };
}

function titleAnchor(
  alignment: NonNullable<ChartConfig['chartTitle']>['horizontalAlignment'] | undefined,
): TitleSpec['anchor'] | undefined {
  switch (alignment) {
    case 'left':
      return 'start';
    case 'center':
      return 'middle';
    case 'right':
      return 'end';
    default:
      return undefined;
  }
}
