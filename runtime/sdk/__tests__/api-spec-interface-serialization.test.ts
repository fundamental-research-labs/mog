import * as ts from 'typescript';

import {
  collectInterfaceTypeElements,
  serializeInterfaceDefinition,
  type InterfaceResolution,
} from '../scripts/api-spec-interface-serialization';

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
