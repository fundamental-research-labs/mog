import type {
  ChartColorData,
  ChartDataTableData,
  ChartFillData,
  ChartFontData,
  ChartFormatData,
  ChartFormatStringData,
  ChartLineData,
  ChartShadowData,
  ChartStyleContextData,
} from '../../bridges/compute/compute-types.gen';

import type {
  ChartColor,
  ChartFill,
  ChartFont,
  ChartFormat,
  ChartFormatString,
  ChartLeaderLinesFormat,
  ChartLineFormat,
  ChartLineSettings,
  ChartShadow,
  ChartStyleContext,
  DataTableConfig,
} from '@mog-sdk/contracts/data/charts';

const DIRECT_HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;

/** Convert wire/storage direct RGB hex to the public contract color string. */
export function wireToDirectHexColor(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  const trimmed = color.trim();
  if (!DIRECT_HEX_COLOR_RE.test(trimmed)) return trimmed;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/** Convert public contract direct RGB hex to the wire/storage color string. */
export function directHexColorToWire(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  const trimmed = color.trim();
  if (!DIRECT_HEX_COLOR_RE.test(trimmed)) return trimmed;
  return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

export function wireToDirectHexPalette(colors: string[] | undefined): string[] | undefined {
  return colors?.map((color) => wireToDirectHexColor(color)!);
}

export function directHexPaletteToWire(colors: string[] | undefined): string[] | undefined {
  return colors?.map((color) => directHexColorToWire(color)!);
}

/** Convert wire chart colors to the public contract color shape. */
export function wireToChartColor(color: ChartColorData | undefined): ChartColor | undefined {
  if (typeof color === 'string') return wireToDirectHexColor(color);
  if (!color || typeof color !== 'object') return undefined;
  return {
    theme: color.theme,
    ...(color.tint_shade !== undefined ? { tintShade: color.tint_shade } : {}),
  };
}

/** Convert public chart colors back to the wire shape. */
export function chartColorToWire(color: ChartColor | undefined): ChartColorData | undefined {
  if (typeof color === 'string') return directHexColorToWire(color);
  if (!color || typeof color !== 'object') return undefined;
  return {
    theme: color.theme,
    ...(color.tintShade !== undefined ? { tint_shade: color.tintShade } : {}),
  };
}

export function wireToChartFill(fill: ChartFillData | undefined): ChartFill | undefined {
  if (!fill) return undefined;
  switch (fill.type) {
    case 'none':
      return { type: 'none' };
    case 'solid':
      return {
        type: 'solid',
        color: wireToChartColor(fill.color)!,
        transparency: fill.transparency,
      };
    case 'gradient':
      return {
        type: 'gradient',
        gradientType: fill.gradientType,
        angle: fill.angle,
        stops: fill.stops.map((stop) => ({
          position: stop.position,
          color: wireToChartColor(stop.color)!,
          transparency: stop.transparency,
        })),
      };
    case 'pattern':
      return {
        type: 'pattern',
        pattern: fill.pattern,
        foreground: wireToChartColor(fill.foreground),
        background: wireToChartColor(fill.background),
      };
  }
}

export function chartFillToWire(fill: ChartFill | undefined): ChartFillData | undefined {
  if (!fill) return undefined;
  switch (fill.type) {
    case 'none':
      return { type: 'none' };
    case 'solid':
      return {
        type: 'solid',
        color: chartColorToWire(fill.color)!,
        transparency: fill.transparency,
      };
    case 'gradient':
      return {
        type: 'gradient',
        gradientType: fill.gradientType,
        angle: fill.angle,
        stops: fill.stops.map((stop) => ({
          position: stop.position,
          color: chartColorToWire(stop.color)!,
          transparency: stop.transparency,
        })),
      };
    case 'pattern':
      return {
        type: 'pattern',
        pattern: fill.pattern,
        foreground: chartColorToWire(fill.foreground),
        background: chartColorToWire(fill.background),
      };
  }
}

export function wireToChartFont(font: ChartFontData | undefined): ChartFont | undefined {
  if (!font) return undefined;
  return {
    name: font.name,
    size: font.size,
    bold: font.bold,
    italic: font.italic,
    color: wireToChartColor(font.color),
    underline: font.underline,
    strikethrough: font.strikethrough,
  };
}

export function chartFontToWire(font: ChartFont | undefined): ChartFontData | undefined {
  if (!font) return undefined;
  return {
    name: font.name,
    size: font.size,
    bold: font.bold,
    italic: font.italic,
    color: chartColorToWire(font.color),
    underline: font.underline,
    strikethrough: font.strikethrough,
  };
}

export function wireToChartShadow(shadow: ChartShadowData | undefined): ChartShadow | undefined {
  if (!shadow) return undefined;
  return {
    visible: shadow.visible,
    color: wireToChartColor(shadow.color),
    blur: shadow.blur,
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    transparency: shadow.transparency,
  };
}

export function chartShadowToWire(shadow: ChartShadow | undefined): ChartShadowData | undefined {
  if (!shadow) return undefined;
  return {
    visible: shadow.visible,
    color: chartColorToWire(shadow.color),
    blur: shadow.blur,
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    transparency: shadow.transparency,
  };
}

/** Convert a wire ChartLineData to the contract ChartLineFormat. */
export function wireToChartLineFormat(w: ChartLineData): ChartLineFormat {
  return {
    color: wireToChartColor(w.color),
    width: w.width,
    dashStyle: w.dashStyle,
    transparency: w.transparency,
    noFill: w.noFill,
  };
}

/** Convert contract ChartLineFormat to wire ChartLineData. */
export function chartLineFormatToWire(c: ChartLineFormat): ChartLineData {
  return {
    color: chartColorToWire(c.color),
    width: c.width,
    dashStyle: c.dashStyle,
    transparency: c.transparency,
    noFill: c.noFill,
  };
}

/** Convert a wire ChartLineData to the contract ChartLeaderLinesFormat. */
export function wireToLeaderLinesFormat(w: ChartLineData): ChartLeaderLinesFormat {
  return { format: wireToChartLineFormat(w) };
}

/** Convert contract ChartLeaderLinesFormat to wire ChartLineData. */
export function leaderLinesFormatToWire(c: ChartLeaderLinesFormat): ChartLineData {
  return chartLineFormatToWire(c.format);
}

export function wireToChartLineSettings(
  w: { visible?: boolean; format?: ChartLineData } | undefined,
): ChartLineSettings | undefined {
  if (!w) return undefined;
  return {
    visible: w.visible,
    format: w.format ? wireToChartLineFormat(w.format) : undefined,
  };
}

export function wireToChartFormat(format: ChartFormatData | undefined): ChartFormat | undefined {
  if (!format) return undefined;
  return {
    fill: wireToChartFill(format.fill),
    line: format.line ? wireToChartLineFormat(format.line) : undefined,
    font: wireToChartFont(format.font),
    textRotation: format.textRotation,
    textVerticalType: format.textVerticalType,
    shadow: wireToChartShadow(format.shadow),
  };
}

export function chartFormatToWire(format: ChartFormat | undefined): ChartFormatData | undefined {
  if (!format) return undefined;
  return {
    fill: chartFillToWire(format.fill),
    line: format.line ? chartLineFormatToWire(format.line) : undefined,
    font: chartFontToWire(format.font),
    textRotation: format.textRotation,
    textVerticalType: format.textVerticalType,
    shadow: chartShadowToWire(format.shadow),
  };
}

export function wireToChartFormatString(run: ChartFormatStringData): ChartFormatString {
  return {
    text: run.text,
    font: wireToChartFont(run.font),
  };
}

export function chartFormatStringToWire(run: ChartFormatString): ChartFormatStringData {
  return {
    text: run.text,
    font: chartFontToWire(run.font),
  };
}

export function wireToDataTableConfig(
  table: ChartDataTableData | undefined,
): DataTableConfig | undefined {
  if (!table) return undefined;
  return {
    showHorzBorder: table.showHorzBorder,
    showVertBorder: table.showVertBorder,
    showOutline: table.showOutline,
    showKeys: table.showKeys,
    format: wireToChartFormat(table.format),
    showLegendKey: table.showLegendKey,
    visible: table.visible,
  };
}

export function dataTableConfigToWire(
  table: DataTableConfig | undefined,
): ChartDataTableData | undefined {
  if (!table) return undefined;
  return {
    showHorzBorder: table.showHorzBorder,
    showVertBorder: table.showVertBorder,
    showOutline: table.showOutline,
    showKeys: table.showKeys,
    format: chartFormatToWire(table.format),
    showLegendKey: table.showLegendKey,
    visible: table.visible,
  };
}

export function wireToChartStyleContext(
  context: ChartStyleContextData | undefined,
): ChartStyleContext | undefined {
  if (!context) return undefined;
  return {
    colorMapOverride: context.colorMapOverride,
    diagnostics: context.diagnostics,
    owners: context.owners?.map((owner) => ({
      ownerKey: owner.ownerKey,
      sourcePath: owner.sourcePath,
      editOwnerId: owner.editOwnerId,
      format: wireToChartFormat(owner.format),
      richText: owner.richText?.map(wireToChartFormatString),
      diagnostics: owner.diagnostics,
      importedDrawingMl: owner.importedDrawingMl,
    })),
  };
}

export function chartStyleContextToWire(
  context: ChartStyleContext | undefined,
): ChartStyleContextData | undefined {
  if (!context) return undefined;
  return {
    colorMapOverride: context.colorMapOverride,
    diagnostics: context.diagnostics,
    owners: context.owners?.map((owner) => ({
      ownerKey: owner.ownerKey,
      sourcePath: owner.sourcePath,
      editOwnerId: owner.editOwnerId,
      format: chartFormatToWire(owner.format),
      richText: owner.richText?.map(chartFormatStringToWire),
      diagnostics: owner.diagnostics,
      importedDrawingMl: owner.importedDrawingMl,
    })),
  };
}
