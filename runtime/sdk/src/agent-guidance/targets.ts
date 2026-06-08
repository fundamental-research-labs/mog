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
