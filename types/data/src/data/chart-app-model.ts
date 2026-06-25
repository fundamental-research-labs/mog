import type { AxisType, ChartType, LegendPosition, SeriesOrientation } from './charts';

export type ChartAxisRole =
  | 'category'
  | 'value'
  | 'secondaryCategory'
  | 'secondaryValue'
  | 'series';

export type ChartAppModelValueSource = 'explicit' | 'default' | 'absent';

export interface ChartTitleAppModel {
  readonly text: string | null;
  readonly visible: boolean;
  readonly source: ChartAppModelValueSource;
}

export interface ChartLegendAppModel {
  readonly visible: boolean;
  readonly position: LegendPosition;
  readonly source: ChartAppModelValueSource;
}

export interface ChartAxisAppModel {
  readonly role: ChartAxisRole;
  readonly applicable: boolean;
  readonly visible: boolean;
  readonly title: string | null;
  readonly titleVisible: boolean;
  readonly source: ChartAppModelValueSource;
  readonly axisType?: AxisType;
}

export type ChartSourceBindingKind =
  | 'range'
  | 'explicitSeries'
  | 'cacheBackedSeries'
  | 'literalSeries'
  | 'partial'
  | 'unsupported';

export interface ChartSourceBindingAppModel {
  readonly kind: ChartSourceBindingKind;
  readonly orientation?: SeriesOrientation;
  readonly dataRange?: string;
  readonly categoryRange?: string;
  readonly seriesRange?: string;
  readonly explicitSeriesCount?: number;
  readonly renderableSeriesCount?: number;
  readonly supportsOrientationSwitch: boolean;
  readonly diagnostics: readonly string[];
}

export interface ChartAppModel {
  readonly id: string;
  readonly type: ChartType;
  readonly title: ChartTitleAppModel;
  readonly legend: ChartLegendAppModel;
  readonly axes: {
    readonly category: ChartAxisAppModel;
    readonly value: ChartAxisAppModel;
    readonly secondaryCategory?: ChartAxisAppModel;
    readonly secondaryValue?: ChartAxisAppModel;
    readonly series?: ChartAxisAppModel;
  };
  readonly source: ChartSourceBindingAppModel;
}

export interface ChartSourceBindingChange {
  readonly before: ChartSourceBindingAppModel;
  readonly after: ChartSourceBindingAppModel;
  readonly renderedGroupingChanged: boolean;
  readonly explicitSeriesAction?: 'preserved' | 'rewritten' | 'cleared' | 'notApplicable';
}
