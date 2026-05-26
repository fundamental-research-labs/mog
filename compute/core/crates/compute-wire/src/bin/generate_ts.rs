//! Generates TypeScript constants from compute-wire's Rust constants.
//!
//! Usage:
//!   cargo run -p compute-wire --bin generate-ts > path/to/constants.gen.ts

fn main() {
    print!("{}", compute_wire::generate_constants_ts());
}
