#![cfg(feature = "audit-tests")]

use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::WorkbookSnapshot;
use std::time::Instant;

use crate::edit::{op_inverse_pair, overwrite_number, read_number_at, sheet_id};
use crate::runner::{EDIT_DELTA, FamilyResult};
use crate::seeds::seeds;
use crate::topologies::{
    chain_snapshot, diamond_snapshot, fanin_snapshot, mixed_type_snapshot, mmult_like_snapshot,
    sumproduct_snapshot,
};

/// Re-run every family, sum the counts, and emit a total. This duplicates
/// per-family execution so `cargo test` output shows individual families
/// and a grand total.
#[test]
fn class_iii_total() {
    let start = Instant::now();
    let sid = sheet_id();
    let mut total_passed = 0usize;
    let mut total_failed = 0usize;

    let mut run_topology = |family: &'static str,
                            build: &dyn Fn(f64) -> (WorkbookSnapshot, SheetPos),
                            edit_pos: (u32, u32)| {
        let mut fam = FamilyResult::new(family);
        for seed in seeds() {
            let (snapshot, dependent) = build(seed.value);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let outcome = op_inverse_pair(
                &mut engine,
                &sid,
                edit_pos.0,
                edit_pos.1,
                seed.value,
                EDIT_DELTA,
                dependent,
            );
            fam.record(format!("{}_{}", family, seed.slug), outcome);
        }
        total_passed += fam.passed;
        total_failed += fam.failed;
    };

    run_topology("chain", &chain_snapshot, (0, 0));
    run_topology("fanin", &fanin_snapshot, (0, 0));
    run_topology("diamond", &diamond_snapshot, (0, 0));
    run_topology("sumproduct", &sumproduct_snapshot, (0, 0));

    {
        let mut fam = FamilyResult::new("mmult");
        let seed = 0.4_f64;
        let (snapshot, dependent) = mmult_like_snapshot(seed);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed, EDIT_DELTA, dependent);
        fam.record("mmult_like_3x3_at_0_4".to_string(), outcome);
        total_passed += fam.passed;
        total_failed += fam.failed;
    }

    {
        let mut fam = FamilyResult::new("mixed_type");
        let float_seeds: &[(f64, &str)] = &[
            (0.1, "p0_1"),
            (0.4, "p0_4"),
            (0.7, "p0_7"),
            (1.0 / 3.0, "one_third"),
            (0.1 + 0.2, "sum0_1_0_2"),
        ];
        let int_seeds: &[(f64, &str)] = &[
            (1.0, "i1"),
            (2.0, "i2"),
            (42.0, "i42"),
            (0.0, "i0"),
            (-7.0, "i_neg7"),
        ];
        for (f_seed, f_slug) in float_seeds {
            let (snapshot, dependent) = mixed_type_snapshot(1.0, *f_seed);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, 1.0, 1.0, dependent);
            fam.record(format!("edit_int_with_float_{}", f_slug), outcome);
        }
        for (i_seed, i_slug) in int_seeds {
            let (snapshot, dependent) = mixed_type_snapshot(*i_seed, 0.4);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let outcome = op_inverse_pair(&mut engine, &sid, 1, 0, 0.4, EDIT_DELTA, dependent);
            fam.record(format!("edit_float_with_int_{}", i_slug), outcome);
        }
        total_passed += fam.passed;
        total_failed += fam.failed;
    }

    {
        let mut fam = FamilyResult::new("rapid_reverts");
        let seed = 0.4_f64;
        let (snapshot, dependent) = chain_snapshot(seed);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        if let Some(initial) = read_number_at(&engine, &sid, dependent) {
            let initial_bits = initial.to_bits();
            for iter in 0..100 {
                let outcome = (|| {
                    overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA)?;
                    overwrite_number(&mut engine, &sid, 0, 0, seed)?;
                    let after = read_number_at(&engine, &sid, dependent)
                        .ok_or_else(|| "dependent not numeric".to_string())?;
                    if after.to_bits() == initial_bits {
                        Ok(())
                    } else {
                        Err(format!(
                            "iter {}: after_bits=0x{:016x} expected=0x{:016x}",
                            iter,
                            after.to_bits(),
                            initial_bits
                        ))
                    }
                })();
                fam.record(format!("rapid_{:03}", iter), outcome);
            }
        }
        total_passed += fam.passed;
        total_failed += fam.failed;
    }

    {
        let mut fam = FamilyResult::new("sequence");
        let seed = 0.4_f64;
        {
            let (snapshot, dependent) = fanin_snapshot(seed);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let before = read_number_at(&engine, &sid, dependent);
            let outcome = match before {
                Some(b) => {
                    let before_bits = b.to_bits();
                    (|| -> Result<(), String> {
                        overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA)?;
                        overwrite_number(&mut engine, &sid, 1, 0, seed + EDIT_DELTA)?;
                        overwrite_number(&mut engine, &sid, 1, 0, seed)?;
                        overwrite_number(&mut engine, &sid, 0, 0, seed)?;
                        let after = read_number_at(&engine, &sid, dependent)
                            .ok_or_else(|| "dependent not numeric".to_string())?;
                        if after.to_bits() == before_bits {
                            Ok(())
                        } else {
                            Err(format!(
                                "nested: after_bits=0x{:016x} expected=0x{:016x}",
                                after.to_bits(),
                                before_bits
                            ))
                        }
                    })()
                }
                None => Err("initial dependent not numeric".to_string()),
            };
            fam.record("nested".to_string(), outcome);
        }
        {
            let (snapshot, dependent) = chain_snapshot(seed);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let before = read_number_at(&engine, &sid, dependent);
            let outcome = match before {
                Some(b) => {
                    let before_bits = b.to_bits();
                    (|| -> Result<(), String> {
                        overwrite_number(&mut engine, &sid, 0, 0, 0.7)?;
                        overwrite_number(&mut engine, &sid, 0, 0, seed)?;
                        let after = read_number_at(&engine, &sid, dependent)
                            .ok_or_else(|| "dependent not numeric".to_string())?;
                        if after.to_bits() == before_bits {
                            Ok(())
                        } else {
                            Err(format!(
                                "aba: after_bits=0x{:016x} expected=0x{:016x}",
                                after.to_bits(),
                                before_bits
                            ))
                        }
                    })()
                }
                None => Err("initial dependent not numeric".to_string()),
            };
            fam.record("aba".to_string(), outcome);
        }
        total_passed += fam.passed;
        total_failed += fam.failed;
    }

    let elapsed = start.elapsed();
    let total = total_passed + total_failed;
    eprintln!(
        "[Class III total] {}/{} passed, {} failed ({:?})",
        total_passed, total, total_failed, elapsed
    );

    assert_eq!(
        total_failed, 0,
        "Class III total: {} failures — see per-family stderr output above \
         for the named bugs, and `qKjqZiEx` for the root-cause analysis.",
        total_failed,
    );
}
