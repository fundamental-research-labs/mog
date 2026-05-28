use super::*;
use crate::descriptor::{AccessLevel, ApiDescriptor, LifecycleKind, ParamTag};
use std::collections::BTreeMap;

    fn parse_impl(src: &str) -> syn::Result<ApiDescriptor> {
        let item: syn::ItemImpl = syn::parse_str(src)?;
        parse_impl_block(&item, None, None, None, None, BTreeMap::new())
    }

    #[test]
    fn structural_attribute_parses_as_structural_access() {
        let src = r#"
            impl Engine {
                #[bridge::structural]
                pub fn rename_sheet(&mut self, sheet: SheetId, name: String) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods.len(), 1);
        assert_eq!(desc.methods[0].access, AccessLevel::Structural);
        assert_eq!(desc.methods[0].name.to_string(), "rename_sheet");
        assert_eq!(desc.methods[0].params.len(), 2);
    }

    #[test]
    fn structural_attribute_ignores_passthrough_args() {
        // Passthrough args (e.g. `scope = "sheet"`) parse today.
        // `scope` is captured on the descriptor but not validated
        // here — bridge-delegate enforces under `gated = true`.
        let src = r#"
            impl Engine {
                #[bridge::structural(scope = "sheet")]
                pub fn rename_sheet(&mut self, sheet: SheetId) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods[0].access, AccessLevel::Structural);
        assert_eq!(desc.methods[0].scope.as_deref(), Some("sheet"));
    }

    #[test]
    fn read_attribute_captures_scope() {
        let src = r#"
            impl Engine {
                #[bridge::read(scope = "cell")]
                pub fn get_cell(&self, sheet: SheetId, addr: CellAddr) -> CellValue { todo!() }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods[0].access, AccessLevel::Read);
        assert_eq!(desc.methods[0].scope.as_deref(), Some("cell"));
        assert!(!desc.methods[0].needs_principal);
    }

    #[test]
    fn write_attribute_captures_needs_principal() {
        let src = r#"
            impl Engine {
                #[bridge::write(scope = "workbook", needs_principal)]
                pub fn add_policy(&mut self, p: Policy, caller: &Principal) -> Result<(), Err> { todo!() }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods[0].access, AccessLevel::Write);
        assert_eq!(desc.methods[0].scope.as_deref(), Some("workbook"));
        assert!(desc.methods[0].needs_principal);
    }

    #[test]
    fn scope_and_needs_principal_roundtrip_through_emit() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read(scope = "cell")]
                pub fn get(&self, sheet: SheetId) -> u32 { 0 }
                #[bridge::write(needs_principal)]
                pub fn add(&mut self, caller: &Principal) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(tokens.contains("scope = \"cell\""), "emit: {}", tokens);
        assert!(tokens.contains("needs_principal"), "emit: {}", tokens);
    }

    #[test]
    fn method_without_scope_emits_no_scope_token() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn plain(&self) -> u32 { 0 }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(!tokens.contains("scope"), "emit leaked scope: {}", tokens);
        assert!(
            !tokens.contains("needs_principal"),
            "emit leaked needs_principal: {}",
            tokens
        );
    }

    #[test]
    fn unknown_access_attribute_arg_is_rejected() {
        let src = r#"
            impl Engine {
                #[bridge::read(ascension = "rapture")]
                pub fn get(&self) -> u32 { 0 }
            }
        "#;
        // Typos on bridge access attribute args must surface at parse
        // time, pointing at the offending ident. The previous
        // `unwrap_or((None, false))` silently dropped them, leaving
        // `scpoe = "cell"` to trip the bridge-delegate "missing scope"
        // diagnostic far downstream with no hint about the typo.
        let err = parse_impl(src).expect_err("unknown arg must be rejected");
        let msg = err.to_string();
        assert!(
            msg.contains("unknown argument 'ascension'"),
            "expected unknown-argument diagnostic, got: {}",
            msg
        );
    }

    #[test]
    fn unknown_access_attribute_scope_typo_points_at_typo() {
        // Regression guard for a common typo: a
        // mistyped `scpoe = "cell"` now surfaces as "unknown argument
        // 'scpoe'" rather than "missing scope".
        let src = r#"
            impl Engine {
                #[bridge::read(scpoe = "cell")]
                pub fn get(&self) -> u32 { 0 }
            }
        "#;
        let err = parse_impl(src).expect_err("typo must surface at parse");
        assert!(
            err.to_string().contains("unknown argument 'scpoe'"),
            "expected the typo to be the diagnostic's subject, got: {}",
            err
        );
    }

    #[test]
    fn structural_roundtrips_through_emit() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::structural]
                pub fn delete_sheet(&mut self, sheet: SheetId) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(
            tokens.contains("method structural"),
            "emit output: {}",
            tokens
        );
        assert!(tokens.contains("delete_sheet"));
    }

    #[test]
    fn tagged_enum_attribute_populates_schema() {
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn check(
                    &self,
                    #[bridge::tagged_enum(
                        name = "AccessTarget",
                        tag = "kind",
                        variants(
                            Workbook = "workbook" { },
                            Sheet = "sheet" { sheet_id as "sheetId": serde },
                            Column = "column" { sheet_id as "sheetId": serde, col_id as "colId": serde },
                        ),
                    )]
                    target: AccessTarget,
                ) -> bool { false }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let schema = match &desc.methods[0].params[0].tag {
            ParamTag::TaggedEnum(s) => s,
            other => panic!("expected TaggedEnum, got {:?}", other),
        };
        assert_eq!(schema.type_name, "AccessTarget");
        assert_eq!(schema.tag, "kind");
        assert_eq!(schema.content, None);
        assert_eq!(schema.variants.len(), 3);
        assert_eq!(schema.variants[0].rust_name, "Workbook");
        assert_eq!(schema.variants[0].wire_name, "workbook");
        assert_eq!(schema.variants[0].fields.len(), 0);
        assert_eq!(schema.variants[1].rust_name, "Sheet");
        assert_eq!(schema.variants[1].wire_name, "sheet");
        assert_eq!(schema.variants[1].fields.len(), 1);
        assert_eq!(schema.variants[1].fields[0].rust_name, "sheet_id");
        assert_eq!(schema.variants[1].fields[0].wire_name, "sheetId");
        assert!(matches!(*schema.variants[1].fields[0].tag, ParamTag::Serde));
        assert_eq!(schema.variants[2].fields.len(), 2);
    }

    #[test]
    fn tagged_enum_content_key_is_preserved() {
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn probe(
                    &self,
                    #[bridge::tagged_enum(
                        name = "Msg",
                        tag = "t",
                        content = "c",
                        variants(Hello { name: str }),
                    )]
                    m: Msg,
                ) -> bool { false }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let schema = match &desc.methods[0].params[0].tag {
            ParamTag::TaggedEnum(s) => s,
            _ => panic!("expected TaggedEnum"),
        };
        assert_eq!(schema.content.as_deref(), Some("c"));
    }

    #[test]
    fn tagged_enum_roundtrips_through_emit() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn check(
                    &self,
                    #[bridge::tagged_enum(
                        name = "AccessTarget",
                        tag = "kind",
                        variants(
                            Workbook { },
                            Sheet { sheet_id: serde },
                        ),
                    )]
                    target: AccessTarget,
                ) -> bool { false }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(tokens.contains("tagged_enum"), "emit output: {}", tokens);
        assert!(tokens.contains("AccessTarget"));
        assert!(tokens.contains("kind"));
        assert!(tokens.contains("sheet_id"));
    }

    #[test]
    fn existing_access_levels_unchanged() {
        // Guards against accidental regression of the original AccessLevel variants.
        let src = r#"
            impl Engine {
                #[bridge::pure]
                pub fn pure_fn() -> u32 { 0 }
                #[bridge::read]
                pub fn read_fn(&self) -> u32 { 0 }
                #[bridge::write]
                pub fn write_fn(&mut self) {}
                #[bridge::lifecycle(create)]
                pub fn new() -> Self { Self }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods.len(), 4);
        assert_eq!(desc.methods[0].access, AccessLevel::Pure);
        assert_eq!(desc.methods[1].access, AccessLevel::Read);
        assert_eq!(desc.methods[2].access, AccessLevel::Write);
        assert_eq!(
            desc.methods[3].access,
            AccessLevel::Lifecycle(LifecycleKind::Create)
        );
    }

    #[test]
    fn session_attribute_parses_as_session_access() {
        // R2.4: `#[bridge::session]` marks `&self` interior-mutable methods
        // (e.g. `set_active_principal` via `ArcSwap`). The IR must record
        // the distinct kind so downstream codegens can preserve `&self`
        // rather than defaulting to `&mut self` via the `write` pathway.
        let src = r#"
            impl Service {
                #[bridge::session]
                pub fn set_active_principal(&self, tags: Option<Vec<String>>) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods.len(), 1);
        assert_eq!(desc.methods[0].access, AccessLevel::Session);
        assert_eq!(desc.methods[0].name.to_string(), "set_active_principal");
    }

    #[test]
    fn session_roundtrips_through_emit_as_method_session() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Service {
                #[bridge::session]
                pub fn set_active_principal(&self, tags: Option<Vec<String>>) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(
            tokens.contains("method session"),
            "emit must preserve `method session` so downstream codegens \
             (bridge-napi/pyo3/tauri/wasm) parse `&self` semantics: {}",
            tokens
        );
    }

    #[test]
    fn descriptor_without_structural_emits_no_new_tokens() {
        // Backward-compat guarantee: a descriptor with no structural
        // methods and no tagged_enum params emits bytes identical to the shape
        // would have produced before these extensions landed.
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn read_fn(&self, k: &str) -> u32 { 0 }
                #[bridge::write]
                pub fn write_fn(&mut self, v: u32) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(!tokens.contains("structural"));
        assert!(!tokens.contains("tagged_enum"));
    }

    // -----------------------------------------------------------------
    // Impl-block-level extras bag.
    // -----------------------------------------------------------------

    fn parse_api_args(src: &str) -> syn::Result<ApiAttrArgs> {
        let tokens: proc_macro2::TokenStream = syn::parse_str(src)?;
        parse_api_attr(tokens)
    }

    #[test]
    fn api_attr_captures_unknown_string_keys_into_extras() {
        // Target-specific metadata like `cli_group = "sheets"` must flow to
        // extras without bridge-core having to learn every key. This is the
        // mechanism `bridge-cli` relies on to project the layer-2 group tree.
        let args = parse_api_args(
            r#"service = "Engine", key = "doc_id", cli_group = "sheets", tauri_window = "main""#,
        )
        .expect("parse");
        assert_eq!(
            args.extras.get("cli_group").map(String::as_str),
            Some("sheets")
        );
        assert_eq!(
            args.extras.get("tauri_window").map(String::as_str),
            Some("main")
        );
        assert_eq!(args.extras.len(), 2);
        // Known keys still land on typed fields, not extras.
        assert!(!args.extras.contains_key("service"));
        assert!(!args.extras.contains_key("key"));
    }

    #[test]
    fn api_attr_non_string_unknown_value_is_rejected() {
        // `cli_group = 42` is almost always a mistake — reject with a clear
        // diagnostic instead of silently accepting and letting the downstream
        // target produce a confusing error far from the source.
        let err = parse_api_args(r#"cli_group = 42"#).expect_err("must reject non-string");
        assert!(
            err.to_string().contains("must be a string literal"),
            "expected string-literal diagnostic, got: {}",
            err
        );
    }

    #[test]
    fn empty_extras_emits_no_extras_block() {
        // Backward-compat guarantee: an impl block with no extras must emit
        // byte-identical DSL to the pre-extras shape so downstream parsers
        // (bridge-napi/pyo3/wasm/tauri) don't break. They start consuming the
        // new block only when it first appears.
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn plain(&self) -> u32 { 0 }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(
            !tokens.contains("extras"),
            "empty extras must not emit an extras block, got: {}",
            tokens
        );
    }

    #[test]
    fn non_empty_extras_roundtrip_through_emit() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn plain(&self) -> u32 { 0 }
            }
        "#;
        let mut desc = parse_impl(src).expect("parse");
        desc.extras
            .insert("cli_group".to_string(), "sheets".to_string());
        desc.extras
            .insert("bravo".to_string(), "charlie".to_string());
        let tokens = emit_descriptor(&desc, 0).to_string();
        // Both keys present.
        assert!(
            tokens.contains("cli_group = \"sheets\""),
            "emit: {}",
            tokens
        );
        assert!(tokens.contains("bravo = \"charlie\""), "emit: {}", tokens);
        // Deterministic order: BTreeMap iterates lexicographically, so `bravo`
        // comes before `cli_group` in the emitted token stream.
        let bravo_pos = tokens.find("bravo").expect("bravo in output");
        let cli_group_pos = tokens.find("cli_group").expect("cli_group in output");
        assert!(
            bravo_pos < cli_group_pos,
            "extras must emit in sorted order (BTreeMap), got: {}",
            tokens
        );
    }

    #[test]
    fn result_unit_success_is_fallible_without_success_return_type() {
        let item: syn::ItemFn =
            syn::parse_str("fn save() -> Result<(), SaveError> { todo!() }").expect("parse");
        let (return_type, error_type, is_fallible) = parse_return_type(&item.sig.output);

        assert!(return_type.is_none());
        assert_eq!(
            error_type
                .as_ref()
                .map(|ty| quote::quote!(#ty).to_string())
                .as_deref(),
            Some("SaveError")
        );
        assert!(is_fallible);
    }

    #[test]
    fn byte_like_params_classify_narrowly() {
        fn classify(src: &str) -> ParamTag {
            let ty: syn::Type = syn::parse_str(src).expect("type");
            classify_param_type(&ty, false)
        }

        assert!(matches!(classify("Vec<u8>"), ParamTag::Bytes));
        assert!(matches!(classify("Vec<String>"), ParamTag::Serde));
        assert!(matches!(classify("&[u8]"), ParamTag::Bytes));
        assert!(matches!(classify("&[String]"), ParamTag::Serde));
    }

    #[test]
    fn access_kind_subscribe_is_accepted_and_other_kinds_are_rejected() {
        let ok = parse_impl(
            r#"
            impl Engine {
                #[bridge::read(kind = "subscribe")]
                pub fn watch(&self) {}
            }
        "#,
        )
        .expect("subscribe kind");
        assert_eq!(ok.methods.len(), 1);

        let err = parse_impl(
            r#"
            impl Engine {
                #[bridge::read(kind = "notify")]
                pub fn watch(&self) {}
            }
        "#,
        )
        .expect_err("unknown kind");
        assert!(
            err.to_string().contains("unknown bridge access kind 'notify'"),
            "unexpected diagnostic: {}",
            err
        );
    }

    #[test]
    fn malformed_skip_attribute_is_ignored() {
        let desc = parse_impl(
            r#"
            impl Engine {
                #[bridge::read]
                #[bridge::skip("wasm")]
                pub fn load(&self) {}
            }
        "#,
        )
        .expect("parse");

        assert_eq!(desc.methods.len(), 1);
        assert!(desc.methods[0].skip_targets.is_empty());
    }

    #[test]
    fn tagged_enum_unknown_field_tag_is_rejected() {
        let err = parse_impl(
            r#"
            impl Engine {
                #[bridge::read]
                pub fn probe(
                    &self,
                    #[bridge::tagged_enum(
                        name = "Msg",
                        tag = "kind",
                        variants(Hello { name: unknown }),
                    )]
                    msg: Msg,
                ) {}
            }
        "#,
        )
        .expect_err("unknown tag");

        assert!(
            err.to_string().contains("unknown field tag 'unknown'"),
            "unexpected diagnostic: {}",
            err
        );
    }

    #[test]
    fn unknown_lifecycle_args_leave_method_unannotated() {
        let desc = parse_impl(
            r#"
            impl Service {
                #[bridge::lifecycle(destroy)]
                pub fn close(self) {}
            }
        "#,
        )
        .expect("parse");

        assert!(desc.methods.is_empty());
    }

    #[test]
    fn pure_and_session_args_are_ignored() {
        let desc = parse_impl(
            r#"
            impl Service {
                #[bridge::pure(anything)]
                pub fn version() -> u32 { 1 }
                #[bridge::session(anything)]
                pub fn select(&self) {}
            }
        "#,
        )
        .expect("parse");

        assert_eq!(desc.methods.len(), 2);
        assert_eq!(desc.methods[0].access, AccessLevel::Pure);
        assert_eq!(desc.methods[1].access, AccessLevel::Session);
        assert_eq!(desc.methods[1].scope, None);
        assert!(!desc.methods[1].needs_principal);
    }

    #[test]
    fn api_known_non_string_values_are_ignored_but_unknowns_error() {
        let args = parse_api_args(
            r#"service = 42, key = 42, group = 42, fn_prefix = 42, crate_path = 42"#,
        )
        .expect("known keys");

        assert!(args.service.is_none());
        assert!(args.group.is_none());
        assert!(args.fn_prefix.is_none());
        assert!(args.crate_path.is_none());
        assert!(args.extras.is_empty());

        let err = parse_api_args(r#"target = 42"#).expect_err("unknown key");
        assert!(
            err.to_string().contains("must be a string literal"),
            "unexpected diagnostic: {}",
            err
        );
    }

    #[test]
    fn bridge_attr_detection_covers_method_and_param_attrs() {
        let item: syn::ItemImpl = syn::parse_str(
            r#"
            impl Engine {
                #[bridge::read]
                pub fn load(&self, #[bridge::parse] key: Key) {}
            }
        "#,
        )
        .expect("parse");

        let method = match &item.items[0] {
            syn::ImplItem::Fn(method) => method,
            _ => panic!("expected method"),
        };
        let param = match &method.sig.inputs[1] {
            syn::FnArg::Typed(param) => param,
            _ => panic!("expected typed param"),
        };

        assert!(is_bridge_attr(&method.attrs[0]));
        assert!(is_bridge_attr(&param.attrs[0]));
    }
