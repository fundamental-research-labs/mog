import type { ManualLayoutSpec } from '../../grammar/spec';

export function manualLayoutFromValue(layout: unknown): ManualLayoutSpec | undefined {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return undefined;
  const source = layout as Record<string, unknown>;
  const result: ManualLayoutSpec = {};
  let hasManualLayoutField = false;

  const layoutTarget = manualLayoutTarget(source.layoutTarget);
  if (layoutTarget) {
    result.layoutTarget = layoutTarget;
    hasManualLayoutField = true;
  }

  const xMode = manualLayoutMode(source.xMode);
  if (xMode) {
    result.xMode = xMode;
    hasManualLayoutField = true;
  }
  const yMode = manualLayoutMode(source.yMode);
  if (yMode) {
    result.yMode = yMode;
    hasManualLayoutField = true;
  }
  const wMode = manualLayoutMode(source.wMode);
  if (wMode) {
    result.wMode = wMode;
    hasManualLayoutField = true;
  }
  const hMode = manualLayoutMode(source.hMode);
  if (hMode) {
    result.hMode = hMode;
    hasManualLayoutField = true;
  }

  const x = finiteNumber(source.x);
  if (x !== undefined) {
    result.x = x;
    hasManualLayoutField = true;
  }
  const y = finiteNumber(source.y);
  if (y !== undefined) {
    result.y = y;
    hasManualLayoutField = true;
  }
  const w = finiteNumber(source.w);
  if (w !== undefined) {
    result.w = w;
    hasManualLayoutField = true;
  }
  const h = finiteNumber(source.h);
  if (h !== undefined) {
    result.h = h;
    hasManualLayoutField = true;
  }

  return hasManualLayoutField ? result : undefined;
}

function manualLayoutTarget(value: unknown): ManualLayoutSpec['layoutTarget'] | undefined {
  return value === 'inner' || value === 'outer' ? value : undefined;
}

function manualLayoutMode(value: unknown): ManualLayoutSpec['xMode'] | undefined {
  return value === 'edge' || value === 'factor' ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
