"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  FileCheck2,
  Filter,
  GitBranch,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import {
  AnalyzeResponse,
  BaselineResponse,
  demoAnalyze,
  demoBaseline,
  getSupplierName,
  product,
  requirements,
  type Relaxation,
  type ShortlistItem,
} from "../lib/sourcefix";

type Step = "requirements" | "baseline" | "run" | "shortlist" | "ledger";
type TraceLine = { node: string; message: string; complete?: boolean };

const steps: { id: Step; label: string; hint: string }[] = [
  { id: "requirements", label: "Requirements", hint: "What must be true" },
  { id: "baseline", label: "Baseline", hint: "Check suppliers" },
  { id: "run", label: "Agent run", hint: "Find the best fit" },
  { id: "shortlist", label: "Shortlist", hint: "Review candidates" },
  { id: "ledger", label: "Decision ledger", hint: "See every compromise" },
];

const initialTrace: TraceLine[] = [
  { node: "ready", message: "Ready to scan the supplier index." },
];

function formatValue(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function statusLabel(status: string) {
  return status === "shortlisted" ? "Shortlist ready" : status.replaceAll("_", " ");
}

function RequirementValue({
  requirement,
}: {
  requirement: (typeof requirements)[number];
}) {
  if (requirement.acceptable_values && requirement.acceptable_values.length > 0) {
    return <>{requirement.acceptable_values.join(" · ")}</>;
  }
  if (requirement.value !== undefined) {
    return (
      <>
        {requirement.operator ?? ""} {formatValue(requirement.value)}
      </>
    );
  }
  return <>Valid cert</>;
}

function ConstellationGraphic() {
  return (
    <div className="constellation" aria-label="Supplier constellation graphic">
      <div className="constellation-grid" />
      <svg viewBox="0 0 520 220" role="img" aria-hidden="true">
        <path className="constellation-line" d="M70 158 L190 86 L330 132 L447 54" />
        <path className="constellation-line" d="M190 86 L256 180 L330 132" />
        <path className="constellation-line faint" d="M70 158 L256 180" />
        <circle className="node" cx="70" cy="158" r="8" />
        <circle className="node" cx="190" cy="86" r="9" />
        <circle className="node" cx="330" cy="132" r="11" />
        <circle className="node" cx="447" cy="54" r="8" />
        <circle className="node small" cx="256" cy="180" r="5" />
        <text x="43" y="185">SUP-001</text>
        <text x="168" y="67">SUP-013</text>
        <text x="344" y="153">PRD-IOT</text>
      </svg>
      <div className="machined-part">
        <div className="machined-window" />
        <strong>ENCLOSURE</strong>
        <span>AL6061 / SAMPLE</span>
      </div>
      <span className="graphic-caption">live supplier constellation</span>
    </div>
  );
}

export default function Home() {
  const [activeStep, setActiveStep] = useState<Step>("requirements");
  const [baseline, setBaseline] = useState<BaselineResponse | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [trace, setTrace] = useState<TraceLine[]>(initialTrace);
  const [running, setRunning] = useState(false);
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [usingDemo, setUsingDemo] = useState(false);

  const hardCount = requirements.filter((item) => item.constraint_type === "hard").length;
  const softCount = requirements.length - hardCount;
  const eligibleCount = baseline?.eligible.length ?? 0;
  const shortlist = analysis?.final_shortlist ?? [];
  const ledger = analysis?.relaxation_ledger ?? [];

  const failureCount = useMemo(() => {
    if (!baseline) return 0;
    return Object.values(baseline.results).reduce(
      (total, checks) =>
        total + Object.values(checks).filter((check) => !check.passed).length,
      0,
    );
  }, [baseline]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  async function runBaseline(useDemo = false) {
    setError("");
    setLoadingBaseline(true);
    if (useDemo) {
      setBaseline(demoBaseline);
      setUsingDemo(true);
      setLoadingBaseline(false);
      showNotice("Demo baseline loaded. Connect your API to use live supplier data.");
      setActiveStep("baseline");
      return;
    }
    try {
      const response = await fetch("/api/sourcefix/baseline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(`Baseline returned ${response.status}.`);
      setBaseline((await response.json()) as BaselineResponse);
      setUsingDemo(false);
      setActiveStep("baseline");
      showNotice("Baseline complete. Review the supplier checks.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `${caught.message} Is the SourceFix API running on localhost:8000?`
          : "The baseline could not be loaded.",
      );
    } finally {
      setLoadingBaseline(false);
    }
  }

  function addTrace(node: string, message: string, complete = false) {
    setTrace((current) => [
      ...current.filter((line) => line.node !== "ready"),
      { node, message, complete },
    ]);
  }

  async function runAnalysis(useDemo = false) {
    setError("");
    setRunning(true);
    setAnalysis(null);
    setTrace([]);
    setActiveStep("run");
    if (useDemo) {
      const demoLines: TraceLine[] = [
        { node: "run_filter", message: "86 suppliers scanned · 0 eligible at baseline" },
        { node: "propose_relaxation", message: "Proposed sustainability_score 60 → 50" },
        { node: "apply_relaxation", message: "Accepted one soft-constraint relaxation" },
        { node: "run_filter", message: "SUP-001 and SUP-013 now qualify" },
        { node: "finalize", message: "Shortlist ready · 2 defensible suppliers", complete: true },
      ];
      for (const line of demoLines) {
        await new Promise((resolve) => window.setTimeout(resolve, 260));
        setTrace((current) => [...current, line]);
      }
      setAnalysis(demoAnalyze);
      setUsingDemo(true);
      setRunning(false);
      showNotice("Demo run complete. Every decision is reviewable.");
      return;
    }
    try {
      const response = await fetch("/api/sourcefix/analyze/stream", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: "{}",
      });
      if (!response.ok || !response.body) {
        throw new Error(`Agent run returned ${response.status}.`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let latest: Partial<AnalyzeResponse> = {};
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const dataLine = event.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(5).trim()) as {
            error?: string;
            status?: string;
            node?: string;
            output?: Partial<AnalyzeResponse> & {
              filter_result?: { eligible?: string[] };
              pending_relaxation?: { field: string; new_value: number | string };
            };
          };
          if (payload.error) {
            throw new Error(payload.error);
          }
          if (payload.node && payload.output) {
            const output = payload.output;
            latest = { ...latest, ...output };
            const isTerminal = payload.node === "finalize" || payload.node === "give_up";
            const lineMessage =
              payload.node === "run_filter"
                ? `${output.filter_result?.eligible?.length ?? 0} eligible suppliers after the current constraints`
                : payload.node === "propose_relaxation"
                  ? `Considering relaxing ${output.pending_relaxation?.field?.replaceAll("_", " ") ?? "a soft constraint"}`
                  : payload.node === "apply_relaxation"
                    ? "Applied a reviewable soft-constraint relaxation"
                    : isTerminal
                      ? output.message ?? "Analysis complete"
                      : "SourceFix is working";
            addTrace(payload.node, lineMessage, isTerminal);
          }
          if (payload.status === "complete") {
            const completed = latest as AnalyzeResponse;
            setAnalysis(completed);
          }
        }
        if (done) break;
      }
      setUsingDemo(false);
      showNotice("SourceFix run complete. Review the shortlist and ledger.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `${caught.message} Is the SourceFix API running on localhost:8000?`
          : "The agent run could not be completed.",
      );
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setBaseline(null);
    setAnalysis(null);
    setTrace(initialTrace);
    setActiveStep("requirements");
    setError("");
    setUsingDemo(false);
  }

  const currentIndex = steps.findIndex((step) => step.id === activeStep);
  const goNext = () => {
    if (activeStep === "requirements") {
      void runBaseline();
    } else if (activeStep === "baseline") {
      void runAnalysis();
    } else if (currentIndex < steps.length - 1) {
      setActiveStep(steps[currentIndex + 1].id);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Target size={19} /></div>
          <div>
            <div className="brand-name">SOURCE<span>FIX</span></div>
            <div className="eyebrow">supplier shortlisting</div>
          </div>
        </div>
        <div className="topbar-meta">
          <Link href="/admin" className="text-button" style={{ textDecoration: "none", gap: 7 }}>
            Manage Suppliers
          </Link>
          <span className={`connection ${usingDemo ? "demo" : ""}`}>
            <span className="connection-dot" />
            {usingDemo ? "Demo data" : "Ready for API"}
          </span>
          <span className="workspace-name">IoT enclosures</span>
          <span className="avatar">AK</span>
        </div>
      </header>

      <div className="page">
        <section className="intro">
          <div>
            <p className="eyebrow blue">Decision workspace</p>
            <h1>Find the supplier you can defend.</h1>
            <p className="intro-copy">
              SourceFix checks the hard requirements first, then makes only
              explicit, reviewable trade-offs.
            </p>
          </div>
          <div className="brief-pill">
            <span className="eyebrow">Active brief</span>
            <strong>{product.id}</strong>
            <span>{product.name}</span>
          </div>
        </section>

        <nav className="stepper" aria-label="SourceFix workflow">
          {steps.map((step, index) => {
            const active = activeStep === step.id;
            const completed =
              (step.id === "baseline" && baseline) ||
              (step.id === "run" && analysis) ||
              (step.id === "shortlist" && shortlist.length > 0) ||
              (step.id === "ledger" && ledger.length > 0);
            return (
              <button
                className={`step ${active ? "active" : ""} ${completed ? "completed" : ""}`}
                key={step.id}
                onClick={() => setActiveStep(step.id)}
              >
                <span className="step-number">
                  {completed ? <Check size={14} /> : `0${index + 1}`}
                </span>
                <span className="step-copy">
                  <strong>{step.label}</strong>
                  <small>{step.hint}</small>
                </span>
              </button>
            );
          })}
        </nav>

        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button>
          </div>
        )}

        <div className="workspace-grid">
          <section className="main-card">
            {activeStep === "requirements" && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Step 1 of 5</p>
                    <h2>Confirm the brief.</h2>
                    <p>These are the rules SourceFix will use. Hard requirements never change automatically.</p>
                  </div>
                  <div className="count-badge"><strong>{requirements.length}</strong> rules</div>
                </div>
                <div className="requirement-list">
                  {requirements.map((requirement) => (
                    <div className="requirement-row" key={requirement.field}>
                      <div className={`constraint-tag ${requirement.constraint_type}`}>
                        {requirement.constraint_type}
                      </div>
                      <div className="requirement-main">
                        <strong>{requirement.label}</strong>
                        <span>{requirement.requirement}</span>
                      </div>
                      <div className="requirement-value">
                        <RequirementValue requirement={requirement} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="action-row">
                  <button className="button primary" onClick={() => void runBaseline()} disabled={loadingBaseline}>
                    {loadingBaseline ? <LoaderCircle className="spin" size={16} /> : <Filter size={16} />}
                    {loadingBaseline ? "Checking suppliers" : "Check suppliers"}
                    <ArrowRight size={16} />
                  </button>
                  <button className="text-button" onClick={() => void runBaseline(true)}>
                    Preview with demo data
                  </button>
                </div>
              </>
            )}

            {activeStep === "baseline" && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Step 2 of 5</p>
                    <h2>Start with the facts.</h2>
                    <p>The baseline filter runs without an agent. It tells you where the gaps are.</p>
                  </div>
                  <div className="big-stat"><strong>{eligibleCount}</strong><span>eligible now</span></div>
                </div>
                {baseline ? (
                  <div className="baseline-content">
                    <div className="metric-strip">
                      <div><strong>{Object.keys(baseline.results).length}</strong><span>suppliers checked</span></div>
                      <div><strong>{failureCount}</strong><span>soft or hard misses</span></div>
                      <div><strong>{eligibleCount}</strong><span>eligible at baseline</span></div>
                    </div>
                    <div className="check-list">
                      {Object.entries(baseline.results).map(([supplierId, checks]) => (
                        <div className="supplier-check" key={supplierId}>
                          <div className="supplier-check-heading"><strong>{supplierId} — {getSupplierName(supplierId, baseline)}</strong><span>{Object.values(checks).filter((check) => check.passed).length}/{Object.keys(checks).length} checks passed</span></div>
                          {Object.entries(checks).filter(([, check]) => !check.passed).map(([field, check]) => (
                            <div className="failed-check" key={field}><CircleAlert size={15} /><span><strong>{field.replaceAll("_", " ")}</strong>{check.reason}</span></div>
                          ))}
                          {!Object.values(checks).some((check) => !check.passed) && <div className="passed-check"><CircleCheck size={15} /> All checks passed</div>}
                        </div>
                      ))}
                    </div>
                    {baseline.sensitivity && Object.keys(baseline.sensitivity).length > 0 && (
                      <div className="sensitivity-section my-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                        <div className="flex items-center gap-2 mb-3">
                          <Sparkles size={16} className="text-amber-600" />
                          <strong className="text-sm uppercase tracking-wide text-amber-900">Sensitivity Analysis (Hypothetical Soft Relaxations)</strong>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          {Object.values(baseline.sensitivity).map((item) => (
                            <div key={item.field} className="p-3 bg-white/60 rounded border border-amber-200">
                              <span className="font-semibold block capitalize mb-1">{item.field.replaceAll("_", " ")}</span>
                              <span className="text-gray-600 block">Current: {String(item.current_value)} → Relaxed: {String(item.hypothetical_value)}</span>
                              <span className="font-medium text-emerald-700 block mt-1">
                                {item.newly_eligible_count > 0 ? `+${item.newly_eligible_count} qualified (${item.newly_eligible.join(", ")})` : "0 additional qualified"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="action-row">
                      <button className="button primary" onClick={() => void runAnalysis()} disabled={running}>
                        {running ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                        {running ? "Running SourceFix" : "Run SourceFix"}
                        <ArrowRight size={16} />
                      </button>
                      <button className="text-button" onClick={() => void runAnalysis(true)}>Run demo analysis</button>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state"><Filter size={28} /><strong>No baseline yet</strong><span>Run the eligibility check to see what needs attention.</span><button className="button secondary" onClick={() => void runBaseline()}>Run eligibility check</button></div>
                )}
              </>
            )}

            {activeStep === "run" && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Step 3 of 5</p>
                    <h2>Watch the reasoning.</h2>
                    <p>The live trace shows each agent node as it arrives from the stream.</p>
                  </div>
                  <div className={`run-status ${running ? "working" : analysis ? "done" : ""}`}><span />{running ? "Working" : analysis ? "Complete" : "Waiting"}</div>
                </div>
                <div className="trace-panel">
                  <div className="trace-header"><span><GitBranch size={15} /> live trace</span><span className="eyebrow">SSE / analyze-stream</span></div>
                  <div className="trace-body">
                    {trace.map((line, index) => (
                      <div className={`trace-line ${line.complete ? "complete" : ""}`} key={`${line.node}-${index}`}>
                        <span className="trace-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="trace-node">{line.node}</span>
                        <span>{line.message}</span>
                        {line.complete && <Check size={14} />}
                      </div>
                    ))}
                    {running && <div className="trace-line loading-line"><LoaderCircle className="spin" size={14} /> waiting for next node…</div>}
                  </div>
                </div>
                <div className="run-explanation"><ShieldCheck size={18} /><span>SourceFix can relax soft requirements, but it will never change a hard constraint without showing you first.</span></div>
                <div className="action-row">
                  <button className="button primary" onClick={() => void runAnalysis()} disabled={running}><Play size={16} />{running ? "Running SourceFix" : "Run SourceFix again"}</button>
                  <button className="text-button" onClick={() => setActiveStep("shortlist")} disabled={!analysis}>View shortlist</button>
                </div>
              </>
            )}

            {activeStep === "shortlist" && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Step 4 of 5</p>
                    <h2>Meet the finalists.</h2>
                    <p>These candidates passed the run. Keep the explanation beside the supplier record.</p>
                  </div>
                  <div className="count-badge"><strong>{shortlist.length}</strong> finalists</div>
                </div>
                {analysis?.status === "no_shortlist_found" ? (
                  <div className="empty-state p-6 border border-amber-400 bg-amber-50/50 rounded-xl text-center my-4">
                    <CircleAlert size={32} className="text-amber-600 mx-auto mb-2" />
                    <strong className="text-lg text-amber-900 block mb-1">No defensible shortlist found</strong>
                    <span className="text-sm text-amber-800 block max-w-md mx-auto mb-4">{analysis.message ?? "All candidates fail hard requirements -- manual review needed."}</span>
                    <button className="button secondary text-xs" onClick={() => setActiveStep("run")}>Review agent trace</button>
                  </div>
                ) : shortlist.length ? (
                  <div className="shortlist-list">
                    {shortlist.map((candidate, index) => (
                      <div className="candidate-card" key={candidate.supplier_id}>
                        <div className="candidate-rank">0{index + 1}</div>
                        <div className="candidate-body">
                          <div className="candidate-title">
                            <span className="supplier-id">{candidate.supplier_id}</span>
                            <strong>{getSupplierName(candidate.supplier_id, baseline)}</strong>
                          </div>
                          <p>{candidate.explanation}</p>
                          <button className="text-button" onClick={() => showNotice(`${candidate.supplier_id} added to the sourcing brief.`)}>
                            Add to sourcing brief <ArrowRight size={14} />
                          </button>
                        </div>
                        <div className="verified"><ShieldCheck size={16} /> verified</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <ShieldCheck size={28} />
                    <strong>No shortlist yet</strong>
                    <span>Run SourceFix to surface defensible candidates.</span>
                    <button className="button secondary" onClick={() => setActiveStep("run")}>Go to agent run</button>
                  </div>
                )}
                {shortlist.length > 0 && <div className="action-row"><button className="button primary" onClick={() => setActiveStep("ledger")}>Review the ledger <ArrowRight size={16} /></button></div>}
              </>
            )}

            {activeStep === "ledger" && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Step 5 of 5</p>
                    <h2>See every compromise.</h2>
                    <p>No hidden trade-offs. Each relaxation has a before, after, and reason.</p>
                  </div>
                  <div className="count-badge"><strong>{ledger.length}</strong> changes</div>
                </div>
                {ledger.length ? <div className="ledger-list">{ledger.map((item: Relaxation) => <div className="ledger-row" key={`${item.iteration}-${item.field}`}><div className="ledger-stamp">accepted</div><div className="ledger-copy"><strong>{item.field.replaceAll("_", " ")}</strong><div className="ledger-values"><span>{formatValue(item.old_value)}</span><ArrowRight size={14} /><b>{formatValue(item.new_value)}</b></div><p>{item.rationale}</p></div></div>)}</div> : <div className="empty-state"><FileCheck2 size={28} /><strong>The ledger is empty</strong><span>When SourceFix changes a soft requirement, it will appear here.</span><button className="button secondary" onClick={() => setActiveStep("run")}>Go to agent run</button></div>}
                {ledger.length > 0 && <div className="final-callout"><Check size={18} /><div><strong>Shortlist ready for review</strong><span>{analysis?.message ?? "All changes are documented."}</span></div></div>}
              </>
            )}
          </section>

          <aside className="side-column">
            <div className="summary-card">
              <div className="summary-heading"><span className="eyebrow">At a glance</span><span className="status-dot" /></div>
              <h3>{product.name}</h3>
              <div className="summary-item"><span>Hard constraints</span><strong>{hardCount}</strong></div>
              <div className="summary-item"><span>Soft constraints</span><strong>{softCount}</strong></div>
              <div className="summary-item"><span>Suppliers shortlisted</span><strong>{shortlist.length || "—"}</strong></div>
              <div className="summary-rule" />
              <div className="summary-foot"><span className="eyebrow">Current status</span><strong>{analysis ? statusLabel(analysis.status) : baseline ? "Baseline checked" : "Brief ready"}</strong></div>
            </div>
            <ConstellationGraphic />
            <div className="help-card"><CircleCheck size={18} /><div><strong>Easy to explain</strong><span>The final shortlist always carries its reasoning and its compromises.</span></div></div>
            <button className="reset-button" onClick={reset}><RotateCcw size={14} /> Start over</button>
          </aside>
        </div>

        <footer className="footer"><span>SourceFix / {product.id}</span><span>Every decision is reviewable</span></footer>
      </div>

      {notice && <div className="toast"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
    </main>
  );
}