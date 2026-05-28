//! Shared XML attribute parsing utilities.
//!
//! This module provides common functions for parsing XML attributes, decoding
//! XML entities, detecting relationship-bearing raw XML, and resolving
//! `mc:AlternateContent` branches.

mod attrs;
mod decode;
mod mc;
mod relationships;

pub use attrs::{
    parse_bool_attr, parse_bool_attr_opt, parse_bool_attr_with_default, parse_bytes_attr,
    parse_element_content, parse_enum_attr, parse_f64_attr, parse_i32_attr, parse_string_attr,
    parse_string_attr_quoted, parse_string_attr_single_quote, parse_string_attr_verbatim,
    parse_u8_attr, parse_u32_attr,
};
pub use decode::{decode_xml_entities, decode_xml_entities_string};
pub use mc::{
    resolve_mc_alternate_content, resolve_mc_alternate_content_v2, McBranch, McResolution,
    MC_SUPPORTED_NAMESPACES,
};
pub use relationships::raw_xml_contains_relationship_attr;

#[cfg(test)]
mod tests;
