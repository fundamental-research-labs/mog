import { tickStep } from '../../primitives/scales/linear';

const EXCEL_VALUE_AXIS_TICK_COUNT = 5;
const EXCEL_DIVERGING_VALUE_AXIS_TICK_COUNT = 8;
const DOMAIN_EPSILON = 1e-10;
const HEADROOM_STEP_FRACTION = 0.2;

export interface ExcelAutoValueAxisScaleInput {
  values: readonly number[];
  includeZero: boolean;
  tickCount?: number;
  explicitMin?: number;
  explicitMax?: number;
  explicitTickStep?: number;
}

export interface ExcelAutoValueAxisScale {
  domain: [number, number];
  tickStep: number;
  tickCount: number;
  explicitDomain: boolean;
}

export function resolveExcelAutoValueAxisScale(
  input: ExcelAutoValueAxisScaleInput,
): ExcelAutoValueAxisScale | undefined {
  const finiteValues = input.values.filter((value) => Number.isFinite(value));
  if (
    finiteValues.length === 0 &&
    input.explicitMin === undefined &&
    input.explicitMax === undefined
  ) {
    return undefined;
  }

  const dataMin =
    finiteValues.length > 0
      ? Math.min(...finiteValues)
      : (input.explicitMin ?? input.explicitMax ?? 0);
  const dataMax =
    finiteValues.length > 0
      ? Math.max(...finiteValues)
      : (input.explicitMax ?? input.explicitMin ?? 1);
  let axisMin = input.explicitMin ?? (input.includeZero ? Math.min(0, dataMin) : dataMin);
  let axisMax = input.explicitMax ?? (input.includeZero ? Math.max(0, dataMax) : dataMax);

  if (axisMin === axisMax) {
    if (axisMin === 0) {
      axisMax = input.explicitMax ?? 1;
    } else if (axisMin > 0) {
      axisMin = input.explicitMin ?? (input.includeZero ? 0 : axisMin * 0.9);
      axisMax = input.explicitMax ?? axisMax * 1.1;
    } else {
      axisMin = input.explicitMin ?? axisMin * 1.1;
      axisMax = input.explicitMax ?? (input.includeZero ? 0 : axisMax * 0.9);
    }
  }

  const requestedTickCount = input.tickCount ?? EXCEL_VALUE_AXIS_TICK_COUNT;
  const resolvedTickCount =
    input.includeZero && dataMin < 0 && dataMax > 0
      ? Math.max(requestedTickCount, EXCEL_DIVERGING_VALUE_AXIS_TICK_COUNT)
      : requestedTickCount;
  const step = input.explicitTickStep ?? Math.abs(tickStep(axisMin, axisMax, resolvedTickCount));
  if (!Number.isFinite(step) || step <= 0) return undefined;

  let domainMin =
    input.explicitMin !== undefined ? input.explicitMin : Math.floor(axisMin / step) * step;
  let domainMax =
    input.explicitMax !== undefined ? input.explicitMax : Math.ceil(axisMax / step) * step;

  if (input.includeZero && input.explicitMin === undefined && dataMin >= 0) {
    domainMin = Math.min(0, domainMin);
  }
  if (input.includeZero && input.explicitMax === undefined && dataMax <= 0) {
    domainMax = Math.max(0, domainMax);
  }
  if (domainMin === domainMax) {
    if (input.explicitMax === undefined) domainMax = domainMin + step;
    else if (input.explicitMin === undefined) domainMin = domainMax - step;
  }

  if (
    input.explicitMax === undefined &&
    domainMax > 0 &&
    dataMax > 0 &&
    domainMax - dataMax <= step * HEADROOM_STEP_FRACTION
  ) {
    domainMax += step;
  }
  if (
    input.explicitMin === undefined &&
    domainMin < 0 &&
    dataMin < 0 &&
    dataMin - domainMin <= step * HEADROOM_STEP_FRACTION
  ) {
    domainMin -= step;
  }

  return {
    domain: [roundDomainBound(domainMin), roundDomainBound(domainMax)],
    tickStep: roundDomainBound(step),
    tickCount: resolvedTickCount,
    explicitDomain: input.explicitMin !== undefined || input.explicitMax !== undefined,
  };
}

export function roundExcelAxisBound(value: number): number {
  return roundDomainBound(value);
}

function roundDomainBound(value: number): number {
  if (Math.abs(value) < DOMAIN_EPSILON) return 0;
  return Number.parseFloat(value.toPrecision(12));
}
