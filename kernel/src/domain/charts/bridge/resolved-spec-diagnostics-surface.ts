import type { ChartConfig } from '@mog/charts';

export function barShapeDiagnostics(config: ChartConfig): string[] {
  const shapes = new Set<string>();
  if (config.barShape) shapes.add(config.barShape);
  for (const series of config.series ?? []) {
    if (series.barShape) shapes.add(series.barShape);
  }
  return Array.from(shapes);
}

export function surfaceFamilyDiagnostics(config: ChartConfig): string[] {
  const type = config.type;
  const isSurfaceType =
    type === 'surface' ||
    type === 'surface3d' ||
    type === 'surfaceWireframe' ||
    type === 'surfaceTopView' ||
    type === 'surfaceTopViewWireframe';
  if (!isSurfaceType) return [];

  const wireframe =
    config.wireframe === true || type === 'surfaceWireframe' || type === 'surfaceTopViewWireframe';
  if (wireframe) {
    return ['surface wireframe rendering is not implemented; chart is preserved as a placeholder'];
  }

  const topView = config.surfaceTopView === true || type === 'surfaceTopView' || type === 'surface';
  if (topView) {
    return [
      'contour/top-view surface rendering is not implemented; chart is preserved as a placeholder',
    ];
  }

  if (type === 'surface3d') {
    return ['3-D surface chart rendering is not implemented; chart is preserved as a placeholder'];
  }

  return ['surface chart rendering is not implemented; chart is preserved as a placeholder'];
}
