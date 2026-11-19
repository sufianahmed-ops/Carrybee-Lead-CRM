#!/usr/bin/env python3
"""Combine the seven exported CRM CSV tabs into the shared importer's JSON format."""
import csv
import json
import sys
from pathlib import Path

REQUIRED = ["Settings", "Status_Rules", "Call_Script", "Team", "Lists", "Leads", "Call_Log"]
OPTIONAL = ["Legacy_Import", "Legacy_Status_Map"]

def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python3 scripts/extract-csvs.py <csv-directory> <output.json>")
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    result = {}
    missing = []
    for tab in REQUIRED + OPTIONAL:
        path = source / f"{tab}.csv"
        if not path.exists():
            if tab in REQUIRED:
                missing.append(f"{tab}.csv")
            continue
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            headers = reader.fieldnames or []
            if len(headers) != len(set(headers)):
                raise ValueError(f"{path.name}: duplicate column headers")
            rows = []
            for source_row in reader:
                row = {str(key).strip(): (value or "").strip() for key, value in source_row.items() if key is not None}
                if any(row.values()):
                    rows.append(row)
            result[tab] = rows
        print(f"{tab}: {len(rows)} data rows")
    if missing:
        raise SystemExit("Missing required CSV files: " + ", ".join(missing))
    output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"Combined workbook data written to {output}")

if __name__ == "__main__":
    main()
