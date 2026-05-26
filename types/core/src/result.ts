/**
 * Result — Typed success/failure union.
 *
 * A lightweight discriminated union for operations that can fail.
 * Prefer over exceptions for expected failures (parsing, validation, etc.).
 *
 * @example
 *   function parse(input: string): Result<AST, ParseError> {
 *     if (invalid) return err({ message: '...' });
 *     return ok(ast);
 *   }
 *
 *   const r = parse(src);
 *   if (r.ok) use(r.value); else report(r.error);
 */

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
