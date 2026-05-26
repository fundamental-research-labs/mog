//! Descriptor DSL parser — thin adapter layer over `bridge_ir`.
//!
//! The actual DSL grammar (`bridge_version = 1; group = ...; service = ...;
//! method <access> <name> { ... }` and so on) is parsed by
//! [`bridge_ir::ApiDescriptor`]. This file keeps the historical
//! `impl Parse for NapiDescriptor` entry point so `syn::parse2::<NapiDescriptor>`
//! call sites in `expand_fn.rs` / `expand_class.rs` continue to work
//! unchanged — it just delegates to bridge-ir then converts the result to
//! the napi-local adapter IR (see `ir.rs`'s `From<bridge_ir::ApiDescriptor>
//! for NapiDescriptor` impl).
//!
//! All tests historically in this module that exercised parsing live on;
//! they now cover the adapter end-to-end (bridge-ir parses, adapter
//! converts) rather than a napi-local parser that no longer exists.

use syn::parse::{Parse, ParseStream};

use crate::ir::{ApiDescriptor, NapiDescriptor};

impl Parse for NapiDescriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // bridge-ir owns the grammar; we're a thin adapter.
        let shared: ApiDescriptor = input.parse()?;
        Ok(NapiDescriptor::from(shared))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{NapiAccess, NapiFieldTag, NapiParamTag};

    fn parse_descriptor(tokens: &str) -> syn::Result<NapiDescriptor> {
        syn::parse_str::<NapiDescriptor>(tokens)
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
        assert_eq!(desc.methods[0].access, NapiAccess::LifecycleCreate);
        assert_eq!(desc.methods[0].name, "new");
        assert_eq!(desc.methods[1].access, NapiAccess::Read);
        assert_eq!(desc.methods[1].name, "get");
    }

    #[test]
    fn parse_session_method_collapses_to_read() {
        // R2.4: `method session` exists in the bridge-core IR to mark
        // interior-mutable `&self` methods. At the napi FFI layer it
        // is identical to `method read` — same `&self` receiver, same
        // JSON serde wire. The adapter collapses to `NapiAccess::Read`
        // so the downstream emission path (`emit_class_method`) picks
        // `&self`, avoiding the `&mut self` promotion that `method
        // write` would impose and defeat the ArcSwap design.
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
        assert_eq!(
            desc.methods[0].access,
            NapiAccess::Read,
            "`method session` must collapse to NapiAccess::Read so codegen emits &self"
        );
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
        assert_eq!(m.params[0].tag, NapiParamTag::Str);
        assert_eq!(m.params[0].name, "key");
        assert_eq!(m.params[1].tag, NapiParamTag::Prim);
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
        assert_eq!(m.params[0].tag, NapiParamTag::Parse);
        assert!(m.params[0].ty.contains("KeyId"));
    }

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
                            Sheet = "sheet" { sheet_id as "sheetId": serde, },
                            Column = "column" { sheet_id as "sheetId": serde, col_id as "colId": serde, },
                        )
                    ] target: AccessTarget,
                }
                return_type = bool;
            }
        "#;
        let desc: NapiDescriptor = syn::parse_str(input).unwrap();
        let m = &desc.methods[0];
        assert_eq!(m.params.len(), 1);
        let spec = match &m.params[0].tag {
            NapiParamTag::TaggedEnum(s) => s,
            other => panic!("expected TaggedEnum, got {:?}", other),
        };
        assert_eq!(spec.type_name, "AccessTarget");
        assert_eq!(spec.tag, "kind");
        assert_eq!(spec.content, None);
        assert_eq!(spec.variants.len(), 3);
        assert_eq!(spec.variants[0].rust_name, "Workbook");
        assert_eq!(spec.variants[0].wire_name, "workbook");
        assert!(spec.variants[0].fields.is_empty());
        assert_eq!(spec.variants[1].rust_name, "Sheet");
        assert_eq!(spec.variants[1].wire_name, "sheet");
        assert_eq!(spec.variants[1].fields.len(), 1);
        assert_eq!(spec.variants[1].fields[0].rust_name, "sheet_id");
        assert_eq!(spec.variants[1].fields[0].wire_name, "sheetId");
        assert_eq!(spec.variants[1].fields[0].field_tag, NapiFieldTag::Serde);
        assert_eq!(spec.variants[2].fields.len(), 2);
    }

    #[test]
    fn structural_access_collapses_to_write_codegen() {
        // bridge-ir preserves `Structural` as a distinct access level; the
        // napi adapter collapses it to Write (identical FFI shape) so
        // downstream generators keep working.
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
        let desc: NapiDescriptor = syn::parse_str(input).unwrap();
        assert_eq!(desc.methods[1].access, NapiAccess::Write);
    }
}
