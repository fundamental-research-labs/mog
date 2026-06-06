#!/usr/bin/env python3
"""Extract top-line review ratings into a reusable CSV dataset."""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_FILE = SCRIPT_DIR / "ratings.csv"
EXPECTED_REVIEWS_PER_FOLDER = 100

REVIEW_FOLDERS = {
    "claude-code-review-of-claude-code-plans": ("claude-code", "claude-code"),
    "claude-code-review-of-codex-plans": ("claude-code", "codex"),
    "codex-review-of-claude-code-plans": ("codex", "claude-code"),
    "codex-review-of-codex-plans": ("codex", "codex"),
}

RATING_RE = re.compile(r"^Rating:\s*(?P<rating>\d+(?:\.\d+)?)/(?P<max>\d+(?:\.\d+)?)\s*$")
PLAN_FILE_RE = re.compile(r"^(?P<plan_id>\d{3})-(?P<slug>.+)\.md$")


@dataclass(frozen=True)
class ExtractedRating:
    review_set: str
    reviewer: str
    plan_author: str
    plan_id: str
    plan_slug: str
    filename: str
    relative_path: str
    rating: str
    max_rating: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract the first-line 'Rating: n/10' value from each review markdown file "
            "into a normalized CSV."
        )
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=SCRIPT_DIR,
        help="Plan ratings folder containing the four review folders.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_FILE,
        help="CSV file to write. Defaults to ratings.csv next to this script.",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Do not fail when a review folder has a count other than 100.",
    )
    return parser.parse_args()


def extract_rating(path: Path, root: Path, review_set: str, reviewer: str, plan_author: str) -> ExtractedRating:
    match = PLAN_FILE_RE.match(path.name)
    if match is None:
        raise ValueError(f"{path}: expected filename like 001-some-plan.md")

    with path.open("r", encoding="utf-8") as handle:
        first_line = handle.readline().strip()

    rating_match = RATING_RE.match(first_line)
    if rating_match is None:
        raise ValueError(f"{path}: first line is not 'Rating: n/10': {first_line!r}")

    return ExtractedRating(
        review_set=review_set,
        reviewer=reviewer,
        plan_author=plan_author,
        plan_id=match.group("plan_id"),
        plan_slug=match.group("slug"),
        filename=path.name,
        relative_path=path.relative_to(root).as_posix(),
        rating=rating_match.group("rating"),
        max_rating=rating_match.group("max"),
    )


def collect(root: Path, allow_partial: bool) -> list[ExtractedRating]:
    rows: list[ExtractedRating] = []
    for review_set, (reviewer, plan_author) in REVIEW_FOLDERS.items():
        folder = root / review_set
        if not folder.is_dir():
            raise FileNotFoundError(f"Missing review folder: {folder}")

        files = sorted(folder.glob("*.md"))
        if len(files) != EXPECTED_REVIEWS_PER_FOLDER and not allow_partial:
            raise ValueError(
                f"{folder}: expected {EXPECTED_REVIEWS_PER_FOLDER} markdown reviews, found {len(files)}"
            )

        for path in files:
            rows.append(extract_rating(path, root, review_set, reviewer, plan_author))

    return sorted(rows, key=lambda row: (row.review_set, row.plan_id, row.filename))


def write_csv(rows: list[ExtractedRating], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "review_set",
        "reviewer",
        "plan_author",
        "plan_id",
        "plan_slug",
        "filename",
        "relative_path",
        "rating",
        "max_rating",
    ]
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.__dict__)


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    rows = collect(root, args.allow_partial)
    write_csv(rows, args.output.resolve())

    expected_total = len(REVIEW_FOLDERS) * EXPECTED_REVIEWS_PER_FOLDER
    if len(rows) != expected_total and not args.allow_partial:
        raise ValueError(f"Expected {expected_total} extracted reviews, found {len(rows)}")

    print(f"Extracted {len(rows)} ratings to {args.output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
