use super::*;

// --- snake_case tests ---

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
fn snake_case_kv_utils() {
    assert_eq!(to_snake_case("KvUtils"), "kv_utils");
}

// --- Parsing tests ---

fn parse_descriptor(tokens: &str) -> syn::Result<TauriDescriptor> {
    syn::parse_str::<TauriDescriptor>(tokens)
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
    assert_eq!(desc.type_name.to_string(), "KvStore");
    assert!(desc.service.is_some());
    assert_eq!(desc.service.as_ref().unwrap().key_param, "store_id");
    assert_eq!(desc.methods.len(), 2);
    assert_eq!(desc.methods[0].access, TauriAccess::LifecycleCreate);
    assert_eq!(desc.methods[0].name.to_string(), "new");
    assert_eq!(desc.methods[1].access, TauriAccess::Read);
    assert_eq!(desc.methods[1].name.to_string(), "get");
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
    assert_eq!(m.params[0].tag, TauriParamTag::Str);
    assert_eq!(m.params[0].name.to_string(), "key");
    assert!(m.params[0].is_ref);
    assert_eq!(m.params[1].tag, TauriParamTag::Prim);
    assert_eq!(m.params[1].name.to_string(), "max_length");
    assert!(!m.params[1].is_ref);
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
    assert_eq!(m.params[0].tag, TauriParamTag::Parse);
    assert!(m.params[0].is_ref);
    // Verify the original type contains KeyId by rendering it to tokens
    let ty = &m.params[0].original_ty;
    let ty_tokens = quote!(#ty).to_string();
    assert!(
        ty_tokens.contains("KeyId"),
        "expected type to contain KeyId, got: {}",
        ty_tokens
    );
}

#[test]
fn parse_stateless_descriptor() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = KvUtils;
            method pure hash_key {
                params { [str] key: &str, }
                return_type = u64;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.type_name.to_string(), "KvUtils");
    assert!(desc.service.is_none());
    assert_eq!(desc.methods.len(), 1);
    assert_eq!(desc.methods[0].access, TauriAccess::Pure);
    assert_eq!(desc.methods[0].name.to_string(), "hash_key");
    assert!(!desc.methods[0].is_fallible);
}

#[test]
fn parse_write_method() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            method write set {
                params { [str] key: &str, [serde] value: Record, }
                return_type = ();
                error_type = KvError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.methods.len(), 1);
    assert_eq!(desc.methods[0].access, TauriAccess::Write);
    assert_eq!(desc.methods[0].name.to_string(), "set");
    assert_eq!(desc.methods[0].params.len(), 2);
    assert_eq!(desc.methods[0].params[1].tag, TauriParamTag::Serde);
}

#[test]
fn parse_group_name() {
    let input = r#"
            bridge_version = 1;
            group = my_group;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = u32;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.group.to_string(), "my_group");
}

#[test]
fn parse_bytes_tag() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = BlobStore;
            key_type = str;
            key_param = "id";
            method write put {
                params { [bytes] data: &[u8], }
                return_type = ();
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let m = &desc.methods[0];
    assert_eq!(m.params[0].tag, TauriParamTag::Bytes);
    assert!(m.params[0].is_ref);
}

#[test]
fn parse_non_fallible_method() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = Counter;
            key_type = str;
            key_param = "id";
            method read count {
                params {}
                return_type = u64;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert!(!desc.methods[0].is_fallible);
}

// --- Code generation tests ---

#[test]
fn expand_produces_tokens() {
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
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // Should contain the registry type alias
    assert!(
        code.contains("KvStoreRegistry"),
        "expected KvStoreRegistry in output, got:\n{}",
        code
    );
    // Should contain the create function
    assert!(
        code.contains("kv_store_new"),
        "expected kv_store_new in output, got:\n{}",
        code
    );
    // Should contain destroy function
    assert!(
        code.contains("kv_store_destroy"),
        "expected kv_store_destroy in output, got:\n{}",
        code
    );
    // Should contain the read method
    assert!(
        code.contains("kv_store_get"),
        "expected kv_store_get in output, got:\n{}",
        code
    );
}

#[test]
fn registry_generation_requires_thread_safe_services() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();

    assert!(
        code.contains("pub struct TauriRegistry < T : Send + Sync + 'static >"),
        "expected registry type bound in output, got:\n{}",
        code
    );
    assert!(
        code.contains("impl < T : Send + Sync + 'static > TauriRegistry < T >"),
        "expected registry impl bound in output, got:\n{}",
        code
    );
    assert!(
        code.contains("pub type KvStoreRegistry = TauriRegistry < KvStore >"),
        "expected service registry alias in output, got:\n{}",
        code
    );
}

#[test]
fn registry_generation_uses_borrowed_closure_dispatch() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params {}
                return_type = u32;
            }
            method write set {
                params { [prim] value: u32, }
                return_type = ();
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();

    assert!(
        code.contains("f (value)"),
        "expected direct closure call in registry accessors, got:\n{}",
        code
    );

    let forbidden = [
        ["unsafe", "impl"].join(" "),
        ["as", "*", "const"].join(" "),
        ["as", "*", "mut"].join(" "),
        ["unsafe", "{", "f"].join(" "),
        format!("{}{}", "*", "ptr"),
        ["*", "ptr"].join(" "),
        ["&", "*", "ptr"].join(" "),
        ["&", "mut", "*", "ptr"].join(" "),
    ];
    for marker in forbidden {
        assert!(
            !code.contains(&marker),
            "unexpected registry dispatch marker `{}` in output:\n{}",
            marker,
            code
        );
    }
}

#[test]
fn expand_pure_method() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = KvUtils;
            method pure hash_key {
                params { [str] key: &str, }
                return_type = u64;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // Should contain the function name
    assert!(
        code.contains("kv_utils_hash_key"),
        "expected kv_utils_hash_key in output, got:\n{}",
        code
    );
    // Pure methods use catch_unwind
    assert!(
        code.contains("catch_unwind"),
        "expected catch_unwind in output, got:\n{}",
        code
    );
}

#[test]
fn handlers_macro_emitted() {
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
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // Should contain the handlers macro
    assert!(
        code.contains("__bridge_handlers_kv_store_ops"),
        "expected handlers macro in output, got:\n{}",
        code
    );
    // Should reference the command function names
    assert!(
        code.contains("kv_store_new"),
        "expected kv_store_new in handlers macro output, got:\n{}",
        code
    );
    assert!(
        code.contains("kv_store_destroy"),
        "expected kv_store_destroy in handlers macro output, got:\n{}",
        code
    );
}

#[test]
fn skip_tauri_method_is_excluded() {
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
            method write set_time {
                params { [prim] serial: f64, }
                return_type = ();
                skip tauri;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.methods.len(), 3);
    assert_eq!(desc.methods[2].skip_targets, vec!["tauri".to_string()]);

    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // set_time should be excluded from Tauri output
    assert!(
        !code.contains("kv_store_set_time"),
        "set_time should be skipped for tauri but was found in output: {}",
        code
    );
    // get should still be included
    assert!(
        code.contains("kv_store_get"),
        "get should be present in tauri output: {}",
        code
    );
}

#[test]
fn skip_wasm_not_filtered_in_tauri() {
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
                skip wasm;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.methods[1].skip_targets, vec!["wasm".to_string()]);
    // This method targets wasm, not tauri, so it should NOT be filtered
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("kv_store_get"),
        "method with skip wasm should still appear in tauri output: {}",
        code
    );
}

#[test]
fn skip_lifecycle_create_still_emits_registry_and_destroy() {
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
                skip tauri;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // When lifecycle create is skipped for this target, registry and destroy
    // should NOT be emitted — prevents duplicate definitions when multiple
    // descriptor groups share the same service type.
    assert!(
        !code.contains("TauriRegistry"),
        "registry should NOT be emitted when lifecycle is skipped for tauri: {}",
        code
    );
    assert!(
        !code.contains("kv_store_new"),
        "create fn should not be emitted when lifecycle create is skipped: {}",
        code
    );
    assert!(
        !code.contains("kv_store_destroy"),
        "destroy fn should NOT be emitted when lifecycle is skipped for tauri: {}",
        code
    );
}

// --- Bytes-tuple return tests ---

#[test]
fn parse_bytes_tuple_return() {
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
            method write apply_mutations {
                params {}
                return_type = (Vec<u8>, MutationMeta);
                error_type = EngineError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let method = &desc.methods[1];
    assert!(
        method.return_info.is_bytes_tuple,
        "expected bytes_tuple return"
    );
    assert!(
        method.return_info.serde_inner_ty.is_some(),
        "expected serde inner type"
    );
    let inner = method.return_info.serde_inner_ty.as_ref().unwrap();
    let inner_str = quote!(#inner).to_string();
    assert!(
        inner_str.contains("MutationMeta"),
        "expected MutationMeta as inner type, got: {}",
        inner_str
    );
}

#[test]
fn bytes_tuple_generates_inline_packing() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = Engine;
            method pure get_data {
                params {}
                return_type = (Vec<u8>, DataMeta);
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // Should inline-pack bytes + metadata into a single Response
    assert!(
        code.contains("ipc :: Response"),
        "expected ipc::Response in output, got:\n{}",
        code
    );
    assert!(
        code.contains("serde_json :: to_vec"),
        "expected serde_json::to_vec for metadata serialization, got:\n{}",
        code
    );
    // Should contain the function
    assert!(
        code.contains("engine_get_data"),
        "expected function name in output, got:\n{}",
        code
    );
}

#[test]
fn non_bytes_tuple_not_detected() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = String;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert!(!desc.methods[0].return_info.is_bytes_tuple);
}

// --- Security level tests ---

#[test]
fn parse_security_level() {
    let input = r#"
            security_level = Sensitive;
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = String;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert!(desc.security_level.is_some());
    assert_eq!(desc.security_level.unwrap().to_string(), "Sensitive");
}

#[test]
fn parse_no_security_level() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = String;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert!(desc.security_level.is_none());
}

#[test]
fn security_level_adds_params_to_output() {
    let input = r#"
            security_level = Sensitive;
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params { [str] key: &str, }
                return_type = String;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // Should contain security params
    assert!(
        code.contains("__sec_timestamp"),
        "expected __sec_timestamp in output, got:\n{}",
        code
    );
    assert!(
        code.contains("__sec_nonce"),
        "expected __sec_nonce in output, got:\n{}",
        code
    );
    assert!(
        code.contains("__sec_signature"),
        "expected __sec_signature in output, got:\n{}",
        code
    );
    assert!(
        code.contains("tauri :: Window"),
        "expected tauri::Window in output, got:\n{}",
        code
    );
    assert!(
        code.contains("tauri :: AppHandle"),
        "expected tauri::AppHandle in output, got:\n{}",
        code
    );
    // Should contain verify_request call
    assert!(
        code.contains("verify_request"),
        "expected verify_request in output, got:\n{}",
        code
    );
    // Should reference SecurityLevel::Sensitive
    assert!(
        code.contains("Sensitive"),
        "expected Sensitive level in output, got:\n{}",
        code
    );
}

#[test]
fn security_level_critical() {
    let input = r#"
            security_level = Critical;
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = String;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    assert!(
        code.contains("Critical"),
        "expected Critical level in output, got:\n{}",
        code
    );
}

#[test]
fn no_security_level_no_extra_params() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params { [str] key: &str, }
                return_type = String;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    assert!(
        !code.contains("__sec_timestamp"),
        "unexpected __sec_timestamp in output without security_level:\n{}",
        code
    );
    assert!(
        !code.contains("verify_request"),
        "unexpected verify_request in output without security_level:\n{}",
        code
    );
}

#[test]
fn security_level_service_destroy_has_security() {
    let input = r#"
            security_level = Sensitive;
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
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // The destroy command should also have security params
    assert!(
        code.contains("kv_store_destroy"),
        "expected kv_store_destroy in output, got:\n{}",
        code
    );
    // Count occurrences of verify_request — should be one per non-skipped command
    // (new, get, destroy = 3 commands)
    let verify_count = code.matches("verify_request").count();
    assert_eq!(
        verify_count, 3,
        "expected 3 verify_request calls (new, get, destroy), got {}",
        verify_count
    );
}

#[test]
fn security_level_uses_fn_name_as_operation() {
    let input = r#"
            security_level = Sensitive;
            bridge_version = 1;
            group = g0;
            type_name = MyParser;
            method pure parse_file {
                params { [str] path: &str, }
                return_type = String;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();
    // The operation string should be the generated function name
    assert!(
        code.contains("\"my_parser_parse_file\""),
        "expected operation string 'my_parser_parse_file' in output, got:\n{}",
        code
    );
}

// --- Async method tests ---

#[test]
fn async_method_generates_await() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            service = Database;
            key_type = str;
            key_param = "connection_id";
            lifecycle create new {
                params { [str] config: String, }
                return_type = ();
                fallible;
            }
            method read query {
                params { [str] sql: &str, }
                return_type = String;
                error_type = String;
                fallible;
                async;
            }
            method read list {
                params {}
                return_type = String;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();

    // Verify parsing: query is async, list is not
    assert!(desc.methods[1].is_async, "query should be async");
    assert!(!desc.methods[2].is_async, "list should not be async");

    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();

    // The async method (query) should use clone_for_async + .await
    assert!(
        code.contains("clone_for_async"),
        "expected clone_for_async in output for async method, got:\n{}",
        code
    );

    // The sync method (list) should use with_read
    assert!(
        code.contains("with_read"),
        "expected with_read in output for sync method, got:\n{}",
        code
    );

    // The async method should contain .await
    assert!(
        code.contains(". await"),
        "expected .await in output for async method, got:\n{}",
        code
    );
}

#[test]
fn async_pure_method_generates_await() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = DbUtils;
            method pure validate {
                params { [str] sql: &str, }
                return_type = String;
                error_type = String;
                fallible;
                async;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert!(desc.methods[0].is_async, "validate should be async");

    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();

    // Pure async should NOT use clone_for_async (stateless)
    assert!(
        !code.contains("clone_for_async"),
        "pure async should not use clone_for_async, got:\n{}",
        code
    );

    // Should contain .await
    assert!(
        code.contains(". await"),
        "expected .await in output for async pure method, got:\n{}",
        code
    );

    // Should NOT use catch_unwind (async methods skip it)
    assert!(
        !code.contains("catch_unwind"),
        "async pure methods should not use catch_unwind, got:\n{}",
        code
    );
}

#[test]
fn async_write_method_uses_clone_for_async() {
    let input = r#"
            bridge_version = 1;
            group = g0;
            service = Database;
            key_type = str;
            key_param = "connection_id";
            lifecycle create new {
                params {}
                return_type = ();
            }
            method write execute {
                params { [str] sql: &str, }
                return_type = u64;
                error_type = String;
                fallible;
                async;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert!(desc.methods[1].is_async, "execute should be async");

    let tokens = expand_descriptor(&desc);
    let code = tokens.to_string();

    // Async write should use clone_for_async, NOT with_write in the command body.
    // Note: with_write appears in the TauriRegistry definition itself, so we
    // check that the execute command body does not call state.with_write.
    assert!(
        code.contains("clone_for_async (& connection_id)"),
        "expected clone_for_async(&connection_id) for async write method, got:\n{}",
        code
    );
    // The execute command body should NOT dispatch through with_write closure
    assert!(
        !code.contains("state . with_write (& connection_id"),
        "async write command should not call state.with_write, got:\n{}",
        code
    );
}
