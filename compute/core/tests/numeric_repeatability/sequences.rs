use compute_core::storage::engine::YrsComputeEngine;

use crate::edit::{overwrite_number, read_number_at, sheet_id};
use crate::runner::{EDIT_DELTA, FamilyResult};
use crate::topologies::{chain_snapshot, fanin_snapshot};

/// 100 forward/inverse iterations on a chain with the 0.4 seed.
#[test]
fn class_iii_rapid_reverts() {
    let mut result = FamilyResult::new("rapid_reverts");
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = chain_snapshot(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");

    let initial = match read_number_at(&engine, &sid, dependent) {
        Some(v) => v,
        None => {
            eprintln!("[Class III · rapid_reverts] dependent not numeric at init");
            result.record(
                "rapid_reverts_init".to_string(),
                Err("dependent not numeric at init".to_string()),
            );
            result.report();
            return;
        }
    };
    let initial_bits = initial.to_bits();

    for iter in 0..100 {
        if let Err(e) = overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA) {
            result.record(format!("rapid_reverts_fwd_{:03}", iter), Err(e));
            continue;
        }
        if let Err(e) = overwrite_number(&mut engine, &sid, 0, 0, seed) {
            result.record(format!("rapid_reverts_inv_{:03}", iter), Err(e));
            continue;
        }
        let after = read_number_at(&engine, &sid, dependent);
        let outcome: Result<(), String> = match after {
            Some(v) if v.to_bits() == initial_bits => Ok(()),
            Some(v) => Err(format!(
                "iter {}: before_bits=0x{:016x} after={} (bits=0x{:016x})",
                iter,
                initial_bits,
                v,
                v.to_bits()
            )),
            None => Err(format!("iter {}: dependent not numeric", iter)),
        };
        result.record(format!("rapid_reverts_{:03}", iter), outcome);
    }
    result.report();
}

/// Nested op+inverse on two seeded cells: `op1 op2 inv2 inv1`.
#[test]
fn class_iii_edit_sequence_nested() {
    let mut result = FamilyResult::new("sequence_nested");
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = fanin_snapshot(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let before = read_number_at(&engine, &sid, dependent).expect("numeric initial");
    let before_bits = before.to_bits();

    let outcome: Result<(), String> = (|| {
        overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA)?;
        overwrite_number(&mut engine, &sid, 1, 0, seed + EDIT_DELTA)?;
        overwrite_number(&mut engine, &sid, 1, 0, seed)?;
        overwrite_number(&mut engine, &sid, 0, 0, seed)?;
        let after = read_number_at(&engine, &sid, dependent)
            .ok_or_else(|| "dependent not numeric after sequence".to_string())?;
        if after.to_bits() == before_bits {
            Ok(())
        } else {
            Err(format!(
                "nested: before_bits=0x{:016x} after_bits=0x{:016x} delta={}",
                before_bits,
                after.to_bits(),
                after - before
            ))
        }
    })();
    result.record("nested_two_cells_at_0_4".to_string(), outcome);
    result.report();
}

/// A/B/A: go to B then back to A. Dependent must bit-match A.
#[test]
fn class_iii_edit_sequence_aba() {
    let mut result = FamilyResult::new("sequence_aba");
    let sid = sheet_id();
    let seed_a = 0.4_f64;
    let seed_b = 0.7_f64;
    let (snapshot, dependent) = chain_snapshot(seed_a);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let before = read_number_at(&engine, &sid, dependent).expect("numeric initial");
    let before_bits = before.to_bits();

    let outcome: Result<(), String> = (|| {
        overwrite_number(&mut engine, &sid, 0, 0, seed_b)?;
        overwrite_number(&mut engine, &sid, 0, 0, seed_a)?;
        let after = read_number_at(&engine, &sid, dependent)
            .ok_or_else(|| "dependent not numeric after A/B/A".to_string())?;
        if after.to_bits() == before_bits {
            Ok(())
        } else {
            Err(format!(
                "aba: before_bits=0x{:016x} after_bits=0x{:016x} delta={}",
                before_bits,
                after.to_bits(),
                after - before
            ))
        }
    })();
    result.record("aba_0_4_to_0_7_back".to_string(), outcome);
    result.report();
}
