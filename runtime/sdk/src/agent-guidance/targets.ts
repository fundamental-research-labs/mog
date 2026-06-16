import rawTargets from '../generated/api-guidance-targets.json';
import { apiGuidanceCatalog } from './catalog';
import type {
  ApiGuidanceCatalogValidation,
  ApiGuidanceCatalogValidationIssue,
  ApiGuidanceTarget,
} from './types';

interface GeneratedTargets {
  readonly targets: readonly ApiGuidanceTarget[];
  readonly byPath: Record<string, ApiGuidanceTarget>;
}

const generatedTargets = rawTargets as GeneratedTargets;

const ROOT_IMPORT_TARGETS: readonly ApiGuidanceTarget[] = [
  {
    path: 'createWorkbook',
    root: 'rootImport',
    kind: 'rootImport',
    member: 'createWorkbook',
    asyncModel: 'promise',
    signature: 'createWorkbook(options?: CreateWorkbookOptions): Promise<Workbook>',
    typeText: 'Promise<Workbook>',
    visibility: 'public',
    source: { file: 'runtime/sdk/src/boot.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1',
    root: 'rootImport',
    kind: 'rootImport',
    member: 'a1',
    asyncModel: 'sync',
    signature: "import { a1 } from '@mog-sdk/sdk';",
    typeText: 'PublicA1Utils',
    visibility: 'public',
    source: { file: 'runtime/sdk/src/public-kernel-facade.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.address',
    root: 'rootImport',
    kind: 'method',
    member: 'address',
    asyncModel: 'sync',
    signature: 'address(row: number, col: number): string',
    typeText: 'string',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.range',
    root: 'rootImport',
    kind: 'method',
    member: 'range',
    asyncModel: 'sync',
    signature: 'range(row1: number, col1: number, row2: number, col2: number): string',
    typeText: 'string',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.column',
    root: 'rootImport',
    kind: 'method',
    member: 'column',
    asyncModel: 'sync',
    signature: 'column(index: number): string',
    typeText: 'string',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.columnIndex',
    root: 'rootImport',
    kind: 'method',
    member: 'columnIndex',
    asyncModel: 'sync',
    signature: 'columnIndex(name: string): number',
    typeText: 'number',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.offset',
    root: 'rootImport',
    kind: 'method',
    member: 'offset',
    asyncModel: 'sync',
    signature: 'offset(address: string, dr: number, dc: number): string',
    typeText: 'string',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.parse',
    root: 'rootImport',
    kind: 'method',
    member: 'parse',
    asyncModel: 'sync',
    signature: 'parse(address: string): { row: number; col: number; sheetName?: string } | null',
    typeText: '{row:number;col:number;sheetName?:string}|null',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.rangeAddress',
    root: 'rootImport',
    kind: 'method',
    member: 'rangeAddress',
    asyncModel: 'sync',
    signature: 'rangeAddress(row1: number, col1: number, row2: number, col2: number): string',
    typeText: 'string',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.columnName',
    root: 'rootImport',
    kind: 'method',
    member: 'columnName',
    asyncModel: 'sync',
    signature: 'columnName(index: number): string',
    typeText: 'string',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
  {
    path: 'a1.parseAddress',
    root: 'rootImport',
    kind: 'method',
    member: 'parseAddress',
    asyncModel: 'sync',
    signature: 'parseAddress(address: string): { row: number; col: number; sheetName?: string } | null',
    typeText: '{row:number;col:number;sheetName?:string}|null',
    visibility: 'public',
    source: { file: 'spreadsheet-utils/src/a1.ts' },
    ownerPackage: '@mog-sdk/sdk',
  },
];

const ROOT_ALIASES: Readonly<Record<string, string>> = {
  workbook: 'wb',
  worksheet: 'ws',
};

function buildTargets(): readonly ApiGuidanceTarget[] {
  const byPath = new Map<string, ApiGuidanceTarget>();

  for (const target of generatedTargets.targets) {
    byPath.set(target.path, target);
  }

  for (const target of ROOT_IMPORT_TARGETS) {
    byPath.set(target.path, target);
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export const apiGuidanceTargets = buildTargets();

const targetByPath = new Map(apiGuidanceTargets.map((target) => [target.path, target]));

export function normalizeMogApiPath(path: string): string {
  const trimmed = path.trim().replace(/\(\s*\)$/, '');
  const [root, ...rest] = trimmed.split('.');
  const normalizedRoot = ROOT_ALIASES[root] ?? root;
  return [normalizedRoot, ...rest].join('.');
}

export function resolveGuidanceTarget(path: string): ApiGuidanceTarget | null {
  return targetByPath.get(normalizeMogApiPath(path)) ?? null;
}

export function validateApiGuidanceCatalog(): ApiGuidanceCatalogValidation {
  const issues: ApiGuidanceCatalogValidationIssue[] = [];

  for (const entry of apiGuidanceCatalog) {
    for (const replacement of entry.mogReplacements) {
      if (!resolveGuidanceTarget(replacement.path)) {
        issues.push({
          entryId: entry.id,
          path: replacement.path,
          reason:
            'Replacement path does not resolve to generated API guidance targets or a documented SDK root import.',
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export const apiGuidanceCatalogValidation = validateApiGuidanceCatalog();
