const runtimeValues = [
  {
    module: '@mog-sdk/contracts/cell-identity',
    symbol: 'toCellId',
  },
];

for (const runtimeValue of runtimeValues) {
  const moduleExports = await import(runtimeValue.module);
  if (!Object.prototype.hasOwnProperty.call(moduleExports, runtimeValue.symbol)) {
    throw new Error(`${runtimeValue.module} does not export ${runtimeValue.symbol}`);
  }
}
