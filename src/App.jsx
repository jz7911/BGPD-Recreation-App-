import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const AREAS = ["Adult General","Adult Sports","Aquatics","Camps","Dance","Fitness","Golf Dome","Museum","Performing Arts","Seniors","Special Events","Youth General","Youth Sports","Other"];
const SEASONS = ["Spring","Summer","Fall","Winter","All Year"];
const YEARS = ["2025","2026","2027","2028","2029","2030"];
const CLASSIFICATIONS = ["Community Driven","Revenue Driven","Both"];
const TRENDS = ["Growing","Stable","Declining"];
const SERVICE_CATEGORIES = [
  "Open Access","Community Events","Specialty Events","Beg./Intro. Activities",
  "Drop In Activities","Childcare Services","Intermediate/Adv. Activities",
  "Private/Semi-Private Activities","Specialized Activities","Rentals","Retail & Consumables",
];
const PROGRAM_TYPES = [
  {label:"Small Contractual Program", pct:0.005},
  {label:"Large Contractual Program",  pct:0.01},
  {label:"Drop-In Program",            pct:0.02},
  {label:"Small Event",                pct:0.03},
  {label:"Small Program",              pct:0.04},
  {label:"Large Event",                pct:0.05},
  {label:"Large Program",              pct:0.06},
  {label:"League",                     pct:0.07},
  {label:"Camp",                       pct:0.1},
  {label:"Production / Major Program", pct:0.12},
];
const ADMIN_OVERHEAD_RATE  = 0.1;
const FT_ANNUAL_SALARY     = 97700;
const FACILITY_COST_PER_HR = 3;
const MANAGER_NAMES        = ["admin","manager"];

// ─── DB columns (the ONLY fields sent to Supabase) ───────────────────────────
const DB_FIELDS = [
  "id","created_at",
  "name","area","season","year","classification","service_category",
  "trend","nps","notes","staff_name","waitlist",
  "ant_capacity","ant_enrollment","ant_revenue",
  "ant_personnel","ant_commodities","ant_contractuals",
  "ant_other1","ant_other2","ant_facility_hours",
  "ant_program_type","ant_custom_workload",
  "act_capacity","act_enrollment","act_revenue",
  "act_personnel","act_commodities","act_contractuals",
  "act_other1","act_other2","act_facility_hours",
  "act_program_type","act_custom_workload",
];

function cleanForDB(p) {
  const out = {};
  for (const key of DB_FIELDS) {
    if (key in p) out[key] = p[key];
  }
  return out;
}

// ─── Calculations ─────────────────────────────────────────────────────────────
function calcCR(p, px) {
  const personnel    = p[px+"personnel"]      || 0;
  const commodities  = p[px+"commodities"]    || 0;
  const contractuals = p[px+"contractuals"]   || 0;
  const other1       = p[px+"other1"]         || 0;
  const other2       = p[px+"other2"]         || 0;
  const facHrs       = p[px+"facility_hours"] || 0;
  const progType     = p[px+"program_type"]   || "";
  const customWL     = p[px+"custom_workload"]|| 0;
  const revenue      = p[px+"revenue"]        || 0;
  const enrollment   = p[px+"enrollment"]     || 0;
  const capacity     = p[px+"capacity"]       || 0;
  const wlPct = progType && progType !== "Custom"
    ? (PROGRAM_TYPES.find(t => t.label === progType)?.pct || 0)
    : (parseFloat(customWL) || 0) / 100;
  const direct   = personnel + commodities + contractuals + other1 + other2;
  const ao       = direct * ADMIN_OVERHEAD_RATE;
  const ftStaff  = FT_ANNUAL_SALARY * wlPct;
  const facility = FACILITY_COST_PER_HR * facHrs;
  const total    = direct + ao + ftStaff + facility;
  return {
    direct, ao, ftStaff, facility, total, revenue,
    crPct:    total > 0 ? revenue / total : 0,
    subPct:   1 - (total > 0 ? revenue / total : 0),
    profit:   revenue - total,
    fillRate: capacity > 0 ? enrollment / capacity : 0,
    enrollment, capacity,
  };
}

function calcKPIs(p) {
  const a = calcCR(p, "ant_");
  const b = calcCR(p, "act_");
  let status = "Monitor";
  if (b.fillRate >= 0.7 && b.crPct >= 1.0)    status = "Healthy";
  else if (b.fillRate < 0.6 || b.crPct < 0.5) status = "Needs Redesign";
  return {
    fillRate: b.fillRate, costRecovery: b.crPct,
    profitLoss: b.profit, totalCost: b.total, revenue: b.revenue, status,
    antFillRate: a.fillRate, antCR: a.crPct, antProfit: a.profit,
    antTotal: a.total, antRevenue: a.revenue,
    varEnr:    b.enrollment - a.enrollment,
    varRev:    b.revenue    - a.revenue,
    varCost:   b.total      - a.total,
    varFill:   b.fillRate   - a.fillRate,
    varCR:     b.crPct      - a.crPct,
    varProfit: b.profit     - a.profit,
  };
}

function newProgram(staffName) {
  return {
    name:"", area:"Youth Sports", season:"Summer", year:"2026",
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

// ─── Formatters ───────────────────────────────────────────────────────────────
const pct     = v => `${((v||0)*100).toFixed(1)}%`;
const dollar  = v => (v||0)<0 ? `($${Math.abs(Math.round(v||0)).toLocaleString()})` : `$${Math.round(v||0).toLocaleString()}`;
const vDollar = v => v>0 ? `+$${Math.round(v).toLocaleString()}` : v<0 ? `($${Math.abs(Math.round(v)).toLocaleString()})` : "$0";
const vNum    = v => v>0 ? `+${v}` : `${v}`;
const vPct    = v => v>0 ? `+${(v*100).toFixed(1)}%` : `${(v*100).toFixed(1)}%`;
const vc      = (v, inv) => !v||v===0 ? "text-slate-400" : (inv?v<0:v>0) ? "text-green-600 font-semibold" : "text-red-500 font-semibold";

function sColor(s) {
  if (s==="Healthy") return {bg:"#dcfce7",text:"#166534",dot:"#22c55e"};
  if (s==="Monitor") return {bg:"#fef9c3",text:"#854d0e",dot:"#eab308"};
  return                    {bg:"#fee2e2",text:"#991b1b",dot:"#ef4444"};
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function Badge({status}) {
  const c = sColor(status);
  return (
    <span style={{background:c.bg,color:c.text}} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap">
      <span style={{background:c.dot}} className="w-1.5 h-1.5 rounded-full inline-block"/>{status}
    </span>
  );
}

function KCard({label,value,sub,accent}) {
  return (
    <div style={{borderTop:`3px solid ${accent||"#1e3a5f"}`}} className="bg-white rounded-lg p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function PBar({label,actual,budget,ff,inv}) {
  const p    = budget>0 ? Math.min((actual/budget)*100,150) : 0;
  const v    = actual - budget;
  const good = inv ? v<=0 : v>=0;
  const bc   = p>=100 ? (inv?"#ef4444":"#22c55e") : p>=75 ? "#eab308" : "#ef4444";
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
        <span className={`text-xs font-bold ${good?"text-green-600":"text-red-500"}`}>{v>=0?"+":""}{ff?ff(v):v}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{width:`${Math.min(p,100)}%`,backgroundColor:bc}}/>
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>Actual: <span className="font-semibold text-slate-600">{ff?ff(actual):actual}</span></span>
        <span>Budget: <span className="font-semibold text-slate-600">{ff?ff(budget):budget}</span></span>
      </div>
    </div>
  );
}

function Inp({label,type="text",value,onChange,options,min,max,hint,placeholder,required}) {
  const cls = "w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-blue-400 bg-white transition";
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        {label}{required&&<span className="text-amber-500 ml-0.5">*</span>}
      </label>
      {options
        ? <select className={cls} value={value||""} onChange={e=>onChange(e.target.value)}>
            {options.map(o=><option key={o} value={o}>{o}</option>)}
          </select>
        : <input className={cls} type={type} value={value||""} min={min} max={max}
            placeholder={placeholder||""}
            onChange={e=>onChange(type==="number"?parseFloat(e.target.value)||0:e.target.value)}/>
      }
      {hint&&<span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

// ─── Cost Breakdown Panel ─────────────────────────────────────────────────────
function CostPanel({px,p,set}) {
  const isAnt = px==="ant_";
  const c   = calcCR(p, px);
  const lc  = isAnt ? "text-blue-500"  : "text-slate-500";
  const vc2 = isAnt ? "text-blue-700"  : "text-slate-700";
  const rBg = isAnt ? "#eff6ff" : "#f8fafc";
  const rBd = isAnt ? "#bfdbfe" : "#e2e8f0";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Inp label="Capacity"    type="number" value={p[px+"capacity"]}   onChange={set(px+"capacity")}   min={0}/>
        <Inp label="Enrollment"  type="number" value={p[px+"enrollment"]} onChange={set(px+"enrollment")} min={0}/>
        <Inp label="Revenue ($)" type="number" value={p[px+"revenue"]}    onChange={set(px+"revenue")}    min={0}/>
      </div>
      <div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Direct Costs</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Inp label="Personnel ($)"             type="number" value={p[px+"personnel"]}      onChange={set(px+"personnel")}      min={0}/>
          <Inp label="Commodities ($)"           type="number" value={p[px+"commodities"]}    onChange={set(px+"commodities")}    min={0}/>
          <Inp label="Contractuals ($)"          type="number" value={p[px+"contractuals"]}   onChange={set(px+"contractuals")}   min={0}/>
          <Inp label="Other Direct Costs ($)"    type="number" value={p[px+"other1"]}         onChange={set(px+"other1")}         min={0}/>
          <Inp label="Other Direct Costs 2 ($)"  type="number" value={p[px+"other2"]}         onChange={set(px+"other2")}         min={0}/>
          <Inp label="Facility Hours"            type="number" value={p[px+"facility_hours"]} onChange={set(px+"facility_hours")} min={0} hint={"$"+FACILITY_COST_PER_HR+"/hr allocated"}/>
        </div>
      </div>
      <div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Staff Workload</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Inp label="Program Type" value={p[px+"program_type"]||"Custom"} onChange={set(px+"program_type")} options={["Custom",...PROGRAM_TYPES.map(t=>t.label)]}/>
          {(!p[px+"program_type"]||p[px+"program_type"]==="Custom")
            ? <Inp label="Custom Workload %" type="number" value={p[px+"custom_workload"]} onChange={set(px+"custom_workload")} min={0} max={100} hint="% of FT staff time"/>
            : <div className="flex flex-col gap-1 justify-center">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Workload %</label>
                <div className="text-lg font-bold text-slate-700">{((PROGRAM_TYPES.find(t=>t.label===p[px+"program_type"])?.pct||0)*100).toFixed(1)}%</div>
              </div>
          }
        </div>
      </div>
      <div className="rounded-lg p-4 space-y-3" style={{background:rBg,border:`1px solid ${rBd}`}}>
        <div className="text-xs font-bold uppercase tracking-widest" style={{color:isAnt?"#2563eb":"#64748b"}}>Calculated Results</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
          {[["Direct Costs",dollar(c.direct)],["Admin Overhead (10%)",dollar(c.ao)],["Allocated FT Staff",dollar(c.ftStaff)],
            ["Allocated Facility",dollar(c.facility)],["Total Program Cost",dollar(c.total)],["Fill Rate",pct(c.fillRate)]].map(([l,v])=>(
            <div key={l}><div className={`text-xs ${lc}`}>{l}</div><div className={`font-bold ${vc2}`}>{v}</div></div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 pt-3" style={{borderTop:`1px solid ${rBd}`}}>
          <div><div className={`text-xs ${lc}`}>Cost Recovery</div><div className={`text-xl font-black ${c.crPct>=1?"text-green-600":"text-amber-500"}`}>{pct(c.crPct)}</div></div>
          <div><div className={`text-xs ${lc}`}>Subsidy</div><div className={`text-xl font-black ${vc2}`}>{pct(Math.max(0,c.subPct))}</div></div>
          <div><div className={`text-xs ${lc}`}>Net Profit/(Loss)</div><div className={`text-xl font-black ${c.profit>=0?"text-green-600":"text-red-500"}`}>{dollar(c.profit)}</div></div>
        </div>
      </div>
    </div>
  );
}

// ─── Staff Setup ──────────────────────────────────────────────────────────────
function StaffSetup({onConfirm}) {
  const [name,setName] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{background:"#f1f5f9"}}>
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-slate-800 mb-1">BGPD Recreation</div>
          <div className="text-sm text-slate-400">Enter your name to get started</div>
        </div>
        <div className="space-y-4">
          <Inp label="Your Name" value={name} onChange={setName} placeholder="e.g. Sarah Johnson" required/>
          <button onClick={()=>name.trim()&&onConfirm(name.trim())} disabled={!name.trim()}
            className="w-full py-2.5 text-sm font-bold text-white rounded-lg transition disabled:opacity-40"
            style={{backgroundColor:"#1e3a5f"}}>Get Started</button>
        </div>
        <p className="text-xs text-slate-400 text-center mt-4">Your name will be saved on this device.</p>
      </div>
    </div>
  );
}

// ─── Duplicate Modal ──────────────────────────────────────────────────────────
function DupModal({program,onConfirm,onCancel}) {
  const nextSeason = {Spring:"Summer",Summer:"Fall",Fall:"Winter",Winter:"Spring","All Year":"All Year"};
  const [season,setSeason] = useState(nextSeason[program.season]||"Summer");
  const [year,setYear]     = useState(program.season==="Winter" ? String(parseInt(program.year)+1) : program.year);
  const [carry,setCarry]   = useState(null);
  const sel = "w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-white";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.5)"}}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="text-base font-bold text-slate-800">Duplicate Program</div>
          <div className="text-sm text-slate-400 mt-0.5">Creating a copy of <span className="font-semibold text-slate-600">{program.name}</span></div>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">New Season</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Season</label>
                <select className={sel} value={season} onChange={e=>setSeason(e.target.value)}>
                  {SEASONS.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Year</label>
                <select className={sel} value={year} onChange={e=>setYear(e.target.value)}>
                  {YEARS.map(y=><option key={y}>{y}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Budgeted Numbers</div>
            <div className="space-y-2">
              {[[true,"Carry over from previous season","Pre-fill with the same budget - good starting point for recurring programs"],
                [false,"Start fresh","Clear budgeted numbers so you enter new estimates for this season"]].map(([val,title,desc])=>(
                <div key={String(val)} onClick={()=>setCarry(val)}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${carry===val?"border-blue-400 bg-blue-50":"border-slate-200 hover:border-slate-300"}`}>
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${carry===val?"border-blue-500 bg-blue-500":"border-slate-300"}`}>
                    {carry===val&&<div className="w-1.5 h-1.5 rounded-full bg-white"/>}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-700">{title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3">Actuals always start empty on a duplicate.</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
          <button disabled={carry===null} onClick={()=>onConfirm({season,year,carry})}
            className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40 transition"
            style={{backgroundColor:"#1e3a5f"}}>Duplicate Program</button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({programs,staffName,isManager,onEdit,onAddProgram}) {
  const [sf,setSf] = useState(isManager?"All":staffName);
  const [af,setAf] = useState("All");
  const [yf,setYf] = useState("All");
  const [dv,setDv] = useState("summary");

  const allStaff = ["All",...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas = ["All",...new Set(programs.map(p=>p.area))];
  const allYears = ["All",...YEARS];
  const vis  = programs
    .filter(p=>sf==="All"||p.staff_name===sf)
    .filter(p=>af==="All"||p.area===af)
    .filter(p=>yf==="All"||p.year===yf);
  const kpis = vis.map(p=>({...p,...calcKPIs(p)}));

  const avgFill  = kpis.length ? kpis.reduce((a,p)=>a+p.fillRate,0)/kpis.length : 0;
  const avgCR    = kpis.length ? kpis.reduce((a,p)=>a+p.costRecovery,0)/kpis.length : 0;
  const surplus  = kpis.reduce((a,p)=>a+p.profitLoss,0);
  const antRev   = kpis.reduce((a,p)=>a+p.antRevenue,0);
  const actRev   = kpis.reduce((a,p)=>a+p.revenue,0);
  const antEnr   = vis.reduce((a,p)=>a+(p.ant_enrollment||0),0);
  const actEnr   = vis.reduce((a,p)=>a+(p.act_enrollment||0),0);
  const antCost  = kpis.reduce((a,p)=>a+p.antTotal,0);
  const actCost  = kpis.reduce((a,p)=>a+p.totalCost,0);
  const healthy  = kpis.filter(p=>p.status==="Healthy").length;
  const redesign = kpis.filter(p=>p.status==="Needs Redesign").length;
  const low60    = kpis.filter(p=>p.fillRate<0.6).length;
  const low50    = kpis.filter(p=>p.costRecovery<0.5).length;
  const selCls   = "rounded border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400 min-w-[140px]";
  const anyFilter = sf!=="All"||af!=="All"||yf!=="All";

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-4 items-end">
        {isManager&&(
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Staff</label>
            <select value={sf} onChange={e=>setSf(e.target.value)} className={selCls}>
              {allStaff.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Area</label>
          <select value={af} onChange={e=>setAf(e.target.value)} className={selCls}>
            {allAreas.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Year</label>
          <select value={yf} onChange={e=>setYf(e.target.value)} className={selCls}>
            {allYears.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {anyFilter&&(
          <button onClick={()=>{setSf(isManager?"All":staffName);setAf("All");setYf("All");}}
            className="text-xs text-slate-400 hover:text-slate-600 pb-1.5 font-medium">Clear filters</button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KCard label="Programs"                value={vis.length}       accent="#1e3a5f"/>
        <KCard label="Avg Fill Rate"           value={pct(avgFill)}     accent="#d4a017"/>
        <KCard label="Avg Cost Recovery"       value={pct(avgCR)}       accent="#d4a017"/>
        <KCard label="Total Net Profit/(Loss)" value={dollar(surplus)}  accent={surplus>=0?"#22c55e":"#ef4444"}/>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KCard label="Healthy"            value={healthy}  sub="programs" accent="#22c55e"/>
        <KCard label="Needs Redesign"     value={redesign} sub="programs" accent="#ef4444"/>
        <KCard label="Below 60% Fill"     value={low60}    sub="programs" accent="#f97316"/>
        <KCard label="Below 50% Recovery" value={low50}    sub="programs" accent="#f97316"/>
      </div>

      {/* Portfolio bars */}
      <div className="bg-white rounded-lg shadow-sm p-5 space-y-5">
        <h3 className="font-bold text-slate-700 text-sm">Portfolio: Budgeted vs Actual</h3>
        <PBar label="Total Revenue"      actual={actRev}  budget={antRev}  ff={v=>dollar(v)}/>
        <PBar label="Total Enrollment"   actual={actEnr}  budget={antEnr}  ff={v=>v.toString()}/>
        <PBar label="Total Program Cost" actual={actCost} budget={antCost} ff={v=>dollar(v)} inv/>
      </div>

      {/* Program detail */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-wrap gap-2">
          <h2 className="font-bold text-slate-700 text-sm">Program Detail</h2>
          <div className="flex gap-1">
            {[["summary","Summary"],["variances","Variances"],["progress","Progress"]].map(([v,l])=>(
              <button key={v} onClick={()=>setDv(v)}
                className={`text-xs px-3 py-1.5 rounded font-medium transition ${dv===v?"text-white":"bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                style={dv===v?{backgroundColor:"#1e3a5f"}:{}}>{l}</button>
            ))}
          </div>
        </div>

        {vis.length===0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            No programs found. <button onClick={onAddProgram} className="text-amber-600 font-semibold underline">Add a program.</button>
          </div>
        ) : dv==="summary" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                {["Program",isManager?"Staff":null,"Area","Season","Fill Rate","Cost Recovery","Net P/(L)","Total Cost","Waitlist","Trend","Status",""].filter(Boolean).map(h=>(
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr></thead>
              <tbody>{kpis.map((p,i)=>(
                <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-700">{p.name}</td>
                  {isManager&&<td className="px-3 py-2.5 text-slate-400 text-xs">{p.staff_name}</td>}
                  <td className="px-3 py-2.5 text-slate-500">{p.area}</td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{p.season} {p.year}</td>
                  <td className="px-3 py-2.5 font-mono">{pct(p.fillRate)}</td>
                  <td className="px-3 py-2.5 font-mono">{pct(p.costRecovery)}</td>
                  <td className={`px-3 py-2.5 font-mono font-semibold ${p.profitLoss>=0?"text-green-700":"text-red-600"}`}>{dollar(p.profitLoss)}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-500">{dollar(p.totalCost)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.waitlist||0}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.trend}</td>
                  <td className="px-3 py-2.5"><Badge status={p.status}/></td>
                  <td className="px-3 py-2.5"><button onClick={()=>onEdit(p)} className="text-xs text-slate-400 hover:text-slate-700 font-medium">Edit</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : dv==="variances" ? (
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
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs">{p.ant_enrollment}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{p.act_enrollment}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varEnr)}`}>{vNum(p.varEnr)}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{dollar(p.antRevenue)}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{dollar(p.revenue)}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varRev)}`}>{vDollar(p.varRev)}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{dollar(p.antTotal)}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{dollar(p.totalCost)}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varCost,true)}`}>{vDollar(p.varCost)}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{pct(p.antCR)}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{pct(p.costRecovery)}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varCR)}`}>{vPct(p.varCR)}</td>
                  <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{dollar(p.antProfit)}</td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs">{dollar(p.profitLoss)}</td>
                  <td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varProfit)}`}>{vDollar(p.varProfit)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 space-y-5">{kpis.map(p=>(
            <div key={p.id} className="border border-slate-100 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-700">{p.name}</div>
                  <div className="text-xs text-slate-400">{p.area} - {p.season} {p.year}{p.staff_name?" - "+p.staff_name:""}</div>
                </div>
                <Badge status={p.status}/>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <PBar label="Enrollment"  actual={p.act_enrollment} budget={p.ant_enrollment} ff={v=>v.toString()}/>
                <PBar label="Revenue"     actual={p.revenue}        budget={p.antRevenue}      ff={v=>dollar(v)}/>
                <PBar label="Total Cost"  actual={p.totalCost}      budget={p.antTotal}        ff={v=>dollar(v)} inv/>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PBar label="Cost Recovery"     actual={p.costRecovery*100} budget={p.antCR*100}  ff={v=>`${v.toFixed(1)}%`}/>
                <PBar label="Net Profit/(Loss)" actual={p.profitLoss}       budget={p.antProfit}  ff={v=>dollar(v)}/>
              </div>
            </div>
          ))}</div>
        )}
      </div>

      {/* Status guide */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-bold text-slate-700 text-sm mb-3">Status Guide</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-3"><Badge status="Healthy"/><span className="text-slate-500">70%+ fill rate and 100%+ cost recovery</span></div>
          <div className="flex items-center gap-3"><Badge status="Monitor"/><span className="text-slate-500">60-69.9% fill rate or approaching targets</span></div>
          <div className="flex items-center gap-3"><Badge status="Needs Redesign"/><span className="text-slate-500">Below 60% fill rate or below 50% cost recovery</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── Program Form ─────────────────────────────────────────────────────────────
function ProgramForm({initial,staffName,onSave,onDelete,onDuplicate,onCancel,saving}) {
  const [p,setP]     = useState(initial ? cleanForDB(initial) : newProgram(staffName));
  const set          = k => v => setP(prev=>({...prev,[k]:v}));
  const [sec,setSec] = useState("info");
  const isNew        = !initial;
  const canEdit      = p.staff_name===staffName||!initial;
  const k            = calcKPIs(p);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-700">{isNew?"Add Program":"Edit Program"}</h2>
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-600">Back</button>
      </div>

      {!canEdit&&(
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          This program was entered by <strong>{p.staff_name}</strong>. View only.
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {[{id:"info",label:"Program Info"},{id:"budgeted",label:"Budgeted"},{id:"actuals",label:"Actuals"},{id:"summary",label:"Summary"}].map(s=>(
            <button key={s.id} onClick={()=>setSec(s.id)}
              className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${sec===s.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`}
              style={sec===s.id?{borderColor:"#d4a017"}:{}}>{s.label}</button>
          ))}
        </div>

        <div className="p-5">
          {sec==="info"&&(
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Inp label="Program Name"        value={p.name}                 onChange={set("name")}              required placeholder="e.g. Youth Basketball"/>
                <Inp label="Staff Member"        value={p.staff_name}           onChange={set("staff_name")}        required placeholder="Your name"/>
                <Inp label="Area"                value={p.area}                 onChange={set("area")}              options={AREAS}/>
                <Inp label="Season"              value={p.season}               onChange={set("season")}            options={SEASONS}/>
                <Inp label="Year"                value={p.year}                 onChange={set("year")}              options={YEARS}/>
                <Inp label="Classification"      value={p.classification}       onChange={set("classification")}    options={CLASSIFICATIONS}/>
                <Inp label="Service Category"    value={p.service_category||""} onChange={set("service_category")} options={["",...SERVICE_CATEGORIES]}/>
                <Inp label="Participation Trend" value={p.trend}                onChange={set("trend")}             options={TRENDS}/>
                <Inp label="NPS Score"           type="number" value={p.nps}         onChange={set("nps")}         min={0} max={100} hint="0-100"/>
                <Inp label="Waitlist"            type="number" value={p.waitlist||0}  onChange={set("waitlist")}   min={0}/>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
                <textarea className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none" rows={3}
                  placeholder="Strategy notes, drivers, multi-year context..."
                  value={p.notes||""} onChange={e=>setP(prev=>({...prev,notes:e.target.value}))}/>
              </div>
            </div>
          )}
          {sec==="budgeted"&&(
            <div>
              <div className="mb-5 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <div className="text-xs font-bold text-blue-600 uppercase tracking-widest">Budgeted</div>
                <div className="text-xs text-blue-400 mt-0.5">What you think this program will do. You can update these at any time.</div>
              </div>
              <CostPanel px="ant_" p={p} set={set}/>
            </div>
          )}
          {sec==="actuals"&&(
            <div>
              <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Actuals</div>
                <div className="text-xs text-slate-400 mt-0.5">Update these as the program runs or after it concludes.</div>
              </div>
              <CostPanel px="act_" p={p} set={set}/>
            </div>
          )}
          {sec==="summary"&&(
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><div className="text-xs text-slate-400">Actual Fill Rate</div><div className="text-xl font-bold text-slate-700">{pct(k.fillRate)}</div></div>
                <div><div className="text-xs text-slate-400">Actual Cost Recovery</div><div className="text-xl font-bold text-slate-700">{pct(k.costRecovery)}</div></div>
                <div><div className="text-xs text-slate-400">Net Profit/(Loss)</div><div className={`text-xl font-bold ${k.profitLoss>=0?"text-green-700":"text-red-600"}`}>{dollar(k.profitLoss)}</div></div>
                <div><div className="text-xs text-slate-400">Status</div><div className="mt-1"><Badge status={k.status}/></div></div>
              </div>
              <div className="border-t border-slate-100 pt-4 space-y-4">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Variance vs Budget</div>
                <PBar label="Enrollment"        actual={p.act_enrollment||0} budget={p.ant_enrollment||0} ff={v=>v.toString()}/>
                <PBar label="Revenue"           actual={k.revenue}           budget={k.antRevenue}        ff={v=>dollar(v)}/>
                <PBar label="Total Cost"        actual={k.totalCost}         budget={k.antTotal}          ff={v=>dollar(v)} inv/>
                <PBar label="Cost Recovery"     actual={k.costRecovery*100}  budget={k.antCR*100}         ff={v=>`${v.toFixed(1)}%`}/>
                <PBar label="Net Profit/(Loss)" actual={k.profitLoss}        budget={k.antProfit}         ff={v=>dollar(v)}/>
              </div>
              <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[["Enrollment",vNum(k.varEnr),vc(k.varEnr)],["Revenue",vDollar(k.varRev),vc(k.varRev)],
                  ["Total Cost",vDollar(k.varCost),vc(k.varCost,true)],["Fill Rate",vPct(k.varFill),vc(k.varFill)],
                  ["Cost Recovery",vPct(k.varCR),vc(k.varCR)],["Net Profit/(Loss)",vDollar(k.varProfit),vc(k.varProfit)]].map(([l,v,c])=>(
                  <div key={l}><div className="text-xs text-slate-400">{l}</div><div className={`text-base font-bold ${c}`}>{v}</div></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {canEdit&&(
        <div className="flex gap-3 justify-between">
          <div className="flex gap-2">
            {!isNew&&<button onClick={()=>onDelete(p.id)} className="px-4 py-2 text-sm text-red-500 hover:text-red-700 font-medium">Delete</button>}
            {!isNew&&<button onClick={()=>onDuplicate(p)} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded hover:bg-slate-50 font-medium">Duplicate</button>}
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



// ─── Reference Tab ────────────────────────────────────────────────────────────
function Reference() {
  const [sec,setSec] = useState("standards");
  const workload = [
    {activity:"Program planning & management", pct:"45-50%"},
    {activity:"Meetings / admin",              pct:"20-25%"},
    {activity:"Marketing / outreach",          pct:"10-15%"},
    {activity:"Strategic work / projects",     pct:"10-15%"},
  ];
  const svcTargets = [
    {cat:"Open Access",                      target:"100% Subsidy",           bg:"#fee2e2",text:"#991b1b"},
    {cat:"Community Events",                 target:"80-100% Subsidy",        bg:"#fee2e2",text:"#991b1b"},
    {cat:"Specialty Events",                 target:"0-5% Subsidy",           bg:"#fef9c3",text:"#854d0e"},
    {cat:"Beg. / Intro. Activities",         target:"100% Cost Recovery",     bg:"#dcfce7",text:"#166534"},
    {cat:"Drop In Activities",               target:"100-105% Cost Recovery", bg:"#dcfce7",text:"#166534"},
    {cat:"Childcare Services",               target:"110-130% Cost Recovery", bg:"#d1fae5",text:"#065f46"},
    {cat:"Intermediate / Adv. Activities",   target:"110-130% Cost Recovery", bg:"#d1fae5",text:"#065f46"},
    {cat:"Private / Semi-Private Activities",target:"130-150% Cost Recovery", bg:"#a7f3d0",text:"#064e3b"},
    {cat:"Specialized Activities",           target:"130-150% Cost Recovery", bg:"#a7f3d0",text:"#064e3b"},
    {cat:"Rentals",                          target:"130-150% Cost Recovery", bg:"#a7f3d0",text:"#064e3b"},
    {cat:"Retail & Consumables",             target:"130-150% Cost Recovery", bg:"#a7f3d0",text:"#064e3b"},
  ];
  const tiers = [
    {label:"Tier 1 - Always Tracked",color:"#1e3a5f",items:[
      {m:"Fill Rate",           d:"Percent of available spots filled",       w:"Quarterly"},
      {m:"Cost Recovery",       d:"Revenue divided by total program cost",   w:"Quarterly"},
      {m:"Net Profit / (Loss)", d:"Revenue minus total program cost",        w:"Quarterly"},
      {m:"Participation Trend", d:"Growing, stable, or declining over time", w:"Quarterly"},
      {m:"Status",              d:"Healthy, Monitor, or Needs Redesign",     w:"Quarterly"},
    ]},
    {label:"Tier 2 - Participation",color:"#d4a017",items:[
      {m:"Total Enrollment",         d:"Number of registered participants",      w:"As needed"},
      {m:"Waitlist Volume",          d:"Demand beyond capacity",                 w:"As needed"},
      {m:"Waitlist Conversion Rate", d:"Percent of waitlisted who enroll",       w:"As needed"},
      {m:"Retention Rate",           d:"Percent who return to a future session", w:"As needed"},
      {m:"Cancellation Rate",        d:"Registrants who drop before start",      w:"As needed"},
    ]},
    {label:"Tier 2 - Financial",color:"#d4a017",items:[
      {m:"Margin %",                   d:"Surplus divided by revenue",               w:"As needed"},
      {m:"Revenue per Participant",    d:"Revenue divided by enrolled participants", w:"As needed"},
      {m:"Revenue per Program Hour",   d:"Revenue earned per scheduled hour",        w:"As needed"},
      {m:"Direct Cost per Participant",d:"Direct costs divided by enrollment",       w:"As needed"},
    ]},
    {label:"Tier 2 - Operational / Space",color:"#d4a017",items:[
      {m:"Participant to Staff Ratio", d:"Enrollment relative to staffing",            w:"As needed"},
      {m:"Facility Utilization Rate",  d:"Extent to which a space is booked or used", w:"As needed"},
      {m:"Prime Time Usage Rate",      d:"Use during high demand periods",             w:"As needed"},
      {m:"Revenue per Facility Hour",  d:"Financial productivity of space",            w:"As needed"},
    ]},
    {label:"Tier 2 - Quality / Innovation",color:"#d4a017",items:[
      {m:"NPS",                        d:"Likelihood participants recommend the program", w:"As needed"},
      {m:"Participant Satisfaction",   d:"Program quality score",                        w:"As needed"},
      {m:"Pilot Success Rate",         d:"Pilot met participation and financial targets", w:"As needed"},
      {m:"New Program Retention Rate", d:"Whether pilots continue or return",            w:"As needed"},
    ]},
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className="flex border-b border-slate-100">
        {[{id:"standards",label:"District Standards"},{id:"kpis",label:"KPI Menu"}].map(s=>(
          <button key={s.id} onClick={()=>setSec(s.id)}
            className={`px-5 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${sec===s.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`}
            style={sec===s.id?{borderColor:"#d4a017"}:{}}>{s.label}</button>
        ))}
      </div>
      {sec==="standards"&&(
        <div className="p-5 space-y-8">
          <p className="text-sm text-slate-500">District standard assumption numbers to use consistently across all program cost worksheets.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #1e3a5f"}}>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Facility Overhead</div>
              <div className="text-3xl font-black text-slate-800">$3<span className="text-lg font-semibold text-slate-400">/hr</span></div>
              <div className="text-xs text-slate-400">Applied to all facility hours used</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #d4a017"}}>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Annual FT Compensation</div>
              <div className="text-3xl font-black text-slate-800">$97,700</div>
              <div className="text-xs text-slate-400">Salary + benefits for workload allocation</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #64748b"}}>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Admin Overhead Rate</div>
              <div className="text-3xl font-black text-slate-800">10%</div>
              <div className="text-xs text-slate-400">Applied to total direct costs</div>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:"#1e3a5f"}}>Staff Workload Allocation</div>
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Activity</th>
                <th className="px-4 py-2 text-left font-semibold">% of Time</th>
              </tr></thead>
              <tbody>{workload.map((r,i)=>(
                <tr key={r.activity} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                  <td className="px-4 py-3 font-semibold text-slate-700">{r.activity}</td>
                  <td className="px-4 py-3"><span className="inline-block bg-slate-100 text-slate-600 font-mono font-semibold text-xs px-2.5 py-1 rounded">{r.pct}</span></td>
                </tr>
              ))}</tbody>
            </table>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
              The remaining time (program delivery itself) is accounted for in the per-program workload % you assign in cost worksheets.
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider" style={{backgroundColor:"#d4a017",color:"#1e3a5f"}}>Service Category Cost Recovery / Subsidy Targets</div>
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Service Category</th>
                <th className="px-4 py-2 text-left font-semibold">Target</th>
              </tr></thead>
              <tbody>{svcTargets.map((r,i)=>(
                <tr key={r.cat} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                  <td className="px-4 py-3 font-semibold text-slate-700">{r.cat}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold" style={{background:r.bg,color:r.text}}>{r.target}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {sec==="kpis"&&(
        <div className="p-5 space-y-5">
          <p className="text-sm text-slate-500">Use Tier 1 metrics quarterly. Use Tier 2 metrics when a program needs a deeper review.</p>
          {tiers.map(tier=>(
            <div key={tier.label} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:tier.color}}>{tier.label}</div>
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left">Metric</th>
                  <th className="px-4 py-2 text-left">Definition</th>
                  <th className="px-4 py-2 text-left">When to Use</th>
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
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab]                       = useState("dashboard");
  const [programs,setPrograms]             = useState([]);
  const [editingProgram,setEditingProgram] = useState(null);
  const [addingProgram,setAddingProgram]   = useState(false);
  const [dupProgram,setDupProgram]         = useState(null);
  const [loading,setLoading]               = useState(true);
  const [saving,setSaving]                 = useState(false);
  const [error,setError]                   = useState(null);
  const [staffName,setStaffName]           = useState(()=>localStorage.getItem("bgpd_staff_name")||"");
  const isManager = MANAGER_NAMES.includes(staffName.toLowerCase().trim());

  const fetchAll = useCallback(async()=>{
    setLoading(true);
    const {data:p} = await supabase.from("programs").select("*").order("created_at",{ascending:false});
    setPrograms(p||[]); setLoading(false);
  },[]);

  useEffect(()=>{ if(staffName) fetchAll(); else setLoading(false); },[staffName,fetchAll]);

  const handleConfirmName = name => { localStorage.setItem("bgpd_staff_name",name); setStaffName(name); };

  const handleSaveProgram = async p => {
    setSaving(true); setError(null);
    try {
      const data = cleanForDB(p);
      if(data.id){ const{error:e}=await supabase.from("programs").update(data).eq("id",data.id); if(e) throw e; }
      else        { const{error:e}=await supabase.from("programs").insert(data);                 if(e) throw e; }
      await fetchAll(); setEditingProgram(null); setAddingProgram(false); setTab("dashboard");
    } catch(e){ setError("Failed to save: "+(e.message||"unknown error")); }
    setSaving(false);
  };

  const handleDeleteProgram = async id => {
    setSaving(true);
    await supabase.from("programs").delete().eq("id",id);
    await fetchAll(); setEditingProgram(null); setTab("dashboard"); setSaving(false);
  };

  const handleDuplicate = async (source,{season,year,carry}) => {
    setSaving(true); setError(null);
    try {
      const base = cleanForDB(source);
      delete base.id;
      delete base.created_at;
      const actClear = {act_capacity:0,act_enrollment:0,act_revenue:0,act_personnel:0,act_commodities:0,act_contractuals:0,act_other1:0,act_other2:0,act_facility_hours:0,act_program_type:"",act_custom_workload:0};
      const antClear = carry ? {} : {ant_capacity:0,ant_enrollment:0,ant_revenue:0,ant_personnel:0,ant_commodities:0,ant_contractuals:0,ant_other1:0,ant_other2:0,ant_facility_hours:0,ant_program_type:"",ant_custom_workload:0};
      const{error:e}=await supabase.from("programs").insert({...base,...actClear,...antClear,season,year});
      if(e) throw e;
      await fetchAll(); setDupProgram(null); setEditingProgram(null); setAddingProgram(false); setTab("programs");
    } catch(e){ setError("Failed to duplicate: "+(e.message||"unknown error")); }
    setSaving(false);
  };

  const tabs = [{id:"dashboard",label:"Dashboard"},{id:"programs",label:"Programs"},{id:"kpi",label:"Reference"}];
  const showingForm = editingProgram||addingProgram;

  if(!staffName) return <StaffSetup onConfirm={handleConfirmName}/>;

  return (
    <div className="min-h-screen" style={{background:"#f1f5f9"}}>
      {dupProgram&&(
        <DupModal
          program={dupProgram}
          onConfirm={opts=>handleDuplicate(dupProgram,opts)}
          onCancel={()=>setDupProgram(null)}
        />
      )}

      <header style={{backgroundColor:"#1e3a5f"}} className="px-4 py-4 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-lg leading-tight">BGPD Recreation</div>
            <div style={{color:"#d4a017"}} className="text-xs font-semibold tracking-widest uppercase">{staffName}{isManager?" - Manager View":""}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>{setAddingProgram(true);setEditingProgram(null);setTab("programs");}}
              className="text-xs font-bold px-3 py-2 rounded transition"
              style={{backgroundColor:"#d4a017",color:"#1e3a5f"}}>+ Add Program</button>
            <button onClick={()=>{localStorage.removeItem("bgpd_staff_name");setStaffName("");}}
              className="text-xs text-slate-300 hover:text-white px-2 py-2 transition">Switch</button>
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
        {error&&(
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex justify-between">
            {error}<button onClick={()=>setError(null)} className="font-bold ml-4">x</button>
          </div>
        )}
        {loading ? (
          <div className="text-center py-20 text-slate-400">Loading programs...</div>
        ) : (
          <>
            {tab==="dashboard"&&!showingForm&&(
              <Dashboard programs={programs} staffName={staffName} isManager={isManager}
                onEdit={p=>{setEditingProgram(p);setTab("programs");}}
                onAddProgram={()=>{setAddingProgram(true);setTab("programs");}}/>
            )}
            {tab==="programs"&&!showingForm&&(
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-slate-700">All Programs ({programs.length})</h2>
                  <button onClick={()=>setAddingProgram(true)}
                    className="text-xs font-bold px-3 py-2 rounded text-white"
                    style={{backgroundColor:"#1e3a5f"}}>+ Add Program</button>
                </div>
                {programs.length===0 ? (
                  <div className="bg-white rounded-lg shadow-sm p-12 text-center text-slate-400 text-sm">No programs yet.</div>
                ) : (
                  <div className="space-y-2">{programs.map(p=>{
                    const k = calcKPIs(p);
                    return (
                      <div key={p.id} onClick={()=>setEditingProgram(p)}
                        className="bg-white rounded-lg shadow-sm px-4 py-3 flex items-center justify-between gap-4 hover:shadow-md transition cursor-pointer">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-700 truncate">{p.name}</div>
                          <div className="text-xs text-slate-400">{p.area} - {p.season} {p.year} - {p.staff_name}</div>
                        </div>
                        <div className="hidden sm:flex gap-6 text-sm">
                          <div className="text-center"><div className="text-xs text-slate-400">Fill</div><div className="font-mono font-semibold">{pct(k.fillRate)}</div></div>
                          <div className="text-center"><div className="text-xs text-slate-400">Recovery</div><div className="font-mono font-semibold">{pct(k.costRecovery)}</div></div>
                          <div className="text-center"><div className="text-xs text-slate-400">Net P/(L)</div><div className={`font-mono font-semibold ${k.profitLoss>=0?"text-green-700":"text-red-600"}`}>{dollar(k.profitLoss)}</div></div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={e=>{e.stopPropagation();setDupProgram(p);}}
                            className="text-xs text-slate-400 hover:text-slate-700 font-medium px-2 py-1 rounded hover:bg-slate-100 transition">Copy</button>
                          <Badge status={k.status}/>
                        </div>
                      </div>
                    );
                  })}</div>
                )}
              </div>
            )}
            {tab==="programs"&&showingForm&&(
              <ProgramForm
                initial={editingProgram||null}
                staffName={staffName}
                onSave={handleSaveProgram}
                onDelete={handleDeleteProgram}
                onDuplicate={p=>setDupProgram(p)}
                onCancel={()=>{setEditingProgram(null);setAddingProgram(false);}}
                saving={saving}/>
            )}
            {tab==="kpi"&&<Reference/>}
          </>
        )}
      </main>
    </div>
  );
}
