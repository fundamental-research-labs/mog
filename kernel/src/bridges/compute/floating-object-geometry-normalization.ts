/**
 * Normalizes user-facing floating-object geometry before it crosses into
 * persisted compute storage.
 *
 * The interaction-layer ObjectPosition contract uses CSS pixels. The persisted
 * compute/OOXML anchor contract uses EMUs for all anchor offsets and extents.
 */

const EMU_PER_PX = 9525;

type JsonObject = Record<string, unknown>;

interface PersistedAnchor {
  anchorRow: number;
  anchorCol: number;
  anchorRowOffsetEmu: number;
  anchorColOffsetEmu: number;
  anchorMode: 'oneCell' | 'twoCell' | 'absolute';
  endRow?: number;
  endCol?: number;
  endRowOffsetEmu?: number;
  endColOffsetEmu?: number;
  extentCxEmu?: number;
  extentCyEmu?: number;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

function readNumber(obj: JsonObject | undefined, key: string): number | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return isFiniteNumber(value) ? value : undefined;
}

function readAnchorMode(value: unknown): PersistedAnchor['anchorMode'] {
  return value === 'twoCell' || value === 'absolute' ? value : 'oneCell';
}

function parsePositionalCellId(cellId: unknown): { row: number; col: number } | undefined {
  if (typeof cellId !== 'string') return undefined;
  const match = /^cell-(\d+)-(\d+)$/.exec(cellId);
  if (!match) return undefined;
  return { row: Number(match[1]), col: Number(match[2]) };
}

function isInteractionPosition(value: unknown): value is JsonObject {
  if (!isObject(value)) return false;
  return isObject(value.from) || 'anchorType' in value || 'x' in value || 'y' in value;
}

function anchorFromInteractionPosition(
  position: JsonObject,
  fallback?: JsonObject,
): PersistedAnchor {
  const from = isObject(position.from) ? position.from : undefined;
  const to = isObject(position.to) ? position.to : undefined;
  const parsedFrom = parsePositionalCellId(from?.cellId);
  const parsedTo = parsePositionalCellId(to?.cellId);

  const widthPx = readNumber(position, 'width') ?? readNumber(fallback, 'width');
  const heightPx = readNumber(position, 'height') ?? readNumber(fallback, 'height');

  const anchor: PersistedAnchor = {
    anchorRow: parsedFrom?.row ?? readNumber(fallback, 'anchorRow') ?? 0,
    anchorCol: parsedFrom?.col ?? readNumber(fallback, 'anchorCol') ?? 0,
    anchorRowOffsetEmu: pxToEmu(readNumber(from, 'yOffset') ?? readNumber(position, 'y') ?? 0),
    anchorColOffsetEmu: pxToEmu(readNumber(from, 'xOffset') ?? readNumber(position, 'x') ?? 0),
    anchorMode: readAnchorMode(position.anchorType),
  };

  if (to || anchor.anchorMode === 'twoCell') {
    anchor.endRow = parsedTo?.row ?? readNumber(fallback, 'endRow');
    anchor.endCol = parsedTo?.col ?? readNumber(fallback, 'endCol');
    anchor.endRowOffsetEmu = pxToEmu(readNumber(to, 'yOffset') ?? 0);
    anchor.endColOffsetEmu = pxToEmu(readNumber(to, 'xOffset') ?? 0);
  }
  if (widthPx !== undefined) anchor.extentCxEmu = pxToEmu(widthPx);
  if (heightPx !== undefined) anchor.extentCyEmu = pxToEmu(heightPx);
  return anchor;
}

function anchorFromPersistedOrFlat(
  anchor: JsonObject | undefined,
  source: JsonObject,
): PersistedAnchor | undefined {
  const anchorRow = readNumber(anchor, 'anchorRow') ?? readNumber(source, 'anchorRow');
  const anchorCol = readNumber(anchor, 'anchorCol') ?? readNumber(source, 'anchorCol');
  const hasAnchor =
    anchorRow !== undefined ||
    anchorCol !== undefined ||
    anchor !== undefined ||
    'xOffset' in source ||
    'yOffset' in source;
  if (!hasAnchor) return undefined;

  const persisted: PersistedAnchor = {
    anchorRow: anchorRow ?? 0,
    anchorCol: anchorCol ?? 0,
    anchorRowOffsetEmu:
      readNumber(anchor, 'anchorRowOffsetEmu') ??
      readNumber(source, 'anchorRowOffsetEmu') ??
      readNumber(anchor, 'anchorRowOffset') ??
      readNumber(source, 'anchorRowOffset') ??
      pxToEmu(readNumber(source, 'yOffset') ?? 0),
    anchorColOffsetEmu:
      readNumber(anchor, 'anchorColOffsetEmu') ??
      readNumber(source, 'anchorColOffsetEmu') ??
      readNumber(anchor, 'anchorColOffset') ??
      readNumber(source, 'anchorColOffset') ??
      pxToEmu(readNumber(source, 'xOffset') ?? 0),
    anchorMode: readAnchorMode(anchor?.anchorMode ?? source.anchorMode),
  };

  const endRow = readNumber(anchor, 'endRow') ?? readNumber(source, 'endRow');
  const endCol = readNumber(anchor, 'endCol') ?? readNumber(source, 'endCol');
  if (endRow !== undefined) persisted.endRow = endRow;
  if (endCol !== undefined) persisted.endCol = endCol;
  const endRowOffset =
    readNumber(anchor, 'endRowOffsetEmu') ??
    readNumber(source, 'endRowOffsetEmu') ??
    readNumber(anchor, 'endRowOffset') ??
    readNumber(source, 'endRowOffset') ??
    (readNumber(source, 'toYOffset') !== undefined
      ? pxToEmu(readNumber(source, 'toYOffset') ?? 0)
      : undefined);
  const endColOffset =
    readNumber(anchor, 'endColOffsetEmu') ??
    readNumber(source, 'endColOffsetEmu') ??
    readNumber(anchor, 'endColOffset') ??
    readNumber(source, 'endColOffset') ??
    (readNumber(source, 'toXOffset') !== undefined
      ? pxToEmu(readNumber(source, 'toXOffset') ?? 0)
      : undefined);
  if (endRowOffset !== undefined) persisted.endRowOffsetEmu = endRowOffset;
  if (endColOffset !== undefined) persisted.endColOffsetEmu = endColOffset;

  const widthPx = readNumber(source, 'width');
  const heightPx = readNumber(source, 'height');
  const extentCx =
    readNumber(anchor, 'extentCxEmu') ??
    readNumber(source, 'extentCxEmu') ??
    readNumber(anchor, 'extentCx') ??
    readNumber(source, 'extentCx') ??
    (widthPx !== undefined ? pxToEmu(widthPx) : undefined);
  const extentCy =
    readNumber(anchor, 'extentCyEmu') ??
    readNumber(source, 'extentCyEmu') ??
    readNumber(anchor, 'extentCy') ??
    readNumber(source, 'extentCy') ??
    (heightPx !== undefined ? pxToEmu(heightPx) : undefined);
  if (extentCx !== undefined) persisted.extentCxEmu = extentCx;
  if (extentCy !== undefined) persisted.extentCyEmu = extentCy;
  return persisted;
}

function normalizePayload(payload: JsonObject, partial: boolean): JsonObject {
  const result: JsonObject = { ...payload };
  const sourceAnchor = isObject(payload.anchor) ? payload.anchor : undefined;
  const interactionPosition = isInteractionPosition(payload.position)
    ? payload.position
    : isInteractionPosition(sourceAnchor)
      ? sourceAnchor
      : undefined;
  const persistedAnchor = interactionPosition
    ? anchorFromInteractionPosition(interactionPosition, payload)
    : anchorFromPersistedOrFlat(sourceAnchor, payload);

  if (persistedAnchor) {
    result.anchor = persistedAnchor;
    delete result.anchorRow;
    delete result.anchorCol;
    delete result.anchorRowOffset;
    delete result.anchorColOffset;
    delete result.anchorRowOffsetEmu;
    delete result.anchorColOffsetEmu;
    delete result.endRow;
    delete result.endCol;
    delete result.endRowOffset;
    delete result.endColOffset;
    delete result.endRowOffsetEmu;
    delete result.endColOffsetEmu;
    delete result.extentCx;
    delete result.extentCy;
    delete result.extentCxEmu;
    delete result.extentCyEmu;
    delete result.anchorMode;
    delete result.xOffset;
    delete result.yOffset;
    delete result.toXOffset;
    delete result.toYOffset;
  }

  if (interactionPosition) {
    delete result.position;
    const from = isObject(interactionPosition.from) ? interactionPosition.from : undefined;
    const to = isObject(interactionPosition.to) ? interactionPosition.to : undefined;
    if (typeof from?.cellId === 'string') result.anchorCellId = from.cellId;
    if (typeof to?.cellId === 'string') result.toAnchorCellId = to.cellId;
    if (isFiniteNumber(interactionPosition.rotation))
      result.rotation = interactionPosition.rotation;
    if (typeof interactionPosition.flipH === 'boolean') result.flipH = interactionPosition.flipH;
    if (typeof interactionPosition.flipV === 'boolean') result.flipV = interactionPosition.flipV;
  }

  if (!partial) {
    result.locked ??= false;
    result.visible ??= true;
    result.printable ??= true;
    result.opacity ??= 1;
    result.rotation ??= 0;
    result.flipH ??= false;
    result.flipV ??= false;
    result.zIndex ??= 0;
    result.name ??= '';
  }

  return result;
}

export function normalizeFloatingObjectForStorage(payload: unknown): unknown {
  return isObject(payload) ? normalizePayload(payload, false) : payload;
}

export function normalizeFloatingObjectUpdateForStorage(payload: unknown): unknown {
  return isObject(payload) ? normalizePayload(payload, true) : payload;
}

export const floatingObjectGeometryTestHooks = {
  EMU_PER_PX,
  normalizeFloatingObjectForStorage,
  normalizeFloatingObjectUpdateForStorage,
};
