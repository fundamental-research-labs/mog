mod edges;
mod page;
mod resolver;
mod rows;
mod sources;
mod types;
mod visitor;

pub use self::types::*;

use crate::mirror::CellMirror;
use crate::scheduler::ComputeCore;

use self::page::{decode_cursor, encode_cursor, snapshot_version};
use self::rows::{collect_source_rows, sort_key};
use self::sources::collect_sources;

pub fn collect_formula_reference_diagnostics(
    mirror: &CellMirror,
    compute: &ComputeCore,
    options: FormulaReferenceDiagnosticsOptions,
) -> Result<FormulaReferenceDiagnosticsPage, value_types::ComputeError> {
    let limit = options.limit.unwrap_or(1000).clamp(1, 5000) as usize;
    let snapshot_version = snapshot_version(
        compute,
        &options.document_id,
        &options.external_links.version,
    );
    let start = decode_cursor(options.cursor.as_deref(), &snapshot_version)?;
    let mut sources = collect_sources(mirror, compute, &options.document_id, options.sheet_id);
    sources.sort_by_key(|s| s.order);

    let mut rows = Vec::new();
    for source in &sources {
        collect_source_rows(mirror, source, &options, &snapshot_version, &mut rows);
    }
    rows.sort_by_key(sort_key);

    let total = rows.len();
    let diagnostics = rows.into_iter().skip(start).take(limit).collect::<Vec<_>>();
    let next = start + diagnostics.len();
    let next_cursor = (next < total).then(|| encode_cursor(&snapshot_version, next));
    Ok(FormulaReferenceDiagnosticsPage {
        diagnostics,
        next_cursor,
        snapshot_version,
    })
}
