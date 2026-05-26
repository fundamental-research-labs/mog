import type { CellValue } from '@mog-sdk/contracts/core';
import type { SlicerItemState, SlicerStyle } from '@mog-sdk/contracts/slicers';

export interface SlicerPositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlicerRenderConfig {
  id: string;
  name: string;
  caption: string;
  tableName: string;
  columnName: string;
  position: SlicerPositionRect;
  style: SlicerStyle;
  zIndex: number;
  locked: boolean;
  multiSelect: boolean;
  showHeader: boolean;
}

export interface SlicerRenderItem {
  value: CellValue;
  displayText: string;
  state: SlicerItemState;
  count?: number;
}

export interface SlicerDefinition {
  config: SlicerRenderConfig;
  items: SlicerRenderItem[];
  isConnected: boolean;
  hasActiveFilter: boolean;
}
