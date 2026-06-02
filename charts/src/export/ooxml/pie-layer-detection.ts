import { isLayerSpec, type ChartSpec, type MarkSpec, type UnitSpec } from '../../grammar/spec';

export function isDoughnutRingLayerSpec(spec: ChartSpec): boolean {
  return doughnutRingLayers(spec).length > 1;
}

export function doughnutRingLayers(spec: ChartSpec): UnitSpec[] {
  if (!isLayerSpec(spec)) return [];
  return spec.layer.filter((layer): layer is UnitSpec => {
    const mark = layer.mark;
    return (
      typeof mark === 'object' &&
      mark.type === 'arc' &&
      typeof mark.innerRadius === 'number' &&
      typeof mark.outerRadius === 'number'
    );
  });
}

export function firstDoughnutRingMark(spec: ChartSpec): MarkSpec | undefined {
  const layerMark = doughnutRingLayers(spec)[0]?.mark;
  if (typeof layerMark === 'object') return layerMark;
  const mark = spec.mark;
  return typeof mark === 'object' ? mark : undefined;
}
