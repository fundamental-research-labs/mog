import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const FORMULA_AI_ROUTE = '/api/formula-ai/explain';
const DEFAULT_FORMULA_AI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_FORMULA_AI_MODEL = 'gpt-4.1-mini';
const DEFAULT_FORMULA_AI_TIMEOUT_MS = 30_000;
const MAX_FORMULA_AI_REQUEST_BYTES = 64 * 1024;
const MAX_REFERENCE_CELLS = 120;
const MAX_PROMPT_CONTEXT_CELLS = 120;
const MAX_ROW_CONTEXT_COLUMNS = 2;

interface FormulaAIContextCell {
  readonly address?: unknown;
  readonly value?: unknown;
}

interface FormulaAIExplainRequestBody {
  readonly formula?: unknown;
  readonly context?: {
    readonly sheetName?: unknown;
    readonly cellAddress?: unknown;
    readonly selectionRange?: unknown;
    readonly headers?: unknown;
    readonly nearbyCells?: unknown;
  };
}

interface ParsedCellAddress {
  readonly address: string;
  readonly row: number;
  readonly col: number;
}

interface FormulaReference {
  readonly text: string;
  readonly cells: readonly string[];
}

interface OpenAIChatCompletionResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: unknown;
    };
  }[];
  readonly error?: {
    readonly message?: unknown;
  };
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readRequestJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    byteLength += buffer.byteLength;
    if (byteLength > MAX_FORMULA_AI_REQUEST_BYTES) {
      throw new Error('Formula AI request is too large.');
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return {};
  return JSON.parse(raw);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')
      return [];
    const text = String(item).trim();
    return text === '' ? [] : [text];
  });
}

function contextCells(value: unknown): FormulaAIContextCell[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item == null || typeof item !== 'object') return [];
    return [item as FormulaAIContextCell];
  });
}

function columnIndex(column: string): number {
  let index = 0;
  for (const char of column.toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }
  return index - 1;
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellAddressFor(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

function normalizedCellAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\$/g, '').trim().toUpperCase();
  return /^[A-Z]+\d+$/.test(normalized) ? normalized : null;
}

function parseCellAddress(value: string): ParsedCellAddress | null {
  const address = normalizedCellAddress(value);
  if (!address) return null;
  const match = address.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    address,
    row: Number(match[2]) - 1,
    col: columnIndex(match[1]),
  };
}

function columnForAddress(address: string): string | null {
  return address.match(/^([A-Z]+)\d+$/)?.[1] ?? null;
}

function labelForAddress(address: string | null, headers: readonly string[]): string | null {
  if (!address) return null;
  const column = columnForAddress(address);
  if (!column) return null;
  return headers[columnIndex(column)] ?? null;
}

function isPeriodHeader(label: string | null): boolean {
  return label != null && /\b(month|period|quarter|year|date)\b/i.test(label);
}

function isPeriodValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)$/.test(
      normalized,
    ) ||
    /^q[1-4](?:\s+\d{2,4})?$/.test(normalized) ||
    /^\d{4}$/.test(normalized)
  );
}

function contextualLabelForAddress(
  address: string | null,
  headers: readonly string[],
  value: string | number | boolean | null | undefined,
): string | null {
  const label = labelForAddress(address, headers);
  if (isPeriodHeader(label) && typeof value === 'string' && !isPeriodValue(value)) {
    return 'Row label';
  }
  return label;
}

function normalizedReferenceText(text: string): string {
  const localReference = text.includes('!') ? text.slice(text.lastIndexOf('!') + 1) : text;
  return localReference.replace(/\$/g, '').trim().toUpperCase();
}

function expandReferenceCells(text: string): string[] {
  const normalized = normalizedReferenceText(text);
  const [startText, endText = startText] = normalized.split(':');
  const start = parseCellAddress(startText);
  const end = parseCellAddress(endText);
  if (!start || !end) return [];

  const startRow = Math.min(start.row, end.row);
  const endRow = Math.max(start.row, end.row);
  const startCol = Math.min(start.col, end.col);
  const endCol = Math.max(start.col, end.col);
  const cells: string[] = [];

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      if (cells.length >= MAX_REFERENCE_CELLS) return cells;
      cells.push(cellAddressFor(row, col));
    }
  }

  return cells;
}

function extractFormulaReferences(formula: string): FormulaReference[] {
  const references: FormulaReference[] = [];
  const seen = new Set<string>();
  const pattern =
    /(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?\$?[A-Z]{1,4}\$?\d+(?::\$?[A-Z]{1,4}\$?\d+)?/gi;

  for (const match of formula.matchAll(pattern)) {
    const text = normalizedReferenceText(match[0]);
    if (seen.has(text)) continue;
    const cells = expandReferenceCells(match[0]);
    if (cells.length === 0) continue;
    references.push({ text, cells });
    seen.add(text);
  }

  return references;
}

function labelForReference(reference: FormulaReference, headers: readonly string[]): string | null {
  const labels = [
    ...new Set(
      reference.cells.flatMap((address) => {
        const label = labelForAddress(address, headers);
        return label ? [label] : [];
      }),
    ),
  ];
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return labels.slice(0, 4).join(', ');
}

function rowContextForAddress(
  address: string,
  headers: readonly string[],
  nearbyByAddress: ReadonlyMap<string, string | number | boolean | null>,
) {
  const parsed = parseCellAddress(address);
  if (!parsed) return [];
  const context = [];
  const endCol = Math.min(parsed.col, headers.length, MAX_ROW_CONTEXT_COLUMNS);

  for (let col = 0; col < endCol; col++) {
    const labelAddress = cellAddressFor(parsed.row, col);
    const value = nearbyByAddress.get(labelAddress);
    if (value == null || value === '') continue;
    context.push({
      label: contextualLabelForAddress(labelAddress, headers, value) ?? labelAddress,
      value,
    });
  }

  return context;
}

function rowLabelForAddress(
  address: string | null,
  headers: readonly string[],
  nearbyByAddress: ReadonlyMap<string, string | number | boolean | null>,
): string | null {
  const parsed = address ? parseCellAddress(address) : null;
  if (!parsed) return null;

  for (let col = 0; col < Math.min(parsed.col, MAX_ROW_CONTEXT_COLUMNS); col++) {
    const labelAddress = cellAddressFor(parsed.row, col);
    const value = nearbyByAddress.get(labelAddress);
    if (
      typeof value === 'string' &&
      value.trim() !== '' &&
      contextualLabelForAddress(labelAddress, headers, value) === 'Row label'
    ) {
      return value.trim();
    }
  }

  return null;
}

function serializableCellValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return String(value);
}

function buildFormulaPrompt(body: FormulaAIExplainRequestBody): string {
  const formula = typeof body.formula === 'string' ? body.formula : '';
  const context = body.context ?? {};
  const headers = stringArray(context.headers);
  const targetCell = normalizedCellAddress(context.cellAddress);
  const nearbyCells = contextCells(context.nearbyCells);
  const nearbyByAddress = new Map<string, string | number | boolean | null>();

  for (const cell of nearbyCells) {
    const address = normalizedCellAddress(cell.address);
    if (!address) continue;
    nearbyByAddress.set(address, serializableCellValue(cell.value));
  }

  const referencedRanges = extractFormulaReferences(formula).map((reference) => ({
    reference: reference.text,
    label: labelForReference(reference, headers),
    cells: reference.cells.map((address) => ({
      address,
      label: contextualLabelForAddress(address, headers, nearbyByAddress.get(address)),
      value: nearbyByAddress.get(address) ?? null,
      rowContext: rowContextForAddress(address, headers, nearbyByAddress),
    })),
  }));

  const references = referencedRanges.flatMap((range) =>
    range.cells.map(({ address, label, value }) => ({
      address,
      label: contextualLabelForAddress(address, headers, value) ?? label,
      value,
    })),
  );

  const nearby = [...nearbyByAddress.entries()]
    .slice(0, MAX_PROMPT_CONTEXT_CELLS)
    .map(([address, value]) => ({
      address,
      label: contextualLabelForAddress(address, headers, value),
      value,
    }));

  return JSON.stringify(
    {
      sheetName: typeof context.sheetName === 'string' ? context.sheetName : undefined,
      activeCell: {
        address: targetCell,
        label: labelForAddress(targetCell, headers),
        summaryLabel: rowLabelForAddress(targetCell, headers, nearbyByAddress),
        value: targetCell ? (nearbyByAddress.get(targetCell) ?? null) : null,
        rowContext: targetCell ? rowContextForAddress(targetCell, headers, nearbyByAddress) : [],
      },
      selectedRange:
        typeof context.selectionRange === 'string' ? context.selectionRange : undefined,
      formula,
      headers,
      referencedCells: references,
      referencedRanges,
      nearbyCells: nearby,
    },
    null,
    2,
  );
}

function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function numberEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const value = envValue(env, name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function providerErrorMessage(payload: OpenAIChatCompletionResponse | undefined): string | null {
  const message = payload?.error?.message;
  return typeof message === 'string' && message.trim() !== '' ? message.trim() : null;
}

function completionContent(payload: OpenAIChatCompletionResponse): string | null {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;

  const text = content
    .flatMap((part) => {
      if (part == null || typeof part !== 'object') return [];
      const text = (part as { readonly text?: unknown }).text;
      return typeof text === 'string' ? [text] : [];
    })
    .join(' ');
  return text || null;
}

function normalizeExplanation(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '')
    .trim();
}

async function callFormulaAIProvider(
  body: FormulaAIExplainRequestBody,
  env: Record<string, string | undefined>,
): Promise<string> {
  const apiKey = envValue(env, 'MOG_FORMULA_AI_API_KEY') ?? envValue(env, 'OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'Formula AI is not configured. Set MOG_FORMULA_AI_API_KEY or OPENAI_API_KEY before starting the dev server.',
    );
  }

  const baseUrl = normalizeBaseUrl(
    envValue(env, 'MOG_FORMULA_AI_BASE_URL') ??
      envValue(env, 'OPENAI_BASE_URL') ??
      DEFAULT_FORMULA_AI_BASE_URL,
  );
  const model = envValue(env, 'MOG_FORMULA_AI_MODEL') ?? DEFAULT_FORMULA_AI_MODEL;
  const timeoutMs = numberEnv(env, 'MOG_FORMULA_AI_TIMEOUT_MS', DEFAULT_FORMULA_AI_TIMEOUT_MS);
  const operation = envValue(env, 'MOG_FORMULA_AI_OPERATION') ?? 'formula_trace';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-LLM-Operation': operation,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: [
              'Explain what a spreadsheet formula does in plain English that anyone can understand.',
              'Be extremely simple and clear.',
              'Write like you are explaining to a smart friend who does not know Excel.',
              'Use everyday words, not technical jargon.',
              'Focus on the actual cell operation, not a textbook definition of the metric.',
              'Use labels, periods, regions, categories, and row context from the prompt.',
              'Start with a verb like Calculates, Adds, Shows, Finds, or Checks.',
              'For row-level formulas, prefer "Calculates [target label] for [row context] by [operation]."',
              'Put row context after the target metric, not before each input label.',
              'Return one short sentence, usually 8 to 16 words.',
              'For range formulas, name what is being summed, averaged, counted, or combined.',
              'Use rowContext from referencedRanges when it helps identify those items.',
              'For formulas between individual cells, say the operation and result in normal language.',
              'For lookups or INDEX/MATCH formulas, say what value is being found.',
              'For IF and IFERROR formulas, say the condition or fallback in plain language.',
              'Do not define the metric concept unless the references do not provide enough context.',
              'Do not start with "This cell", "The formula", "This formula", or "This calculates".',
              'Do not say "is calculated by" or "is derived by".',
              'Do not mention cell addresses unless there is no useful label.',
              'Do not quote returned text values; paraphrase the outcome instead.',
              'Do not include values unless the formula only makes sense with the values.',
              'Do not write awkward phrases like "February East units sold" or "January West gross profit"; say "units sold for February East" or "gross profit for January West" instead.',
              'Treat row labels like Total, Average, Top, and Plan as summary labels, not periods or regions.',
              'Never say "Total month", "Average month", or "Plan month".',
              'Example: for SUM of Gross Profit rows labeled January/East through February/West, say "Adds gross profit for East and West from January through February."',
              'Example: for target Revenue with Month February and Segment East, say "Calculates revenue for February East by multiplying units sold by price per unit."',
              'Example: for target Gross Profit with Revenue and COGS, say "Subtracts cost of goods sold from revenue to get gross profit."',
              'Example: for target Average Price with IFERROR(Revenue/Units,0), say "Divides total revenue by total units, returning zero if there is an error."',
              'Example: for INDEX/MATCH finding the top segment, say "Finds the segment with the highest revenue."',
              'Example: for an IF plan check, say "Checks whether West revenue is over plan."',
            ].join(' '),
          },
          {
            role: 'user',
            content: buildFormulaPrompt(body),
          },
        ],
        temperature: 0.1,
        max_tokens: 80,
        stream: false,
      }),
      signal: controller.signal,
    });

    let payload: OpenAIChatCompletionResponse | undefined;
    try {
      payload = (await response.json()) as OpenAIChatCompletionResponse;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const detail = providerErrorMessage(payload);
      throw new Error(
        detail
          ? `Formula AI provider returned HTTP ${response.status}: ${detail}`
          : `Formula AI provider returned HTTP ${response.status}.`,
      );
    }

    const explanation = payload ? completionContent(payload) : null;
    if (!explanation) {
      throw new Error('Formula AI provider returned an empty completion.');
    }
    return normalizeExplanation(explanation);
  } finally {
    clearTimeout(timeout);
  }
}

export function formulaAIProxy(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'formula-ai-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(FORMULA_AI_ROUTE, async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'Formula AI endpoint only accepts POST requests.' });
          return;
        }

        try {
          const payload = (await readRequestJson(req)) as FormulaAIExplainRequestBody;
          const explanation = await callFormulaAIProvider(payload, env);
          writeJson(res, 200, { explanation });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const statusCode = message.includes('not configured') ? 503 : 502;
          writeJson(res, statusCode, { error: message });
        }
      });
    },
  };
}
