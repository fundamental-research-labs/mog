use quote::ToTokens;

use crate::parse_types::ident::strip_raw_prefix;
use crate::parse_types::source::has_derive_serialize;
use crate::serde_attrs::SerdeFieldAttrs;

/// A generated public/kernel type field that violates the bridge integer policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicKernelIntegerPolicyViolation {
    pub owner: String,
    pub field: String,
    pub rust_type: String,
}

/// Return every generated field that exposes a raw Rust `u64`.
///
/// Public/kernel generated types must use an explicit `BridgeU64` wrapper for
/// 64-bit unsigned values. Bounded counts and indexes should stay `u32`, which
/// safely maps to TypeScript `number`.
pub fn collect_public_kernel_integer_policy_violations(
    source: &str,
) -> Result<Vec<PublicKernelIntegerPolicyViolation>, String> {
    let file: syn::File =
        syn::parse_str(source).map_err(|e| format!("Failed to parse source: {}", e))?;
    let mut violations = Vec::new();

    for item in &file.items {
        match item {
            syn::Item::Struct(item) if has_derive_serialize(&item.attrs) => {
                collect_struct_violations(item, &mut violations);
            }
            syn::Item::Enum(item) if has_derive_serialize(&item.attrs) => {
                collect_enum_violations(item, &mut violations);
            }
            _ => {}
        }
    }

    Ok(violations)
}

/// Validate that generated public/kernel source does not expose raw `u64` fields.
pub fn validate_public_kernel_integer_policy(source: &str) -> Result<(), String> {
    let violations = collect_public_kernel_integer_policy_violations(source)?;
    if violations.is_empty() {
        return Ok(());
    }

    let details = violations
        .iter()
        .map(|violation| {
            format!(
                "{}.{}: {}",
                violation.owner, violation.field, violation.rust_type
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "public/kernel generated types must wrap u64 fields in BridgeU64: {details}"
    ))
}

fn collect_struct_violations(
    item: &syn::ItemStruct,
    violations: &mut Vec<PublicKernelIntegerPolicyViolation>,
) {
    let syn::Fields::Named(fields) = &item.fields else {
        return;
    };
    collect_named_field_violations(&item.ident.to_string(), fields, violations);
}

fn collect_enum_violations(
    item: &syn::ItemEnum,
    violations: &mut Vec<PublicKernelIntegerPolicyViolation>,
) {
    let enum_name = item.ident.to_string();
    for variant in &item.variants {
        let owner = format!("{enum_name}::{}", variant.ident);
        match &variant.fields {
            syn::Fields::Named(fields) => {
                collect_named_field_violations(&owner, fields, violations);
            }
            syn::Fields::Unnamed(fields) => {
                for (index, field) in fields.unnamed.iter().enumerate() {
                    collect_field_violation(&owner, &format!("#{index}"), field, violations);
                }
            }
            syn::Fields::Unit => {}
        }
    }
}

fn collect_named_field_violations(
    owner: &str,
    fields: &syn::FieldsNamed,
    violations: &mut Vec<PublicKernelIntegerPolicyViolation>,
) {
    for field in &fields.named {
        let Some(ident) = &field.ident else {
            continue;
        };
        let field_name = strip_raw_prefix(&ident.to_string()).to_owned();
        collect_field_violation(owner, &field_name, field, violations);
    }
}

fn collect_field_violation(
    owner: &str,
    field_name: &str,
    field: &syn::Field,
    violations: &mut Vec<PublicKernelIntegerPolicyViolation>,
) {
    if SerdeFieldAttrs::from_attrs(&field.attrs).skip {
        return;
    }
    if !contains_unwrapped_u64(&field.ty) {
        return;
    }

    violations.push(PublicKernelIntegerPolicyViolation {
        owner: owner.to_string(),
        field: field_name.to_string(),
        rust_type: field.ty.to_token_stream().to_string(),
    });
}

fn contains_unwrapped_u64(ty: &syn::Type) -> bool {
    match ty {
        syn::Type::Array(array) => contains_unwrapped_u64(&array.elem),
        syn::Type::BareFn(bare_fn) => {
            bare_fn
                .inputs
                .iter()
                .any(|input| contains_unwrapped_u64(&input.ty))
                || return_type_contains_unwrapped_u64(&bare_fn.output)
        }
        syn::Type::Group(group) => contains_unwrapped_u64(&group.elem),
        syn::Type::Paren(paren) => contains_unwrapped_u64(&paren.elem),
        syn::Type::Path(path) => path_contains_unwrapped_u64(&path.path),
        syn::Type::Ptr(ptr) => contains_unwrapped_u64(&ptr.elem),
        syn::Type::Reference(reference) => contains_unwrapped_u64(&reference.elem),
        syn::Type::Slice(slice) => contains_unwrapped_u64(&slice.elem),
        syn::Type::Tuple(tuple) => tuple.elems.iter().any(contains_unwrapped_u64),
        _ => false,
    }
}

fn path_contains_unwrapped_u64(path: &syn::Path) -> bool {
    let Some(last) = path.segments.last() else {
        return false;
    };
    if last.ident == "BridgeU64" {
        return false;
    }
    if last.ident == "u64" {
        return true;
    }

    path.segments
        .iter()
        .any(|segment| path_arguments_contain_unwrapped_u64(&segment.arguments))
}

fn path_arguments_contain_unwrapped_u64(arguments: &syn::PathArguments) -> bool {
    match arguments {
        syn::PathArguments::None => false,
        syn::PathArguments::Parenthesized(args) => {
            args.inputs.iter().any(contains_unwrapped_u64)
                || return_type_contains_unwrapped_u64(&args.output)
        }
        syn::PathArguments::AngleBracketed(args) => args.args.iter().any(|arg| match arg {
            syn::GenericArgument::Type(ty) => contains_unwrapped_u64(ty),
            syn::GenericArgument::AssocType(assoc) => contains_unwrapped_u64(&assoc.ty),
            syn::GenericArgument::Constraint(constraint) => constraint
                .bounds
                .iter()
                .any(type_param_bound_contains_unwrapped_u64),
            _ => false,
        }),
    }
}

fn return_type_contains_unwrapped_u64(output: &syn::ReturnType) -> bool {
    match output {
        syn::ReturnType::Default => false,
        syn::ReturnType::Type(_, ty) => contains_unwrapped_u64(ty),
    }
}

fn type_param_bound_contains_unwrapped_u64(bound: &syn::TypeParamBound) -> bool {
    match bound {
        syn::TypeParamBound::Trait(trait_bound) => path_contains_unwrapped_u64(&trait_bound.path),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_integer_policy_rejects_raw_u64_generated_fields() {
        let source = r#"
            use serde::Serialize;

            #[derive(Serialize)]
            pub struct RawCounters {
                pub total_count: u64,
                pub maybe_count: Option<u64>,
            }

            #[derive(Serialize)]
            pub enum RawEvent {
                Count { value: u64 },
                Tuple(u64),
            }
        "#;

        let violations = collect_public_kernel_integer_policy_violations(source).unwrap();
        assert_eq!(
            violations
                .iter()
                .map(|violation| (violation.owner.as_str(), violation.field.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("RawCounters", "total_count"),
                ("RawCounters", "maybe_count"),
                ("RawEvent::Count", "value"),
                ("RawEvent::Tuple", "#0"),
            ]
        );
        assert!(
            validate_public_kernel_integer_policy(source)
                .unwrap_err()
                .contains("BridgeU64")
        );
    }

    #[test]
    fn public_integer_policy_accepts_bridge_u64_and_bounded_u32_counts() {
        let source = r#"
            use serde::Serialize;

            #[derive(Serialize)]
            pub struct PublicCounts {
                pub count: u32,
                pub row_count: u32,
                pub validation_diagnostic_count: Option<u32>,
                pub exact_count: BridgeU64,
                pub optional_exact_count: Option<BridgeU64>,
            }

            #[derive(Serialize)]
            pub enum PublicEvent {
                Count { value: BridgeU64, bounded_count: u32 },
                Tuple(BridgeU64),
            }
        "#;

        assert!(validate_public_kernel_integer_policy(source).is_ok());
    }

    #[test]
    fn public_integer_policy_ignores_skipped_u64_fields() {
        let source = r#"
            use serde::Serialize;

            #[derive(Serialize)]
            pub struct InternalOnlyCounter {
                #[serde(skip)]
                pub raw_count: u64,
            }
        "#;

        assert!(validate_public_kernel_integer_policy(source).is_ok());
    }
}
