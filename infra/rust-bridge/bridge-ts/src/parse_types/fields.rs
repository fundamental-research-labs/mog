use crate::parse_types::config::TypeGenConfig;
use crate::parse_types::ident::strip_raw_prefix;
use crate::parse_types::type_resolver::{resolve_type, unwrap_option_type};
use crate::serde_attrs::{SerdeFieldAttrs, apply_rename_rule, is_optional_skip};
use crate::types::{TsField, TsType};

pub(super) enum OptionalityPolicy {
    StructField,
    EnumStructVariant,
}

pub(super) struct FieldContext<'a> {
    pub(super) rename_all: Option<&'a str>,
    pub(super) default_rename_all: Option<&'a str>,
    pub(super) optionality: OptionalityPolicy,
    pub(super) honor_serialize_with: bool,
}

pub(super) fn lower_named_fields(
    fields: &syn::FieldsNamed,
    config: &TypeGenConfig,
    context: FieldContext<'_>,
) -> Vec<TsField> {
    fields
        .named
        .iter()
        .filter_map(|field| lower_named_field(field, config, &context))
        .collect()
}

fn lower_named_field(
    field: &syn::Field,
    config: &TypeGenConfig,
    context: &FieldContext<'_>,
) -> Option<TsField> {
    let field_attrs = SerdeFieldAttrs::from_attrs(&field.attrs);
    if field_attrs.skip {
        return None;
    }

    let rust_name = strip_raw_prefix(&field.ident.as_ref()?.to_string()).to_owned();
    let ts_name = if let Some(ref rename) = field_attrs.rename {
        rename.clone()
    } else if let Some(rule) = context.rename_all.or(context.default_rename_all) {
        apply_rename_rule(rule, &rust_name)
    } else {
        rust_name
    };

    let (ts_type, optional) = match context.optionality {
        OptionalityPolicy::StructField => {
            lower_struct_field_type(field, config, &field_attrs, context)
        }
        OptionalityPolicy::EnumStructVariant => lower_enum_struct_variant_field_type(field, config),
    };

    Some(TsField {
        ts_name,
        ts_type,
        optional,
    })
}

fn lower_struct_field_type(
    field: &syn::Field,
    config: &TypeGenConfig,
    field_attrs: &SerdeFieldAttrs,
    context: &FieldContext<'_>,
) -> (TsType, bool) {
    let has_optional_skip = field_attrs
        .skip_serializing_if
        .as_deref()
        .is_some_and(is_optional_skip);

    if context.honor_serialize_with && field_attrs.serialize_with.is_some() {
        (TsType::String, has_optional_skip)
    } else if let Some(inner) = unwrap_option_type(&field.ty, config) {
        if has_optional_skip {
            (inner, true)
        } else {
            (TsType::Nullable(Box::new(inner)), false)
        }
    } else if has_optional_skip {
        (resolve_type(&field.ty, config), true)
    } else {
        (resolve_type(&field.ty, config), false)
    }
}

fn lower_enum_struct_variant_field_type(
    field: &syn::Field,
    config: &TypeGenConfig,
) -> (TsType, bool) {
    if let Some(inner) = unwrap_option_type(&field.ty, config) {
        (inner, true)
    } else {
        (resolve_type(&field.ty, config), false)
    }
}
