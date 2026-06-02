import type { ChartConfig } from '@mog/charts';
import type {
  ResolvedChartSpecSnapshot,
  ResolvedChartSurfaceApproximationContractKind,
} from '@mog-sdk/contracts/data/charts';

type ResolvedSnapshotSeries = ResolvedChartSpecSnapshot['resolved']['series'];

export function barShapeDiagnostics(config: ChartConfig): string[] {
  const shapes = new Set<string>();
  if (config.barShape) shapes.add(config.barShape);
  for (const series of config.series ?? []) {
    if (series.barShape) shapes.add(series.barShape);
  }
  return Array.from(shapes);
}

export function surfaceFamilyDiagnostics(
  config: ChartConfig,
  series?: ResolvedSnapshotSeries,
): string[] {
  if (!isImportedChartConfig(config) || !isSurfaceFamilyConfig(config)) return [];
  return hasFiniteSurfaceValues(series)
    ? surfaceApproximationDiagnostics(config)
    : surfacePlaceholderDiagnostics(config);
}

export function surfaceUnsupportedFeatureDiagnostics(
  config: ChartConfig,
  series?: ResolvedSnapshotSeries,
): string[] {
  if (!isImportedChartConfig(config) || !isSurfaceFamilyConfig(config)) return [];
  return hasFiniteSurfaceValues(series) ? [] : surfacePlaceholderDiagnostics(config);
}

export function surfaceApproximationDiagnostics(config: ChartConfig): string[] {
  const diagnostics: string[] = [];
  if (isSurfaceTopViewConfig(config)) {
    diagnostics.push(
      'contour/top-view surface chart is rendered as a Mog contour approximation',
    );
  } else {
    diagnostics.push('surface chart is rendered as a Mog surface approximation');
  }
  if (isSurfaceWireframeConfig(config)) {
    diagnostics.push('surface wireframe is projected from source grid data');
  }
  return diagnostics;
}

export function surfacePlaceholderDiagnostics(config: ChartConfig): string[] {
  const diagnostics: string[] = [];
  if (isSurfaceTopViewConfig(config)) {
    diagnostics.push(
      'contour/top-view surface rendering is not implemented as Excel-equivalent; chart is preserved as a placeholder',
    );
  } else {
    diagnostics.push(
      'surface chart rendering is not implemented as Excel-equivalent; chart is preserved as a placeholder',
    );
  }
  if (isSurfaceWireframeConfig(config)) {
    diagnostics.push(
      'surface wireframe rendering is not implemented as Excel-equivalent; chart is preserved as a placeholder',
    );
  }
  return diagnostics;
}

export function surfaceApproximationContractForConfig(
  config: ChartConfig,
): ResolvedChartSurfaceApproximationContractKind | undefined {
  if (!isSurfaceFamilyConfig(config)) return undefined;
  const topView = isSurfaceTopViewConfig(config);
  const wireframe = isSurfaceWireframeConfig(config);
  if (topView) return wireframe ? 'contourWireframe' : 'contourFilled';
  return wireframe ? 'surface3dWireframe' : 'surface3dFilled';
}

export function isSurfaceFamilyConfig(config: ChartConfig): boolean {
  return (
    config.type === 'surface' ||
    config.type === 'surface3d' ||
    config.type === 'surfaceWireframe' ||
    config.type === 'surfaceTopView' ||
    config.type === 'surfaceTopViewWireframe'
  );
}

export function isSurfaceTopViewConfig(config: ChartConfig): boolean {
  return (
    config.type === 'surface' ||
    config.type === 'surfaceTopView' ||
    config.type === 'surfaceTopViewWireframe' ||
    config.surfaceTopView === true
  );
}

function isImportedChartConfig(config: ChartConfig): boolean {
  if (typeof config.extra !== 'object' || config.extra === null) return false;
  const extra = config.extra as { imported?: unknown; sourceDialect?: unknown };
  return extra.imported === true || typeof extra.sourceDialect === 'string';
}

function isSurfaceWireframeConfig(config: ChartConfig): boolean {
  return (
    config.wireframe === true ||
    config.type === 'surfaceWireframe' ||
    config.type === 'surfaceTopViewWireframe'
  );
}

function hasFiniteSurfaceValues(series: ResolvedSnapshotSeries | undefined): boolean {
  return (
    series?.some((item) =>
      item.values.some((value) => typeof value === 'number' && Number.isFinite(value)),
    ) ?? false
  );
}
