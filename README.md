# CIS Benchmark Viewer

A responsive local web interface for searching, filtering, and reviewing parsed
CIS Benchmark recommendations.

## Features

- Full-text control search
- Level and assessment filters
- Benchmark and control statistics
- Grid and list views
- Filtered JSON export

## Generate local data

Python 3.9 or later is recommended.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
CIS_BENCHMARK_ROOT=/path/to/benchmark-library python parser.py
```

The parser reads PDFs from the `desktop software/` folder beneath
`CIS_BENCHMARK_ROOT` and writes `data/benchmarks.json`. The generated dataset and
source PDFs are intentionally excluded from Git.

To write the generated data elsewhere, set `CIS_VIEWER_DATA` to the target
directory.

## Run the viewer

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Generate the local dataset first.

## Repository policy

This repository contains source code and documentation only. Downloaded CIS
documents, parsed datasets, caches, logs, and build outputs are excluded.

No open-source license has been selected. Keep the repository private unless the
owner deliberately chooses a license and reviews the data rights.
