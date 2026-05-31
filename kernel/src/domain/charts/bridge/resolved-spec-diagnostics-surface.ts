import type { ChartConfig } from '@mog/charts';

export function barShapeDiagnostics(config: ChartConfig): string[] {
  const shapes = new Set<string>();
  if (config.barShape) shapes.add(config.barShape);
  for (const series of config.series ?? []) {
    if (series.barShape) shapes.add(series.barShape);
  }
  return Array.from(shapes);
}

export function surfaceFamilyDiagnostics(_config: ChartConfig): string[] {
  // Surface, 3-D surface, wireframe, and top-view surface configs render through the chart backend.
  return [];
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
