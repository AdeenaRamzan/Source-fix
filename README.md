# SourceFix — AI Manufacturing Decision Copilot

*Track 1 Hackathon Submission: AI Manufacturing Decision Copilot*

SourceFix is a supplier evaluation and shortlisting copilot designed for manufacturing procurement leads. Given a written requirements brief (`product_brief.json`) and supplier profile data (`suppliers.json`), SourceFix determines if any suppliers qualify under strict baseline requirements. If nobody qualifies, it iteratively identifies soft requirements to relax, validates all trade-offs in code, and produces a defensible, ranked shortlist with full citation traceability.

---

## 🏗️ Architecture Overview

SourceFix is built with a strict separation between deterministic code guardrails and LLM reasoning:

- **Deterministic Core (`backend/app/agent/tools.py`)**: `eligibility_filter`, `check_constraint`, `cite_lookup`, and `sensitivity_report`. Ground-truth engine; zero LLM dependency.
- **LangGraph Agent Loop (`backend/app/agent/graph.py` & `nodes.py`)**:
  - `run_filter_node`: Evaluates current working constraints deterministically.
  - `decide_next`: Deterministic router (`finalize`, `propose_relaxation`, `give_up`).
  - `propose_relaxation_node`: Queries **Groq (`llama-3.3-70b-versatile`)** to propose loosening a single soft constraint.
  - `apply_relaxation_node`: **Critical Code Gate.** Re-derives constraint type from code ground truth (`working_constraints`), rejecting non-soft field proposals regardless of LLM instructions.
  - `rank_and_finalize_node`: Queries **Groq (`llama-3.3-70b-versatile`)** to rank eligible suppliers with exact citation grounding.
- **FastAPI Service (`backend/app/main.py`)**: Exposes `/api/baseline`, `/api/analyze`, and `/api/analyze/stream` (Server-Sent Events).
- **Next.js + Tailwind Frontend (`frontend/`)**: Modern 5-step decision workspace (Requirements → Baseline → Agent Run → Shortlist → Ledger) with live SSE trace streaming, sensitivity analysis, and stamped relaxation ledger.

---

## 📋 Prerequisites

- **Python**: 3.10+ (tested on Python 3.11)
- **Node.js**: 18+ (tested on Node 20 / 22)
- **Groq API Key**: A valid `GROQ_API_KEY` from [console.groq.com](https://console.groq.com/keys).

---

## 🚀 Quickstart Guide

> 💡 **Windows Users Note:**
> - In `cmd.exe`, use `copy .env.example .env` instead of `cp`.
> - If PowerShell blocks script execution (`Activate.ps1`), run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process` or bypass activation by invoking `.venv\Scripts\python.exe` directly (e.g. `.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`).

### 1. Clone the Repository
```bash
git clone <repo-url>
cd sourcefix
```

### 2. Backend Setup & Startup

From the project root (`sourcefix/`):

```bash
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python -m venv .venv
# On Windows PowerShell:
.venv\Scripts\Activate.ps1
# On Linux/macOS:
# source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# (or 'copy .env.example .env' in Windows cmd.exe)
```

Edit `backend/.env` and add your Groq API key:
```env
GROQ_API_KEY=gsk_your_groq_api_key_here
```

Start the FastAPI backend server on port 8000:
```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Backend health check: `http://localhost:8000/api/health`

### 3. Frontend Setup & Startup

Open a new terminal window and navigate to `frontend/` from the project root:

```bash
# From project root:
cd frontend
# (or 'cd ../frontend' if currently inside backend/)

# Install dependencies
npm install

# Start Next.js dev server
npm run dev
```

Open your browser and navigate to: **`http://localhost:3000`**

---

## 🧪 Running Tests & Verification Scripts

### Run Full Pytest Suite (21 Tests)
From the `backend/` directory:
```bash
cd backend
python -m pytest tests/ -v
```

### Re-generate Demo Cases & Verify Citations
From the project root (`sourcefix/`):
```bash
# From project root:
python demo_cases/generate_demo_cases.py
python demo_cases/verify_citations.py

# (If inside backend/, use: python ../demo_cases/generate_demo_cases.py)
```

---

## 📁 Repository Structure

```
sourcefix/
├── README.md               # Quickstart and project setup instructions
├── SUBMISSION.md           # Submission documentation & evaluation metrics
├── backend/
│   ├── app/
│   │   ├── agent/          # LangGraph nodes, state, graph, and tools
│   │   ├── data/           # Synthetic suppliers.json & product_brief.json
│   │   └── main.py         # FastAPI endpoints (/api/baseline, /api/analyze, /api/analyze/stream)
│   ├── tests/              # Pytest suite (test_tools.py, test_agent.py)
│   ├── .env.example
│   └── requirements.txt
├── demo_cases/             # Generated demo cases & citation audit scripts
└── frontend/               # Next.js 15 + Tailwind CSS interactive web workspace
    ├── app/                # App Router pages and API route proxies
    ├── lib/                # Types and client helper utilities
    └── package.json
```

---

## 📄 Documentation & Links

- **`SUBMISSION.md`**: In-depth submission overview, intended user, assumptions, limitations, and evaluation metrics.
- **`backend/app/data/source_manifest.md`**: Synthetic data disclosure.
- **`demo_cases/EXPLANATION.md`**: Methodological details on demo case generation.
