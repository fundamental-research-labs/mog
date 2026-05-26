use criterion::{Criterion, criterion_group, criterion_main};

fn parser_benchmarks(_c: &mut Criterion) {
    // TODO: benchmark formula parsing throughput
}

criterion_group!(benches, parser_benchmarks);
criterion_main!(benches);
