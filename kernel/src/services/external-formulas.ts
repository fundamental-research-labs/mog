import type { DocumentContext } from '../context/types';
import type { BatchRangeResponse, RangeQueryResult } from '../bridges/compute/compute-types.gen';
import type { MutationAdmissionOptions } from '../bridges/compute';
import type { PositionedCellInput } from '../bridges/compute/table-header-write-intercept';
import type { TypedActiveCellData } from '../bridges/compute/compute-bridge';
import { getExternalWorkbookSession } from './workbook-links/session-registry';
import type { PersistedWorkbookLinkRecord } from './workbook-links/types';
import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import { quoteSheetName } from '@mog/spreadsheet-utils/a1';
import { asFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import { KernelError } from '../errors';

export interface ExternalFormulaCell {
  readonly sheetId: SheetId;
  readonly row: number;
  readonly col: number;
  readonly formula: string;
}

export interface ParsedExternalRef {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly workbookToken: string;
  readonly sheetName: string;
  readonly address: string;
  readonly addressText: string;
}

export interface ExternalFormulaFeedback {
  readonly code: 'EXTERNAL_REFERENCE_UNBOUND_LOCAL_SHEET_CANDIDATE' | 'EXTERNAL_REFERENCE_UNBOUND';
  readonly message: string;
  readonly suggestion: string;
  readonly details: Record<string, unknown>;
  readonly suggestedFormula?: string;
}

const formulasByContext = new WeakMap<object, Map<string, ExternalFormulaCell>>();

function formulaTrackerKey(ctx: DocumentContext): object {
  return ctx.computeBridge as unknown as object;
}

export function trackExternalFormulaWrite(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: unknown,
): void {
  const key = cellKey(sheetId, row, col);
  const trackerKey = formulaTrackerKey(ctx);
  const formulas = formulasByContext.get(trackerKey) ?? new Map<string, ExternalFormulaCell>();
  if (!formulasByContext.has(trackerKey)) formulasByContext.set(trackerKey, formulas);

  if (typeof value === 'string' && value.startsWith('=') && parseExternalRefs(value).length > 0) {
    formulas.set(key, { sheetId, row, col, formula: value });
  } else {
    formulas.delete(key);
  }
}

export function getTrackedExternalFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): string | undefined {
  return formulasByContext.get(formulaTrackerKey(ctx))?.get(cellKey(sheetId, row, col))?.formula;
}

export function getTrackedExternalFormulas(ctx: DocumentContext): readonly ExternalFormulaCell[] {
  return [...(formulasByContext.get(formulaTrackerKey(ctx))?.values() ?? [])];
}

export async function prepareExternalFormulaWrite(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: unknown,
): Promise<unknown> {
  if (typeof value !== 'string' || !value.startsWith('=')) {
    trackExternalFormulaWrite(ctx, sheetId, row, col, value);
    return value;
  }

  const refs = parseExternalRefs(value);
  if (refs.length === 0) {
    trackExternalFormulaWrite(ctx, sheetId, row, col, value);
    return value;
  }

  await assertExternalFormulaWriteAllowed(ctx, value, refs);
  trackExternalFormulaWrite(ctx, sheetId, row, col, value);
  return materializeFormula(ctx, value);
}

export function applyExternalFormulaReadbacks(
  ctx: DocumentContext,
  sheetId: SheetId,
  result: RangeQueryResult,
): RangeQueryResult {
  let changed = false;
  const cells = result.cells.map((cell) => {
    const formula = getTrackedExternalFormula(ctx, sheetId, cell.row, cell.col);
    if (!formula || cell.formula === formula) return cell;
    changed = true;
    return { ...cell, formula };
  });

  return changed ? { ...result, cells } : result;
}

export function applyExternalFormulaCellReadback<T extends { readonly formula?: string }>(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  cell: T,
): T {
  const formula = getTrackedExternalFormula(ctx, sheetId, row, col);
  if (!formula || cell.formula === formula) return cell;
  return { ...cell, formula } as T;
}

export function applyExternalFormulaBatchReadbacks(
  ctx: DocumentContext,
  response: BatchRangeResponse,
): BatchRangeResponse {
  let changed = false;
  const entries = response.entries.map((entry) => {
    if (entry.status !== 'ok') return entry;

    const result = applyExternalFormulaReadbacks(ctx, toSheetId(entry.sheetId), entry.result);
    if (result === entry.result) return entry;

    changed = true;
    return { ...entry, result };
  });

  return changed ? { ...response, entries } : response;
}

export function installExternalFormulaReadbacks(ctx: DocumentContext): void {
  const bridge = ctx.computeBridge;
  let activeCellFormula: string | undefined;

  if (typeof bridge.queryRange === 'function') {
    const queryRange = bridge.queryRange.bind(bridge);
    bridge.queryRange = async (sheetId, startRow, startCol, endRow, endCol) =>
      applyExternalFormulaReadbacks(
        ctx,
        sheetId,
        await queryRange(sheetId, startRow, startCol, endRow, endCol),
      );
  }

  if (typeof bridge.queryRanges === 'function') {
    const queryRanges = bridge.queryRanges.bind(bridge);
    bridge.queryRanges = async (requests) =>
      applyExternalFormulaBatchReadbacks(ctx, await queryRanges(requests));
  }

  if (typeof bridge.getRawCellData === 'function') {
    const getRawCellData = bridge.getRawCellData.bind(bridge);
    bridge.getRawCellData = async (sheetId, row, col, includeFormula) => {
      const cell = await getRawCellData(sheetId, row, col, includeFormula);
      if (!cell || includeFormula === false) return cell;
      return applyExternalFormulaCellReadback(ctx, sheetId, row, col, cell);
    };
  }

  if (
    typeof bridge.refreshActiveCell === 'function' &&
    typeof bridge.getCellPosition === 'function'
  ) {
    const refreshActiveCell = bridge.refreshActiveCell.bind(bridge);
    bridge.refreshActiveCell = async (sheetId, cellId) => {
      await refreshActiveCell(sheetId, cellId);
      const position = await bridge.getCellPosition(sheetId, cellId);
      activeCellFormula = position
        ? getTrackedExternalFormula(ctx, sheetId, position.row, position.col)
        : undefined;
    };
  }

  if (typeof bridge.getActiveCellData === 'function') {
    const getActiveCellData = bridge.getActiveCellData.bind(bridge);
    bridge.getActiveCellData = () => {
      const cell = getActiveCellData();
      if (!cell || !activeCellFormula || cell.formula === activeCellFormula) return cell;
      return { ...cell, formula: asFormulaA1(activeCellFormula) } as TypedActiveCellData;
    };
  }
}

export function maskExternalFormulaRefsForValidation(formula: string): string {
  const refs = parseExternalRefs(formula);
  if (refs.length === 0) return formula;

  let out = formula;
  for (const ref of refs.sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, ref.start)}0${out.slice(ref.end)}`;
  }
  return out;
}

export async function materializeExternalFormulas(
  ctx: DocumentContext,
  options?: MutationAdmissionOptions,
): Promise<number> {
  const formulas = formulasByContext.get(formulaTrackerKey(ctx));
  if (!formulas || formulas.size === 0) return 0;

  let materialized = 0;
  const editsBySheet = new Map<SheetId, PositionedCellInput[]>();
  for (const cell of formulas.values()) {
    const formula = await materializeFormula(ctx, cell.formula);
    const edits = editsBySheet.get(cell.sheetId) ?? [];
    edits.push({ row: cell.row, col: cell.col, input: { kind: 'parse', text: formula } });
    editsBySheet.set(cell.sheetId, edits);
    materialized += 1;
  }
  for (const [sheetId, edits] of editsBySheet) {
    if (options) {
      await ctx.computeBridge.setCellsByPosition(sheetId, edits, options);
    } else {
      await ctx.computeBridge.setCellsByPosition(sheetId, edits);
    }
  }
  return materialized;
}

export function getExternalFormulaReferences(formula: string): ParsedExternalRef[] {
  return parseExternalRefs(formula);
}

export function localReferenceForExternalRef(
  ref: Pick<ParsedExternalRef, 'sheetName' | 'addressText'>,
  sheetName = ref.sheetName,
): string {
  return `${quoteSheetName(sheetName)}!${ref.addressText}`;
}

export function formulaWithLocalExternalRef(
  formula: string,
  ref: Pick<ParsedExternalRef, 'start' | 'end' | 'sheetName' | 'addressText'>,
  sheetName = ref.sheetName,
): string {
  return replaceFormulaReference(formula, ref, localReferenceForExternalRef(ref, sheetName));
}

export function buildUnboundExternalFormulaFeedback(
  formula: string,
  ref: ParsedExternalRef,
  localSheetName?: string,
): ExternalFormulaFeedback {
  const isOrdinal = isExcelExternalOrdinalToken(ref.workbookToken);
  const localReference = localSheetName
    ? localReferenceForExternalRef(ref, localSheetName)
    : undefined;
  const suggestedFormula = localReference
    ? replaceFormulaReference(formula, ref, localReference)
    : undefined;
  const code = localSheetName
    ? 'EXTERNAL_REFERENCE_UNBOUND_LOCAL_SHEET_CANDIDATE'
    : 'EXTERNAL_REFERENCE_UNBOUND';
  const identityMessage = isOrdinal
    ? `Mog interprets ${ref.text} as an Excel internal external-link ordinal because of [${ref.workbookToken}], but this workbook has no external-link metadata for ordinal ${ref.workbookToken}.`
    : `Mog interprets ${ref.text} as an external workbook reference, but no workbook link is registered for "${ref.workbookToken}".`;
  const externalGuidance = isOrdinal
    ? `create or bind an external workbook link with a readable name and write the formula with that name instead of [${ref.workbookToken}]`
    : `register an external workbook link for "${ref.workbookToken}" before writing this formula`;
  const localGuidance = localSheetName
    ? ` Local sheet "${localSheetName}" exists. Use ${suggestedFormula} if you meant this workbook. If you meant another workbook, ${externalGuidance}.`
    : ` ${capitalizeSentence(externalGuidance)}.`;
  const suggestion = localSheetName
    ? `Use ${suggestedFormula} for a local reference, or ${externalGuidance}.`
    : `${capitalizeSentence(externalGuidance)}.`;

  return {
    code,
    message: `${identityMessage}${localGuidance}`,
    suggestion,
    suggestedFormula,
    details: {
      diagnosticCode: code,
      text: ref.text,
      workbookToken: ref.workbookToken,
      tokenKind: isOrdinal ? 'excel-internal-ordinal' : 'workbook-display-token',
      externalSheetName: ref.sheetName,
      externalAddress: ref.addressText,
      interpretation: 'external-workbook-reference',
      localSheetName,
      localReference,
      suggestedFormula,
    },
  };
}

async function assertExternalFormulaWriteAllowed(
  ctx: DocumentContext,
  formula: string,
  refs: readonly ParsedExternalRef[],
): Promise<void> {
  const linkRecords = ctx.workbookLinks.listRecords();
  let localSheetNames: Map<string, string> | undefined;

  for (const ref of refs) {
    if (findExternalFormulaLink(linkRecords, ref.workbookToken)) continue;

    localSheetNames ??= await getLocalSheetNames(ctx);
    const localSheetName = localSheetNames.get(ref.sheetName.toLowerCase());
    const feedback = buildUnboundExternalFormulaFeedback(formula, ref, localSheetName);
    throw new KernelError('API_INVALID_ARGUMENT', feedback.message, {
      suggestion: feedback.suggestion,
      context: feedback.details,
      path: ['formula'],
    });
  }
}

async function materializeFormula(ctx: DocumentContext, formula: string): Promise<string> {
  const refs = parseExternalRefs(formula);
  if (refs.length === 0) return formula;

  let out = formula;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const ref of refs) {
    replacements.push({
      start: ref.start,
      end: ref.end,
      text: await readExternalReference(ctx, ref),
    });
  }

  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, replacement.start)}${replacement.text}${out.slice(replacement.end)}`;
  }
  return out;
}

async function readExternalReference(
  ctx: DocumentContext,
  ref: ParsedExternalRef,
): Promise<string> {
  const link = findExternalFormulaLink(ctx.workbookLinks.listRecords(), ref.workbookToken);
  if (!link) return 'NA()';

  const scope = ctx.workbookLinkScope();
  await ctx.workbookLinks.refresh(link.linkId, scope);
  const status = ctx.workbookLinks.getRuntimeStatus(link.linkId, scope);
  if (!status || status.status !== 'ready') return 'NA()';

  const sessionId =
    status.sourceSessionId ??
    (link.target.kind === 'open-session' ? link.target.sessionId : undefined);
  if (!sessionId) return 'NA()';

  const session = getExternalWorkbookSession(sessionId);
  if (!session) return 'NA()';

  const sheet = await session.workbook.getSheet(ref.sheetName);
  if (!ref.address.includes(':')) {
    return formulaLiteral(await sheet.getValue(ref.address));
  }

  const range = expandRange(ref.address);
  const rows: string[] = [];
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    const cols: string[] = [];
    for (let col = range.startCol; col <= range.endCol; col += 1) {
      cols.push(formulaLiteral(await sheet.getValue(`${colToLetters(col)}${row}`)));
    }
    rows.push(cols.join(','));
  }
  return `{${rows.join(';')}}`;
}

export function findExternalFormulaLink(
  records: readonly PersistedWorkbookLinkRecord[],
  token: string,
): PersistedWorkbookLinkRecord | null {
  const normalized = token.toLowerCase();
  return (
    records.find(
      (record) =>
        record.displayName.toLowerCase() === normalized ||
        record.linkId.toLowerCase() === normalized,
    ) ??
    records.find((record) => String(record.importedExcelIdentity?.excelOrdinal) === token) ??
    null
  );
}

async function getLocalSheetNames(ctx: DocumentContext): Promise<Map<string, string>> {
  const ids = await ctx.computeBridge.getAllSheetIds();
  const entries = await Promise.all(
    ids.map(async (id) => {
      const name = (await ctx.computeBridge.getSheetName(id)) ?? id;
      return [name.toLowerCase(), name] as const;
    }),
  );
  return new Map(entries);
}

function isExcelExternalOrdinalToken(token: string): boolean {
  return /^[1-9]\d*$/.test(token);
}

function capitalizeSentence(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function replaceFormulaReference(
  formula: string,
  ref: Pick<ParsedExternalRef, 'start' | 'end'>,
  replacement: string,
): string {
  return `${formula.slice(0, ref.start)}${replacement}${formula.slice(ref.end)}`;
}

function parseExternalRefs(formula: string): ParsedExternalRef[] {
  const refs: ParsedExternalRef[] = [];
  const pattern =
    /(?:'\[([^\]]+)\]([^']+)'|\[([^\]]+)\]([^!']+))!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)/g;
  for (const match of formula.matchAll(pattern)) {
    const addressText = match[5];
    refs.push({
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      workbookToken: match[1] ?? match[3],
      sheetName: (match[2] ?? match[4]).replace(/''/g, "'"),
      address: addressText.replace(/\$/g, ''),
      addressText,
    });
  }
  return refs;
}

function formulaLiteral(value: unknown): string {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NA()';
  if (typeof value === 'boolean') return value ? 'TRUE()' : 'FALSE()';
  if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
  return 'NA()';
}

function expandRange(address: string): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} {
  const [start, end] = address.split(':');
  const a = parseCellAddress(start);
  const b = parseCellAddress(end ?? start);
  return {
    startRow: Math.min(a.row, b.row),
    startCol: Math.min(a.col, b.col),
    endRow: Math.max(a.row, b.row),
    endCol: Math.max(a.col, b.col),
  };
}

function parseCellAddress(address: string): { row: number; col: number } {
  const match = /^([A-Za-z]+)(\d+)$/.exec(address);
  if (!match) throw new Error(`Invalid external cell address "${address}"`);
  return { col: lettersToCol(match[1]), row: Number(match[2]) };
}

function lettersToCol(letters: string): number {
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return col;
}

function colToLetters(col: number): string {
  let n = col;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellKey(sheetId: SheetId, row: number, col: number): string {
  return `${sheetId}\u001f${row}\u001f${col}`;
}
