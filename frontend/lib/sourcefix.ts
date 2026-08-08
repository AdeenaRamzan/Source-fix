export type Requirement = {
  field: string;
  label: string;
  operator?: string;
  value?: number;
  acceptable_values?: string[];
  constraint_type: "hard" | "soft";
  requirement: string;
};

export type BaselineCheck = {
  passed: boolean;
  reason: string;
  constraint_type: "hard" | "soft";
};

export type SensitivityItem = {
  field: string;
  current_value: number | string | string[];
  hypothetical_value: number | string | string[];
  newly_eligible_count: number;
  newly_eligible: string[];
};

export type BaselineResponse = {
  eligible: string[];
  results: Record<string, Record<string, BaselineCheck>>;
  sensitivity?: Record<string, SensitivityItem>;
};

export type ShortlistItem = {
  supplier_id: string;
  explanation: string;
};

export type Relaxation = {
  iteration: number;
  field: string;
  old_value: number | string;
  new_value: number | string;
  rationale: string;
  accepted: boolean;
};

export type AnalyzeResponse = {
  relaxation_ledger: Relaxation[];
  visited_relaxations?: { field: string; new_value: number | string }[];
  iteration: number;
  max_iterations: number;
  status: string;
  final_shortlist: ShortlistItem[];
  message: string;
  pending_relaxation?: unknown;
  reference_date?: string;
};

export const product = {
  id: "PRD-IOT-ENC-01",
  name: "Injection-Molded Enclosure for Industrial IoT Gateway",
};

export const requirements: Requirement[] = [
  {
    field: "certification",
    label: "Quality management certification",
    acceptable_values: ["ISO9001", "IATF16949"],
    constraint_type: "hard",
    requirement: "Currently valid ISO9001 or IATF16949 certificate.",
  },
  {
    field: "monthly_capacity_units",
    label: "Monthly production capacity",
    operator: ">=",
    value: 20000,
    constraint_type: "hard",
    requirement: "At least 20,000 units per month.",
  },
  {
    field: "quality_history_score",
    label: "Quality history score",
    operator: ">=",
    value: 85,
    constraint_type: "hard",
    requirement: "A quality history score of at least 85.",
  },
  {
    field: "moq_units",
    label: "Minimum order quantity",
    operator: "<=",
    value: 5000,
    constraint_type: "soft",
    requirement: "No more than 5,000 units.",
  },
  {
    field: "lead_time_days",
    label: "Lead time",
    operator: "<=",
    value: 45,
    constraint_type: "soft",
    requirement: "No more than 45 days.",
  },
  {
    field: "region",
    label: "Manufacturing region",
    constraint_type: "soft",
    acceptable_values: ["North America", "Western Europe", "Southeast Asia"],
    requirement: "North America, Western Europe, or Southeast Asia.",
  },
  {
    field: "sustainability_score",
    label: "Sustainability score",
    operator: ">=",
    value: 60,
    constraint_type: "soft",
    requirement: "A sustainability score of at least 60.",
  },
];

export const demoBaseline: BaselineResponse = {
  eligible: [],
  results: {
    "SUP-001": {
      certification: {
        passed: true,
        reason: "ISO9001 is valid through 2027-03-01.",
        constraint_type: "hard",
      },
      monthly_capacity_units: {
        passed: true,
        reason: "25,000 units satisfies the 20,000 minimum.",
        constraint_type: "hard",
      },
      quality_history_score: {
        passed: true,
        reason: "Quality score 90 satisfies the 85 minimum.",
        constraint_type: "hard",
      },
      moq_units: {
        passed: true,
        reason: "MOQ 3,000 is within the 5,000 maximum.",
        constraint_type: "soft",
      },
      lead_time_days: {
        passed: true,
        reason: "40 days is within the 45-day maximum.",
        constraint_type: "soft",
      },
      region: {
        passed: true,
        reason: "North America is an accepted region.",
        constraint_type: "soft",
      },
      sustainability_score: {
        passed: false,
        reason: "Sustainability score 55 misses the 60 floor.",
        constraint_type: "soft",
      },
    },
    "SUP-002": {
      certification: {
        passed: true,
        reason: "ISO9001 is valid through 2026-11-01.",
        constraint_type: "hard",
      },
      monthly_capacity_units: {
        passed: true,
        reason: "30,000 units satisfies the 20,000 minimum.",
        constraint_type: "hard",
      },
      quality_history_score: {
        passed: true,
        reason: "Quality score 88 satisfies the 85 minimum.",
        constraint_type: "hard",
      },
      moq_units: {
        passed: false,
        reason: "MOQ 6,000 exceeds the 5,000 maximum.",
        constraint_type: "soft",
      },
      lead_time_days: {
        passed: true,
        reason: "35 days is within the 45-day maximum.",
        constraint_type: "soft",
      },
      region: {
        passed: true,
        reason: "Western Europe is an accepted region.",
        constraint_type: "soft",
      },
      sustainability_score: {
        passed: true,
        reason: "Sustainability score 70 satisfies the 60 floor.",
        constraint_type: "soft",
      },
    },
  },
  sensitivity: {
    sustainability_score: {
      field: "sustainability_score",
      current_value: 60,
      hypothetical_value: 50,
      newly_eligible_count: 2,
      newly_eligible: ["SUP-001", "SUP-013"],
    },
    moq_units: {
      field: "moq_units",
      current_value: 5000,
      hypothetical_value: 7000,
      newly_eligible_count: 1,
      newly_eligible: ["SUP-002"],
    },
  },
};

export const demoAnalyze: AnalyzeResponse = {
  relaxation_ledger: [
    {
      iteration: 1,
      field: "sustainability_score",
      old_value: 60,
      new_value: 50,
      rationale:
        "This is the soft constraint with the closest near misses. Lowering the floor rescues otherwise qualified suppliers without changing a hard requirement.",
      accepted: true,
    },
  ],
  visited_relaxations: [{ field: "sustainability_score", new_value: 50 }],
  iteration: 1,
  max_iterations: 5,
  status: "shortlisted",
  final_shortlist: [
    {
      supplier_id: "SUP-013",
      explanation:
        "Passes every requirement after the sustainability score relaxation. Quality 90, capacity 22,000, MOQ 4,600, lead time 39 days, and sustainability 59.",
    },
    {
      supplier_id: "SUP-001",
      explanation:
        "Also passes every requirement after the relaxation. Quality 90, capacity 25,000, MOQ 3,000, lead time 40 days, and sustainability 55.",
    },
  ],
  message: "Shortlisted 2 suppliers after 1 relaxation attempt.",
  pending_relaxation: null,
  reference_date: "2026-08-08",
};

export const supplierNames: Record<string, string> = {
  "SUP-001": "Zenith Molding Co.",
  "SUP-002": "Nordic Precision Plastics",
  "SUP-003": "Pacific Rim Enclosures",
  "SUP-004": "Andes Manufacturing SA",
  "SUP-005": "Highland Injection Works",
  "SUP-006": "Delta Plastics Group",
  "SUP-007": "Redwood Components",
  "SUP-008": "Meridian Tooling Ltd.",
  "SUP-009": "Apex Polymer Solutions",
  "SUP-010": "Horizon Molded Products",
  "SUP-011": "Summit Enclosure Systems",
  "SUP-012": "Baltic Advanced Plastics",
  "SUP-013": "Cascade Manufacturing Inc.",
  "SUP-014": "Titan Injection Tech",
  "SUP-015": "Orion Industrial Plastics",
};

export function getSupplierName(supplierId: string, baseline?: BaselineResponse | null): string {
  if (baseline?.results?.[supplierId]) {
    const checks = Object.values(baseline.results[supplierId]);
    for (const check of checks) {
      const match = check.reason?.match(/SUP-\d+\s*\(([^)]+)\)/);
      if (match && match[1]) return match[1];
    }
  }
  return supplierNames[supplierId] ?? supplierId;
}