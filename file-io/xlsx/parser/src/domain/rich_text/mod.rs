//! Rich text domain — rich text formatting with runs and phonetic properties.

pub mod read;
pub mod types;
mod properties;
mod runs;

pub use read::*;
pub use types::*;

#[cfg(test)]
mod tests;
