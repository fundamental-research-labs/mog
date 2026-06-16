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
});
