//! AccessLevel ordering + repr(u8) stability assertions.

use compute_security::AccessLevel;

#[test]
fn ordering_admin_write_read_structure_none() {
    assert!(AccessLevel::Admin > AccessLevel::Write);
    assert!(AccessLevel::Write > AccessLevel::Read);
    assert!(AccessLevel::Read > AccessLevel::Structure);
    assert!(AccessLevel::Structure > AccessLevel::None);
}

#[test]
fn ordering_is_transitive_all_pairs() {
    let ladder = [
        AccessLevel::None,
        AccessLevel::Structure,
        AccessLevel::Read,
        AccessLevel::Write,
        AccessLevel::Admin,
    ];
    for i in 0..ladder.len() {
        for j in 0..ladder.len() {
            match i.cmp(&j) {
                std::cmp::Ordering::Less => assert!(ladder[i] < ladder[j]),
                std::cmp::Ordering::Equal => assert_eq!(ladder[i], ladder[j]),
                std::cmp::Ordering::Greater => assert!(ladder[i] > ladder[j]),
            }
        }
    }
}

#[test]
fn repr_u8_discriminants_are_stable() {
    assert_eq!(AccessLevel::None.as_u8(), 0);
    assert_eq!(AccessLevel::Structure.as_u8(), 1);
    assert_eq!(AccessLevel::Read.as_u8(), 2);
    assert_eq!(AccessLevel::Write.as_u8(), 3);
    assert_eq!(AccessLevel::Admin.as_u8(), 4);
}

#[test]
fn repr_u8_matches_cast_value() {
    // The matrix cache in R1.2 will bit-pack levels using `as u8`; this
    // test pins `as_u8()` and `as u8` to agree so a future as-cast path
    // cannot silently drift.
    assert_eq!(AccessLevel::None as u8, AccessLevel::None.as_u8());
    assert_eq!(AccessLevel::Structure as u8, AccessLevel::Structure.as_u8());
    assert_eq!(AccessLevel::Read as u8, AccessLevel::Read.as_u8());
    assert_eq!(AccessLevel::Write as u8, AccessLevel::Write.as_u8());
    assert_eq!(AccessLevel::Admin as u8, AccessLevel::Admin.as_u8());
}

#[test]
fn serde_round_trip_all_variants() {
    for level in [
        AccessLevel::None,
        AccessLevel::Structure,
        AccessLevel::Read,
        AccessLevel::Write,
        AccessLevel::Admin,
    ] {
        let s = serde_json::to_string(&level).expect("serialize");
        let decoded: AccessLevel = serde_json::from_str(&s).expect("deserialize");
        assert_eq!(level, decoded);
    }
}

#[test]
fn serde_snake_case_on_wire() {
    // Lock down the wire form so legacy on-wire compatibility holds.
    assert_eq!(
        serde_json::to_string(&AccessLevel::None).unwrap(),
        "\"none\""
    );
    assert_eq!(
        serde_json::to_string(&AccessLevel::Structure).unwrap(),
        "\"structure\""
    );
    assert_eq!(
        serde_json::to_string(&AccessLevel::Read).unwrap(),
        "\"read\""
    );
    assert_eq!(
        serde_json::to_string(&AccessLevel::Write).unwrap(),
        "\"write\""
    );
    assert_eq!(
        serde_json::to_string(&AccessLevel::Admin).unwrap(),
        "\"admin\""
    );
}
