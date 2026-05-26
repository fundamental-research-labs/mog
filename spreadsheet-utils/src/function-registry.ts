/**
 * Function Registry -- Lightweight metadata registry for Excel functions.
 *
 * Provides function names, categories, descriptions, and argument metadata
 * for UI features (autocomplete, tooltips, function dialogs).
 *
 * This is a metadata-only registry -- no evaluation code. Evaluation is
 * handled by the Rust compute-core (via ComputeBridge).
 *
 * Types (FunctionCategory, FunctionArgumentType, FunctionArgument, FunctionMetadata)
 * remain in @mog-sdk/contracts/utils/function-registry.
 *
 */

import type { FunctionMetadata } from '@mog-sdk/contracts/utils/function-registry';

export class FunctionRegistry {
  private functions = new Map<string, FunctionMetadata>();

  register(metadata: FunctionMetadata): void {
    this.functions.set(metadata.name.toUpperCase(), metadata);
  }

  registerMany(functions: FunctionMetadata[]): void {
    for (const fn of functions) {
      this.register(fn);
    }
  }

  getMetadata(name: string): FunctionMetadata | undefined {
    return this.functions.get(name.toUpperCase());
  }

  has(name: string): boolean {
    return this.functions.has(name.toUpperCase());
  }

  getAllNames(): string[] {
    return Array.from(this.functions.keys());
  }

  getAllMetadata(): FunctionMetadata[] {
    return Array.from(this.functions.values());
  }

  getByCategory(category: string): FunctionMetadata[] {
    return Array.from(this.functions.values()).filter((fn) => fn.category === category);
  }

  count(): number {
    return this.functions.size;
  }
}

/** Global function metadata registry for UI features. */
export const globalRegistry = new FunctionRegistry();
