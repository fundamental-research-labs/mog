import type { DocumentHandle } from '@mog-sdk/kernel';

export interface ImportedPivotRange {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
  readonly ref: string;
}

export interface ImportedPivotFieldMetadata {
  readonly id: string;
  readonly name: string;
}

/** Area a field occupies in an imported pivot's layout. */
export type ImportedPivotArea = 'row' | 'column' | 'value' | 'filter';

/**
 * A single field placement read from the imported pivot definition
 * (`<rowFields>`, `<colFields>`, `<pageFields>`, `<dataFields>`). Lets the
 * runtime reconstruct the pivot's layout wells for the field panel rather
 * than presenting every field as unplaced.
 */
export interface ImportedPivotPlacementMetadata {
  readonly fieldId: string;
  readonly area: ImportedPivotArea;
  readonly position: number;
  /** Aggregate (value area only), mapped from the OOXML `subtotal` attribute. */
  readonly aggregateFunction?: string;
  /** Custom caption (value area only), from the `dataField` `name` attribute. */
  readonly displayName?: string;
}

export interface ImportedPivotTableMetadata {
  readonly id: string;
  readonly name: string;
  readonly sheetName: string;
  readonly definitionPath: string;
  readonly range: ImportedPivotRange;
  readonly sourceRange?: string;
  readonly cacheId?: number;
  readonly fields: readonly ImportedPivotFieldMetadata[];
  readonly placements: readonly ImportedPivotPlacementMetadata[];
  readonly readOnly: true;
}

export interface ImportedPivotMetadataSet {
  readonly pivots: readonly ImportedPivotTableMetadata[];
  readonly diagnostics: readonly string[];
}

const importedPivotMetadataByHandle = new WeakMap<DocumentHandle, ImportedPivotMetadataSet>();

export function attachImportedPivotMetadata(
  handle: DocumentHandle,
  metadata: ImportedPivotMetadataSet,
): void {
  importedPivotMetadataByHandle.set(handle, metadata);
}

export function getImportedPivotMetadata(handle: DocumentHandle): ImportedPivotMetadataSet | null {
  return importedPivotMetadataByHandle.get(handle) ?? null;
}

interface ZipEntry {
  readonly name: string;
  readonly compression: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

const textDecoder = new TextDecoder();

function u16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function u32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const min = Math.max(0, data.length - 0xffff - 22);
  for (let i = data.length - 22; i >= min; i--) {
    if (u32(data, i) === 0x06054b50) return i;
  }
  throw new Error('ZIP end of central directory not found');
}

function readZipEntries(data: Uint8Array): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(data);
  const entryCount = u16(data, eocd + 10);
  let offset = u32(data, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < entryCount; i++) {
    if (u32(data, offset) !== 0x02014b50) break;
    const compression = u16(data, offset + 10);
    const compressedSize = u32(data, offset + 20);
    const uncompressedSize = u32(data, offset + 24);
    const nameLength = u16(data, offset + 28);
    const extraLength = u16(data, offset + 30);
    const commentLength = u16(data, offset + 32);
    const localHeaderOffset = u32(data, offset + 42);
    const name = textDecoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, compression, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('ZIP deflate decompression is not available in this runtime');
  }
  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipText(
  data: Uint8Array,
  entries: ReadonlyMap<string, ZipEntry>,
  path: string,
): Promise<string | null> {
  const entry = entries.get(path);
  if (!entry) return null;
  const local = entry.localHeaderOffset;
  if (u32(data, local) !== 0x04034b50) return null;
  const nameLength = u16(data, local + 26);
  const extraLength = u16(data, local + 28);
  const start = local + 30 + nameLength + extraLength;
  const compressed = data.subarray(start, start + entry.compressedSize);
  let bytes: Uint8Array;
  if (entry.compression === 0) {
    bytes = compressed;
  } else if (entry.compression === 8) {
    bytes = await inflateRaw(compressed);
  } else {
    throw new Error(`Unsupported ZIP compression method ${entry.compression} for ${path}`);
  }
  if (entry.uncompressedSize !== 0 && bytes.length !== entry.uncompressedSize) {
    return textDecoder.decode(bytes);
  }
  return textDecoder.decode(bytes);
}

function parseXml(xml: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.getElementsByTagName('parsererror').length === 0 ? doc : null;
}

function attr(element: Element, name: string): string | null {
  return element.getAttribute(name) ?? element.getAttribute(`r:${name}`);
}

function localElements(root: ParentNode, localName: string): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((el) => el.localName === localName);
}

function parseRelationships(xml: string | null): Relationship[] {
  if (!xml) return [];
  const doc = parseXml(xml);
  if (!doc) return [];
  return localElements(doc, 'Relationship')
    .map((el) => ({
      id: el.getAttribute('Id') ?? '',
      type: el.getAttribute('Type') ?? '',
      target: el.getAttribute('Target') ?? '',
    }))
    .filter((rel) => rel.id && rel.target);
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function resolveTarget(ownerPartPath: string, target: string): string {
  if (/^[a-z]+:/i.test(target)) return target;
  if (target.startsWith('/')) return normalizeZipPath(target);
  return normalizeZipPath(`${dirname(ownerPartPath)}/${target}`);
}

function relationshipsPath(ownerPartPath: string): string {
  return normalizeZipPath(`${dirname(ownerPartPath)}/_rels/${basename(ownerPartPath)}.rels`);
}

function parseSheets(workbookXml: string | null): Array<{ name: string; relId: string }> {
  if (!workbookXml) return [];
  const doc = parseXml(workbookXml);
  if (!doc) return [];
  return localElements(doc, 'sheet')
    .map((el) => ({ name: el.getAttribute('name') ?? '', relId: attr(el, 'id') ?? '' }))
    .filter((sheet) => sheet.name && sheet.relId);
}

function parseWorkbookPivotCacheTargets(
  workbookXml: string | null,
  workbookRels: readonly Relationship[],
): Map<number, string> {
  const targets = new Map<number, string>();
  if (!workbookXml) return targets;
  const doc = parseXml(workbookXml);
  if (!doc) return targets;
  const relById = new Map(workbookRels.map((rel) => [rel.id, rel]));
  for (const el of localElements(doc, 'pivotCache')) {
    const cacheId = Number(el.getAttribute('cacheId'));
    const relId = attr(el, 'id');
    const rel = relId ? relById.get(relId) : null;
    if (Number.isFinite(cacheId) && rel) {
      targets.set(cacheId, resolveTarget('xl/workbook.xml', rel.target));
    }
  }
  return targets;
}

function parseA1Range(ref: string): ImportedPivotRange | null {
  const [startRef, endRef = startRef] = ref.replace(/\$/g, '').split(':');
  const start = /^([A-Z]+)([0-9]+)$/i.exec(startRef);
  const end = /^([A-Z]+)([0-9]+)$/i.exec(endRef);
  if (!start || !end) return null;

  const colToIndex = (letters: string): number =>
    letters
      .toUpperCase()
      .split('')
      .reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;

  return {
    startRow: Number(start[2]) - 1,
    startCol: colToIndex(start[1]),
    endRow: Number(end[2]) - 1,
    endCol: colToIndex(end[1]),
    ref,
  };
}

function parseCacheFields(cacheXml: string | null): ImportedPivotFieldMetadata[] {
  if (!cacheXml) return [];
  const doc = parseXml(cacheXml);
  if (!doc) return [];
  return localElements(doc, 'cacheField')
    .map((el, index) => ({ id: `field-${index}`, name: el.getAttribute('name') ?? '' }))
    .filter((field) => field.name);
}

function parseSourceRange(cacheXml: string | null): string | undefined {
  if (!cacheXml) return undefined;
  const doc = parseXml(cacheXml);
  if (!doc) return undefined;
  const worksheetSource = localElements(doc, 'worksheetSource')[0];
  if (!worksheetSource) return undefined;
  const ref = worksheetSource.getAttribute('ref');
  const sheet = worksheetSource.getAttribute('sheet');
  return ref ? (sheet ? `'${sheet.replace(/'/g, "''")}'!${ref}` : ref) : undefined;
}

/**
 * Map an OOXML `subtotal` attribute (ST_DataConsolidateFunction) to the
 * app's AggregateFunction string. Excel's "Count" (`count`) is COUNTA, while
 * "Count Numbers" (`countNums`) is COUNT — hence the cross-mapping. Unknown
 * or absent values default to "sum" (the OOXML default for a data field).
 */
const SUBTOTAL_TO_AGGREGATE: Readonly<Record<string, string>> = {
  sum: 'sum',
  count: 'counta',
  countNums: 'count',
  average: 'average',
  max: 'max',
  min: 'min',
  product: 'product',
  stdDev: 'stdev',
  stdDevp: 'stdevp',
  var: 'var',
  varp: 'varp',
};

function mapSubtotal(subtotal: string | null): string {
  if (!subtotal) return 'sum';
  return SUBTOTAL_TO_AGGREGATE[subtotal] ?? 'sum';
}

/**
 * Read the field layout from a pivot definition document. Field indices in
 * `<rowFields>`/`<colFields>` (`x`), `<pageFields>` (`fld`), and
 * `<dataFields>` (`fld`) map 1:1 onto the pivot field list, so we key
 * placements by `field-${index}` to match the ids assigned in
 * `parsePivotDefinition`/`parseCacheFields`. The synthetic "∑ Values"
 * marker (`x="-2"`) carries no field and is skipped.
 */
function parsePivotPlacements(doc: Document): ImportedPivotPlacementMetadata[] {
  const placements: ImportedPivotPlacementMetadata[] = [];

  const readAxis = (containerName: string, area: 'row' | 'column') => {
    const container = localElements(doc, containerName)[0];
    if (!container) return;
    let position = 0;
    for (const fieldEl of localElements(container, 'field')) {
      const index = Number(fieldEl.getAttribute('x'));
      if (!Number.isInteger(index) || index < 0) continue;
      placements.push({ fieldId: `field-${index}`, area, position: position++ });
    }
  };

  readAxis('rowFields', 'row');
  readAxis('colFields', 'column');

  const pageContainer = localElements(doc, 'pageFields')[0];
  if (pageContainer) {
    let position = 0;
    for (const pageField of localElements(pageContainer, 'pageField')) {
      const index = Number(pageField.getAttribute('fld'));
      if (!Number.isInteger(index) || index < 0) continue;
      placements.push({ fieldId: `field-${index}`, area: 'filter', position: position++ });
    }
  }

  const dataContainer = localElements(doc, 'dataFields')[0];
  if (dataContainer) {
    let position = 0;
    for (const dataField of localElements(dataContainer, 'dataField')) {
      const index = Number(dataField.getAttribute('fld'));
      if (!Number.isInteger(index) || index < 0) continue;
      const displayName = dataField.getAttribute('name') ?? undefined;
      placements.push({
        fieldId: `field-${index}`,
        area: 'value',
        position: position++,
        aggregateFunction: mapSubtotal(dataField.getAttribute('subtotal')),
        ...(displayName ? { displayName } : {}),
      });
    }
  }

  return placements;
}

function parsePivotDefinition(args: {
  xml: string;
  sheetName: string;
  definitionPath: string;
  cacheFields: readonly ImportedPivotFieldMetadata[];
  sourceRange?: string;
}): ImportedPivotTableMetadata | null {
  const doc = parseXml(args.xml);
  if (!doc) return null;
  const root = doc.documentElement;
  const location = localElements(doc, 'location')[0];
  const ref = location?.getAttribute('ref');
  if (!ref) return null;
  const range = parseA1Range(ref);
  if (!range) return null;

  const cacheIdRaw = root.getAttribute('cacheId');
  const cacheId = cacheIdRaw == null ? undefined : Number(cacheIdRaw);
  const name = root.getAttribute('name') ?? basename(args.definitionPath).replace(/\.xml$/i, '');
  const pivotFields = localElements(doc, 'pivotField')
    .map((el, index) => ({ id: `field-${index}`, name: el.getAttribute('name') ?? '' }))
    .filter((field) => field.name);

  return {
    id: `imported:${args.sheetName}:${args.definitionPath}`,
    name,
    sheetName: args.sheetName,
    definitionPath: args.definitionPath,
    range,
    sourceRange: args.sourceRange,
    cacheId: Number.isFinite(cacheId) ? cacheId : undefined,
    fields: pivotFields.length > 0 ? pivotFields : args.cacheFields,
    placements: parsePivotPlacements(doc),
    readOnly: true,
  };
}

export async function extractImportedPivotMetadata(
  bytes: Uint8Array,
): Promise<ImportedPivotMetadataSet> {
  const diagnostics: string[] = [];
  const entries = new Map(readZipEntries(bytes).map((entry) => [entry.name, entry]));
  const workbookPath = entries.has('xl/workbook.xml') ? 'xl/workbook.xml' : null;
  if (!workbookPath)
    return { pivots: [], diagnostics: ['Workbook part xl/workbook.xml not found'] };

  const workbookXml = await readZipText(bytes, entries, workbookPath);
  const workbookRels = parseRelationships(
    await readZipText(bytes, entries, relationshipsPath(workbookPath)),
  );
  const workbookRelById = new Map(workbookRels.map((rel) => [rel.id, rel]));
  const cacheTargets = parseWorkbookPivotCacheTargets(workbookXml, workbookRels);
  const pivots: ImportedPivotTableMetadata[] = [];

  for (const sheet of parseSheets(workbookXml)) {
    const sheetRel = workbookRelById.get(sheet.relId);
    if (!sheetRel) continue;
    const sheetPath = resolveTarget(workbookPath, sheetRel.target);
    const sheetRels = parseRelationships(
      await readZipText(bytes, entries, relationshipsPath(sheetPath)),
    );

    for (const rel of sheetRels) {
      if (!rel.type.endsWith('/pivotTable')) continue;
      const definitionPath = resolveTarget(sheetPath, rel.target);
      try {
        const pivotXml = await readZipText(bytes, entries, definitionPath);
        if (!pivotXml) continue;
        const cacheIdRaw = parseXml(pivotXml)?.documentElement.getAttribute('cacheId');
        const cacheId = cacheIdRaw == null ? undefined : Number(cacheIdRaw);
        const cachePath =
          cacheId != null && Number.isFinite(cacheId) ? cacheTargets.get(cacheId) : undefined;
        const cacheXml = cachePath ? await readZipText(bytes, entries, cachePath) : null;
        const pivot = parsePivotDefinition({
          xml: pivotXml,
          sheetName: sheet.name,
          definitionPath,
          cacheFields: parseCacheFields(cacheXml),
          sourceRange: parseSourceRange(cacheXml),
        });
        if (pivot) pivots.push(pivot);
      } catch (error) {
        diagnostics.push(
          `${definitionPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return { pivots, diagnostics };
}
