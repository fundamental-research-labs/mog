use compute_parser::{normalize_xlsx_formula, parse_formula};
use criterion::{Criterion, black_box, criterion_group, criterion_main};

fn bench_simple(c: &mut Criterion) {
    let mut group = c.benchmark_group("simple");
    group.bench_function("number", |b| {
        b.iter(|| parse_formula(black_box("=42"), None));
    });
    group.bench_function("cell_ref", |b| {
        b.iter(|| parse_formula(black_box("=A1"), None));
    });
    group.bench_function("add", |b| {
        b.iter(|| parse_formula(black_box("=A1+B1"), None));
    });
    group.bench_function("sum_range", |b| {
        b.iter(|| parse_formula(black_box("=SUM(A1:B10)"), None));
    });
    group.bench_function("string", |b| {
        b.iter(|| parse_formula(black_box("=\"hello\""), None));
    });
    group.bench_function("boolean", |b| {
        b.iter(|| parse_formula(black_box("=TRUE"), None));
    });
    group.finish();
}

fn bench_medium(c: &mut Criterion) {
    let mut group = c.benchmark_group("medium");
    group.bench_function("if_and", |b| {
        b.iter(|| parse_formula(black_box("=IF(AND(A1>0,B1<10),SUM(C:C),0)"), None));
    });
    group.bench_function("vlookup", |b| {
        b.iter(|| parse_formula(black_box("=VLOOKUP(A1,Sheet2!A:D,3,FALSE)"), None));
    });
    group.bench_function("nested_if", |b| {
        b.iter(|| parse_formula(black_box("=IF(A1>0,IF(B1>0,C1,D1),E1)"), None));
    });
    group.bench_function("index_match", |b| {
        b.iter(|| parse_formula(black_box("=INDEX(A:A,MATCH(B1,C:C,0))"), None));
    });
    group.bench_function("concat", |b| {
        b.iter(|| parse_formula(black_box("=A1&\" \"&B1&\" \"&C1"), None));
    });
    group.finish();
}

fn bench_complex(c: &mut Criterion) {
    let mut group = c.benchmark_group("complex");
    group.bench_function("lambda", |b| {
        b.iter(|| parse_formula(black_box("=(LAMBDA(x,y,x+y*2))(A1,B1)"), None));
    });
    group.bench_function("structured_ref", |b| {
        b.iter(|| parse_formula(black_box("=SUM(Table1[[#Data],[Revenue]])"), None));
    });
    group.bench_function("nested_10_deep", |b| {
        b.iter(|| {
            parse_formula(
                black_box("=SUM(SUM(SUM(SUM(SUM(SUM(SUM(SUM(SUM(SUM(1))))))))))"),
                None,
            )
        });
    });
    group.bench_function("array_literal", |b| {
        b.iter(|| parse_formula(black_box("={1,2,3,4,5;6,7,8,9,10;11,12,13,14,15}"), None));
    });
    group.finish();
}

fn bench_pathological(c: &mut Criterion) {
    let mut group = c.benchmark_group("pathological");
    let deep_parens = format!("={}1{}", "(".repeat(50), ")".repeat(50));
    group.bench_function("50_deep_parens", |b| {
        b.iter(|| parse_formula(black_box(&deep_parens), None));
    });
    let long_chain = format!("=A1{}", "+B1".repeat(20));
    group.bench_function("20_operator_chain", |b| {
        b.iter(|| parse_formula(black_box(&long_chain), None));
    });
    let many_args = format!(
        "=SUM({})",
        (1..=50)
            .map(|i| format!("A{i}"))
            .collect::<Vec<_>>()
            .join(",")
    );
    group.bench_function("50_arg_function", |b| {
        b.iter(|| parse_formula(black_box(&many_args), None));
    });
    group.finish();
}

fn bench_normalize(c: &mut Criterion) {
    let mut group = c.benchmark_group("normalize");
    group.bench_function("clean", |b| {
        b.iter(|| normalize_xlsx_formula(black_box("IF(A1>0,SUM(B:B),0)")));
    });
    group.bench_function("xlfn_prefix", |b| {
        b.iter(|| normalize_xlsx_formula(black_box("_xlfn.IF(A1>0,_xlfn.SUM(B:B),0)")));
    });
    group.bench_function("entities", |b| {
        b.iter(|| {
            normalize_xlsx_formula(black_box(
                "IF(A1&amp;B1&gt;0,&quot;yes&quot;,&quot;no&quot;)",
            ))
        });
    });
    group.bench_function("full_normalization", |b| {
        b.iter(|| {
            normalize_xlsx_formula(black_box(
                "_xlfn.LET(_xlpm.x,Sheet1!A1&amp;B1,_xlfn.IF(_xlpm.x&gt;0,1,0))",
            ))
        });
    });
    group.finish();
}

fn bench_throughput(c: &mut Criterion) {
    let formulas: Vec<String> = vec![
        "=A1+B1".into(),
        "=SUM(A1:A100)".into(),
        "=IF(A1>0,B1,C1)".into(),
        "=VLOOKUP(A1,B:D,3,FALSE)".into(),
        "=A1&\" \"&B1".into(),
        "=INDEX(A:A,MATCH(B1,C:C,0))".into(),
        "=42".into(),
        "=\"hello\"".into(),
        "=TRUE".into(),
        "=SUM(A1,B1,C1,D1,E1)".into(),
    ];

    c.bench_function("throughput_10k_mixed", |b| {
        b.iter(|| {
            for _ in 0..1000 {
                for f in &formulas {
                    let _ = parse_formula(black_box(f), None);
                }
            }
        });
    });
}

criterion_group!(
    benches,
    bench_simple,
    bench_medium,
    bench_complex,
    bench_pathological,
    bench_normalize,
    bench_throughput,
);
criterion_main!(benches);
