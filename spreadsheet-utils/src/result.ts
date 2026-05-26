/**
 * Result — Typed success/failure factory functions.
 *
 * Runtime ok() and err() factories extracted from @mog-sdk/contracts/core.
 * The Result<T, E> type remains in @mog-sdk/contracts/core.
 */

import type { Result } from '@mog-sdk/contracts/core';

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
