/**
 * Floating Object Mapper — Converts wire types (FloatingObject from compute-types.gen)
 * to domain types (FloatingObject from contracts) and vice versa.
 *
 * The wire format (WireFloatingObject = FloatingObjectCommon & FloatingObjectData)
 * comes from Rust serde with a nested `anchor: FloatingObjectAnchor` field,
 * while the domain types use structured ObjectPosition with CellAnchor sub-objects.
 *
 * Typed wire-format mapping.
 */

import type {
  FloatingObject,
  FloatingObjectGroup,
  FloatingObjectKind,
  ObjectPosition,
  ObjectAnchorType,
  CellAnchor,
  ShapeType,
  ChartObjectType,
  ShapeObject,
  PictureObject,
  TextBoxObject,
  ConnectorObject,
  ChartObject,
  EquationObject,
  DiagramObject,
  OleObjectObject,
} from '@mog-sdk/contracts/floating-objects';
import type { DrawingObject, StrokeId, InkStroke, RecognitionResult } from '@mog-sdk/contracts/ink';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import { getAllDefaultToolSettings } from '../../domain/drawing/ink/ink-tool-defaults';
import { getEquationStyleDefaults } from '../../domain/equations/equation-defaults';

import type {
  FloatingObject as WireFloatingObject,
  FloatingObjectCommon,
  SerializedFloatingObjectGroup,
  DrawingData,
  ShapeData,
  PictureData,
  TextboxData,
  ConnectorData,
  ChartData,
  EquationData,
  FloatingObjectAnchor,
  DiagramData,
  OleObjectData,
} from './compute-types.gen';

// =============================================================================
// Helpers
// =============================================================================

/** English Metric Units per CSS pixel at 96 DPI. */
const EMU_PER_PX = 9525;

interface LegacyFloatingObjectAnchorFields {
  anchorRowOffset: number;
  anchorColOffset: number;
  endRowOffset: number;
  endColOffset: number;
  extentCx: number;
  extentCy: number;
}

type FloatingObjectAnchorWire = Partial<FloatingObjectAnchor> &
  Partial<LegacyFloatingObjectAnchorFields>;

function emuToPx(value: number | undefined): number | undefined {
  return value == null ? undefined : value / EMU_PER_PX;
}

function readNumber(source: unknown, key: string): number | undefined {
  const value = (source as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'number' ? value : undefined;
}

function readString(source: unknown, key: string): string | undefined {
  const value = (source as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

function emuField(
  source: FloatingObjectAnchorWire | undefined,
  canonical: keyof FloatingObjectAnchor,
  legacy: keyof LegacyFloatingObjectAnchorFields,
): number | undefined {
  const value = source?.[canonical] ?? source?.[legacy];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Fallback CellId from positional coordinates.
 * Used only when wire data lacks a pre-resolved anchorCellId (old documents).
 */
function positionalCellId(row: number, col: number): string {
  return `cell-${row}-${col}`;
}

/**
 * Parse the anchorMode string from wire data into an ObjectAnchorType.
 * Defaults to 'absolute' if unrecognized or missing.
 */
function parseAnchorType(anchorMode?: string): ObjectAnchorType {
  if (anchorMode === 'twoCell') return 'twoCell';
  if (anchorMode === 'oneCell') return 'oneCell';
  return 'absolute';
}

function hasFlatLegacyAnchor(data: unknown): boolean {
  return (
    readNumber(data, 'anchorRow') !== undefined ||
    readNumber(data, 'anchorCol') !== undefined ||
    readNumber(data, 'anchorRowOffset') !== undefined ||
    readNumber(data, 'anchorColOffset') !== undefined ||
    readNumber(data, 'anchorRowOffsetEmu') !== undefined ||
    readNumber(data, 'anchorColOffsetEmu') !== undefined ||
    readString(data, 'anchorMode') !== undefined ||
    readNumber(data, 'xOffset') !== undefined ||
    readNumber(data, 'yOffset') !== undefined
  );
}

function buildFlatLegacyAnchor(data: unknown): FloatingObjectAnchorWire | undefined {
  if (!hasFlatLegacyAnchor(data)) return undefined;
  return {
    anchorRow: readNumber(data, 'anchorRow'),
    anchorCol: readNumber(data, 'anchorCol'),
    anchorMode: readString(data, 'anchorMode') as ObjectAnchorType | undefined,
    anchorRowOffsetEmu: readNumber(data, 'anchorRowOffsetEmu'),
    anchorColOffsetEmu: readNumber(data, 'anchorColOffsetEmu'),
    anchorRowOffset: readNumber(data, 'anchorRowOffset'),
    anchorColOffset: readNumber(data, 'anchorColOffset'),
    endRow: readNumber(data, 'endRow'),
    endCol: readNumber(data, 'endCol'),
    endRowOffsetEmu: readNumber(data, 'endRowOffsetEmu'),
    endColOffsetEmu: readNumber(data, 'endColOffsetEmu'),
    endRowOffset: readNumber(data, 'endRowOffset'),
    endColOffset: readNumber(data, 'endColOffset'),
    extentCxEmu: readNumber(data, 'extentCxEmu'),
    extentCyEmu: readNumber(data, 'extentCyEmu'),
    extentCx: readNumber(data, 'extentCx'),
    extentCy: readNumber(data, 'extentCy'),
  };
}

/**
 * Build a CellAnchor. Uses the pre-resolved anchorCellId from wire data
 * when available, otherwise falls back to positional ID.
 */
function buildCellAnchor(
  row: number | undefined,
  col: number | undefined,
  xOffset: number | undefined,
  yOffset: number | undefined,
  anchorCellId?: string,
): CellAnchor {
  return {
    cellId: toCellId(anchorCellId || positionalCellId(row ?? 0, col ?? 0)),
    xOffset: xOffset ?? 0,
    yOffset: yOffset ?? 0,
  };
}

// =============================================================================
// Position Mapping
// =============================================================================

/**
 * Convert wire anchor fields to a structured ObjectPosition.
 *
 * WireFloatingObject has a nested `anchor: FloatingObjectAnchor`.
 * SerializedFloatingObjectGroup has flat optional x/y/width/height fields
 * with no anchor sub-object.
 */
export function toObjectPosition(
  data: WireFloatingObject | SerializedFloatingObjectGroup,
): ObjectPosition {
  // WireFloatingObject has nested anchor; SerializedFloatingObjectGroup has flat optional fields
  const isWire = 'anchor' in data && data.anchor != null;
  const anchor: FloatingObjectAnchorWire | undefined = isWire
    ? (data as WireFloatingObject).anchor
    : buildFlatLegacyAnchor(data);
  const legacyFlatXOffsetPx = isWire ? undefined : readNumber(data, 'xOffset');
  const legacyFlatYOffsetPx = isWire ? undefined : readNumber(data, 'yOffset');
  const anchorMode = anchor?.anchorMode;
  const anchorType = parseAnchorType(anchorMode);

  const from = buildCellAnchor(
    anchor?.anchorRow,
    anchor?.anchorCol,
    emuToPx(emuField(anchor, 'anchorColOffsetEmu', 'anchorColOffset')) ?? legacyFlatXOffsetPx,
    emuToPx(emuField(anchor, 'anchorRowOffsetEmu', 'anchorRowOffset')) ?? legacyFlatYOffsetPx,
    (data as WireFloatingObject).anchorCellId,
  );

  const position: ObjectPosition = {
    anchorType,
    from,
    x: (data as SerializedFloatingObjectGroup).x ?? 0,
    y: (data as SerializedFloatingObjectGroup).y ?? 0,
    width:
      emuField(anchor, 'extentCxEmu', 'extentCx') != null
        ? emuField(anchor, 'extentCxEmu', 'extentCx')! / EMU_PER_PX
        : (data.width ?? 0),
    height:
      emuField(anchor, 'extentCyEmu', 'extentCy') != null
        ? emuField(anchor, 'extentCyEmu', 'extentCy')! / EMU_PER_PX
        : (data.height ?? 0),
  };

  // twoCell end anchor
  if (anchor?.endRow != null || anchor?.endCol != null) {
    position.to = buildCellAnchor(
      anchor.endRow,
      anchor.endCol,
      emuToPx(emuField(anchor, 'endColOffsetEmu', 'endColOffset')),
      emuToPx(emuField(anchor, 'endRowOffsetEmu', 'endRowOffset')),
      (data as WireFloatingObject).toAnchorCellId,
    );
  }

  // Rotation and flip from WireFloatingObject
  if (isWire) {
    const wire = data as WireFloatingObject;
    if (wire.rotation != null) position.rotation = wire.rotation;
    if (wire.flipH != null) position.flipH = wire.flipH;
    if (wire.flipV != null) position.flipV = wire.flipV;
  }

  return position;
}

// =============================================================================
// Base Fields
// =============================================================================

/**
 * Build the common FloatingObjectBase fields from wire data.
 */
function buildBaseFields(data: WireFloatingObject) {
  const position = toObjectPosition(data);
  return {
    id: data.id,
    sheetId: toSheetId(data.sheetId),
    containerId: data.sheetId,
    position,
    anchor: position, // same reference per contract
    zIndex: data.zIndex ?? 0,
    locked: data.locked ?? false,
    printable: data.printable ?? true,
    name: data.name,
    visible: data.visible,
    groupId: data.groupId,
    altText: 'altText' in data ? (data.altText as string | undefined) : undefined,
    lockAspectRatio:
      'lockAspectRatio' in data ? (data.lockAspectRatio as boolean | undefined) : undefined,
    altTextTitle: 'altTextTitle' in data ? (data.altTextTitle as string | undefined) : undefined,
    displayName: 'displayName' in data ? (data.displayName as string | undefined) : undefined,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

// =============================================================================
// Variant Mappers
// =============================================================================

type WireShape = FloatingObjectCommon & { type: 'shape' } & ShapeData;
type WirePicture = FloatingObjectCommon & { type: 'picture' } & PictureData;
type WireTextbox = FloatingObjectCommon & { type: 'textbox' } & TextboxData;
type WireConnector = FloatingObjectCommon & { type: 'connector' } & ConnectorData;
type WireChart = FloatingObjectCommon & { type: 'chart' } & ChartData;
type WireEquation = FloatingObjectCommon & { type: 'equation' } & EquationData;
type WireDiagram = FloatingObjectCommon & { type: 'diagram' } & DiagramData;
type WireDrawing = FloatingObjectCommon & { type: 'drawing' } & DrawingData;
type WireOleObject = FloatingObjectCommon & { type: 'oleObject' } & OleObjectData;

function toShapeObject(d: WireShape): ShapeObject {
  return {
    ...buildBaseFields(d),
    type: 'shape' as const,
    shapeType: (d.shapeType ?? 'rect') as ShapeType,
    fill: d.fill,
    outline: d.outline,
    text: d.text,
    shadow: d.shadow,
    adjustments: d.adjustments as Record<string, number> | undefined,
    lockAspectRatio: (d as any).lockAspectRatio,
  };
}

function toPictureObject(d: WirePicture): PictureObject {
  return {
    ...buildBaseFields(d),
    type: 'picture' as const,
    src: d.src ?? '',
    originalWidth: d.originalWidth ?? 0,
    originalHeight: d.originalHeight ?? 0,
    crop: d.crop as PictureObject['crop'],
    adjustments: d.adjustments as PictureObject['adjustments'],
    border: d.border as PictureObject['border'],
    colorType: (d as any).colorType,
  };
}

function toTextBoxObject(d: WireTextbox): TextBoxObject {
  // TextboxData now carries the shared nested `text: ShapeText` model only.
  // The old flat wire shape (content/defaultFormat/margins/verticalAlign)
  // was removed when textbox adopted the shape-text model; no fallback needed.
  const textEffects =
    d.textEffects ?? (d as WireTextbox & { wordArt?: TextBoxObject['textEffects'] }).wordArt;
  return {
    ...buildBaseFields(d),
    type: 'textbox' as const,
    text: d.text,
    fill: d.fill,
    border: d.border as TextBoxObject['border'],
    textEffects: textEffects as TextBoxObject['textEffects'],
  };
}

function toConnectorObject(d: WireConnector): ConnectorObject {
  return {
    ...buildBaseFields(d),
    type: 'connector' as const,
    shapeType: (d.shapeType ?? 'connector') as ShapeType,
    startConnection: d.startConnection,
    endConnection: d.endConnection,
    fill: d.fill,
    outline: d.outline,
  };
}

function toChartObject(d: WireChart): ChartObject {
  // Sanitize title: treat the literal string "undefined" as missing (null).
  // This can happen when JS `undefined` leaks through a JSON/NAPI bridge as a string.
  const sanitizedTitle = d.title != null && d.title !== 'undefined' ? d.title : undefined;
  const sanitizedSubtitle =
    d.subtitle != null && d.subtitle !== 'undefined' ? d.subtitle : undefined;

  const chartConfig: Record<string, unknown> = {
    subType: d.subType,
    seriesOrientation: d.seriesOrientation,
    dataRange: d.dataRange,
    dataRangeIdentity: d.dataRangeIdentity,
    seriesRange: d.seriesRange,
    seriesRangeIdentity: d.seriesRangeIdentity,
    categoryRange: d.categoryRange,
    categoryRangeIdentity: d.categoryRangeIdentity,
    title: sanitizedTitle,
    subtitle: sanitizedSubtitle,
    legend: d.legend,
    axis: d.axis,
    colors: d.colors,
    series: d.series,
    dataLabels: d.dataLabels,
    pieSlice: d.pieSlice,
    trendline: d.trendline,
    showLines: d.showLines,
    smoothLines: d.smoothLines,
    radarFilled: d.radarFilled,
    radarMarkers: d.radarMarkers,
    waterfall: d.waterfall,
    sourceTableId: d.sourceTableId,
    tableDataColumns: d.tableDataColumns,
    tableCategoryColumn: d.tableCategoryColumn,
    useTableColumnNamesAsLabels: d.useTableColumnNamesAsLabels,
    tableColumnNames: d.tableColumnNames,
    ooxml: d.ooxml,
  };
  return {
    ...buildBaseFields(d),
    type: 'chart' as const,
    chartType: (d.chartType && d.chartType !== 'undefined'
      ? d.chartType
      : 'column') as ChartObjectType,
    anchorMode: (d.anchor.anchorMode === 'twoCell'
      ? 'twoCell'
      : 'oneCell') as ChartObject['anchorMode'],
    widthCells: d.widthCells ?? d.width ?? 8,
    heightCells: d.heightCells ?? d.height ?? 15,
    chartConfig,
    dataRangeIdentity: d.dataRangeIdentity,
    seriesRangeIdentity: d.seriesRangeIdentity,
    categoryRangeIdentity: d.categoryRangeIdentity,
  };
}

function toEquationObject(d: WireEquation): EquationObject {
  const defaultStyle = getEquationStyleDefaults();
  const wireEquation = d.equation as unknown;
  const equation: EquationObject['equation'] =
    typeof wireEquation === 'string'
      ? {
          id: d.id as EquationObject['equation']['id'],
          latex: wireEquation.trimStart().startsWith('<') ? '' : wireEquation,
          omml: wireEquation.trimStart().startsWith('<') ? wireEquation : '',
          style: defaultStyle,
        }
      : (() => {
          const structured = wireEquation as Partial<EquationObject['equation']>;
          return {
            ...structured,
            id: structured.id ?? (d.id as EquationObject['equation']['id']),
            latex: structured.latex ?? '',
            omml: structured.omml ?? '',
            style: {
              ...defaultStyle,
              ...(structured.style ?? {}),
            },
          } as EquationObject['equation'];
        })();
  return {
    ...buildBaseFields(d),
    type: 'equation' as const,
    equation,
  };
}

function toDiagramObject(d: WireDiagram): DiagramObject {
  return {
    ...buildBaseFields(d),
    type: 'diagram' as const,
    diagram: (d.definition ?? {}) as DiagramObject['diagram'],
  };
}

function toDrawingObject(d: WireDrawing): DrawingObject {
  const common = buildBaseFields(d);

  const strokes = new Map<StrokeId, InkStroke>();
  if (d.strokes) {
    for (const [id, stroke] of Object.entries(d.strokes)) {
      strokes.set(id as StrokeId, stroke as InkStroke);
    }
  }

  const recognitions = new Map<string, RecognitionResult>();
  if (d.recognitions) {
    for (const [id, recognition] of Object.entries(d.recognitions)) {
      recognitions.set(id, recognition as RecognitionResult);
    }
  }

  return {
    ...common,
    type: 'drawing' as const,
    strokes,
    toolState: d.toolState ?? {
      activeTool: 'pen' as const,
      toolSettings: getAllDefaultToolSettings(),
    },
    recognitions,
    backgroundColor: d.backgroundColor,
  };
}

function toOleObjectObject(d: WireOleObject): OleObjectObject {
  return {
    ...buildBaseFields(d),
    type: 'oleObject' as const,
    progId: d.progId ?? '',
    dvAspect: (d.dvAspect ?? 'content') as OleObjectObject['dvAspect'],
    isLinked: d.isLinked ?? false,
    isEmbedded: d.isEmbedded ?? true,
    previewImageSrc: d.previewImageSrc ?? null,
    altText: d.altText ?? '',
  };
}

// =============================================================================
// Main Mapper
// =============================================================================

/**
 * Convert a WireFloatingObject (wire format) to the domain FloatingObject union.
 * Dispatches on `data.type` to build the correct variant with required fields defaulted.
 * Unknown or missing types default to the 'shape' variant.
 */
export function toFloatingObject(data: WireFloatingObject): FloatingObject {
  // Switch on data.type — TypeScript narrows the discriminated union at each case.
  switch (data.type) {
    case 'shape':
      return toShapeObject(data);
    case 'picture':
      return toPictureObject(data);
    case 'textbox':
      return toTextBoxObject(data);
    case 'connector':
      return toConnectorObject(data);
    case 'chart':
      return toChartObject(data);
    case 'equation':
      return toEquationObject(data);
    case 'diagram':
      return toDiagramObject(data);
    case 'oleObject':
      return toOleObjectObject(data);
    case 'drawing':
      return toDrawingObject(data);
    case 'slicer':
    case 'camera':
    case 'formControl':
    default: {
      // Fallback: treat unknown/unsupported types as shapes.
      // Build a minimal shape from the common fields.
      const fallback: WireShape = Object.assign({}, data, { type: 'shape' as const }) as WireShape;
      return toShapeObject(fallback);
    }
  }
}

// =============================================================================
// Group Mapper
// =============================================================================

/**
 * Convert a SerializedFloatingObjectGroup (wire format) to the domain FloatingObjectGroup.
 */
export function toFloatingObjectGroup(data: SerializedFloatingObjectGroup): FloatingObjectGroup {
  const position = toObjectPosition(data);
  return {
    id: data.id,
    sheetId: toSheetId(data.sheetId),
    containerId: data.sheetId,
    memberIds: data.children,
    zIndex: data.zIndex ?? 0,
    name: data.name,
    locked: data.locked ?? false,
    position,
  };
}

// =============================================================================
// Minimal Object Factory
// =============================================================================

/**
 * Create a minimal FloatingObject with all required fields defaulted.
 * Useful for fallback paths that need a type-safe object without wire data.
 */
export function createMinimalFloatingObject(
  type: FloatingObjectKind,
  id: string,
  sheetId: string,
  extras?: Partial<WireFloatingObject>,
): FloatingObject {
  const wire = {
    id,
    sheetId,
    type,
    anchor: {
      anchorRow: 0,
      anchorCol: 0,
      anchorRowOffsetEmu: 0,
      anchorColOffsetEmu: 0,
      anchorMode: 'absolute' as const,
    },
    width: 100,
    height: 100,
    zIndex: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: '',
    createdAt: 0,
    updatedAt: 0,
    ...extras,
  } as WireFloatingObject;
  return toFloatingObject(wire);
}
