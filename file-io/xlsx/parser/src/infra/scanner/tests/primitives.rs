use crate::infra::scanner::*;

fn ref_find_byte(bytes: &[u8], start: usize, target: u8) -> Option<usize> {
    bytes
        .get(start..)?
        .iter()
        .position(|&b| b == target)
        .map(|pos| start + pos)
}

fn ref_find_any(bytes: &[u8], start: usize, targets: &[u8]) -> Option<(usize, u8)> {
    bytes
        .get(start..)?
        .iter()
        .enumerate()
        .find_map(|(offset, &b)| {
            if targets.contains(&b) {
                Some((start + offset, b))
            } else {
                None
            }
        })
}

fn ref_skip_xml_whitespace(bytes: &[u8], start: usize) -> usize {
    if start >= bytes.len() {
        return bytes.len();
    }

    bytes[start..]
        .iter()
        .position(|&b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
        .map_or(bytes.len(), |offset| start + offset)
}

#[test]
fn test_primitive_scanners_match_references_for_all_short_offsets() {
    let cases: &[&[u8]] = &[
        b"",
        b"<",
        b">",
        b"plain",
        b" <a>",
        b"\t\r\n<row r=\"1\">",
        b"abc>def<ghi",
        b"\x0b<formfeed\x0c>",
    ];
    let target_sets: &[&[u8]] = &[
        b"",
        b"<",
        b">",
        b"<>",
        b"=\"",
        b"<>'\"",
        b"abcde",
        b"abcdefg",
        b"<<>>==\"\"",
    ];

    for bytes in cases {
        for start in 0..=bytes.len() + 2 {
            assert_eq!(
                find_lt_simd(bytes, start),
                ref_find_byte(bytes, start, b'<')
            );
            assert_eq!(
                find_gt_simd(bytes, start),
                ref_find_byte(bytes, start, b'>')
            );
            assert_eq!(
                skip_whitespace_simd(bytes, start),
                ref_skip_xml_whitespace(bytes, start)
            );

            for targets in target_sets {
                assert_eq!(
                    find_any_simd(bytes, start, targets),
                    ref_find_any(bytes, start, targets),
                    "bytes={bytes:?}, start={start}, targets={targets:?}"
                );
            }
        }
    }
}

#[test]
fn test_primitive_scanners_match_references_around_chunk_boundaries() {
    let boundary_positions = [15, 16, 17, 31, 32, 33];
    let target_sets: &[&[u8]] = &[
        b"",
        b"<",
        b">",
        b"<>",
        b"<>\"",
        b"<>\"=",
        b"abcdef",
        b"01234567",
    ];

    for &position in &boundary_positions {
        for marker in [b'<', b'>', b'=', b'"', b'g'] {
            let mut bytes = vec![b'x'; 48];
            bytes[position] = marker;
            bytes[0] = b'<';
            bytes[47] = b'>';

            for start in [
                0,
                1,
                position.saturating_sub(1),
                position,
                position + 1,
                48,
                49,
            ] {
                assert_eq!(
                    find_lt_simd(&bytes, start),
                    ref_find_byte(&bytes, start, b'<')
                );
                assert_eq!(
                    find_gt_simd(&bytes, start),
                    ref_find_byte(&bytes, start, b'>')
                );

                for targets in target_sets {
                    assert_eq!(
                        find_any_simd(&bytes, start, targets),
                        ref_find_any(&bytes, start, targets),
                        "position={position}, marker={marker}, start={start}, targets={targets:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn test_find_any_target_lengths_zero_through_eight_and_duplicates() {
    let bytes = b"prefix-a-middle-=-suffix->";
    let target_sets: &[&[u8]] = &[
        b"",
        b"z",
        b"za",
        b"za=",
        b"za=<",
        b"za=<m",
        b"za=<m-",
        b"za=<m->",
        b"za=<m->p",
        b"zz==aa>>",
    ];

    for targets in target_sets {
        for start in 0..=bytes.len() + 1 {
            assert_eq!(
                find_any_simd(bytes, start, targets),
                ref_find_any(bytes, start, targets),
                "target length {}, start {start}",
                targets.len()
            );
        }
    }
}

#[test]
fn test_skip_whitespace_xml_set_only() {
    let bytes = b" \t\n\r\x0b\x0ctext";
    assert_eq!(skip_whitespace_simd(bytes, 0), 4);
    assert_eq!(skip_whitespace_simd(bytes, 4), 4);
    assert_eq!(skip_whitespace_simd(b" \t\n\r", 0), 4);
    assert_eq!(skip_whitespace_simd(b"text", 4), 4);
    assert_eq!(skip_whitespace_simd(b"text", 5), 4);
}

// -------------------------------------------------------------------------
// find_lt_simd tests
// -------------------------------------------------------------------------

#[test]
fn test_find_lt_at_start() {
    let bytes = b"<tag>content</tag>";
    assert_eq!(find_lt_simd(bytes, 0), Some(0));
}

#[test]
fn test_find_lt_in_middle() {
    let bytes = b"some text <tag>";
    assert_eq!(find_lt_simd(bytes, 0), Some(10));
}

#[test]
fn test_find_lt_from_offset() {
    let bytes = b"<first><second>";
    assert_eq!(find_lt_simd(bytes, 1), Some(7));
}

#[test]
fn test_find_lt_not_found() {
    let bytes = b"no angle brackets here";
    assert_eq!(find_lt_simd(bytes, 0), None);
}

#[test]
fn test_find_lt_empty_input() {
    let bytes = b"";
    assert_eq!(find_lt_simd(bytes, 0), None);
}

#[test]
fn test_find_lt_start_past_end() {
    let bytes = b"<tag>";
    assert_eq!(find_lt_simd(bytes, 100), None);
}

#[test]
fn test_find_lt_large_input() {
    // Test with input larger than 16 bytes to exercise optimized search.
    let mut bytes = vec![b'x'; 100];
    bytes[50] = b'<';
    assert_eq!(find_lt_simd(&bytes, 0), Some(50));
}

#[test]
fn test_find_lt_multiple_occurrences() {
    let bytes = b"<a><b><c>";
    assert_eq!(find_lt_simd(bytes, 0), Some(0));
    assert_eq!(find_lt_simd(bytes, 1), Some(3));
    assert_eq!(find_lt_simd(bytes, 4), Some(6));
}

#[test]
fn test_find_lt_at_16_byte_boundary() {
    let mut bytes = vec![b'x'; 32];
    bytes[16] = b'<';
    assert_eq!(find_lt_simd(&bytes, 0), Some(16));
}

#[test]
fn test_find_lt_in_remainder() {
    // Test finding '<' near the end of a short suffix.
    let mut bytes = vec![b'x'; 20];
    bytes[18] = b'<';
    assert_eq!(find_lt_simd(&bytes, 0), Some(18));
}

// -------------------------------------------------------------------------
// find_gt_simd tests
// -------------------------------------------------------------------------

#[test]
fn test_find_gt_basic() {
    let bytes = b"<tag>content";
    assert_eq!(find_gt_simd(bytes, 0), Some(4));
}

#[test]
fn test_find_gt_from_offset() {
    let bytes = b"<a>text<b>more";
    assert_eq!(find_gt_simd(bytes, 4), Some(9));
}

#[test]
fn test_find_gt_not_found() {
    let bytes = b"<tag without close";
    assert_eq!(find_gt_simd(bytes, 5), None);
}

#[test]
fn test_find_gt_large_input() {
    let mut bytes = vec![b'x'; 100];
    bytes[75] = b'>';
    assert_eq!(find_gt_simd(&bytes, 0), Some(75));
}

// -------------------------------------------------------------------------
// find_any_simd tests
// -------------------------------------------------------------------------

#[test]
fn test_find_any_single_target() {
    let bytes = b"attr=\"value\"";
    assert_eq!(find_any_simd(bytes, 0, &[b'=']), Some((4, b'=')));
}

#[test]
fn test_find_any_two_targets() {
    let bytes = b"attr=\"value\"";
    assert_eq!(find_any_simd(bytes, 0, &[b'=', b'"']), Some((4, b'=')));
}

#[test]
fn test_find_any_three_targets() {
    let bytes = b"<tag attr=\"val\">";
    assert_eq!(
        find_any_simd(bytes, 0, &[b'<', b'=', b'"']),
        Some((0, b'<'))
    );
}

#[test]
fn test_find_any_four_targets() {
    let bytes = b"text<tag>";
    assert_eq!(
        find_any_simd(bytes, 0, &[b'<', b'>', b'"', b'=']),
        Some((4, b'<'))
    );
}

#[test]
fn test_find_any_from_offset() {
    let bytes = b"<a>text<b>";
    assert_eq!(find_any_simd(bytes, 4, &[b'<', b'>']), Some((7, b'<')));
}

#[test]
fn test_find_any_not_found() {
    let bytes = b"plain text";
    assert_eq!(find_any_simd(bytes, 0, &[b'<', b'>']), None);
}

#[test]
fn test_find_any_empty_targets() {
    let bytes = b"<tag>";
    assert_eq!(find_any_simd(bytes, 0, &[]), None);
}

#[test]
fn test_find_any_large_input() {
    let mut bytes = vec![b'x'; 100];
    bytes[60] = b'"';
    assert_eq!(
        find_any_simd(&bytes, 0, &[b'"', b'<', b'>']),
        Some((60, b'"'))
    );
}

#[test]
fn test_find_any_target_counts_match_in_simd_sized_chunks() {
    let cases: &[(&[u8], u8)] = &[
        (b"a", b'a'),
        (b"ab", b'b'),
        (b"abc", b'c'),
        (b"abcd", b'd'),
        (b"abcde", b'e'),
    ];

    for &(targets, expected_byte) in cases {
        let mut bytes = vec![b'x'; 64];
        bytes[32] = expected_byte;
        assert_eq!(
            find_any_simd(&bytes, 0, targets),
            Some((32, expected_byte)),
            "target count {} should find byte in a full 16-byte chunk",
            targets.len()
        );
    }
}

#[test]
fn test_find_any_target_counts_match_in_scalar_remainders() {
    let cases: &[(&[u8], u8)] = &[
        (b"a", b'a'),
        (b"ab", b'b'),
        (b"abc", b'c'),
        (b"abcd", b'd'),
        (b"abcde", b'e'),
    ];

    for &(targets, expected_byte) in cases {
        let mut bytes = vec![b'x'; 35];
        bytes[34] = expected_byte;
        assert_eq!(
            find_any_simd(&bytes, 0, targets),
            Some((34, expected_byte)),
            "target count {} should find byte in the scalar remainder",
            targets.len()
        );
    }
}

#[test]
fn test_find_any_more_than_five_targets_checks_later_targets() {
    let mut bytes = vec![b'x'; 64];
    bytes[48] = b'g';

    assert_eq!(find_any_simd(&bytes, 0, b"abcdefg"), Some((48, b'g')));
}
