describe('SDK entry validation', () => {
  it('rejects wasmModule on the native entry before path source I/O', async () => {
    const { createWorkbook } = await import('../src/boot');
    const wasmModule = emptyWasmModule();

    const operation = createWorkbook({
      source: { type: 'path', path: '/definitely/missing/workbook.xlsx' },
      wasmModule,
    } as never);

    await expect(operation).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'INVALID_ARGUMENT',
      operation: 'createWorkbook',
      path: ['wasmModule'],
      suggestion: expect.stringContaining('Import createWorkbook from @mog-sdk/sdk/wasm'),
      details: { paramName: 'wasmModule' },
      diagnostics: {
        property: 'wasmModule',
        issueCode: 'SDK_INVALID_CREATE_WORKBOOK_ARGUMENT',
      },
      message: expect.stringContaining('wasmModule is only valid from the @mog-sdk/sdk/wasm entry'),
    });
  });

  it('rejects path-shaped sources on the WASM entry', async () => {
    const { createWorkbook } = await import('../src/wasm');

    const operation = createWorkbook({
      source: { type: 'path', path: '/definitely/missing/workbook.xlsx' },
    } as never);

    await expect(operation).rejects.toMatchObject({
      name: 'MogSdkError',
      code: 'INVALID_ARGUMENT',
      operation: 'createWorkbook',
      path: ['source'],
      suggestion: 'Read the file in the host and pass source: { type: "bytes", data }.',
      details: { paramName: 'source', received: 'path' },
      diagnostics: {
        property: 'source',
        issueCode: 'SDK_INVALID_CREATE_WORKBOOK_ARGUMENT',
      },
    });
  });
});

function emptyWasmModule(): WebAssembly.Module {
  return new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
}
