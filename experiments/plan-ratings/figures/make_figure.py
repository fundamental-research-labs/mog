#!/usr/bin/env python3
"""Twitter-ready 2x2 figure: do coding agents grade their own plans higher?

Reviewer (grader) x Plan author. Diagonal = self-review.
"""
import csv
import statistics as st
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.image as mpimg
from matplotlib.offsetbox import OffsetImage, AnnotationBbox
import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
EXPERIMENT_DIR = SCRIPT_DIR.parent
OUTPUT_PATH = SCRIPT_DIR / "self-preference-2x2.png"

LOGOS = {
    "claude-code": mpimg.imread(SCRIPT_DIR / "anthropic_w.png"),
    "codex": mpimg.imread(SCRIPT_DIR / "openai_w.png"),
}


def place_logo(ax, who, xy, zoom):
    im = OffsetImage(LOGOS[who], zoom=zoom)
    ab = AnnotationBbox(im, xy, frameon=False, box_alignment=(0.5, 0.5),
                        zorder=6, annotation_clip=False)
    ax.add_artist(ab)

# --- load ---------------------------------------------------------------
cells = defaultdict(list)
with (EXPERIMENT_DIR / "ratings.csv").open() as f:
    for r in csv.DictReader(f):
        cells[(r["reviewer"], r["plan_author"])].append(int(r["rating"]))

authors = ["claude-code", "codex"]           # columns: whose plan
reviewers = ["claude-code", "codex"]         # rows: who grades
labels = {"claude-code": "Claude Code", "codex": "Codex"}

mean = np.array([[st.mean(cells[(rv, au)]) for au in authors] for rv in reviewers])
sem = np.array([[st.stdev(cells[(rv, au)]) / len(cells[(rv, au)]) ** 0.5
                 for au in authors] for rv in reviewers])

# --- style --------------------------------------------------------------
plt.rcParams["font.family"] = "DejaVu Sans"
BG = "#0d1117"
FG = "#e6edf3"
MUTE = "#8b949e"

fig, ax = plt.subplots(figsize=(9, 9))
fig.patch.set_facecolor(BG)
ax.set_facecolor(BG)

# color: single-hue sequential ramp — darker = higher score (no pass/fail read)
from matplotlib.colors import LinearSegmentedColormap
# tighten range to the actual data (7.66–8.42) so differences are obvious
vmin, vmax = 7.62, 8.42
cmap = LinearSegmentedColormap.from_list(
    "score", ["#e3edf7", "#9dc0e6", "#4f8ad0", "#15539e"])
norm = plt.Normalize(vmin, vmax)

for i, rv in enumerate(reviewers):          # row
    for j, au in enumerate(authors):        # col
        m = mean[i, j]
        is_self = (rv == au)
        face = cmap(norm(m))
        # pick text color by fill luminance (dark text on light cells, vice versa)
        lum = 0.299 * face[0] + 0.587 * face[1] + 0.114 * face[2]
        ink = "#11151c" if lum > 0.55 else "#ffffff"
        rect = plt.Rectangle((j, 1 - i), 1, 1, facecolor=face,
                             edgecolor=BG, linewidth=6, zorder=1)
        ax.add_patch(rect)
        # highlight self-review diagonal
        if is_self:
            ax.add_patch(plt.Rectangle((j + 0.015, 1 - i + 0.015), 0.97, 0.97,
                                       fill=False, edgecolor="#ffffff",
                                       linewidth=3.5, linestyle=(0, (1, 1)),
                                       zorder=3))
        ax.text(j + 0.5, 1 - i + 0.60, f"{m:.2f}", ha="center", va="center",
                fontsize=52, fontweight="bold", color=ink, zorder=4)
        ax.text(j + 0.5, 1 - i + 0.34, f"±{sem[i, j]:.2f}  ·  n=100",
                ha="center", va="center", fontsize=14, color=ink,
                alpha=0.7, zorder=4)
        if is_self:
            ax.text(j + 0.5, 1 - i + 0.16, "self-review", ha="center", va="center",
                    fontsize=13, fontstyle="italic", color=ink,
                    alpha=0.8, zorder=4)

# axis framing
ax.set_xlim(-0.78, 2.05)
ax.set_ylim(-0.28, 3.02)
ax.set_aspect("equal")
ax.axis("off")

# column headers (plan author) — logo above name
ax.text(1.0, 2.40, "WHOSE PLAN IS GRADED", ha="center", va="center",
        fontsize=13, color=MUTE, fontweight="bold")
for j, au in enumerate(authors):
    place_logo(ax, au, (j + 0.5, 2.21), zoom=0.085)
    ax.text(j + 0.5, 2.04, labels[au], ha="center", va="center",
            fontsize=20, color=FG, fontweight="bold")

# row headers (reviewer) — logo above rotated name, on the left
ax.text(-0.62, 1.0, "WHO GRADES", ha="center", va="center", rotation=90,
        fontsize=13, color=MUTE, fontweight="bold")
for i, rv in enumerate(reviewers):
    place_logo(ax, rv, (-0.34, 1 - i + 0.5), zoom=0.09)
    ax.text(-0.13, 1 - i + 0.5, labels[rv], ha="center", va="center",
            rotation=90, fontsize=20, color=FG, fontweight="bold")

# title + subtitle
ax.text(1.0, 2.94, "Coding agents grade their own plans higher",
        ha="center", va="center", fontsize=24, color=FG, fontweight="bold")
ax.text(1.0, 2.76,
        "Each agent wrote 100 implementation plans, then both graded every plan /10",
        ha="center", va="center", fontsize=13.5, color=MUTE)
ax.text(1.0, 2.66,
        "Claude Code · Opus 4.8 (high)      Codex · GPT-5.5 (xhigh)",
        ha="center", va="center", fontsize=12, color=MUTE, fontstyle="italic")

# footer takeaway
ax.text(1.0, -0.22,
        "Both rate their own work best — Claude +0.46 over Codex, Codex +0.33 over Claude  (p<0.001)",
        ha="center", va="center", fontsize=12.5, color=MUTE)

plt.tight_layout()
fig.savefig(OUTPUT_PATH, dpi=200, facecolor=BG,
            bbox_inches="tight", pad_inches=0.35)
print(f"wrote {OUTPUT_PATH}")
