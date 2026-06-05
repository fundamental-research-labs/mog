describe('SDK entry validation', () => {
  it('rejects wasmModule on the native entry before path source I/O', async () => {
    const { createWorkbook } = await import('../src/boot');
    const wasmModule = emptyWasmModule();

    await expect(
      createWorkbook({
        source: { type: 'path', path: '/definitely/missing/workbook.xlsx' },
        wasmModule,
      } as never),
    ).rejects.toThrow('wasmModule is only valid from the @mog-sdk/sdk/wasm entry');
  });

  it('rejects path-shaped sources on the WASM entry', async () => {
    const { createWorkbook } = await import('../src/wasm');

    await expect(
      createWorkbook({
        source: { type: 'path', path: '/definitely/missing/workbook.xlsx' },
      } as never),
    ).rejects.toThrow(
      'File-path workbook sources are not supported by the WASM SDK entry',
    );
  });
});

function emptyWasmModule(): WebAssembly.Module {
  return new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
}
