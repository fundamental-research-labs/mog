mod emit_support;

use bridge_ts::emit::*;
use bridge_ts::types::*;
use emit_support::{make_kv_store_api, make_kv_utils_api};

#[test]
fn snake_case_conversion() {
    assert_eq!(to_snake_case("KvStore"), "kv_store");
    assert_eq!(to_snake_case("KvUtils"), "kv_utils");
    assert_eq!(to_snake_case("MyEngine"), "my_engine");
}

#[test]
fn camel_case_conversion() {
    assert_eq!(to_camel_case("store_id"), "storeId");
    assert_eq!(to_camel_case("validate_key"), "validateKey");
    assert_eq!(to_camel_case("hash_key"), "hashKey");
    assert_eq!(to_camel_case("key"), "key");
    assert_eq!(to_camel_case("get_by_id"), "getById");
    assert_eq!(to_camel_case("max_length"), "maxLength");
    assert_eq!(to_camel_case("list_keys"), "listKeys");
    // Leading underscore stripped (Rust's "unused" convention)
    assert_eq!(to_camel_case("_sheet_id"), "sheetId");
    assert_eq!(to_camel_case("_style_name"), "styleName");
}

#[test]
fn emit_stateless_service() {
    let api = make_kv_utils_api();
    let ts = emit_api(&api, None);

    // Factory function
    assert!(ts.contains("export function createKvUtilsClient(transport: BridgeTransport)"));

    // Methods use camelCase
    assert!(ts.contains("validateKey(key: string, maxLength: number): Promise<void>"));
    assert!(ts.contains("hashKey(key: string): Promise<number>"));
    assert!(ts.contains("isValidJson(value: string): Promise<boolean>"));

    // Command names use snake_case
    assert!(ts.contains("'kv_utils_validate_key'"));
    assert!(ts.contains("'kv_utils_hash_key'"));
    assert!(ts.contains("'kv_utils_is_valid_json'"));

    // Interface
    assert!(ts.contains("export interface KvUtilsClient"));

    // No destroy for stateless
    assert!(!ts.contains("destroy"));
}

#[test]
fn emit_stateful_service() {
    let api = make_kv_store_api();
    let ts = emit_api(&api, None);

    // Factory
    assert!(ts.contains("export function createKvStoreClient(transport: BridgeTransport)"));

    // Lifecycle create: key param comes first
    assert!(ts.contains("new(storeId: string, config: KvConfig): Promise<void>"));

    // Read method: key param first
    assert!(ts.contains("get(storeId: string, key: string): Promise<string>"));

    // Write method: key param first
    assert!(ts.contains("set(storeId: string, key: string, value: string): Promise<void>"));

    // Parse param: id is string on wire
    assert!(ts.contains("getById(storeId: string, id: string): Promise<string>"));

    // No-param methods still get key
    assert!(ts.contains("listKeys(storeId: string): Promise<string[]>"));

    // Auto-generated destroy
    assert!(ts.contains("destroy(storeId: string): Promise<void>"));
    assert!(ts.contains("'kv_store_destroy'"));

    // Interface
    assert!(ts.contains("export interface KvStoreClient"));
}

#[test]
fn emit_command_names_use_snake() {
    let api = make_kv_store_api();
    let ts = emit_api(&api, None);

    assert!(ts.contains("'kv_store_new'"));
    assert!(ts.contains("'kv_store_get'"));
    assert!(ts.contains("'kv_store_set'"));
    assert!(ts.contains("'kv_store_get_by_id'"));
    assert!(ts.contains("'kv_store_list_keys'"));
    assert!(ts.contains("'kv_store_stats'"));
}

#[test]
fn emit_args_object() {
    let api = make_kv_store_api();
    let ts = emit_api(&api, None);

    // Read method should pass camelCase keys
    assert!(ts.contains("{ storeId, key }"));

    // Empty params method should still pass camelCase key
    assert!(ts.contains("{ storeId }"));
}

#[test]
fn emit_import_header() {
    let api = make_kv_utils_api();
    let ts = emit_api(&api, None);
    assert!(ts.contains("import type { BridgeTransport } from '@rust-bridge/client';"));
}

#[test]
fn fn_prefix_overrides_command_names() {
    let api = TsApi {
        services: vec![TsService {
            rust_name: "YrsComputeEngine".into(),
            key: Some(ServiceKey {
                param_name: "doc_id".into(),
            }),
            fn_prefix: Some("compute".into()),
            methods: vec![TsMethod {
                rust_name: "set_cell".into(),
                access: MethodAccess::Write,
                params: vec![TsParam {
                    rust_name: "input".into(),
                    ts_type: TsType::String,
                    is_parse: false,
                }],
                return_type: TsType::Named("RecalcResult".into()),
                is_fallible: true,
                skip_platforms: vec![],
            }],
        }],
    };
    let ts = emit_api(&api, None);
    assert!(ts.contains("'compute_set_cell'"), "should use fn_prefix");
    assert!(
        !ts.contains("yrs_compute_engine"),
        "should NOT use type_snake"
    );
    assert!(
        ts.contains("'compute_destroy'"),
        "destroy should use fn_prefix too"
    );
}

#[test]
fn fn_prefix_empty_gives_bare_method_name() {
    let api = TsApi {
        services: vec![TsService {
            rust_name: "PivotBridge".into(),
            key: None,
            fn_prefix: Some("".into()),
            methods: vec![TsMethod {
                rust_name: "pivot_compute".into(),
                access: MethodAccess::Pure,
                params: vec![],
                return_type: TsType::Named("PivotResult".into()),
                is_fallible: true,
                skip_platforms: vec![],
            }],
        }],
    };
    let ts = emit_api(&api, None);
    assert!(
        ts.contains("'pivot_compute'"),
        "empty prefix = bare method name"
    );
    assert!(
        !ts.contains("pivot_bridge_"),
        "should NOT use type_snake prefix"
    );
}

#[test]
fn fn_prefix_none_uses_type_snake_default() {
    let api = TsApi {
        services: vec![TsService {
            rust_name: "KvUtils".into(),
            key: None,
            fn_prefix: None,
            methods: vec![TsMethod {
                rust_name: "hash_key".into(),
                access: MethodAccess::Pure,
                params: vec![],
                return_type: TsType::Number,
                is_fallible: false,
                skip_platforms: vec![],
            }],
        }],
    };
    let ts = emit_api(&api, None);
    assert!(
        ts.contains("'kv_utils_hash_key'"),
        "None = default type_snake"
    );
}
