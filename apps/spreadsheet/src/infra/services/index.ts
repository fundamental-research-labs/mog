/**
 * Shell Services
 *
 * Shell-level services that depend on UI state or coordination.
 */

import type { ChartImageExporter } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';

import { ChartImageExporterImpl } from './chart-image-exporter';

export { ChartImageExporterImpl } from './chart-image-exporter';

export interface ChartImageExporterRegistrationTarget {
  registerChartImageExporter(factory: (chartBridge: IChartBridge) => ChartImageExporter): void;
}

export function installChartImageExporter(handle: ChartImageExporterRegistrationTarget): void {
  handle.registerChartImageExporter((charts) => new ChartImageExporterImpl(charts));
}
