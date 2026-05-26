/**
 * Re-export shim. Source lives in @mog/types-objects
 * (types/objects/src/objects/floating-object-manager.ts).
 *
 * Tier-1 contract: IFloatingObjectManager uses only
 * types-objects types, and types-rendering (Tier 2 coordinator-interfaces)
 * needs to reference it without routing through types-api (Tier 2), which
 * would form a rendering ↔ api cycle.
 *
 */
export type * from '@mog/types-objects/objects/floating-object-manager';
