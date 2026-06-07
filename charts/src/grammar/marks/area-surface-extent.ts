import type { AreaSurfaceExtentPolicy, AreaSurfaceExtentStatus, Layout, MarkSpec } from '../spec';

export interface AreaSurfaceCaps {
  policy: AreaSurfaceExtentPolicy;
  status: AreaSurfaceExtentStatus;
  statusReason?: string;
  firstPointX: number;
  lastPointX: number;
  leftCapX: number;
  rightCapX: number;
  clippingPolicy: 'clipToPlotBounds';
}

export function resolveAreaSurfaceCaps(input: {
  markSpec: MarkSpec;
  layout: Layout;
  firstPointX: number;
  lastPointX: number;
}): AreaSurfaceCaps {
  const firstPointX = input.firstPointX;
  const lastPointX = input.lastPointX;
  const plotLeft = input.layout.plotArea.x;
  const plotRight = input.layout.plotArea.x + input.layout.plotArea.width;
  const policy = input.markSpec.areaSurfaceExtentPolicy ?? 'pointCaps';
  const explicitPolicy = input.markSpec.areaSurfaceExtentPolicy !== undefined;

  if (!Number.isFinite(firstPointX) || !Number.isFinite(lastPointX)) {
    return {
      policy,
      status: 'missing',
      statusReason: 'areaSurfaceExtentPointXMissing',
      firstPointX,
      lastPointX,
      leftCapX: plotLeft,
      rightCapX: plotLeft,
      clippingPolicy: 'clipToPlotBounds',
    };
  }

  const capRange = areaSurfaceCapRange(policy, firstPointX, lastPointX, plotLeft, plotRight);
  return {
    policy,
    status: explicitPolicy ? 'exact' : 'verifiedDefault',
    ...(explicitPolicy ? {} : { statusReason: 'areaSurfacePointCapDefault' }),
    firstPointX,
    lastPointX,
    leftCapX: capRange.left,
    rightCapX: capRange.right,
    clippingPolicy: 'clipToPlotBounds',
  };
}

function areaSurfaceCapRange(
  policy: AreaSurfaceExtentPolicy,
  firstPointX: number,
  lastPointX: number,
  plotLeft: number,
  plotRight: number,
): { left: number; right: number } {
  if (policy === 'plotEdgeCaps') {
    const forward = firstPointX <= lastPointX;
    return {
      left: forward ? plotLeft : plotRight,
      right: forward ? plotRight : plotLeft,
    };
  }

  if (policy === 'centeredSingleton') {
    const center = (firstPointX + lastPointX) / 2;
    const left = clamp(center - 0.5, plotLeft, plotRight);
    const right = clamp(center + 0.5, plotLeft, plotRight);
    return left <= right ? { left, right } : { left: right, right: left };
  }

  return {
    left: clamp(firstPointX, plotLeft, plotRight),
    right: clamp(lastPointX, plotLeft, plotRight),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
