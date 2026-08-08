"""
sourcefix.app.data.db
=====================

SQLite database access layer for SourceFix suppliers.
Provides a persistent SQLite database (suppliers.db) with full CRUD operations
and exports supplier records in the exact list-of-dicts shape expected by
the agent core (tools.py, graph.py, main.py).
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH = Path(__file__).resolve().parent / "suppliers.db"


def get_db(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or DB_PATH
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Optional[Path] = None) -> None:
    """Initialize the suppliers table if it does not exist."""
    conn = get_db(db_path)
    try:
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS suppliers (
                    supplier_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    certifications TEXT NOT NULL,
                    moq INTEGER NOT NULL,
                    lead_time_days INTEGER NOT NULL,
                    location_region TEXT NOT NULL,
                    capacity_units_month INTEGER NOT NULL,
                    quality_history_score REAL NOT NULL,
                    sustainability_score REAL NOT NULL,
                    source_row INTEGER
                );
                """
            )
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a database row to a plain supplier dictionary with support
    for both standard schema keys and alias keys.
    """
    raw_certs = json.loads(row["certifications"]) if row["certifications"] else []
    normalized_certs = []
    if isinstance(raw_certs, list):
        for c in raw_certs:
            if isinstance(c, dict):
                c_norm = dict(c)
                name = c.get("name") or c.get("type") or "ISO9001"
                expires = c.get("expires") or c.get("expiry_date") or "2027-12-31"
                c_norm["name"] = name
                c_norm["type"] = name
                c_norm["expires"] = expires
                c_norm["expiry_date"] = expires
                normalized_certs.append(c_norm)
            else:
                normalized_certs.append(c)
    else:
        normalized_certs = raw_certs

    # Extract primary certification for tools.py compatibility
    cert_obj = None
    if isinstance(normalized_certs, list) and len(normalized_certs) > 0:
        first = normalized_certs[0]
        if isinstance(first, dict):
            cert_obj = {
                "type": first["type"],
                "status": first.get("status", "valid"),
                "expiry_date": first["expiry_date"],
            }
            if "issued_date" in first:
                cert_obj["issued_date"] = first["issued_date"]
    elif isinstance(normalized_certs, dict):
        cert_obj = normalized_certs

    return {
        "supplier_id": row["supplier_id"],
        "source_id": row["supplier_id"],
        "name": row["name"],
        "supplier_name": row["name"],
        "certifications": normalized_certs,
        "certification": cert_obj,
        "moq": row["moq"],
        "moq_units": row["moq"],
        "lead_time_days": row["lead_time_days"],
        "location_region": row["location_region"],
        "region": row["location_region"],
        "capacity_units_month": row["capacity_units_month"],
        "monthly_capacity_units": row["capacity_units_month"],
        "quality_history_score": row["quality_history_score"],
        "sustainability_score": row["sustainability_score"],
        "source_row": row["source_row"],
    }


def load_suppliers_as_dicts(db_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Fetch all suppliers from SQLite as a list of dictionaries."""
    init_db(db_path)
    conn = get_db(db_path)
    try:
        rows = conn.execute(
            "SELECT supplier_id, name, certifications, moq, lead_time_days, location_region, capacity_units_month, quality_history_score, sustainability_score, source_row FROM suppliers ORDER BY source_row ASC, supplier_id ASC"
        ).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_supplier_by_id(supplier_id: str, db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    init_db(db_path)
    conn = get_db(db_path)
    try:
        row = conn.execute(
            "SELECT supplier_id, name, certifications, moq, lead_time_days, location_region, capacity_units_month, quality_history_score, sustainability_score, source_row FROM suppliers WHERE supplier_id = ?",
            (supplier_id,)
        ).fetchone()
        return row_to_dict(row) if row else None
    finally:
        conn.close()


def create_supplier_record(data: Dict[str, Any], db_path: Optional[Path] = None) -> Dict[str, Any]:
    init_db(db_path)
    conn = get_db(db_path)

    supplier_id = data.get("supplier_id") or data.get("source_id")
    if not supplier_id:
        raise ValueError("supplier_id is required")

    if get_supplier_by_id(supplier_id, db_path=db_path):
        raise KeyError(f"Supplier with ID '{supplier_id}' already exists.")

    name = data.get("name") or data.get("supplier_name")
    if not name:
        raise ValueError("name is required")

    moq = data.get("moq") if data.get("moq") is not None else data.get("moq_units")
    if moq is None:
        raise ValueError("moq is required")

    lead_time_days = data.get("lead_time_days")
    if lead_time_days is None:
        raise ValueError("lead_time_days is required")

    location_region = data.get("location_region") or data.get("region")
    if not location_region:
        raise ValueError("location_region is required")

    capacity_units_month = data.get("capacity_units_month") if data.get("capacity_units_month") is not None else data.get("monthly_capacity_units")
    if capacity_units_month is None:
        raise ValueError("capacity_units_month is required")

    quality_history_score = data.get("quality_history_score")
    if quality_history_score is None:
        raise ValueError("quality_history_score is required")

    sustainability_score = data.get("sustainability_score")
    if sustainability_score is None:
        raise ValueError("sustainability_score is required")

    certs = data.get("certifications")
    if certs is None and "certification" in data:
        c = data["certification"]
        certs = [c] if isinstance(c, dict) else c
    if certs is None:
        certs = []

    certs_json = json.dumps(certs)
    source_row = data.get("source_row")

    try:
        with conn:
            conn.execute(
                """
                INSERT INTO suppliers (
                    supplier_id, name, certifications, moq, lead_time_days,
                    location_region, capacity_units_month, quality_history_score,
                    sustainability_score, source_row
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    supplier_id, name, certs_json, int(moq), int(lead_time_days),
                    str(location_region), int(capacity_units_month), float(quality_history_score),
                    float(sustainability_score), source_row
                )
            )
    finally:
        conn.close()

    res = get_supplier_by_id(supplier_id, db_path=db_path)
    assert res is not None
    return res


def update_supplier_record(supplier_id: str, data: Dict[str, Any], db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    existing = get_supplier_by_id(supplier_id, db_path=db_path)
    if not existing:
        return None

    init_db(db_path)
    conn = get_db(db_path)

    name = data.get("name", data.get("supplier_name", existing["name"]))
    moq = data.get("moq", data.get("moq_units", existing["moq"]))
    lead_time_days = data.get("lead_time_days", existing["lead_time_days"])
    location_region = data.get("location_region", data.get("region", existing["location_region"]))
    capacity_units_month = data.get("capacity_units_month", data.get("monthly_capacity_units", existing["capacity_units_month"]))
    quality_history_score = data.get("quality_history_score", existing["quality_history_score"])
    sustainability_score = data.get("sustainability_score", existing["sustainability_score"])
    source_row = data.get("source_row", existing["source_row"])

    certs = data.get("certifications")
    if certs is None and "certification" in data:
        c = data["certification"]
        certs = [c] if isinstance(c, dict) else c
    if certs is None:
        certs = existing["certifications"]

    certs_json = json.dumps(certs)

    try:
        with conn:
            conn.execute(
                """
                UPDATE suppliers SET
                    name = ?, certifications = ?, moq = ?, lead_time_days = ?,
                    location_region = ?, capacity_units_month = ?,
                    quality_history_score = ?, sustainability_score = ?,
                    source_row = ?
                WHERE supplier_id = ?
                """,
                (
                    name, certs_json, int(moq), int(lead_time_days),
                    str(location_region), int(capacity_units_month),
                    float(quality_history_score), float(sustainability_score),
                    source_row, supplier_id
                )
            )
    finally:
        conn.close()

    return get_supplier_by_id(supplier_id, db_path=db_path)


def delete_supplier_record(supplier_id: str, db_path: Optional[Path] = None) -> bool:
    init_db(db_path)
    conn = get_db(db_path)
    try:
        with conn:
            cursor = conn.execute("DELETE FROM suppliers WHERE supplier_id = ?", (supplier_id,))
            return cursor.rowcount > 0
    finally:
        conn.close()
