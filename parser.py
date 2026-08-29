"""
CIS Benchmark PDF Parser — v3
Root cause analysis:
  Each PDF control's title is split across TWO pages:
    - Last line of page N: "1.1.1 (L1) Ensure 'X' is"
    - First line of page N+1: "set to 'Y' (Automated)"
    - Then: "Profile Applicability:", "Description:", etc.

  Simply joining all page texts works, BUT the page-header stripper
  ("Page 18") must strip INLINE (at the character position it appears)
  so title parts rejoin correctly. The previous version stripped
  "Page 18" which left a blank that broke line-joining.

Fix:
  1. Strip page headers BEFORE joining (per page).
  2. Join pages with a SINGLE space, not a newline, so split titles reconnect.
  3. After joining, split on the pattern: section id + title + (Assessment)
     followed (within 1000 chars) by "Profile Applicability".
  4. Only keep matches that have Profile Applicability nearby → skip TOC entries.
"""

import re
import json
import os
import sys
from pathlib import Path

try:
    import PyPDF2
except ImportError:
    print("PyPDF2 not found. Install with: pip install PyPDF2")
    sys.exit(1)

BASE_DIR = Path(os.environ.get("CIS_BENCHMARK_ROOT", ".")).expanduser().resolve()
OUT_DIR = Path(
    os.environ.get("CIS_VIEWER_DATA", Path(__file__).parent / "data")
).expanduser().resolve()
OUT_DIR.mkdir(exist_ok=True)

# ─────────────────────────────────────────────────────────
# Step 1: Per-page cleaning then join with space
# ─────────────────────────────────────────────────────────

PAGE_HDR_RE = re.compile(r"\bPage\s+\d+\b[^\n]*\n?", re.IGNORECASE)

def clean_page(page_text: str) -> str:
    """Strip page header from a single page's text."""
    t = PAGE_HDR_RE.sub("", page_text)
    # Fix PyPDF2 soft-hyphen artifact: "Cross -origin" → "Cross-origin"
    t = re.sub(r"(\w) -(\w)", r"\1-\2", t)
    return t.strip()


def extract_pdf_text(pdf_path: Path) -> str:
    """
    Extract and join all page texts.
    Join with a SPACE so that titles split across pages reconnect.
    """
    try:
        with open(pdf_path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            parts = []
            for page in reader.pages:
                raw = page.extract_text() or ""
                cleaned = clean_page(raw)
                if cleaned:
                    parts.append(cleaned)
        # Join with a space so page-split content rejoins
        text = " ".join(parts)
        # Now normalize: collapse multiple spaces/tabs
        text = re.sub(r"[ \t]{2,}", " ", text)
        return text
    except Exception as e:
        print(f"  ⚠  {pdf_path.name}: {e}")
        return ""


# ─────────────────────────────────────────────────────────
# Step 2: Split on control headers + verify real body
# ─────────────────────────────────────────────────────────

# Title pattern: id + optional (L1) + title text + (Automated/Manual/Scored)
# After joining pages with spaces, multi-line titles become single lines.
CTRL_RE = re.compile(
    r"(\d+(?:\.\d+){1,})\s+"                               # section id
    r"(?:\([A-Za-z0-9 ]+\)\s+)?"                           # optional (L1)
    r"([A-Z\u2018\u2019\'][^\n]{5,}?)"                     # title
    r"\s*\((Automated|Manual|Scored|Not Scored|Not Applicable)\)",  # assessment
)

# TOC entries have lots of dots immediately after the closing paren
TOC_DOTS_RE = re.compile(r"\)\s*[.]{4,}")


def find_real_control_starts(text: str) -> list[dict]:
    """
    Find all CTRL_RE matches where:
      - 'Profile Applicability' appears within next 500 chars (real body)
      - The match is NOT immediately followed by TOC dots
    """
    real = []
    for m in CTRL_RE.finditer(text):
        window = text[m.start(): m.start() + 500]
        after  = text[m.end(): m.end() + 60]   # check for TOC dots right after
        if "Profile Applicability" in window and not TOC_DOTS_RE.match(after.lstrip()):
            real.append({
                "pos":        m.start(),
                "control_id": m.group(1),
                "title":      re.sub(r"\s+", " ", m.group(2)).strip(),
                "assessment": m.group(3),
            })
    return real


def split_into_blocks(text: str) -> list[dict]:
    """Slice text into per-control blocks using real control start positions."""
    headers = find_real_control_starts(text)
    blocks = []
    for i, h in enumerate(headers):
        start = h["pos"]
        end   = headers[i + 1]["pos"] if i + 1 < len(headers) else len(text)
        blocks.append({**h, "_raw": text[start:end]})
    return blocks


# ─────────────────────────────────────────────────────────
# Step 3: Per-control section extraction
# ─────────────────────────────────────────────────────────

SECTION_ORDER = [
    "Profile Applicability",
    "Description",
    "Rationale",
    "Impact",
    "Audit",
    "Remediation",
    "Default Value",
    "References",
    "CIS Controls",
]


def extract_section(block: str, section: str, next_section: str | None) -> str:
    header_pat = re.escape(section) + r"\s*:[ \t]*"
    if next_section:
        stop_pat = re.escape(next_section) + r"\s*:"
        pat = rf"{header_pat}(.*?)(?={stop_pat})"
    else:
        pat = rf"{header_pat}(.*)"
    m = re.search(pat, block, re.DOTALL | re.IGNORECASE)
    if not m:
        return ""
    val = m.group(1).strip()
    # Normalize spaces but keep newlines (important for audit/remediation steps)
    val = re.sub(r"[ \t]{2,}", " ", val)
    return val


def extract_levels(block: str) -> list[str]:
    hits = re.findall(
        r"Level\s+\d+(?:\s*\([A-Z0-9]+\))?(?:\s*-\s*[\w /]+)?",
        block
    )
    seen, out = set(), []
    for h in hits:
        k = re.sub(r"\s+", " ", h).strip()
        if k not in seen:
            seen.add(k); out.append(k)
    return out


def parse_cis_controls_table(text: str) -> list[dict]:
    """Parse lines like: v8  5.4  Title  ●  ●  ●"""
    rows = []
    row_re = re.compile(r"(v\d+)\s+(\d+\.\d+)\s+(.+?)(?=\s+v\d+|\Z)", re.DOTALL)
    for m in row_re.finditer(text):
        raw = m.group(3)
        bullets = raw.count("●")
        clean = re.sub(r"[●\n]+", " ", raw).strip()
        clean = re.sub(r"\s{2,}", " ", clean)[:150]
        rows.append({
            "version":    m.group(1),
            "control_id": m.group(2),
            "title":      clean,
            "ig1":        bullets >= 1,
            "ig2":        bullets >= 2,
            "ig3":        bullets >= 3,
        })
    return rows[:8]


def parse_control(h: dict) -> dict:
    block = h["_raw"]

    # Find sections that actually exist in this block
    present = [s for s in SECTION_ORDER
               if re.search(re.escape(s) + r"\s*:", block, re.IGNORECASE)]

    sections = {}
    for i, sec in enumerate(present):
        nxt = present[i + 1] if i + 1 < len(present) else None
        sections[sec] = extract_section(block, sec, nxt)

    cis_text = sections.get("CIS Controls", "")
    return {
        "control_id":    h["control_id"],
        "title":         h["title"],
        "assessment":    h["assessment"],
        "levels":        extract_levels(block),
        "description":   sections.get("Description",   "")[:2000],
        "rationale":     sections.get("Rationale",     "")[:2000],
        "impact":        sections.get("Impact",        "")[:1000],
        "audit":         sections.get("Audit",         "")[:3000],
        "remediation":   sections.get("Remediation",   "")[:3000],
        "default_value": sections.get("Default Value", "")[:500],
        "references":    sections.get("References",    "")[:800],
        "cis_controls":  parse_cis_controls_table(cis_text),
    }


# ─────────────────────────────────────────────────────────
# Benchmark pipeline
# ─────────────────────────────────────────────────────────

def parse_benchmark(pdf_path: Path, category: str, technology: str, title: str) -> dict | None:
    print(f"  📄 {pdf_path.name}", end=" ... ", flush=True)

    text = extract_pdf_text(pdf_path)
    if not text:
        print("SKIPPED (empty)")
        return None

    blocks   = split_into_blocks(text)
    controls = [parse_control(b) for b in blocks]
    print(f"{len(controls)} controls ✓")

    return {
        "benchmark": {
            "category":   category,
            "technology": technology,
            "title":      title,
            "pdf_name":   pdf_path.name,
            "pdf_path":   str(pdf_path.relative_to(BASE_DIR)),
        },
        "controls": controls,
    }


# ─────────────────────────────────────────────────────────
# Desktop Software discovery
# ─────────────────────────────────────────────────────────

DESKTOP_DIR = BASE_DIR / "desktop software"

TECH_MAP = {
    "google chrome web browser":               "Google Chrome",
    "mozilla firefox web browser":             "Mozilla Firefox",
    "microsoft web browser web browser":       "Microsoft Edge",
    "microsoft office productivity software":  "Microsoft Office",
    "safari browser web browser":              "Safari Browser",
}


def discover_desktop_pdfs():
    entries = []
    for subdir in sorted(DESKTOP_DIR.iterdir()):
        if not subdir.is_dir():
            continue
        tech = TECH_MAP.get(subdir.name.lower(), subdir.name.title())
        for pdf in sorted(subdir.glob("*.pdf")):
            title = pdf.stem.replace("-", " ").replace("_", " ").title()
            entries.append((pdf, "Desktop Software", tech, title))
    return entries


# ─────────────────────────────────────────────────────────
# Debug helper: show one PDF's parsed output
# ─────────────────────────────────────────────────────────

def debug_single(pdf_path: Path, n_controls: int = 3):
    """Print detailed parse output for the first N controls of one PDF."""
    print(f"\n{'='*70}")
    print(f"DEBUG: {pdf_path.name}")
    print(f"{'='*70}\n")

    text = extract_pdf_text(pdf_path)
    print(f"Total text length: {len(text)} chars\n")

    blocks = split_into_blocks(text)
    print(f"Real controls detected: {len(blocks)}\n")

    for b in blocks[:n_controls]:
        ctrl = parse_control(b)
        print(f"{'─'*60}")
        print(f"Control ID:   {ctrl['control_id']}")
        print(f"Title:        {ctrl['title'][:90]}")
        print(f"Assessment:   {ctrl['assessment']}")
        print(f"Levels:       {ctrl['levels']}")
        print(f"Description:  {ctrl['description'][:200] or '(EMPTY)'}")
        print(f"Rationale:    {ctrl['rationale'][:150] or '(EMPTY)'}")
        print(f"Impact:       {ctrl['impact'][:100] or '(EMPTY)'}")
        print(f"Audit:        {ctrl['audit'][:150] or '(EMPTY)'}")
        print(f"Remediation:  {ctrl['remediation'][:150] or '(EMPTY)'}")
        print(f"References:   {ctrl['references'][:100] or '(EMPTY)'}")
        print(f"CIS Controls: {ctrl['cis_controls']}")
        print()


# ─────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────

def main():
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "debug":
        # Debug mode: show first 3 controls of Chrome benchmark
        debug_single(
            DESKTOP_DIR / "google chrome web browser/cis google chrome benchmark.pdf",
            n_controls=3
        )
        return

    print("\n🔍 CIS Benchmark Parser v3 — Desktop Software\n")
    entries = discover_desktop_pdfs()
    print(f"Found {len(entries)} PDFs\n")

    all_benchmarks = []
    for pdf_path, category, technology, title in entries:
        result = parse_benchmark(pdf_path, category, technology, title)
        if result:
            all_benchmarks.append(result)

    out_file = OUT_DIR / "benchmarks.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(all_benchmarks, f, indent=2, ensure_ascii=False)

    total = sum(len(b["controls"]) for b in all_benchmarks)
    print(f"\n✅ Done! {len(all_benchmarks)} benchmarks, {total} controls")
    print(f"📁 {out_file}")


if __name__ == "__main__":
    main()
