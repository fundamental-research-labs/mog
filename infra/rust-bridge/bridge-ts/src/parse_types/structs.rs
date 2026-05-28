use crate::parse_types::config::TypeGenConfig;
use crate::parse_types::fields::{FieldContext, OptionalityPolicy, lower_named_fields};
use crate::parse_types::type_resolver::into_target_to_ts_type;
use crate::serde_attrs::SerdeContainerAttrs;
use crate::types::{TsInterface, TsTypeDef};

/// Parse a Rust struct into a `TsInterface`.
pub(super) fn parse_struct(item: &syn::ItemStruct, config: &TypeGenConfig) -> Option<TsTypeDef> {
    let name = item.ident.to_string();
    let container_attrs = SerdeContainerAttrs::from_attrs(&item.attrs);

    // serde(into) → type alias (e.g. `#[serde(into = "String")]` → `export type Foo = string;`)
    if let Some(ref target) = container_attrs.into {
        return Some(TsTypeDef::TypeAlias {
            name,
            target: into_target_to_ts_type(target),
        });
    }

    let named_fields = match &item.fields {
        syn::Fields::Named(named) => Some(named),
        syn::Fields::Unit => None, // Unit struct → empty interface
        _ => return None,          // Skip tuple structs
    };

    let ts_fields = named_fields
        .map(|fields| {
            lower_named_fields(
                fields,
                config,
                FieldContext {
                    rename_all: container_attrs.rename_all.as_deref(),
                    default_rename_all: config.default_rename_all.as_deref(),
                    optionality: OptionalityPolicy::StructField,
                    honor_serialize_with: true,
                },
            )
        })
        .unwrap_or_default();

    Some(TsTypeDef::Interface(TsInterface {
        name,
        fields: ts_fields,
    }))
}
