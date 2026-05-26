//! Integration tests for the descriptor DSL parser.
//!
//! Exercises representative shapes emitted by `bridge-core/src/emit.rs` to
//! make sure the target-neutral parser accepts everything downstream target
//! crates will ever see: stateless and stateful descriptors, every access
//! level, tagged-enum params, lifecycle create/create_from, async methods,
//! skip targets, scope/needs_principal passthrough, and the new `extras`
//! block.

use bridge_ir::{AccessLevel, ApiDescriptor, LifecycleKind, ParamTag};
use quote::ToTokens;

fn parse(input: &str) -> ApiDescriptor {
    syn::parse_str::<ApiDescriptor>(input).expect("descriptor parsed")
}

#[test]
fn parse_service_descriptor_with_lifecycle_and_read() {
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
    let desc = parse(input);
    assert_eq!(desc.type_name.to_string(), "KvStore");
    assert_eq!(desc.group_name.as_deref(), Some("ops"));
    assert!(desc.service.is_some());
    let svc = desc.service.as_ref().unwrap();
    assert_eq!(svc.name.to_string(), "KvStore");
    assert_eq!(svc.key_type, "str");
    assert_eq!(svc.key_param, "store_id");
    assert_eq!(desc.methods.len(), 2);
    assert!(matches!(
        desc.methods[0].access,
        AccessLevel::Lifecycle(LifecycleKind::Create)
    ));
    assert_eq!(desc.methods[0].name.to_string(), "new");
    assert!(desc.methods[0].is_fallible);
    assert!(matches!(desc.methods[1].access, AccessLevel::Read));
    assert_eq!(desc.methods[1].name.to_string(), "get");
}

#[test]
fn parse_stateless_descriptor_with_pure_method() {
    let input = r#"
        bridge_version = 1;
        group = utils;
        type_name = HashUtils;
        method pure hash_key {
            params { [str] key: &str, [prim] max_len: usize, }
            return_type = u64;
        }
    "#;
    let desc = parse(input);
    assert_eq!(desc.type_name.to_string(), "HashUtils");
    assert!(desc.service.is_none());
    let m = &desc.methods[0];
    assert!(matches!(m.access, AccessLevel::Pure));
    assert_eq!(m.params.len(), 2);
    assert_eq!(m.params[0].name.to_string(), "key");
    assert!(matches!(m.params[0].tag, ParamTag::Str));
    assert!(matches!(m.params[1].tag, ParamTag::Prim));
}

#[test]
fn parse_write_method_with_scope_and_needs_principal() {
    // These two keys land on #[bridge::write(...)] via bridge-core and are
    // emitted unconditionally by bridge-core/emit.rs. bridge-delegate strips
    // them before re-emitting to napi/pyo3/wasm, but bridge-ir must parse
    // them losslessly so bridge-cli (which does consume them) works.
    let input = r#"
        bridge_version = 1;
        group = core;
        service = Engine;
        key_type = str;
        key_param = "engine_id";
        method write set_cell {
            params { [str] sheet: &str, [prim] row: u32, [prim] col: u32, [str] value: &str, }
            return_type = ();
            scope = "cell";
            needs_principal;
        }
    "#;
    let desc = parse(input);
    let m = &desc.methods[0];
    assert_eq!(m.scope.as_deref(), Some("cell"));
    assert!(m.needs_principal);
    // Unit return is normalized to None.
    assert!(m.return_type.is_none());
}

#[test]
fn parse_lifecycle_create_from_variant() {
    let input = r#"
        bridge_version = 1;
        group = core;
        service = Engine;
        key_type = str;
        key_param = "engine_id";
        lifecycle create_from Bytes from_bytes {
            params { [bytes] data: &[u8], }
            return_type = Self;
            error_type = EngineError;
            fallible;
        }
    "#;
    let desc = parse(input);
    let m = &desc.methods[0];
    match &m.access {
        AccessLevel::Lifecycle(LifecycleKind::CreateFrom { name }) => {
            assert_eq!(name, "Bytes");
        }
        other => panic!("expected CreateFrom, got {:?}", other),
    }
    assert_eq!(m.name.to_string(), "from_bytes");
    assert!(matches!(m.params[0].tag, ParamTag::Bytes));
}

#[test]
fn parse_async_method_and_skip_target() {
    let input = r#"
        bridge_version = 1;
        group = core;
        service = Engine;
        key_type = str;
        key_param = "id";
        method read query {
            params { [str] sql: String, }
            return_type = String;
            error_type = DbError;
            fallible;
            async;
            skip wasm;
            skip pyo3;
        }
    "#;
    let desc = parse(input);
    let m = &desc.methods[0];
    assert!(m.is_async);
    assert!(m.is_fallible);
    assert_eq!(m.skip_targets, vec!["wasm".to_string(), "pyo3".to_string()]);
}

#[test]
fn parse_structural_and_session_access_levels() {
    // privacy added `structural` (admin-gated mutations) and R2.4
    // added `session` (interior-mutable &self); bridge-ir preserves both as
    // distinct variants so downstream targets can collapse or preserve them
    // as they see fit.
    let input = r#"
        bridge_version = 1;
        group = core;
        service = Engine;
        key_type = str;
        key_param = "id";
        method structural rename_sheet {
            params { [serde] sheet: SheetId, [str] name: String, }
            return_type = ();
            scope = "sheet";
        }
        method session set_active_principal {
            params { [serde] tags: Option<Vec<String>>, }
            return_type = ();
        }
    "#;
    let desc = parse(input);
    assert!(matches!(desc.methods[0].access, AccessLevel::Structural));
    assert_eq!(desc.methods[0].scope.as_deref(), Some("sheet"));
    assert!(matches!(desc.methods[1].access, AccessLevel::Session));
}

#[test]
fn parse_tagged_enum_param_schema() {
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
                        Sheet = "sheet" { sheet_id as "sheetId": serde, },
                        Column = "column" { sheet_id as "sheetId": serde, col_id as "colId": serde, },
                    )
                ] target: AccessTarget,
            }
            return_type = bool;
        }
    "#;
    let desc = parse(input);
    let p = &desc.methods[0].params[0];
    let schema = match &p.tag {
        ParamTag::TaggedEnum(s) => s,
        other => panic!("expected TaggedEnum, got {:?}", other),
    };
    assert_eq!(schema.type_name, "AccessTarget");
    assert_eq!(schema.tag, "kind");
    assert!(schema.content.is_none());
    assert_eq!(schema.variants.len(), 3);
    assert_eq!(schema.variants[0].rust_name, "Workbook");
    assert_eq!(schema.variants[0].wire_name, "workbook");
    assert!(schema.variants[0].fields.is_empty());
    assert_eq!(schema.variants[1].fields.len(), 1);
    assert_eq!(schema.variants[1].fields[0].rust_name, "sheet_id");
    assert_eq!(schema.variants[1].fields[0].wire_name, "sheetId");
    assert!(matches!(*schema.variants[1].fields[0].tag, ParamTag::Serde));
    assert_eq!(schema.variants[2].fields.len(), 2);
}

#[test]
fn parse_extras_block_round_trips_entries() {
    // bridge-core only emits `extras { ... }` when the map is non-empty (PR1).
    // Verify we accept arbitrary `key = "val";` pairs and sort them alphabetically
    // (BTreeMap semantics).
    let input = r#"
        bridge_version = 1;
        group = core;
        service = Engine;
        key_type = str;
        key_param = "id";
        extras {
            cli_group = "sheets";
            tauri_window = "main";
        }
        method read get {
            params {}
            return_type = String;
        }
    "#;
    let desc = parse(input);
    assert_eq!(
        desc.extras.get("cli_group").map(|s| s.as_str()),
        Some("sheets")
    );
    assert_eq!(
        desc.extras.get("tauri_window").map(|s| s.as_str()),
        Some("main")
    );
    // BTreeMap ordering lets downstream emit deterministic output.
    let keys: Vec<&String> = desc.extras.keys().collect();
    assert_eq!(keys, vec!["cli_group", "tauri_window"]);
}

#[test]
fn parse_descriptor_without_extras_block_is_fine() {
    // Pre-PR1 descriptors omit the extras block entirely; bridge-ir must
    // accept them too so staged migrations don't break.
    let input = r#"
        bridge_version = 1;
        group = core;
        service = Engine;
        key_type = str;
        key_param = "id";
        method read get {
            params {}
            return_type = String;
        }
    "#;
    let desc = parse(input);
    assert!(desc.extras.is_empty());
}

#[test]
fn parse_fn_prefix_both_shapes() {
    // `fn_prefix = _;` means empty (no prefix); `fn_prefix = <ident>;`
    // means use that prefix. Both shapes are exercised by bridge-core.
    let with_prefix = parse(
        r#"
        bridge_version = 1;
        group = core;
        fn_prefix = compute;
        service = Engine;
        key_type = str;
        key_param = "id";
        method read get { params {} return_type = String; }
    "#,
    );
    assert_eq!(with_prefix.fn_prefix.as_deref(), Some("compute"));

    let no_prefix = parse(
        r#"
        bridge_version = 1;
        group = core;
        fn_prefix = _;
        service = Engine;
        key_type = str;
        key_param = "id";
        method read get { params {} return_type = String; }
    "#,
    );
    assert_eq!(no_prefix.fn_prefix.as_deref(), Some(""));
}

#[test]
fn parse_parse_tag_with_reference_type() {
    // `[parse]` params take a reference to a user type that implements a
    // bridge-types parser; the IR captures the syn::Type unchanged.
    let input = r#"
        bridge_version = 1;
        group = ops;
        service = Engine;
        key_type = str;
        key_param = "id";
        method read get_by_id {
            params { [parse] id: &KeyId, }
            return_type = String;
            error_type = EngineError;
            fallible;
        }
    "#;
    let desc = parse(input);
    let p = &desc.methods[0].params[0];
    assert!(matches!(p.tag, ParamTag::Parse));
    // The Type reproduces the original source when round-tripped.
    let ty_str = p.ty.to_token_stream().to_string();
    assert!(ty_str.contains("KeyId"));
    assert!(ty_str.starts_with('&'));
}

#[test]
fn parse_preserves_generic_return_type() {
    // The custom "type-until-comma/semicolon" logic must track `<>` depth
    // so commas inside generics don't split parameters/types.
    let input = r#"
        bridge_version = 1;
        group = ops;
        service = Engine;
        key_type = str;
        key_param = "id";
        method read list {
            params { [serde] filter: Option<Vec<String>>, }
            return_type = Vec<String>;
        }
    "#;
    let desc = parse(input);
    let m = &desc.methods[0];
    assert_eq!(m.params.len(), 1);
    let filter_ty = m.params[0].ty.to_token_stream().to_string();
    assert!(filter_ty.contains("Option"));
    assert!(filter_ty.contains("Vec"));
    let ret_ty = m
        .return_type
        .as_ref()
        .unwrap()
        .to_token_stream()
        .to_string();
    assert!(ret_ty.contains("Vec"));
}

#[test]
fn unit_return_type_normalizes_to_none() {
    let input = r#"
        bridge_version = 1;
        group = core;
        service = Engine;
        key_type = str;
        key_param = "id";
        method write clear {
            params {}
            return_type = ();
        }
    "#;
    let desc = parse(input);
    assert!(desc.methods[0].return_type.is_none());
}
