//! Lookup function dispatch, indexing, and reference resolution.
//!
//! Contains eval methods for INDEX, MATCH, VLOOKUP, HLOOKUP, XLOOKUP,
//! XMATCH, OFFSET, and INDIRECT, plus supporting lookup indexes,
//! wildcard matching, and caching infrastructure.

pub(crate) mod classic_eval;
pub(crate) mod dispatch;
pub(crate) mod index;
pub(crate) mod index_cache;
pub(crate) mod index_eval;
pub(crate) mod indirect;
pub(crate) mod match_eval;
pub(crate) mod offset_eval;
pub(crate) mod primitives;
pub(crate) mod range_geometry;
pub(crate) mod wildcard;
pub(crate) mod xlookup_eval;
