//! Round-trip fidelity modules.
//!
//! These modules handle preserving XML attributes, namespaces, and unknown elements
//! so that XLSX files can be parsed and re-serialized with minimal changes.

pub mod attr_order;
pub mod binary_passthrough;
pub mod namespaces;
pub mod preservation;
pub mod preserved_xml_policy;
pub mod unknown_elements;

// Structural XML diff for typed reconstruction parity gates.
pub mod xml_diff;

// XLSX Fidelity Testing System (for comparing against Excel COM ground truth)
pub mod fidelity;
