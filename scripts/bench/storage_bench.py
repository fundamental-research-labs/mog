#!/usr/bin/env python3
"""Release storage/Office.js comparison using one fresh process per sample.

Requires Linux (/proc and wait4), GNU time, and Python 3; no third-party packages.
Builds the two Rust examples, generates a deterministic dense XLSX fixture,
then reports median wall/CPU/peak RSS and separately timed engine phases.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import time
import zipfile


WORKLOADS = (
    "blank_one", "numeric_100k", "chain_10k", "xlsx_100k", "officejs_1k", "sum_100k", "history_1k",
)


def source_digest(root):
    """Include new native source files as well as tracked changes in provenance."""
    names = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root,
    ).decode().split("\0")
    digest = hashlib.sha256()
    for name in sorted(set(names)):
        path = root / name
        if not path.is_file() or not (
            path.suffix == ".rs" or path.name in ("Cargo.toml", "Cargo.lock")
            or name == "scripts/bench/storage_bench.py"
        ):
            continue
        digest.update(name.encode() + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def dense_fixture(path):
    """10000 rows x 10 columns, numeric values 1..100000; no engine involved."""
    rows = []
    for row in range(1, 10_001):
        cells = "".join(
            f'<c r="{chr(65 + col)}{row}"><v>{(row - 1) * 10 + col + 1}</v></c>'
            for col in range(10)
        )
        rows.append(f'<row r="{row}">{cells}</row>')
    parts = {
        "[Content_Types].xml": '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>''',
        "_rels/.rels": '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''',
        "xl/workbook.xml": '''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>''',
        "xl/_rels/workbook.xml.rels": '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>''',
        "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:J10000"/><sheetData>' + "".join(rows) + '</sheetData></worksheet>',
    }
    with zipfile.ZipFile(path, "w") as archive:
        for name, contents in parts.items():
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, contents.encode(), compresslevel=6)


def sample(command, env, log_path):
    start = time.perf_counter()
    with log_path.open("w+") as log:
        # GNU time measures its child's RSS. Direct Python wait4 RSS includes
        # Python's pre-exec high-water mark and overstates small workloads.
        process = subprocess.Popen(
            ["/usr/bin/time", "-f", "peak_rss_kib\t%M", *command],
            env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        _, status, usage = os.wait4(process.pid, 0)
        process.returncode = os.waitstatus_to_exitcode(status)
        elapsed = time.perf_counter() - start
        log.seek(0)
        output = log.read()
    if process.returncode:
        raise RuntimeError(f"{command} exited {process.returncode}; see {log_path}\n{output[-8000:]}")
    phases = {}
    live_rss = None
    peak_rss = None
    for line in output.splitlines():
        if line.startswith("phase\t"):
            _, name, seconds = line.split("\t")
            phases[name] = float(seconds)
        if line.startswith("live_rss_kib\t"):
            live_rss = int(line.split("\t")[1])
        if line.startswith("peak_rss_kib\t"):
            peak_rss = int(line.split("\t")[1])
    if not phases:
        raise RuntimeError(f"No benchmark output in {log_path}")
    if peak_rss is None:
        raise RuntimeError(f"No peak RSS output in {log_path}")
    return {
        "wall_s": elapsed,
        "user_s": usage.ru_utime,
        "system_s": usage.ru_stime,
        "cpu_s": usage.ru_utime + usage.ru_stime,
        "peak_rss_kib": peak_rss,
        "live_rss_kib": live_rss,
        "phases_s": phases,
        "log": str(log_path),
    }


def medians(samples):
    result = {
        key: statistics.median(sample[key] for sample in samples)
        for key in ("wall_s", "user_s", "system_s", "cpu_s", "peak_rss_kib")
    }
    result["live_rss_kib"] = (
        statistics.median(sample["live_rss_kib"] for sample in samples)
        if samples[0]["live_rss_kib"] is not None else None
    )
    result["phases_s"] = {
        phase: statistics.median(sample["phases_s"][phase] for sample in samples)
        for phase in samples[0]["phases_s"]
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--compare", type=Path)
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    root = Path(__file__).resolve().parents[2]
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    build = ["cargo", "build", "--release", "--locked", "-p", "compute-core", "--example", "storage_bench", "-p", "mog", "--example", "storage_bench_officejs"]
    if not args.skip_build:
        subprocess.run(build, cwd=root, check=True)
    # Honor Cargo's target-dir config rather than assuming ./target.
    cargo = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--no-deps", "--format-version", "1"], cwd=root))
    examples = Path(cargo["target_directory"]) / "release" / "examples"
    fixture = args.output / "dense_100k.xlsx"
    dense_fixture(fixture)
    env = os.environ.copy()
    env["RAYON_NUM_THREADS"] = "1"
    result = {
        "label": args.label,
        "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "status": subprocess.check_output(["git", "status", "--short"], cwd=root, text=True),
        "tracked_diff_sha256": hashlib.sha256(subprocess.check_output(["git", "diff", "HEAD"], cwd=root)).hexdigest(),
        "source_tree_sha256": source_digest(root),
        "benchmark_binary_sha256": {
            name: hashlib.sha256((examples / name).read_bytes()).hexdigest()
            for name in ("storage_bench", "storage_bench_officejs")
        },
        "rustc": subprocess.check_output(["rustc", "--version"], text=True).strip(),
        "machine": {"system": platform.system(), "release": platform.release(), "architecture": platform.machine()},
        "cpu_count": os.cpu_count(),
        "mem_total": next(line.strip() for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith("MemTotal:")),
        "build_command": build,
        "rayon_num_threads": 1,
        "measurement": "GNU time child peak RSS; wait4 CPU and wall include the GNU time wrapper",
        "runs": args.runs,
        "warmups": 1,
        "fixture_sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
        "workloads": {},
    }
    print("| Workload | Wall ms | CPU ms | Peak RSS MiB |", flush=True)
    print("|---|---:|---:|---:|", flush=True)
    for workload in WORKLOADS:
        command = [str(examples / "storage_bench_officejs")] if workload == "officejs_1k" else [str(examples / "storage_bench"), workload]
        if workload == "xlsx_100k":
            command.append(str(fixture))
        sample(command, env, args.output / f"{workload}-warmup.log")
        samples = [sample(command, env, args.output / f"{workload}-{iteration}.log") for iteration in range(args.runs)]
        median = medians(samples)
        result["workloads"][workload] = {"command": command, "samples": samples, "median": median}
        print(f'| {workload} | {median["wall_s"] * 1000:.3f} | {median["cpu_s"] * 1000:.3f} | {median["peak_rss_kib"] / 1024:.2f} |', flush=True)
        # Preserve completed workloads if a later assertion exposes a bug.
        (args.output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
    print("\n| Workload / phase | Wall ms |")
    print("|---|---:|")
    for workload, entry in result["workloads"].items():
        for phase, seconds in entry["median"]["phases_s"].items():
            print(f"| {workload} / {phase} | {seconds * 1000:.3f} |")
    if args.compare:
        baseline = json.loads(args.compare.read_text())
        if baseline["fixture_sha256"] != result["fixture_sha256"]:
            raise RuntimeError("Fixture differs from baseline")
        if baseline["rustc"] != result["rustc"] or baseline["rayon_num_threads"] != result["rayon_num_threads"]:
            raise RuntimeError("Toolchain or Rayon thread count differs from baseline")
        print(f'\nCompared with {baseline["label"]} ({baseline["revision"]}):')
        print("| Workload | Wall change | CPU change | Peak RSS change |")
        print("|---|---:|---:|---:|")
        for workload, entry in result["workloads"].items():
            if workload not in baseline["workloads"]:
                continue
            before = baseline["workloads"][workload]["median"]
            after = entry["median"]
            changes = [f'{100 * (after[key] / before[key] - 1):+.1f}%' for key in ("wall_s", "cpu_s", "peak_rss_kib")]
            print(f'| {workload} | {" | ".join(changes)} |')


if __name__ == "__main__":
    main()
