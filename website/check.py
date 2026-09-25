#!/usr/bin/env python3
"""Check the assembled one-page site, then prove the same checks reject bad pages."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGE = ROOT / "out" / "index.html"

INSTALL = "cargo install --path compute/officejs --locked"
OFFICE = "Mog implements the Office.js API."
GITHUB = "https://github.com/fundamental-research-labs/mog"
NPM = "npm install -g @mog-sdk/cli@1"
STANDALONE = "SHA256SUMS"
PENDING = "Once 1.0 is published"
FORBIDDEN = ("partial", "incomplete", "subset")


def problems(html: str) -> list[str]:
    found = []
    if INSTALL not in html:
        found.append("missing install command")
    if OFFICE not in html:
        found.append("missing Office.js statement")
    if GITHUB not in html:
        found.append("missing GitHub link")
    if NPM not in html:
        found.append("missing npm install option")
    if STANDALONE not in html:
        found.append("missing standalone binary option")
    if PENDING not in html:
        found.append("missing pending-release caveat")
    lowered = html.lower()
    for word in FORBIDDEN:
        if re.search(rf"\b{word}\b", lowered):
            found.append(f"forbidden wording: {word}")
    styles = [url for kind, url in asset_refs(html) if kind == "stylesheet"]
    icons = [url for kind, url in asset_refs(html) if kind == "icon"]
    if not styles:
        found.append("missing stylesheet reference")
    if not icons:
        found.append("missing icon reference")
    for url in styles + icons:
        if not is_relative(url):
            found.append(f"asset URL is not relative: {url}")
    return found


def is_relative(url: str) -> bool:
    return not url.startswith("/") and "://" not in url


def asset_refs(html: str) -> list[tuple[str, str]]:
    refs = []
    for tag in re.findall(r"<(?:link|img)\b[^>]*>", html, flags=re.I):
        rel = (attr(tag, "rel") or "").lower()
        href = attr(tag, "href")
        src = attr(tag, "src")
        if "stylesheet" in rel and href:
            refs.append(("stylesheet", href))
        elif "icon" in rel and href:
            refs.append(("icon", href))
        elif src and Path(src).name == "favicon.svg":
            refs.append(("icon", src))
    return refs


def attr(tag: str, name: str) -> str | None:
    match = re.search(rf'\b{name}\s*=\s*"([^"]*)"', tag, flags=re.I)
    return match.group(1) if match else None


def base_page() -> str:
    return f"""<!doctype html>
<html><head>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="style.css">
</head><body>
<img src="favicon.svg" alt="">
<p>{OFFICE}</p>
<pre><code>{INSTALL}</code></pre>
<p>{PENDING}</p>
<pre><code>{NPM}</code></pre>
<p>Verify the standalone binary against {STANDALONE}.</p>
<a href="{GITHUB}">source</a>
</body></html>
"""


def expect(html: str, expected: list[str], label: str) -> None:
    found = problems(html)
    if found != expected:
        raise SystemExit(f"guard failed for {label}: expected {expected}, found {found}")
    print(f"guard: rejected {label}")


def prove_guards() -> None:
    good = base_page()
    if problems(good):
        raise SystemExit(f"guard fixture should pass: {problems(good)}")
    expect(good.replace(INSTALL, "cargo install mog"), ["missing install command"], "a page missing the install command")
    expect(good.replace(OFFICE, "Mog runs scripts."), ["missing Office.js statement"], "a page missing the Office.js statement")
    expect(good.replace(GITHUB, "https://example.com/mog"), ["missing GitHub link"], "a page missing the GitHub link")
    for word in FORBIDDEN:
        expect(
            good.replace(OFFICE, f"The API is {word}. {OFFICE}"),
            [f"forbidden wording: {word}"],
            f"wording {word!r}",
        )
    expect(
        good.replace('href="style.css"', 'href="/style.css"'),
        ["asset URL is not relative: /style.css"],
        "root-absolute /style.css",
    )
    expect(
        good.replace('href="favicon.svg"', 'href="/favicon.svg"'),
        ["asset URL is not relative: /favicon.svg"],
        "root-absolute /favicon.svg",
    )


def main() -> int:
    if not PAGE.is_file():
        print(f"website check failed: {PAGE} is missing; run website/assemble.sh", file=sys.stderr)
        return 1
    html = PAGE.read_text(encoding="utf-8")
    found = problems(html)
    if found:
        for item in found:
            print(f"website check failed: {item}", file=sys.stderr)
        return 1
    print(f"page: {PAGE}")
    print(f"ok: built page includes install command: {INSTALL}")
    print(f"ok: built page includes Office.js statement: {OFFICE}")
    print(f"ok: built page includes GitHub link: {GITHUB}")
    for kind, url in asset_refs(html):
        print(f"ok: built {kind} reference is relative: {url}")
    prove_guards()
    print("website check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
