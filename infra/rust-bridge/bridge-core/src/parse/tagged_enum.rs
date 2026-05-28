use crate::descriptor::{ParamTag, TaggedEnumSchema, VariantField, VariantSchema};

pub(super) fn parse_tagged_enum_attr(
    attrs: &[syn::Attribute],
) -> syn::Result<Option<TaggedEnumSchema>> {
    for attr in attrs {
        let segs: Vec<_> = attr.path().segments.iter().collect();
        if segs.len() == 2 && segs[0].ident == "bridge" && segs[1].ident == "tagged_enum" {
            return attr.parse_args_with(parse_tagged_enum_body).map(Some);
        }
    }
    Ok(None)
}

pub(super) fn parse_tagged_enum_body(
    input: syn::parse::ParseStream,
) -> syn::Result<TaggedEnumSchema> {
    let mut type_name: Option<String> = None;
    let mut tag: Option<String> = None;
    let mut content: Option<String> = None;
    let mut variants: Vec<VariantSchema> = Vec::new();

    while !input.is_empty() {
        let key: syn::Ident = input.parse()?;
        match key.to_string().as_str() {
            "name" => {
                let _: syn::Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                type_name = Some(lit.value());
            }
            "tag" => {
                let _: syn::Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                tag = Some(lit.value());
            }
            "content" => {
                let _: syn::Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                content = Some(lit.value());
            }
            "variants" => {
                let inner;
                syn::parenthesized!(inner in input);
                while !inner.is_empty() {
                    variants.push(parse_variant_schema(&inner)?);
                    if inner.peek(syn::Token![,]) {
                        let _: syn::Token![,] = inner.parse()?;
                    }
                }
            }
            other => {
                return Err(syn::Error::new(
                    key.span(),
                    format!(
                        "bridge::tagged_enum: unknown key '{}', expected name/tag/content/variants",
                        other
                    ),
                ));
            }
        }
        if input.peek(syn::Token![,]) {
            let _: syn::Token![,] = input.parse()?;
        }
    }

    let type_name = type_name.ok_or_else(|| {
        syn::Error::new(
            proc_macro2::Span::call_site(),
            "bridge::tagged_enum: missing `name = \"...\"`",
        )
    })?;
    let tag = tag.ok_or_else(|| {
        syn::Error::new(
            proc_macro2::Span::call_site(),
            "bridge::tagged_enum: missing `tag = \"...\"`",
        )
    })?;

    Ok(TaggedEnumSchema {
        type_name,
        tag,
        content,
        variants,
    })
}

pub(super) fn parse_variant_schema(input: syn::parse::ParseStream) -> syn::Result<VariantSchema> {
    let rust_ident: syn::Ident = input.parse()?;
    let rust_name = rust_ident.to_string();

    // Optional `= "wire_name"` rename. Falls back to rust_name.
    let wire_name = if input.peek(syn::Token![=]) {
        let _: syn::Token![=] = input.parse()?;
        let lit: syn::LitStr = input.parse()?;
        lit.value()
    } else {
        rust_name.clone()
    };

    let fields_group;
    syn::braced!(fields_group in input);

    let mut fields = Vec::new();
    while !fields_group.is_empty() {
        let field_ident: syn::Ident = fields_group.parse()?;

        // Optional `as "wire_name"` for per-field serde rename.
        let wire_field_name = if fields_group.peek(syn::Token![as]) {
            let _: syn::Token![as] = fields_group.parse()?;
            let lit: syn::LitStr = fields_group.parse()?;
            lit.value()
        } else {
            field_ident.to_string()
        };

        let _: syn::Token![:] = fields_group.parse()?;
        let tag_ident: syn::Ident = fields_group.parse()?;
        let tag = match tag_ident.to_string().as_str() {
            "str" => ParamTag::Str,
            "prim" => ParamTag::Prim,
            "bytes" => ParamTag::Bytes,
            "serde" => ParamTag::Serde,
            "parse" => ParamTag::Parse,
            other => {
                return Err(syn::Error::new(
                    tag_ident.span(),
                    format!(
                        "bridge::tagged_enum: unknown field tag '{}' — expected str/prim/bytes/serde/parse",
                        other
                    ),
                ));
            }
        };

        // `ty` stores the tag string as a best-effort type marker. A future pass may
        // extend this with richer type info when downstream codegens need it.
        let ty_str = tag_ident.to_string();

        fields.push(VariantField {
            rust_name: field_ident.to_string(),
            wire_name: wire_field_name,
            ty: ty_str,
            tag: Box::new(tag),
        });

        if fields_group.peek(syn::Token![,]) {
            let _: syn::Token![,] = fields_group.parse()?;
        }
    }

    Ok(VariantSchema {
        rust_name,
        wire_name,
        fields,
    })
}
