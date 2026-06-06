#!/usr/bin/env python3
"""Analyze the extracted ratings CSV without reparsing review markdown."""

from __future__ import annotations

import argparse
import csv
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = SCRIPT_DIR / "ratings.csv"
DEFAULT_REPORT = SCRIPT_DIR / "rating-statistics.md"


@dataclass(frozen=True)
class RatingRow:
    review_set: str
    reviewer: str
    plan_author: str
    plan_id: str
    plan_slug: str
    filename: str
    relative_path: str
    rating: float
    max_rating: float


@dataclass(frozen=True)
class ReviewerPlanPreference:
    reviewer: str
    n: int
    mean_difference: float
    se_difference: float
    t_statistic: float
    degrees_of_freedom: int
    raw_p_value: float
    holm_p_value: float
    codex_wins: int
    claude_code_wins: int
    ties: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compute descriptive statistics from the extracted ratings CSV."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help="Extracted ratings CSV produced by extract_ratings.py.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help="Markdown report to write.",
    )
    parser.add_argument(
        "--no-report",
        action="store_true",
        help="Print the report only; do not write a markdown file.",
    )
    return parser.parse_args()


def read_rows(path: Path) -> list[RatingRow]:
    rows: list[RatingRow] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        required_fields = {
            "review_set",
            "reviewer",
            "plan_author",
            "plan_id",
            "plan_slug",
            "filename",
            "relative_path",
            "rating",
            "max_rating",
        }
        missing = required_fields.difference(reader.fieldnames or [])
        if missing:
            missing_list = ", ".join(sorted(missing))
            raise ValueError(f"{path} is missing required columns: {missing_list}")

        for raw in reader:
            rows.append(
                RatingRow(
                    review_set=raw["review_set"],
                    reviewer=raw["reviewer"],
                    plan_author=raw["plan_author"],
                    plan_id=raw["plan_id"],
                    plan_slug=raw["plan_slug"],
                    filename=raw["filename"],
                    relative_path=raw["relative_path"],
                    rating=float(raw["rating"]),
                    max_rating=float(raw["max_rating"]),
                )
            )
    return rows


def fmt(value: float) -> str:
    if math.isnan(value):
        return "n/a"
    if abs(value) < 0.0005:
        return "0"
    if value.is_integer():
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def fmt_p(value: float) -> str:
    if math.isnan(value):
        return "n/a"
    if value < 0.001:
        return "<0.001"
    return f"{value:.3f}".rstrip("0").rstrip(".")


def percentile(values: list[float], percent: float) -> float:
    if not values:
        return math.nan
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]

    rank = (len(ordered) - 1) * percent
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[int(rank)]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def summarize(rows: Iterable[RatingRow]) -> dict[str, float]:
    ratings = [row.rating for row in rows]
    if not ratings:
        return {
            "n": 0,
            "mean": math.nan,
            "median": math.nan,
            "stdev_sample": math.nan,
            "stdev_population": math.nan,
            "sem": math.nan,
            "min": math.nan,
            "q1": math.nan,
            "q3": math.nan,
            "max": math.nan,
        }

    return {
        "n": float(len(ratings)),
        "mean": statistics.mean(ratings),
        "median": statistics.median(ratings),
        "stdev_sample": statistics.stdev(ratings) if len(ratings) > 1 else math.nan,
        "stdev_population": statistics.pstdev(ratings),
        "sem": statistics.stdev(ratings) / math.sqrt(len(ratings)) if len(ratings) > 1 else math.nan,
        "min": min(ratings),
        "q1": percentile(ratings, 0.25),
        "q3": percentile(ratings, 0.75),
        "max": max(ratings),
    }


def grouped(rows: Iterable[RatingRow], key: str) -> list[tuple[str, dict[str, float]]]:
    groups: dict[str, list[RatingRow]] = defaultdict(list)
    for row in rows:
        groups[getattr(row, key)].append(row)
    return [(name, summarize(group_rows)) for name, group_rows in sorted(groups.items())]


def regularized_incomplete_beta(a: float, b: float, x: float) -> float:
    """Evaluate the regularized incomplete beta function with a continued fraction."""
    if x <= 0:
        return 0
    if x >= 1:
        return 1

    max_iterations = 200
    epsilon = 3e-14
    fpmin = 1e-300

    def beta_fraction(first: float, second: float, value: float) -> float:
        qab = first + second
        qap = first + 1
        qam = first - 1
        c = 1
        d = 1 - qab * value / qap
        if abs(d) < fpmin:
            d = fpmin
        d = 1 / d
        h = d

        for m in range(1, max_iterations + 1):
            m2 = 2 * m
            aa = m * (second - m) * value / ((qam + m2) * (first + m2))
            d = 1 + aa * d
            if abs(d) < fpmin:
                d = fpmin
            c = 1 + aa / c
            if abs(c) < fpmin:
                c = fpmin
            d = 1 / d
            h *= d * c

            aa = -(first + m) * (qab + m) * value / ((first + m2) * (qap + m2))
            d = 1 + aa * d
            if abs(d) < fpmin:
                d = fpmin
            c = 1 + aa / c
            if abs(c) < fpmin:
                c = fpmin
            d = 1 / d
            delta = d * c
            h *= delta
            if abs(delta - 1) < epsilon:
                return h

        raise RuntimeError("Incomplete beta continued fraction did not converge")

    log_beta_term = (
        math.lgamma(a + b)
        - math.lgamma(a)
        - math.lgamma(b)
        + a * math.log(x)
        + b * math.log1p(-x)
    )
    beta_term = math.exp(log_beta_term)
    if x < (a + 1) / (a + b + 2):
        return beta_term * beta_fraction(a, b, x) / a
    return 1 - beta_term * beta_fraction(b, a, 1 - x) / b


def student_t_cdf(t_statistic: float, degrees_of_freedom: int) -> float:
    if degrees_of_freedom <= 0:
        return math.nan
    if t_statistic == 0:
        return 0.5

    x = degrees_of_freedom / (degrees_of_freedom + t_statistic * t_statistic)
    tail_beta = regularized_incomplete_beta(degrees_of_freedom / 2, 0.5, x)
    if t_statistic > 0:
        return 1 - 0.5 * tail_beta
    return 0.5 * tail_beta


def two_sided_t_p_value(t_statistic: float, degrees_of_freedom: int) -> float:
    cdf = student_t_cdf(t_statistic, degrees_of_freedom)
    return min(1, 2 * min(cdf, 1 - cdf))


def paired_t_test(differences: list[float]) -> tuple[float, float, float, int]:
    if len(differences) < 2:
        return math.nan, math.nan, math.nan, len(differences) - 1

    mean_difference = statistics.mean(differences)
    sample_sd = statistics.stdev(differences)
    se_difference = sample_sd / math.sqrt(len(differences))
    degrees_of_freedom = len(differences) - 1
    if se_difference == 0:
        if mean_difference == 0:
            return mean_difference, se_difference, 0, degrees_of_freedom
        return mean_difference, se_difference, math.inf, degrees_of_freedom
    return mean_difference, se_difference, mean_difference / se_difference, degrees_of_freedom


def holm_adjust(p_values: list[float]) -> list[float]:
    indexed = sorted(enumerate(p_values), key=lambda item: item[1])
    adjusted = [math.nan] * len(p_values)
    running_max = 0.0
    total = len(p_values)
    for rank, (index, p_value) in enumerate(indexed, start=1):
        adjusted_p = min(1.0, (total - rank + 1) * p_value)
        running_max = max(running_max, adjusted_p)
        adjusted[index] = running_max
    return adjusted


def reviewer_plan_preference_tests(rows: list[RatingRow]) -> list[ReviewerPlanPreference]:
    by_plan_and_reviewer: dict[tuple[str, str], dict[str, RatingRow]] = defaultdict(dict)
    for row in rows:
        by_plan_and_reviewer[(row.plan_id, row.reviewer)][row.plan_author] = row

    raw_results: list[tuple[str, int, float, float, float, int, float, int, int, int]] = []
    for reviewer in sorted({row.reviewer for row in rows}):
        differences: list[float] = []
        for (_plan_id, pair_reviewer), author_rows in by_plan_and_reviewer.items():
            if pair_reviewer != reviewer:
                continue
            codex_row = author_rows.get("codex")
            claude_row = author_rows.get("claude-code")
            if codex_row and claude_row:
                differences.append(codex_row.rating - claude_row.rating)

        mean_difference, se_difference, t_statistic, degrees_of_freedom = paired_t_test(differences)
        if math.isinf(t_statistic):
            raw_p_value = 0.0
        elif math.isnan(t_statistic):
            raw_p_value = math.nan
        else:
            raw_p_value = two_sided_t_p_value(t_statistic, degrees_of_freedom)
        codex_wins = sum(1 for diff in differences if diff > 0)
        claude_code_wins = sum(1 for diff in differences if diff < 0)
        ties = sum(1 for diff in differences if diff == 0)
        raw_results.append(
            (
                reviewer,
                len(differences),
                mean_difference,
                se_difference,
                t_statistic,
                degrees_of_freedom,
                raw_p_value,
                codex_wins,
                claude_code_wins,
                ties,
            )
        )

    adjusted = holm_adjust([result[6] for result in raw_results])
    return [
        ReviewerPlanPreference(
            reviewer=reviewer,
            n=n,
            mean_difference=mean_difference,
            se_difference=se_difference,
            t_statistic=t_statistic,
            degrees_of_freedom=degrees_of_freedom,
            raw_p_value=raw_p_value,
            holm_p_value=holm_p_value,
            codex_wins=codex_wins,
            claude_code_wins=claude_code_wins,
            ties=ties,
        )
        for (
            reviewer,
            n,
            mean_difference,
            se_difference,
            t_statistic,
            degrees_of_freedom,
            raw_p_value,
            codex_wins,
            claude_code_wins,
            ties,
        ), holm_p_value in zip(
            raw_results, adjusted
        )
    ]


def paired_differences(rows: list[RatingRow]) -> list[str]:
    by_plan_and_reviewer: dict[tuple[str, str], dict[str, RatingRow]] = defaultdict(dict)
    for row in rows:
        by_plan_and_reviewer[(row.plan_id, row.reviewer)][row.plan_author] = row

    lines = [
        "| Reviewer | Complete pairs | Mean codex minus claude-code | Median diff | Codex wins | Claude-code wins | Ties |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for reviewer in sorted({row.reviewer for row in rows}):
        diffs: list[float] = []
        for (plan_id, pair_reviewer), author_rows in by_plan_and_reviewer.items():
            _ = plan_id
            if pair_reviewer != reviewer:
                continue
            codex_row = author_rows.get("codex")
            claude_row = author_rows.get("claude-code")
            if codex_row and claude_row:
                diffs.append(codex_row.rating - claude_row.rating)

        if not diffs:
            continue
        codex_wins = sum(1 for diff in diffs if diff > 0)
        claude_wins = sum(1 for diff in diffs if diff < 0)
        ties = sum(1 for diff in diffs if diff == 0)
        lines.append(
            "| {reviewer} | {n} | {mean} | {median} | {codex_wins} | {claude_wins} | {ties} |".format(
                reviewer=reviewer,
                n=len(diffs),
                mean=fmt(statistics.mean(diffs)),
                median=fmt(statistics.median(diffs)),
                codex_wins=codex_wins,
                claude_wins=claude_wins,
                ties=ties,
            )
        )
    return lines


def agreement(rows: list[RatingRow]) -> list[str]:
    by_plan_and_author: dict[tuple[str, str], dict[str, RatingRow]] = defaultdict(dict)
    for row in rows:
        by_plan_and_author[(row.plan_id, row.plan_author)][row.reviewer] = row

    diffs: list[float] = []
    for reviewer_rows in by_plan_and_author.values():
        codex_row = reviewer_rows.get("codex")
        claude_row = reviewer_rows.get("claude-code")
        if codex_row and claude_row:
            diffs.append(codex_row.rating - claude_row.rating)

    if not diffs:
        return ["No complete reviewer pairs found."]

    abs_diffs = [abs(diff) for diff in diffs]
    codex_higher = sum(1 for diff in diffs if diff > 0)
    claude_higher = sum(1 for diff in diffs if diff < 0)
    ties = sum(1 for diff in diffs if diff == 0)
    return [
        f"Complete reviewer pairs: {len(diffs)}",
        f"Mean codex-reviewer minus claude-code-reviewer: {fmt(statistics.mean(diffs))}",
        f"Median absolute reviewer difference: {fmt(statistics.median(abs_diffs))}",
        f"Reviewer agreement within 1 point: {sum(1 for diff in abs_diffs if diff <= 1)} / {len(abs_diffs)}",
        f"Codex reviewer higher: {codex_higher}; Claude Code reviewer higher: {claude_higher}; ties: {ties}",
    ]


def distribution_table(rows: list[RatingRow]) -> list[str]:
    counts = Counter(row.rating for row in rows)
    total = len(rows)
    lines = [
        "| Rating | Count | Percent |",
        "| ---: | ---: | ---: |",
    ]
    for rating in sorted(counts):
        percent = counts[rating] / total * 100 if total else 0
        lines.append(f"| {fmt(rating)} | {counts[rating]} | {percent:.1f}% |")
    return lines


def summary_table(title: str, summaries: list[tuple[str, dict[str, float]]]) -> list[str]:
    lines = [
        f"## {title}",
        "",
        "| Group | n | Mean | SEM | Median | Sample SD | Min | Q1 | Q3 | Max |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, stats in summaries:
        lines.append(
            "| {name} | {n} | {mean} | {sem} | {median} | {sd} | {min} | {q1} | {q3} | {max} |".format(
                name=name,
                n=int(stats["n"]),
                mean=fmt(stats["mean"]),
                sem=fmt(stats["sem"]),
                median=fmt(stats["median"]),
                sd=fmt(stats["stdev_sample"]),
                min=fmt(stats["min"]),
                q1=fmt(stats["q1"]),
                q3=fmt(stats["q3"]),
                max=fmt(stats["max"]),
            )
        )
    return lines


def reviewer_plan_preference_table(rows: list[RatingRow]) -> list[str]:
    comparisons = reviewer_plan_preference_tests(rows)
    lines = [
        "## Reviewer Plan-Author Preference Tests",
        "",
        "Paired two-sided t-tests compare matching plan IDs within each reviewer. Mean difference is `Codex-plan rating - Claude-Code-plan rating`; Holm p-values correct across these two reviewer-specific tests.",
        "",
        "| Reviewer | n | Mean diff | SE diff | t | df | Raw p | Holm p | Codex-plan wins | Claude-Code-plan wins | Ties | Significant at 0.05 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for comparison in comparisons:
        lines.append(
            "| {reviewer} | {n} | {mean} | {se} | {t_stat} | {df} | {raw_p} | {holm_p} | {codex_wins} | {claude_code_wins} | {ties} | {significant} |".format(
                reviewer=comparison.reviewer,
                n=comparison.n,
                mean=fmt(comparison.mean_difference),
                se=fmt(comparison.se_difference),
                t_stat=fmt(comparison.t_statistic),
                df=comparison.degrees_of_freedom,
                raw_p=fmt_p(comparison.raw_p_value),
                holm_p=fmt_p(comparison.holm_p_value),
                codex_wins=comparison.codex_wins,
                claude_code_wins=comparison.claude_code_wins,
                ties=comparison.ties,
                significant="yes" if comparison.holm_p_value < 0.05 else "no",
            )
        )
    return lines


def build_report(rows: list[RatingRow], input_path: Path) -> str:
    overall = summarize(rows)
    lines = [
        "# Rating Statistics",
        "",
        f"Input dataset: `{input_path.name}`",
        "",
        "## Overall",
        "",
        "| n | Mean | Median | Sample SD | Population SD | Min | Q1 | Q3 | Max |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        (
            f"| {int(overall['n'])} | {fmt(overall['mean'])} | {fmt(overall['median'])} | "
            f"{fmt(overall['stdev_sample'])} | {fmt(overall['stdev_population'])} | "
            f"{fmt(overall['min'])} | {fmt(overall['q1'])} | {fmt(overall['q3'])} | {fmt(overall['max'])} |"
        ),
        "",
        "## Distribution",
        "",
        *distribution_table(rows),
        "",
        *summary_table("By Review Set", grouped(rows, "review_set")),
        "",
        *summary_table("By Reviewer", grouped(rows, "reviewer")),
        "",
        *summary_table("By Reviewed Plan Author", grouped(rows, "plan_author")),
        "",
        *reviewer_plan_preference_table(rows),
        "",
        "## Paired Plan Author Comparison",
        "",
        *paired_differences(rows),
        "",
        "## Reviewer Agreement",
        "",
        *agreement(rows),
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    input_path = args.input.resolve()
    rows = read_rows(input_path)
    report = build_report(rows, input_path)
    print(report)

    if not args.no_report:
        report_path = args.report.resolve()
        report_path.write_text(report + "\n", encoding="utf-8")
        print(f"\nWrote {report_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
