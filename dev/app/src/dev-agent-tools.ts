import rawApiSpec from '../../../runtime/sdk/src/generated/api-spec.json';
import rawApiGuidanceTargets from '../../../runtime/sdk/src/generated/api-guidance-targets.json';
import type { DevAgentToolCall } from './dev-agent-tool-protocol';

export type DevAgentToolName = 'mog_api_search' | 'mog_api_describe' | 'mog_api_execute';

type ApiGuidanceTargetKind = 'method' | 'property' | 'subApiAccessor' | 'rootImport';
type ApiGuidanceTargetRoot = 'workbook' | 'worksheet' | 'subApi' | 'rootImport';
type ApiGuidanceVisibility = 'public' | 'internal' | 'deprecated';

interface ApiGuidanceSourceLocation {
  readonly file: string;
  readonly line?: number;
}

interface ApiGuidanceTarget {
  readonly path: string;
  readonly stableId?: string;
  readonly root: ApiGuidanceTargetRoot;
  readonly parentRoot?: 'workbook' | 'worksheet';
  readonly kind: ApiGuidanceTargetKind;
  readonly interface?: string;
  readonly member?: string;
  readonly asyncModel: 'sync' | 'promise';
  readonly signature: string;
  readonly typeText: string;
  readonly visibility: ApiGuidanceVisibility;
  readonly targetInterface?: string;
  readonly source?: ApiGuidanceSourceLocation;
  readonly ownerPackage: string;
}

interface GeneratedApiGuidanceTargets {
  readonly targets: readonly ApiGuidanceTarget[];
  readonly byPath?: Record<string, ApiGuidanceTarget>;
}

interface ApiSpecFunctionEntry {
  readonly signature: string;
  readonly docstring: string;
  readonly usedTypes?: readonly string[];
  readonly kind?: ApiGuidanceTargetKind;
  readonly canonicalPath?: string;
  readonly targetInterface?: string;
}

interface ApiSpecInterfaceEntry {
  readonly docstring: string;
  readonly members: Record<string, ApiSpecFunctionEntry>;
  readonly functions: Record<string, ApiSpecFunctionEntry>;
}

interface ApiSpecTypeEntry {
  readonly name: string;
  readonly definition?: string;
  readonly isEnum?: boolean;
  readonly values?: Record<string, string>;
  readonly docstring?: string;
}

interface ApiSpec {
  readonly subApis: {
    readonly workbook: Record<string, ApiSpecFunctionEntry>;
    readonly worksheet: Record<string, ApiSpecFunctionEntry>;
  };
  readonly interfaces: Record<string, ApiSpecInterfaceEntry>;
  readonly types: Record<string, ApiSpecTypeEntry>;
}

interface OverviewResult {
  readonly workbook: { readonly methods: readonly string[]; readonly subApis: readonly string[] };
  readonly worksheet: { readonly methods: readonly string[]; readonly subApis: readonly string[] };
  readonly utilities: {
    readonly namespaces: readonly string[];
    readonly methods: readonly string[];
  };
}

interface InterfaceResult {
  readonly name: string;
  readonly path: string;
  readonly docstring: string;
  readonly methods: readonly MethodSummary[];
}

interface MethodSummary {
  readonly name: string;
  readonly signature: string;
  readonly docstring: string;
}

interface MethodResult {
  readonly name: string;
  readonly path: string;
  readonly signature: string;
  readonly docstring: string;
  readonly types: Record<string, TypeResult>;
}

interface TypeResult {
  readonly name: string;
  readonly definition?: string;
  readonly isEnum?: boolean;
  readonly values?: Record<string, string>;
  readonly docstring?: string;
}

type DescribeResult = OverviewResult | InterfaceResult | MethodResult | TypeResult | null;

export interface DevAgentActiveDocumentSnapshot {
  readonly activeFileId: string | null;
  readonly displayName: string;
  readonly loadingState: string;
  readonly hasHandle: boolean;
  readonly modeLabel: string;
}

export interface DevAgentToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: DevAgentToolName;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface DevAgentToolExecution {
  readonly ok: boolean;
  readonly tool: string;
  readonly result?: unknown;
  readonly error?: string;
}

export interface DevAgentToolSession {
  searchedApi: boolean;
}

interface DevAgentStoreLike {
  getState(): {
    readonly activeFileId?: string | null;
    readonly files?: Record<string, { readonly displayName?: string } | undefined>;
  };
}

interface DevAgentDocumentHandleLike {
  workbook(): Promise<DevAgentWorkbookLike>;
}

interface DevAgentDocumentManagerLike {
  getDocument(fileId: string): DevAgentDocumentHandleLike | null;
  getDocumentMode(fileId: string): { readonly kind: string; readonly roomId?: string } | null;
  getLoadingState(fileId: string): string;
}

export interface DevAgentShellLike {
  readonly store: DevAgentStoreLike;
  readonly documentManager: DevAgentDocumentManagerLike;
}

interface DevAgentWorkbookLike {
  readonly activeSheet: DevAgentWorksheetLike;
  readonly sheetNames: readonly string[];
  executeCode?(code: string, options?: Record<string, unknown>): Promise<unknown>;
}

interface DevAgentWorksheetLike {
  readonly name: string;
  getUsedRange(): Promise<{ readonly address: string } | null>;
  describeRange(range?: string, includeStyle?: boolean): Promise<string>;
}

interface ApiSearchHit {
  readonly path: string;
  readonly kind: ApiGuidanceTarget['kind'];
  readonly root: ApiGuidanceTarget['root'];
  readonly signature: string;
  readonly typeText: string;
  readonly asyncModel: ApiGuidanceTarget['asyncModel'];
  readonly visibility: ApiGuidanceTarget['visibility'];
  readonly docstring?: string;
  readonly source?: ApiGuidanceTarget['source'];
  readonly score: number;
}

interface ExecutionLogSink {
  readonly logs: string[];
  log(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 30;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
const MAX_EXECUTION_TIMEOUT_MS = 120_000;
const SEARCH_STOP_TOKENS = new Set(['api', 'mog', 'native', 'public']);

const apiSpec = rawApiSpec as ApiSpec;
const apiGuidanceTargets = (rawApiGuidanceTargets as GeneratedApiGuidanceTargets).targets;
const apiGuidanceTargetByPath = new Map(apiGuidanceTargets.map((target) => [target.path, target]));

const api = {
  describe: apiDescribe,
  targets: apiGuidanceTargets,
};

export const DEV_AGENT_TOOL_DEFINITIONS: readonly DevAgentToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'mog_api_search',
      description:
        'Search the generated public Mog API reference. Call this before executing workbook code so you discover the right API path for the current task.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language or API-path query for the workbook task.',
          },
          limit: {
            type: 'number',
            description: `Maximum result count. Defaults to ${DEFAULT_SEARCH_LIMIT}.`,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mog_api_describe',
      description:
        'Describe one or more exact Mog API paths returned by search, including signatures, docstrings, used types, and guidance.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'One exact API path returned by mog_api_search.',
          },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Multiple exact API paths to describe.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mog_api_execute',
      description:
        'Execute JavaScript against the active workbook after searching the API. The code receives wb, workbook, ws, worksheet, api, and console.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'JavaScript statements to run. Use await for async Mog APIs and return a compact value to show the result.',
          },
          timeoutMs: {
            type: 'number',
            description: `Timeout in milliseconds. Defaults to ${DEFAULT_EXECUTION_TIMEOUT_MS}.`,
          },
          preferWorkbookExecutor: {
            type: 'boolean',
            description:
              'When true, try wb.executeCode(code) before the dev browser evaluator. Defaults to false.',
          },
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
  },
];

export function createDevAgentToolSession(): DevAgentToolSession {
  return { searchedApi: false };
}

export function readDevAgentActiveDocumentSnapshot(
  shell: DevAgentShellLike,
): DevAgentActiveDocumentSnapshot {
  const state = shell.store.getState();
  const activeFileId = state.activeFileId ?? null;
  const file = activeFileId ? state.files?.[activeFileId] : undefined;
  const handle = activeFileId ? shell.documentManager.getDocument(activeFileId) : null;
  const mode = activeFileId ? shell.documentManager.getDocumentMode(activeFileId) : null;

  return {
    activeFileId,
    displayName: file?.displayName ?? activeFileId ?? 'No active document',
    loadingState: activeFileId ? shell.documentManager.getLoadingState(activeFileId) : 'idle',
    hasHandle: handle !== null,
    modeLabel:
      mode?.kind === 'collaboration'
        ? `collab:${mode.roomId}`
        : mode?.kind === 'normal'
          ? 'normal'
          : 'none',
  };
}

export async function buildDevAgentWorkbookContext(shell: DevAgentShellLike): Promise<string> {
  const active = await resolveActiveWorkbook(shell);
  if (!active.ok) return active.message;

  const { snapshot, workbook } = active;
  const sheet = workbook.activeSheet;
  const usedRange = await sheet.getUsedRange();
  const preview = usedRange ? await sheet.describeRange(usedRange.address, false) : 'empty sheet';

  return [
    `Active file: ${snapshot.activeFileId}`,
    `Display name: ${snapshot.displayName}`,
    `Mode: ${snapshot.modeLabel}`,
    `Active sheet: ${sheet.name}`,
    `Sheets: ${workbook.sheetNames.join(', ') || 'none'}`,
    `Used range: ${usedRange?.address ?? 'empty'}`,
    `Preview:\n${preview}`,
  ].join('\n');
}

export async function executeDevAgentTool(
  shell: DevAgentShellLike,
  call: DevAgentToolCall,
  session: DevAgentToolSession,
): Promise<DevAgentToolExecution> {
  if (call.argumentParseError) {
    return {
      ok: false,
      tool: call.name,
      error: `Invalid JSON arguments: ${call.argumentParseError}`,
    };
  }

  try {
    switch (call.name) {
      case 'mog_api_search': {
        const query = stringArg(call.arguments, 'query');
        const limit = numberArg(call.arguments, 'limit', DEFAULT_SEARCH_LIMIT, {
          min: 1,
          max: MAX_SEARCH_LIMIT,
        });
        const results = searchMogApi(query, limit);
        session.searchedApi = true;
        return ok(call.name, {
          query,
          results,
          next:
            results.length > 0
              ? 'Use mog_api_describe on the most relevant path, then mog_api_execute with JavaScript using wb/ws.'
              : 'No generated API match found. Try a broader query or inspect api.describe().',
        });
      }

      case 'mog_api_describe': {
        const paths = apiPathsArg(call.arguments);
        return ok(call.name, {
          descriptions: paths.map((path) => describeApiPath(path)),
        });
      }

      case 'mog_api_execute': {
        if (!session.searchedApi) {
          return {
            ok: false,
            tool: call.name,
            error:
              'Call mog_api_search for this user request before mog_api_execute. The dev agent must discover the Mog API path instead of relying on a hard-coded command.',
          };
        }

        const active = await resolveActiveWorkbook(shell);
        if (!active.ok) return { ok: false, tool: call.name, error: active.message };

        const code = stringArg(call.arguments, 'code');
        const timeoutMs = numberArg(call.arguments, 'timeoutMs', DEFAULT_EXECUTION_TIMEOUT_MS, {
          min: 1,
          max: MAX_EXECUTION_TIMEOUT_MS,
        });
        const preferWorkbookExecutor = booleanArg(call.arguments, 'preferWorkbookExecutor', false);
        const result = await executeMogCode(active.workbook, code, {
          timeoutMs,
          preferWorkbookExecutor,
        });
        return ok(call.name, result);
      }

      default:
        return {
          ok: false,
          tool: call.name,
          error: `Unknown Mog dev-agent tool "${call.name}".`,
        };
    }
  } catch (error) {
    return {
      ok: false,
      tool: call.name,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function ok(tool: string, result: unknown): DevAgentToolExecution {
  return { ok: true, tool, result };
}

function searchMogApi(query: string, limit: number): ApiSearchHit[] {
  const queryTokens = expandQueryTokens(tokenize(query));
  const queryLower = query.trim().toLowerCase();
  const queryMentionsAnnotation = queryTokens.has('annotation') || queryTokens.has('annotations');
  const queryMentionsComments =
    queryTokens.has('comment') || queryTokens.has('comments') || queryTokens.has('note');

  return apiGuidanceTargets
    .filter((target) => target.visibility === 'public' || target.visibility === 'deprecated')
    .map((target) => {
      const described = apiDescribe(target.path);
      const docstringText =
        described && 'docstring' in described ? (described.docstring ?? '') : '';
      const memberTokens = new Set(tokenize(target.member ?? target.path));
      const pathTokens = new Set(tokenize(target.path));
      const haystack = [
        target.path,
        target.stableId,
        target.member,
        target.signature,
        target.typeText,
        target.kind,
        target.root,
        target.interface,
        target.targetInterface,
        target.source?.file,
        docstringText,
      ]
        .filter(Boolean)
        .join(' ');
      const haystackLower = haystack.toLowerCase();
      const haystackTokens = new Set(tokenize(haystack));
      let score = 0;

      if (haystackLower.includes(queryLower)) score += 25;
      if (target.path.toLowerCase() === queryLower) score += 100;
      if (target.path.toLowerCase().includes(queryLower)) score += 35;

      for (const token of queryTokens) {
        if (haystackTokens.has(token)) score += 8;
        else if (haystackLower.includes(token)) score += 3;
      }

      if (target.root === 'worksheet' && queryTokens.has('worksheet')) score += 4;
      if (target.root === 'workbook' && queryTokens.has('workbook')) score += 4;
      if (memberTokens.has('cell') && queryTokens.has('cell')) score += 12;
      if (memberTokens.has('value') && queryTokens.has('value')) score += 8;
      if (memberTokens.has('set') && queryTokens.has('set')) score += 6;
      if (
        queryMentionsAnnotation &&
        (pathTokens.has('annotation') ||
          pathTokens.has('annotations') ||
          haystackTokens.has('annotation') ||
          haystackTokens.has('annotations'))
      ) {
        score += 14;
      }
      if (
        queryMentionsAnnotation &&
        queryTokens.has('cell') &&
        target.path.startsWith('ws.annotations.cells')
      ) {
        score += 12;
      }
      if (
        queryMentionsAnnotation &&
        !queryMentionsComments &&
        (target.path.includes('.comments') || target.path.includes('.notes'))
      ) {
        score -= 10;
      }
      if (target.visibility === 'deprecated') score -= 6;
      if (
        memberTokens.has('set') &&
        memberTokens.has('cell') &&
        queryTokens.has('set') &&
        queryTokens.has('cell') &&
        queryTokens.has('value')
      ) {
        score += 18;
      }
      if (
        docstringText.toLowerCase().includes('cell value') &&
        queryTokens.has('cell') &&
        queryTokens.has('value')
      ) {
        score += 10;
      }

      return {
        path: target.path,
        kind: target.kind,
        root: target.root,
        signature: target.signature,
        typeText: target.typeText,
        asyncModel: target.asyncModel,
        visibility: target.visibility,
        docstring: docstringText || undefined,
        source: target.source,
        score,
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function describeApiPath(path: string): {
  readonly path: string;
  readonly description: DescribeResult;
  readonly guidance: unknown;
} {
  return {
    path,
    description: apiDescribe(path),
    guidance: apiGuidanceTargetByPath.get(normalizeApiPath(path)) ?? null,
  };
}

function apiDescribe(path: string): DescribeResult {
  if (!path.trim()) return describeOverview();
  if (path.startsWith('type:')) return resolveType(path.slice('type:'.length));

  const normalized = normalizeApiPath(path);
  const parts = normalized.split('.');
  const root = parts[0];

  if (root !== 'wb' && root !== 'ws') return null;

  const rootInterface = root === 'wb' ? 'Workbook' : 'Worksheet';
  if (parts.length === 1) return buildInterfaceResult(rootInterface, root, root);

  let currentInterface = rootInterface;
  let currentPath = root;

  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    const entry = getInterfaceMember(currentInterface, part);
    if (!entry) return null;
    const fullPath = `${currentPath}.${part}`;
    const isLast = index === parts.length - 1;

    if (isLast) {
      if (entry.targetInterface) return buildInterfaceResult(entry.targetInterface, fullPath, root);
      return buildMethodResult(currentInterface, part, fullPath);
    }

    if (!entry.targetInterface) return null;
    currentInterface = entry.targetInterface;
    currentPath = fullPath;
  }

  return null;
}

function normalizeApiPath(path: string): string {
  const trimmed = path.trim().replace(/\(\s*\)$/, '');
  const [root, ...rest] = trimmed.split('.');
  const normalizedRoot = root === 'workbook' ? 'wb' : root === 'worksheet' ? 'ws' : root;
  return [normalizedRoot, ...rest].join('.');
}

function describeOverview(): OverviewResult {
  return {
    workbook: {
      methods: rootMethodNames('Workbook', new Set(Object.keys(apiSpec.subApis.workbook))),
      subApis: Object.keys(apiSpec.subApis.workbook),
    },
    worksheet: {
      methods: rootMethodNames('Worksheet', new Set(Object.keys(apiSpec.subApis.worksheet))),
      subApis: Object.keys(apiSpec.subApis.worksheet),
    },
    utilities: {
      namespaces: [],
      methods: [],
    },
  };
}

function rootMethodNames(interfaceName: string, excluded: ReadonlySet<string>): string[] {
  const entry = apiSpec.interfaces[interfaceName];
  if (!entry) return [];
  return Object.keys(entry.functions).filter((name) => !excluded.has(name));
}

function getInterfaceMember(
  interfaceName: string,
  memberName: string,
): ApiSpecFunctionEntry | null {
  const entry = apiSpec.interfaces[interfaceName];
  return entry?.members[memberName] ?? entry?.functions[memberName] ?? null;
}

function buildInterfaceResult(
  interfaceName: string,
  path: string,
  root: string,
): InterfaceResult | null {
  const entry = apiSpec.interfaces[interfaceName];
  if (!entry) return null;
  const accessors = new Set(
    Object.entries(entry.members)
      .filter(([, member]) => Boolean(member.targetInterface))
      .map(([name]) => name),
  );
  const rootAccessors =
    root === 'wb'
      ? new Set([...Object.keys(apiSpec.subApis.workbook), ...accessors])
      : root === 'ws'
        ? new Set([...Object.keys(apiSpec.subApis.worksheet), ...accessors])
        : accessors;
  return {
    name: interfaceName,
    path,
    docstring: entry.docstring,
    methods: Object.entries(entry.functions)
      .filter(([name]) => !rootAccessors.has(name))
      .map(([name, method]) => ({
        name,
        signature: method.signature,
        docstring: method.docstring,
      })),
  };
}

function buildMethodResult(
  interfaceName: string,
  methodName: string,
  path: string,
): MethodResult | null {
  const method = apiSpec.interfaces[interfaceName]?.functions[methodName];
  if (!method) return null;
  const types: Record<string, TypeResult> = {};
  for (const typeName of method.usedTypes ?? []) {
    const resolved = resolveType(typeName);
    if (resolved) types[typeName] = resolved;
  }
  return {
    name: methodName,
    path,
    signature: method.signature,
    docstring: method.docstring,
    types,
  };
}

function resolveType(typeName: string): TypeResult | null {
  const direct = apiSpec.types[typeName];
  if (direct) return direct;
  const iface = apiSpec.interfaces[typeName];
  if (!iface) return null;
  return {
    name: typeName,
    definition: `{ ${Object.entries(iface.functions)
      .map(([name, member]) => `${name}: ${member.signature}`)
      .join('; ')} }`,
    docstring: iface.docstring,
  };
}

function preflightMogCodeLocal(code: string): {
  readonly ok: boolean;
  readonly diagnostics: readonly unknown[];
} {
  const diagnostics: unknown[] = [];
  const checks: Array<{ readonly pattern: RegExp; readonly message: string }> = [
    {
      pattern: /\bExcel\s*\./,
      message:
        'Office.js Excel APIs are not available. Use public Mog APIs discovered by mog_api_search.',
    },
    {
      pattern: /\bOffice\s*\./,
      message:
        'Office.js APIs are not available. Use public Mog APIs discovered by mog_api_search.',
    },
    {
      pattern: /\bcontext\s*\.\s*(workbook|sync)\b/,
      message: 'Office.js request-context code is not a Mog API pattern. Use wb/ws directly.',
    },
  ];
  for (const check of checks) {
    if (!check.pattern.test(code)) continue;
    diagnostics.push({
      code: 'MOG_DEV_AGENT_FOREIGN_API',
      severity: 'error',
      message: check.message,
      suggestion:
        'Call mog_api_search and rewrite the code using wb/workbook, ws/worksheet, or api.',
    });
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

async function executeMogCode(
  workbook: DevAgentWorkbookLike,
  code: string,
  options: { readonly timeoutMs: number; readonly preferWorkbookExecutor: boolean },
): Promise<unknown> {
  const preflight = preflightMogCodeLocal(code);
  if (!preflight.ok) {
    return {
      status: 'blocked',
      diagnostics: preflight.diagnostics,
      message:
        'The code did not pass Mog API preflight. Search/describe the generated API and rewrite using public Mog APIs.',
    };
  }

  if (options.preferWorkbookExecutor && typeof workbook.executeCode === 'function') {
    try {
      return {
        status: 'success',
        executor: 'workbook.executeCode',
        result: await workbook.executeCode(code, {
          timeout: options.timeoutMs,
          mutationPolicy: 'allowPartial',
        }),
        workbook: await activeWorkbookSummary(workbook),
      };
    } catch (error) {
      return {
        status: 'executor-unavailable',
        executor: 'workbook.executeCode',
        error: error instanceof Error ? error.message : String(error),
        fallback: await executeInBrowser(workbook, code, options.timeoutMs),
      };
    }
  }

  return executeInBrowser(workbook, code, options.timeoutMs);
}

async function executeInBrowser(
  workbook: DevAgentWorkbookLike,
  code: string,
  timeoutMs: number,
): Promise<unknown> {
  const logs = createExecutionLogSink();
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(
    'wb',
    'workbook',
    'ws',
    'worksheet',
    'api',
    'console',
    `"use strict";\n${code}`,
  );

  const startedAt = performance.now();
  const value = await withTimeout(
    fn(workbook, workbook, workbook.activeSheet, workbook.activeSheet, api, logs),
    timeoutMs,
  );

  return {
    status: 'success',
    executor: 'dev-browser-evaluator',
    value: toJsonSafe(value),
    logs: logs.logs,
    durationMs: Math.round(performance.now() - startedAt),
    workbook: await activeWorkbookSummary(workbook),
  };
}

function createExecutionLogSink(): ExecutionLogSink {
  const logs: string[] = [];
  const push = (level: string, values: unknown[]) => {
    logs.push(`${level}: ${values.map((value) => formatLogValue(value)).join(' ')}`);
  };
  return {
    logs,
    log: (...values) => push('log', values),
    warn: (...values) => push('warn', values),
    error: (...values) => push('error', values),
  };
}

function formatLogValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(toJsonSafe(value));
  } catch {
    return String(value);
  }
}

async function activeWorkbookSummary(workbook: DevAgentWorkbookLike): Promise<unknown> {
  const sheet = workbook.activeSheet;
  const usedRange = await sheet.getUsedRange();
  const preview = usedRange ? await sheet.describeRange(usedRange.address, false) : 'empty sheet';
  return {
    activeSheet: sheet.name,
    sheets: workbook.sheetNames,
    usedRange: usedRange?.address ?? null,
    preview,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Execution timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function resolveActiveWorkbook(shell: DevAgentShellLike): Promise<
  | {
      readonly ok: true;
      readonly snapshot: DevAgentActiveDocumentSnapshot;
      readonly workbook: DevAgentWorkbookLike;
    }
  | { readonly ok: false; readonly message: string }
> {
  const snapshot = readDevAgentActiveDocumentSnapshot(shell);
  if (!snapshot.activeFileId) return { ok: false, message: 'No active workbook is open.' };

  const handle = shell.documentManager.getDocument(snapshot.activeFileId);
  if (!handle) {
    return {
      ok: false,
      message: `Active file "${snapshot.activeFileId}" is not ready. Loading state: ${snapshot.loadingState}.`,
    };
  }

  return { ok: true, snapshot, workbook: await handle.workbook() };
}

function tokenize(value: string): string[] {
  return camelToWords(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1 && !SEARCH_STOP_TOKENS.has(token));
}

function camelToWords(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function expandQueryTokens(tokens: readonly string[]): Set<string> {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    if (token.endsWith('s') && token.length > 3) expanded.add(token.slice(0, -1));
    else if (token.length > 2) expanded.add(`${token}s`);
  }
  if (tokens.some((token) => /^[a-z]{1,3}[0-9]{1,7}$/i.test(token))) {
    for (const token of ['cell', 'address', 'worksheet', 'value']) expanded.add(token);
  }
  if (tokens.some((token) => ['add', 'put', 'write', 'change', 'update'].includes(token))) {
    for (const token of ['set', 'write', 'value', 'create', 'insert']) expanded.add(token);
  }
  if (tokens.some((token) => ['remove', 'delete', 'empty'].includes(token))) {
    for (const token of ['clear', 'delete', 'remove']) expanded.add(token);
  }
  if (tokens.some((token) => ['formula', 'calculate', 'calculation'].includes(token))) {
    for (const token of ['formula', 'evaluate', 'recalc']) expanded.add(token);
  }
  if (
    tokens.some((token) => ['annotate', 'annotates', 'annotation', 'annotations'].includes(token))
  ) {
    for (const token of ['annotation', 'annotations', 'annotate', 'review']) expanded.add(token);
  }
  return expanded;
}

function apiPathsArg(args: Record<string, unknown>): string[] {
  const single = args.path;
  const many = args.paths;
  const paths: string[] = [];
  if (typeof single === 'string' && single.trim()) paths.push(single.trim());
  if (Array.isArray(many)) {
    for (const entry of many) {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new Error('Tool argument "paths" must contain only non-empty strings.');
      }
      paths.push(entry.trim());
    }
  }
  if (paths.length === 0) throw new Error('Provide "path" or "paths".');
  return [...new Set(paths)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Tool argument "${name}" must be a non-empty string.`);
  }
  return value.trim();
}

function numberArg(
  args: Record<string, unknown>,
  name: string,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  const value = args[name];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Tool argument "${name}" must be a finite number.`);
  }
  return Math.max(bounds.min, Math.min(bounds.max, Math.trunc(value)));
}

function booleanArg(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
  const value = args[name];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`Tool argument "${name}" must be a boolean.`);
  return value;
}

function toJsonSafe(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (depth > 4) return '[MaxDepth]';
  if (Array.isArray(value))
    return value.slice(0, 50).map((entry) => toJsonSafe(entry, seen, depth + 1));
  if (!isRecord(value)) return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const entries = Object.entries(value).slice(0, 50);
  return Object.fromEntries(
    entries.map(([key, entry]) => [key, toJsonSafe(entry, seen, depth + 1)]),
  );
}
