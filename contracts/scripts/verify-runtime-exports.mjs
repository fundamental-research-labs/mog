const REQUIRED_EXPORTS = ['DEFAULT_FORMAT_BY_TYPE', 'FORMAT_PRESETS'];

const MODULES = [
  '@mog-sdk/contracts/number-formats/constants',
  '@mog-sdk/contracts/number-formats',
];

for (const specifier of MODULES) {
  const module = await import(specifier);
  const missing = REQUIRED_EXPORTS.filter((name) => !(name in module));
  if (missing.length > 0) {
    throw new Error(`${specifier} is missing runtime exports: ${missing.join(', ')}`);
  }
}

console.log(
  'verify-runtime-exports: number-format package subpaths expose required runtime constants',
);
