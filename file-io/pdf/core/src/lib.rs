//! pdf-core: PDF 1.7 document model, serializer, and content stream builder.
//!
//! This crate provides the foundational layer for generating valid PDF files.
//! It is WASM-compatible (no filesystem access, pure Rust dependencies only).
//!
//! # Architecture
//!
//! - **types**: `PdfValue`, `PdfDict`, `PdfStream`, `PdfRef`, `PdfName` — the typed PDF object model
//! - **document**: `PdfDocument` — manages object allocation, page tree, catalog
//! - **serializer**: Binary PDF 1.7 serializer with cross-reference table
//! - **compression**: DEFLATE (FlateDecode) wrappers via `flate2`
//! - **content**: `ContentOp` enum and `ContentStreamBuilder` for typed content streams
//! - **resources**: `PageResources` for per-page resource dictionary management
//!
//! # Quick Start
//!
//! ```rust
//! use pdf_core::document::{PdfDocument, DocumentInfo};
//! use pdf_core::content::ContentOp;
//! use pdf_core::types::PdfName;
//! use pdf_core::serializer::serialize_document_to_bytes;
//!
//! let mut doc = PdfDocument::new();
//! doc.set_info(DocumentInfo {
//!     title: Some("Hello World".to_string()),
//!     producer: Some("pdf-core".to_string()),
//!     ..Default::default()
//! });
//!
//! let mut page = doc.add_page(612.0, 792.0);
//! page.content_ops.push(ContentOp::BeginText);
//! page.content_ops.push(ContentOp::SetFont(PdfName::new("F1"), 12.0));
//! page.content_ops.push(ContentOp::TextPosition(72.0, 720.0));
//! page.content_ops.push(ContentOp::ShowText(b"Hello, PDF!".to_vec()));
//! page.content_ops.push(ContentOp::EndText);
//! doc.finalize_page(page, false);
//!
//! let built = doc.build();
//! let pdf_bytes = serialize_document_to_bytes(&built);
//! assert!(pdf_bytes.starts_with(b"%PDF-1.7"));
//! ```

pub mod compliance;
pub mod compression;
pub mod content;
pub mod document;
pub mod font;
pub mod resources;
pub mod serializer;
pub mod tag;
pub mod types;
