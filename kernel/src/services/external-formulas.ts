import type { DocumentContext } from '../context/types';
import { getExternalWorkbookSession } from './workbook-links/session-registry';
import type { PersistedWorkbookLinkRecord } from './workbook-links/types';
import type { SheetId } from '@mog-sdk/contracts/core';

interface ExternalFormulaCell {
  readonly sheetId: SheetId;
  readonly row: number;
  readonly col: number;
  readonly formula: string;
}

interface ParsedExternalRef {
  readonly start: number;
  readonly end: number;
  readonly workbookToken: string;
  readonly sheetName: string;
  readonly address: string;
}

const formulasByContext = new WeakMap<DocumentContext, Map<string, ExternalFormulaCell>>();

export function trackExternalFormulaWrite(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: unknown,
): void {
  const key = cellKey(sheetId, row, col);
  const formulas = formulasByContext.get(ctx) ?? new Map<string, ExternalFormulaCell>();
  if (!formulasByContext.has(ctx)) formulasByContext.set(ctx, formulas);

  if (typeof value === 'string' && value.startsWith('=') && parseExternalRefs(value).length > 0) {
    formulas.set(key, { sheetId, row, col, formula: value });
  } else {
    formulas.delete(key);
  }
}

export async function prepareExternalFormulaWrite(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: unknown,
): Promise<unknown> {
  trackExternalFormulaWrite(ctx, sheetId, row, col, value);
  if (
    typeof value !== 'string' ||
    !value.startsWith('=') ||
    parseExternalRefs(value).length === 0
  ) {
    return value;
  }
  return materializeFormula(ctx, value);
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

export async function materializeExternalFormulas(ctx: DocumentContext): Promise<number> {
  const formulas = formulasByContext.get(ctx);
  if (!formulas || formulas.size === 0) return 0;

  let materialized = 0;
  for (const cell of formulas.values()) {
    const formula = await materializeFormula(ctx, cell.formula);
    await ctx.computeBridge.setCellsByPosition(cell.sheetId, [
      { row: cell.row, col: cell.col, input: { kind: 'parse', text: formula } as never },
    ]);
    materialized += 1;
  }
  return materialized;
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
  const link = findLink(ctx.workbookLinks.listRecords(), ref.workbookToken);
  if (!link) return 'NA()';

  const scope = ctx.workbookLinkScope();
  let status = ctx.workbookLinks.getRuntimeStatus(link.linkId, scope);
  if (!status || status.status === 'unresolved' || status.status === 'loading') {
    await ctx.workbookLinks.refresh(link.linkId, scope);
    status = ctx.workbookLinks.getRuntimeStatus(link.linkId, scope);
  }
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

function findLink(
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

function parseExternalRefs(formula: string): ParsedExternalRef[] {
  const refs: ParsedExternalRef[] = [];
  const pattern =
    /(?:'\[([^\]]+)\]([^']+)'|\[([^\]]+)\]([^!']+))!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)/g;
  for (const match of formula.matchAll(pattern)) {
    refs.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      workbookToken: match[1] ?? match[3],
      sheetName: (match[2] ?? match[4]).replace(/''/g, "'"),
      address: match[5].replace(/\$/g, ''),
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
