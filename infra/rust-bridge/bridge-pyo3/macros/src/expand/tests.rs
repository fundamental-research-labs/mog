use super::*;

#[test]
fn snake_case_simple() {
    assert_eq!(to_snake_case("KvStore"), "kv_store");
}

#[test]
fn snake_case_single_word() {
    assert_eq!(to_snake_case("Engine"), "engine");
}

#[test]
fn snake_case_already_snake() {
    assert_eq!(to_snake_case("already_snake"), "already_snake");
}

#[test]
fn snake_case_consecutive_caps() {
    assert_eq!(to_snake_case("HTTPServer"), "h_t_t_p_server");
}

#[test]
fn classify_return_unit() {
    let r = classify_return("()");
    assert!(r.is_unit);
    assert!(!r.is_string);
}

#[test]
fn classify_return_string() {
    let r = classify_return("String");
    assert!(r.is_string);
    assert!(!r.is_prim);
}

#[test]
fn classify_return_u64() {
    let r = classify_return("u64");
    assert!(r.is_prim);
    assert!(!r.is_string);
}

#[test]
fn classify_return_vec_u8() {
    let r = classify_return("Vec<u8>");
    assert!(r.is_bytes);
}

#[test]
fn classify_return_custom_struct() {
    let r = classify_return("StoreStats");
    assert!(!r.is_string);
    assert!(!r.is_prim);
    assert!(!r.is_bytes);
    assert!(!r.is_unit);
}

#[test]
fn classify_return_bytes_tuple() {
    let r = classify_return("(Vec<u8>, SomeMetadata)");
    assert!(r.is_bytes_tuple);
    assert_eq!(r.serde_inner_ty.as_deref(), Some("SomeMetadata"));
}

#[test]
fn classify_return_self_tuple() {
    let r = classify_return("(Self, InitResult)");
    assert!(r.is_self_tuple);
    assert_eq!(r.self_tuple_inner_ty.as_deref(), Some("InitResult"));
}

#[test]
fn classify_return_bool() {
    let r = classify_return("bool");
    assert!(r.is_prim);
}

// --- Parsing tests ---

fn parse_descriptor(tokens: &str) -> syn::Result<PyO3Descriptor> {
    syn::parse_str::<PyO3Descriptor>(tokens)
}

#[test]
fn parse_service_descriptor() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.type_name, "KvStore");
    assert!(desc.service.is_some());
    assert_eq!(desc.service.as_ref().unwrap().key_param, "store_id");
    assert_eq!(desc.methods.len(), 2);
    assert_eq!(desc.methods[0].access, PyO3Access::LifecycleCreate);
    assert_eq!(desc.methods[0].name, "new");
    assert_eq!(desc.methods[1].access, PyO3Access::Read);
    assert_eq!(desc.methods[1].name, "get");
}

#[test]
fn parse_session_method_collapses_to_read() {
    // R2.4: `method session` collapses to `PyO3Access::Read` so the
    // emission path uses `&self`, not `&mut self`. See bridge-core's
    // `AccessLevel::Session` for rationale.
    let input = r#"
            bridge_version = 1;
            group = session_lifecycle;
            service = MyService;
            key_type = str;
            key_param = "id";
            method session set_active_principal {
                params { [serde] tags: Option<Vec<String>>, }
                return_type = ();
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.methods.len(), 1);
    assert_eq!(desc.methods[0].access, PyO3Access::Read);
    assert_eq!(desc.methods[0].name, "set_active_principal");
}

#[test]
fn parse_pure_method_params() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "id";
            method pure validate_key {
                params { [str] key: &str, [prim] max_length: usize, }
                return_type = ();
                error_type = ValidationError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let m = &desc.methods[0];
    assert_eq!(m.params.len(), 2);
    assert_eq!(m.params[0].tag, PyO3ParamTag::Str);
    assert_eq!(m.params[0].name, "key");
    assert_eq!(m.params[1].tag, PyO3ParamTag::Prim);
    assert_eq!(m.params[1].name, "max_length");
    assert!(m.is_fallible);
}

#[test]
fn parse_parse_tag() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "id";
            method read get_by_id {
                params { [parse] id: &KeyId, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let m = &desc.methods[0];
    assert_eq!(m.params[0].tag, PyO3ParamTag::Parse);
    assert!(m.params[0].ty.contains("KeyId"));
}

#[test]
fn parse_skip_target_pyo3() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            type_name = Utils;
            method pure do_something {
                params {}
                return_type = String;
                skip pyo3;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let m = &desc.methods[0];
    assert!(m.skip_targets.contains(&"pyo3".to_string()));
}

#[test]
fn parse_create_from_lifecycle() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = Engine;
            key_type = str;
            key_param = "id";
            lifecycle create_from snapshot restore {
                params { [bytes] data: Vec<u8>, }
                error_type = EngineError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let m = &desc.methods[0];
    assert_eq!(
        m.access,
        PyO3Access::LifecycleCreateFrom {
            variant_name: "snapshot".to_string()
        }
    );
    assert_eq!(m.name, "restore");
}

// --- Code generation tests ---

#[test]
fn expand_pure_produces_pyfunction() {
    let desc = PyO3Descriptor {
        type_name: "Utils".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![PyO3Method {
            access: PyO3Access::Pure,
            name: "greet".to_string(),
            params: vec![PyO3Param {
                name: "name".to_string(),
                ty: "String".to_string(),
                tag: PyO3ParamTag::Str,
            }],
            return_type: Some(classify_return("String")),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("pyfunction"),
        "expected #[pyfunction] in output: {}",
        code
    );
    assert!(
        code.contains("utils_greet"),
        "expected utils_greet in output: {}",
        code
    );
}

#[test]
fn expand_skips_pyo3_target() {
    let desc = PyO3Descriptor {
        type_name: "Utils".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![PyO3Method {
            access: PyO3Access::Pure,
            name: "napi_only".to_string(),
            params: vec![],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: vec!["pyo3".to_string()],
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        !code.contains("napi_only"),
        "should have skipped pyo3-targeted method: {}",
        code
    );
}

#[test]
fn expand_class_produces_pymethods() {
    let desc = PyO3Descriptor {
        type_name: "MyEngine".to_string(),
        fn_prefix: Some(String::new()),
        service: Some(PyO3ServiceMeta {
            key_param: "id".to_string(),
        }),
        methods: vec![PyO3Method {
            access: PyO3Access::Read,
            name: "get_value".to_string(),
            params: vec![PyO3Param {
                name: "key".to_string(),
                ty: "&str".to_string(),
                tag: PyO3ParamTag::Str,
            }],
            return_type: Some(classify_return("String")),
            error_type: None,
            is_fallible: true,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("ComputeEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("pymethods"),
        "expected #[pymethods] in output: {}",
        code
    );
    assert!(
        code.contains("get_value"),
        "expected get_value method in output: {}",
        code
    );
}

// --- Tagged-enum (B.2) tests ---

#[test]
fn parse_tagged_enum_param() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            type_name = Gate;
            method read check {
                params {
                    [tagged_enum
                        name = "AccessTarget",
                        tag = "kind",
                        variants(
                            Workbook = "workbook" { },
                            Sheet = "sheet" { sheet_id as "sheet_id": serde, },
                            Column = "column" { sheet_id as "sheet_id": serde, col_id as "col_id": serde, },
                        )
                    ] target: AccessTarget,
                }
                return_type = bool;
            }
        "#;
    let desc: PyO3Descriptor = syn::parse_str(input).unwrap();
    let m = &desc.methods[0];
    assert_eq!(m.params.len(), 1);
    let spec = match &m.params[0].tag {
        PyO3ParamTag::TaggedEnum(s) => s,
        other => panic!("expected TaggedEnum, got {:?}", other),
    };
    assert_eq!(spec.type_name, "AccessTarget");
    assert_eq!(spec.tag, "kind");
    assert_eq!(spec.content, None);
    assert_eq!(spec.variants.len(), 3);
    assert_eq!(spec.variants[0].wire_name, "workbook");
    assert!(spec.variants[0].fields.is_empty());
    assert_eq!(spec.variants[1].fields.len(), 1);
    assert_eq!(spec.variants[1].fields[0].rust_name, "sheet_id");
    assert_eq!(spec.variants[1].fields[0].field_tag, PyO3FieldTag::Serde);
}

#[test]
fn tagged_enum_param_emits_branch_decode() {
    let desc = PyO3Descriptor {
        type_name: "Gate".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![PyO3Method {
            access: PyO3Access::Pure,
            name: "check".to_string(),
            params: vec![PyO3Param {
                name: "target".to_string(),
                ty: "AccessTarget".to_string(),
                tag: PyO3ParamTag::TaggedEnum(PyO3TaggedEnumSpec {
                    type_name: "AccessTarget".to_string(),
                    tag: "kind".to_string(),
                    content: None,
                    variants: vec![
                        PyO3VariantSpec {
                            rust_name: "Workbook".to_string(),
                            wire_name: "workbook".to_string(),
                            fields: vec![],
                        },
                        PyO3VariantSpec {
                            rust_name: "Sheet".to_string(),
                            wire_name: "sheet".to_string(),
                            fields: vec![PyO3VariantField {
                                rust_name: "sheet_id".to_string(),
                                wire_name: "sheet_id".to_string(),
                                field_tag: PyO3FieldTag::Serde,
                            }],
                        },
                    ],
                }),
            }],
            return_type: Some(classify_return("bool")),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("target : String"),
        "expected String FFI param: {}",
        code
    );
    assert!(code.contains("\"kind\""), "expected kind literal: {}", code);
    assert!(
        code.contains("\"workbook\""),
        "expected workbook arm: {}",
        code
    );
    assert!(code.contains("\"sheet\""), "expected sheet arm: {}", code);
    assert!(
        code.contains("AccessTarget :: Workbook"),
        "expected Workbook variant ctor: {}",
        code
    );
    assert!(
        code.contains("AccessTarget :: Sheet"),
        "expected Sheet variant ctor: {}",
        code
    );
}

#[test]
fn tagged_enum_adjacent_content_falls_back_to_serde() {
    let desc = PyO3Descriptor {
        type_name: "X".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![PyO3Method {
            access: PyO3Access::Pure,
            name: "probe".to_string(),
            params: vec![PyO3Param {
                name: "m".to_string(),
                ty: "Msg".to_string(),
                tag: PyO3ParamTag::TaggedEnum(PyO3TaggedEnumSpec {
                    type_name: "Msg".to_string(),
                    tag: "t".to_string(),
                    content: Some("c".to_string()),
                    variants: vec![PyO3VariantSpec {
                        rust_name: "Hello".to_string(),
                        wire_name: "Hello".to_string(),
                        fields: vec![],
                    }],
                }),
            }],
            return_type: Some(classify_return("bool")),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("serde_json :: from_str"),
        "expected serde_json::from_str fallback: {}",
        code
    );
}

#[test]
fn structural_access_collapses_to_write() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = Engine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method structural rename_sheet {
                params { [serde] sheet: SheetId, [str] name: String, }
                return_type = ();
            }
        "#;
    let desc: PyO3Descriptor = syn::parse_str(input).unwrap();
    assert_eq!(desc.methods[1].access, PyO3Access::Write);
}
