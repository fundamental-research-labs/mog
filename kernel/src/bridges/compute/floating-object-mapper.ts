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
import { normalizeImportedComboChart } from './chart-import-normalization';

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
  ObjectFill,
  ShapeOutline,
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

const EMU_PER_PT = 12700;
const DEFAULT_OUTLINE_WIDTH_PT = 0.75;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value != null && typeof value === 'object' ? (value as UnknownRecord) : undefined;
}

function readRecord(source: unknown, ...keys: string[]): UnknownRecord | undefined {
  const record = asRecord(source);
  if (!record) return undefined;
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return undefined;
}

function readAny(source: unknown, ...keys: string[]): unknown {
  const record = asRecord(source);
  if (!record) return undefined;
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : undefined;
}

function alphaTransparency(transforms: unknown): number | undefined {
  if (!Array.isArray(transforms)) return undefined;
  let alpha = 100000;
  let touched = false;

  for (const transform of transforms) {
    const record = asRecord(transform);
    if (!record) continue;
    const type = typeof record.type === 'string' ? record.type : undefined;
    const val = typeof record.val === 'number' ? record.val : undefined;
    const variant = Object.keys(record)[0];
    const nested = variant ? asRecord(record[variant]) : undefined;
    const nestedVal = typeof nested?.val === 'number' ? nested.val : val;
    const transformType = type ?? variant;

    if (transformType === 'Alpha' || transformType === 'alpha') {
      alpha = nestedVal ?? 100000;
      touched = true;
    } else if (transformType === 'AlphaMod' || transformType === 'alphaMod') {
      alpha *= (nestedVal ?? 100000) / 100000;
      touched = true;
    } else if (transformType === 'AlphaOff' || transformType === 'alphaOff') {
      alpha += nestedVal ?? 0;
      touched = true;
    }
  }

  return touched
    ? Math.max(0, Math.min(1, 1 - Math.max(0, Math.min(100000, alpha)) / 100000))
    : undefined;
}

function presetColorHex(value: unknown): string | undefined {
  const key = typeof value === 'string' ? value : undefined;
  switch (key) {
    case 'Black':
    case 'black':
      return '#000000';
    case 'White':
    case 'white':
      return '#FFFFFF';
    case 'Red':
    case 'red':
      return '#FF0000';
    case 'Green':
    case 'green':
      return '#008000';
    case 'Blue':
    case 'blue':
      return '#0000FF';
    case 'Yellow':
    case 'yellow':
      return '#FFFF00';
    case 'Cyan':
    case 'cyan':
    case 'Aqua':
    case 'aqua':
      return '#00FFFF';
    case 'Magenta':
    case 'magenta':
    case 'Fuchsia':
    case 'fuchsia':
      return '#FF00FF';
    default:
      return undefined;
  }
}

function schemeColorHex(value: unknown): string | undefined {
  const key = typeof value === 'string' ? value : undefined;
  switch (key) {
    case 'Dk1':
    case 'dk1':
    case 'Tx1':
    case 'tx1':
      return '#000000';
    case 'Lt1':
    case 'lt1':
    case 'Bg1':
    case 'bg1':
      return '#FFFFFF';
    case 'Dk2':
    case 'dk2':
    case 'Tx2':
    case 'tx2':
      return '#1F497D';
    case 'Lt2':
    case 'lt2':
    case 'Bg2':
    case 'bg2':
      return '#EEECE1';
    case 'Accent1':
    case 'accent1':
      return '#4472C4';
    case 'Accent2':
    case 'accent2':
      return '#ED7D31';
    case 'Accent3':
    case 'accent3':
      return '#A5A5A5';
    case 'Accent4':
    case 'accent4':
      return '#FFC000';
    case 'Accent5':
    case 'accent5':
      return '#5B9BD5';
    case 'Accent6':
    case 'accent6':
      return '#70AD47';
    case 'Hlink':
    case 'hlink':
      return '#0563C1';
    case 'FolHlink':
    case 'folHlink':
      return '#954F72';
    default:
      return undefined;
  }
}

function enumPayload(value: unknown, ...keys: string[]): UnknownRecord | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const payload = record[key];
    if (payload === null) return {};
    const payloadRecord = asRecord(payload);
    if (payloadRecord) return payloadRecord;
  }
  return undefined;
}

function enumTag(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  return record ? Object.keys(record)[0] : undefined;
}

function colorResult(
  color: string,
  transparency: number | undefined,
): { color: string; transparency?: number } {
  return transparency === undefined ? { color } : { color, transparency };
}

function resolveDrawingColor(color: unknown): { color: string; transparency?: number } | undefined {
  const srgb =
    enumPayload(color, 'SrgbClr', 'srgbClr', 'srgb_clr') ??
    readRecord(color, 'srgbClr', 'srgb_clr');
  if (srgb) {
    const resolved = normalizeHexColor(readAny(srgb, 'val'));
    return resolved
      ? colorResult(resolved, alphaTransparency(readAny(srgb, 'transforms')))
      : undefined;
  }

  const sys =
    enumPayload(color, 'SysClr', 'sysClr', 'sys_clr') ?? readRecord(color, 'sysClr', 'sys_clr');
  if (sys) {
    const resolved = normalizeHexColor(readAny(sys, 'lastClr', 'last_clr'));
    return resolved
      ? colorResult(resolved, alphaTransparency(readAny(sys, 'transforms')))
      : undefined;
  }

  const preset =
    enumPayload(color, 'PrstClr', 'prstClr', 'prst_clr') ??
    readRecord(color, 'prstClr', 'prst_clr');
  if (preset) {
    const resolved = presetColorHex(readAny(preset, 'val'));
    return resolved
      ? colorResult(resolved, alphaTransparency(readAny(preset, 'transforms')))
      : undefined;
  }

  const scheme =
    enumPayload(color, 'SchemeClr', 'schemeClr', 'scheme_clr') ??
    readRecord(color, 'schemeClr', 'scheme_clr');
  if (scheme) {
    const resolved = schemeColorHex(readAny(scheme, 'val'));
    return resolved
      ? colorResult(resolved, alphaTransparency(readAny(scheme, 'transforms')))
      : undefined;
  }

  const direct = asRecord(color);
  const directColor = normalizeHexColor(readAny(direct, 'val', 'lastClr', 'last_clr'));
  return directColor
    ? colorResult(directColor, alphaTransparency(readAny(direct, 'transforms')))
    : undefined;
}

function projectDrawingFill(fill: unknown): ObjectFill | undefined {
  const tag = enumTag(fill);
  if (tag === 'NoFill' || tag === 'noFill') return { type: 'none' };

  const solid =
    enumPayload(fill, 'Solid', 'solid', 'solidFill') ?? readRecord(fill, 'solidFill', 'solid');
  if (!solid) return undefined;

  const resolved = resolveDrawingColor(readAny(solid, 'color'));
  return resolved ? { type: 'solid', ...resolved } : undefined;
}

function projectLineFill(
  fill: unknown,
): Pick<ShapeOutline, 'style' | 'color' | 'transparency' | 'visible'> | undefined {
  const tag = enumTag(fill);
  if (tag === 'NoFill' || tag === 'noFill') {
    return { style: 'none', color: '', visible: false };
  }

  const solid =
    enumPayload(fill, 'Solid', 'solid', 'solidFill') ?? readRecord(fill, 'solidFill', 'solid');
  if (!solid) return undefined;

  const resolved = resolveDrawingColor(readAny(solid, 'color'));
  return resolved ? { style: 'solid', visible: true, ...resolved } : undefined;
}

function projectLineDash(dash: unknown): Pick<ShapeOutline, 'style' | 'dash'> {
  const presetPayload = enumPayload(dash, 'Preset', 'preset');
  const value = readAny(presetPayload, 'val') ?? readAny(dash, 'val') ?? enumTag(dash);
  switch (value) {
    case 'Solid':
    case 'solid':
      return { style: 'solid', dash: 'solid' };
    case 'Dot':
    case 'dot':
    case 'SystemDot':
    case 'sysDot':
      return { style: 'dotted', dash: 'dot' };
    case 'Dash':
    case 'dash':
    case 'SystemDash':
    case 'sysDash':
      return { style: 'dashed', dash: 'dash' };
    case 'DashDot':
    case 'dashDot':
    case 'SystemDashDot':
    case 'sysDashDot':
      return { style: 'dashed', dash: 'dashDot' };
    case 'LongDash':
    case 'lgDash':
      return { style: 'dashed', dash: 'lgDash' };
    case 'LongDashDot':
    case 'lgDashDot':
      return { style: 'dashed', dash: 'lgDashDot' };
    case 'LongDashDotDot':
    case 'lgDashDotDot':
      return { style: 'dashed', dash: 'lgDashDotDot' };
    case 'SystemDashDotDot':
    case 'sysDashDotDot':
      return { style: 'dashed', dash: 'sysDashDotDot' };
    default:
      return { style: 'dashed' };
  }
}

function projectCompoundLine(value: unknown): ShapeOutline['compound'] {
  switch (value) {
    case 'Single':
    case 'single':
    case 'sng':
      return 'single';
    case 'Double':
    case 'double':
    case 'dbl':
      return 'double';
    case 'ThickThin':
    case 'thickThin':
      return 'thickThin';
    case 'ThinThick':
    case 'thinThick':
      return 'thinThick';
    case 'Triple':
    case 'triple':
    case 'tri':
      return 'triple';
    default:
      return undefined;
  }
}

function projectShapeOutline(outline: unknown): ShapeOutline | undefined {
  const outlineRecord = asRecord(outline);
  if (!outlineRecord) return undefined;

  const lineFill = readAny(outlineRecord, 'fill');
  const projectedFill =
    lineFill !== undefined
      ? projectLineFill(lineFill)
      : { style: 'solid' as const, color: '#000000', visible: true };
  if (!projectedFill) return undefined;

  const widthEmu = readAny(outlineRecord, 'width', 'w');
  const projected: ShapeOutline = {
    style: projectedFill.style,
    color: projectedFill.color,
    width: typeof widthEmu === 'number' ? widthEmu / EMU_PER_PT : DEFAULT_OUTLINE_WIDTH_PT,
  };
  if (projectedFill.visible !== undefined) projected.visible = projectedFill.visible;
  if (projectedFill.transparency !== undefined) projected.transparency = projectedFill.transparency;

  const dash = readAny(outlineRecord, 'dash', 'prstDash');
  if (dash !== undefined && projected.style !== 'none') {
    const projectedDash = projectLineDash(dash);
    projected.style = projectedDash.style;
    if (projectedDash.dash) projected.dash = projectedDash.dash;
  }

  const compound = projectCompoundLine(readAny(outlineRecord, 'compound', 'cmpd'));
  if (compound) projected.compound = compound;

  return projected;
}

function shapeSpPrFromOoxml(ooxml: unknown): UnknownRecord | undefined {
  const shape = readRecord(ooxml, 'shape');
  return readRecord(shape, 'spPr', 'sp_pr');
}

function fallbackShapeFill(d: { fill?: ObjectFill; ooxml?: unknown }): ObjectFill | undefined {
  return d.fill ?? projectDrawingFill(readAny(shapeSpPrFromOoxml(d.ooxml), 'fill'));
}

function fallbackShapeOutline(d: {
  outline?: ShapeOutline;
  ooxml?: unknown;
}): ShapeOutline | undefined {
  return d.outline ?? projectShapeOutline(readAny(shapeSpPrFromOoxml(d.ooxml), 'ln', 'outline'));
}

function fallbackTextboxBorder(d: {
  border?: ShapeOutline;
  ooxml?: unknown;
}): ShapeOutline | undefined {
  return d.border ?? projectShapeOutline(readAny(shapeSpPrFromOoxml(d.ooxml), 'ln', 'outline'));
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
    fill: fallbackShapeFill(d),
    outline: fallbackShapeOutline(d),
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
    fill: fallbackShapeFill(d),
    border: fallbackTextboxBorder(d) as TextBoxObject['border'],
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
  const chart = normalizeImportedComboChart(d);
  // Sanitize title: treat the literal string "undefined" as missing (null).
  // This can happen when JS `undefined` leaks through a JSON/NAPI bridge as a string.
  const sanitizedTitle =
    chart.title != null && chart.title !== 'undefined' ? chart.title : undefined;
  const sanitizedSubtitle =
    chart.subtitle != null && chart.subtitle !== 'undefined' ? chart.subtitle : undefined;

  const chartConfig: Record<string, unknown> = {
    subType: chart.subType,
    seriesOrientation: chart.seriesOrientation,
    dataRange: chart.dataRange,
    dataRangeIdentity: chart.dataRangeIdentity,
    seriesRange: chart.seriesRange,
    seriesRangeIdentity: chart.seriesRangeIdentity,
    categoryRange: chart.categoryRange,
    categoryRangeIdentity: chart.categoryRangeIdentity,
    title: sanitizedTitle,
    subtitle: sanitizedSubtitle,
    legend: chart.legend,
    axis: chart.axis,
    colors: chart.colors,
    series: chart.series,
    dataLabels: chart.dataLabels,
    pieSlice: chart.pieSlice,
    trendline: chart.trendline,
    showLines: chart.showLines,
    smoothLines: chart.smoothLines,
    radarFilled: chart.radarFilled,
    radarMarkers: chart.radarMarkers,
    waterfall: chart.waterfall,
    sourceTableId: chart.sourceTableId,
    tableDataColumns: chart.tableDataColumns,
    tableCategoryColumn: chart.tableCategoryColumn,
    useTableColumnNamesAsLabels: chart.useTableColumnNamesAsLabels,
    tableColumnNames: chart.tableColumnNames,
    ooxml: chart.ooxml,
  };
  return {
    ...buildBaseFields(d),
    type: 'chart' as const,
    chartType: (chart.chartType && chart.chartType !== 'undefined'
      ? chart.chartType
      : 'column') as ChartObjectType,
    anchorMode: (chart.anchor.anchorMode === 'twoCell'
      ? 'twoCell'
      : 'oneCell') as ChartObject['anchorMode'],
    widthCells: chart.widthCells ?? chart.width ?? 8,
    heightCells: chart.heightCells ?? chart.height ?? 15,
    chartConfig,
    dataRangeIdentity: chart.dataRangeIdentity,
    seriesRangeIdentity: chart.seriesRangeIdentity,
    categoryRangeIdentity: chart.categoryRangeIdentity,
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
