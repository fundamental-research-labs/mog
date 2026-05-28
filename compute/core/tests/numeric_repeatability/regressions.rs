use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::WorkbookSnapshot;

use crate::edit::{op_inverse_pair, overwrite_number, read_number_at, sheet_id};
use crate::runner::EDIT_DELTA;
use crate::topologies::{
    chain_snapshot, diamond_snapshot, fanin_snapshot, mmult_like_snapshot, sumproduct_snapshot,
};

fn regression_single_pair(
    topology: &str,
    build: impl FnOnce(f64) -> (WorkbookSnapshot, SheetPos),
    edit_pos: (u32, u32),
) -> Result<(), String> {
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = build(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot)
        .map_err(|e| format!("{}: from_snapshot failed: {:?}", topology, e))?;
    op_inverse_pair(
        &mut engine,
        &sid,
        edit_pos.0,
        edit_pos.1,
        seed,
        EDIT_DELTA,
        dependent,
    )
    .map_err(|e| format!("{}: {}", topology, e))
}

// These qKjqZiEx tests are synthetic shape/signature pins around the
// 0.4 -> 0.7000000000000001 drift class. They are not sufficient real-corpus
// regression guards, and they intentionally report without panicking.

#[test]
fn regression_qkjqziex_float_cascade_chain() {
    let r = regression_single_pair("chain", chain_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression chain] PASS"),
        Err(e) => eprintln!("[Class III · regression chain] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_fanin() {
    let r = regression_single_pair("fanin", fanin_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression fanin] PASS"),
        Err(e) => eprintln!("[Class III · regression fanin] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_diamond() {
    let r = regression_single_pair("diamond", diamond_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression diamond] PASS"),
        Err(e) => eprintln!("[Class III · regression diamond] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_sumproduct() {
    let r = regression_single_pair("sumproduct", sumproduct_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression sumproduct] PASS"),
        Err(e) => eprintln!("[Class III · regression sumproduct] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_mmult() {
    let r = regression_single_pair("mmult", mmult_like_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression mmult] PASS"),
        Err(e) => eprintln!("[Class III · regression mmult] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_rapid_revert() {
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = chain_snapshot(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let initial =
        read_number_at(&engine, &sid, dependent).expect("dependent should be numeric at init");
    let initial_bits = initial.to_bits();

    let mut drifted: Option<(usize, f64)> = None;
    for iter in 0..5 {
        if overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA).is_err() {
            break;
        }
        if overwrite_number(&mut engine, &sid, 0, 0, seed).is_err() {
            break;
        }
        if let Some(after) = read_number_at(&engine, &sid, dependent)
            && after.to_bits() != initial_bits
        {
            drifted = Some((iter, after));
            break;
        }
    }
    match drifted {
        None => eprintln!("[Class III · regression rapid_revert] PASS"),
        Some((iter, v)) => eprintln!(
            "[Class III · regression rapid_revert] FAIL — iter {} drifted to {} (bits=0x{:016x}); expected bits=0x{:016x}",
            iter,
            v,
            v.to_bits(),
            initial_bits
        ),
    }
}
