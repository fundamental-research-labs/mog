/**
 * prepareHostBackedDocument — narrow trusted-adapter entry point.
 *
 * Validates the host context via `validateKernelHostContextForDocument` and
 * returns the validated `KernelDocumentLifecycleInput`. The caller (trusted
 * adapter) then passes this input to `DocumentLifecycleSystem` with
 * `kind: 'host-backed'`.
 *
 * This function does NOT instantiate `DocumentLifecycleSystem` itself — that
 * remains kernel-internal.
 */

import type { KernelHostContext } from '@mog-sdk/types-host/kernel';
import type { HostKernelAdapterBindings } from '@mog-sdk/types-host/bindings';
import type { KernelDocumentLifecycleInput } from '@mog-sdk/types-host/kernel';
import { validateKernelHostContextForDocument } from './validate';

export function prepareHostBackedDocument(
  host: KernelHostContext,
  bindings: HostKernelAdapterBindings,
): KernelDocumentLifecycleInput {
  return validateKernelHostContextForDocument(host, bindings);
}
