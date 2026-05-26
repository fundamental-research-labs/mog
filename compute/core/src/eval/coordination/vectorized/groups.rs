use rustc_hash::{FxHashMap, FxHashSet};

use cell_types::{CellId, SheetId};
use compute_parser::ASTNode;

use super::pattern::{collect_input_columns, extract_vec_pattern};
use super::types::{SharedFormulaGroup, VecOp};

// ---------------------------------------------------------------------------
// Group detection
// ---------------------------------------------------------------------------

/// Detect shared formula groups within a dirty set.
///
/// `dirty_set`: cells that need recalculation.
/// `get_ast`: returns a borrowed AST for a cell ID (avoids cloning the entire cache).
/// `resolve_pos`: resolves a CellId to (sheet, row, col) position.
/// `min_group_size`: minimum consecutive cells to form a group (e.g., 256).
pub fn detect_groups<'a>(
    dirty_set: &FxHashSet<CellId>,
    get_ast: impl Fn(&CellId) -> Option<&'a ASTNode>,
    resolve_pos: impl Fn(&CellId) -> Option<(SheetId, u32, u32)>,
    min_group_size: usize,
) -> Vec<SharedFormulaGroup> {
    // Step 1: For each dirty cell, resolve position and extract pattern
    struct CellEntry {
        cell_id: CellId,
        sheet: SheetId,
        row: u32,
        col: u32,
        pattern: VecOp,
    }

    let mut entries: Vec<CellEntry> = Vec::new();

    for &cell_id in dirty_set {
        if let Some(ast) = get_ast(&cell_id)
            && let Some((sheet, row, col)) = resolve_pos(&cell_id)
            && let Some(pattern) = extract_vec_pattern(ast, sheet, col)
        {
            entries.push(CellEntry {
                cell_id,
                sheet,
                row,
                col,
                pattern,
            });
        }
    }

    // Step 2: Sort by (sheet, col, row)
    entries.sort_by(|a, b| {
        a.sheet
            .as_u128()
            .cmp(&b.sheet.as_u128())
            .then(a.col.cmp(&b.col))
            .then(a.row.cmp(&b.row))
    });

    // Step 3: Walk sorted list, group consecutive cells with same (sheet, col, pattern)
    let mut groups = Vec::new();

    let mut i = 0;
    while i < entries.len() {
        let start = i;
        let ref_entry = &entries[start];
        let sheet = ref_entry.sheet;
        let col = ref_entry.col;
        let pattern = &ref_entry.pattern;

        // Find the end of this consecutive run
        i += 1;
        while i < entries.len() {
            let e = &entries[i];
            if e.sheet != sheet || e.col != col || e.pattern != *pattern {
                break;
            }
            // Check consecutive row
            if e.row != entries[i - 1].row + 1 {
                break;
            }
            i += 1;
        }

        let group_len = i - start;
        if group_len >= min_group_size {
            let start_row = entries[start].row;
            let end_row = entries[i - 1].row + 1; // exclusive
            let cell_ids: Vec<CellId> = entries[start..i].iter().map(|e| e.cell_id).collect();
            let input_columns = collect_input_columns(pattern, sheet, col);

            groups.push(SharedFormulaGroup {
                sheet,
                col,
                start_row,
                end_row,
                pattern: pattern.clone(),
                cell_ids,
                input_columns,
            });
        }
    }

    groups
}

// ---------------------------------------------------------------------------
// Group ordering (topological sort)
// ---------------------------------------------------------------------------

/// Order groups by column dependencies (topological sort).
/// Returns indices in valid evaluation order. Cycles are excluded.
pub fn order_groups(groups: &[SharedFormulaGroup]) -> Vec<usize> {
    let n = groups.len();
    if n == 0 {
        return Vec::new();
    }

    // Build a map from (sheet, col) -> list of group indices that output to that column
    let mut output_map: FxHashMap<(SheetId, u32), Vec<usize>> = FxHashMap::default();
    for (idx, g) in groups.iter().enumerate() {
        output_map.entry((g.sheet, g.col)).or_default().push(idx);
    }

    // Build adjacency: in_degree[i] and adj[i] (i depends on j means j -> i)
    let mut in_degree = vec![0u32; n];
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];

    for (idx, g) in groups.iter().enumerate() {
        for &(sheet, col) in &g.input_columns {
            if let Some(providers) = output_map.get(&(sheet, col)) {
                for &provider in providers {
                    if provider != idx {
                        adj[provider].push(idx);
                        in_degree[idx] += 1;
                    }
                }
            }
        }
    }

    // Kahn's algorithm
    let mut queue: Vec<usize> = Vec::new();
    for (i, deg) in in_degree.iter().enumerate() {
        if *deg == 0 {
            queue.push(i);
        }
    }

    let mut result = Vec::with_capacity(n);
    let mut head = 0;
    while head < queue.len() {
        let node = queue[head];
        head += 1;
        result.push(node);

        for &next in &adj[node] {
            in_degree[next] -= 1;
            if in_degree[next] == 0 {
                queue.push(next);
            }
        }
    }

    // If result.len() < n, some groups are in cycles and excluded
    result
}
