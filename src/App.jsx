import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const AREAS = ["Aquatics","Arts","Camps","Fitness","Nature/Outdoor","Seniors","Special Events","Sports","Other"];
const SEASONS = ["Spring","Summer","Fall","Winter"];
const YEARS = ["2025","2026","2027","2028"];
const CLASSIFICATIONS = ["Community Driven","Revenue Driven","Both"];
const TRENDS = ["Growing","Stable","Declining"];
const SERVICE_CATEGORIES = [
  "Open Access","Community Events","Specialty Events",
  "Beg./Intro. Activities","Drop In Activities","Childcare Services",
  "Intermediate/Adv. Activities","Private/Semi-Private Activities",
  "Specialized Activities","Rentals","Retail & Consumables"
];
const PROGRAM_TYPES = [
  {label:"Small Contractual Program", pct:0.005},
  {label:"Large Contractual Program", pct:0.01},
  {label:"Drop-In Program", pct:0.02},
  {label:"Small Event", pct:0.03},
  {label:"Large Event", pct:0.06},
  {label:"League", pct:0.07},
  {label:"Camp", pct:0.1},
  {label:"Production / Major Program", pct:0.12},
];

const ADMIN_OVERHEAD_RATE = 0.1;
const FT_ANNUAL_SALARY = 97700;
const FACILITY_COST_PER_HOUR = 3;

// ─── Calculations ─────────────────────────────────────────────────────────────
function calcKPIs(p) {
  const fillRate = p.capacity > 0 ? p.enrollment / p.capacity : 0;
  const profitLoss = p.revenue - p.expenses;
  const costRecovery = p.expenses > 0 ? p.revenue / p.expenses : 0;
  let status = "Monitor";
  if (fillRate >= 0.7 && costRecovery >= 1.0) status = "Healthy";
  else if (fillRate < 0.6 || costRecovery < 0.5) status = "Needs Redesign";
  const action = status === "Healthy" ? "Continue" : status === "Monitor" ? "Monitor Closely" : "Redesign / Review";
  return { fillRate, profitLoss, costRecovery, status, action };
}

function calcCostRecovery(cr) {
  const workloadPct = cr.program_type && cr.program_type !== "Custom"
    ? (PROGRAM_TYPES.find(t => t.label === cr.program_type)?.pct || 0)
    : (parseFloat(cr.custom_workload) || 0) / 100;
  const directTotal = (cr.personnel||0) + (cr.commodities||0) + (cr.contractuals||0) + (cr.other1||0) + (cr.other2||0);
  const adminOverhead = directTotal * ADMIN_OVERHEAD_RATE;
  const allocatedFTStaff = FT_ANNUAL_SALARY * workloadPct;
  const allocatedFacility = FACILITY_COST_PER_HOUR * (parseFloat(cr.facility_hours) || 0);
  const totalProgramCost = directTotal + adminOverhead + allocatedFTStaff + allocatedFacility;
  const totalRevenue = cr.revenue || 0;
  const costRecoveryPct = totalProgramCost > 0 ? totalRevenue / totalProgramCost : 0;
  const subsidyPct = 1 - costRecoveryPct;
  const netProfit = totalRevenue - totalProgramCost;
  return { adminOverhead, allocatedFTStaff, allocatedFacility, totalDirectCosts: directTotal, totalProgramCost, totalRevenue, costRecoveryPct, subsidyPct, netProfit };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = {
  pct: v => `${((v||0)*100).toFixed(1)}%`,
  dollar: v => (v||0) < 0 ? `($${Math.abs(v||0).toLocaleString()})` : `$${(v||0).toLocaleString()}`,
};

function statusColor(status) {
  if (status === "Healthy") return { bg:"#dcfce7", text:"#166534", dot:"#22c55e" };
  if (status === "Monitor") return { bg:"#fef9c3", text:"#854d0e", dot:"#eab308" };
  return { bg:"#fee2e2", text:"#991b1b", dot:"#ef4444" };
}

function newProgram(staffName) {
  return {
    name:"", area:"Sports", season:"Summer", year:"2026",
    classification:"Community Driven", capacity:0, enrollment:0,
    revenue:0, expenses:0, waitlist:0, trend:"Stable", nps:0,
    notes:"", staff_name: staffName || ""
  };
}

function newCR(programId) {
  return {
    program_id: programId, season:"Summer", service_category:"", program_type:"",
    custom_workload:"", facility_hours:0, revenue:0,
    personnel:0, commodities:0, contractuals:0, other1:0, other2:0, notes:""
  };
}

// ─── Components ───────────────────────────────────────────────────────────────
function Input({ label, type="text", value, onChange, options, required, min, max, hint, placeholder }) {
  const base = "w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-blue-400 bg-white transition";
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        {label}{required && <span className="text-amber-500 ml-0.5">*</span>}
      </label>
      {options ? (
        <select className={base} value={value} onChange={e => onChange(e.target.value)}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input className={base} type={type} value={value} min={min} max={max}
          placeholder={placeholder || ""}
          onChange={e => onChange(type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)} />
      )}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

function KPICard({ label, value, sub, accent }) {
  return (
    <div style={{ borderTop: `3px solid ${accent || "#1e3a5f"}` }} className="bg-white rounded-lg p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Badge({ status }) {
  const c = statusColor(status);
  return (
    <span style={{ background: c.bg, color: c.text }} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap">
      <span style={{ background: c.dot }} className="w-1.5 h-1.5 rounded-full inline-block" />
      {status}
    </span>
  );
}

// ─── Staff Setup Screen ────────────────────────────────────────────────────────
function StaffSetup({ onConfirm }) {
  const [name, setName] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#f1f5f9" }}>
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-slate-800 mb-1">BGPD Recreation</div>
          <div className="text-sm text-slate-400">Enter your name to get started</div>
        </div>
        <div className="space-y-4">
          <Input label="Your Name" value={name} onChange={setName} placeholder="e.g. Sarah Johnson" required />
          <button
            onClick={() => name.trim() && onConfirm(name.trim())}
            disabled={!name.trim()}
            className="w-full py-2.5 text-sm font-bold text-white rounded-lg transition disabled:opacity-40"
            style={{ backgroundColor: "#1e3a5f" }}>
            Get Started
          </button>
        </div>
        <p className="text-xs text-slate-400 text-center mt-4">Your name will be saved on this device so you won't need to enter it again.</p>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ programs, staffName, isManager, onEdit, onAddProgram }) {
  const [staffFilter, setStaffFilter] = useState(isManager ? "All" : staffName);
  const [areaFilter, setAreaFilter] = useState("All");

  const allStaff = ["All", ...new Set(programs.map(p => p.staff_name).filter(Boolean))];
  const allAreas = ["All", ...new Set(programs.map(p => p.area))];

  const visible = programs
    .filter(p => staffFilter === "All" || p.staff_name === staffFilter)
    .filter(p => areaFilter === "All" || p.area === areaFilter);

  const kpis = visible.map(p => ({ ...p, ...calcKPIs(p) }));
  const avgFill = kpis.length ? kpis.reduce((a, p) => a + p.fillRate, 0) / kpis.length : 0;
  const avgCR = kpis.length ? kpis.reduce((a, p) => a + p.costRecovery, 0) / kpis.length : 0;
  const totalSurplus = kpis.reduce((a, p) => a + p.profitLoss, 0);
  const healthy = kpis.filter(p => p.status === "Healthy").length;
  const needsRedesign = kpis.filter(p => p.status === "Needs Redesign").length;
  const below60Fill = kpis.filter(p => p.fillRate < 0.6).length;
  const below50CR = kpis.filter(p => p.costRecovery < 0.5).length;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-3 items-center">
        {isManager && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Staff:</span>
            <div className="flex gap-1 flex-wrap">
              {allStaff.map(s => (
                <button key={s} onClick={() => setStaffFilter(s)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${staffFilter === s ? "text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                  style={staffFilter === s ? { backgroundColor: "#1e3a5f" } : {}}>{s}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Area:</span>
          <div className="flex gap-1 flex-wrap">
            {allAreas.map(a => (
              <button key={a} onClick={() => setAreaFilter(a)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${areaFilter === a ? "text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                style={areaFilter === a ? { backgroundColor: "#d4a017", color: "#1e3a5f" } : {}}>{a}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard label="Programs" value={visible.length} accent="#1e3a5f" />
        <KPICard label="Avg Fill Rate" value={fmt.pct(avgFill)} accent="#d4a017" />
        <KPICard label="Avg Cost Recovery" value={fmt.pct(avgCR)} accent="#d4a017" />
        <KPICard label="Total Surplus / Loss" value={fmt.dollar(totalSurplus)} accent={totalSurplus >= 0 ? "#22c55e" : "#ef4444"} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard label="Healthy" value={healthy} sub="programs" accent="#22c55e" />
        <KPICard label="Needs Redesign" value={needsRedesign} sub="programs" accent="#ef4444" />
        <KPICard label="Below 60% Fill" value={below60Fill} sub="programs" accent="#f97316" />
        <KPICard label="Below 50% Recovery" value={below50CR} sub="programs" accent="#f97316" />
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="font-bold text-slate-700 text-sm">Program Summary</h2>
          <span className="text-xs text-slate-400">{visible.length} program{visible.length !== 1 ? "s" : ""}</span>
        </div>
        {visible.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            No programs yet. <button onClick={onAddProgram} className="text-amber-600 font-semibold underline">Add your first program.</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                  {["Program", isManager ? "Staff" : null, "Area", "Season", "Fill Rate", "Cost Recovery", "Surplus/Loss", "Waitlist", "Trend", "Status", ""].filter(Boolean).map(h => (
                    <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((p, i) => {
                  const k = calcKPIs(p);
                  return (
                    <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 transition ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-3 py-2.5 font-semibold text-slate-700">{p.name}</td>
                      {isManager && <td className="px-3 py-2.5 text-slate-400 text-xs">{p.staff_name}</td>}
                      <td className="px-3 py-2.5 text-slate-500">{p.area}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{p.season} {p.year}</td>
                      <td className="px-3 py-2.5 font-mono">{fmt.pct(k.fillRate)}</td>
                      <td className="px-3 py-2.5 font-mono">{fmt.pct(k.costRecovery)}</td>
                      <td className={`px-3 py-2.5 font-mono font-semibold ${k.profitLoss >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt.dollar(k.profitLoss)}</td>
                      <td className="px-3 py-2.5 text-slate-500">{p.waitlist}</td>
                      <td className="px-3 py-2.5 text-slate-500">{p.trend}</td>
                      <td className="px-3 py-2.5"><Badge status={k.status} /></td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => onEdit(p)} className="text-xs text-slate-400 hover:text-slate-700 font-medium transition">Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-bold text-slate-700 text-sm mb-3">Status Guide</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3"><Badge status="Healthy" /><span className="text-slate-500">70%+ fill rate and 100%+ cost recovery</span></div>
          <div className="flex items-center gap-3"><Badge status="Monitor" /><span className="text-slate-500">60–69.9% fill rate or approaching target</span></div>
          <div className="flex items-center gap-3"><Badge status="Needs Redesign" /><span className="text-slate-500">Below 60% fill rate or below 50% cost recovery</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── Program Form ─────────────────────────────────────────────────────────────
function ProgramForm({ initial, staffName, onSave, onDelete, onCancel, saving }) {
  const [p, setP] = useState(initial || newProgram(staffName));
  const set = k => v => setP(prev => ({ ...prev, [k]: v }));
  const kpis = calcKPIs(p);
  const isNew = !initial;
  const canEdit = p.staff_name === staffName || !initial;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-700">{isNew ? "Add Program" : "Edit Program"}</h2>
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-600">← Back</button>
      </div>

      {!canEdit && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          This program was entered by <strong>{p.staff_name}</strong>. You can view but not edit it.
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Program Info</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Program Name" value={p.name} onChange={set("name")} required placeholder="e.g. Youth Basketball" />
          <Input label="Staff Member" value={p.staff_name} onChange={set("staff_name")} required placeholder="Your name" />
          <Input label="Area" value={p.area} onChange={set("area")} options={AREAS} />
          <Input label="Season" value={p.season} onChange={set("season")} options={SEASONS} />
          <Input label="Year" value={p.year} onChange={set("year")} options={YEARS} />
          <Input label="Classification" value={p.classification} onChange={set("classification")} options={CLASSIFICATIONS} />
          <Input label="NPS Score" type="number" value={p.nps} onChange={set("nps")} min={0} max={100} hint="0–100" />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Enrollment</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Capacity" type="number" value={p.capacity} onChange={set("capacity")} min={0} />
          <Input label="Enrollment" type="number" value={p.enrollment} onChange={set("enrollment")} min={0} />
          <Input label="Waitlist" type="number" value={p.waitlist} onChange={set("waitlist")} min={0} />
        </div>
        <Input label="Participation Trend" value={p.trend} onChange={set("trend")} options={TRENDS} />
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Financials</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Program Revenue ($)" type="number" value={p.revenue} onChange={set("revenue")} min={0} />
          <Input label="Program Expenses ($)" type="number" value={p.expenses} onChange={set("expenses")} min={0} />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Notes</h3>
        <textarea className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none" rows={3}
          placeholder="Strategy notes, drivers, multi-year context..." value={p.notes || ""} onChange={e => setP(prev => ({ ...prev, notes: e.target.value }))} />
      </div>

      <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Calculated KPIs (Auto)</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><div className="text-xs text-slate-400">Fill Rate</div><div className="text-lg font-bold text-slate-700">{fmt.pct(kpis.fillRate)}</div></div>
          <div><div className="text-xs text-slate-400">Cost Recovery</div><div className="text-lg font-bold text-slate-700">{fmt.pct(kpis.costRecovery)}</div></div>
          <div><div className="text-xs text-slate-400">Surplus / Loss</div><div className={`text-lg font-bold ${kpis.profitLoss >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt.dollar(kpis.profitLoss)}</div></div>
          <div><div className="text-xs text-slate-400">Status</div><div className="mt-1"><Badge status={kpis.status} /></div></div>
        </div>
      </div>

      {canEdit && (
        <div className="flex gap-3 justify-between">
          <div>
            {!isNew && <button onClick={() => onDelete(p.id)} className="px-4 py-2 text-sm text-red-500 hover:text-red-700 font-medium transition">Delete Program</button>}
          </div>
          <div className="flex gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 font-medium border border-slate-200 rounded transition">Cancel</button>
            <button onClick={() => onSave(p)} disabled={!p.name || saving}
              className="px-5 py-2 text-sm font-semibold text-white rounded transition disabled:opacity-40 flex items-center gap-2"
              style={{ backgroundColor: "#1e3a5f" }}>
              {saving ? "Saving..." : isNew ? "Save Program" : "Update Program"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cost Recovery ────────────────────────────────────────────────────────────
function CostRecoveryView({ programs, costRecords, onSave }) {
  const [selectedId, setSelectedId] = useState(programs[0]?.id || "");
  const [cr, setCR] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    const existing = costRecords.find(r => r.program_id === selectedId);
    setCR(existing ? { ...existing } : newCR(selectedId));
  }, [selectedId, costRecords]);

  const set = k => v => setCR(prev => ({ ...prev, [k]: v }));
  const prog = programs.find(p => p.id === selectedId);
  const calc = cr ? calcCostRecovery(cr) : null;

  const handleSave = async () => {
    await onSave(cr);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (programs.length === 0) return (
    <div className="text-center py-16 text-slate-400 text-sm">Add programs first to run cost recovery worksheets.</div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Select Program</h3>
        <select className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-white"
          value={selectedId} onChange={e => setSelectedId(e.target.value)}>
          {programs.map(p => <option key={p.id} value={p.id}>{p.name} – {p.season} {p.year} {p.staff_name ? `(${p.staff_name})` : ""}</option>)}
        </select>
        {prog && <div className="mt-2 text-xs text-slate-400">{prog.area} · {prog.classification}</div>}
      </div>

      {cr && (
        <>
          <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Program Info</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Service Category" value={cr.service_category || ""} onChange={set("service_category")} options={["", ...SERVICE_CATEGORIES]} />
              <Input label="Season / Session" value={cr.season || "Summer"} onChange={set("season")} options={SEASONS} />
              <Input label="Total Revenue ($)" type="number" value={cr.revenue || 0} onChange={set("revenue")} min={0} />
              <Input label="Facility Hours Used" type="number" value={cr.facility_hours || 0} onChange={set("facility_hours")} min={0} hint="Hours the space is used" />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Direct Costs</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Personnel ($)" type="number" value={cr.personnel || 0} onChange={set("personnel")} min={0} />
              <Input label="Commodities ($)" type="number" value={cr.commodities || 0} onChange={set("commodities")} min={0} />
              <Input label="Contractuals ($)" type="number" value={cr.contractuals || 0} onChange={set("contractuals")} min={0} />
              <Input label="Other Direct Costs ($)" type="number" value={cr.other1 || 0} onChange={set("other1")} min={0} />
              <Input label="Other Direct Costs 2 ($)" type="number" value={cr.other2 || 0} onChange={set("other2")} min={0} />
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Staff Workload</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Program Type" value={cr.program_type || ""} onChange={set("program_type")} options={["Custom", ...PROGRAM_TYPES.map(t => t.label)]} />
              {(!cr.program_type || cr.program_type === "Custom") ? (
                <Input label="Custom Workload %" type="number" value={cr.custom_workload || ""} onChange={set("custom_workload")} min={0} max={100} hint="% of FT staff time" />
              ) : (
                <div className="flex flex-col gap-1 justify-center">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Workload %</label>
                  <div className="text-lg font-bold text-slate-700">{((PROGRAM_TYPES.find(t => t.label === cr.program_type)?.pct || 0) * 100).toFixed(1)}%</div>
                </div>
              )}
            </div>
          </div>

          {calc && (
            <div className="bg-slate-800 rounded-lg p-5 text-white space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Results (Auto-Calculated)</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div><div className="text-xs text-slate-400">Total Direct Costs</div><div className="text-base font-bold">{fmt.dollar(Math.round(calc.totalDirectCosts))}</div></div>
                <div><div className="text-xs text-slate-400">Admin Overhead (10%)</div><div className="text-base font-bold">{fmt.dollar(Math.round(calc.adminOverhead))}</div></div>
                <div><div className="text-xs text-slate-400">Allocated FT Staff</div><div className="text-base font-bold">{fmt.dollar(Math.round(calc.allocatedFTStaff))}</div></div>
                <div><div className="text-xs text-slate-400">Allocated Facility</div><div className="text-base font-bold">{fmt.dollar(Math.round(calc.allocatedFacility))}</div></div>
                <div><div className="text-xs text-slate-400">Total Program Cost</div><div className="text-base font-bold">{fmt.dollar(Math.round(calc.totalProgramCost))}</div></div>
                <div><div className="text-xs text-slate-400">Total Revenue</div><div className="text-base font-bold">{fmt.dollar(calc.totalRevenue)}</div></div>
              </div>
              <div className="border-t border-slate-600 pt-3 grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-slate-400">Cost Recovery</div>
                  <div className={`text-2xl font-black ${calc.costRecoveryPct >= 1 ? "text-green-400" : "text-amber-400"}`}>{fmt.pct(calc.costRecoveryPct)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Subsidy</div>
                  <div className="text-2xl font-black text-slate-200">{fmt.pct(Math.max(0, calc.subsidyPct))}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Net Profit / (Loss)</div>
                  <div className={`text-2xl font-black ${calc.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt.dollar(Math.round(calc.netProfit))}</div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Notes / Drivers / Multi-Year Strategy</h3>
            <textarea className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none" rows={3}
              placeholder="What's driving costs or revenue?" value={cr.notes || ""} onChange={e => setCR(prev => ({ ...prev, notes: e.target.value }))} />
          </div>

          <div className="flex justify-end">
            <button onClick={handleSave}
              className="px-5 py-2 text-sm font-semibold text-white rounded transition"
              style={{ backgroundColor: saved ? "#22c55e" : "#1e3a5f" }}>
              {saved ? "✓ Saved!" : "Save Worksheet"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── KPI Reference ────────────────────────────────────────────────────────────
function KPIReference() {
  const tiers = [
    {
      label: "Tier 1 – Always Tracked", color: "#1e3a5f", items: [
        { m: "Fill Rate", d: "Percent of available spots filled", w: "Quarterly" },
        { m: "Cost Recovery", d: "Revenue divided by direct costs", w: "Quarterly" },
        { m: "Program Surplus / Loss", d: "Revenue minus direct program costs", w: "Quarterly" },
        { m: "Participation Trend", d: "Growing, stable, or declining over time", w: "Quarterly" },
        { m: "Status", d: "Healthy, Monitor, or Needs Redesign", w: "Quarterly" },
      ]
    },
    {
      label: "Tier 2 – Participation", color: "#d4a017", items: [
        { m: "Total Enrollment", d: "Number of registered participants", w: "As needed" },
        { m: "Waitlist Volume", d: "Demand beyond capacity", w: "As needed" },
        { m: "Waitlist Conversion Rate", d: "Percent of waitlisted who enroll", w: "As needed" },
        { m: "Retention Rate", d: "Percent who return to a future session", w: "As needed" },
        { m: "Cancellation Rate", d: "Registrants who drop before start", w: "As needed" },
      ]
    },
    {
      label: "Tier 2 – Financial", color: "#d4a017", items: [
        { m: "Margin %", d: "Surplus divided by revenue", w: "As needed" },
        { m: "Revenue per Participant", d: "Revenue divided by enrolled participants", w: "As needed" },
        { m: "Revenue per Program Hour", d: "Revenue earned per scheduled hour", w: "As needed" },
        { m: "Direct Cost per Participant", d: "Direct costs divided by enrollment", w: "As needed" },
      ]
    },
    {
      label: "Tier 2 – Operational / Space", color: "#d4a017", items: [
        { m: "Participant to Staff Ratio", d: "Enrollment relative to staffing", w: "As needed" },
        { m: "Facility Utilization Rate", d: "Extent to which a space is booked or used", w: "As needed" },
        { m: "Prime Time Usage Rate", d: "Use during high demand periods", w: "As needed" },
        { m: "Revenue per Facility Hour", d: "Financial productivity of space", w: "As needed" },
      ]
    },
    {
      label: "Tier 2 – Quality / Innovation", color: "#d4a017", items: [
        { m: "NPS", d: "Likelihood participants recommend the program", w: "As needed" },
        { m: "Participant Satisfaction", d: "Program quality score", w: "As needed" },
        { m: "Pilot Success Rate", d: "Pilot met participation and financial targets", w: "As needed" },
        { m: "New Program Retention Rate", d: "Whether pilots continue or return", w: "As needed" },
      ]
    },
  ];

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">Use Tier 1 metrics quarterly. Use Tier 2 metrics when a program needs a deeper review.</p>
      {tiers.map(tier => (
        <div key={tier.label} className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{ backgroundColor: tier.color }}>{tier.label}</div>
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
              <th className="px-4 py-2 text-left">Metric</th>
              <th className="px-4 py-2 text-left">Definition</th>
              <th className="px-4 py-2 text-left">When to Use</th>
            </tr></thead>
            <tbody>
              {tier.items.map((item, i) => (
                <tr key={item.m} className={`border-t border-slate-50 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
                  <td className="px-4 py-2.5 font-semibold text-slate-700">{item.m}</td>
                  <td className="px-4 py-2.5 text-slate-500">{item.d}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{item.w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
const MANAGER_NAMES = ["admin", "manager"]; // lowercase — add your name here after setup

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [programs, setPrograms] = useState([]);
  const [costRecords, setCostRecords] = useState([]);
  const [editingProgram, setEditingProgram] = useState(null);
  const [addingProgram, setAddingProgram] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [staffName, setStaffName] = useState(() => localStorage.getItem("bgpd_staff_name") || "");

  const isManager = MANAGER_NAMES.includes(staffName.toLowerCase().trim());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("programs").select("*").order("created_at", { ascending: false }),
      supabase.from("cost_records").select("*")
    ]);
    setPrograms(p || []);
    setCostRecords(c || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (staffName) fetchAll(); else setLoading(false); }, [staffName, fetchAll]);

  const handleConfirmName = (name) => {
    localStorage.setItem("bgpd_staff_name", name);
    setStaffName(name);
  };

  const handleSaveProgram = async (p) => {
    setSaving(true);
    setError(null);
    try {
      if (p.id) {
        const { error: e } = await supabase.from("programs").update(p).eq("id", p.id);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from("programs").insert(p);
        if (e) throw e;
      }
      await fetchAll();
      setEditingProgram(null);
      setAddingProgram(false);
      setTab("dashboard");
    } catch (e) {
      setError("Failed to save. Please try again.");
    }
    setSaving(false);
  };

  const handleDeleteProgram = async (id) => {
    setSaving(true);
    await supabase.from("programs").delete().eq("id", id);
    await supabase.from("cost_records").delete().eq("program_id", id);
    await fetchAll();
    setEditingProgram(null);
    setTab("dashboard");
    setSaving(false);
  };

  const handleSaveCR = async (cr) => {
    const exists = costRecords.find(r => r.program_id === cr.program_id);
    if (exists) {
      await supabase.from("cost_records").update(cr).eq("program_id", cr.program_id);
    } else {
      await supabase.from("cost_records").insert(cr);
    }
    await fetchAll();
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "programs", label: "Programs" },
    { id: "cost", label: "Cost Recovery" },
    { id: "kpi", label: "KPI Reference" },
  ];

  const showingForm = editingProgram || addingProgram;

  if (!staffName) return <StaffSetup onConfirm={handleConfirmName} />;

  return (
    <div className="min-h-screen" style={{ background: "#f1f5f9" }}>
      <header style={{ backgroundColor: "#1e3a5f" }} className="px-4 py-4 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-lg leading-tight">BGPD Recreation</div>
            <div style={{ color: "#d4a017" }} className="text-xs font-semibold tracking-widest uppercase">
              {staffName}{isManager ? " · Manager View" : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setAddingProgram(true); setEditingProgram(null); setTab("programs"); }}
              className="text-xs font-bold px-3 py-2 rounded transition"
              style={{ backgroundColor: "#d4a017", color: "#1e3a5f" }}>
              + Add Program
            </button>
            <button onClick={() => { localStorage.removeItem("bgpd_staff_name"); setStaffName(""); }}
              className="text-xs text-slate-300 hover:text-white px-2 py-2 transition" title="Switch user">⇄</button>
          </div>
        </div>
      </header>

      <nav className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto flex gap-1 px-4 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setEditingProgram(null); setAddingProgram(false); }}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${tab === t.id ? "text-slate-800" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              style={tab === t.id ? { borderColor: "#d4a017", borderBottomWidth: "2px" } : {}}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex justify-between">
            {error} <button onClick={() => setError(null)} className="font-bold">✕</button>
          </div>
        )}
        {loading ? (
          <div className="text-center py-20 text-slate-400">Loading programs...</div>
        ) : (
          <>
            {tab === "dashboard" && !showingForm && (
              <Dashboard programs={programs} staffName={staffName} isManager={isManager}
                onEdit={p => { setEditingProgram(p); setTab("programs"); }}
                onAddProgram={() => { setAddingProgram(true); setTab("programs"); }} />
            )}
            {tab === "programs" && !showingForm && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-slate-700">All Programs ({programs.length})</h2>
                  <button onClick={() => setAddingProgram(true)}
                    className="text-xs font-bold px-3 py-2 rounded text-white transition"
                    style={{ backgroundColor: "#1e3a5f" }}>+ Add Program</button>
                </div>
                {programs.length === 0 ? (
                  <div className="bg-white rounded-lg shadow-sm p-12 text-center text-slate-400 text-sm">No programs yet.</div>
                ) : (
                  <div className="space-y-2">
                    {programs.map(p => {
                      const k = calcKPIs(p);
                      return (
                        <div key={p.id} className="bg-white rounded-lg shadow-sm px-4 py-3 flex items-center justify-between gap-4 hover:shadow-md transition cursor-pointer" onClick={() => setEditingProgram(p)}>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-700 truncate">{p.name}</div>
                            <div className="text-xs text-slate-400">{p.area} · {p.season} {p.year} · {p.staff_name}</div>
                          </div>
                          <div className="hidden sm:flex gap-6 text-sm">
                            <div className="text-center"><div className="text-xs text-slate-400">Fill</div><div className="font-mono font-semibold">{fmt.pct(k.fillRate)}</div></div>
                            <div className="text-center"><div className="text-xs text-slate-400">Recovery</div><div className="font-mono font-semibold">{fmt.pct(k.costRecovery)}</div></div>
                            <div className="text-center"><div className="text-xs text-slate-400">Surplus</div><div className={`font-mono font-semibold ${k.profitLoss >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt.dollar(k.profitLoss)}</div></div>
                          </div>
                          <Badge status={k.status} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {tab === "programs" && showingForm && (
              <ProgramForm initial={editingProgram || null} staffName={staffName}
                onSave={handleSaveProgram} onDelete={handleDeleteProgram}
                onCancel={() => { setEditingProgram(null); setAddingProgram(false); }}
                saving={saving} />
            )}
            {tab === "cost" && <CostRecoveryView programs={programs} costRecords={costRecords} onSave={handleSaveCR} />}
            {tab === "kpi" && <KPIReference />}
          </>
        )}
      </main>
    </div>
  );
}
