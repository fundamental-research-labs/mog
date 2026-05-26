//! Param-struct descriptor IR.
//!
//! `#[derive(BridgeParamStruct)]` in `bridge-derive` emits a declarative macro
//! alongside every annotated struct:
//!
//! ```ignore
//! __bridge_param_descriptor_ChartSpec! { $gen:path } =>
//!     $gen! {
//!         param_struct_version = 1;
//!         struct_name = ChartSpec;
//!         fields {
//!             [str]  kind;
//!             [str]  range;
//!             [str]  title (optional);
//!         }
//!     };
//! ```
//!
//! Downstream target crates (first consumer: `bridge-cli-macros`) parse that
//! body into [`ParamStructDescriptor`] and use the field shape to decide
//! whether a `[serde]` param emits Mode B (per-field flags) or Mode A only
//! (`--<param>-json`). See ARCHITECTURE.md §2.4.
//!
//! The descriptor parses losslessly — every field carries its param tag plus
//! an `optional` bit derived from `Option<T>` at derive time. Nested struct
//! types tag as `Serde` (matching bridge-core's fallback); future rounds can
//! walk the graph for deeper Mode-B expansion without touching this layer.

use proc_macro2::Ident;
use syn::parse::{Parse, ParseStream};
use syn::{Token, braced, parenthesized};

use crate::ir::ParamTag;

/// Parsed shape of one `#[derive(BridgeParamStruct)]` struct.
#[derive(Debug, Clone)]
pub struct ParamStructDescriptor {
    pub struct_name: Ident,
    pub fields: Vec<ParamStructField>,
}

#[derive(Debug, Clone)]
pub struct ParamStructField {
    pub name: Ident,
    pub tag: ParamTag,
    /// True iff the original Rust type was `Option<T>`. Mode B emits clap
    /// args as `required = false` (implicit via `Option<T>` on the variant
    /// field) when this is set.
    pub optional: bool,
}

impl ParamStructDescriptor {
    /// A param struct is Mode-B eligible iff every field is a terminal
    /// classification (`[str]` or `[prim]`), optionally wrapped in
    /// `Option<_>`. Anything that serializes via serde (`[serde]`,
    /// `[bytes]`, `[parse]`, `[tagged_enum]`) forces Mode A only — per-field
    /// clap flags would have no sensible shell representation.
    ///
    /// See ARCHITECTURE.md §2.4.
    pub fn is_mode_b_eligible(&self) -> bool {
        self.fields.iter().all(|f| is_terminal_tag(&f.tag))
    }
}

fn is_terminal_tag(tag: &ParamTag) -> bool {
    matches!(tag, ParamTag::Str | ParamTag::Prim)
}

impl Parse for ParamStructDescriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // param_struct_version = 1;
        let kw: Ident = input.parse()?;
        if kw != "param_struct_version" {
            return Err(syn::Error::new(
                kw.span(),
                format!("expected 'param_struct_version', found '{}'", kw),
            ));
        }
        let _: Token![=] = input.parse()?;
        let _version: syn::LitInt = input.parse()?;
        let _: Token![;] = input.parse()?;

        // struct_name = <ident>;
        let kw: Ident = input.parse()?;
        if kw != "struct_name" {
            return Err(syn::Error::new(
                kw.span(),
                format!("expected 'struct_name', found '{}'", kw),
            ));
        }
        let _: Token![=] = input.parse()?;
        let struct_name: Ident = input.parse()?;
        let _: Token![;] = input.parse()?;

        // fields { [tag] name; [tag] name (optional); ... }
        let kw: Ident = input.parse()?;
        if kw != "fields" {
            return Err(syn::Error::new(
                kw.span(),
                format!("expected 'fields', found '{}'", kw),
            ));
        }
        let body;
        braced!(body in input);
        let fields = parse_fields(&body)?;

        Ok(ParamStructDescriptor {
            struct_name,
            fields,
        })
    }
}

fn parse_fields(input: ParseStream) -> syn::Result<Vec<ParamStructField>> {
    let mut out = Vec::new();
    while !input.is_empty() {
        // [tag]
        let tag_content;
        syn::bracketed!(tag_content in input);
        let tag_ident: Ident = tag_content.parse()?;
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
                        "unknown param-struct field tag '{}' (expected str/prim/bytes/serde/parse)",
                        other
                    ),
                ));
            }
        };

        // name
        let name: Ident = input.parse()?;

        // optional `(optional)` marker
        let optional = if input.peek(syn::token::Paren) {
            let marker;
            parenthesized!(marker in input);
            let m: Ident = marker.parse()?;
            if m != "optional" {
                return Err(syn::Error::new(
                    m.span(),
                    format!("expected 'optional' marker, found '{}'", m),
                ));
            }
            true
        } else {
            false
        };

        // trailing `;`
        let _: Token![;] = input.parse()?;

        out.push(ParamStructField {
            name,
            tag,
            optional,
        });
    }
    Ok(out)
}
