/**
 * Stable sheet identifier.
 *
 * This lives outside core.ts so lower-level cell identity types can refer to a
 * sheet without importing the full core surface.
 */
declare const __sheetId: unique symbol;
export type SheetId = string & { readonly [__sheetId]: true };

/** Construct a branded SheetId from a raw string. */
export function sheetId(id: string): SheetId {
  return id as SheetId;
}
