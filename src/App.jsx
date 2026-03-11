import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const AREAS = ["Adult General","Adult Sports","Aquatics","Camps","Dance","Fitness","Golf Dome","Museum","Performing Arts","Seniors","Special Events","Youth General","Youth Sports","Other"];
const SEASONS = ["Spring","Summer","Fall","Winter","All Year"];
const YEARS = ["2025","2026","2027","2028","2029","2030"];
const CLASSIFICATIONS = ["Community Driven","Revenue Driven","Both"];
const TRENDS = ["Growing","Stable","Declining"];
const SERVICE_CATEGORIES = ["Open Access","Community Events","Specialty Events","Beg./Intro. Activities","Drop In Activities","Childcare Services","Intermediate/Adv. Activities","Private/Semi-Private Activities","Specialized Activities","Rentals","Retail & Consumables"];
const PROGRAM_TYPES = [
  {label:"Small Contractual Program",pct:0.005},
  {label:"Large Contractual Program",pct:0.01},
  {label:"Drop-In Program",pct:0.02},
  {label:"Small Event",pct:0.03},
  {label:"Small Program",pct:0.04},
  {label:"Large Event",pct:0.05},
  {label:"Large Program",pct:0.06},
  {label:"League",pct:0.07},
  {label:"Camp",pct:0.1},
  {label:"Production / Major Program",pct:0.12},
];
const ADMIN_OVERHEAD_RATE = 0.1;
const FT_ANNUAL_SALARY = 97700;
const FACILITY_COST_PER_HOUR = 3;

// ─── Core cost recovery calc (works for both ant_ and act_ prefixes) ──────────
function calcCRFromProgram(p, prefix) {
  const personnel    = p[`${prefix}personnel`]      || 0;
  const commodities  = p[`${prefix}commodities`]    || 0;
  const contractuals = p[`${prefix}contractuals`]   || 0;
  const other1       = p[`${prefix}other1`]         || 0;
  const other2       = p[`${prefix}other2`]         || 0;
  const facilityHrs  = p[`${prefix}facility_hours`] || 0;
  const programType  = p[`${prefix}program_type`]   || "";
  const customWL     = p[`${prefix}custom_workload`]|| 0;
  const revenue      = p[`${prefix}revenue`]        || 0;
  const enrollment   = p[`${prefix}enrollment`]     || 0;
  const capacity     = p[`${prefix}capacity`]       || 0;

  const workloadPct = programType && programType !== "Custom"
    ? (PROGRAM_TYPES.find(t => t.label === programType)?.pct || 0)
    : (parseFloat(customWL) || 0) / 100;

  const directTotal      = personnel + commodities + contractuals + other1 + other2;
  const adminOverhead    = directTotal * ADMIN_OVERHEAD_RATE;
  const allocatedFTStaff = FT_ANNUAL_SALARY * workloadPct;
  const allocatedFacility= FACILITY_COST_PER_HOUR * facilityHrs;
  const totalProgramCost = directTotal + adminOverhead + allocatedFTStaff + allocatedFacility;
  const costRecoveryPct  = totalProgramCost > 0 ? revenue / totalProgramCost : 0;
  const subsidyPct       = 1 - costRecoveryPct;
  const netProfit        = revenue - totalProgramCost;
  const fillRate         = capacity > 0 ? enrollment / capacity : 0;

  return { directTotal, adminOverhead, allocatedFTStaff, allocatedFacility,
           totalProgramCost, revenue, costRecoveryPct, subsidyPct, netProfit,
           fillRate, enrollment, capacity };
}

function calcKPIs(p) {
  const ant = calcCRFromProgram(p, "ant_");
  const act = calcCRFromProgram(p, "act_");
  let status = "Monitor";
  if (act.fillRate >= 0.7 && act.costRecoveryPct >= 1.0) status = "Healthy";
  else if (act.fillRate < 0.6 || act.costRecoveryPct < 0.5) status = "Needs Redesign";
  const action = status==="Healthy"?"Continue":status==="Monitor"?"Monitor Closely":"Redesign / Review";
  return {
    fillRate: act.fillRate, costRecovery: act.costRecoveryPct,
    profitLoss: act.netProfit, totalProgramCost: act.totalProgramCost, revenue: act.revenue,
    status, action,
    antFillRate: ant.fillRate, antCostRecovery: ant.costRecoveryPct,
    antProfitLoss: ant.netProfit, antTotalCost: ant.totalProgramCost, antRevenue: ant.revenue,
    varEnrollment: act.enrollment - ant.enrollment,
    varRevenue: act.revenue - ant.revenue,
    varCost: act.totalProgramCost - ant.totalProgramCost,
    varFillRate: act.fillRate - ant.fillRate,
    varCostRecovery: act.costRecoveryPct - ant.costRecoveryPct,
    varNetProfit: act.netProfit - ant.netProfit,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = {
  pct: v => `${((v||0)*100).toFixed(1)}%`,
  dollar: v => (v||0)<0 ? `($${Math.abs(Math.round(v||0)).toLocaleString()})` : `$${Math.round(v||0).toLocaleString()}`,
  varDollar: v => v>0 ? `+$${Math.round(v).toLocaleString()}` : v<0 ? `($${Math.abs(Math.round(v)).toLocaleString()})` : `$0`,
  varNum: v => v>0 ? `+${v}` : `${v}`,
  varPct: v => v>0 ? `+${(v*100).toFixed(1)}%` : `${(v*100).toFixed(1)}%`,
};
function statusColor(s) {
  if (s==="Healthy") return {bg:"#dcfce7",text:"#166534",dot:"#22c55e"};
  if (s==="Monitor") return {bg:"#fef9c3",text:"#854d0e",dot:"#eab308"};
  return {bg:"#fee2e2",text:"#991b1b",dot:"#ef4444"};
}
function varColor(v, inv) {
  if (!v||v===0) return "text-slate-400";
  return (inv ? v<0 : v>0) ? "text-green-600 font-semibold" : "text-red-500 font-semibold";
}
function newProgram(staffName) {
  return {
    name:"", area:"Sports", season:"Summer", year:"2026",
    classification:"Community Driven", service_category:"",
    trend:"Stable", nps:0, notes:"", staff_name: staffName||"", waitlist:0,
    ant_capacity:0, ant_enrollment:0, ant_revenue:0,
    ant_personnel:0, ant_commodities:0, ant_contractuals:0,
    ant_other1:0, ant_other2:0, ant_facility_hours:0,
    ant_program_type:"", ant_custom_workload:0,
    act_capacity:0, act_enrollment:0, act_revenue:0,
    act_personnel:0, act_commodities:0, act_contractuals:0,
    act_other1:0, act_other2:0, act_facility_hours:0,
    act_program_type:"", act_custom_workload:0,
  };
}

// ─── UI Components ────────────────────────────────────────────────────────────
function Input({ label, type="text", value, onChange, options, min, max, hint, placeholder, required }) {
  const base = "w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-blue-400 bg-white transition";
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        {label}{required && <span className="text-amber-500 ml-0.5">*</span>}
      </label>
      {options
        ? <select className={base} value={value||""} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>
        : <input className={base} type={type} value={value||""} min={min} max={max} placeholder={placeholder||""} onChange={e=>onChange(type==="number"?parseFloat(e.target.value)||0:e.target.value)}/>
      }
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

function KPICard({ label, value, sub, accent }) {
  return (
    <div style={{borderTop:`3px solid ${accent||"#1e3a5f"}`}} className="bg-white rounded-lg p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Badge({ status }) {
  const c = statusColor(status);
  return (
    <span style={{background:c.bg,color:c.text}} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap">
      <span style={{background:c.dot}} className="w-1.5 h-1.5 rounded-full inline-block"/>{status}
    </span>
  );
}

function ProgressBar({ label, actual, anticipated, formatFn, invertGood }) {
  const pct = anticipated > 0 ? Math.min((actual/anticipated)*100, 150) : 0;
  const variance = actual - anticipated;
  const isGood = invertGood ? variance <= 0 : variance >= 0;
  const barColor = pct>=100 ? (invertGood?"#ef4444":"#22c55e") : pct>=75 ? "#eab308" : "#ef4444";
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
        <span className={`text-xs font-bold ${isGood?"text-green-600":"text-red-500"}`}>{variance>=0?"+":""}{formatFn?formatFn(variance):variance}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{width:`${Math.min(pct,100)}%`,backgroundColor:barColor}}/>
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>Actual: <span className="font-semibold text-slate-600">{formatFn?formatFn(actual):actual}</span></span>
        <span>Budget: <span className="font-semibold text-slate-600">{formatFn?formatFn(anticipated):anticipated}</span></span>
      </div>
    </div>
  );
}

// Shared cost breakdown block — renders inputs + auto-calc results for ant_ or act_
function CostBreakdown({ prefix, p, set }) {
  const isAnt = prefix === "ant_";
  const calc = calcCRFromProgram(p, prefix);
  const labelCls = isAnt ? "text-blue-500" : "text-slate-500";
  const valueCls = isAnt ? "text-blue-700" : "text-slate-700";
  const resultBg = isAnt ? "#eff6ff" : "#f8fafc";
  const resultBorder = isAnt ? "#bfdbfe" : "#e2e8f0";

  return (
    <div className="space-y-5">
      {/* Enrollment & Revenue */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input label="Capacity" type="number" value={p[`${prefix}capacity`]} onChange={set(`${prefix}capacity`)} min={0}/>
        <Input label="Enrollment" type="number" value={p[`${prefix}enrollment`]} onChange={set(`${prefix}enrollment`)} min={0}/>
        <Input label="Revenue ($)" type="number" value={p[`${prefix}revenue`]} onChange={set(`${prefix}revenue`)} min={0}/>
      </div>

      {/* Direct costs */}
      <div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Direct Costs</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Personnel ($)"           type="number" value={p[`${prefix}personnel`]}    onChange={set(`${prefix}personnel`)}    min={0}/>
          <Input label="Commodities ($)"         type="number" value={p[`${prefix}commodities`]}  onChange={set(`${prefix}commodities`)}  min={0}/>
          <Input label="Contractuals ($)"        type="number" value={p[`${prefix}contractuals`]} onChange={set(`${prefix}contractuals`)} min={0}/>
          <Input label="Other Direct Costs ($)"  type="number" value={p[`${prefix}other1`]}       onChange={set(`${prefix}other1`)}       min={0}/>
          <Input label="Other Direct Costs 2 ($)"type="number" value={p[`${prefix}other2`]}       onChange={set(`${prefix}other2`)}       min={0}/>
          <Input label="Facility Hours"          type="number" value={p[`${prefix}facility_hours`]} onChange={set(`${prefix}facility_hours`)} min={0} hint={`$${FACILITY_COST_PER_HOUR}/hr allocated`}/>
        </div>
      </div>

      {/* Workload */}
      <div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Staff Workload</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Program Type" value={p[`${prefix}program_type`]||"Custom"} onChange={set(`${prefix}program_type`)} options={["Custom",...PROGRAM_TYPES.map(t=>t.label)]}/>
          {(!p[`${prefix}program_type`]||p[`${prefix}program_type`]==="Custom")
            ? <Input label="Custom Workload %" type="number" value={p[`${prefix}custom_workload`]} onChange={set(`${prefix}custom_workload`)} min={0} max={100} hint="% of FT staff time"/>
            : <div className="flex flex-col gap-1 justify-center">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Workload %</label>
                <div className="text-lg font-bold text-slate-700">{((PROGRAM_TYPES.find(t=>t.label===p[`${prefix}program_type`])?.pct||0)*100).toFixed(1)}%</div>
              </div>
          }
        </div>
      </div>

      {/* Auto-calc results */}
      <div className="rounded-lg p-4 space-y-3" style={{background:resultBg,border:`1px solid ${resultBorder}`}}>
        <div className="text-xs font-bold uppercase tracking-widest" style={{color:isAnt?"#2563eb":"#64748b"}}>Calculated Results</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
          <div><div className={`text-xs ${labelCls}`}>Direct Costs</div><div className={`font-bold ${valueCls}`}>{fmt.dollar(calc.directTotal)}</div></div>
          <div><div className={`text-xs ${labelCls}`}>Admin Overhead (10%)</div><div className={`font-bold ${valueCls}`}>{fmt.dollar(calc.adminOverhead)}</div></div>
          <div><div className={`text-xs ${labelCls}`}>Allocated FT Staff</div><div className={`font-bold ${valueCls}`}>{fmt.dollar(calc.allocatedFTStaff)}</div></div>
          <div><div className={`text-xs ${labelCls}`}>Allocated Facility</div><div className={`font-bold ${valueCls}`}>{fmt.dollar(calc.allocatedFacility)}</div></div>
          <div><div className={`text-xs ${labelCls}`}>Total Program Cost</div><div className={`font-bold ${valueCls}`}>{fmt.dollar(calc.totalProgramCost)}</div></div>
          <div><div className={`text-xs ${labelCls}`}>Fill Rate</div><div className={`font-bold ${valueCls}`}>{fmt.pct(calc.fillRate)}</div></div>
        </div>
        <div className="grid grid-cols-3 gap-3 pt-3" style={{borderTop:`1px solid ${resultBorder}`}}>
          <div><div className={`text-xs ${labelCls}`}>Cost Recovery</div><div className={`text-xl font-black ${calc.costRecoveryPct>=1?"text-green-600":"text-amber-500"}`}>{fmt.pct(calc.costRecoveryPct)}</div></div>
          <div><div className={`text-xs ${labelCls}`}>Subsidy</div><div className={`text-xl font-black ${valueCls}`}>{fmt.pct(Math.max(0,calc.subsidyPct))}</div></div>
          <div><div className={`text-xs ${labelCls}`}>Net Profit/(Loss)</div><div className={`text-xl font-black ${calc.netProfit>=0?"text-green-600":"text-red-500"}`}>{fmt.dollar(calc.netProfit)}</div></div>
        </div>
      </div>
    </div>
  );
}

// ─── Staff Setup ──────────────────────────────────────────────────────────────
function StaffSetup({ onConfirm }) {
  const [name, setName] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{background:"#f1f5f9"}}>
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-slate-800 mb-1">BGPD Recreation</div>
          <div className="text-sm text-slate-400">Enter your name to get started</div>
        </div>
        <div className="space-y-4">
          <Input label="Your Name" value={name} onChange={setName} placeholder="e.g. Sarah Johnson" required/>
          <button onClick={()=>name.trim()&&onConfirm(name.trim())} disabled={!name.trim()}
            className="w-full py-2.5 text-sm font-bold text-white rounded-lg transition disabled:opacity-40"
            style={{backgroundColor:"#1e3a5f"}}>Get Started</button>
        </div>
        <p className="text-xs text-slate-400 text-center mt-4">Your name will be saved on this device.</p>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ programs, staffName, isManager, onEdit, onAddProgram }) {
  const [staffFilter, setStaffFilter] = useState(isManager ? "All" : staffName);
  const [areaFilter, setAreaFilter]   = useState("All");
  const [dashView, setDashView]       = useState("summary");

  const allStaff = ["All",...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas = ["All",...new Set(programs.map(p=>p.area))];
  const visible = programs
    .filter(p=>staffFilter==="All"||p.staff_name===staffFilter)
    .filter(p=>areaFilter==="All"||p.area===areaFilter);
  const kpis = visible.map(p=>({...p,...calcKPIs(p)}));

  const avgFill       = kpis.length ? kpis.reduce((a,p)=>a+p.fillRate,0)/kpis.length : 0;
  const avgCR         = kpis.length ? kpis.reduce((a,p)=>a+p.costRecovery,0)/kpis.length : 0;
  const totalSurplus  = kpis.reduce((a,p)=>a+p.profitLoss,0);
  const totalAntRev   = kpis.reduce((a,p)=>a+p.antRevenue,0);
  const totalActRev   = kpis.reduce((a,p)=>a+p.revenue,0);
  const totalAntEnr   = visible.reduce((a,p)=>a+(p.ant_enrollment||0),0);
  const totalActEnr   = visible.reduce((a,p)=>a+(p.act_enrollment||0),0);
  const totalAntCost  = kpis.reduce((a,p)=>a+p.antTotalCost,0);
  const totalActCost  = kpis.reduce((a,p)=>a+p.totalProgramCost,0);
  const healthy       = kpis.filter(p=>p.status==="Healthy").length;
  const needsRedesign = kpis.filter(p=>p.status==="Needs Redesign").length;
  const below60Fill   = kpis.filter(p=>p.fillRate<0.6).length;
  const below50CR     = kpis.filter(p=>p.costRecovery<0.5).length;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-4 items-end">
        {isManager && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Staff</label>
            <select value={staffFilter} onChange={e=>setStaffFilter(e.target.value)}
              className="rounded border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400 min-w-[160px]">
              {allStaff.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Area</label>
          <select value={areaFilter} onChange={e=>setAreaFilter(e.target.value)}
            className="rounded border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400 min-w-[160px]">
            {allAreas.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {(staffFilter!=="All"||areaFilter!=="All") && (
          <button onClick={()=>{setStaffFilter(isManager?"All":staffName);setAreaFilter("All");}}
            className="text-xs text-slate-400 hover:text-slate-600 pb-1.5 font-medium transition">
            Clear filters ✕
          </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard label="Programs"             value={visible.length}          accent="#1e3a5f"/>
        <KPICard label="Avg Fill Rate"        value={fmt.pct(avgFill)}        accent="#d4a017"/>
        <KPICard label="Avg Cost Recovery"    value={fmt.pct(avgCR)}          accent="#d4a017"/>
        <KPICard label="Total Net Profit/(Loss)" value={fmt.dollar(totalSurplus)} accent={totalSurplus>=0?"#22c55e":"#ef4444"}/>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard label="Healthy"           value={healthy}       sub="programs" accent="#22c55e"/>
        <KPICard label="Needs Redesign"    value={needsRedesign} sub="programs" accent="#ef4444"/>
        <KPICard label="Below 60% Fill"    value={below60Fill}   sub="programs" accent="#f97316"/>
        <KPICard label="Below 50% Recovery" value={below50CR}   sub="programs" accent="#f97316"/>
      </div>

      {/* Portfolio progress */}
      <div className="bg-white rounded-lg shadow-sm p-5 space-y-5">
        <h3 className="font-bold text-slate-700 text-sm">Portfolio: Budgeted vs Actual</h3>
        <ProgressBar label="Total Revenue"      actual={totalActRev}  anticipated={totalAntRev}  formatFn={v=>fmt.dollar(v)}/>
        <ProgressBar label="Total Enrollment"   actual={totalActEnr}  anticipated={totalAntEnr}  formatFn={v=>v.toString()}/>
        <ProgressBar label="Total Program Cost" actual={totalActCost} anticipated={totalAntCost} formatFn={v=>fmt.dollar(v)} invertGood/>
      </div>

      {/* Program detail */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-wrap gap-2">
          <h2 className="font-bold text-slate-700 text-sm">Program Detail</h2>
          <div className="flex gap-1">
            {[["summary","Summary"],["variances","Variances"],["progress","Progress"]].map(([v,l])=>(
              <button key={v} onClick={()=>setDashView(v)}
                className={`text-xs px-3 py-1.5 rounded font-medium transition ${dashView===v?"text-white":"bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                style={dashView===v?{backgroundColor:"#1e3a5f"}:{}}>{l}</button>
            ))}
          </div>
        </div>

        {visible.length===0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No programs yet. <button onClick={onAddProgram} className="text-amber-600 font-semibold underline">Add your first program.</button></div>
        ) : dashView==="summary" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                {["Program",isManager?"Staff":null,"Area","Season","Fill Rate","Cost Recovery","Net Profit/(Loss)","Total Cost","Waitlist","Trend","Status",""].filter(Boolean).map(h=>(
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr></thead>
              <tbody>{kpis.map((p,i)=>(
                <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-700">{p.name}</td>
                  {isManager && <td className="px-3 py-2.5 text-slate-400 text-xs">{p.staff_name}</td>}
                  <td className="px-3 py-2.5 text-slate-500">{p.area}</td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{p.season} {p.year}</td>
                  <td className="px-3 py-2.5 font-mono">{fmt.pct(p.fillRate)}</td>
                  <td className="px-3 py-2.5 font-mono">{fmt.pct(p.costRecovery)}</td>
                  <td className={`px-3 py-2.5 font-mono font-semibold ${p.profitLoss>=0?"text-green-700":"text-red-600"}`}>{fmt.dollar(p.profitLoss)}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-500">{fmt.dollar(p.totalProgramCost)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.waitlist||0}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.trend}</td>
                  <td className="px-3 py-2.5"><Badge status={p.status}/></td>
                  <td className="px-3 py-2.5"><button onClick={()=>onEdit(p)} className="text-xs text-slate-400 hover:text-slate-700 font-medium">Edit</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : dashView==="variances" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-3 py-2 text-left font-semibold">Program</th>
                  <th className="px-3 py-2 text-center font-semibold" colSpan={3}>Enrollment</th>
                  <th className="px-3 py-2 text-center font-semibold border-l border-slate-200" colSpan={3}>Revenue</th>
                  <th className="px-3 py-2 text-center font-semibold border-l border-slate-200" colSpan={3}>Total Cost</th>
                  <th className="px-3 py-2 text-center font-semibold border-l border-slate-200" colSpan={3}>Cost Recovery</th>
                  <th className="px-3 py-2 text-center font-semibold border-l border-slate-200" colSpan={3}>Net Profit/(Loss)</th>
                </tr>
                <tr className="bg-slate-50 text-xs text-slate-300 uppercase">
                  <th className="px-3 py-1"/>
                  <th className="px-2 py-1 text-center">Bud.</th><th className="px-2 py-1 text-center">Actual</th><th className="px-2 py-1 text-center">Var.</th>
                  <th className="px-2 py-1 text-center border-l border-slate-200">Bud.</th><th className="px-2 py-1 text-center">Actual</th><th className="px-2 py-1 text-center">Var.</th>
                  <th className="px-2 py-1 text-center border-l border-slate-200">Bud.</th><th className="px-2 py-1 text-center">Actual</th><th className="px-2 py-1 text-center">Var.</th>
                  <th className="px-2 py-1 text-center border-l border-slate-200">Bud.</th><th className="px-2 py-1 text-center">Actual</th><th className="px-2 py-1 text-center">Var.</th>
                  <th className="px-2 py-1 text-center border-l border-slate-200">Bud.</th><th className="px-2 py-1 text-center">Actual</th><th className="px-2 py-1 text-center">Var.</th>
                </tr>
              </thead>
              <tbody>{kpis.map((p,i)=>(
                <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{p.name}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs">{p.ant_enrollment||0}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{p.act_enrollment||0}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${varColor(p.varEnrollment)}`}>{fmt.varNum(p.varEnrollment)}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{fmt.dollar(p.antRevenue)}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{fmt.dollar(p.revenue)}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${varColor(p.varRevenue)}`}>{fmt.varDollar(p.varRevenue)}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{fmt.dollar(p.antTotalCost)}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{fmt.dollar(p.totalProgramCost)}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${varColor(p.varCost,true)}`}>{fmt.varDollar(p.varCost)}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{fmt.pct(p.antCostRecovery)}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{fmt.pct(p.costRecovery)}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${varColor(p.varCostRecovery)}`}>{fmt.varPct(p.varCostRecovery)}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{fmt.dollar(p.antProfitLoss)}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{fmt.dollar(p.profitLoss)}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${varColor(p.varNetProfit)}`}>{fmt.varDollar(p.varNetProfit)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 space-y-5">{kpis.map(p=>(
            <div key={p.id} className="border border-slate-100 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div><div className="font-semibold text-slate-700">{p.name}</div><div className="text-xs text-slate-400">{p.area} · {p.season} {p.year}{p.staff_name?` · ${p.staff_name}`:""}</div></div>
                <Badge status={p.status}/>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ProgressBar label="Enrollment"   actual={p.act_enrollment||0}   anticipated={p.ant_enrollment||0}   formatFn={v=>v.toString()}/>
                <ProgressBar label="Revenue"      actual={p.revenue}              anticipated={p.antRevenue}          formatFn={v=>fmt.dollar(v)}/>
                <ProgressBar label="Total Cost"   actual={p.totalProgramCost}     anticipated={p.antTotalCost}        formatFn={v=>fmt.dollar(v)} invertGood/>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ProgressBar label="Cost Recovery"   actual={p.costRecovery*100}  anticipated={p.antCostRecovery*100} formatFn={v=>`${v.toFixed(1)}%`}/>
                <ProgressBar label="Net Profit/(Loss)" actual={p.profitLoss}      anticipated={p.antProfitLoss}       formatFn={v=>fmt.dollar(v)}/>
              </div>
            </div>
          ))}</div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-bold text-slate-700 text-sm mb-3">Status Guide</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3"><Badge status="Healthy"/><span className="text-slate-500">70%+ fill rate and 100%+ cost recovery</span></div>
          <div className="flex items-center gap-3"><Badge status="Monitor"/><span className="text-slate-500">60–69.9% fill rate or approaching targets</span></div>
          <div className="flex items-center gap-3"><Badge status="Needs Redesign"/><span className="text-slate-500">Below 60% fill rate or below 50% cost recovery</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── Duplicate Modal ──────────────────────────────────────────────────────────
function DuplicateModal({ program, onConfirm, onCancel }) {
  const nextSeason = { Spring:"Summer", Summer:"Fall", Fall:"Winter", Winter:"Spring" };
  const nextYear = s => s === "Winter" ? String(parseInt(program.year)+1) : program.year;
  const [season, setSeason] = useState(nextSeason[program.season] || "Summer");
  const [year, setYear]     = useState(nextYear(program.season));
  const [carryBudget, setCarryBudget] = useState(null); // null = not chosen yet

  const base = "w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-white transition";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.5)"}}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="text-base font-bold text-slate-800">Duplicate Program</div>
          <div className="text-sm text-slate-400 mt-0.5">Creating a copy of <span className="font-semibold text-slate-600">{program.name}</span></div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Season / Year */}
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">New Season</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Season</label>
                <select className={base} value={season} onChange={e=>setSeason(e.target.value)}>
                  {SEASONS.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Year</label>
                <select className={base} value={year} onChange={e=>setYear(e.target.value)}>
                  {YEARS.map(y=><option key={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Budget choice */}
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Budgeted Numbers</div>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${carryBudget===true?"border-blue-400 bg-blue-50":"border-slate-200 hover:border-slate-300"}`}
                onClick={()=>setCarryBudget(true)}>
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${carryBudget===true?"border-blue-500 bg-blue-500":"border-slate-300"}`}>
                  {carryBudget===true && <div className="w-1.5 h-1.5 rounded-full bg-white"/>}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-700">Carry over from previous season</div>
                  <div className="text-xs text-slate-400 mt-0.5">Pre-fill with the same budget — good starting point for recurring programs</div>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${carryBudget===false?"border-blue-400 bg-blue-50":"border-slate-200 hover:border-slate-300"}`}
                onClick={()=>setCarryBudget(false)}>
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${carryBudget===false?"border-blue-500 bg-blue-500":"border-slate-300"}`}>
                  {carryBudget===false && <div className="w-1.5 h-1.5 rounded-full bg-white"/>}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-700">Start fresh</div>
                  <div className="text-xs text-slate-400 mt-0.5">Clear budgeted numbers so you enter new estimates for this season</div>
                </div>
              </label>
            </div>
            <p className="text-xs text-slate-400 mt-3">Actuals always start empty on a duplicate.</p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
          <button
            disabled={carryBudget === null}
            onClick={()=>onConfirm({ season, year, carryBudget })}
            className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40 transition"
            style={{backgroundColor:"#1e3a5f"}}>
            Duplicate Program
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Program Form ─────────────────────────────────────────────────────────────
function ProgramForm({ initial, staffName, onSave, onDelete, onDuplicate, onCancel, saving }) {
  const [p, setP] = useState(initial || newProgram(staffName));
  const set = k => v => setP(prev=>({...prev,[k]:v}));
  const [section, setSection] = useState("info");
  const isNew = !initial;
  const canEdit = p.staff_name === staffName || !initial;
  const kpis = calcKPIs(p);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-700">{isNew?"Add Program":"Edit Program"}</h2>
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-600">← Back</button>
      </div>

      {!canEdit && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          This program was entered by <strong>{p.staff_name}</strong>. View only.
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {/* Section tabs */}
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {[{id:"info",label:"Program Info"},{id:"anticipated",label:"Budgeted"},{id:"actuals",label:"Actuals"},{id:"summary",label:"Summary"}].map(s=>(
            <button key={s.id} onClick={()=>setSection(s.id)}
              className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${section===s.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`}
              style={section===s.id?{borderColor:"#d4a017"}:{}}>{s.label}</button>
          ))}
        </div>

        <div className="p-5">
          {/* INFO */}
          {section==="info" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Program Name"      value={p.name}           onChange={set("name")}           required placeholder="e.g. Youth Basketball"/>
                <Input label="Staff Member"      value={p.staff_name}     onChange={set("staff_name")}     required placeholder="Your name"/>
                <Input label="Area"              value={p.area}           onChange={set("area")}           options={AREAS}/>
                <Input label="Season"            value={p.season}         onChange={set("season")}         options={SEASONS}/>
                <Input label="Year"              value={p.year}           onChange={set("year")}           options={YEARS}/>
                <Input label="Classification"    value={p.classification} onChange={set("classification")} options={CLASSIFICATIONS}/>
                <Input label="Service Category"  value={p.service_category||""} onChange={set("service_category")} options={["",...SERVICE_CATEGORIES]}/>
                <Input label="Participation Trend" value={p.trend}        onChange={set("trend")}          options={TRENDS}/>
                <Input label="NPS Score"         type="number" value={p.nps}      onChange={set("nps")}    min={0} max={100} hint="0–100"/>
                <Input label="Waitlist"          type="number" value={p.waitlist||0} onChange={set("waitlist")} min={0}/>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
                <textarea className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none" rows={3}
                  placeholder="Strategy notes, drivers, multi-year context..." value={p.notes||""}
                  onChange={e=>setP(prev=>({...prev,notes:e.target.value}))}/>
              </div>
            </div>
          )}

          {/* BUDGETED */}
          {section==="anticipated" && (
            <div>
              <div className="mb-5 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <div className="text-xs font-bold text-blue-600 uppercase tracking-widest">Budgeted</div>
                <div className="text-xs text-blue-400 mt-0.5">What you think this program will do. You can update these at any time.</div>
              </div>
              <CostBreakdown prefix="ant_" p={p} set={set}/>
            </div>
          )}

          {/* ACTUALS */}
          {section==="actuals" && (
            <div>
              <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Actuals</div>
                <div className="text-xs text-slate-400 mt-0.5">Update these as the program runs or after it concludes.</div>
              </div>
              <CostBreakdown prefix="act_" p={p} set={set}/>
            </div>
          )}

          {/* SUMMARY */}
          {section==="summary" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><div className="text-xs text-slate-400">Actual Fill Rate</div><div className="text-xl font-bold text-slate-700">{fmt.pct(kpis.fillRate)}</div></div>
                <div><div className="text-xs text-slate-400">Actual Cost Recovery</div><div className="text-xl font-bold text-slate-700">{fmt.pct(kpis.costRecovery)}</div></div>
                <div><div className="text-xs text-slate-400">Net Profit/(Loss)</div><div className={`text-xl font-bold ${kpis.profitLoss>=0?"text-green-700":"text-red-600"}`}>{fmt.dollar(kpis.profitLoss)}</div></div>
                <div><div className="text-xs text-slate-400">Status</div><div className="mt-1"><Badge status={kpis.status}/></div></div>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Variance vs Budget</div>
                <ProgressBar label="Enrollment"       actual={p.act_enrollment||0}    anticipated={p.ant_enrollment||0}    formatFn={v=>v.toString()}/>
                <ProgressBar label="Revenue"          actual={kpis.revenue}            anticipated={kpis.antRevenue}        formatFn={v=>fmt.dollar(v)}/>
                <ProgressBar label="Total Cost"       actual={kpis.totalProgramCost}   anticipated={kpis.antTotalCost}      formatFn={v=>fmt.dollar(v)} invertGood/>
                <ProgressBar label="Cost Recovery"    actual={kpis.costRecovery*100}   anticipated={kpis.antCostRecovery*100} formatFn={v=>`${v.toFixed(1)}%`}/>
                <ProgressBar label="Net Profit/(Loss)" actual={kpis.profitLoss}        anticipated={kpis.antProfitLoss}     formatFn={v=>fmt.dollar(v)}/>
              </div>

              <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[
                  ["Enrollment",      fmt.varNum(kpis.varEnrollment),   varColor(kpis.varEnrollment)],
                  ["Revenue",         fmt.varDollar(kpis.varRevenue),   varColor(kpis.varRevenue)],
                  ["Total Cost",      fmt.varDollar(kpis.varCost),      varColor(kpis.varCost,true)],
                  ["Fill Rate",       fmt.varPct(kpis.varFillRate),     varColor(kpis.varFillRate)],
                  ["Cost Recovery",   fmt.varPct(kpis.varCostRecovery), varColor(kpis.varCostRecovery)],
                  ["Net Profit/(Loss)",fmt.varDollar(kpis.varNetProfit),varColor(kpis.varNetProfit)],
                ].map(([label,val,cls])=>(
                  <div key={label}><div className="text-xs text-slate-400">{label}</div><div className={`text-base font-bold ${cls}`}>{val}</div></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="flex gap-3 justify-between">
          <div className="flex gap-2">
            {!isNew && <button onClick={()=>onDelete(p.id)} className="px-4 py-2 text-sm text-red-500 hover:text-red-700 font-medium">Delete</button>}
            {!isNew && <button onClick={()=>onDuplicate(p)} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded hover:bg-slate-50 font-medium">⧉ Duplicate</button>}
          </div>
          <div className="flex gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded">Cancel</button>
            <button onClick={()=>onSave(p)} disabled={!p.name||saving}
              className="px-5 py-2 text-sm font-semibold text-white rounded disabled:opacity-40"
              style={{backgroundColor:"#1e3a5f"}}>{saving?"Saving...":isNew?"Save Program":"Update Program"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cost Recovery Tab ────────────────────────────────────────────────────────
function CostRecoveryView({ programs, costRecords, onSave }) {
  const [selectedId, setSelectedId] = useState(programs[0]?.id||"");
  const [cr, setCR] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(()=>{
    if(!selectedId) return;
    const existing = costRecords.find(r=>r.program_id===selectedId);
    setCR(existing ? {...existing} : {
      program_id:selectedId, season:"Summer", service_category:"", program_type:"",
      custom_workload:"", facility_hours:0, revenue:0,
      personnel:0, commodities:0, contractuals:0, other1:0, other2:0, notes:""
    });
  },[selectedId,costRecords]);

  const set = k => v => setCR(prev=>({...prev,[k]:v}));
  const prog = programs.find(p=>p.id===selectedId);
  const calc = cr ? (()=>{
    const workloadPct = cr.program_type && cr.program_type!=="Custom"
      ? (PROGRAM_TYPES.find(t=>t.label===cr.program_type)?.pct||0)
      : (parseFloat(cr.custom_workload)||0)/100;
    const d=(cr.personnel||0)+(cr.commodities||0)+(cr.contractuals||0)+(cr.other1||0)+(cr.other2||0);
    const ao=d*ADMIN_OVERHEAD_RATE, af=FT_ANNUAL_SALARY*workloadPct, afac=FACILITY_COST_PER_HOUR*(cr.facility_hours||0);
    const total=d+ao+af+afac, rev=cr.revenue||0;
    return{directTotal:d,adminOverhead:ao,allocatedFTStaff:af,allocatedFacility:afac,totalProgramCost:total,totalRevenue:rev,costRecoveryPct:total>0?rev/total:0,subsidyPct:1-(total>0?rev/total:0),netProfit:rev-total};
  })() : null;

  const handleSave = async () => { await onSave(cr); setSaved(true); setTimeout(()=>setSaved(false),2000); };
  if(programs.length===0) return <div className="text-center py-16 text-slate-400 text-sm">Add programs first.</div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Select Program</div>
        <select className="w-full rounded border border-slate-200 px-3 py-2 text-sm bg-white" value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
          {programs.map(p=><option key={p.id} value={p.id}>{p.name} – {p.season} {p.year}{p.staff_name?` (${p.staff_name})`:""}</option>)}
        </select>
        {prog && <div className="mt-2 text-xs text-slate-400">{prog.area} · {prog.classification}</div>}
      </div>
      {cr && (<>
        <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Program Info</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Service Category" value={cr.service_category||""} onChange={set("service_category")} options={["",...SERVICE_CATEGORIES]}/>
            <Input label="Season / Session"  value={cr.season||"Summer"}    onChange={set("season")}           options={SEASONS}/>
            <Input label="Total Revenue ($)" type="number" value={cr.revenue||0}         onChange={set("revenue")}         min={0}/>
            <Input label="Facility Hours"    type="number" value={cr.facility_hours||0}   onChange={set("facility_hours")}   min={0}/>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Direct Costs</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Personnel ($)"          type="number" value={cr.personnel||0}    onChange={set("personnel")}    min={0}/>
            <Input label="Commodities ($)"        type="number" value={cr.commodities||0}  onChange={set("commodities")}  min={0}/>
            <Input label="Contractuals ($)"       type="number" value={cr.contractuals||0} onChange={set("contractuals")} min={0}/>
            <Input label="Other Direct Costs ($)" type="number" value={cr.other1||0}       onChange={set("other1")}       min={0}/>
            <Input label="Other Direct Costs 2 ($)"type="number" value={cr.other2||0}      onChange={set("other2")}       min={0}/>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 space-y-4">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Staff Workload</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Program Type" value={cr.program_type||""} onChange={set("program_type")} options={["Custom",...PROGRAM_TYPES.map(t=>t.label)]}/>
            {(!cr.program_type||cr.program_type==="Custom")
              ? <Input label="Custom Workload %" type="number" value={cr.custom_workload||""} onChange={set("custom_workload")} min={0} max={100} hint="% of FT staff time"/>
              : <div className="flex flex-col gap-1 justify-center"><label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Workload %</label><div className="text-lg font-bold text-slate-700">{((PROGRAM_TYPES.find(t=>t.label===cr.program_type)?.pct||0)*100).toFixed(1)}%</div></div>
            }
          </div>
        </div>
        {calc && (
          <div className="bg-slate-800 rounded-lg p-5 text-white space-y-3">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Results (Auto-Calculated)</div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div><div className="text-xs text-slate-400">Direct Costs</div><div className="text-base font-bold">{fmt.dollar(calc.directTotal)}</div></div>
              <div><div className="text-xs text-slate-400">Admin Overhead (10%)</div><div className="text-base font-bold">{fmt.dollar(calc.adminOverhead)}</div></div>
              <div><div className="text-xs text-slate-400">Allocated FT Staff</div><div className="text-base font-bold">{fmt.dollar(calc.allocatedFTStaff)}</div></div>
              <div><div className="text-xs text-slate-400">Allocated Facility</div><div className="text-base font-bold">{fmt.dollar(calc.allocatedFacility)}</div></div>
              <div><div className="text-xs text-slate-400">Total Program Cost</div><div className="text-base font-bold">{fmt.dollar(calc.totalProgramCost)}</div></div>
              <div><div className="text-xs text-slate-400">Total Revenue</div><div className="text-base font-bold">{fmt.dollar(calc.totalRevenue)}</div></div>
            </div>
            <div className="border-t border-slate-600 pt-3 grid grid-cols-3 gap-4">
              <div><div className="text-xs text-slate-400">Cost Recovery</div><div className={`text-2xl font-black ${calc.costRecoveryPct>=1?"text-green-400":"text-amber-400"}`}>{fmt.pct(calc.costRecoveryPct)}</div></div>
              <div><div className="text-xs text-slate-400">Subsidy</div><div className="text-2xl font-black text-slate-200">{fmt.pct(Math.max(0,calc.subsidyPct))}</div></div>
              <div><div className="text-xs text-slate-400">Net Profit/(Loss)</div><div className={`text-2xl font-black ${calc.netProfit>=0?"text-green-400":"text-red-400"}`}>{fmt.dollar(calc.netProfit)}</div></div>
            </div>
          </div>
        )}
        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Notes / Drivers / Multi-Year Strategy</div>
          <textarea className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none" rows={3}
            placeholder="What's driving costs or revenue?" value={cr.notes||""} onChange={e=>setCR(prev=>({...prev,notes:e.target.value}))}/>
        </div>
        <div className="flex justify-end">
          <button onClick={handleSave} className="px-5 py-2 text-sm font-semibold text-white rounded transition"
            style={{backgroundColor:saved?"#22c55e":"#1e3a5f"}}>{saved?"✓ Saved!":"Save Worksheet"}</button>
        </div>
      </>)}
    </div>
  );
}

// ─── Reference Tab ────────────────────────────────────────────────────────────
function Reference() {
  const [section, setSection] = useState("standards");

  const tiers=[
    {label:"Tier 1 – Always Tracked",color:"#1e3a5f",items:[{m:"Fill Rate",d:"Percent of available spots filled",w:"Quarterly"},{m:"Cost Recovery",d:"Revenue divided by total program cost",w:"Quarterly"},{m:"Net Profit / (Loss)",d:"Revenue minus total program cost",w:"Quarterly"},{m:"Participation Trend",d:"Growing, stable, or declining over time",w:"Quarterly"},{m:"Status",d:"Healthy, Monitor, or Needs Redesign",w:"Quarterly"}]},
    {label:"Tier 2 – Participation",color:"#d4a017",items:[{m:"Total Enrollment",d:"Number of registered participants",w:"As needed"},{m:"Waitlist Volume",d:"Demand beyond capacity",w:"As needed"},{m:"Waitlist Conversion Rate",d:"Percent of waitlisted who enroll",w:"As needed"},{m:"Retention Rate",d:"Percent who return to a future session",w:"As needed"},{m:"Cancellation Rate",d:"Registrants who drop before start",w:"As needed"}]},
    {label:"Tier 2 – Financial",color:"#d4a017",items:[{m:"Margin %",d:"Surplus divided by revenue",w:"As needed"},{m:"Revenue per Participant",d:"Revenue divided by enrolled participants",w:"As needed"},{m:"Revenue per Program Hour",d:"Revenue earned per scheduled hour",w:"As needed"},{m:"Direct Cost per Participant",d:"Direct costs divided by enrollment",w:"As needed"}]},
    {label:"Tier 2 – Operational / Space",color:"#d4a017",items:[{m:"Participant to Staff Ratio",d:"Enrollment relative to staffing",w:"As needed"},{m:"Facility Utilization Rate",d:"Extent to which a space is booked or used",w:"As needed"},{m:"Prime Time Usage Rate",d:"Use during high demand periods",w:"As needed"},{m:"Revenue per Facility Hour",d:"Financial productivity of space",w:"As needed"}]},
    {label:"Tier 2 – Quality / Innovation",color:"#d4a017",items:[{m:"NPS",d:"Likelihood participants recommend the program",w:"As needed"},{m:"Participant Satisfaction",d:"Program quality score",w:"As needed"},{m:"Pilot Success Rate",d:"Pilot met participation and financial targets",w:"As needed"},{m:"New Program Retention Rate",d:"Whether pilots continue or return",w:"As needed"}]},
  ];

  const workload = [
    {activity:"Program planning & management", pct:"45–50%"},
    {activity:"Meetings / admin",              pct:"20–25%"},
    {activity:"Marketing / outreach",          pct:"10–15%"},
    {activity:"Strategic work / projects",     pct:"10–15%"},
  ];

  const serviceTargets = [
    {cat:"Open Access",                      target:"100% Subsidy",          bg:"#fee2e2", text:"#991b1b"},
    {cat:"Community Events",                 target:"80–100% Subsidy",       bg:"#fee2e2", text:"#991b1b"},
    {cat:"Specialty Events",                 target:"0–5% Subsidy",          bg:"#fef9c3", text:"#854d0e"},
    {cat:"Beg. / Intro. Activities",         target:"100% Cost Recovery",    bg:"#dcfce7", text:"#166534"},
    {cat:"Drop In Activities",               target:"100–105% Cost Recovery",bg:"#dcfce7", text:"#166534"},
    {cat:"Childcare Services",               target:"110–130% Cost Recovery",bg:"#d1fae5", text:"#065f46"},
    {cat:"Intermediate / Adv. Activities",   target:"110–130% Cost Recovery",bg:"#d1fae5", text:"#065f46"},
    {cat:"Private / Semi-Private Activities",target:"130–150% Cost Recovery",bg:"#a7f3d0", text:"#064e3b"},
    {cat:"Specialized Activities",           target:"130–150% Cost Recovery",bg:"#a7f3d0", text:"#064e3b"},
    {cat:"Rentals",                          target:"130–150% Cost Recovery",bg:"#a7f3d0", text:"#064e3b"},
    {cat:"Retail & Consumables",             target:"130–150% Cost Recovery",bg:"#a7f3d0", text:"#064e3b"},
  ];

  return (
    <div className="space-y-5">
      {/* Sub-nav */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {[{id:"standards",label:"District Standards"},{id:"kpis",label:"KPI Menu"}].map(s=>(
            <button key={s.id} onClick={()=>setSection(s.id)}
              className={`px-5 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${section===s.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`}
              style={section===s.id?{borderColor:"#d4a017"}:{}}>{s.label}</button>
          ))}
        </div>

        {/* ── District Standards ── */}
        {section==="standards" && (
          <div className="p-5 space-y-8">
            <p className="text-sm text-slate-500">These are the district's standard assumption numbers to use when building cost recovery worksheets. Use them consistently across all programs for apples-to-apples comparison.</p>

            {/* Assumption number cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #1e3a5f"}}>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Facility Overhead</div>
                <div className="text-3xl font-black text-slate-800">$3<span className="text-lg font-semibold text-slate-400">/hr</span></div>
                <div className="text-xs text-slate-400">Applied to all facility hours used by a program</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #d4a017"}}>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Annual FT Staff Compensation</div>
                <div className="text-3xl font-black text-slate-800">$97,700</div>
                <div className="text-xs text-slate-400">Salary + benefits — used to calculate workload allocation</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #64748b"}}>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Admin Overhead Rate</div>
                <div className="text-3xl font-black text-slate-800">10%</div>
                <div className="text-xs text-slate-400">Applied to total direct costs of each program</div>
              </div>
            </div>

            {/* Staff Workload Allocation */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:"#1e3a5f"}}>Staff Workload Allocation — How FT Time Is Distributed</div>
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left font-semibold">Activity</th>
                  <th className="px-4 py-2 text-left font-semibold">% of Time</th>
                </tr></thead>
                <tbody>{workload.map((row,i)=>(
                  <tr key={row.activity} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                    <td className="px-4 py-3 font-semibold text-slate-700">{row.activity}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block bg-slate-100 text-slate-600 font-mono font-semibold text-xs px-2.5 py-1 rounded">{row.pct}</span>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
                The remaining time (program delivery itself) is accounted for in the per-program workload % you assign in cost worksheets.
              </div>
            </div>

            {/* Service Category Cost Recovery Targets */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:"#d4a017",color:"#1e3a5f"}}>Service Category Cost Recovery / Subsidy Targets</div>
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left font-semibold">Service Category</th>
                  <th className="px-4 py-2 text-left font-semibold">Target</th>
                </tr></thead>
                <tbody>{serviceTargets.map((row,i)=>(
                  <tr key={row.cat} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                    <td className="px-4 py-3 font-semibold text-slate-700">{row.cat}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold" style={{background:row.bg,color:row.text}}>{row.target}</span>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── KPI Menu ── */}
        {section==="kpis" && (
          <div className="p-5 space-y-5">
            <p className="text-sm text-slate-500">Use Tier 1 metrics quarterly. Use Tier 2 metrics when a program needs a deeper review.</p>
            {tiers.map(tier=>(
              <div key={tier.label} className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:tier.color}}>{tier.label}</div>
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-2 text-left">Metric</th><th className="px-4 py-2 text-left">Definition</th><th className="px-4 py-2 text-left">When to Use</th>
                  </tr></thead>
                  <tbody>{tier.items.map((item,i)=>(
                    <tr key={item.m} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                      <td className="px-4 py-2.5 font-semibold text-slate-700">{item.m}</td>
                      <td className="px-4 py-2.5 text-slate-500">{item.d}</td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{item.w}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
const MANAGER_NAMES = ["admin","manager","joe zimmermann"];

export default function App() {
  const [tab, setTab]                   = useState("dashboard");
  const [programs, setPrograms]         = useState([]);
  const [costRecords, setCostRecords]   = useState([]);
  const [editingProgram, setEditingProgram] = useState(null);
  const [addingProgram, setAddingProgram]   = useState(false);
  const [duplicatingProgram, setDuplicatingProgram] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState(null);
  const [staffName, setStaffName]       = useState(()=>localStorage.getItem("bgpd_staff_name")||"");
  const isManager = MANAGER_NAMES.includes(staffName.toLowerCase().trim());

  const fetchAll = useCallback(async()=>{
    setLoading(true);
    const [{data:p},{data:c}] = await Promise.all([
      supabase.from("programs").select("*").order("created_at",{ascending:false}),
      supabase.from("cost_records").select("*")
    ]);
    setPrograms(p||[]); setCostRecords(c||[]); setLoading(false);
  },[]);

  useEffect(()=>{if(staffName)fetchAll();else setLoading(false);},[staffName,fetchAll]);

  const handleConfirmName = name => { localStorage.setItem("bgpd_staff_name",name); setStaffName(name); };

  const handleSaveProgram = async p => {
    setSaving(true); setError(null);
    try {
      if(p.id){const{error:e}=await supabase.from("programs").update(p).eq("id",p.id);if(e)throw e;}
      else{const{error:e}=await supabase.from("programs").insert(p);if(e)throw e;}
      await fetchAll(); setEditingProgram(null); setAddingProgram(false); setTab("dashboard");
    } catch(e){ setError("Failed to save. Please try again."); }
    setSaving(false);
  };

  const handleDeleteProgram = async id => {
    setSaving(true);
    await supabase.from("programs").delete().eq("id",id);
    await supabase.from("cost_records").delete().eq("program_id",id);
    await fetchAll(); setEditingProgram(null); setTab("dashboard"); setSaving(false);
  };

  const handleDuplicate = async (source, { season, year, carryBudget }) => {
    setSaving(true); setError(null);
    const blank = { act_capacity:0, act_enrollment:0, act_revenue:0, act_personnel:0, act_commodities:0, act_contractuals:0, act_other1:0, act_other2:0, act_facility_hours:0, act_program_type:"", act_custom_workload:0 };
    const budgetFields = carryBudget ? {} : { ant_capacity:0, ant_enrollment:0, ant_revenue:0, ant_personnel:0, ant_commodities:0, ant_contractuals:0, ant_other1:0, ant_other2:0, ant_facility_hours:0, ant_program_type:"", ant_custom_workload:0 };
    const { id, created_at, ...rest } = source;
    const duped = { ...rest, ...blank, ...budgetFields, season, year };
    try {
      const { error:e } = await supabase.from("programs").insert(duped);
      if (e) throw e;
      await fetchAll();
      setDuplicatingProgram(null); setEditingProgram(null); setAddingProgram(false); setTab("programs");
    } catch(e) { setError("Failed to duplicate. Please try again."); }
    setSaving(false);
  };
  const handleSaveCR = async cr => {
    const exists = costRecords.find(r=>r.program_id===cr.program_id);
    if(exists){await supabase.from("cost_records").update(cr).eq("program_id",cr.program_id);}
    else{await supabase.from("cost_records").insert(cr);}
    await fetchAll();
  };

  const tabs = [{id:"dashboard",label:"Dashboard"},{id:"programs",label:"Programs"},{id:"cost",label:"Cost Recovery"},{id:"kpi",label:"Reference"}];
  const showingForm = editingProgram || addingProgram;

  if(!staffName) return <StaffSetup onConfirm={handleConfirmName}/>;

  return (
    <div className="min-h-screen" style={{background:"#f1f5f9"}}>
      {/* Duplicate modal — rendered above everything */}
      {duplicatingProgram && (
        <DuplicateModal
          program={duplicatingProgram}
          onConfirm={opts=>handleDuplicate(duplicatingProgram, opts)}
          onCancel={()=>setDuplicatingProgram(null)}
        />
      )}
      <header style={{backgroundColor:"#1e3a5f"}} className="px-4 py-4 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-lg leading-tight">BGPD Recreation</div>
            <div style={{color:"#d4a017"}} className="text-xs font-semibold tracking-widest uppercase">{staffName}{isManager?" · Manager View":""}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>{setAddingProgram(true);setEditingProgram(null);setTab("programs");}} className="text-xs font-bold px-3 py-2 rounded transition" style={{backgroundColor:"#d4a017",color:"#1e3a5f"}}>+ Add Program</button>
            <button onClick={()=>{localStorage.removeItem("bgpd_staff_name");setStaffName("");}} className="text-xs text-slate-300 hover:text-white px-2 py-2 transition" title="Switch user">⇄</button>
          </div>
        </div>
      </header>
      <nav className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto flex gap-1 px-4 overflow-x-auto">
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>{setTab(t.id);setEditingProgram(null);setAddingProgram(false);}}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${tab===t.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`}
              style={tab===t.id?{borderColor:"#d4a017",borderBottomWidth:"2px"}:{}}>{t.label}</button>
          ))}
        </div>
      </nav>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (<div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex justify-between">{error}<button onClick={()=>setError(null)} className="font-bold">✕</button></div>)}
        {loading ? (<div className="text-center py-20 text-slate-400">Loading programs...</div>) : (
          <>
            {tab==="dashboard"&&!showingForm&&(<Dashboard programs={programs} staffName={staffName} isManager={isManager} onEdit={p=>{setEditingProgram(p);setTab("programs");}} onAddProgram={()=>{setAddingProgram(true);setTab("programs");}}/>)}
            {tab==="programs"&&!showingForm&&(
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-slate-700">All Programs ({programs.length})</h2>
                  <button onClick={()=>setAddingProgram(true)} className="text-xs font-bold px-3 py-2 rounded text-white" style={{backgroundColor:"#1e3a5f"}}>+ Add Program</button>
                </div>
                {programs.length===0 ? (<div className="bg-white rounded-lg shadow-sm p-12 text-center text-slate-400 text-sm">No programs yet.</div>) : (
                  <div className="space-y-2">{programs.map(p=>{
                    const k=calcKPIs(p);
                    return(
                      <div key={p.id} className="bg-white rounded-lg shadow-sm px-4 py-3 flex items-center justify-between gap-4 hover:shadow-md transition cursor-pointer" onClick={()=>setEditingProgram(p)}>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-700 truncate">{p.name}</div>
                          <div className="text-xs text-slate-400">{p.area} · {p.season} {p.year} · {p.staff_name}</div>
                        </div>
                        <div className="hidden sm:flex gap-6 text-sm">
                          <div className="text-center"><div className="text-xs text-slate-400">Fill</div><div className="font-mono font-semibold">{fmt.pct(k.fillRate)}</div></div>
                          <div className="text-center"><div className="text-xs text-slate-400">Recovery</div><div className="font-mono font-semibold">{fmt.pct(k.costRecovery)}</div></div>
                          <div className="text-center"><div className="text-xs text-slate-400">Net P/(L)</div><div className={`font-mono font-semibold ${k.profitLoss>=0?"text-green-700":"text-red-600"}`}>{fmt.dollar(k.profitLoss)}</div></div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={e=>{e.stopPropagation();setDuplicatingProgram(p);}} className="text-xs text-slate-400 hover:text-slate-700 font-medium px-2 py-1 rounded hover:bg-slate-100 transition" title="Duplicate">⧉</button>
                          <Badge status={k.status}/>
                        </div>
                      </div>
                    );
                  })}</div>
                )}
              </div>
            )}
            {tab==="programs"&&showingForm&&(<ProgramForm initial={editingProgram||null} staffName={staffName} onSave={handleSaveProgram} onDelete={handleDeleteProgram} onDuplicate={p=>setDuplicatingProgram(p)} onCancel={()=>{setEditingProgram(null);setAddingProgram(false);}} saving={saving}/>)}
            {tab==="cost"&&<CostRecoveryView programs={programs} costRecords={costRecords} onSave={handleSaveCR}/>}
            {tab==="kpi"&&<Reference/>}
          </>
        )}
      </main>
    </div>
  );
}
