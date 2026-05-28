mod emit_support;

use bridge_ts::emit::*;
use bridge_ts::types::*;
use emit_support::{make_kv_store_api, make_kv_utils_api};

#[test]
fn emit_type_defs_with_imports() {
    let defs = vec![TsTypeDef::Interface(TsInterface {
        name: "Foo".into(),
        fields: vec![
            TsField {
                ts_name: "value".into(),
                ts_type: TsType::Named("CellValue".into()),
                optional: false,
            },
            TsField {
                ts_name: "data".into(),
                ts_type: TsType::Named("unknown".into()),
                optional: true,
            },
        ],
    })];
    let config = ImportConfig {
        groups: vec![ImportGroup {
            from: "./bridge".into(),
            types: vec![TypeImport {
                local_name: "CellValue".into(),
                imported_name: Some("ExternalCellValue".into()),
            }],
        }],
    };
    let ts = emit_type_defs(&defs, Some(&config));
    assert!(
        ts.contains("import type { ExternalCellValue as CellValue } from './bridge';"),
        "should emit import statement for external types"
    );
    // unknown should NOT appear in imports
    assert!(
        !ts.contains("import type { unknown"),
        "unknown should not be imported"
    );
    // Should NOT have the comment-style external types
    assert!(
        !ts.contains("// External types:"),
        "should not have comment when imports are provided"
    );
}

#[test]
#[should_panic(expected = "not mapped in ImportConfig")]
fn emit_type_defs_panics_on_unmapped_type() {
    let defs = vec![TsTypeDef::Interface(TsInterface {
        name: "Foo".into(),
        fields: vec![TsField {
            ts_name: "bar".into(),
            ts_type: TsType::Named("ExternalThing".into()),
            optional: false,
        }],
    })];
    let config = ImportConfig { groups: vec![] };
    emit_type_defs(&defs, Some(&config)); // should panic
}

// ─── Import Config Tests ────────────────────────────────────────────────

#[test]
fn emit_api_none_imports_unchanged() {
    // Backward compat: None imports produces same output as before
    let api = make_kv_utils_api();
    let ts = emit_api(&api, None);
    assert!(ts.contains("import type { BridgeTransport } from '@rust-bridge/client';"));
    assert!(ts.contains("export function createKvUtilsClient"));
    // Just verify it works and doesn't crash
    assert!(ts.contains("hashKey(key: string): Promise<number>"));
}

#[test]
fn emit_api_with_imports() {
    let api = make_kv_store_api();
    let config = ImportConfig {
        groups: vec![ImportGroup {
            from: "./types".into(),
            types: vec![
                TypeImport {
                    local_name: "StoreStats".into(),
                    imported_name: None,
                },
                TypeImport {
                    local_name: "KvConfig".into(),
                    imported_name: None,
                },
            ],
        }],
    };
    let ts = emit_api(&api, Some(&config));
    assert!(ts.contains("import type { StoreStats, KvConfig } from './types';"));
}

#[test]
fn emit_api_with_alias_imports() {
    let api = TsApi {
        services: vec![TsService {
            rust_name: "Foo".into(),
            key: None,
            fn_prefix: None,
            methods: vec![TsMethod {
                rust_name: "get_value".into(),
                access: MethodAccess::Pure,
                params: vec![],
                return_type: TsType::Named("CellValue".into()),
                is_fallible: false,
                skip_platforms: vec![],
            }],
        }],
    };
    let config = ImportConfig {
        groups: vec![ImportGroup {
            from: "./bridge".into(),
            types: vec![TypeImport {
                local_name: "CellValue".into(),
                imported_name: Some("ExternalCellValue".into()),
            }],
        }],
    };
    let ts = emit_api(&api, Some(&config));
    assert!(ts.contains("import type { ExternalCellValue as CellValue } from './bridge';"));
}

#[test]
#[should_panic(expected = "not mapped in ImportConfig")]
fn emit_api_panics_on_unmapped_type() {
    let api = make_kv_store_api(); // references StoreStats and KvConfig
    let config = ImportConfig {
        groups: vec![], // empty = no mappings
    };
    emit_api(&api, Some(&config)); // should panic
}

#[test]
fn emit_api_skips_unknown_type() {
    // "unknown" from serde_json::Value should not require an import mapping
    let api = TsApi {
        services: vec![TsService {
            rust_name: "JsonSvc".into(),
            key: None,
            fn_prefix: None,
            methods: vec![TsMethod {
                rust_name: "get_raw".into(),
                access: MethodAccess::Pure,
                params: vec![],
                return_type: TsType::Named("unknown".into()),
                is_fallible: false,
                skip_platforms: vec![],
            }],
        }],
    };
    let config = ImportConfig { groups: vec![] };
    let ts = emit_api(&api, Some(&config)); // should NOT panic
    assert!(ts.contains("unknown")); // the type is still emitted
}

#[test]
fn emit_api_unused_import_group_omitted() {
    let api = TsApi {
        services: vec![TsService {
            rust_name: "Foo".into(),
            key: None,
            fn_prefix: None,
            methods: vec![TsMethod {
                rust_name: "bar".into(),
                access: MethodAccess::Pure,
                params: vec![],
                return_type: TsType::Void,
                is_fallible: false,
                skip_platforms: vec![],
            }],
        }],
    };
    let config = ImportConfig {
        groups: vec![ImportGroup {
            from: "./unused".into(),
            types: vec![TypeImport {
                local_name: "Unused".into(),
                imported_name: None,
            }],
        }],
    };
    let ts = emit_api(&api, Some(&config));
    // No methods reference "Unused", so the import line should be omitted
    assert!(!ts.contains("./unused"));
}

#[test]
fn collect_named_from_api_basic() {
    let api = make_kv_store_api();
    let names = collect_named_from_api(&api);
    assert!(names.contains("StoreStats"));
    assert!(names.contains("KvConfig"));
    assert!(!names.contains("unknown")); // filtered
}
