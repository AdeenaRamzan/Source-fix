"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Edit2,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type Supplier = {
  supplier_id: string;
  name: string;
  certifications: { name: string; status: string; expires?: string }[];
  moq: number;
  lead_time_days: number;
  location_region: string;
  capacity_units_month: number;
  quality_history_score: number;
  sustainability_score: number;
  source_row: number | null;
};

type FormData = {
  supplier_id: string;
  name: string;
  cert_name: string;
  cert_status: string;
  cert_expires: string;
  moq: string;
  lead_time_days: string;
  location_region: string;
  capacity_units_month: string;
  quality_history_score: string;
  sustainability_score: string;
  source_row: string;
};

const emptyForm: FormData = {
  supplier_id: "",
  name: "",
  cert_name: "ISO9001",
  cert_status: "valid",
  cert_expires: "",
  moq: "",
  lead_time_days: "",
  location_region: "North America",
  capacity_units_month: "",
  quality_history_score: "",
  sustainability_score: "",
  source_row: "",
};

/* ------------------------------------------------------------------ */
/*  API helpers                                                       */
/* ------------------------------------------------------------------ */

async function fetchSuppliers(): Promise<Supplier[]> {
  const res = await fetch("/api/sourcefix/suppliers", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load suppliers");
  return res.json();
}

async function createSupplier(data: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/sourcefix/suppliers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Create failed");
  }
}

async function updateSupplier(
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`/api/sourcefix/suppliers/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Update failed");
  }
}

async function deleteSupplier(id: string): Promise<void> {
  const res = await fetch(`/api/sourcefix/suppliers/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Delete failed");
  }
}

/* ------------------------------------------------------------------ */
/*  Page component                                                    */
/* ------------------------------------------------------------------ */

export default function AdminPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchSuppliers();
      setSuppliers(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function openAddForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  }

  function openEditForm(s: Supplier) {
    const cert = s.certifications?.[0];
    setForm({
      supplier_id: s.supplier_id,
      name: s.name,
      cert_name: cert?.name || "ISO9001",
      cert_status: cert?.status || "valid",
      cert_expires: cert?.expires || "",
      moq: String(s.moq),
      lead_time_days: String(s.lead_time_days),
      location_region: s.location_region,
      capacity_units_month: String(s.capacity_units_month),
      quality_history_score: String(s.quality_history_score),
      sustainability_score: String(s.sustainability_score),
      source_row: s.source_row != null ? String(s.source_row) : "",
    });
    setEditingId(s.supplier_id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        supplier_id: form.supplier_id,
        name: form.name,
        certifications: [
          {
            name: form.cert_name,
            status: form.cert_status,
            ...(form.cert_expires ? { expires: form.cert_expires } : {}),
          },
        ],
        moq: parseInt(form.moq, 10),
        lead_time_days: parseInt(form.lead_time_days, 10),
        location_region: form.location_region,
        capacity_units_month: parseInt(form.capacity_units_month, 10),
        quality_history_score: parseFloat(form.quality_history_score),
        sustainability_score: parseFloat(form.sustainability_score),
        ...(form.source_row ? { source_row: parseInt(form.source_row, 10) } : {}),
      };

      if (editingId) {
        await updateSupplier(editingId, payload);
        setToast(`Updated ${form.name}`);
      } else {
        await createSupplier(payload);
        setToast(`Added ${form.name}`);
      }
      closeForm();
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    setError(null);
    try {
      await deleteSupplier(id);
      setToast(`Deleted ${id}`);
      setDeletingId(null);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function setField(key: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="app-shell">
      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" style={{ fontSize: 16, fontWeight: 800 }}>
            SF
          </div>
          <div>
            <div className="brand-name">
              SOURCE<span>FIX</span>
            </div>
            <div className="eyebrow" style={{ marginTop: 3 }}>
              Supplier Admin
            </div>
          </div>
        </div>
        <div className="topbar-meta">
          <Link
            href="/"
            className="text-button"
            style={{ textDecoration: "none", gap: 7 }}
          >
            <ArrowLeft size={14} />
            Back to Demo
          </Link>
        </div>
      </header>

      {/* ── Page ── */}
      <div className="page">
        <div className="intro">
          <div>
            <div className="eyebrow">Manage Suppliers</div>
            <h1
              style={{
                fontSize: "clamp(28px, 4vw, 46px)",
                letterSpacing: "-.04em",
              }}
            >
              Supplier database
            </h1>
            <p className="intro-copy" style={{ maxWidth: 460 }}>
              Add, edit, and remove suppliers. Changes take effect immediately in
              the Baseline and Agent Run steps.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div className="count-badge">
              <strong>{suppliers.length}</strong>
              <br />
              <span>suppliers</span>
            </div>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Action bar ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <button className="button primary" onClick={openAddForm}>
            <Plus size={14} />
            Add supplier
          </button>
          <button
            className="reset-button"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? <Loader2 size={12} className="spin" /> : null}
            Refresh
          </button>
        </div>

        {/* ── Supplier Form ── */}
        {showForm && (
          <div
            className="main-card"
            style={{ marginBottom: 20, position: "relative" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 22,
              }}
            >
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  {editingId ? "Edit supplier" : "New supplier"}
                </div>
                <h3
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    letterSpacing: "-.03em",
                  }}
                >
                  {editingId
                    ? `Editing ${editingId}`
                    : "Add a new supplier record"}
                </h3>
              </div>
              <button
                className="reset-button"
                onClick={closeForm}
                style={{ padding: 8 }}
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="admin-form-grid">
                {/* Row 1: ID & Name */}
                <div className="admin-field">
                  <label className="admin-label">Supplier ID *</label>
                  <input
                    className="admin-input"
                    required
                    placeholder="SUP-014"
                    value={form.supplier_id}
                    onChange={(e) => setField("supplier_id", e.target.value)}
                    disabled={!!editingId}
                    style={editingId ? { opacity: 0.6 } : undefined}
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Supplier Name *</label>
                  <input
                    className="admin-input"
                    required
                    placeholder="Acme Plastics Ltd."
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                </div>

                {/* Row 2: Region & MOQ */}
                <div className="admin-field">
                  <label className="admin-label">Region *</label>
                  <select
                    className="admin-input"
                    value={form.location_region}
                    onChange={(e) => setField("location_region", e.target.value)}
                  >
                    <option>North America</option>
                    <option>Western Europe</option>
                    <option>Southeast Asia</option>
                    <option>Eastern Europe</option>
                    <option>South America</option>
                    <option>East Asia</option>
                    <option>Middle East</option>
                    <option>Africa</option>
                  </select>
                </div>
                <div className="admin-field">
                  <label className="admin-label">MOQ (units) *</label>
                  <input
                    className="admin-input"
                    type="number"
                    required
                    min={0}
                    placeholder="3000"
                    value={form.moq}
                    onChange={(e) => setField("moq", e.target.value)}
                  />
                </div>

                {/* Row 3: Lead time & Capacity */}
                <div className="admin-field">
                  <label className="admin-label">Lead time (days) *</label>
                  <input
                    className="admin-input"
                    type="number"
                    required
                    min={0}
                    placeholder="40"
                    value={form.lead_time_days}
                    onChange={(e) => setField("lead_time_days", e.target.value)}
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">
                    Capacity (units/month) *
                  </label>
                  <input
                    className="admin-input"
                    type="number"
                    required
                    min={0}
                    placeholder="25000"
                    value={form.capacity_units_month}
                    onChange={(e) =>
                      setField("capacity_units_month", e.target.value)
                    }
                  />
                </div>

                {/* Row 4: Quality & Sustainability */}
                <div className="admin-field">
                  <label className="admin-label">Quality score *</label>
                  <input
                    className="admin-input"
                    type="number"
                    required
                    min={0}
                    max={100}
                    step="0.1"
                    placeholder="90"
                    value={form.quality_history_score}
                    onChange={(e) =>
                      setField("quality_history_score", e.target.value)
                    }
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Sustainability score *</label>
                  <input
                    className="admin-input"
                    type="number"
                    required
                    min={0}
                    max={100}
                    step="0.1"
                    placeholder="65"
                    value={form.sustainability_score}
                    onChange={(e) =>
                      setField("sustainability_score", e.target.value)
                    }
                  />
                </div>

                {/* Row 5: Certification */}
                <div className="admin-field">
                  <label className="admin-label">Cert type</label>
                  <select
                    className="admin-input"
                    value={form.cert_name}
                    onChange={(e) => setField("cert_name", e.target.value)}
                  >
                    <option>ISO9001</option>
                    <option>IATF16949</option>
                    <option>ISO14001</option>
                  </select>
                </div>
                <div className="admin-field">
                  <label className="admin-label">Cert status</label>
                  <select
                    className="admin-input"
                    value={form.cert_status}
                    onChange={(e) => setField("cert_status", e.target.value)}
                  >
                    <option value="valid">Valid</option>
                    <option value="expired">Expired</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>

                {/* Row 6: Cert expiry & Source row */}
                <div className="admin-field">
                  <label className="admin-label">Cert expiry date</label>
                  <input
                    className="admin-input"
                    type="date"
                    value={form.cert_expires}
                    onChange={(e) => setField("cert_expires", e.target.value)}
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Source row</label>
                  <input
                    className="admin-input"
                    type="number"
                    min={1}
                    placeholder="14"
                    value={form.source_row}
                    onChange={(e) => setField("source_row", e.target.value)}
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="action-row" style={{ marginTop: 22 }}>
                <button
                  type="submit"
                  className="button primary"
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  {editingId ? "Save changes" : "Add supplier"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={closeForm}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Supplier Table ── */}
        <div className="main-card" style={{ padding: 0 }}>
          {loading && suppliers.length === 0 ? (
            <div className="empty-state" style={{ border: 0 }}>
              <Loader2 size={28} className="spin" />
              <strong>Loading suppliers…</strong>
            </div>
          ) : suppliers.length === 0 ? (
            <div className="empty-state" style={{ border: 0 }}>
              <strong>No suppliers found</strong>
              <span>Add your first supplier to get started.</span>
              <button className="button primary" onClick={openAddForm}>
                <Plus size={14} />
                Add supplier
              </button>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Region</th>
                    <th>Cert</th>
                    <th className="num">Capacity</th>
                    <th className="num">Quality</th>
                    <th className="num">MOQ</th>
                    <th className="num">Lead</th>
                    <th className="num">Sust.</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const cert = s.certifications?.[0];
                    const certObj = cert as unknown as Record<string, string> | undefined;
                    const certName = cert?.name || certObj?.type || "—";
                    const certExpiry = cert?.expires || certObj?.expiry_date;
                    const certOk =
                      cert?.status === "valid" &&
                      (!certExpiry || new Date(certExpiry) >= new Date("2026-08-08"));
                    return (
                      <tr key={s.supplier_id}>
                        <td className="mono">{s.supplier_id}</td>
                        <td className="name-cell">{s.name}</td>
                        <td>{s.location_region}</td>
                        <td>
                          <span
                            className={`cert-badge ${
                              certOk ? "pass" : "fail"
                            }`}
                          >
                            {certName} ({cert?.status || "—"})
                          </span>
                        </td>
                        <td className="num mono">
                          {s.capacity_units_month?.toLocaleString()}
                        </td>
                        <td className="num mono">{s.quality_history_score}</td>
                        <td className="num mono">
                          {s.moq?.toLocaleString()}
                        </td>
                        <td className="num mono">{s.lead_time_days}d</td>
                        <td className="num mono">{s.sustainability_score}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="icon-btn edit"
                              title="Edit"
                              onClick={() => openEditForm(s)}
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              className="icon-btn delete"
                              title="Delete"
                              onClick={() => setDeletingId(s.supplier_id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="footer">
          <span>SourceFix Admin</span>
          <span>
            {suppliers.length} supplier
            {suppliers.length !== 1 ? "s" : ""} in database
          </span>
        </div>
      </div>

      {/* ── Delete Confirmation Modal ── */}
      {deletingId && (
        <div className="admin-modal-overlay" onClick={() => setDeletingId(null)}>
          <div
            className="admin-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 16,
              }}
            >
              <Trash2 size={18} style={{ color: "var(--danger)" }} />
              <strong style={{ fontSize: 16 }}>Delete supplier?</strong>
            </div>
            <p
              style={{
                color: "var(--muted)",
                fontSize: 13,
                lineHeight: 1.5,
                marginBottom: 20,
              }}
            >
              This will permanently remove{" "}
              <strong style={{ color: "var(--ink)" }}>{deletingId}</strong> from
              the database. The supplier will no longer appear in Baseline or
              Agent Run steps.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="button primary"
                style={{ background: "var(--danger)" }}
                disabled={deleting}
                onClick={() => handleDelete(deletingId)}
              >
                {deleting ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete
              </button>
              <button
                className="button secondary"
                onClick={() => setDeletingId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="toast">
          <Check size={14} style={{ color: "var(--blue)" }} />
          {toast}
          <button onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
