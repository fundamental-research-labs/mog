import type { ChartConfig } from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { axisUnsupportedFeatureDiagnostics } from './resolved-spec-diagnostics-axis';
import { chartGapDepth } from './resolved-spec-diagnostics-depth';
import {
  hasManualDataLabelLayout,
  hasManualLegendLayout,
  hasManualPlotLayout,
  hasManualTitleLayout,
  pivotFieldButtonDiagnostic,
} from './resolved-spec-diagnostics-features';
import {
  comboScatterSeriesDiagnostics,
  hasPictureMarkers,
  hasSourceLinkedDataLabelFormatWithoutModeledFormat,
} from './resolved-spec-diagnostics-series';
import {
  barShapeDiagnostics,
  isSurfaceFamilyConfig,
  isSurfaceTopViewConfig,
  surfaceFamilyDiagnostics,
} from './resolved-spec-diagnostics-surface';
import {
  importStatusUnsupportedDiagnostics,
  packageAuthorityDiagnostics,
} from './resolved-spec-package-authority';

export { chartGapDepth } from './resolved-spec-diagnostics-depth';
export { snapshotPackageAuthority } from './resolved-spec-package-authority';

type ResolvedSnapshotSeries = ResolvedChartSpecSnapshot['resolved']['series'];
type ResolvedSnapshotLayout = ResolvedChartSpecSnapshot['resolved']['layout'];

export function unsupportedFeatureDiagnostics(input: {
  chart: ChartFloatingObject;
  config: ChartConfig;
  series: ResolvedSnapshotSeries;
  layout: ResolvedSnapshotLayout | null;
  hasRenderableChartExData: boolean;
  sourceLinkedAxisNumberFormatDiagnostics: readonly string[];
}): string[] {
  const { chart, config, series, layout } = input;
  const unsupported: string[] = [];
  const isSurfaceFamily = isSurfaceFamilyConfig(config);
  const isSurfaceTopView = isSurfaceTopViewConfig(config);
  const isRendered3D = isRendered3DPlotConfig(config);
  unsupported.push(...importStatusUnsupportedDiagnostics(chart.importStatus));
  unsupported.push(...packageAuthorityDiagnostics(chart));
  if (!isRendered3D) {
    if (config.type === 'bar3d' || config.type === 'column3d') {
      unsupported.push('3-D bar chart rendered as 2-D bar/column approximation');
      for (const shape of barShapeDiagnostics(config)) {
        unsupported.push(`3-D bar shape "${shape}" is preserved but rendered as rectangular bars`);
      }
      if (chartGapDepth(config) !== undefined)
        unsupported.push('3-D bar gapDepth is preserved but not rendered');
    } else if (String(config.type).endsWith('3d') && config.type !== 'surface3d') {
      unsupported.push('3-D chart rendering is approximated by the 2-D chart backend');
    }
  }
  unsupported.push(...surfaceFamilyDiagnostics(config));
  if (config.type === 'regionMap')
    unsupported.push('region map rendering uses placeholder geometry');
  if (config.type === 'treemap')
    unsupported.push('treemap rendering requires hierarchy layout semantics');
  if (config.type === 'sunburst')
    unsupported.push('sunburst rendering requires hierarchy layout semantics');
  const isChartEx = (config.extra as { isChartEx?: boolean } | undefined)?.isChartEx === true;
  if (isChartEx && !config.dataRange && !input.hasRenderableChartExData) {
    unsupported.push(`ChartEx ${config.type} data projection is not implemented`);
  }
  if (config.pivotOptions || config.showAllFieldButtons)
    unsupported.push(pivotFieldButtonDiagnostic(config));
  for (const diagnostic of config.pivotProjection?.diagnostics ?? []) {
    unsupported.push(
      diagnostic.message ?? `pivot chart projection diagnostic: ${diagnostic.reason}`,
    );
  }
  if (!layout) {
    if (hasManualPlotLayout(config))
      unsupported.push('manual plot layout is preserved but not rendered');
    if (hasManualTitleLayout(config))
      unsupported.push('manual title layout is preserved but not rendered');
    if (hasManualLegendLayout(config))
      unsupported.push('manual legend layout is preserved but not rendered');
  }
  if (hasManualDataLabelLayout(config) && !layout?.dataLabels)
    unsupported.push('manual data-label layout is preserved but not rendered');
  if (config.dataTable && !layout?.dataTable)
    unsupported.push('chart data table is preserved but not rendered');
  if (hasPictureMarkers(config))
    unsupported.push('picture markers are preserved for export but rendered as standard symbols');
  unsupported.push(...comboScatterSeriesDiagnostics(config, series));
  if (hasSourceLinkedDataLabelFormatWithoutModeledFormat(config))
    unsupported.push(
      'source-linked data label number formats are preserved but rendered with modeled fallback formatting',
    );
  if (config.type === 'ofPie' && config.seriesLines && config.seriesLines.visible !== false)
    unsupported.push(
      'of-pie series lines require secondary-plot geometry and are preserved for export only',
    );
  if (config.view3d && !isSurfaceFamily && !isRendered3D)
    unsupported.push('view3D camera/depth is preserved but rendered as a 2-D approximation');
  if ((config.floorFormat || config.sideWallFormat || config.backWallFormat) && !isSurfaceTopView)
    unsupported.push('floor/sideWall/backWall surfaces are preserved but not rendered');
  unsupported.push(...input.sourceLinkedAxisNumberFormatDiagnostics);
  if (!isSurfaceTopView) unsupported.push(...axisUnsupportedFeatureDiagnostics(config, series));
  return unsupported;
}

function isRendered3DPlotConfig(config: ChartConfig): boolean {
  switch (config.type) {
    case 'bar3d':
    case 'column3d':
    case 'line3d':
    case 'pie3d':
    case 'pie3dExploded':
    case 'area3d':
    case 'cylinderColClustered':
    case 'cylinderColStacked':
    case 'cylinderColStacked100':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'cylinderCol':
    case 'coneColClustered':
    case 'coneColStacked':
    case 'coneColStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'coneCol':
    case 'pyramidColClustered':
    case 'pyramidColStacked':
    case 'pyramidColStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
    case 'pyramidCol':
      return true;
    default:
      return false;
  }
}
