//! Rich text domain — rich text formatting with runs and phonetic properties.

mod properties;
pub mod read;
mod runs;
pub mod types;

pub use read::*;
pub use types::*;

#[cfg(test)]
mod tests;
