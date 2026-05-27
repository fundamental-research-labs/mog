use bridge_ts::emit::*;
use bridge_ts::types::*;

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

fn make_kv_utils_api() -> TsApi {
    TsApi {
        services: vec![TsService {
            rust_name: "KvUtils".into(),
            key: None,
            fn_prefix: None,
            methods: vec![
                TsMethod {
                    rust_name: "validate_key".into(),
                    access: MethodAccess::Pure,
                    params: vec![
                        TsParam {
                            rust_name: "key".into(),
                            ts_type: TsType::String,
                            is_parse: false,
                        },
                        TsParam {
                            rust_name: "max_length".into(),
                            ts_type: TsType::Number,
                            is_parse: false,
                        },
                    ],
                    return_type: TsType::Void,
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                TsMethod {
                    rust_name: "hash_key".into(),
                    access: MethodAccess::Pure,
                    params: vec![TsParam {
                        rust_name: "key".into(),
                        ts_type: TsType::String,
                        is_parse: false,
                    }],
                    return_type: TsType::Number,
                    is_fallible: false,
                    skip_platforms: vec![],
                },
                TsMethod {
                    rust_name: "is_valid_json".into(),
                    access: MethodAccess::Pure,
                    params: vec![TsParam {
                        rust_name: "value".into(),
                        ts_type: TsType::String,
                        is_parse: false,
                    }],
                    return_type: TsType::Boolean,
                    is_fallible: false,
                    skip_platforms: vec![],
                },
            ],
        }],
    }
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

fn make_kv_store_api() -> TsApi {
    TsApi {
        services: vec![TsService {
            rust_name: "KvStore".into(),
            key: Some(ServiceKey {
                param_name: "store_id".into(),
            }),
            fn_prefix: None,
            methods: vec![
                TsMethod {
                    rust_name: "new".into(),
                    access: MethodAccess::LifecycleCreate,
                    params: vec![TsParam {
                        rust_name: "config".into(),
                        ts_type: TsType::Named("KvConfig".into()),
                        is_parse: false,
                    }],
                    return_type: TsType::Void,
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                TsMethod {
                    rust_name: "get".into(),
                    access: MethodAccess::Read,
                    params: vec![TsParam {
                        rust_name: "key".into(),
                        ts_type: TsType::String,
                        is_parse: false,
                    }],
                    return_type: TsType::String,
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                TsMethod {
                    rust_name: "set".into(),
                    access: MethodAccess::Write,
                    params: vec![
                        TsParam {
                            rust_name: "key".into(),
                            ts_type: TsType::String,
                            is_parse: false,
                        },
                        TsParam {
                            rust_name: "value".into(),
                            ts_type: TsType::String,
                            is_parse: false,
                        },
                    ],
                    return_type: TsType::Void,
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                TsMethod {
                    rust_name: "get_by_id".into(),
                    access: MethodAccess::Read,
                    params: vec![TsParam {
                        rust_name: "id".into(),
                        ts_type: TsType::String,
                        is_parse: true,
                    }],
                    return_type: TsType::String,
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                TsMethod {
                    rust_name: "list_keys".into(),
                    access: MethodAccess::Read,
                    params: vec![],
                    return_type: TsType::Array(Box::new(TsType::String)),
                    is_fallible: false,
                    skip_platforms: vec![],
                },
                TsMethod {
                    rust_name: "stats".into(),
                    access: MethodAccess::Read,
                    params: vec![],
                    return_type: TsType::Named("StoreStats".into()),
                    is_fallible: false,
                    skip_platforms: vec![],
                },
            ],
        }],
    }
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

#[test]
fn emit_interface_simple() {
    let iface = TsInterface {
        name: "ColWidth".into(),
        fields: vec![
            TsField {
                ts_name: "col".into(),
                ts_type: TsType::Number,
                optional: false,
            },
            TsField {
                ts_name: "width".into(),
                ts_type: TsType::Number,
                optional: false,
            },
            TsField {
                ts_name: "customWidth".into(),
                ts_type: TsType::Boolean,
                optional: true,
            },
            TsField {
                ts_name: "hidden".into(),
                ts_type: TsType::Boolean,
                optional: true,
            },
        ],
    };
    let ts = emit_interface(&iface);
    assert!(ts.contains("export interface ColWidth {"));
    assert!(ts.contains("  col: number;"));
    assert!(ts.contains("  width: number;"));
    assert!(ts.contains("  customWidth?: boolean;"));
    assert!(ts.contains("  hidden?: boolean;"));
    assert!(ts.ends_with("}\n"));
}

#[test]
fn emit_string_union_basic() {
    let union = TsStringUnion {
        name: "Axis".into(),
        variants: vec!["row".into(), "col".into()],
    };
    let ts = emit_string_union(&union);
    assert_eq!(ts, "export type Axis = \"row\" | \"col\";\n");
}

#[test]
fn emit_tagged_union_external() {
    let union = TsTaggedUnion {
        name: "IdentityFormulaRef".into(),
        tag_style: TagStyle::External,
        variants: vec![
            TsTaggedVariant {
                variant_name: "Cell".into(),
                data_type: TsType::Named("IdentityCellRef".into()),
            },
            TsTaggedVariant {
                variant_name: "Range".into(),
                data_type: TsType::Named("IdentityRangeRef".into()),
            },
        ],
    };
    let ts = emit_tagged_union(&union);
    assert!(ts.contains("export type IdentityFormulaRef =\n"));
    assert!(ts.contains("  | { Cell: IdentityCellRef }\n"));
    assert!(ts.contains("  | { Range: IdentityRangeRef };\n"));
}

#[test]
fn emit_tagged_union_adjacent() {
    let union = TsTaggedUnion {
        name: "CellValue".into(),
        tag_style: TagStyle::Adjacent {
            tag: "type".into(),
            content: "value".into(),
        },
        variants: vec![
            TsTaggedVariant {
                variant_name: "Number".into(),
                data_type: TsType::Number,
            },
            TsTaggedVariant {
                variant_name: "Text".into(),
                data_type: TsType::String,
            },
            TsTaggedVariant {
                variant_name: "Null".into(),
                data_type: TsType::Void,
            },
        ],
    };
    let ts = emit_tagged_union(&union);
    assert!(ts.contains("export type CellValue =\n"));
    assert!(ts.contains("  | { type: \"Number\"; value: number }\n"));
    assert!(ts.contains("  | { type: \"Text\"; value: string }\n"));
    // Unit variant (Void) should omit the content field
    assert!(ts.contains("  | { type: \"Null\" };\n"));
    assert!(!ts.contains("\"Null\"; value"));
}

#[test]
fn emit_tagged_union_adjacent_all_unit() {
    let union = TsTaggedUnion {
        name: "Direction".into(),
        tag_style: TagStyle::Adjacent {
            tag: "kind".into(),
            content: "data".into(),
        },
        variants: vec![
            TsTaggedVariant {
                variant_name: "Up".into(),
                data_type: TsType::Void,
            },
            TsTaggedVariant {
                variant_name: "Down".into(),
                data_type: TsType::Void,
            },
        ],
    };
    let ts = emit_tagged_union(&union);
    assert!(ts.contains("{ kind: \"Up\" }"));
    assert!(ts.contains("{ kind: \"Down\" }"));
    // No content field for any variant
    assert!(!ts.contains("data"));
}

#[test]
fn emit_tagged_union_untagged() {
    let union = TsTaggedUnion {
        name: "Value".into(),
        tag_style: TagStyle::Untagged,
        variants: vec![
            TsTaggedVariant {
                variant_name: "Num".into(),
                data_type: TsType::Number,
            },
            TsTaggedVariant {
                variant_name: "Str".into(),
                data_type: TsType::String,
            },
            TsTaggedVariant {
                variant_name: "Bool".into(),
                data_type: TsType::Boolean,
            },
        ],
    };
    let ts = emit_tagged_union(&union);
    assert_eq!(ts, "export type Value = number | string | boolean;\n");
}

#[test]
fn emit_type_defs_sorted() {
    let defs = vec![
        TsTypeDef::StringUnion(TsStringUnion {
            name: "Zebra".into(),
            variants: vec!["a".into()],
        }),
        TsTypeDef::StringUnion(TsStringUnion {
            name: "Alpha".into(),
            variants: vec!["x".into()],
        }),
    ];
    let ts = emit_type_defs(&defs, None);
    let alpha_pos = ts.find("Alpha").unwrap();
    let zebra_pos = ts.find("Zebra").unwrap();
    assert!(
        alpha_pos < zebra_pos,
        "Alpha should appear before Zebra (alphabetical order)"
    );
}

#[test]
fn emit_type_defs_preamble() {
    let defs = vec![TsTypeDef::Interface(TsInterface {
        name: "Foo".into(),
        fields: vec![TsField {
            ts_name: "bar".into(),
            ts_type: TsType::Named("ExternalThing".into()),
            optional: false,
        }],
    })];
    let ts = emit_type_defs(&defs, None);
    assert!(ts.starts_with("// Auto-generated by bridge-ts. Do not edit.\n"));
    assert!(
        ts.contains("// External types: ExternalThing"),
        "should list external (undefined) Named types"
    );
    assert!(ts.contains("export interface Foo {"));
}

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

#[test]
fn emit_type_alias_string() {
    let ts = emit_type_alias("SheetId", &TsType::String);
    assert_eq!(ts, "export type SheetId = string;\n");
}

#[test]
fn emit_type_alias_number() {
    let ts = emit_type_alias("Score", &TsType::Number);
    assert_eq!(ts, "export type Score = number;\n");
}

#[test]
fn emit_type_def_type_alias() {
    let def = TsTypeDef::TypeAlias {
        name: "CellId".into(),
        target: TsType::String,
    };
    let ts = emit_type_def(&def);
    assert_eq!(ts, "export type CellId = string;\n");
}

// ─── Bridge Emitter Tests ─────────────────────────────────────────────

#[test]
fn classify_pure_method() {
    let method = TsMethod {
        rust_name: "validate".into(),
        access: MethodAccess::Pure,
        params: vec![],
        return_type: TsType::Boolean,
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Pure);
}

#[test]
fn classify_read_method() {
    let method = TsMethod {
        rust_name: "get_settings".into(),
        access: MethodAccess::Read,
        params: vec![],
        return_type: TsType::Named("Settings".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_write_with_binary_mutation() {
    let method = TsMethod {
        rust_name: "set_cell".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Tuple(vec![
            TsType::Uint8Array,
            TsType::Named("MutationResult".into()),
        ]),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Mutate);
}

#[test]
fn classify_write_without_binary_tuple_uses_query() {
    // Write methods returning bare MutationResult (not wrapped in a binary tuple)
    // are classified as Query. All write methods should return (Vec<u8>, MutationResult)
    // tuples; bare MutationResult on a write is a legacy pattern that gets Query treatment.
    let method = TsMethod {
        rust_name: "set_name".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Named("MutationResult".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_write_void_return() {
    let method = TsMethod {
        rust_name: "clear".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Void,
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_write_non_mutation_result_uses_query() {
    // Write methods that return a concrete type other than MutationResult
    // (e.g. IdentityFormula, Uint8Array) should use Query to preserve the type.
    let method = TsMethod {
        rust_name: "to_identity_formula".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Named("IdentityFormula".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_write_uint8array_return_uses_query() {
    // Write methods returning Uint8Array (e.g. get_viewport_binary) should use Query.
    let method = TsMethod {
        rust_name: "get_viewport_binary".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Uint8Array,
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_lifecycle_create_skipped() {
    let method = TsMethod {
        rust_name: "new".into(),
        access: MethodAccess::LifecycleCreate,
        params: vec![],
        return_type: TsType::Void,
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Skip);
}

#[test]
fn classify_skip_ts_bridge() {
    let method = TsMethod {
        rust_name: "internal_op".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Void,
        is_fallible: false,
        skip_platforms: vec!["ts_bridge".into()],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Skip);
}

#[test]
fn classify_skip_ts_bridge_among_others() {
    let method = TsMethod {
        rust_name: "internal_op".into(),
        access: MethodAccess::Read,
        params: vec![],
        return_type: TsType::String,
        is_fallible: false,
        skip_platforms: vec!["wasm".into(), "ts_bridge".into()],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Skip);
}

#[test]
fn is_binary_mutation_return_true_mutation_result() {
    let ty = TsType::Tuple(vec![
        TsType::Uint8Array,
        TsType::Named("MutationResult".into()),
    ]);
    assert!(is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_mutation_metadata() {
    // MutationMetadata has been removed; only MutationResult is recognized.
    let ty = TsType::Tuple(vec![
        TsType::Uint8Array,
        TsType::Named("MutationMetadata".into()),
    ]);
    assert!(!is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_wrong_second() {
    let ty = TsType::Tuple(vec![TsType::Uint8Array, TsType::Named("OtherType".into())]);
    assert!(!is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_wrong_first() {
    let ty = TsType::Tuple(vec![TsType::String, TsType::Named("MutationResult".into())]);
    assert!(!is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_single() {
    let ty = TsType::Named("MutationResult".into());
    assert!(!is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_three_elements() {
    let ty = TsType::Tuple(vec![
        TsType::Uint8Array,
        TsType::Named("MutationResult".into()),
        TsType::Number,
    ]);
    assert!(!is_binary_mutation_return(&ty));
}

fn make_bridge_test_api() -> TsApi {
    TsApi {
        services: vec![TsService {
            rust_name: "ComputeEngine".into(),
            key: Some(ServiceKey {
                param_name: "doc_id".into(),
            }),
            fn_prefix: Some("compute".into()),
            methods: vec![
                // LifecycleCreate → Skip
                TsMethod {
                    rust_name: "new".into(),
                    access: MethodAccess::LifecycleCreate,
                    params: vec![TsParam {
                        rust_name: "config".into(),
                        ts_type: TsType::Named("Config".into()),
                        is_parse: false,
                    }],
                    return_type: TsType::Void,
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                // Write + binary tuple → Mutate
                TsMethod {
                    rust_name: "set_cell".into(),
                    access: MethodAccess::Write,
                    params: vec![
                        TsParam {
                            rust_name: "sheet_id".into(),
                            ts_type: TsType::String,
                            is_parse: false,
                        },
                        TsParam {
                            rust_name: "row".into(),
                            ts_type: TsType::Number,
                            is_parse: false,
                        },
                        TsParam {
                            rust_name: "input".into(),
                            ts_type: TsType::String,
                            is_parse: false,
                        },
                    ],
                    return_type: TsType::Tuple(vec![
                        TsType::Uint8Array,
                        TsType::Named("MutationResult".into()),
                    ]),
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                // Write with binary tuple → Mutate (all write methods now return tuples)
                TsMethod {
                    rust_name: "rename_sheet".into(),
                    access: MethodAccess::Write,
                    params: vec![TsParam {
                        rust_name: "name".into(),
                        ts_type: TsType::String,
                        is_parse: false,
                    }],
                    return_type: TsType::Tuple(vec![
                        TsType::Uint8Array,
                        TsType::Named("MutationResult".into()),
                    ]),
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                // Read → Query
                TsMethod {
                    rust_name: "get_workbook_settings".into(),
                    access: MethodAccess::Read,
                    params: vec![],
                    return_type: TsType::Named("WorkbookSettings".into()),
                    is_fallible: false,
                    skip_platforms: vec![],
                },
                // Pure → direct transport.call, no docId
                TsMethod {
                    rust_name: "schema_validate".into(),
                    access: MethodAccess::Pure,
                    params: vec![
                        TsParam {
                            rust_name: "value".into(),
                            ts_type: TsType::String,
                            is_parse: false,
                        },
                        TsParam {
                            rust_name: "schema".into(),
                            ts_type: TsType::Named("SchemaType".into()),
                            is_parse: false,
                        },
                    ],
                    return_type: TsType::Boolean,
                    is_fallible: false,
                    skip_platforms: vec![],
                },
                // skip(ts_bridge) → Skip
                TsMethod {
                    rust_name: "internal_only".into(),
                    access: MethodAccess::Read,
                    params: vec![],
                    return_type: TsType::String,
                    is_fallible: false,
                    skip_platforms: vec!["ts_bridge".into()],
                },
            ],
        }],
    }
}

#[test]
fn emit_bridge_header() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    assert!(ts.contains("// Auto-generated by bridge-ts. Do not edit."));
    assert!(ts.contains("import type { BridgeTransport } from '@rust-bridge/client';"));
    assert!(ts.contains("import type { ComputeCore } from './compute-core';"));
}

#[test]
fn emit_bridge_interface_present() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    assert!(ts.contains("export interface GeneratedBridgeMethods {"));
}

#[test]
fn emit_bridge_factory_present() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    assert!(ts.contains("export class GeneratedBridgeBase implements GeneratedBridgeMethods {"));
    assert!(ts.contains("readonly core: ComputeCore;"));
    assert!(ts.contains("constructor(core: ComputeCore)"));
}

#[test]
fn emit_bridge_skips_lifecycle() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    // LifecycleCreate "new" should not appear
    assert!(!ts.contains("new(config"));
    assert!(!ts.contains("compute_new"));
}

#[test]
fn emit_bridge_skips_ts_bridge_platform() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    assert!(!ts.contains("internalOnly"));
    assert!(!ts.contains("compute_internal_only"));
}

#[test]
fn emit_bridge_mutate_method() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    // Interface: return type should be unwrapped to MutationResult
    assert!(ts.contains(
        "setCell(sheetId: string, row: number, input: string): Promise<MutationResult>;"
    ));
    // Class: should use this.core.mutate() and inject docId
    assert!(ts.contains("this.core.mutate(this.core.transport.call<[Uint8Array, MutationResult]>('compute_set_cell', { docId: this.core.docId, sheetId, row, input }))"));
}

#[test]
fn emit_bridge_rename_sheet_uses_mutate() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    // Interface: return type should be unwrapped to MutationResult
    assert!(ts.contains("renameSheet(name: string): Promise<MutationResult>;"));
    // Class: should use this.core.mutate() (all write methods use mutate now)
    assert!(ts.contains("this.core.mutate(this.core.transport.call<[Uint8Array, MutationResult]>('compute_rename_sheet', { docId: this.core.docId, name }))"));
}

#[test]
fn emit_bridge_query_method() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    // Interface
    assert!(ts.contains("getWorkbookSettings(): Promise<WorkbookSettings>;"));
    // Class: should use this.core.query()
    assert!(ts.contains("this.core.query(this.core.transport.call<WorkbookSettings>('compute_get_workbook_settings', { docId: this.core.docId }))"));
}

#[test]
fn emit_bridge_pure_method() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    // Interface
    assert!(ts.contains("schemaValidate(value: string, schema: SchemaType): Promise<boolean>;"));
    // Class: bare this.core.transport.call with type param, no docId
    assert!(ts.contains("schemaValidate(value: string, schema: SchemaType): Promise<boolean>"));
    assert!(ts.contains(
        "this.core.transport.call<boolean>('compute_schema_validate', { value, schema })"
    ));
    // Should NOT have this.core.query or this.core.mutate for pure
    assert!(
        !ts.contains("this.core.query(this.core.transport.call<boolean>('compute_schema_validate'")
    );
    assert!(
        !ts.contains(
            "this.core.mutate(this.core.transport.call<boolean>('compute_schema_validate'"
        )
    );
}

#[test]
fn emit_bridge_no_key_param_in_signatures() {
    let api = make_bridge_test_api();
    let ts = emit_bridge(&api, None, None);
    // Interface/factory methods should NOT have docId as a parameter
    assert!(!ts.contains("setCell(docId"));
    assert!(!ts.contains("getWorkbookSettings(docId"));
}

#[test]
fn emit_bridge_with_imports() {
    let api = make_bridge_test_api();
    let config = ImportConfig {
        groups: vec![ImportGroup {
            from: "./types".into(),
            types: vec![
                TypeImport {
                    local_name: "MutationResult".into(),
                    imported_name: None,
                },
                TypeImport {
                    local_name: "WorkbookSettings".into(),
                    imported_name: None,
                },
                TypeImport {
                    local_name: "SchemaType".into(),
                    imported_name: None,
                },
            ],
        }],
    };
    let ts = emit_bridge(&api, Some(&config), None);
    assert!(
        ts.contains("import type { MutationResult, WorkbookSettings, SchemaType } from './types';")
    );
}

#[test]
fn emit_bridge_custom_config() {
    let api = TsApi {
        services: vec![TsService {
            rust_name: "MyEngine".into(),
            key: None,
            fn_prefix: None,
            methods: vec![TsMethod {
                rust_name: "ping".into(),
                access: MethodAccess::Pure,
                params: vec![],
                return_type: TsType::String,
                is_fallible: false,
                skip_platforms: vec![],
            }],
        }],
    };
    let config = BridgeConfig {
        core_import_path: "./my-core".into(),
        core_type_name: "MyCore".into(),
        interface_name: "MyBridgeMethods".into(),
        class_name: "MyBridgeBase".into(),
    };
    let ts = emit_bridge(&api, None, Some(&config));
    assert!(ts.contains("import type { MyCore } from './my-core';"));
    assert!(ts.contains("export interface MyBridgeMethods {"));
    assert!(ts.contains("export class MyBridgeBase implements MyBridgeMethods {"));
}

#[test]
fn emit_bridge_stateless_pure_no_key_injection() {
    // Stateless service (no key) — pure methods should not try to inject any key
    let api = TsApi {
        services: vec![TsService {
            rust_name: "Utils".into(),
            key: None,
            fn_prefix: Some("utils".into()),
            methods: vec![TsMethod {
                rust_name: "hash".into(),
                access: MethodAccess::Pure,
                params: vec![TsParam {
                    rust_name: "input".into(),
                    ts_type: TsType::String,
                    is_parse: false,
                }],
                return_type: TsType::Number,
                is_fallible: false,
                skip_platforms: vec![],
            }],
        }],
    };
    let ts = emit_bridge(&api, None, None);
    assert!(ts.contains("transport.call<number>('utils_hash', { input })"));
    assert!(!ts.contains("core.docId"));
}

#[test]
fn emit_bridge_imports_skip_lifecycle_types() {
    // Config type is only used by lifecycle create method — should not be imported
    let api = TsApi {
        services: vec![TsService {
            rust_name: "Engine".into(),
            key: Some(ServiceKey {
                param_name: "doc_id".into(),
            }),
            fn_prefix: Some("engine".into()),
            methods: vec![
                TsMethod {
                    rust_name: "new".into(),
                    access: MethodAccess::LifecycleCreate,
                    params: vec![TsParam {
                        rust_name: "config".into(),
                        ts_type: TsType::Named("EngineConfig".into()),
                        is_parse: false,
                    }],
                    return_type: TsType::Void,
                    is_fallible: true,
                    skip_platforms: vec![],
                },
                TsMethod {
                    rust_name: "get_status".into(),
                    access: MethodAccess::Read,
                    params: vec![],
                    return_type: TsType::Named("Status".into()),
                    is_fallible: false,
                    skip_platforms: vec![],
                },
            ],
        }],
    };
    let config = ImportConfig {
        groups: vec![ImportGroup {
            from: "./types".into(),
            types: vec![
                TypeImport {
                    local_name: "EngineConfig".into(),
                    imported_name: None,
                },
                TypeImport {
                    local_name: "Status".into(),
                    imported_name: None,
                },
            ],
        }],
    };
    let ts = emit_bridge(&api, Some(&config), None);
    // Only Status should be imported, not EngineConfig
    assert!(ts.contains("import type { Status } from './types';"));
    assert!(!ts.contains("EngineConfig"));
}

#[test]
fn emit_bridge_mutation_result_unwrap() {
    let api = TsApi {
        services: vec![TsService {
            rust_name: "Engine".into(),
            key: Some(ServiceKey {
                param_name: "doc_id".into(),
            }),
            fn_prefix: Some("engine".into()),
            methods: vec![TsMethod {
                rust_name: "delete_rows".into(),
                access: MethodAccess::Write,
                params: vec![],
                return_type: TsType::Tuple(vec![
                    TsType::Uint8Array,
                    TsType::Named("MutationResult".into()),
                ]),
                is_fallible: false,
                skip_platforms: vec![],
            }],
        }],
    };
    let config = ImportConfig {
        groups: vec![ImportGroup {
            from: "./types".into(),
            types: vec![TypeImport {
                local_name: "MutationResult".into(),
                imported_name: None,
            }],
        }],
    };
    let ts = emit_bridge(&api, Some(&config), None);
    // Interface should show unwrapped type
    assert!(ts.contains("deleteRows(): Promise<MutationResult>;"));
    // Class should use this.core.mutate() with wire type
    assert!(ts.contains("this.core.mutate(this.core.transport.call<[Uint8Array, MutationResult]>('engine_delete_rows'"), "got: {}", ts);
}

#[test]
fn factory_method_pure_has_typed_params_and_return() {
    let svc = TsService {
        rust_name: "BridgePure".into(),
        fn_prefix: Some("".into()),
        key: None,
        methods: vec![],
    };
    let method = TsMethod {
        rust_name: "validate".into(),
        access: MethodAccess::Pure,
        params: vec![TsParam {
            rust_name: "input".into(),
            ts_type: TsType::String,
            is_parse: false,
        }],
        return_type: TsType::Boolean,
        is_fallible: false,
        skip_platforms: vec![],
    };
    let output = emit_bridge_class_method(&svc, &method, "", BridgePattern::Pure);
    assert!(
        output.contains("input: string"),
        "should have typed param, got: {}",
        output
    );
    assert!(
        output.contains("): Promise<boolean>"),
        "should have return type, got: {}",
        output
    );
    assert!(
        output.contains("this.core.transport.call<boolean>"),
        "should have <T> on call, got: {}",
        output
    );
}

#[test]
fn factory_method_mutate_has_wire_type_on_call() {
    let svc = TsService {
        rust_name: "ComputeEngine".into(),
        fn_prefix: Some("compute".into()),
        key: Some(ServiceKey {
            param_name: "doc_id".into(),
        }),
        methods: vec![],
    };
    let method = TsMethod {
        rust_name: "set_cell".into(),
        access: MethodAccess::Write,
        params: vec![
            TsParam {
                rust_name: "sheet_id".into(),
                ts_type: TsType::Named("SheetId".into()),
                is_parse: false,
            },
            TsParam {
                rust_name: "input".into(),
                ts_type: TsType::String,
                is_parse: false,
            },
        ],
        return_type: TsType::Tuple(vec![
            TsType::Uint8Array,
            TsType::Named("MutationResult".into()),
        ]),
        is_fallible: false,
        skip_platforms: vec![],
    };
    let output = emit_bridge_class_method(&svc, &method, "compute", BridgePattern::Mutate);
    // Params should be typed
    assert!(
        output.contains("sheetId: SheetId"),
        "should have typed param, got: {}",
        output
    );
    assert!(
        output.contains("input: string"),
        "should have typed param, got: {}",
        output
    );
    // Return type should be unwrapped (MutationResult, not the tuple)
    assert!(
        output.contains("): Promise<MutationResult>"),
        "should have unwrapped return type, got: {}",
        output
    );
    // transport.call<T> should use the RAW wire type (full tuple)
    assert!(
        output.contains("this.core.transport.call<[Uint8Array, MutationResult]>"),
        "should have wire type on call, got: {}",
        output
    );
}

#[test]
fn factory_method_query_has_typed_output() {
    let svc = TsService {
        rust_name: "ComputeEngine".into(),
        fn_prefix: Some("compute".into()),
        key: Some(ServiceKey {
            param_name: "doc_id".into(),
        }),
        methods: vec![],
    };
    let method = TsMethod {
        rust_name: "get_settings".into(),
        access: MethodAccess::Read,
        params: vec![],
        return_type: TsType::Named("Settings".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    let output = emit_bridge_class_method(&svc, &method, "compute", BridgePattern::Query);
    assert!(
        output.contains("): Promise<Settings>"),
        "should have return type, got: {}",
        output
    );
    assert!(
        output.contains("this.core.transport.call<Settings>"),
        "should have <T> on call, got: {}",
        output
    );
    assert!(
        output.contains("this.core.query("),
        "should use this.core.query wrapper, got: {}",
        output
    );
}

#[test]
fn emit_type_defs_includes_type_alias() {
    let defs = vec![
        TsTypeDef::TypeAlias {
            name: "SheetId".into(),
            target: TsType::String,
        },
        TsTypeDef::Interface(TsInterface {
            name: "Foo".into(),
            fields: vec![TsField {
                ts_name: "sheet".into(),
                ts_type: TsType::Named("SheetId".into()),
                optional: false,
            }],
        }),
    ];
    let ts = emit_type_defs(&defs, None);
    // SheetId is defined in defs, so it should NOT appear as external
    assert!(!ts.contains("// External types:"));
    assert!(ts.contains("export type SheetId = string;"));
    assert!(ts.contains("export interface Foo {"));
}
