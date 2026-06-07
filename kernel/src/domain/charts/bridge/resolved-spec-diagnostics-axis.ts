import type { ChartConfig } from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import {
  isXYValueAxisChartType,
  secondarySemanticCategoryAxisForModel,
  secondaryValueAxisForModel,
  semanticCategoryAxisForModel,
  xValueAxisForModel,
  yValueAxisForModel,
} from './axis-role';

type ResolvedSnapshotSeries = ResolvedChartSpecSnapshot['resolved']['series'];
type SingleAxisConfig = NonNullable<NonNullable<ChartConfig['axis']>['categoryAxis']>;
type AxisDiagnosticRole = 'category' | 'value' | 'xValue' | 'yValue' | 'series';
type AxisOrientation = 'horizontal' | 'vertical';
type AxisPosition = 'bottom' | 'top' | 'left' | 'right';

export function axisUnsupportedFeatureDiagnostics(
  config: ChartConfig,
  series: ResolvedSnapshotSeries,
): string[] {
  const axis = config.axis;
  if (!axis) return [];
  const diagnostics = new Set<string>();
  const isChartEx = (config.extra as { isChartEx?: boolean } | undefined)?.isChartEx === true;
  const isHorizontal = isHorizontalChartType(config.type);
  const isXYChart = isXYValueAxisChartType(config.type);
  const entries = axisDiagnosticEntries(config);

  for (const { label, role, axisConfig, secondary } of entries) {
    if (!axisConfig) continue;
    if (role === 'series') {
      diagnostics.add('series/depth axes are preserved but not rendered');
    }
    if (isChartEx) {
      diagnostics.add(
        `ChartEx ${label} axis metadata is preserved but rendered through the standard chart axis backend`,
      );
    }
    const positionDiagnostic = axisPositionDiagnostic(
      label,
      role,
      axisConfig,
      isHorizontal,
      isXYChart,
    );
    if (positionDiagnostic) diagnostics.add(positionDiagnostic);
    if (secondary && role === 'category') {
      const scaleDiagnostic = secondaryCategoryIndependentScaleDiagnostic(label, axisConfig);
      if (scaleDiagnostic) diagnostics.add(scaleDiagnostic);
    }
    for (const diagnostic of logAxisDiagnostics(label, axisConfig, series)) {
      diagnostics.add(diagnostic);
    }
  }

  return Array.from(diagnostics);
}

function axisPositionDiagnostic(
  label: string,
  role: AxisDiagnosticRole,
  axisConfig: SingleAxisConfig,
  isHorizontalChart: boolean,
  isXYChart: boolean,
): string | undefined {
  if (!axisConfig.position) return undefined;
  const position = normalizeAxisPosition(axisConfig.position);
  if (!position) {
    return `${label} axis position "${axisConfig.position}" is not recognized`;
  }
  const expectedOrientation = expectedAxisOrientation(role, isHorizontalChart);
  if (!expectedOrientation) return undefined;
  const allowed =
    expectedOrientation === 'horizontal'
      ? new Set<AxisPosition>(['bottom', 'top'])
      : new Set<AxisPosition>(['left', 'right']);
  if (allowed.has(position)) return undefined;
  if (isXYChart && isXYValueDiagnosticRole(role)) return undefined;
  return `${label} axis position "${axisConfig.position}" does not match ${expectedOrientation} axis geometry`;
}

function isXYValueDiagnosticRole(role: AxisDiagnosticRole): boolean {
  return role === 'xValue' || role === 'yValue' || role === 'value';
}

function expectedAxisOrientation(
  role: AxisDiagnosticRole,
  isHorizontalChart: boolean,
): AxisOrientation | undefined {
  if (role === 'series') return undefined;
  if (role === 'xValue') return 'horizontal';
  if (role === 'yValue') return 'vertical';
  if (role === 'category') return isHorizontalChart ? 'vertical' : 'horizontal';
  return isHorizontalChart ? 'horizontal' : 'vertical';
}

function axisDiagnosticEntries(config: ChartConfig): Array<{
  label: string;
  role: AxisDiagnosticRole;
  axisConfig: SingleAxisConfig | undefined;
  secondary?: boolean;
}> {
  const axis = config.axis;
  if (!axis) return [];
  if (isXYValueAxisChartType(config.type)) {
    return [
      {
        label: 'category',
        role: 'category',
        axisConfig: semanticCategoryAxisForModel(config),
      },
      {
        label: 'x value',
        role: 'xValue',
        axisConfig: xValueAxisForModel(config),
      },
      {
        label: 'y value',
        role: 'yValue',
        axisConfig: yValueAxisForModel(config),
      },
      {
        label: 'secondary category',
        role: 'category',
        axisConfig: secondarySemanticCategoryAxisForModel(config),
        secondary: true,
      },
      {
        label: 'secondary value',
        role: 'value',
        axisConfig: secondaryValueAxisForModel(config),
        secondary: true,
      },
      { label: 'series/depth', role: 'series', axisConfig: axis.seriesAxis },
    ];
  }
  return [
    { label: 'category', role: 'category', axisConfig: axis.categoryAxis ?? axis.xAxis },
    { label: 'value', role: 'value', axisConfig: axis.valueAxis ?? axis.yAxis },
    {
      label: 'secondary category',
      role: 'category',
      axisConfig: axis.secondaryCategoryAxis,
      secondary: true,
    },
    {
      label: 'secondary value',
      role: 'value',
      axisConfig: axis.secondaryValueAxis ?? axis.secondaryYAxis,
      secondary: true,
    },
    { label: 'series/depth', role: 'series', axisConfig: axis.seriesAxis },
  ];
}

function normalizeAxisPosition(position: string): AxisPosition | undefined {
  switch (position.toLowerCase()) {
    case 'b':
    case 'bottom':
      return 'bottom';
    case 't':
    case 'top':
      return 'top';
    case 'l':
    case 'left':
      return 'left';
    case 'r':
    case 'right':
      return 'right';
    default:
      return undefined;
  }
}

function secondaryCategoryIndependentScaleDiagnostic(
  label: string,
  axisConfig: SingleAxisConfig,
): string | undefined {
  const fields = [
    axisConfig.min !== undefined ? 'min' : undefined,
    axisConfig.max !== undefined ? 'max' : undefined,
    axisConfig.logBase !== undefined ? 'logBase' : undefined,
    axisConfig.scaleType !== undefined ? 'scaleType' : undefined,
    axisConfig.reverse !== undefined ? 'reverse' : undefined,
    axisConfig.majorUnit !== undefined ? 'majorUnit' : undefined,
    axisConfig.minorUnit !== undefined ? 'minorUnit' : undefined,
    axisConfig.categoryType !== undefined ? 'categoryType' : undefined,
    axisConfig.baseTimeUnit !== undefined ? 'baseTimeUnit' : undefined,
    axisConfig.majorTimeUnit !== undefined ? 'majorTimeUnit' : undefined,
    axisConfig.minorTimeUnit !== undefined ? 'minorTimeUnit' : undefined,
  ].filter(Boolean);
  if (fields.length === 0) return undefined;
  return `${label} axis independent scale/domain is preserved but rendered on the primary category scale (${fields.join(', ')})`;
}

function isHorizontalChartType(chartType: ChartConfig['type']): boolean {
  switch (chartType) {
    case 'bar':
    case 'bar3d':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
      return true;
    default:
      return false;
  }
}

function logAxisDiagnostics(
  label: string,
  axisConfig: SingleAxisConfig,
  series: ResolvedSnapshotSeries,
): string[] {
  const isLogAxis = axisConfig.scaleType === 'logarithmic' || axisConfig.logBase !== undefined;
  if (!isLogAxis) return [];

  const diagnostics: string[] = [];
  const logBase = axisConfig.logBase ?? 10;
  if (!Number.isFinite(logBase) || logBase <= 1) {
    diagnostics.push(`${label} axis logarithmic scale has invalid base`);
  }

  const invalidDomainFields = [
    axisConfig.min !== undefined && axisConfig.min <= 0 ? 'min' : undefined,
    axisConfig.max !== undefined && axisConfig.max <= 0 ? 'max' : undefined,
  ].filter(Boolean);
  if (invalidDomainFields.length > 0) {
    diagnostics.push(
      `${label} axis logarithmic scale has non-positive ${invalidDomainFields.join('/')} domain`,
    );
  }

  const values = positiveDomainCandidateValues(label, series);
  if (values.length > 0 && values.every((value) => value <= 0)) {
    diagnostics.push(`${label} axis logarithmic scale has no positive bound data values`);
  }

  return diagnostics;
}

function positiveDomainCandidateValues(label: string, series: ResolvedSnapshotSeries): number[] {
  if (label === 'x value') {
    return series
      .flatMap((item) => item.xValues)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }
  if (label === 'value' || label === 'y value') {
    return series
      .filter((item) => item.axisGroup !== 'secondary')
      .flatMap((item) => item.values)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }
  if (label === 'secondary value') {
    return series
      .filter((item) => item.axisGroup === 'secondary')
      .flatMap((item) => item.values)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }
  return [];
}
