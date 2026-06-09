import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { WriteGate } from '../../document/write-gate';
import type { MutationResult } from './compute-types.gen';

export type MutationTuple = [Uint8Array, MutationResult];

export type DirectEditPosition = { sheetId: string; row: number; col: number };

interface PublicWriteMaterializationContext {
  awaitMaterialized?: (scope?: SheetId | 'allSheets') => Promise<void>;
}

export async function admitPublicMutation(
  ctx: IKernelContext,
  writeGate: WriteGate | null,
  ensureInitialized: () => void,
  operation: string,
): Promise<void> {
  ensureInitialized();
  writeGate?.assertWritable(operation);
  await (ctx as IKernelContext & PublicWriteMaterializationContext).awaitMaterialized?.('allSheets');
  writeGate?.assertWritable(operation);
}

export function runSystemMutation<T>(writeGate: WriteGate | null, run: () => Promise<T>): Promise<T> {
  return writeGate ? writeGate.withBypass(run) : run();
}
