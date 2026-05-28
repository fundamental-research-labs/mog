use crate::mapping::rust_type_to_ts;
use crate::parse_types::config::TypeGenConfig;
use crate::types::TsType;

/// Map a Rust type name from `serde(into = "...")` to a TsType.
pub(super) fn into_target_to_ts_type(target: &str) -> TsType {
    match target {
        "String" | "&str" | "std::string::String" => TsType::String,
        "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "f32" | "f64" | "usize"
        | "isize" => TsType::Number,
        "bool" => TsType::Boolean,
        other => TsType::Named(other.to_string()),
    }
}
/// Resolve a `syn::Type` to a `TsType`, checking the external_type_map first.
pub(super) fn resolve_type(ty: &syn::Type, config: &TypeGenConfig) -> TsType {
    // 1. Check external_type_map by last segment name and full path
    if let syn::Type::Path(type_path) = ty {
        let full_path = path_to_string(&type_path.path);

        // Check full path first (e.g., "serde_json::Value")
        if let Some(mapped) = config.external_type_map.get(&full_path) {
            return mapped.clone();
        }

        // Check last segment name (e.g., "FiniteF64", "Value")
        if let Some(last) = type_path.path.segments.last() {
            let last_name = last.ident.to_string();
            if let Some(mapped) = config.external_type_map.get(&last_name) {
                return mapped.clone();
            }
        }
    }

    // 2. Unwrap transparent wrappers: Arc<T>, Box<T>
    if let syn::Type::Path(type_path) = ty
        && let Some(last) = type_path.path.segments.last()
    {
        let name = last.ident.to_string();
        if (name == "Arc" || name == "Box")
            && let syn::PathArguments::AngleBracketed(args) = &last.arguments
            && args.args.len() == 1
            && let syn::GenericArgument::Type(inner) = &args.args[0]
        {
            return resolve_type(inner, config);
        }
    }

    // 2b. Resolve container inner types through external_type_map:
    //     Vec<T> -> T[], Option<T> -> T | null, HashMap<K,V> -> Record<K,V>
    if let syn::Type::Path(type_path) = ty
        && let Some(last) = type_path.path.segments.last()
    {
        let name = last.ident.to_string();
        if let syn::PathArguments::AngleBracketed(args) = &last.arguments {
            match name.as_str() {
                "Vec" if args.args.len() == 1 => {
                    if let syn::GenericArgument::Type(inner) = &args.args[0] {
                        // Vec<u8> → Uint8Array (special case)
                        if let syn::Type::Path(p) = inner
                            && p.path.is_ident("u8")
                        {
                            return TsType::Uint8Array;
                        }
                        return TsType::Array(Box::new(resolve_type(inner, config)));
                    }
                }
                "Option" if args.args.len() == 1 => {
                    if let syn::GenericArgument::Type(inner) = &args.args[0] {
                        return TsType::Nullable(Box::new(resolve_type(inner, config)));
                    }
                }
                "HashMap" | "BTreeMap" if args.args.len() == 2 => {
                    let types: Vec<_> = args
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
                        return TsType::Record(
                            Box::new(resolve_type(types[0], config)),
                            Box::new(resolve_type(types[1], config)),
                        );
                    }
                }
                _ => {}
            }
        }
    }

    // 3. Fall through to standard mapping
    let mapped = rust_type_to_ts(ty, false);

    // 4. Strip module paths from Named types: "formula_types::CellValue" -> "CellValue"
    if let TsType::Named(ref name) = mapped
        && name.contains("::")
        && let Some(last) = name.rsplit("::").next()
    {
        return TsType::Named(last.to_string());
    }

    mapped
}

/// If the type is `Option<T>`, resolve the inner T. Otherwise return None.
pub(super) fn unwrap_option_type(ty: &syn::Type, config: &TypeGenConfig) -> Option<TsType> {
    if let syn::Type::Path(type_path) = ty
        && let Some(last) = type_path.path.segments.last()
        && last.ident == "Option"
        && let syn::PathArguments::AngleBracketed(args) = &last.arguments
        && args.args.len() == 1
        && let syn::GenericArgument::Type(inner) = &args.args[0]
    {
        return Some(resolve_type(inner, config));
    }
    None
}

/// Convert a `syn::Path` to a string using `::` as separator.
fn path_to_string(path: &syn::Path) -> String {
    path.segments
        .iter()
        .map(|s| s.ident.to_string())
        .collect::<Vec<_>>()
        .join("::")
}
