export type * from '@mog/types-api/api/mutation-receipt';
import type {
  FloatingObjectMutationReceipt,
  FloatingObjectReceipt,
  FloatingObjectRemoveReceipt,
  MutationReceipt,
} from '@mog/types-api/api/mutation-receipt';

export function isFloatingObjectReceipt(
  receipt: MutationReceipt,
): receipt is FloatingObjectReceipt {
  return 'domain' in receipt && receipt.domain === 'floatingObject';
}

export function isFloatingObjectMutationReceipt(
  receipt: MutationReceipt,
): receipt is FloatingObjectMutationReceipt {
  return (
    isFloatingObjectReceipt(receipt) && (receipt.action === 'create' || receipt.action === 'update')
  );
}

export function isFloatingObjectRemoveReceipt(
  receipt: MutationReceipt,
): receipt is FloatingObjectRemoveReceipt {
  return isFloatingObjectReceipt(receipt) && receipt.action === 'remove';
}
