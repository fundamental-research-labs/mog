//! Named-type reference collection shared by emitters.

use std::collections::BTreeSet;

use crate::types::*;

/// Collect all `TsType::Named` references from an API's method params and return types.
/// Filters out `"unknown"` (opaque JSON from `serde_json::Value`).
pub fn collect_named_from_api(api: &TsApi) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for svc in &api.services {
        for method in &svc.methods {
            for param in &method.params {
                collect_named_from_type(&param.ts_type, &mut names);
            }
            collect_named_from_type(&method.return_type, &mut names);
        }
    }
    names.remove("unknown");
    names
}

/// Recursively collect all `TsType::Named` type names from a type definition.
pub(crate) fn collect_named_types(def: &TsTypeDef, names: &mut BTreeSet<String>) {
    match def {
        TsTypeDef::Interface(iface) => {
            for field in &iface.fields {
                collect_named_from_type(&field.ts_type, names);
            }
        }
        TsTypeDef::StringUnion(_) => {}
        TsTypeDef::TaggedUnion(union) => {
            for variant in &union.variants {
                collect_named_from_type(&variant.data_type, names);
            }
        }
        TsTypeDef::TypeAlias { target, .. } => {
            collect_named_from_type(target, names);
        }
    }
}

/// Recursively collect `Named` types from a `TsType`.
pub(crate) fn collect_named_from_type(ty: &TsType, names: &mut BTreeSet<String>) {
    match ty {
        TsType::Named(name) => {
            // Inline object literals (e.g. "{ row: number; col: number }") and
            // built-in TS types (e.g. "unknown") are not external imports.
            if !name.starts_with('{') && name != "unknown" {
                names.insert(name.clone());
            }
        }
        TsType::Array(inner) | TsType::Nullable(inner) => {
            collect_named_from_type(inner, names);
        }
        TsType::Record(k, v) => {
            collect_named_from_type(k, names);
            collect_named_from_type(v, names);
        }
        TsType::Tuple(elems) => {
            for e in elems {
                collect_named_from_type(e, names);
            }
        }
        _ => {}
    }
}
