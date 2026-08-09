import { Supplier, normalizeSupplier } from "./backend-core";

const defaultSuppliers: Supplier[] = [
  {
    supplier_id: "SUP-001",
    source_id: "SUP-001",
    name: "Zenith Molding Co.",
    supplier_name: "Zenith Molding Co.",
    location_region: "North America",
    region: "North America",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2027-03-01" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2027-03-01" }],
    moq: 3000,
    lead_time_days: 40,
    capacity_units_month: 25000,
    quality_history_score: 90,
    sustainability_score: 55,
    source_row: 1,
  },
  {
    supplier_id: "SUP-002",
    source_id: "SUP-002",
    name: "Nordic Precision Plastics",
    supplier_name: "Nordic Precision Plastics",
    location_region: "Western Europe",
    region: "Western Europe",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2026-11-01" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2026-11-01" }],
    moq: 6000,
    lead_time_days: 35,
    capacity_units_month: 30000,
    quality_history_score: 88,
    sustainability_score: 70,
    source_row: 2,
  },
  {
    supplier_id: "SUP-003",
    source_id: "SUP-003",
    name: "Pacific Rim Enclosures",
    supplier_name: "Pacific Rim Enclosures",
    location_region: "Southeast Asia",
    region: "Southeast Asia",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2027-09-15" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2027-09-15" }],
    moq: 4500,
    lead_time_days: 55,
    capacity_units_month: 22000,
    quality_history_score: 86,
    sustainability_score: 65,
    source_row: 3,
  },
  {
    supplier_id: "SUP-004",
    source_id: "SUP-004",
    name: "Andes Manufacturing SA",
    supplier_name: "Andes Manufacturing SA",
    location_region: "South America",
    region: "South America",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2028-01-20" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2028-01-20" }],
    moq: 4000,
    lead_time_days: 30,
    capacity_units_month: 28000,
    quality_history_score: 92,
    sustainability_score: 75,
    source_row: 4,
  },
  {
    supplier_id: "SUP-005",
    source_id: "SUP-005",
    name: "Highland Injection Works",
    supplier_name: "Highland Injection Works",
    location_region: "North America",
    region: "North America",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2027-05-01" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2027-05-01" }],
    moq: 4800,
    lead_time_days: 42,
    capacity_units_month: 18000,
    quality_history_score: 89,
    sustainability_score: 68,
    source_row: 5,
  },
  {
    supplier_id: "SUP-006",
    source_id: "SUP-006",
    name: "Delta Plastics Group",
    supplier_name: "Delta Plastics Group",
    location_region: "Western Europe",
    region: "Western Europe",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2028-03-11" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2028-03-11" }],
    moq: 3500,
    lead_time_days: 38,
    capacity_units_month: 24000,
    quality_history_score: 80,
    sustainability_score: 72,
    source_row: 6,
  },
  {
    supplier_id: "SUP-007",
    source_id: "SUP-007",
    name: "Redwood Components",
    supplier_name: "Redwood Components",
    location_region: "North America",
    region: "North America",
    certification: { type: "ISO9001", status: "expired", expiry_date: "2024-05-01" },
    certifications: [{ name: "ISO9001", status: "expired", expires: "2024-05-01" }],
    moq: 4000,
    lead_time_days: 40,
    capacity_units_month: 26000,
    quality_history_score: 91,
    sustainability_score: 80,
    source_row: 7,
  },
  {
    supplier_id: "SUP-008",
    source_id: "SUP-008",
    name: "Meridian Tooling Ltd.",
    supplier_name: "Meridian Tooling Ltd.",
    location_region: "Southeast Asia",
    region: "Southeast Asia",
    certification: { type: "IATF16949", status: "expired", expiry_date: "2027-01-01" },
    certifications: [{ name: "IATF16949", status: "expired", expires: "2027-01-01" }],
    moq: 4200,
    lead_time_days: 44,
    capacity_units_month: 21000,
    quality_history_score: 87,
    sustainability_score: 62,
    source_row: 8,
  },
  {
    supplier_id: "SUP-009",
    source_id: "SUP-009",
    name: "Coastal Precision Manufacturing",
    supplier_name: "Coastal Precision Manufacturing",
    location_region: "Southeast Asia",
    region: "Southeast Asia",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2027-07-01" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2027-07-01" }],
    moq: 3800,
    lead_time_days: 41,
    capacity_units_month: 23000,
    quality_history_score: 88,
    sustainability_score: 60,
    source_row: 9,
  },
  {
    supplier_id: "SUP-010",
    source_id: "SUP-010",
    name: "Iron Gate Fabrication",
    supplier_name: "Iron Gate Fabrication",
    location_region: "Eastern Europe",
    region: "Eastern Europe",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2028-08-01" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2028-08-01" }],
    moq: 7000,
    lead_time_days: 50,
    capacity_units_month: 19000,
    quality_history_score: 78,
    sustainability_score: 40,
    source_row: 10,
  },
  {
    supplier_id: "SUP-011",
    source_id: "SUP-011",
    name: "Summit Enclosure Systems",
    supplier_name: "Summit Enclosure Systems",
    location_region: "North America",
    region: "North America",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2026-10-01" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2026-10-01" }],
    moq: 5200,
    lead_time_days: 46,
    capacity_units_month: 20500,
    quality_history_score: 84,
    sustainability_score: 58,
    source_row: 11,
  },
  {
    supplier_id: "SUP-012",
    source_id: "SUP-012",
    name: "Baltic Advanced Plastics",
    supplier_name: "Baltic Advanced Plastics",
    location_region: "Western Europe",
    region: "Western Europe",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2027-11-01" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2027-11-01" }],
    moq: 4900,
    lead_time_days: 44,
    capacity_units_month: 20500,
    quality_history_score: 83,
    sustainability_score: 63,
    source_row: 12,
  },
  {
    supplier_id: "SUP-013",
    source_id: "SUP-013",
    name: "Cascade Manufacturing Inc.",
    supplier_name: "Cascade Manufacturing Inc.",
    location_region: "North America",
    region: "North America",
    certification: { type: "ISO9001", status: "valid", expiry_date: "2027-01-15" },
    certifications: [{ name: "ISO9001", status: "valid", expires: "2027-01-15" }],
    moq: 4600,
    lead_time_days: 39,
    capacity_units_month: 22000,
    quality_history_score: 90,
    sustainability_score: 59,
    source_row: 13,
  },
];

let memoryStore: Supplier[] = defaultSuppliers.map(normalizeSupplier);

export function getStoreSuppliers(): Supplier[] {
  return memoryStore.map(normalizeSupplier);
}

export function getStoreSupplierById(id: string): Supplier | undefined {
  const found = memoryStore.find((s) => (s.supplier_id || s.source_id) === id);
  return found ? normalizeSupplier(found) : undefined;
}

export function addStoreSupplier(supplier: Supplier): Supplier {
  const norm = normalizeSupplier(supplier);
  if (memoryStore.some((s) => (s.supplier_id || s.source_id) === norm.supplier_id)) {
    throw new Error(`Supplier with ID '${norm.supplier_id}' already exists.`);
  }
  memoryStore.push(norm);
  return norm;
}

export function updateStoreSupplier(id: string, updates: Partial<Supplier>): Supplier | undefined {
  const idx = memoryStore.findIndex((s) => (s.supplier_id || s.source_id) === id);
  if (idx === -1) return undefined;
  const updated = normalizeSupplier({ ...memoryStore[idx], ...updates });
  memoryStore[idx] = updated;
  return updated;
}

export function deleteStoreSupplier(id: string): boolean {
  const idx = memoryStore.findIndex((s) => (s.supplier_id || s.source_id) === id);
  if (idx === -1) return false;
  memoryStore.splice(idx, 1);
  return true;
}
