/**
 * WorkbookPropertiesImpl -- Document properties sub-API implementation.
 *
 * Delegates to the generic workbook setting key-value bridge
 * (`getWorkbookSetting('documentProperties')` / `setWorkbookSetting(...)`)
 * to persist document properties.
 */
import type { DocumentProperties, WorkbookProperties } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';

/** Storage key used by the generic workbook settings bridge. */
const DOC_PROPS_KEY = 'documentProperties';

export class WorkbookPropertiesImpl implements WorkbookProperties {
  constructor(private readonly ctx: DocumentContext) {}

  async getDocumentProperties(): Promise<DocumentProperties> {
    const raw = await this.ctx.computeBridge.getWorkbookSetting(DOC_PROPS_KEY);
    if (raw && typeof raw === 'object') {
      return raw as DocumentProperties;
    }
    return {};
  }

  async setDocumentProperties(props: Partial<DocumentProperties>): Promise<void> {
    const current = await this.getDocumentProperties();
    const merged: DocumentProperties = { ...current, ...props };
    await this.ctx.computeBridge.setWorkbookSetting(DOC_PROPS_KEY, merged);
  }

  async getCustomProperty(key: string): Promise<string | undefined> {
    const props = await this.getDocumentProperties();
    const custom = (props as DocumentPropertiesInternal).custom;
    if (!Array.isArray(custom)) return undefined;
    const entry = custom.find(
      (e: [string, string] | { key: string; value: string }) =>
        (Array.isArray(e) ? e[0] : e.key) === key,
    );
    if (!entry) return undefined;
    return Array.isArray(entry) ? entry[1] : entry.value;
  }

  async setCustomProperty(key: string, value: string): Promise<void> {
    const props = await this.getDocumentProperties();
    const internal = props as DocumentPropertiesInternal;
    const custom = normalizeCustom(internal.custom);
    const idx = custom.findIndex((e) => e.key === key);
    if (idx >= 0) {
      custom[idx].value = value;
    } else {
      custom.push({ key, value });
    }
    await this.ctx.computeBridge.setWorkbookSetting(DOC_PROPS_KEY, {
      ...props,
      custom,
    });
  }

  async removeCustomProperty(key: string): Promise<void> {
    const props = await this.getDocumentProperties();
    const internal = props as DocumentPropertiesInternal;
    const custom = normalizeCustom(internal.custom);
    const filtered = custom.filter((e) => e.key !== key);
    await this.ctx.computeBridge.setWorkbookSetting(DOC_PROPS_KEY, {
      ...props,
      custom: filtered,
    });
  }

  async listCustomProperties(): Promise<Array<{ key: string; value: string }>> {
    const props = await this.getDocumentProperties();
    const internal = props as DocumentPropertiesInternal;
    return normalizeCustom(internal.custom);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * The Rust side stores custom properties as `Vec<(String, String)>`, which
 * serializes as `[["key","val"], ...]`. Normalize both tuple and object forms
 * to `{ key, value }[]` for consistency.
 */
interface DocumentPropertiesInternal extends DocumentProperties {
  custom?: Array<[string, string] | { key: string; value: string }>;
}

function normalizeCustom(
  custom: Array<[string, string] | { key: string; value: string }> | undefined,
): Array<{ key: string; value: string }> {
  if (!Array.isArray(custom)) return [];
  return custom.map((e) => (Array.isArray(e) ? { key: e[0], value: e[1] } : e));
}
