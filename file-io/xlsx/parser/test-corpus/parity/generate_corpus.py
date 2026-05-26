#!/usr/bin/env python3
"""
Excel Parity Test Corpus Generator

Generates XLSX fixture files for visual and behavioral parity testing
between mog and Excel Online. Each file isolates a single feature.

Usage:
    python generate_corpus.py                    # Generate all
    python generate_corpus.py --category cells   # Generate one category
    python generate_corpus.py --list              # List categories
"""

import argparse
import os
import sys
from pathlib import Path

# Category generators
from generators import (
    gen_cells,
    gen_floating_objects,
    gen_charts,
    gen_advanced,
    gen_behaviors,
    gen_composite,
    gen_controls,
    gen_overlays,
    gen_pivot,
)

CORPUS_DIR = Path(__file__).parent

CATEGORIES = {
    "cells": gen_cells.generate,
    "floating-objects": gen_floating_objects.generate,
    "charts": gen_charts.generate,
    "controls": gen_controls.generate,
    "overlays": gen_overlays.generate,
    "advanced": gen_advanced.generate,
    "behaviors": gen_behaviors.generate,
    "composite": gen_composite.generate,
    "pivots": gen_pivot.generate,
}


def generate_all(categories: list[str] | None = None):
    """Generate fixtures for specified categories (or all)."""
    targets = categories or list(CATEGORIES.keys())
    total_files = 0
    total_bytes = 0

    for cat in targets:
        if cat not in CATEGORIES:
            print(f"Unknown category: {cat}", file=sys.stderr)
            sys.exit(1)

        out_dir = CORPUS_DIR / cat
        out_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n{'='*60}")
        print(f"Generating: {cat}")
        print(f"{'='*60}")

        files = CATEGORIES[cat](out_dir)

        for f in files:
            size = os.path.getsize(f)
            total_bytes += size
            total_files += 1
            print(f"  {f.name:40s} {size:>8,} bytes")

    print(f"\n{'='*60}")
    print(f"Total: {total_files} files, {total_bytes:,} bytes")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Generate Excel parity test corpus")
    parser.add_argument(
        "--category", "-c",
        nargs="+",
        choices=list(CATEGORIES.keys()),
        help="Generate specific categories only",
    )
    parser.add_argument(
        "--list", "-l",
        action="store_true",
        help="List available categories",
    )
    args = parser.parse_args()

    if args.list:
        for cat in CATEGORIES:
            print(f"  {cat}")
        return

    generate_all(args.category)


if __name__ == "__main__":
    main()
