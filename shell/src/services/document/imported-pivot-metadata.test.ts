import { Blob } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DecompressionStream } from 'node:stream/web';
import { TextDecoder } from 'node:util';

class ReadableStreamResponse {
  constructor(private readonly stream: ReadableStream<Uint8Array>) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    const reader = this.stream.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      byteLength += value.byteLength;
    }
    const merged = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'TextDecoder', {
    configurable: true,
    value: TextDecoder,
  });
  Object.defineProperty(globalThis, 'DecompressionStream', {
    configurable: true,
    value: DecompressionStream,
  });
  Object.defineProperty(globalThis, 'Blob', {
    configurable: true,
    value: Blob,
  });
  Object.defineProperty(globalThis, 'Response', {
    configurable: true,
    value: ReadableStreamResponse,
  });
});

describe('extractImportedPivotMetadata', () => {
  it('discovers pivots when workbook relationships use absolute package targets', async () => {
    const { extractImportedPivotMetadata } = await import('./imported-pivot-metadata');
    const bytes = await readFile(
      resolve(
        __dirname,
        '../../../../file-io/xlsx/parser/test-corpus/parity/pivots/pivot-basic.xlsx',
      ),
    );

    const metadata = await extractImportedPivotMetadata(new Uint8Array(bytes));

    expect(metadata.diagnostics).toEqual([]);
    expect(metadata.pivots).toHaveLength(1);
    expect(metadata.pivots[0]).toMatchObject({
      id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
      name: 'PivotTable1',
      sheetName: 'Pivot',
      definitionPath: 'xl/pivotTables/pivotTable1.xml',
      range: {
        startRow: 0,
        startCol: 0,
        endRow: 3,
        endCol: 3,
        ref: 'A1:D4',
      },
      sourceRange: "'Data'!A1:C5",
      cacheId: 1,
      readOnly: true,
    });
    expect(metadata.pivots[0].fields.map((field) => field.name)).toEqual([
      'Category',
      'Region',
      'Amount',
    ]);
  });
});
