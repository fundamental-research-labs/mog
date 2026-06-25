import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { BRIDGE_METHOD_KIND, type BridgeMethodKind } from '../manifest.gen';
import { classifyWriteOperation, type OperationInvocationKind } from '../operation-classification';
import { REQUIRED_STRUCTURAL_SESSION_WRITE_OPERATIONS } from '../version-operation-classification.validation-fixture';

type BridgeInventoryAccess = 'write' | 'lifecycle';

interface BridgeWriteInventoryEntry {
  readonly source: string;
  readonly wrapper: string;
  readonly command: string;
  readonly method?: string;
  readonly access?: BridgeInventoryAccess;
}

interface BridgeWriteInventory {
  readonly schemaVersion: string;
  readonly entries: readonly BridgeWriteInventoryEntry[];
}

interface OperationClassificationRegistry {
  readonly schemaVersion: string;
  readonly runtimeRegistry: string;
  readonly coveredInventory: string;
  readonly requiredRepresentativeClasses: readonly Array<{
    readonly class: string;
    readonly command: string;
    readonly capturePolicy: string;
    readonly writeAdmissionMode: string;
  }>;
}

interface GeneratedBridgeWriteOperation {
  readonly method: string;
  readonly access: BridgeInventoryAccess;
  readonly wrapper: string;
  readonly command: string;
}

type GeneratedBridgeInventoryEntry = BridgeWriteInventoryEntry & {
  readonly source: 'generated-bridge';
  readonly method: string;
  readonly access: BridgeInventoryAccess;
};

const WRITE_METHOD_KINDS = new Set<BridgeMethodKind>(['write', 'lifecycle']);
const GENERATED_BRIDGE_OPERATION_WRAPPERS = new Set([
  'mutatePublic',
  'mutatePublicResult',
  'mutatePublicUiState',
  'mutateSystem',
  'mutateSystemResult',
  'query',
]);

function repoRoot(): string {
  return process.cwd().endsWith('/kernel') ? resolve(process.cwd(), '..') : process.cwd();
}

function readJson<T>(repoRelativePath: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot(), repoRelativePath), 'utf8')) as T;
}

function invocationFromWrapper(wrapper: string): OperationInvocationKind | undefined {
  if (wrapper === 'mutateSystem' || wrapper === 'mutateSystemResult') return 'system-mutation';
  if (wrapper === 'mutatePublicUiState') return 'public-ui-state';
  if (wrapper === 'direct-compute-api') return 'direct-compute-api';
  if (wrapper === 'transport.call') return 'lifecycle';
  return undefined;
}

function findGeneratedBridgeClass(sourceFile: ts.SourceFile): ts.ClassDeclaration {
  let generatedBridgeClass: ts.ClassDeclaration | undefined;

  sourceFile.forEachChild((node) => {
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === 'GeneratedBridgeBase' &&
      !generatedBridgeClass
    ) {
      generatedBridgeClass = node;
    }
  });

  if (!generatedBridgeClass) {
    throw new Error('Unable to find GeneratedBridgeBase in compute-bridge.gen.ts');
  }
  return generatedBridgeClass;
}

function propertyAccessName(expression: ts.Expression): string | null {
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : null;
}

function stringLiteralArg(call: ts.CallExpression, index: number): string | null {
  const arg = call.arguments[index];
  return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

function transportCommandArg(node: ts.Node): string | null {
  let command: string | null = null;

  function visit(child: ts.Node): void {
    if (command) return;
    if (
      ts.isCallExpression(child) &&
      propertyAccessName(child.expression) === 'call' &&
      stringLiteralArg(child, 0)
    ) {
      command = stringLiteralArg(child, 0);
      return;
    }
    ts.forEachChild(child, visit);
  }

  ts.forEachChild(node, visit);
  return command;
}

function wrapperCommandArg(call: ts.CallExpression): string | null {
  return stringLiteralArg(call, 0) ?? transportCommandArg(call);
}

function collectWrapperCalls(method: ts.MethodDeclaration): Array<{
  readonly wrapper: string;
  readonly command: string | null;
}> {
  const calls: Array<{ readonly wrapper: string; readonly command: string | null }> = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const wrapper = propertyAccessName(node.expression);
      if (wrapper && GENERATED_BRIDGE_OPERATION_WRAPPERS.has(wrapper)) {
        calls.push({ wrapper, command: wrapperCommandArg(node) });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(method);
  return calls;
}

function extractGeneratedBridgeWriteOperations(): readonly GeneratedBridgeWriteOperation[] {
  const bridgePath = resolve(repoRoot(), 'kernel/src/bridges/compute/compute-bridge.gen.ts');
  const source = readFileSync(bridgePath, 'utf8');
  const sourceFile = ts.createSourceFile(bridgePath, source, ts.ScriptTarget.Latest, true);
  const generatedBridgeClass = findGeneratedBridgeClass(sourceFile);
  const manifestMethods = new Set(Object.keys(BRIDGE_METHOD_KIND));
  const classMethods = new Set<string>();
  const operations: GeneratedBridgeWriteOperation[] = [];

  for (const member of generatedBridgeClass.members) {
    if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;

    const method = member.name.text;
    classMethods.add(method);
    const wrapperCalls = collectWrapperCalls(member);
    const mutationWrapperCalls = wrapperCalls.filter((call) => call.wrapper !== 'query');
    const access = BRIDGE_METHOD_KIND[method] as BridgeMethodKind | undefined;

    if (!access && mutationWrapperCalls.length) {
      throw new Error(`Generated mutation method '${method}' is missing from BRIDGE_METHOD_KIND.`);
    }
    if (!access) continue;

    if (!WRITE_METHOD_KINDS.has(access) && mutationWrapperCalls.length) {
      throw new Error(
        `Generated mutation method '${method}' is marked '${access}' in BRIDGE_METHOD_KIND.`,
      );
    }
    if (!WRITE_METHOD_KINDS.has(access)) {
      continue;
    }

    if (wrapperCalls.length !== 1 || !wrapperCalls[0].command) {
      throw new Error(`Expected generated write method '${method}' to have one bridge wrapper.`);
    }

    operations.push({
      method,
      access,
      wrapper: wrapperCalls[0].wrapper,
      command: wrapperCalls[0].command,
    });
  }

  const missingFromClass = Array.from(manifestMethods)
    .filter((method) => !classMethods.has(method))
    .sort();
  if (missingFromClass.length) {
    throw new Error(
      `BRIDGE_METHOD_KIND names methods not present on GeneratedBridgeBase: ${missingFromClass.join(
        ', ',
      )}`,
    );
  }

  return operations.sort((a, b) => a.method.localeCompare(b.method));
}

function generatedInventoryEntries(
  inventory: BridgeWriteInventory,
): readonly GeneratedBridgeInventoryEntry[] {
  return inventory.entries.filter(
    (entry): entry is GeneratedBridgeInventoryEntry =>
      entry.source === 'generated-bridge' && !!entry.method && !!entry.access,
  );
}

describe('VC-02 operation classification inventory', () => {
  it('keeps generated bridge writes and lifecycle methods in the baseline inventory', () => {
    const inventory = readJson<BridgeWriteInventory>(
      'dev/version-control/inventory/compute-bridge-write-inventory.json',
    );
    const generatedWrites = extractGeneratedBridgeWriteOperations();
    const inventoryByMethod = new Map(
      generatedInventoryEntries(inventory).map((entry) => [entry.method, entry]),
    );
    const generatedByMethod = new Map(generatedWrites.map((entry) => [entry.method, entry]));

    const missingFromInventory = generatedWrites.filter(
      (operation) => !inventoryByMethod.has(operation.method),
    );
    const staleInventoryEntries = generatedInventoryEntries(inventory).filter(
      (entry) => !generatedByMethod.has(entry.method),
    );
    const mismatchedInventoryEntries = generatedWrites
      .map((operation) => ({
        operation,
        inventory: inventoryByMethod.get(operation.method),
      }))
      .filter(
        ({ operation, inventory }) =>
          inventory &&
          (inventory.access !== operation.access ||
            inventory.wrapper !== operation.wrapper ||
            inventory.command !== operation.command),
      );
    const unclassifiedWrites = generatedWrites.filter(
      (operation) =>
        !classifyWriteOperation(operation.command, invocationFromWrapper(operation.wrapper)),
    );

    expect(missingFromInventory).toEqual([]);
    expect(staleInventoryEntries).toEqual([]);
    expect(mismatchedInventoryEntries).toEqual([]);
    expect(unclassifiedWrites).toEqual([]);
  });

  it('keeps structural and session mutators explicitly covered', () => {
    const inventory = readJson<BridgeWriteInventory>(
      'dev/version-control/inventory/compute-bridge-write-inventory.json',
    );

    const missingRequiredOperations = REQUIRED_STRUCTURAL_SESSION_WRITE_OPERATIONS.filter(
      (required) =>
        !inventory.entries.some(
          (entry) =>
            entry.source === required.source &&
            entry.wrapper === required.wrapper &&
            entry.command === required.command &&
            entry.method === required.method &&
            entry.access === required.access,
        ),
    );
    const unclassifiedRequiredOperations = REQUIRED_STRUCTURAL_SESSION_WRITE_OPERATIONS.filter(
      (required) =>
        !classifyWriteOperation(required.command, invocationFromWrapper(required.wrapper)),
    );

    expect(missingRequiredOperations).toEqual([]);
    expect(unclassifiedRequiredOperations).toEqual([]);
    expect(classifyWriteOperation('compute_structure_change')).toMatchObject({
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      domainClass: 'authored',
    });
    expect(classifyWriteOperation('compute_register_viewport', 'system-mutation')).toMatchObject({
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
      domainClass: 'transient',
    });
    expect(classifyWriteOperation('compute_unregister_viewport', 'system-mutation')).toMatchObject({
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
      domainClass: 'transient',
    });
    expect(classifyWriteOperation('compute_update_viewport_bounds')).toMatchObject({
      capturePolicy: 'shadowOnly',
      writeAdmissionMode: 'shadowOnly',
      domainClass: 'transient',
    });
    expect(classifyWriteOperation('compute_reset_sheet_viewports')).toMatchObject({
      capturePolicy: 'shadowOnly',
      writeAdmissionMode: 'shadowOnly',
      domainClass: 'transient',
    });
  });

  it('keeps the registry representatives aligned with the runtime classifier', () => {
    const registry = readJson<OperationClassificationRegistry>(
      'dev/version-control/registry/operation-classification-registry.json',
    );

    expect(registry.runtimeRegistry).toBe('kernel/src/bridges/compute/operation-classification.ts');
    expect(registry.coveredInventory).toBe(
      'dev/version-control/inventory/compute-bridge-write-inventory.json',
    );

    const mismatchedRepresentatives = registry.requiredRepresentativeClasses
      .map((representative) => ({
        representative,
        classification: classifyWriteOperation(representative.command),
      }))
      .filter(
        ({ representative, classification }) =>
          !classification ||
          classification.capturePolicy !== representative.capturePolicy ||
          classification.writeAdmissionMode !== representative.writeAdmissionMode,
      );

    expect(mismatchedRepresentatives).toEqual([]);
  });
});
