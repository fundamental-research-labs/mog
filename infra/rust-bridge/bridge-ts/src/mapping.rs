//! Rust type → TypeScript type mapping.

use crate::types::TsType;

/// Map a `syn::Type` (from parsed Rust source) to a `TsType`.
///
/// Parameter tags override the mapping:
/// - `[parse]` params always map to `string` (wire type)
/// - `[bytes]` params always map to `Uint8Array`
pub fn rust_type_to_ts(ty: &syn::Type, is_parse: bool) -> TsType {
    if is_parse {
        return TsType::String;
    }
    match ty {
        syn::Type::Reference(r) => map_reference(r),
        syn::Type::Path(p) => map_path(p),
        syn::Type::Tuple(t) if t.elems.is_empty() => TsType::Void,
        syn::Type::Tuple(t) => {
            let elems: Vec<TsType> = t.elems.iter().map(|e| rust_type_to_ts(e, false)).collect();
            TsType::Tuple(elems)
        }
        // [T; N] fixed-size arrays — serde serializes as JSON arrays, so map to T[]
        syn::Type::Array(a) => TsType::Array(Box::new(rust_type_to_ts(&a.elem, false))),
        _ => TsType::Named(quote::ToTokens::to_token_stream(ty).to_string()),
    }
}

fn map_reference(r: &syn::TypeReference) -> TsType {
    match &*r.elem {
        syn::Type::Path(p) if p.path.is_ident("str") => TsType::String,
        syn::Type::Slice(s) => {
            if let syn::Type::Path(p) = &*s.elem
                && p.path.is_ident("u8")
            {
                return TsType::Uint8Array;
            }
            // &[T] for non-u8 → T[]
            TsType::Array(Box::new(rust_type_to_ts(&s.elem, false)))
        }
        other => rust_type_to_ts(other, false),
    }
}

fn map_path(p: &syn::TypePath) -> TsType {
    let seg = match p.path.segments.last() {
        Some(s) => s,
        None => return TsType::Named("unknown".into()),
    };
    let name = seg.ident.to_string();
    match name.as_str() {
        "String" | "str" => TsType::String,
        "bool" => TsType::Boolean,
        "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "f32" | "f64" | "usize"
        | "isize" => TsType::Number,
        "Vec" => map_vec(seg),
        "Option" => map_option(seg),
        "HashMap" | "BTreeMap" => map_map(seg),
        "Result" => map_result(seg),
        // serde_json::Value → opaque JSON, mapped to `unknown` in TS
        "Value" => TsType::Named("unknown".into()),
        _ => TsType::Named(name),
    }
}

fn map_vec(seg: &syn::PathSegment) -> TsType {
    if let syn::PathArguments::AngleBracketed(args) = &seg.arguments
        && args.args.len() == 1
        && let syn::GenericArgument::Type(inner) = &args.args[0]
    {
        // Vec<u8> → Uint8Array
        if let syn::Type::Path(p) = inner
            && p.path.is_ident("u8")
        {
            return TsType::Uint8Array;
        }
        return TsType::Array(Box::new(rust_type_to_ts(inner, false)));
    }
    TsType::Array(Box::new(TsType::Named("unknown".into())))
}

fn map_option(seg: &syn::PathSegment) -> TsType {
    if let syn::PathArguments::AngleBracketed(args) = &seg.arguments
        && args.args.len() == 1
        && let syn::GenericArgument::Type(inner) = &args.args[0]
    {
        return TsType::Nullable(Box::new(rust_type_to_ts(inner, false)));
    }
    TsType::Nullable(Box::new(TsType::Named("unknown".into())))
}

fn map_map(seg: &syn::PathSegment) -> TsType {
    if let syn::PathArguments::AngleBracketed(args) = &seg.arguments {
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
                Box::new(rust_type_to_ts(types[0], false)),
                Box::new(rust_type_to_ts(types[1], false)),
            );
        }
    }
    TsType::Record(
        Box::new(TsType::String),
        Box::new(TsType::Named("unknown".into())),
    )
}

fn map_result(seg: &syn::PathSegment) -> TsType {
    // Result<T, E> → T (error becomes Promise rejection)
    if let syn::PathArguments::AngleBracketed(args) = &seg.arguments {
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
        if !types.is_empty() {
            return rust_type_to_ts(types[0], false);
        }
    }
    TsType::Void
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_type(s: &str) -> syn::Type {
        syn::parse_str(s).unwrap()
    }

    #[test]
    fn string_type() {
        assert_eq!(
            rust_type_to_ts(&parse_type("String"), false),
            TsType::String
        );
    }

    #[test]
    fn str_ref() {
        assert_eq!(rust_type_to_ts(&parse_type("&str"), false), TsType::String);
    }

    #[test]
    fn bool_type() {
        assert_eq!(rust_type_to_ts(&parse_type("bool"), false), TsType::Boolean);
    }

    #[test]
    fn numeric_types() {
        for t in &[
            "u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f32", "f64", "usize",
        ] {
            assert_eq!(
                rust_type_to_ts(&parse_type(t), false),
                TsType::Number,
                "failed for {}",
                t
            );
        }
    }

    #[test]
    fn vec_string() {
        assert_eq!(
            rust_type_to_ts(&parse_type("Vec<String>"), false),
            TsType::Array(Box::new(TsType::String))
        );
    }

    #[test]
    fn vec_u8_is_bytes() {
        assert_eq!(
            rust_type_to_ts(&parse_type("Vec<u8>"), false),
            TsType::Uint8Array
        );
    }

    #[test]
    fn slice_u8_is_bytes() {
        assert_eq!(
            rust_type_to_ts(&parse_type("&[u8]"), false),
            TsType::Uint8Array
        );
    }

    #[test]
    fn option_string() {
        assert_eq!(
            rust_type_to_ts(&parse_type("Option<String>"), false),
            TsType::Nullable(Box::new(TsType::String))
        );
    }

    #[test]
    fn hashmap() {
        assert_eq!(
            rust_type_to_ts(&parse_type("HashMap<String, u32>"), false),
            TsType::Record(Box::new(TsType::String), Box::new(TsType::Number))
        );
    }

    #[test]
    fn result_unwraps() {
        assert_eq!(
            rust_type_to_ts(&parse_type("Result<String, MyError>"), false),
            TsType::String
        );
    }

    #[test]
    fn result_unit_ok() {
        assert_eq!(
            rust_type_to_ts(&parse_type("Result<(), MyError>"), false),
            TsType::Void
        );
    }

    #[test]
    fn unit_type() {
        assert_eq!(rust_type_to_ts(&parse_type("()"), false), TsType::Void);
    }

    #[test]
    fn named_type() {
        assert_eq!(
            rust_type_to_ts(&parse_type("StoreStats"), false),
            TsType::Named("StoreStats".into())
        );
    }

    #[test]
    fn parse_override() {
        // [parse] params always become string regardless of Rust type
        assert_eq!(rust_type_to_ts(&parse_type("&KeyId"), true), TsType::String);
    }

    #[test]
    fn nested_vec() {
        assert_eq!(
            rust_type_to_ts(&parse_type("Vec<Vec<u32>>"), false),
            TsType::Array(Box::new(TsType::Array(Box::new(TsType::Number))))
        );
    }

    #[test]
    fn option_vec() {
        assert_eq!(
            rust_type_to_ts(&parse_type("Option<Vec<String>>"), false),
            TsType::Nullable(Box::new(TsType::Array(Box::new(TsType::String))))
        );
    }

    #[test]
    fn tuple_type() {
        assert_eq!(
            rust_type_to_ts(&parse_type("(u32, u32)"), false),
            TsType::Tuple(vec![TsType::Number, TsType::Number])
        );
    }

    #[test]
    fn tuple_mixed_types() {
        assert_eq!(
            rust_type_to_ts(&parse_type("(String, u32, bool)"), false),
            TsType::Tuple(vec![TsType::String, TsType::Number, TsType::Boolean])
        );
    }

    #[test]
    fn vec_of_tuples() {
        assert_eq!(
            rust_type_to_ts(&parse_type("Vec<(u32, f64)>"), false),
            TsType::Array(Box::new(TsType::Tuple(vec![
                TsType::Number,
                TsType::Number
            ])))
        );
    }

    #[test]
    fn fixed_size_array() {
        // [T; N] fixed-size arrays map to T[]
        assert_eq!(
            rust_type_to_ts(&parse_type("[u32; 9]"), false),
            TsType::Array(Box::new(TsType::Number))
        );
    }

    #[test]
    fn fixed_size_array_of_option() {
        // [Option<T>; N] maps to (T | null)[]
        assert_eq!(
            rust_type_to_ts(&parse_type("[Option<String>; 4]"), false),
            TsType::Array(Box::new(TsType::Nullable(Box::new(TsType::String))))
        );
    }

    #[test]
    fn slice_of_u32() {
        // &[u32] → number[]
        assert_eq!(
            rust_type_to_ts(&parse_type("&[u32]"), false),
            TsType::Array(Box::new(TsType::Number))
        );
    }

    #[test]
    fn slice_of_tuples() {
        // &[(u32, u32, u32, u32)] → [number, number, number, number][]
        assert_eq!(
            rust_type_to_ts(&parse_type("&[(u32, u32, u32, u32)]"), false),
            TsType::Array(Box::new(TsType::Tuple(vec![
                TsType::Number,
                TsType::Number,
                TsType::Number,
                TsType::Number,
            ])))
        );
    }

    #[test]
    fn serde_json_value() {
        // serde_json::Value should map to unknown
        assert_eq!(
            rust_type_to_ts(&parse_type("Value"), false),
            TsType::Named("unknown".into())
        );
    }
}
