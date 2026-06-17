import type { ApiCompatibilityEntry } from './types';

const WORKSHEET_METHOD_GUIDANCE = 'api-compatibility:mog-api/worksheet-method-guidance';
const ADDRESS_HELPER_THEME = 'sdk-agent-guidance/address-helper-ergonomics';
const VERIFICATION = ['pnpm --filter @mog-sdk/sdk test -- agent-guidance api-describe'];

const runtimeSurfaces = ['executeCode-preflight', 'agent-guidance', 'docs', 'api-eval'] as const;

const surfaceDisposition = {
  typescript: 'structured_diagnostic',
  kernel: 'structured_diagnostic',
  'executeCode-preflight': 'structured_diagnostic',
  'api-describe': 'structured_diagnostic',
  'agent-guidance': 'structured_diagnostic',
  docs: 'structured_diagnostic',
  python: 'structured_diagnostic',
  'api-eval': 'structured_diagnostic',
} as const;

function addressHelperEntry(config: {
  id: string;
  observedPath: string;
  canonicalPath: string;
  message: string;
  replacements: readonly string[];
  behavior: string;
  ownerTheme?: string;
  firstObservedVersion?: string;
  canonicalSince?: string | null;
}): ApiCompatibilityEntry {
  return {
    id: config.id,
    observedPath: config.observedPath,
    canonicalPath: config.canonicalPath,
    status: 'structured_diagnostic',
    appliesTo: 'method',
    ownerTheme: config.ownerTheme ?? ADDRESS_HELPER_THEME,
    ownerPackage: '@mog-sdk/sdk',
    firstObservedVersion: config.firstObservedVersion ?? '0.9.4',
    canonicalSince: config.canonicalSince ?? '0.9.5',
    deprecatedSince: null,
    removeAfter: null,
    evidence: [{ source: 'source', reference: WORKSHEET_METHOD_GUIDANCE }],
    behavior: config.behavior,
    runtimeSurfaces,
    surfaceDisposition,
    diagnostics: {
      code: 'MOG002_MOG_API_USAGE',
      message: config.message,
      replacements: config.replacements,
    },
    verification: VERIFICATION,
  };
}

export const addressHelperCompatibilityRegistry = [
  addressHelperEntry({
    id: 'mog-api.worksheet.indexToAddress.unsupported',
    observedPath: 'ws.indexToAddress',
    canonicalPath: 'a1.address',
    ownerTheme: 'sdk-agent-guidance/worksheet-api-usage',
    firstObservedVersion: '0.9.2',
    canonicalSince: null,
    behavior:
      'Address conversion helpers live under the canonical a1 namespace; worksheets do not expose indexToAddress().',
    message: 'ws.indexToAddress(row, col) is not a Mog worksheet method. Use a1.address(row, col).',
    replacements: ['a1.address', 'wb.indexToAddress'],
  }),
  addressHelperEntry({
    id: 'mog-api.worksheet.addressToIndex.unsupported',
    observedPath: 'ws.addressToIndex',
    canonicalPath: 'a1.parse',
    ownerTheme: 'sdk-agent-guidance/worksheet-api-usage',
    firstObservedVersion: '0.9.2',
    canonicalSince: null,
    behavior:
      'Address parsing helpers live under the canonical a1 namespace; worksheets do not expose addressToIndex().',
    message: 'ws.addressToIndex(address) is not a Mog worksheet method. Use a1.parse(address).',
    replacements: ['a1.parse', 'wb.addressToIndex'],
  }),
  addressHelperEntry({
    id: 'mog-api.worksheet.privateColLetter.unsupported',
    observedPath: 'ws._colLetter',
    canonicalPath: 'a1.column',
    ownerTheme: 'sdk-agent-guidance/worksheet-api-usage',
    firstObservedVersion: '0.9.2',
    canonicalSince: null,
    behavior:
      'Private worksheet/helper guesses such as _colLetter are not public Mog APIs; use the canonical a1 column/address helpers.',
    message: 'ws._colLetter(index) is not a public Mog worksheet method. Use a1.column(index).',
    replacements: ['a1.column'],
  }),
  addressHelperEntry({
    id: 'mog-api.address.indexToIndex.unsupported',
    observedPath: 'workbook.indexToIndex',
    canonicalPath: 'a1.address',
    behavior:
      'indexToIndex is a guessed address helper name. Use the canonical a1 helpers to format addresses or parse coordinates.',
    message:
      'workbook.indexToIndex(row, col) is not a Mog API. Use a1.address(row, col) for row/column to A1 conversion, or a1.parse(address) for A1 to row/column conversion.',
    replacements: ['a1.address', 'a1.parse'],
  }),
  addressHelperEntry({
    id: 'mog-api.address.wbIndexToIndex.unsupported',
    observedPath: 'wb.indexToIndex',
    canonicalPath: 'a1.address',
    behavior:
      'indexToIndex is a guessed address helper name. Use the canonical a1 helpers to format addresses or parse coordinates.',
    message:
      'wb.indexToIndex(row, col) is not a Mog API. Use a1.address(row, col) for row/column to A1 conversion, or a1.parse(address) for A1 to row/column conversion.',
    replacements: ['a1.address', 'a1.parse'],
  }),
  addressHelperEntry({
    id: 'mog-api.address.worksheetAddressHelper.unsupported',
    observedPath: 'ws.address',
    canonicalPath: 'a1.address',
    behavior:
      'Address helpers are stateless utilities, not worksheet methods. Use a1.address(row, col) for A1 formatting.',
    message: 'ws.address(row, col) is not a Mog worksheet method. Use a1.address(row, col).',
    replacements: ['a1.address'],
  }),
  addressHelperEntry({
    id: 'mog-api.address.worksheetRangeAddressHelper.unsupported',
    observedPath: 'ws.rangeAddress',
    canonicalPath: 'a1.range',
    behavior:
      'Range address helpers are stateless utilities, not worksheet methods. Use a1.range(row1, col1, row2, col2).',
    message:
      'ws.rangeAddress(row1, col1, row2, col2) is not a Mog worksheet method. Use a1.range(row1, col1, row2, col2).',
    replacements: ['a1.range'],
  }),
  addressHelperEntry({
    id: 'mog-api.address.worksheetColumnNameHelper.unsupported',
    observedPath: 'ws.columnName',
    canonicalPath: 'a1.column',
    behavior:
      'Column-name helpers are stateless utilities, not worksheet methods. Use a1.column(index).',
    message: 'ws.columnName(index) is not a Mog worksheet method. Use a1.column(index).',
    replacements: ['a1.column'],
  }),
  addressHelperEntry({
    id: 'mog-api.address.worksheetColumnIndexHelper.unsupported',
    observedPath: 'ws.columnIndex',
    canonicalPath: 'a1.columnIndex',
    behavior:
      'Column-index helpers are stateless utilities, not worksheet methods. Use a1.columnIndex(name).',
    message: 'ws.columnIndex(name) is not a Mog worksheet method. Use a1.columnIndex(name).',
    replacements: ['a1.columnIndex'],
  }),
  addressHelperEntry({
    id: 'mog-api.address.worksheetOffsetHelper.unsupported',
    observedPath: 'ws.offset',
    canonicalPath: 'a1.offset',
    behavior:
      'Address offset helpers are stateless utilities, not worksheet methods. Use a1.offset(address, dr, dc).',
    message:
      'ws.offset(address, dr, dc) is not a Mog worksheet method. Use a1.offset(address, dr, dc).',
    replacements: ['a1.offset'],
  }),
] satisfies readonly ApiCompatibilityEntry[];
