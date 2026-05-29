//! Shared XML attribute parsing utilities.
//!
//! This module provides common functions for parsing XML attributes, decoding
//! XML entities, detecting relationship-bearing raw XML, and resolving
//! `mc:AlternateContent` branches.

mod attrs;
mod decode;
mod direct_child;
mod mc;
mod relationships;

pub use attrs::{
    parse_bool_attr, parse_bool_attr_opt, parse_bool_attr_with_default, parse_bytes_attr,
    parse_element_content, parse_enum_attr, parse_f64_attr, parse_i32_attr, parse_string_attr,
    parse_string_attr_quoted, parse_string_attr_single_quote, parse_string_attr_verbatim,
    parse_u8_attr, parse_u32_attr,
};
pub use decode::{decode_xml_entities, decode_xml_entities_string};
pub use direct_child::extract_direct_child_element_xml;
pub use mc::{
    MC_DRAWING_MARKUP_SUPPORTED_NAMESPACES, MC_RELATIONSHIPS_NAMESPACE, MC_SUPPORTED_NAMESPACES,
    MC_WORKSHEET_MARKUP_SUPPORTED_NAMESPACES, McAlternateContentOutcome, McBranch, McResolution,
    resolve_mc_alternate_content, resolve_mc_alternate_content_v2,
    resolve_mc_alternate_content_v2_with_namespace_context,
    resolve_mc_alternate_content_with_namespace_context,
    resolve_mc_alternate_content_with_namespaces,
    resolve_mc_alternate_content_with_supported_namespaces,
};
pub use relationships::{
    raw_xml_contains_relationship_attr, relationship_attr_values, remap_relationship_attrs,
};

#[cfg(test)]
mod tests;
