#!/usr/bin/env python3
"""Extract a cached-value Excel workbook into the JSON shape used by the CRM importer."""
import json
import sys
from datetime import date, datetime, time
from pathlib import Path
from openpyxl import load_workbook


def scalar(value):
    if value is None:
        return ''
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.strftime('%H:%M:%S')
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else 'carrybee-source.xlsx')
    output = Path(sys.argv[2] if len(sys.argv) > 2 else 'import-data.json')
    if not source.is_file():
        raise SystemExit(f'Workbook not found: {source}')
    # Excel/Sheets stores calculated results in the file. openpyxl reads those cached
    # values but does not recalculate formulas, so export/save the workbook first.
    workbook = load_workbook(source, read_only=True, data_only=True)
    result = {}
    for sheet in workbook.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            result[sheet.title] = []
            continue
        headers = [scalar(value) for value in rows[0]]
        records = []
        for values in rows[1:]:
            record = {header: scalar(values[index] if index < len(values) else '')
                      for index, header in enumerate(headers) if header}
            if any(str(value).strip() for value in record.values()):
                records.append(record)
        result[sheet.title] = records
        print(f'{sheet.title}: {len(records)} data rows')
    output.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    output.chmod(0o600)
    print(f'Extracted workbook to {output}. Formula results are read from the last saved cached values.')


if __name__ == '__main__':
    main()
