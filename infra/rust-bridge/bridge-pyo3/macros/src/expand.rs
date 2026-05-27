//! Code generation for PyO3 Python bindings.
//!
//! Converts a `PyO3Descriptor` (parsed from descriptor tokens) into a
//! `TokenStream` containing `#[pyclass]`, `#[pymethods]`, and `#[pyfunction]`
//! code.
//!
//! This is the PyO3 equivalent of `bridge-napi/macros/src/expand.rs`.
//! Key differences from NAPI:
//! - No registry mode (class-only)
//! - No async support (sync only)
//! - `PyResult<T>` instead of `napi::Result<T>`
//! - `PyErr::new::<PyRuntimeError, _>(msg)` instead of `napi::Error::from_reason`
//! - `Vec<u8>` for bytes (PyO3 auto-converts to/from Python bytes)
//! - `(Vec<u8>, String)` tuples returned as Python tuples (no packing)

use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};
use syn::parse::{Parse, ParseStream};
use syn::{Token, braced};

mod class;
mod convert;
mod free;
mod generate_class;
mod ir;
mod parse;
mod tagged_enum;
mod types;

#[cfg(test)]
mod tests;

#[cfg(test)]
use class::expand_class;
pub(crate) use class::parse_and_expand_class;
use convert::{build_params_and_conversions, build_pyo3_return_type, build_return_handling};
use free::{emit_pure_function, expand};
pub(crate) use generate_class::generate_class_impl;
use ir::*;
use tagged_enum::*;
use types::{classify_return, is_direct_return, to_snake_case};

pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: PyO3Descriptor = syn::parse2(input)?;
    Ok(expand(&desc))
}
