import { expect } from '@jest/globals';
import type { VersionHead, Workbook } from '@mog-sdk/contracts/api';

import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { DOCUMENT_SCOPE } from './version-checkout-preconditions-helpers-constants';
import type {
  ProviderHeadProjection,
  TestVersionStoreProvider,
} from './version-checkout-preconditions-helpers-types';

export async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected public version head: ${result.error.code}`);
  return result.value;
}

export async function expectHeadUnchanged(wb: Workbook, before: VersionHead): Promise<void> {
  const after = await expectHead(wb);
  expect(headProjection(after)).toEqual(headProjection(before));
}

export async function expectProviderHead(
  provider: TestVersionStoreProvider,
  graphId: string,
): Promise<ProviderHeadProjection> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));
  const result = await graph.readHead();
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph head read success: ${result.diagnostics[0]?.code}`);
  }
  return {
    id: result.head.id,
    refName: result.head.refName,
    resolvedFrom: result.head.resolvedFrom,
    refRevision: result.head.refRevision,
  };
}

export async function expectProviderHeadUnchanged(
  provider: TestVersionStoreProvider,
  graphId: string,
  before: ProviderHeadProjection,
): Promise<void> {
  await expect(expectProviderHead(provider, graphId)).resolves.toEqual(before);
}

export function expectPublicDiagnosticsNotToLeak(
  result: unknown,
  forbidden: readonly string[],
): void {
  const serialized = JSON.stringify(result);
  for (const value of forbidden) {
    expect(serialized).not.toContain(value);
  }
}

function headProjection(head: VersionHead) {
  return {
    id: head.id,
    refName: head.refName,
    resolvedFrom: head.resolvedFrom,
    refRevision: head.refRevision,
  };
}
