"""
sourcefix.app.data.migrate
==========================

One-time migration script that reads suppliers.json and inserts every row
into suppliers.db (SQLite database).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Ensure backend root is in sys.path when executed directly
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.data.db import create_supplier_record, get_supplier_by_id, init_db  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent


def run_migration(json_path: Path = DATA_DIR / "suppliers.json", db_path: Path = DATA_DIR / "suppliers.db") -> int:
    init_db(db_path)
    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    suppliers = data.get("suppliers", [])
    count = 0
    for idx, s in enumerate(suppliers, 1):
        supplier_id = s.get("source_id") or s.get("supplier_id")
        if not supplier_id:
            continue
        if get_supplier_by_id(supplier_id, db_path=db_path):
            continue

        name = s.get("supplier_name") or s.get("name", f"Supplier {supplier_id}")
        moq = s.get("moq_units") if s.get("moq_units") is not None else s.get("moq", 5000)
        lead_time_days = s.get("lead_time_days", 45)
        location_region = s.get("region") or s.get("location_region", "North America")
        capacity_units_month = (
            s.get("monthly_capacity_units")
            if s.get("monthly_capacity_units") is not None
            else s.get("capacity_units_month", 20000)
        )
        quality_history_score = s.get("quality_history_score", 85)
        sustainability_score = s.get("sustainability_score", 60)
        source_row = s.get("source_row", idx)

        certs = s.get("certifications")
        if certs is None and "certification" in s:
            c = s["certification"]
            certs = [c] if isinstance(c, dict) else c
        if certs is None:
            certs = []

        supplier_data = {
            "supplier_id": supplier_id,
            "name": name,
            "certifications": certs,
            "moq": moq,
            "lead_time_days": lead_time_days,
            "location_region": location_region,
            "capacity_units_month": capacity_units_month,
            "quality_history_score": quality_history_score,
            "sustainability_score": sustainability_score,
            "source_row": source_row,
        }
        create_supplier_record(supplier_data, db_path=db_path)
        count += 1

    return count


if __name__ == "__main__":
    inserted = run_migration()
    print(f"Migration complete: inserted {inserted} suppliers into suppliers.db")
