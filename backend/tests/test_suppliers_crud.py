"""
Tests for Supplier CRUD API endpoints (SQLite backend).
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_list_suppliers():
    response = client.get("/api/suppliers")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 13
    first = data[0]
    assert "supplier_id" in first
    assert "name" in first


def test_get_supplier_by_id_success():
    response = client.get("/api/suppliers/SUP-001")
    assert response.status_code == 200
    data = response.json()
    assert data["supplier_id"] == "SUP-001"
    assert data["name"] == "Zenith Molding Co."


def test_get_supplier_by_id_not_found():
    response = client.get("/api/suppliers/SUP-NONEXISTENT")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_supplier_crud_lifecycle():
    test_id = "SUP-TEST-999"

    # Cleanup in case left over
    client.delete(f"/api/suppliers/{test_id}")

    # 1. CREATE
    payload = {
        "supplier_id": test_id,
        "name": "Apex Test Dynamics",
        "certifications": [{"name": "ISO9001", "status": "valid", "expires": "2028-12-31"}],
        "moq": 1000,
        "lead_time_days": 20,
        "location_region": "North America",
        "capacity_units_month": 50000,
        "quality_history_score": 98.5,
        "sustainability_score": 90.0,
        "source_row": 999,
    }
    create_res = client.post("/api/suppliers", json=payload)
    assert create_res.status_code == 201
    created_data = create_res.json()
    assert created_data["supplier_id"] == test_id
    assert created_data["name"] == "Apex Test Dynamics"

    # Duplicate POST -> 409
    dup_res = client.post("/api/suppliers", json=payload)
    assert dup_res.status_code == 409

    # Verify baseline filter immediately sees new supplier
    base_res = client.post("/api/baseline", json={})
    assert base_res.status_code == 200
    base_data = base_res.json()
    assert test_id in base_data["results"]

    # 2. UPDATE (PUT)
    update_payload = {"name": "Apex Test Dynamics Corp", "moq": 1500}
    update_res = client.put(f"/api/suppliers/{test_id}", json=update_payload)
    assert update_res.status_code == 200
    updated_data = update_res.json()
    assert updated_data["name"] == "Apex Test Dynamics Corp"
    assert updated_data["moq"] == 1500

    # 3. DELETE
    delete_res = client.delete(f"/api/suppliers/{test_id}")
    assert delete_res.status_code == 200
    assert delete_res.json()["status"] == "deleted"

    # Verify gone
    get_res = client.get(f"/api/suppliers/{test_id}")
    assert get_res.status_code == 404
