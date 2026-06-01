import type { ChartColorMapOverride, ChartStyleDiagnostic, ChartWorkbookThemeData } from '../types';

export type ChartThemeColorReference = {
  theme: string;
  tintShade?: number;
  tint_shade?: number;
};

export type ChartWorkbookThemeColorPalette = Record<string, string>;

export type ChartWorkbookThemeColorEntry = {
  name: string;
  color: string;
};

export type ResolveChartColorOptions = {
  palette?: ChartWorkbookThemeColorPalette;
  workbookTheme?: ChartWorkbookThemeData | null;
  colorMapOverride?: ChartColorMapOverride;
  ownerKey?: string;
  diagnostics?: ChartStyleDiagnostic[];
};

export type ResolvedColor = {
  color: string;
  opacity?: number;
};

export type DrawingColorLike = {
  type?: string;
  val?: string;
  last_clr?: string;
  lastClr?: string;
  hue?: number;
  sat?: number;
  lum?: number;
  r?: number;
  g?: number;
  b?: number;
  transforms?: ColorTransformLike[];
};

export type ColorTransformLike = {
  type?: string;
  name?: string;
  val?: number;
};

export type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
};
