// UTF-8 boundary invariant: byte lengths returned by this module describe
// ASCII operator tokens only.
#![allow(clippy::string_slice)]

use crate::ast::BinOp;

// Each infix operator has a left and right binding power (l_bp, r_bp).
//   Left-associative:  r_bp = l_bp + 1
//   Right-associative: r_bp = l_bp - 1

#[inline]
pub(super) const fn infix_bp(op: BinOp) -> (u8, u8) {
    match op {
        BinOp::Eq | BinOp::Neq | BinOp::Lt | BinOp::Gt | BinOp::Lte | BinOp::Gte => (2, 3),
        BinOp::Concat => (4, 5),
        BinOp::Add | BinOp::Sub => (6, 7),
        BinOp::Mul | BinOp::Div => (8, 9),
        BinOp::Pow => (11, 10),
        BinOp::Intersect => (15, 16),
    }
}

/// Prefix unary operators (+, -, @) bind tighter than multiplication/division
/// but looser than exponentiation.
pub(super) const PREFIX_BP: u8 = 10;

/// Postfix operators (%, call) bind tightest among normal operators.
pub(super) const POSTFIX_BP: u8 = 14;

/// Expression-level range operator `:` — tighter than intersection.
pub(super) const RANGE_L_BP: u8 = 18;
pub(super) const RANGE_R_BP: u8 = 19;

#[inline]
pub(super) fn peek_infix(input: &str) -> Option<(BinOp, usize)> {
    let bytes = input.as_bytes();
    match bytes.first()? {
        b'<' => match bytes.get(1) {
            Some(b'>') => Some((BinOp::Neq, 2)),
            Some(b'=') => Some((BinOp::Lte, 2)),
            _ => Some((BinOp::Lt, 1)),
        },
        b'>' => match bytes.get(1) {
            Some(b'=') => Some((BinOp::Gte, 2)),
            _ => Some((BinOp::Gt, 1)),
        },
        b'=' => Some((BinOp::Eq, 1)),
        b'&' => Some((BinOp::Concat, 1)),
        b'+' => Some((BinOp::Add, 1)),
        b'-' => Some((BinOp::Sub, 1)),
        b'*' => Some((BinOp::Mul, 1)),
        b'/' => Some((BinOp::Div, 1)),
        b'^' => Some((BinOp::Pow, 1)),
        _ => None,
    }
}
