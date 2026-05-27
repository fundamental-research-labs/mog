use super::*;

pub(super) fn is_unit_type(ty: &Type) -> bool {
    if let Type::Tuple(t) = ty {
        t.elems.is_empty()
    } else {
        false
    }
}

/// Check if a type is `Vec<u8>`.
pub(super) fn is_vec_u8(ty: &Type) -> bool {
    if let Type::Path(p) = ty
        && let Some(seg) = p.path.segments.last()
        && seg.ident == "Vec"
        && let syn::PathArguments::AngleBracketed(args) = &seg.arguments
        && args.args.len() == 1
        && let syn::GenericArgument::Type(Type::Path(inner)) = &args.args[0]
    {
        return inner.path.is_ident("u8");
    }
    false
}

/// Check if a type is a `(Vec<u8>, T)` tuple, returning `Some(T)` if so.
pub(super) fn extract_bytes_tuple_inner(ty: &Type) -> Option<Type> {
    if let Type::Tuple(t) = ty
        && t.elems.len() == 2
    {
        let first = &t.elems[0];
        if is_vec_u8(first) {
            return Some(t.elems[1].clone());
        }
    }
    None
}

/// Check if a type is a `(Self, T)` tuple, returning `Some(T)` if so.
pub(super) fn extract_self_tuple_inner(ty: &Type) -> Option<Type> {
    if let Type::Tuple(t) = ty
        && t.elems.len() == 2
    {
        let first = &t.elems[0];
        if is_self_type(first) {
            return Some(t.elems[1].clone());
        }
    }
    None
}

pub(super) fn is_self_type(ty: &Type) -> bool {
    if let Type::Path(p) = ty
        && let Some(seg) = p.path.segments.last()
    {
        return seg.ident == "Self";
    }
    false
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

pub(super) fn deref_type(ty: &Type) -> Type {
    if let Type::Reference(r) = ty {
        (*r.elem).clone()
    } else {
        ty.clone()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
