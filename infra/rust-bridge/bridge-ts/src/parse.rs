//! Parse Rust source files with `syn` to extract bridge API shapes.
//!
//! This duplicates a subset of bridge-core's parsing logic, operating on source
//! files rather than proc-macro tokens. The annotation format is the stable
//! contract between bridge-core and bridge-ts.

use crate::mapping::rust_type_to_ts;
use crate::types::*;

/// Parse a Rust source file string and extract all bridge API definitions.
pub fn parse_source(source: &str) -> Result<Vec<ParsedImplBlock>, String> {
    let file: syn::File =
        syn::parse_str(source).map_err(|e| format!("Failed to parse Rust source: {}", e))?;

    let mut blocks = Vec::new();
    for item in &file.items {
        if let syn::Item::Impl(impl_block) = item
            && let Some(parsed) = parse_impl_block(impl_block)?
        {
            blocks.push(parsed);
        }
    }
    Ok(blocks)
}

/// A parsed `#[bridge::api]` impl block before merging.
#[derive(Debug, Clone)]
pub struct ParsedImplBlock {
    /// The Rust type name (e.g., `KvStore`).
    pub type_name: String,
    /// Service metadata if this is a stateful service.
    pub service_key: Option<ServiceKey>,
    /// Optional command name prefix override (from `fn_prefix = "..."`).
    pub fn_prefix: Option<String>,
    /// Methods found in this impl block.
    pub methods: Vec<TsMethod>,
}

/// Merge multiple `ParsedImplBlock`s into a `TsApi`.
///
/// Blocks with the same type_name are merged into a single `TsService`.
pub fn merge_blocks(blocks: Vec<ParsedImplBlock>) -> TsApi {
    use std::collections::BTreeMap;

    // Group by type_name, preserving insertion order with BTreeMap
    let mut services: BTreeMap<String, TsService> = BTreeMap::new();

    for block in blocks {
        let entry = services
            .entry(block.type_name.clone())
            .or_insert_with(|| TsService {
                rust_name: block.type_name.clone(),
                key: block.service_key.clone(),
                fn_prefix: block.fn_prefix.clone(),
                methods: Vec::new(),
            });
        // If a later block provides service key and the first didn't, adopt it
        if entry.key.is_none() && block.service_key.is_some() {
            entry.key = block.service_key;
        }
        // If a later block provides fn_prefix and the first didn't, adopt it
        if entry.fn_prefix.is_none() && block.fn_prefix.is_some() {
            entry.fn_prefix = block.fn_prefix;
        }
        entry.methods.extend(block.methods.into_iter().filter(|m| {
            // Skip methods that are marked for all platforms or for wasm/tauri
            !m.skip_platforms.contains(&"all".to_string())
                && !m.skip_platforms.contains(&"wasm".to_string())
                && !m.skip_platforms.contains(&"tauri".to_string())
        }));
    }

    TsApi {
        services: services.into_values().collect(),
    }
}

/// Parse a single impl block, returning `None` if it doesn't have `#[bridge::api]`.
fn parse_impl_block(item: &syn::ItemImpl) -> Result<Option<ParsedImplBlock>, String> {
    // Find #[bridge::api(...)] attribute
    let api_attr = item.attrs.iter().find(|a| is_bridge_api_attr(a));
    let api_attr = match api_attr {
        Some(a) => a,
        None => return Ok(None),
    };

    // Extract type name
    let type_name = extract_type_name(&item.self_ty)
        .ok_or_else(|| "Cannot determine type name from impl block".to_string())?;

    // Parse attribute args: service, key, group, fn_prefix
    let (service_key, _group, fn_prefix) = parse_api_attr_args(api_attr)?;

    // Parse methods
    let mut methods = Vec::new();
    for impl_item in &item.items {
        if let syn::ImplItem::Fn(method) = impl_item
            && let Some(ts_method) = parse_method(method, &type_name)?
        {
            methods.push(ts_method);
        }
    }

    Ok(Some(ParsedImplBlock {
        type_name,
        service_key,
        fn_prefix,
        methods,
    }))
}

/// Check if an attribute is `#[bridge::api]` or `#[bridge::api(...)]`.
fn is_bridge_api_attr(attr: &syn::Attribute) -> bool {
    let segs: Vec<_> = attr.path().segments.iter().collect();
    segs.len() == 2 && segs[0].ident == "bridge" && segs[1].ident == "api"
}

/// Extract the type name from an impl's self type.
fn extract_type_name(ty: &syn::Type) -> Option<String> {
    if let syn::Type::Path(p) = ty {
        p.path.segments.last().map(|s| s.ident.to_string())
    } else {
        None
    }
}

type ApiAttrArgs = (Option<ServiceKey>, Option<String>, Option<String>);

/// Parse `#[bridge::api(service = "Foo", key = "bar", group = "ops", fn_prefix = "compute")]` args.
fn parse_api_attr_args(attr: &syn::Attribute) -> Result<ApiAttrArgs, String> {
    let mut key_param: Option<String> = None;
    let mut group: Option<String> = None;
    let mut fn_prefix: Option<String> = None;

    // Try to parse the attribute's arguments as name-value pairs
    let nested = match &attr.meta {
        syn::Meta::List(list) => {
            let parser = syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated;
            syn::parse::Parser::parse2(parser, list.tokens.clone())
                .map_err(|e| format!("Failed to parse bridge::api args: {}", e))?
        }
        syn::Meta::Path(_) => {
            // #[bridge::api] with no args
            return Ok((None, None, None));
        }
        _ => return Ok((None, None, None)),
    };

    for meta in &nested {
        if let syn::Meta::NameValue(nv) = meta {
            let ident = nv.path.get_ident().map(|i| i.to_string());
            match ident.as_deref() {
                Some("key") => {
                    if let syn::Expr::Lit(lit) = &nv.value
                        && let syn::Lit::Str(s) = &lit.lit
                    {
                        key_param = Some(s.value());
                    }
                }
                Some("group") => {
                    if let syn::Expr::Lit(lit) = &nv.value
                        && let syn::Lit::Str(s) = &lit.lit
                    {
                        group = Some(s.value());
                    }
                }
                Some("fn_prefix") => {
                    if let syn::Expr::Lit(lit) = &nv.value
                        && let syn::Lit::Str(s) = &lit.lit
                    {
                        fn_prefix = Some(s.value());
                    }
                }
                _ => {} // ignore service, etc. for TS generation
            }
        }
    }

    let service_key = key_param.map(|param_name| ServiceKey { param_name });
    Ok((service_key, group, fn_prefix))
}

/// Parse a single method in an impl block.
fn parse_method(method: &syn::ImplItemFn, type_name: &str) -> Result<Option<TsMethod>, String> {
    // Determine access level from bridge attributes
    let access = match parse_method_access(&method.attrs) {
        Some(a) => a,
        None => return Ok(None), // No bridge annotation, skip
    };

    let sig = &method.sig;
    let rust_name = sig.ident.to_string();

    // Parse parameters (skip self)
    let mut params = Vec::new();
    for arg in &sig.inputs {
        if let syn::FnArg::Typed(pat_type) = arg {
            let param_name = extract_param_name(&pat_type.pat)?;
            let is_parse = has_parse_attr(&pat_type.attrs);
            let ts_type = rust_type_to_ts(&pat_type.ty, is_parse);
            params.push(TsParam {
                rust_name: param_name,
                ts_type,
                is_parse,
            });
        }
    }

    // Parse return type
    let (return_type, is_fallible) = parse_return_type(&sig.output, type_name, access);

    // Parse skip platforms
    let skip_platforms = parse_skip_platforms(&method.attrs);

    Ok(Some(TsMethod {
        rust_name,
        access,
        params,
        return_type,
        is_fallible,
        skip_platforms,
    }))
}

/// Detect the bridge access level from attributes.
///
/// For `bridge::write` and friends, also inspects the attribute arguments for
/// `kind = "subscribe"`, which upgrades the access to `LifecycleSubscribe` so
/// the method is tagged as `'lifecycle'` in the generated method-kind manifest.
fn parse_method_access(attrs: &[syn::Attribute]) -> Option<MethodAccess> {
    for attr in attrs {
        let segs: Vec<_> = attr.path().segments.iter().collect();
        if segs.len() == 2 && segs[0].ident == "bridge" {
            match segs[1].ident.to_string().as_str() {
                "read" | "async_read" => return Some(MethodAccess::Read),
                // `structural` methods rebuild structural state and are treated as writes
                // at the TS bridge level (they return `MutationResult`, same as `write`).
                "write" | "async_write" | "structural" => {
                    if has_subscribe_kind(attr) {
                        return Some(MethodAccess::LifecycleSubscribe);
                    }
                    return Some(MethodAccess::Write);
                }
                "pure" => return Some(MethodAccess::Pure),
                "lifecycle" => return Some(MethodAccess::LifecycleCreate),
                _ => {}
            }
        }
    }
    None
}

/// Return `true` if this access attribute carries `kind = "subscribe"` in its
/// argument list. Tolerates any combination of `scope = "..."`,
/// `needs_principal`, and `kind = "..."`.
fn has_subscribe_kind(attr: &syn::Attribute) -> bool {
    let list = match &attr.meta {
        syn::Meta::List(list) => list,
        _ => return false,
    };
    let parser = syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated;
    let nested = match syn::parse::Parser::parse2(parser, list.tokens.clone()) {
        Ok(n) => n,
        Err(_) => return false,
    };
    for meta in &nested {
        if let syn::Meta::NameValue(nv) = meta
            && nv.path.get_ident().map(|i| i.to_string()).as_deref() == Some("kind")
            && let syn::Expr::Lit(lit) = &nv.value
            && let syn::Lit::Str(s) = &lit.lit
            && s.value() == "subscribe"
        {
            return true;
        }
    }
    false
}

/// Check if a parameter has `#[bridge::parse]`.
fn has_parse_attr(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|a| {
        let segs: Vec<_> = a.path().segments.iter().collect();
        segs.len() == 2 && segs[0].ident == "bridge" && segs[1].ident == "parse"
    })
}

/// Extract parameter name from pattern.
fn extract_param_name(pat: &syn::Pat) -> Result<String, String> {
    match pat {
        syn::Pat::Ident(pi) => Ok(pi.ident.to_string()),
        _ => Err("Unsupported parameter pattern".into()),
    }
}

/// Parse a return type, unwrapping `Result<T, E>` into just `T`.
fn parse_return_type(
    output: &syn::ReturnType,
    type_name: &str,
    access: MethodAccess,
) -> (TsType, bool) {
    match output {
        syn::ReturnType::Default => (TsType::Void, false),
        syn::ReturnType::Type(_, ty) => {
            // Check for Result<T, E>
            if let syn::Type::Path(p) = ty.as_ref()
                && let Some(seg) = p.path.segments.last()
                && seg.ident == "Result"
                && let syn::PathArguments::AngleBracketed(args) = &seg.arguments
            {
                let types: Vec<&syn::Type> = args
                    .args
                    .iter()
                    .filter_map(|a| {
                        if let syn::GenericArgument::Type(t) = a {
                            Some(t)
                        } else {
                            None
                        }
                    })
                    .collect();
                if types.len() == 2 {
                    let mut ts_ok = rust_type_to_ts(types[0], false);
                    ts_ok = substitute_self(ts_ok, type_name, access);
                    return (ts_ok, true);
                }
            }
            // Non-Result return type
            let ts = rust_type_to_ts(ty, false);
            (substitute_self(ts, type_name, access), false)
        }
    }
}

/// Recursively replace `TsType::Named("Self")` in a type tree.
///
/// For `LifecycleCreate`, Self -> Void (lifecycle creates return the key, not the struct).
/// For other access levels, Self -> Named(type_name).
fn substitute_self(ty: TsType, type_name: &str, access: MethodAccess) -> TsType {
    match ty {
        TsType::Named(ref name) if name == "Self" => {
            if access == MethodAccess::LifecycleCreate {
                TsType::Void
            } else {
                TsType::Named(type_name.to_string())
            }
        }
        TsType::Array(inner) => TsType::Array(Box::new(substitute_self(*inner, type_name, access))),
        TsType::Nullable(inner) => {
            TsType::Nullable(Box::new(substitute_self(*inner, type_name, access)))
        }
        TsType::Record(k, v) => TsType::Record(
            Box::new(substitute_self(*k, type_name, access)),
            Box::new(substitute_self(*v, type_name, access)),
        ),
        TsType::Tuple(elems) => TsType::Tuple(
            elems
                .into_iter()
                .map(|e| substitute_self(e, type_name, access))
                .collect(),
        ),
        other => other,
    }
}

/// Parse `#[bridge::skip]` or `#[bridge::skip(wasm)]` or `#[bridge::skip(tauri)]` attributes.
/// Returns a list of platform names to skip. Bare `#[bridge::skip]` returns `["all"]`.
fn parse_skip_platforms(attrs: &[syn::Attribute]) -> Vec<String> {
    let mut platforms = Vec::new();
    for attr in attrs {
        let segs: Vec<_> = attr.path().segments.iter().collect();
        if segs.len() == 2 && segs[0].ident == "bridge" && segs[1].ident == "skip" {
            // Try to parse arguments
            match &attr.meta {
                syn::Meta::List(list) => {
                    // #[bridge::skip(wasm)] or #[bridge::skip(wasm, tauri)]
                    let parser =
                        syn::punctuated::Punctuated::<syn::Ident, syn::Token![,]>::parse_terminated;
                    if let Ok(idents) = syn::parse::Parser::parse2(parser, list.tokens.clone()) {
                        for ident in idents {
                            platforms.push(ident.to_string());
                        }
                    }
                }
                syn::Meta::Path(_) => {
                    // Bare #[bridge::skip] = skip all platforms
                    platforms.push("all".to_string());
                }
                _ => {}
            }
        }
    }
    platforms
}

#[cfg(test)]
mod tests {
    use super::*;

    const KV_SOURCE: &str = r#"
use bridge_core as bridge;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub struct KvUtils;

#[bridge::api]
impl KvUtils {
    #[bridge::pure]
    pub fn validate_key(key: &str, max_length: usize) -> Result<(), ValidationError> {
        todo!()
    }

    #[bridge::pure]
    pub fn hash_key(key: &str) -> u64 {
        todo!()
    }

    #[bridge::pure]
    pub fn is_valid_json(value: &str) -> bool {
        todo!()
    }
}

#[bridge::service]
pub struct KvStore {
    data: HashMap<String, String>,
}

#[bridge::api(service = "KvStore", key = "store_id", group = "ops")]
impl KvStore {
    #[bridge::lifecycle(create)]
    pub fn new(config: KvConfig) -> Result<Self, KvError> {
        todo!()
    }

    #[bridge::read]
    pub fn get(&self, key: &str) -> Result<String, KvError> {
        todo!()
    }

    #[bridge::write]
    pub fn set(&mut self, key: String, value: String) -> Result<(), KvError> {
        todo!()
    }

    #[bridge::write]
    pub fn delete(&mut self, key: &str) -> Result<String, KvError> {
        todo!()
    }

    #[bridge::read]
    pub fn get_by_id(&self, #[bridge::parse] id: &KeyId) -> Result<String, KvError> {
        todo!()
    }

    #[bridge::write]
    pub fn set_by_id(&mut self, #[bridge::parse] id: &KeyId, value: String) -> Result<(), KvError> {
        todo!()
    }
}

#[bridge::api(service = "KvStore", key = "store_id", group = "admin")]
impl KvStore {
    #[bridge::read]
    pub fn list_keys(&self) -> Vec<String> {
        todo!()
    }

    #[bridge::read]
    pub fn stats(&self) -> StoreStats {
        todo!()
    }
}
"#;

    #[test]
    fn parse_kv_source_finds_three_blocks() {
        let blocks = parse_source(KV_SOURCE).unwrap();
        assert_eq!(blocks.len(), 3);
    }

    #[test]
    fn kv_utils_is_stateless() {
        let blocks = parse_source(KV_SOURCE).unwrap();
        let utils = &blocks[0];
        assert_eq!(utils.type_name, "KvUtils");
        assert!(utils.service_key.is_none());
        assert_eq!(utils.methods.len(), 3);
    }

    #[test]
    fn kv_utils_methods() {
        let blocks = parse_source(KV_SOURCE).unwrap();
        let utils = &blocks[0];

        // validate_key
        let m = &utils.methods[0];
        assert_eq!(m.rust_name, "validate_key");
        assert_eq!(m.access, MethodAccess::Pure);
        assert!(m.is_fallible);
        assert_eq!(m.return_type, TsType::Void); // Result<(), E> → void
        assert_eq!(m.params.len(), 2);
        assert_eq!(m.params[0].rust_name, "key");
        assert_eq!(m.params[0].ts_type, TsType::String);
        assert_eq!(m.params[1].rust_name, "max_length");
        assert_eq!(m.params[1].ts_type, TsType::Number);

        // hash_key
        let m = &utils.methods[1];
        assert_eq!(m.rust_name, "hash_key");
        assert!(!m.is_fallible);
        assert_eq!(m.return_type, TsType::Number); // u64 → number

        // is_valid_json
        let m = &utils.methods[2];
        assert_eq!(m.rust_name, "is_valid_json");
        assert!(!m.is_fallible);
        assert_eq!(m.return_type, TsType::Boolean);
    }

    #[test]
    fn kv_store_ops_is_stateful() {
        let blocks = parse_source(KV_SOURCE).unwrap();
        let ops = &blocks[1];
        assert_eq!(ops.type_name, "KvStore");
        assert!(ops.service_key.is_some());
        assert_eq!(ops.service_key.as_ref().unwrap().param_name, "store_id");
        assert_eq!(ops.methods.len(), 6);
    }

    #[test]
    fn kv_store_lifecycle_create() {
        let blocks = parse_source(KV_SOURCE).unwrap();
        let ops = &blocks[1];
        let create = &ops.methods[0];
        assert_eq!(create.rust_name, "new");
        assert_eq!(create.access, MethodAccess::LifecycleCreate);
        assert!(create.is_fallible);
        assert_eq!(create.return_type, TsType::Void); // Self → void
        assert_eq!(create.params.len(), 1);
        assert_eq!(create.params[0].ts_type, TsType::Named("KvConfig".into()));
    }

    #[test]
    fn kv_store_parse_params() {
        let blocks = parse_source(KV_SOURCE).unwrap();
        let ops = &blocks[1];

        // get_by_id has [parse] on id param
        let get_by_id = &ops.methods[4];
        assert_eq!(get_by_id.rust_name, "get_by_id");
        assert!(get_by_id.params[0].is_parse);
        assert_eq!(get_by_id.params[0].ts_type, TsType::String); // [parse] → string
    }

    #[test]
    fn kv_store_admin_group() {
        let blocks = parse_source(KV_SOURCE).unwrap();
        let admin = &blocks[2];
        assert_eq!(admin.type_name, "KvStore");
        assert_eq!(admin.methods.len(), 2);

        let list_keys = &admin.methods[0];
        assert_eq!(list_keys.rust_name, "list_keys");
        assert_eq!(
            list_keys.return_type,
            TsType::Array(Box::new(TsType::String))
        );
        assert!(!list_keys.is_fallible);

        let stats = &admin.methods[1];
        assert_eq!(stats.rust_name, "stats");
        assert_eq!(stats.return_type, TsType::Named("StoreStats".into()));
    }

    #[test]
    fn merge_blocks_combines_services() {
        let blocks = parse_source(KV_SOURCE).unwrap();
        let api = merge_blocks(blocks);

        assert_eq!(api.services.len(), 2); // KvUtils + KvStore

        let kv_utils = &api.services[0];
        assert_eq!(kv_utils.rust_name, "KvStore"); // BTreeMap sorts by key
        assert!(kv_utils.key.is_some());
        assert_eq!(kv_utils.methods.len(), 8); // 6 ops + 2 admin

        let kv_store = &api.services[1];
        assert_eq!(kv_store.rust_name, "KvUtils");
        assert!(kv_store.key.is_none());
        assert_eq!(kv_store.methods.len(), 3);
    }

    #[test]
    fn no_bridge_attrs_returns_empty() {
        let source = r#"
            pub struct Foo;
            impl Foo {
                pub fn bar() -> u32 { 42 }
            }
        "#;
        let blocks = parse_source(source).unwrap();
        assert!(blocks.is_empty());
    }

    #[test]
    fn fn_prefix_parsed_from_attr() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api(service = "Engine", key = "doc_id", fn_prefix = "compute")]
impl Engine {
    #[bridge::read]
    pub fn get_value(&self) -> String { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        assert_eq!(blocks[0].fn_prefix, Some("compute".into()));
    }

    #[test]
    fn fn_prefix_empty_string() {
        let source = r#"
use bridge_core as bridge;
pub struct PivotBridge;
#[bridge::api(fn_prefix = "")]
impl PivotBridge {
    #[bridge::pure]
    pub fn pivot_compute(config: &str) -> String { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        assert_eq!(blocks[0].fn_prefix, Some("".into()));
    }

    #[test]
    fn fn_prefix_none_when_absent() {
        let source = r#"
use bridge_core as bridge;
pub struct Utils;
#[bridge::api]
impl Utils {
    #[bridge::pure]
    pub fn hash(key: &str) -> u64 { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        assert_eq!(blocks[0].fn_prefix, None);
    }

    #[test]
    fn fn_prefix_propagated_through_merge() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api(key = "doc_id", fn_prefix = "compute")]
impl Engine {
    #[bridge::read]
    pub fn get_value(&self) -> String { todo!() }
}
#[bridge::api(key = "doc_id", group = "admin")]
impl Engine {
    #[bridge::read]
    pub fn list_all(&self) -> Vec<String> { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        let api = merge_blocks(blocks);
        assert_eq!(api.services.len(), 1);
        assert_eq!(api.services[0].fn_prefix, Some("compute".into()));
        assert_eq!(api.services[0].methods.len(), 2);
    }

    #[test]
    fn fn_prefix_adopted_from_later_block() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api(key = "doc_id")]
impl Engine {
    #[bridge::read]
    pub fn get_value(&self) -> String { todo!() }
}
#[bridge::api(key = "doc_id", fn_prefix = "compute")]
impl Engine {
    #[bridge::read]
    pub fn list_all(&self) -> Vec<String> { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        let api = merge_blocks(blocks);
        assert_eq!(api.services[0].fn_prefix, Some("compute".into()));
    }

    #[test]
    fn self_in_tuple_return_lifecycle() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api(key = "doc_id")]
impl Engine {
    #[bridge::lifecycle(create)]
    pub fn from_snapshot(snapshot: WorkbookSnapshot) -> Result<(Self, RecalcResult), EngineError> {
        todo!()
    }
}
"#;
        let blocks = parse_source(source).unwrap();
        let m = &blocks[0].methods[0];
        assert_eq!(m.rust_name, "from_snapshot");
        // (Self, RecalcResult) with lifecycle -> [void, RecalcResult]
        assert_eq!(
            m.return_type,
            TsType::Tuple(vec![TsType::Void, TsType::Named("RecalcResult".into())])
        );
    }

    #[test]
    fn self_in_tuple_return_read() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api(key = "doc_id")]
impl Engine {
    #[bridge::read]
    pub fn clone_state(&self) -> Result<(Self, StateInfo), EngineError> {
        todo!()
    }
}
"#;
        let blocks = parse_source(source).unwrap();
        let m = &blocks[0].methods[0];
        // (Self, StateInfo) with read -> [Engine, StateInfo]
        assert_eq!(
            m.return_type,
            TsType::Tuple(vec![
                TsType::Named("Engine".into()),
                TsType::Named("StateInfo".into())
            ])
        );
    }

    #[test]
    fn self_return_lifecycle_preserved() {
        // Existing behavior: Result<Self, E> with lifecycle -> void
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api(key = "doc_id")]
impl Engine {
    #[bridge::lifecycle(create)]
    pub fn new(config: Config) -> Result<Self, EngineError> {
        todo!()
    }
}
"#;
        let blocks = parse_source(source).unwrap();
        let m = &blocks[0].methods[0];
        assert_eq!(m.return_type, TsType::Void);
    }

    #[test]
    fn bridge_skip_wasm() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api(key = "doc_id")]
impl Engine {
    #[bridge::read]
    pub fn get_value(&self) -> String { todo!() }

    #[bridge::skip(wasm)]
    #[bridge::lifecycle(create)]
    pub fn from_snapshot(snapshot: Snapshot) -> Result<Self, Error> { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        let api = merge_blocks(blocks);
        // from_snapshot should be filtered out (skip wasm)
        assert_eq!(api.services[0].methods.len(), 1);
        assert_eq!(api.services[0].methods[0].rust_name, "get_value");
    }

    #[test]
    fn bridge_skip_bare() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api]
impl Engine {
    #[bridge::pure]
    pub fn compute(&self) -> u32 { todo!() }

    #[bridge::skip]
    #[bridge::pure]
    pub fn internal_only(&self) -> u32 { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        let api = merge_blocks(blocks);
        assert_eq!(api.services[0].methods.len(), 1);
        assert_eq!(api.services[0].methods[0].rust_name, "compute");
    }

    #[test]
    fn bridge_skip_tauri() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api]
impl Engine {
    #[bridge::pure]
    pub fn compute(&self) -> u32 { todo!() }

    #[bridge::skip(tauri)]
    #[bridge::pure]
    pub fn wasm_only(&self) -> u32 { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        let api = merge_blocks(blocks);
        assert_eq!(api.services[0].methods.len(), 1);
        assert_eq!(api.services[0].methods[0].rust_name, "compute");
    }

    #[test]
    fn parse_skip_platforms_recognizes_ts_bridge() {
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api]
impl Engine {
    #[bridge::skip(ts_bridge)]
    #[bridge::read]
    pub fn get_value(&self) -> String { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        let m = &blocks[0].methods[0];
        assert_eq!(m.rust_name, "get_value");
        assert_eq!(m.skip_platforms, vec!["ts_bridge".to_string()]);
    }

    #[test]
    fn skip_ts_bridge_not_filtered_by_merge() {
        // Methods with skip(ts_bridge) should NOT be filtered out by merge_blocks,
        // because the current client gen (wasm/tauri) still needs them.
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api]
impl Engine {
    #[bridge::pure]
    pub fn compute(&self) -> u32 { todo!() }

    #[bridge::skip(ts_bridge)]
    #[bridge::pure]
    pub fn ts_bridge_only(&self) -> u32 { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        let api = merge_blocks(blocks);
        // Both methods should be present — ts_bridge is not a filtered platform
        assert_eq!(api.services[0].methods.len(), 2);
        assert_eq!(api.services[0].methods[0].rust_name, "compute");
        assert_eq!(api.services[0].methods[1].rust_name, "ts_bridge_only");
        assert_eq!(
            api.services[0].methods[1].skip_platforms,
            vec!["ts_bridge".to_string()]
        );
    }

    #[test]
    fn skip_ts_bridge_combined_with_wasm() {
        // A method can be skipped for multiple platforms
        let source = r#"
use bridge_core as bridge;
pub struct Engine;
#[bridge::api]
impl Engine {
    #[bridge::skip(wasm, ts_bridge)]
    #[bridge::pure]
    pub fn tauri_only(&self) -> u32 { todo!() }

    #[bridge::pure]
    pub fn everywhere(&self) -> u32 { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        // Before merge: method has both platforms in skip list
        let m = &blocks[0].methods[0];
        assert_eq!(
            m.skip_platforms,
            vec!["wasm".to_string(), "ts_bridge".to_string()]
        );

        // After merge: filtered out because it contains "wasm"
        let api = merge_blocks(blocks);
        assert_eq!(api.services[0].methods.len(), 1);
        assert_eq!(api.services[0].methods[0].rust_name, "everywhere");
    }

    #[test]
    fn access_field_roundtrips_all_variants() {
        let source = r#"
use bridge_core as bridge;
pub struct Svc;
#[bridge::api(key = "id")]
impl Svc {
    #[bridge::pure]
    pub fn pure_fn(x: u32) -> u32 { todo!() }

    #[bridge::read]
    pub fn read_fn(&self) -> String { todo!() }

    #[bridge::write]
    pub fn write_fn(&mut self, val: String) -> () { todo!() }

    #[bridge::lifecycle(create)]
    pub fn create_fn(cfg: String) -> Result<Self, String> { todo!() }
}
"#;
        let blocks = parse_source(source).unwrap();
        let methods = &blocks[0].methods;

        assert_eq!(methods[0].rust_name, "pure_fn");
        assert_eq!(methods[0].access, MethodAccess::Pure);

        assert_eq!(methods[1].rust_name, "read_fn");
        assert_eq!(methods[1].access, MethodAccess::Read);

        assert_eq!(methods[2].rust_name, "write_fn");
        assert_eq!(methods[2].access, MethodAccess::Write);

        assert_eq!(methods[3].rust_name, "create_fn");
        assert_eq!(methods[3].access, MethodAccess::LifecycleCreate);
    }
}
