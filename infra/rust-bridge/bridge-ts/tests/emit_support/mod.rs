use bridge_ts::types::*;

pub(crate) fn make_kv_utils_api() -> TsApi {
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

pub(crate) fn make_kv_store_api() -> TsApi {
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
pub(crate) fn make_bridge_test_api() -> TsApi {
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
