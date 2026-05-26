import {
  createWorkbook,
  DocumentFactory,
  Utils,
  getFunctionCatalog,
  type CellRawValue,
  type CellValue,
  type CellWriteData,
  type CreateWorkbookOptions,
  type CreateDocumentOptions,
  type DocumentHandle,
  type DocumentImportOptions,
  type DocumentImportResult,
  type DocumentSource,
  type FormulaA1,
  type SheetId,
  type StoreCellData,
  type Workbook,
  type Worksheet,
  type MogDocument,
  type IMogDocumentFactory,
  type MogDocumentCreateOptions,
} from '@mog-sdk/kernel';
import {
  appId,
  getCapabilityInfo,
  hasNetworkAccess,
  type CapabilityGrant,
  type CapabilityType,
  type IGatedAppKernelAPI,
} from '@mog-sdk/kernel/security';
import { emptyMeta, type MetaState, type Provider } from '@mog-sdk/kernel/storage';
import {
  ShortcutMatcher,
  createTestKeyboardInput,
  crossPlatformBinding,
  type ChordMatchResult,
  type KeyboardInput,
  type KeyboardShortcutBase,
  type PendingShortcut,
  type ShortcutMatchDetailedResult,
} from '@mog-sdk/kernel/keyboard';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const address = Utils.parseCellAddress('B12');
assert(address.col === 1 && address.row === 11, `unexpected address ${JSON.stringify(address)}`);
assert(Utils.toA1(4, 3) === 'D5', 'toA1 export returned an unexpected address');

const catalog = getFunctionCatalog();
assert(Array.isArray(catalog), 'function catalog must be an array');

const options: CreateWorkbookOptions = { userTimezone: 'UTC' };
const createDocOptions: CreateDocumentOptions = { environment: 'headless', userTimezone: 'UTC' };
const importOptions: DocumentImportOptions = { valuesOnly: true, maxCells: 1000 };
const source: DocumentSource = { type: 'bytes', data: new Uint8Array([80, 75, 3, 4]) };
const sheetId: SheetId = 'sheet-1' as SheetId;
const formula: FormulaA1 = '=SUM(A1:A2)' as FormulaA1;
const raw: CellRawValue = 42;
const value: CellValue = 42;
const write: CellWriteData = { value: raw };
const storeCell: StoreCellData = { value: raw };
const maybeHandle: DocumentHandle | undefined = undefined;
const documentFactory: typeof DocumentFactory = DocumentFactory;
const sdkFactoryShape: IMogDocumentFactory | undefined = undefined;
const docCreateOptions: MogDocumentCreateOptions = {
  runtime: { kind: 'headless', userTimezone: 'UTC' },
};
const maybeDocument: MogDocument | undefined = undefined;
const networkCapability: CapabilityType = 'network:sameorigin';
const networkCapabilityInfo = getCapabilityInfo(networkCapability);
const grant: CapabilityGrant = {
  appId: appId('fixture-app'),
  capability: networkCapability,
  grantedAt: Date.now(),
  grantedBy: 'user',
};
const capabilitySet = new Set<CapabilityType>([networkCapability]);
const gatedApi: IGatedAppKernelAPI = {
  capabilities: {
    has: (capability) => capabilitySet.has(capability),
    list: () => [...capabilitySet],
    isScoped: () => false,
    getScope: () => null,
    hasAccessTo: (capability) => capabilitySet.has(capability),
    request: async () => false,
    onChange: () => () => {},
    onExpiring: () => () => {},
  },
};
const meta: MetaState = emptyMeta();
const providerShape: Provider | undefined = undefined;

type DemoKeyboardAction = 'OPEN_PANEL' | 'CLOSE_PANEL';
type DemoKeyboardContext = 'grid' | 'dialog';
type DemoKeyboardCategory = 'view';

interface DemoKeyboardPayload {
  OPEN_PANEL: { panelId: string };
}

type DemoKeyboardShortcut<A extends DemoKeyboardAction = DemoKeyboardAction> =
  A extends DemoKeyboardAction
    ? KeyboardShortcutBase<A, DemoKeyboardContext, DemoKeyboardCategory> & {
        readonly actionArg?: A extends keyof DemoKeyboardPayload ? DemoKeyboardPayload[A] : never;
      }
    : never;

const keyboardShortcut: DemoKeyboardShortcut<'OPEN_PANEL'> = {
  id: 'fixture.open-panel',
  bindings: crossPlatformBinding('KeyO', 'ctrl'),
  description: 'Open panel',
  action: 'OPEN_PANEL',
  actionArg: { panelId: 'properties' },
  enabled: true,
  priority: 'medium',
  category: 'view',
  contexts: ['grid'],
  matchBy: 'key',
  expectedCharacter: 'o',
};
const shortcutMatcher = new ShortcutMatcher<DemoKeyboardShortcut, DemoKeyboardContext>(
  [keyboardShortcut],
  'windows',
);
const keyboardInput: KeyboardInput = createTestKeyboardInput({
  physicalKey: 'KeyO',
  character: 'o',
  modifiers: { ctrl: true, shift: false, alt: false, meta: false },
});
const detailedMatch: ShortcutMatchDetailedResult<DemoKeyboardShortcut> =
  shortcutMatcher.matchWithReason(keyboardInput, 'grid');
const chordStart: ChordMatchResult<DemoKeyboardShortcut> = shortcutMatcher.matchChordStart(
  keyboardInput,
  'grid',
);
const emptyPending: readonly PendingShortcut<DemoKeyboardShortcut>[] = [];

assert(options.userTimezone === 'UTC', 'typed options should be usable');
assert(createDocOptions.environment === 'headless', 'create document options should be typed');
assert(
  importOptions.valuesOnly === true && source.type === 'bytes',
  'document import types should be usable',
);
assert(sheetId.length > 0 && formula.startsWith('='), 'branded public types should be usable');
assert(
  value.kind === 'number' && write.value === 42 && storeCell.value === 42,
  'cell types should be usable',
);
assert(maybeHandle === undefined, 'document handle type should be importable');
assert(typeof documentFactory.create === 'function', 'DocumentFactory.create should be callable');
assert(
  sdkFactoryShape === undefined && docCreateOptions.runtime?.kind === 'headless',
  'SDK document factory types should be importable',
);
assert(maybeDocument === undefined, 'MogDocument type should be importable');
assert(
  networkCapabilityInfo?.name.length > 0 && grant.capability === networkCapability,
  'security subpath types should be usable',
);
assert(hasNetworkAccess(gatedApi), 'security subpath runtime helpers should be usable');
assert(
  Array.isArray(meta.recentDocs) && providerShape === undefined,
  'storage subpath types should be usable',
);
assert(
  shortcutMatcher.match(keyboardInput, 'grid')?.actionArg?.panelId === 'properties',
  'keyboard subpath types and runtime helpers should be usable',
);
assert(
  detailedMatch.shortcut?.id === 'fixture.open-panel',
  'keyboard detailed matcher should preserve shortcut type',
);
assert(chordStart.kind === 'matched', 'keyboard chord start should fall back to single-key match');
assert(
  shortcutMatcher.getDefaultMatch(emptyPending) === null,
  'keyboard pending shortcut type should be importable',
);

async function exerciseWorkbookTypes(): Promise<void> {
  const workbook: Workbook = await createWorkbook({ userTimezone: 'UTC' });
  const worksheet: Worksheet = workbook.activeSheet;

  await worksheet.setCell('A1', 21);
  await worksheet.setCell('A2', '=A1*2');

  const a1 = await worksheet.getValue('A1');
  const a2 = await worksheet.getValue('A2');
  assert(a1 === 21, `expected A1=21, got ${String(a1)}`);
  assert(a2 === 42, `expected A2=42, got ${String(a2)}`);

  const snapshot = await workbook.getWorkbookSnapshot();
  assert(Array.isArray(snapshot.sheets), 'workbook snapshot should expose sheets');

  workbook.dispose();
}

const packedImportResult: DocumentImportResult | undefined = undefined;
assert(packedImportResult === undefined, 'document import result type should be importable');
void createWorkbook;
void exerciseWorkbookTypes;

console.log('PASS: kernel fixture');
