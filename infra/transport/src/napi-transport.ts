/**
 * NAPI transport — wraps ComputeEngine class instance (.node binary).
 *
 * Used in Node.js environments (headless, testing, server-side).
 * Handles serde serialization differences between WASM and NAPI.
 */
import type { BridgeTransport } from '@rust-bridge/client';
import { createBytesTupleNormalizingTransport } from './bytes-tuple';
import { deepSnakeToCamel, snakeToCamel } from './case-normalize';
import { NAPI_SERDE_PARAM_INDICES } from './command-metadata.gen';
import { TransportError } from './errors';
import { currentTimeAsExcelSerial, RECALC_COMMANDS } from './time-injection';
import type { NapiAddonModule } from './napi-loader';
import type { NapiAddon, NapiComputeEngine, NapiSerdeParamMap } from './types';

/**
 * Named args that are [serde]-tagged string params in the Rust bridge.
 *
 * The generated client preserves param names from the Rust bridge. These
 * names always map to [serde]-tagged params that are strings in TS but
 * need JSON.stringify for napi (they're wrapper types like SheetId/CellId
 * in Rust with custom serde).
 *
 * This set enables automatic detection without a full NapiSerdeParamMap.
 * It covers the most common case (SheetId/CellId as string params).
 * For other [serde] string params, use the explicit serdeParams map.
 */
const NAPI_SERDE_STRING_PARAMS = new Set(['sheetId', 'cellId']);

/**
 * Default serde param map for commands where the name-based heuristic fails.
 *
 * These are commands with [serde]-tagged params that have primitive TS types
 * (string | null) where the heuristic would pass strings through raw instead
 * of JSON.stringify'ing them.
 *
 * Indices are 0-based positional after docId stripping.
 */
export const DEFAULT_NAPI_SERDE_PARAMS: NapiSerdeParamMap = {
  // When a command is listed here, the serdeIndices check is authoritative:
  // listed indices get JSON.stringify, all others pass through as-is.
  // Therefore ALL [serde]-tagged params must be listed, including sheetId/cellId.

  // Stateless bridge helpers with primitive or string-union [serde] params.
  chart_compute_regression: new Set([0, 1, 2, 3]),
  prepare_date_value: new Set([3]),
  prepare_time_value: new Set([3]),
  table_create_table: new Set([2, 3, 4, 5]),
  table_get_totals_formula: new Set([0]),
  table_resolve_structured_ref: new Set([0, 1, 2]),
  table_set_slicer_sort_order: new Set([0, 1]),
  table_set_table_option: new Set([0, 1]),
  table_set_totals_function: new Set([0, 2]),

  // importSheetsFromXlsx(xlsxData, sheetNames, insertPosition)
  // xlsxData (0) is [bytes]; sheetNames (1) and insertPosition (2) are [serde].
  compute_import_sheets_from_xlsx: new Set([1, 2]),

  // protectSheet(sheetId, passwordHash: string | null)
  compute_protect_sheet: new Set([0, 1]),
  // unprotectSheet(sheetId, passwordHash: string | null)
  compute_unprotect_sheet: new Set([0, 1]),

  // setTabColor(sheetId, color: string | null)
  compute_set_tab_color: new Set([0, 1]),
  compute_set_active_scenario: new Set([0]),

  // toggleSlicerItem(sheetId, slicerId, value: CellValue)
  // slicerId (1) is [str]; sheetId (0) and value (2) are [serde]
  compute_toggle_slicer_item: new Set([0, 2]),

  // addComment(sheetId, cellId, text, author, authorId, parentId, commentType)
  // cellId (1), text (2), and author (3) are [str] -- pass through.
  // commentType (6) is the CommentType enum (Excel comment bridge / excel-
  // model-notes-and-threads): TS sends a string ('note' | 'threadedComment')
  // but napi serde deserializer needs JSON-encoded bytes ('"note"').
  compute_add_comment: new Set([0, 4, 5, 6]),

  // addCommentByPosition(sheetId, row, col, text, author, authorId, parentId, commentType)
  // row (1), col (2) are [parse] u32; text (3), author (4) are [str] — pass through.
  // commentType (7) is the CommentType enum — same JSON-encoding requirement
  // as compute_add_comment above.
  compute_add_comment_by_position: new Set([0, 5, 6, 7]),
  compute_set_note_dimensions: new Set([0, 2, 3]),

  // addTableDataRow(tableName: &str, relativeRow: Option<u32>)
  // tableName (0) is [str]; relativeRow (1) is [serde]
  compute_add_table_data_row: new Set([1]),
  // createTableLifecycle(sheetId, requestedName, ..., columns, ..., style)
  // sheetId (0), requestedName (1), columns (6), and style (8) are [serde].
  compute_create_table_lifecycle: new Set([0, 1, 6, 8]),

  // Workbook protection/settings and named-range APIs use Option<String> or
  // string-union enums that are primitive in TS but [serde] in napi.
  compute_protect_workbook: new Set([0, 1]),
  compute_unprotect_workbook: new Set([0]),
  compute_is_workbook_operation_allowed: new Set([0]),
  compute_set_default_table_style_id: new Set([0]),
  compute_set_default_slicer_style: new Set([0]),
  compute_set_default_pivot_table_style: new Set([0]),
  compute_set_custom_setting: new Set([1]),
  compute_get_named_range_by_name: new Set([1]),
  compute_get_named_ranges_by_scope: new Set([0]),
  compute_named_range_exists: new Set([1]),
  compute_validate_named_range_name: new Set([1, 2]),
  compute_resolve_named_range: new Set([1]),
  compute_get_named_range_display_value: new Set([1]),
  compute_get_named_range_typed_value: new Set([1]),
  compute_get_named_range_type: new Set([1]),
  compute_get_named_range_array_values: new Set([1]),
  compute_remove_named_ranges_by_scope: new Set([0]),

  // Misc compute commands with primitive/string-union [serde] params.
  compute_compute_dynamic_filter_serial_range: new Set([0]),
  compute_copy_range: new Set([0, 5, 8]),
  compute_find_cells_by_value: new Set([0, 2, 3, 4, 5]),
  compute_flip_floating_object_typed: new Set([0, 1]),
  compute_remove_hf_image: new Set([0, 1]),
  compute_sign_check_a1: new Set([0, 1, 2]),
  compute_text_to_columns_simple: new Set([0, 7]),

  // Security ops.
  // PolicyId is a transparent Uuid wrapper — typed as `string` on the TS
  // side but `[serde]` on the Rust side, so it must be JSON.stringify'd.
  // Otherwise serde_json::from_str sees a bare UUID like `90e8c8b2-…` and
  // tries to parse it as a number (hitting the `e` as an exponent).
  compute_wb_security_remove_policy: new Set([0]),
  compute_wb_security_update_policy: new Set([0, 1]),
};

function normalizeSerdeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toJSON();
  }
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSerdeValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeSerdeValue(item)]),
    );
  }
  return value;
}

function stringifySerdeValue(value: unknown): string {
  return JSON.stringify(normalizeSerdeValue(value));
}

function getNapiSerdeIndices(
  command: string,
  overrides?: NapiSerdeParamMap,
): Set<number> | undefined {
  const generated = NAPI_SERDE_PARAM_INDICES[command];
  const explicit = overrides?.[command];
  if (!generated && !explicit) return undefined;
  return new Set([...(generated ?? []), ...(explicit ?? [])]);
}

/**
 * Create a BridgeTransport that wraps a ComputeEngine class instance.
 *
 * The engine owns its state directly -- no doc_id threading needed.
 * Method calls go directly on the instance.
 *
 * napi methods are synchronous and take positional parameters, similar to
 * WASM. The key difference is serde handling:
 *
 * - **WASM**: `serde_wasm_bindgen` converts JS objects to Rust types automatically.
 *   Objects are passed through as-is.
 * - **napi**: `[serde]`-tagged params accept JSON strings. Objects must be
 *   `JSON.stringify()`'d before passing. Returns are JSON strings that need
 *   `JSON.parse()`.
 *
 * **Arg serialization strategy**:
 *
 * When `serdeParams` is provided, the transport uses it to determine exactly
 * which positional args need `JSON.stringify()`. This is the most correct
 * approach and handles all edge cases.
 *
 * When `serdeParams` is not provided, the transport uses a heuristic:
 * - `null`/`undefined` -> `JSON.stringify(null)` (serde optional params)
 * - Plain objects -> `JSON.stringify(obj)` (serde structs)
 * - Arrays -> `JSON.stringify(arr)` (serde Vec/slices)
 * - Strings, numbers, booleans -> pass through (str/parse/prim params)
 * - Uint8Array/Buffer -> pass through (bytes params)
 *
 * The heuristic works for the vast majority of commands. It fails for
 * `[serde]` params with primitive TS types (e.g., `Option<&str>` as
 * `string | null`, `Option<u32>` as `number | null`, or string enums).
 * These edge cases require `serdeParams` for correctness.
 *
 * @param engine - A ComputeEngine class instance (created via `new ComputeEngine(snapshotJson)`)
 * @param serdeParams - Optional map of command -> serde param indices.
 *   When provided, args at these indices are always JSON.stringify'd.
 *   When absent, the transport uses a type-based heuristic.
 * @param addon - Optional addon module for dispatching pure/free bridge functions.
 *   Service methods (#[bridge::read], #[bridge::write]) live on the engine instance.
 *   Pure functions (#[bridge::pure]) live on the addon module. When provided, the
 *   transport falls back to the addon for commands not found on the engine.
 */
export function createNapiTransport(
  engine: NapiComputeEngine,
  serdeParams?: NapiSerdeParamMap,
  addon?: NapiAddon,
): BridgeTransport {
  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      // Service methods live on the engine instance (snake_case names);
      // pure/free functions live on the addon module (camelCase names).
      // Try engine first, fall back to addon with camelCase conversion.
      const fn = engine[command] ?? addon?.[snakeToCamel(command)];
      if (!fn) {
        throw new TransportError(
          command,
          `Method "${command}" not found on napi engine${addon ? ' or addon module' : ''}. The native compute binary is likely out of date — rebuild the platform package.`,
        );
      }
      try {
        // Convert named args to positional. The generated client creates args
        // objects with keys in the same order as the Rust function parameters,
        // so Object.values() preserves order.
        //
        // Strip docId: the generated client always sends docId as the first arg
        // (needed for Tauri registry lookup), but napi engine methods don't take
        // it -- the engine instance IS the document.
        const { docId: _docId, ...rest } = args;
        const entries = Object.entries(rest);
        const serdeIndices = getNapiSerdeIndices(command, serdeParams);

        const positionalArgs = entries.map(([key, value], index) => {
          // If we have explicit serde param metadata, use it.
          if (serdeIndices) {
            if (serdeIndices.has(index)) {
              // This param is [serde]-tagged: always JSON.stringify.
              return stringifySerdeValue(value);
            }
            // Not [serde]: pass through as-is (str/parse/prim/bytes).
            return value;
          }

          // Name-based detection: SheetId and CellId params are always
          // [serde]-tagged strings that need JSON.stringify. The generated
          // client uses consistent names: sheetId, cellId.
          if (NAPI_SERDE_STRING_PARAMS.has(key) && typeof value === 'string') {
            return stringifySerdeValue(value);
          }

          // Fallback heuristic: infer from the JS value type.
          // This works correctly for most cases. See doc comment for edge cases.
          if (value === null || value === undefined) {
            // null/undefined -> JSON "null" for optional [serde] params.
            // [str] and [prim] params are never nullable in the generated client.
            return stringifySerdeValue(null);
          }
          if (typeof value === 'object' && !ArrayBuffer.isView(value) && !Array.isArray(value)) {
            // Plain objects -> JSON string for [serde] params
            return stringifySerdeValue(value);
          }
          if (Array.isArray(value)) {
            // Arrays -> JSON string for [serde] params (e.g., Vec<T>)
            return stringifySerdeValue(value);
          }
          // Strings, numbers, booleans, Uint8Array/Buffer -> pass through.
          // This is correct for [str], [parse], [prim], and [bytes] params.
          // It is INCORRECT for [serde] params that are strings (e.g., Rust enums)
          // or numbers (e.g., Option<u32>). Use serdeParams to fix these cases.
          return value;
        });

        // Bind to the correct target: engine for service methods, addon for free functions
        const isEngineFn = !!engine[command];
        const result = fn.call(isEngineFn ? engine : addon, ...positionalArgs);

        // napi serde returns are JSON strings. Parse them back to objects.
        // Primitive returns (numbers, booleans) and Buffer returns pass through.
        if (typeof result === 'string') {
          try {
            // Apply snake_case → camelCase normalization for stale NAPI binaries
            // that were built before #[serde(rename_all = "camelCase")] was added.
            return deepSnakeToCamel(JSON.parse(result)) as T;
          } catch {
            // If JSON.parse fails, it's a plain string return (e.g., version())
            return result as T;
          }
        }
        return result as T;
      } catch (err) {
        throw TransportError.fromCommand(err, command);
      }
    },
  };
}

/**
 * Wrap a napi transport with time injection.
 *
 * Before every recalc-triggering command, calls `compute_set_current_time`
 * on the napi addon module to set NOW() for the Rust compute core. This is the
 * napi equivalent of `createTimeInjectingTransport()` for WASM. The injected
 * serial is computed in the active session's IANA timezone via
 * `getUserTimezone()` so TODAY()/NOW() return the user's calendar today, not
 * the host process's.
 *
 * Note: `compute_set_current_time` is a static free function on the addon module
 * (not a method on the ComputeEngine class), so the addon module is needed.
 *
 * @param inner - The napi transport to wrap
 * @param addon - The napi addon module (for static functions like compute_set_current_time)
 * @param getUserTimezone - Resolves the active session's IANA timezone name
 */
export function createNapiTimeInjectingTransport(
  inner: BridgeTransport,
  addon: NapiAddon,
  getUserTimezone: () => string,
): BridgeTransport {
  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      if (RECALC_COMMANDS.has(command)) {
        addon['compute_set_current_time']?.(currentTimeAsExcelSerial(getUserTimezone()));
      }
      return inner.call<T>(command, args);
    },
  };
}

/**
 * Create a transport for headless napi that handles the lifecycle mismatch:
 * - napi engine is created in constructor (not via compute_init)
 * - napi engine is destroyed by GC/Drop (not via compute_destroy)
 *
 * This transport intercepts compute_init and compute_destroy, delegating
 * everything else to the standard napi time-injecting transport.
 *
 * @param engine - A ComputeEngine class instance (already constructed)
 * @param addon - The napi addon module (for static functions like compute_set_current_time)
 */
export function createHeadlessNapiTransport(
  engine: NapiComputeEngine,
  addon: NapiAddon,
): BridgeTransport {
  // Take the init result from the engine (it was computed during construction)
  const initResultJson = engine.compute_take_init_result?.() as string | null;

  const base = createNapiTransport(engine, DEFAULT_NAPI_SERDE_PARAMS, addon);
  // Headless napi callers (e.g. SDK consumers) supply userTimezone via the
  // workbook factory; the createComputeBridge wiring routes that into the
  // composite path below. This createHeadlessNapiTransport overload is only
  // used by deprecated direct-engine consumers — they do not currently honor
  // userTimezone, so fall back to UTC. New consumers should go through
  // createTransport({ getUserTimezone }) instead.
  const timeInjecting = createNapiTimeInjectingTransport(base, addon, () => 'UTC');
  const normalized = createBytesTupleNormalizingTransport(timeInjecting);

  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      // compute_init: engine already created in constructor — return stored init result
      if (command === 'compute_init') {
        if (initResultJson) {
          return deepSnakeToCamel(JSON.parse(initResultJson)) as T;
        }
        throw new TransportError(
          'compute_init',
          'compute_take_init_result() returned null — engine produced no init result or it was already consumed',
        );
      }

      // compute_destroy: no-op — napi engine cleanup is via GC/Drop
      if (command === 'compute_destroy') {
        return undefined as T;
      }

      return normalized.call<T>(command, args);
    },
  };
}

/**
 * Create a NAPI transport that defers engine creation to the compute_init command.
 * This makes NAPI behave identically to Tauri/WASM from the lifecycle system's
 * perspective: create transport → call compute_init → engine exists.
 *
 * Unlike createHeadlessNapiTransport() (which takes a pre-created engine),
 * this creates the engine lazily when compute_init arrives with the snapshot.
 */
export function createLazyNapiTransport(addon: NapiAddonModule): BridgeTransport {
  let innerTransport: BridgeTransport | null = null;

  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      if (command === 'compute_init') {
        // Create the engine with the snapshot from the init args
        const snapshotJson =
          typeof args.snapshot === 'string' ? args.snapshot : JSON.stringify(args.snapshot);
        const engine = new addon.ComputeEngine(snapshotJson);

        // Reuse the existing createNapiTransport which handles ALL serde
        // complexity: docId stripping, named→positional conversion,
        // NapiSerdeParamMap / heuristic serialization, JSON return parsing,
        // and deepSnakeToCamel normalization.
        innerTransport = createNapiTransport(engine, DEFAULT_NAPI_SERDE_PARAMS, addon);

        // Return the init result (engine computes it during construction)
        const initResultJson = engine.compute_take_init_result?.() as string | null;
        if (initResultJson) {
          return deepSnakeToCamel(JSON.parse(initResultJson)) as T;
        }
        return undefined as T;
      }

      if (command === 'compute_init_from_yrs_state') {
        // Create the engine from raw Yrs state bytes (collaboration join path).
        // This is the NAPI equivalent of compute_init but for engines that fork
        // from an authoritative coordinator's Yrs document state.
        const state = args.state as Buffer;
        if (!addon.ComputeEngine.initFromYrsState) {
          throw new TransportError(command, 'NAPI addon does not support initFromYrsState');
        }
        const engine = addon.ComputeEngine.initFromYrsState(state);

        innerTransport = createNapiTransport(engine, DEFAULT_NAPI_SERDE_PARAMS, addon);

        // initFromYrsState uses takeLifecycleResult instead of compute_take_init_result
        const initResultJson = (engine as any).takeLifecycleResult?.() as string | null;
        if (initResultJson) {
          return deepSnakeToCamel(JSON.parse(initResultJson)) as T;
        }
        return undefined as T;
      }

      if (command === 'compute_destroy') {
        innerTransport = null;
        return undefined as T;
      }

      if (!innerTransport) {
        throw new TransportError(
          command,
          `NAPI transport: compute_init must be called before ${command}`,
        );
      }

      return innerTransport.call<T>(command, args);
    },
  };
}
