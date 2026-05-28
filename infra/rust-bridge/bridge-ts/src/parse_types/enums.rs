use crate::parse_types::config::TypeGenConfig;
use crate::parse_types::fields::{FieldContext, OptionalityPolicy, lower_named_fields};
use crate::parse_types::ident::strip_raw_prefix;
use crate::parse_types::type_resolver::{into_target_to_ts_type, resolve_type};
use crate::serde_attrs::{SerdeContainerAttrs, SerdeFieldAttrs, apply_rename_rule};
use crate::types::{
    TagStyle, TsInterface, TsStringUnion, TsTaggedUnion, TsTaggedVariant, TsType, TsTypeDef,
};

/// Parse a Rust enum into a `TsStringUnion` (all unit) or `TsTaggedUnion` (has data).
pub(super) fn parse_enum(item: &syn::ItemEnum, config: &TypeGenConfig) -> Vec<TsTypeDef> {
    let name = item.ident.to_string();
    let container_attrs = SerdeContainerAttrs::from_attrs(&item.attrs);

    // serde(into) → type alias
    if let Some(ref target) = container_attrs.into {
        return vec![TsTypeDef::TypeAlias {
            name,
            target: into_target_to_ts_type(target),
        }];
    }

    // Check if all variants are unit (no data)
    let all_unit = item
        .variants
        .iter()
        .all(|v| matches!(v.fields, syn::Fields::Unit));

    if all_unit {
        // All-unit enum → string union
        // NOTE: Only the enum's own rename_all applies here, NOT config.default_rename_all.
        // Serde preserves PascalCase variant names by default; the global default is for
        // struct fields (snake_case → camelCase) and would incorrectly lowercase variants.
        let variants = item
            .variants
            .iter()
            .map(|v| {
                let variant_name = strip_raw_prefix(&v.ident.to_string()).to_owned();
                let variant_attrs = SerdeFieldAttrs::from_attrs(&v.attrs);
                if let Some(ref explicit) = variant_attrs.rename {
                    // Per-variant #[serde(rename = "...")] takes precedence.
                    explicit.clone()
                } else if let Some(rule) = container_attrs.rename_all.as_ref() {
                    apply_rename_rule(rule, &variant_name)
                } else {
                    variant_name
                }
            })
            .collect();

        return vec![TsTypeDef::StringUnion(TsStringUnion { name, variants })];
    }

    // Enum with data variants → tagged union
    let tag_style = if container_attrs.untagged {
        TagStyle::Untagged
    } else if let Some(ref tag) = container_attrs.tag {
        if let Some(ref content) = container_attrs.content {
            TagStyle::Adjacent {
                tag: tag.clone(),
                content: content.clone(),
            }
        } else {
            TagStyle::Internal { tag: tag.clone() }
        }
    } else {
        TagStyle::External
    };

    // Collect helper interfaces for struct variants
    let mut helper_defs = Vec::new();

    // NOTE: Only the enum's own rename_all applies to discriminants, NOT config.default_rename_all.
    let variants = item
        .variants
        .iter()
        .map(|v| {
            let variant_name = strip_raw_prefix(&v.ident.to_string()).to_owned();
            let variant_attrs = SerdeFieldAttrs::from_attrs(&v.attrs);
            let discriminant = if let Some(ref explicit) = variant_attrs.rename {
                // Variant-level #[serde(rename = "...")] takes precedence.
                explicit.clone()
            } else if let Some(rule) = container_attrs.rename_all.as_ref() {
                apply_rename_rule(rule, &variant_name)
            } else {
                variant_name
            };

            let data_type = match &v.fields {
                syn::Fields::Unit => TsType::Void,
                syn::Fields::Unnamed(fields) => {
                    if fields.unnamed.len() == 1 {
                        resolve_type(&fields.unnamed[0].ty, config)
                    } else {
                        // Multi-field tuple variant → TS tuple
                        let elems: Vec<TsType> = fields
                            .unnamed
                            .iter()
                            .map(|f| resolve_type(&f.ty, config))
                            .collect();
                        TsType::Tuple(elems)
                    }
                }
                syn::Fields::Named(fields) => {
                    // Struct variant — emit a helper interface for the payload.
                    // Field naming priority: field-level rename > variant rename_all > container rename_all > raw name.
                    let variant_rename_all = variant_attrs
                        .rename_all
                        .as_deref()
                        .or(container_attrs.rename_all.as_deref());
                    let helper_name = format!("{}_{}", name, discriminant);
                    let ts_fields = lower_named_fields(
                        fields,
                        config,
                        FieldContext {
                            rename_all: variant_rename_all,
                            default_rename_all: None,
                            optionality: OptionalityPolicy::EnumStructVariant,
                            honor_serialize_with: false,
                        },
                    );
                    helper_defs.push(TsTypeDef::Interface(TsInterface {
                        name: helper_name.clone(),
                        fields: ts_fields,
                    }));
                    TsType::Named(helper_name)
                }
            };

            TsTaggedVariant {
                variant_name: discriminant,
                data_type,
            }
        })
        .collect();

    let mut result = helper_defs;
    result.push(TsTypeDef::TaggedUnion(TsTaggedUnion {
        name,
        tag_style,
        variants,
    }));
    result
}
