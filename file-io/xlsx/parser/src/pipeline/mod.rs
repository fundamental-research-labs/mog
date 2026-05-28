//! Parsing pipeline and orchestration modules.
//!
//! These modules implement the various parsing strategies (full, fast, lazy, streaming)
//! and coordinate the overall parse pipeline.

pub mod doc_props;
pub(crate) mod external_refs;
pub mod fast_parse;
pub mod full_parse;
pub mod import_extensions;
pub mod lazy;
pub mod metadata;
pub mod streaming;

// Memory-mapped I/O module (native only)
#[cfg(all(not(target_arch = "wasm32"), feature = "native"))]
pub mod mmap;

// Parallel sheet parsing module (native only)
#[cfg(all(not(target_arch = "wasm32"), feature = "parallel"))]
pub mod parallel;
