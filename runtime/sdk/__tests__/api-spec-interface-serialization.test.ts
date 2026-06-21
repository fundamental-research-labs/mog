import { readFileSync } from 'node:fs';
import * as ts from 'typescript';

import {
  collectInterfaceTypeElements,
  serializeInterfaceDefinition,
  type InterfaceResolution,
} from '../scripts/api-spec-interface-serialization';

interface GeneratedApiSpecFixture {
  subApis: {
    workbook: {
      version?: {
        canonicalPath: string;
        targetInterface?: string;
      };
    };
  };
  interfaces: {
    WorkbookVersion?: {
      functions: Record<string, { signature: string }>;
    };
  };
  types: Record<string, { source: { file: string } }>;
}

const apiSpec = JSON.parse(
  readFileSync(new URL('../src/generated/api-spec.json', import.meta.url), 'utf8'),
) as GeneratedApiSpecFixture;

function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

function findInterface(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration {
  let found: ts.InterfaceDeclaration | null = null;
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      found = node;
    }
  });
  if (!found) throw new Error(`Missing interface ${name}`);
  return found;
}

describe('api spec interface serialization', () => {
  it('exposes the workbook version sub-api with migrated VersionResult signatures', () => {
    expect(apiSpec.subApis.workbook.version).toEqual(
      expect.objectContaining({
        canonicalPath: 'wb.version',
        targetInterface: 'WorkbookVersion',
      }),
    );

    const workbookVersion = apiSpec.interfaces.WorkbookVersion;
    expect(workbookVersion).toBeDefined();
    if (!workbookVersion) throw new Error('Generated API spec is missing WorkbookVersion');
    expect(workbookVersion.functions.getHead.signature).toContain(
      'Promise<VersionResult<VersionHead>>',
    );
    expect(workbookVersion.functions.listCommits.signature).toContain(
      'Promise<VersionResult<Paged<WorkbookCommitSummary>>>',
    );
    expect(workbookVersion.functions.commit.signature).toContain(
      'Promise<VersionResult<WorkbookCommitSummary>>',
    );
    expect(workbookVersion.functions.diff.signature).toContain(
      'Promise<VersionResult<VersionSemanticDiffPage>>',
    );
    expect(apiSpec.types.WorkbookCommitSummary.source.file).toBe(
      'types/api/src/api/workbook/version.ts',
    );
    expect(apiSpec.types.RedactedVersionAuthor.source.file).toBe(
      'types/api/src/api/workbook/version.ts',
    );
  });

  it('collects inherited interface members with their source files', () => {
    const baseSource = parseSource(
      'worksheet-fill.ts',
      `
      export interface WorksheetFill {
        /** Preview without mutating cells. */
        autoFillPreview(sourceRange: string, targetRange: string): Promise<void>;
      }
    `,
    );
    const worksheetSource = parseSource(
      'worksheet.ts',
      `
      export interface Worksheet extends WorksheetFill {
        /** Read a cell. */
        getCell(address: string): Promise<unknown>;
      }
    `,
    );

    const declarations = new Map<string, InterfaceResolution>([
      [
        'WorksheetFill',
        {
          node: findInterface(baseSource, 'WorksheetFill'),
          sourceFile: baseSource,
        },
      ],
      [
        'Worksheet',
        {
          node: findInterface(worksheetSource, 'Worksheet'),
          sourceFile: worksheetSource,
        },
      ],
    ]);
    const worksheet = declarations.get('Worksheet')!;

    const members = collectInterfaceTypeElements({
      node: worksheet.node,
      sourceFile: worksheet.sourceFile,
      resolveInterface: (name) => declarations.get(name) ?? null,
    });

    expect(
      members.map(({ member, sourceFile }) => ({
        name: (member as { name?: ts.PropertyName }).name?.getText(sourceFile),
        file: sourceFile.fileName,
      })),
    ).toEqual([
      { name: 'autoFillPreview', file: 'worksheet-fill.ts' },
      { name: 'getCell', file: 'worksheet.ts' },
    ]);

    const definition = serializeInterfaceDefinition({
      node: worksheet.node,
      sourceFile: worksheet.sourceFile,
      resolveInterface: (name) => declarations.get(name) ?? null,
    });
    expect(definition).toContain('autoFillPreview(sourceRange: string, targetRange: string)');
    expect(definition).toContain('getCell(address: string)');
  });

  it('serializes OperationReceiptBase fields onto derived receipt definitions', () => {
    const baseSource = parseSource(
      'operation-receipt.ts',
      `
      export interface OperationReceiptBase {
        readonly kind: string;
        readonly status: OperationStatus;
        readonly effects: readonly OperationEffect[];
        readonly diagnostics: readonly OperationDiagnostic[];
        readonly operationId?: string;
      }
    `,
    );
    const payloadSource = parseSource(
      'fill-types.ts',
      `
      export interface AutoFillResult {
        readonly filledCellCount: number;
      }
    `,
    );
    const receiptSource = parseSource(
      'worksheet-fill.ts',
      `
      export interface AutoFillApplyReceipt extends OperationReceiptBase, AutoFillResult {
        readonly kind: 'autofill.apply';
        readonly status: 'applied' | 'noOp';
        readonly mode: AutoFillMode;
      }
    `,
    );

    const declarations = new Map<string, InterfaceResolution>([
      [
        'OperationReceiptBase',
        {
          node: findInterface(baseSource, 'OperationReceiptBase'),
          sourceFile: baseSource,
        },
      ],
      [
        'AutoFillResult',
        {
          node: findInterface(payloadSource, 'AutoFillResult'),
          sourceFile: payloadSource,
        },
      ],
      [
        'AutoFillApplyReceipt',
        {
          node: findInterface(receiptSource, 'AutoFillApplyReceipt'),
          sourceFile: receiptSource,
        },
      ],
    ]);
    const receipt = declarations.get('AutoFillApplyReceipt')!;

    const definition = serializeInterfaceDefinition({
      node: receipt.node,
      sourceFile: receipt.sourceFile,
      resolveInterface: (name) => declarations.get(name) ?? null,
    });

    expect(definition).toContain("kind: 'autofill.apply';");
    expect(definition).toContain("status: 'applied' | 'noOp';");
    expect(definition).toContain('effects: readonly OperationEffect[];');
    expect(definition).toContain('diagnostics: readonly OperationDiagnostic[];');
    expect(definition).toContain('operationId?: string;');
    expect(definition).toContain('filledCellCount: number;');
    expect(definition).toContain('mode: AutoFillMode;');
  });
});
