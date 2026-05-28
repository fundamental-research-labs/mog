use crate::ast::{Span, Spanned};

#[test]
fn span_merge_covers_both_inputs() {
    assert_eq!(Span::new(5, 10).merge(Span::new(2, 7)), Span::new(2, 10));
}

#[test]
fn span_len_saturates_for_inverted_spans() {
    assert_eq!(Span::new(10, 3).len(), 0);
}

#[test]
fn span_is_empty_treats_inverted_spans_as_empty() {
    assert!(Span::empty().is_empty());
    assert!(Span::new(10, 3).is_empty());
    assert!(!Span::new(3, 10).is_empty());
}

#[test]
fn spanned_map_keeps_span() {
    let spanned = Spanned {
        node: 2,
        span: Span::new(1, 3),
    };

    let mapped = spanned.map(|n| n.to_string());

    assert_eq!(mapped.node, "2");
    assert_eq!(mapped.span, Span::new(1, 3));
}

#[test]
fn spanned_into_inner_returns_node() {
    let spanned = Spanned {
        node: "value",
        span: Span::new(1, 3),
    };

    assert_eq!(spanned.into_inner(), "value");
}

#[test]
fn spanned_display_delegates_to_node() {
    let spanned = Spanned {
        node: 42,
        span: Span::new(1, 3),
    };

    assert_eq!(format!("{spanned}"), "42");
}
