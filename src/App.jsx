import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const AREAS = ["Adult General","Adult Sports","Aquatics","Camps","Clubhouse","Dance","Fitness","Golf Dome","Museum","Performing Arts","Seniors","Special Events","Youth General","Youth Sports","Other"];
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
const MANAGER_NAMES        = ["admin","manager","joe zimmermann","erika strojinc","dan stanczak","brian o'malley","chris eckert","chuck burgess","diana clayson","amanda busch"];

// ─── DB columns ───────────────────────────────────────────────────────────────
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
  for (const key of DB_FIELDS) { if (key in p) out[key] = p[key]; }
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
    hasActuals: b.enrollment > 0 || b.revenue > 0 || b.direct > 0,
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

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV(programs) {
  const rows = programs.map(p => {
    const k = calcKPIs(p);
    return [
      p.name, p.staff_name, p.area, p.season, p.year, p.classification,
      p.service_category, p.trend, p.nps, p.waitlist,
      p.ant_enrollment, p.ant_capacity, (k.antFillRate*100).toFixed(1)+"%",
      dollar(p.ant_revenue), dollar(k.antTotal), (k.antCR*100).toFixed(1)+"%", dollar(k.antProfit),
      p.act_enrollment, p.act_capacity, (k.fillRate*100).toFixed(1)+"%",
      dollar(p.act_revenue), dollar(k.totalCost), (k.costRecovery*100).toFixed(1)+"%", dollar(k.profitLoss),
      k.status, p.notes||""
    ].map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",");
  });
  const headers = [
    "Program","Staff","Area","Season","Year","Classification","Service Category","Trend","NPS","Waitlist",
    "Bud. Enrollment","Bud. Capacity","Bud. Fill Rate","Bud. Revenue","Bud. Total Cost","Bud. Cost Recovery","Bud. Net P/L",
    "Act. Enrollment","Act. Capacity","Act. Fill Rate","Act. Revenue","Act. Total Cost","Act. Cost Recovery","Act. Net P/L",
    "Status","Notes"
  ].join(",");
  const blob = new Blob([headers+"\n"+rows.join("\n")], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `BGPD_Programs_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
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

function KCard({label,value,sub,accent,onClick}) {
  return (
    <div onClick={onClick} style={{borderTop:`3px solid ${accent||"#1e3a5f"}`}}
      className={`bg-white rounded-lg p-4 shadow-sm ${onClick?"cursor-pointer hover:shadow-md transition":""}`}>
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

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────
function ConfirmModal({message,onConfirm,onCancel}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.5)"}}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="text-base font-bold text-slate-800">Are you sure?</div>
        <div className="text-sm text-slate-500">{message}</div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
        </div>
      </div>
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
          <Inp label="Personnel ($)"            type="number" value={p[px+"personnel"]}      onChange={set(px+"personnel")}      min={0}/>
          <Inp label="Commodities ($)"          type="number" value={p[px+"commodities"]}    onChange={set(px+"commodities")}    min={0}/>
          <Inp label="Contractuals ($)"         type="number" value={p[px+"contractuals"]}   onChange={set(px+"contractuals")}   min={0}/>
          <Inp label="Other Direct Costs ($)"   type="number" value={p[px+"other1"]}         onChange={set(px+"other1")}         min={0}/>
          <Inp label="Other Direct Costs 2 ($)" type="number" value={p[px+"other2"]}         onChange={set(px+"other2")}         min={0}/>
          <Inp label="Facility Hours"           type="number" value={p[px+"facility_hours"]} onChange={set(px+"facility_hours")} min={0} hint={"$"+FACILITY_COST_PER_HR+"/hr allocated"}/>
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
  const nextYear   = program.season==="Winter" ? String(parseInt(program.year)+1) : program.year;
  const [season,setSeason] = useState(nextSeason[program.season]||"Summer");
  const [year,setYear]     = useState(nextYear);
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
              {[[true,"Carry over from previous season","Pre-fill with the same budget — good for recurring programs"],
                [false,"Start fresh","Clear budgeted numbers so you enter new estimates"]].map(([val,title,desc])=>(
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

// ─── Bulk Duplicate Modal ─────────────────────────────────────────────────────
function BulkDupModal({programs,onConfirm,onCancel}) {
  const [selected,setSelected] = useState({});
  const [season,setSeason]     = useState("Summer");
  const [year,setYear]         = useState("2026");
  const [carry,setCarry]       = useState(true);
  const toggle = id => setSelected(s=>({...s,[id]:!s[id]}));
  const allOn  = programs.length>0 && programs.every(p=>selected[p.id]);
  const toggleAll = () => {
    if(allOn) setSelected({});
    else setSelected(Object.fromEntries(programs.map(p=>[p.id,true])));
  };
  const count = Object.values(selected).filter(Boolean).length;
  const sel = "rounded border border-slate-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.5)"}}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="text-base font-bold text-slate-800">Bulk Season Rollover</div>
          <div className="text-sm text-slate-400 mt-0.5">Select programs to copy to a new season</div>
        </div>
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">New Season</label>
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
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Budget</label>
            <select className={sel} value={carry?"carry":"fresh"} onChange={e=>setCarry(e.target.value==="carry")}>
              <option value="carry">Carry over</option>
              <option value="fresh">Start fresh</option>
            </select>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-3">
            <input type="checkbox" checked={allOn} onChange={toggleAll} className="rounded"/>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Select All ({programs.length})</span>
          </div>
          {programs.map(p=>(
            <div key={p.id} onClick={()=>toggle(p.id)}
              className={`px-6 py-3 flex items-center gap-3 border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${selected[p.id]?"bg-blue-50":""}`}>
              <input type="checkbox" checked={!!selected[p.id]} onChange={()=>toggle(p.id)} className="rounded" onClick={e=>e.stopPropagation()}/>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-700 truncate">{p.name}</div>
                <div className="text-xs text-slate-400">{p.area} — {p.season} {p.year} — {p.staff_name}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
          <span className="text-sm text-slate-400">{count} selected</span>
          <div className="flex gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
            <button disabled={count===0} onClick={()=>onConfirm({ids:Object.keys(selected).filter(id=>selected[id]),season,year,carry})}
              className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40 transition"
              style={{backgroundColor:"#1e3a5f"}}>Copy {count>0?count:""} Program{count!==1?"s":""}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard (Staff View — unchanged from original) ─────────────────────────
function StaffDashboard({programs,staffName,onEdit,onAddProgram}) {
  const [af,setAf] = useState("All");
  const [yf,setYf] = useState("All");
  const [dv,setDv] = useState("summary");

  const allAreas = ["All",...new Set(programs.map(p=>p.area))];
  const allYears = ["All",...YEARS];

  const vis  = programs
    .filter(p=>p.staff_name===staffName)
    .filter(p=>af==="All"||p.area===af)
    .filter(p=>yf==="All"||p.year===yf);

  const kpis    = vis.map(p=>({...p,...calcKPIs(p)}));
  const avgFill = kpis.length ? kpis.reduce((a,p)=>a+p.fillRate,0)/kpis.length : 0;
  const avgCR   = kpis.length ? kpis.reduce((a,p)=>a+p.costRecovery,0)/kpis.length : 0;
  const surplus = kpis.reduce((a,p)=>a+p.profitLoss,0);
  const antRev  = kpis.reduce((a,p)=>a+p.antRevenue,0);
  const actRev  = kpis.reduce((a,p)=>a+p.revenue,0);
  const antEnr  = vis.reduce((a,p)=>a+(p.ant_enrollment||0),0);
  const actEnr  = vis.reduce((a,p)=>a+(p.act_enrollment||0),0);
  const antCost = kpis.reduce((a,p)=>a+p.antTotal,0);
  const actCost = kpis.reduce((a,p)=>a+p.totalCost,0);
  const healthy  = kpis.filter(p=>p.status==="Healthy").length;
  const monitor  = kpis.filter(p=>p.status==="Monitor").length;
  const redesign = kpis.filter(p=>p.status==="Needs Redesign").length;
  const low60    = kpis.filter(p=>p.fillRate<0.6).length;
  const low50    = kpis.filter(p=>p.costRecovery<0.5).length;
  const selCls = "rounded border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400 min-w-[140px]";
  const anyFilter = af!=="All"||yf!=="All";

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-4 items-end">
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
        {anyFilter&&<button onClick={()=>{setAf("All");setYf("All");}} className="text-xs text-slate-400 hover:text-slate-600 pb-1.5 font-medium">Clear filters</button>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KCard label="Programs"                value={vis.length}      accent="#1e3a5f"/>
        <KCard label="Avg Fill Rate"           value={pct(avgFill)}    accent="#d4a017"/>
        <KCard label="Avg Cost Recovery"       value={pct(avgCR)}      accent="#d4a017"/>
        <KCard label="Total Net Profit/(Loss)" value={dollar(surplus)} accent={surplus>=0?"#22c55e":"#ef4444"}/>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KCard label="Healthy"            value={healthy}  sub="programs" accent="#22c55e"/>
        <KCard label="Monitor"            value={monitor}  sub="programs" accent="#eab308"/>
        <KCard label="Needs Redesign"     value={redesign} sub="programs" accent="#ef4444"/>
        <KCard label="Below 50% Recovery" value={low50}    sub="programs" accent="#f97316"/>
      </div>
      <div className="bg-white rounded-lg shadow-sm p-5 space-y-5">
        <h3 className="font-bold text-slate-700 text-sm">Program Snapshot: Budgeted vs Actual</h3>
        <PBar label="Total Revenue"      actual={actRev}  budget={antRev}  ff={v=>dollar(v)}/>
        <PBar label="Total Enrollment"   actual={actEnr}  budget={antEnr}  ff={v=>v.toString()}/>
        <PBar label="Total Program Cost" actual={actCost} budget={antCost} ff={v=>dollar(v)} inv/>
      </div>
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
          <div className="p-8 text-center text-slate-400 text-sm">No programs yet. <button onClick={onAddProgram} className="text-amber-600 font-semibold underline">Add a program.</button></div>
        ) : dv==="summary" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                {["Program","Area","Season","Fill Rate","Cost Recovery","Net P/(L)","Total Cost","Waitlist","Trend","Status",""].map(h=>(
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr></thead>
              <tbody>{kpis.map((p,i)=>(
                <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-700"><button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button></td>
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
                  <td className="px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap"><button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button></td>
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
                  <button onClick={()=>onEdit(p)} className="font-semibold text-slate-700 hover:text-blue-600 hover:underline text-left">{p.name}</button>
                  <div className="text-xs text-slate-400">{p.area} - {p.season} {p.year}</div>
                </div>
                <Badge status={p.status}/>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <PBar label="Enrollment"  actual={p.act_enrollment} budget={p.ant_enrollment} ff={v=>v.toString()}/>
                <PBar label="Revenue"     actual={p.revenue}        budget={p.antRevenue}      ff={v=>dollar(v)}/>
                <PBar label="Total Cost"  actual={p.totalCost}      budget={p.antTotal}        ff={v=>dollar(v)} inv/>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PBar label="Cost Recovery"     actual={p.costRecovery*100} budget={p.antCR*100} ff={v=>`${v.toFixed(1)}%`}/>
                <PBar label="Net Profit/(Loss)" actual={p.profitLoss}       budget={p.antProfit} ff={v=>dollar(v)}/>
              </div>
            </div>
          ))}</div>
        )}
      </div>
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

// ─── Dashboard (Manager View — full analytics) ────────────────────────────────
function ManagerDashboard({programs,staffName,onEdit,onAddProgram}) {
  const [sf,setSf]     = useState("All");
  const [af,setAf]     = useState("All");
  const [yf,setYf]     = useState("All");
  const [dv,setDv]     = useState("summary");
  const [sort,setSort] = useState({col:"name",dir:1});

  const allStaff = ["All",...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas = ["All",...new Set(programs.map(p=>p.area))];
  const allYears = ["All",...YEARS];

  const vis  = programs
    .filter(p=>sf==="All"||p.staff_name===sf)
    .filter(p=>af==="All"||p.area===af)
    .filter(p=>yf==="All"||p.year===yf);

  const kpis = useMemo(()=>vis.map(p=>({...p,...calcKPIs(p)})),[vis]);

  const sortedKpis = useMemo(()=>[...kpis].sort((a,b)=>{
    let av=a[sort.col], bv=b[sort.col];
    if(typeof av==="string") av=av.toLowerCase();
    if(typeof bv==="string") bv=bv.toLowerCase();
    return av<bv?-sort.dir:av>bv?sort.dir:0;
  }),[kpis,sort]);

  const toggleSort = col => setSort(s=>s.col===col?{col,dir:-s.dir}:{col,dir:1});
  const sortIcon   = col => sort.col===col?(sort.dir===1?"↑":"↓"):"";
  const thCls      = col => `px-3 py-2 text-left font-semibold cursor-pointer hover:text-slate-700 select-none ${sort.col===col?"text-slate-700":""}`;

  // ── Aggregates ──
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
  const monitor  = kpis.filter(p=>p.status==="Monitor").length;
  const redesign = kpis.filter(p=>p.status==="Needs Redesign").length;
  const noActuals= kpis.filter(p=>!p.hasActuals).length;

  // ── Program Snapshot health score (0–100) ──
  const healthScore = kpis.length
    ? Math.round((avgFill*0.4 + Math.min(avgCR,2)/2*0.4 + (healthy/kpis.length)*0.2)*100)
    : 0;
  const healthColor = healthScore>=75?"#22c55e":healthScore>=50?"#eab308":"#ef4444";

  // ── Needs attention queue ──
  const needsAttention = kpis
    .filter(p=>p.status==="Needs Redesign"||p.trend==="Declining"||p.fillRate<0.5)
    .sort((a,b)=>a.fillRate-b.fillRate)
    .slice(0,8);

  // ── Waitlist demand signal ──
  const totalWaitlist  = vis.reduce((a,p)=>a+(p.waitlist||0),0);
  const totalCapacity  = vis.reduce((a,p)=>a+(p.ant_capacity||0),0);
  const waitlistPct    = totalCapacity>0 ? totalWaitlist/totalCapacity : 0;
  const highDemand     = kpis
    .filter(p=>(p.waitlist||0)>0)
    .sort((a,b)=>(b.waitlist||0)-(a.waitlist||0))
    .slice(0,5);

  // ── Revenue per participant ──
  const totalActEnr = vis.reduce((a,p)=>a+(p.act_enrollment||0),0);
  const revPerPart  = totalActEnr>0 ? actRev/totalActEnr : 0;
  const rppByArea   = useMemo(()=>{
    const map={};
    kpis.forEach(p=>{
      const enr=p.act_enrollment||0; const rev=p.revenue||0;
      if(!map[p.area]) map[p.area]={area:p.area,rev:0,enr:0};
      map[p.area].rev+=rev; map[p.area].enr+=enr;
    });
    return Object.values(map).map(r=>({...r,rpp:r.enr>0?r.rev/r.enr:0})).sort((a,b)=>b.rpp-a.rpp);
  },[kpis]);

  // ── NPS summary ──
  const withNPS   = kpis.filter(p=>p.nps&&p.nps>0);
  const avgNPS    = withNPS.length ? Math.round(withNPS.reduce((a,p)=>a+(p.nps||0),0)/withNPS.length) : null;
  const lowNPS    = withNPS.filter(p=>p.nps<50).sort((a,b)=>a.nps-b.nps).slice(0,5);
  const npsByArea = useMemo(()=>{
    const map={};
    withNPS.forEach(p=>{
      if(!map[p.area]) map[p.area]={area:p.area,sum:0,count:0};
      map[p.area].sum+=p.nps; map[p.area].count++;
    });
    return Object.values(map).map(r=>({...r,avg:Math.round(r.sum/r.count)})).sort((a,b)=>b.avg-a.avg);
  },[withNPS]);

  // ── Workload by staff ──
  const workloadByStaff = useMemo(()=>{
    const map={};
    kpis.forEach(p=>{
      const name=p.staff_name||"Unknown";
      if(!map[name]) map[name]={name,totalWL:0,count:0};
      const wlPct = p.ant_program_type&&p.ant_program_type!=="Custom"
        ? (PROGRAM_TYPES.find(t=>t.label===p.ant_program_type)?.pct||0)*100
        : parseFloat(p.ant_custom_workload)||0;
      map[name].totalWL+=wlPct; map[name].count++;
    });
    return Object.values(map).sort((a,b)=>b.totalWL-a.totalWL);
  },[kpis]);

  // ── Classification mix ──
  const classMix = useMemo(()=>{
    const map={};
    kpis.forEach(p=>{
      const c=p.classification||"Unknown";
      if(!map[c]) map[c]={label:c,count:0,revenue:0,cost:0,profit:0};
      map[c].count++; map[c].revenue+=p.revenue; map[c].cost+=p.totalCost; map[c].profit+=p.profitLoss;
    });
    return Object.values(map).sort((a,b)=>b.count-a.count);
  },[kpis]);
  const classMixColors = {"Community Driven":"#1e3a5f","Revenue Driven":"#22c55e","Both":"#d4a017","Unknown":"#94a3b8"};

  // ── Subsidy burden ──
  const subsidyBurden = kpis.reduce((a,p)=>a+Math.max(0,-p.profitLoss),0);

  // ── Top/Bottom performers ──
  const byFill   = [...kpis].sort((a,b)=>b.fillRate-a.fillRate);
  const byCR     = [...kpis].sort((a,b)=>b.costRecovery-a.costRecovery);
  const top3Fill = byFill.slice(0,3);
  const bot3Fill = byFill.slice(-3).reverse();
  const top3CR   = byCR.slice(0,3);
  const bot3CR   = byCR.slice(-3).reverse();

  // ── Area rollup ──
  const areaRollup = useMemo(()=>{
    const map={};
    kpis.forEach(p=>{
      if(!map[p.area]) map[p.area]={area:p.area,count:0,fillSum:0,crSum:0,profit:0,waitlist:0,capacity:0};
      map[p.area].count++; map[p.area].fillSum+=p.fillRate; map[p.area].crSum+=p.costRecovery;
      map[p.area].profit+=p.profitLoss; map[p.area].waitlist+=(p.waitlist||0); map[p.area].capacity+=(p.ant_capacity||0);
    });
    return Object.values(map).map(r=>({...r,avgFill:r.fillSum/r.count,avgCR:r.crSum/r.count})).sort((a,b)=>b.avgFill-a.avgFill);
  },[kpis]);

  const selCls    = "rounded border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400 min-w-[140px]";
  const anyFilter = sf!=="All"||af!=="All"||yf!=="All";

  return (
    <div className="space-y-6">

      {/* ── Filters + Export ── */}
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-4 items-end justify-between">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Staff</label>
            <select value={sf} onChange={e=>setSf(e.target.value)} className={selCls}>
              {allStaff.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
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
          {anyFilter&&<button onClick={()=>{setSf("All");setAf("All");setYf("All");}} className="text-xs text-slate-400 hover:text-slate-600 pb-1.5 font-medium">Clear filters</button>}
        </div>
        <button onClick={()=>exportCSV(vis)} className="text-xs font-semibold px-3 py-2 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition whitespace-nowrap">↓ Export CSV</button>
      </div>

      {/* ── Needs Attention Queue ── */}
      {needsAttention.length>0&&(
        <div className="bg-red-50 border border-red-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 flex items-center gap-2" style={{backgroundColor:"#991b1b"}}>
            <span className="text-white text-sm">⚠</span>
            <span className="text-xs font-bold uppercase tracking-widest text-white">Needs Attention — {needsAttention.length} Program{needsAttention.length!==1?"s":""}</span>
          </div>
          <div className="divide-y divide-red-100">
            {needsAttention.map(p=>(
              <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-red-50/50">
                <div className="flex-1 min-w-0">
                  <button onClick={()=>onEdit(p)} className="text-sm font-semibold text-slate-700 hover:text-blue-600 hover:underline text-left truncate block">{p.name}</button>
                  <div className="text-xs text-slate-400">{p.area} — {p.season} {p.year} — {p.staff_name}</div>
                </div>
                <div className="hidden sm:flex gap-4 text-xs font-mono shrink-0">
                  <span className="text-slate-500">Fill: <span className={p.fillRate<0.6?"text-red-600 font-bold":""}>{pct(p.fillRate)}</span></span>
                  <span className="text-slate-500">Recovery: <span className={p.costRecovery<0.5?"text-red-600 font-bold":""}>{pct(p.costRecovery)}</span></span>
                  <span className={p.trend==="Declining"?"text-amber-600 font-semibold":"text-slate-400"}>{p.trend}</span>
                </div>
                <Badge status={p.status}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Missing actuals alert ── */}
      {noActuals>0&&(
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <span className="text-amber-500 text-lg">⚠</span>
          <span className="text-sm text-amber-700 font-medium">{noActuals} program{noActuals!==1?"s have":" has"} budget data but no actuals entered yet.</span>
        </div>
      )}

      {/* ── KPI Row 1 — with health score ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KCard label="Programs"          value={vis.length}      accent="#1e3a5f"/>
        <KCard label="Avg Fill Rate"     value={pct(avgFill)}    accent="#d4a017"/>
        <KCard label="Avg Cost Recovery" value={pct(avgCR)}      accent="#d4a017"/>
        <KCard label="Total Net P/(L)"   value={dollar(surplus)} accent={surplus>=0?"#22c55e":"#ef4444"}/>
        <div style={{borderTop:`3px solid ${healthColor}`}} className="bg-white rounded-lg p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Health Score</div>
          <div className="text-2xl font-bold" style={{color:healthColor}}>{healthScore}<span className="text-sm font-normal text-slate-400">/100</span></div>
          <div className="text-xs text-slate-400 mt-0.5">Fill · Recovery · Status</div>
        </div>
      </div>

      {/* ── KPI Row 2 ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KCard label="Healthy"          value={healthy}   sub="programs" accent="#22c55e"/>
        <KCard label="Monitor"          value={monitor}   sub="programs" accent="#eab308"/>
        <KCard label="Needs Redesign"   value={redesign}  sub="programs" accent="#ef4444"/>
        <KCard label="Missing Actuals"  value={noActuals} sub="programs" accent="#f97316"/>
        <KCard label="Rev / Participant" value={totalActEnr>0?dollar(revPerPart):"—"} sub="portfolio avg" accent="#1e3a5f"/>
      </div>

      {/* ── KPI Row 3 — financial ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KCard label="Total Revenue"    value={dollar(actRev)}      accent="#22c55e"/>
        <KCard label="Total Cost"       value={dollar(actCost)}     accent="#64748b"/>
        <KCard label="Subsidy Burden"   value={dollar(subsidyBurden)} sub="tax $ supporting programs" accent="#ef4444"/>
        <KCard label="Waitlist Demand"  value={pct(waitlistPct)}    sub={`${totalWaitlist} total on waitlists`} accent="#d4a017"/>
      </div>

      {/* ── Program Snapshot bars ── */}
      <div className="bg-white rounded-lg shadow-sm p-5 space-y-5">
        <h3 className="font-bold text-slate-700 text-sm">Program Snapshot: Budgeted vs Actual</h3>
        <PBar label="Total Revenue"      actual={actRev}  budget={antRev}  ff={v=>dollar(v)}/>
        <PBar label="Total Enrollment"   actual={actEnr}  budget={antEnr}  ff={v=>v.toString()}/>
        <PBar label="Total Program Cost" actual={actCost} budget={antCost} ff={v=>dollar(v)} inv/>
      </div>

      {/* ── Classification Mix ── */}
      {classMix.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-700 text-sm">Program Mix by Classification</h3>
            <p className="text-xs text-slate-400 mt-0.5">Balance of community service vs. revenue-generating programs</p>
          </div>
          <div className="p-4">
            <div className="flex h-4 rounded-full overflow-hidden mb-4 gap-0.5">
              {classMix.map(c=>(
                <div key={c.label} title={`${c.label}: ${c.count} programs`}
                  style={{width:`${(c.count/kpis.length)*100}%`,backgroundColor:classMixColors[c.label]||"#94a3b8"}}/>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {classMix.map(c=>(
                <div key={c.label} className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50">
                  <div className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{backgroundColor:classMixColors[c.label]||"#94a3b8"}}/>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-700">{c.label}</div>
                    <div className="text-xs text-slate-400">{c.count} program{c.count!==1?"s":""} · {Math.round((c.count/kpis.length)*100)}% of inventory</div>
                    <div className="text-xs font-mono text-slate-500 mt-0.5">{dollar(c.revenue)} revenue · <span className={c.profit>=0?"text-green-600":"text-red-500"}>{dollar(c.profit)} net</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Workload by Staff ── */}
      {workloadByStaff.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-700 text-sm">Staff Workload Distribution</h3>
            <p className="text-xs text-slate-400 mt-0.5">Estimated FT workload % allocated across programs</p>
          </div>
          <div className="p-4 space-y-3">
            {workloadByStaff.map(s=>{
              const pctVal = Math.min(s.totalWL,100);
              const barColor = s.totalWL>80?"#ef4444":s.totalWL>60?"#eab308":"#22c55e";
              return (
                <div key={s.name}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-semibold text-slate-700">{s.name}</span>
                    <span className="text-xs font-mono text-slate-500">{s.totalWL.toFixed(1)}% allocated · {s.count} program{s.count!==1?"s":""}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width:`${pctVal}%`,backgroundColor:barColor}}/>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-slate-400 pt-1">Based on budgeted program type workload %. Green = under 60%, Yellow = 60–80%, Red = over 80%.</p>
          </div>
        </div>
      )}

      {/* ── Top/Bottom Performers ── */}
      {kpis.length>=3&&(
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            {title:"Top 3 — Fill Rate",           data:top3Fill, metric:p=>pct(p.fillRate),    good:true},
            {title:"Bottom 3 — Fill Rate",         data:bot3Fill, metric:p=>pct(p.fillRate),    good:false},
            {title:"Top 3 — Cost Recovery",        data:top3CR,   metric:p=>pct(p.costRecovery),good:true},
            {title:"Bottom 3 — Cost Recovery",     data:bot3CR,   metric:p=>pct(p.costRecovery),good:false},
          ].map(({title,data,metric,good})=>(
            <div key={title} className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:good?"#166534":"#991b1b"}}>{title}</div>
              {data.map((p,i)=>(
                <div key={p.id} className={`px-4 py-2.5 flex items-center justify-between ${i>0?"border-t border-slate-50":""}`}>
                  <div>
                    <button onClick={()=>onEdit(p)} className="text-sm font-semibold text-slate-700 hover:text-blue-600 hover:underline text-left">{p.name}</button>
                    <div className="text-xs text-slate-400">{p.area} — {p.season} {p.year}</div>
                  </div>
                  <div className={`text-sm font-bold ${good?"text-green-700":"text-red-600"}`}>{metric(p)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── High Demand Programs (Waitlist) ── */}
      {highDemand.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:"#d4a017",color:"#1e3a5f"}}>
            High Demand — Programs with Waitlists
          </div>
          {highDemand.map((p,i)=>(
            <div key={p.id} className={`px-4 py-2.5 flex items-center justify-between gap-4 ${i>0?"border-t border-slate-50":""} hover:bg-slate-50`}>
              <div className="flex-1 min-w-0">
                <button onClick={()=>onEdit(p)} className="text-sm font-semibold text-slate-700 hover:text-blue-600 hover:underline text-left">{p.name}</button>
                <div className="text-xs text-slate-400">{p.area} — {p.season} {p.year} — {p.staff_name}</div>
              </div>
              <div className="flex gap-4 text-xs font-mono text-slate-500 shrink-0">
                <span>Fill: {pct(p.fillRate)}</span>
                <span className="font-bold text-amber-600">{p.waitlist} on waitlist</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Revenue per Participant by Area ── */}
      {rppByArea.filter(r=>r.enr>0).length>1&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-700 text-sm">Revenue per Participant by Area</h3>
            <p className="text-xs text-slate-400 mt-0.5">Avg: {totalActEnr>0?dollar(revPerPart):"—"} — areas above avg may be well-priced; below may need review</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Area</th>
                <th className="px-4 py-2 text-left font-semibold">Participants</th>
                <th className="px-4 py-2 text-left font-semibold">Revenue</th>
                <th className="px-4 py-2 text-left font-semibold">Rev / Participant</th>
                <th className="px-4 py-2 text-left font-semibold">vs Avg</th>
              </tr></thead>
              <tbody>{rppByArea.filter(r=>r.enr>0).map((r,i)=>{
                const diff = r.rpp - revPerPart;
                return (
                  <tr key={r.area} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                    <td className="px-4 py-2.5 font-semibold text-slate-700">{r.area}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.enr}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{dollar(r.rev)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs font-bold">{dollar(r.rpp)}</td>
                    <td className={`px-4 py-2.5 font-mono text-xs font-semibold ${diff>=0?"text-green-600":"text-red-500"}`}>{diff>=0?"+":""}{dollar(diff)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── NPS Summary ── */}
      {withNPS.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-700 text-sm">NPS Summary</h3>
              <p className="text-xs text-slate-400 mt-0.5">{withNPS.length} of {kpis.length} programs have NPS data</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Snapshot Avg</div>
              <div className={`text-2xl font-black ${avgNPS>=70?"text-green-600":avgNPS>=50?"text-amber-500":"text-red-500"}`}>{avgNPS}</div>
            </div>
          </div>
          {npsByArea.length>1&&(
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left font-semibold">Area</th>
                  <th className="px-4 py-2 text-left font-semibold">Programs w/ NPS</th>
                  <th className="px-4 py-2 text-left font-semibold">Avg NPS</th>
                  <th className="px-4 py-2 text-left font-semibold">Rating</th>
                </tr></thead>
                <tbody>{npsByArea.map((r,i)=>(
                  <tr key={r.area} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                    <td className="px-4 py-2.5 font-semibold text-slate-700">{r.area}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.count}</td>
                    <td className={`px-4 py-2.5 font-bold text-lg ${r.avg>=70?"text-green-600":r.avg>=50?"text-amber-500":"text-red-500"}`}>{r.avg}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{r.avg>=70?"Strong":r.avg>=50?"Acceptable":"Needs Review"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {lowNPS.length>0&&(
            <div className="px-4 py-3 border-t border-slate-100 bg-red-50">
              <div className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2">Low NPS Programs (below 50)</div>
              <div className="space-y-1">
                {lowNPS.map(p=>(
                  <div key={p.id} className="flex items-center justify-between">
                    <button onClick={()=>onEdit(p)} className="text-sm text-slate-700 hover:text-blue-600 hover:underline">{p.name}</button>
                    <span className="text-sm font-bold text-red-600">{p.nps}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Area Rollup ── */}
      {areaRollup.length>1&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-700 text-sm">Capacity Utilization by Area</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Area</th>
                <th className="px-4 py-2 text-left font-semibold">Programs</th>
                <th className="px-4 py-2 text-left font-semibold">Avg Fill Rate</th>
                <th className="px-4 py-2 text-left font-semibold">Avg Cost Recovery</th>
                <th className="px-4 py-2 text-left font-semibold">Waitlist</th>
                <th className="px-4 py-2 text-left font-semibold">Net P/(L)</th>
              </tr></thead>
              <tbody>{areaRollup.map((r,i)=>(
                <tr key={r.area} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-4 py-2.5 font-semibold text-slate-700">{r.area}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.count}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{width:`${Math.min(r.avgFill*100,100)}%`,backgroundColor:r.avgFill>=0.7?"#22c55e":r.avgFill>=0.6?"#eab308":"#ef4444"}}/>
                      </div>
                      <span className="font-mono text-xs">{pct(r.avgFill)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{pct(r.avgCR)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.waitlist>0?<span className="text-amber-600 font-semibold">{r.waitlist}</span>:"—"}</td>
                  <td className={`px-4 py-2.5 font-mono text-xs font-semibold ${r.profit>=0?"text-green-700":"text-red-600"}`}>{dollar(r.profit)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Program Detail ── */}
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
          <div className="p-8 text-center text-slate-400 text-sm">No programs found. <button onClick={onAddProgram} className="text-amber-600 font-semibold underline">Add a program.</button></div>
        ) : dv==="summary" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                {[["name","Program"],["staff_name","Staff"],["area","Area"],["season","Season"],["fillRate","Fill Rate"],["costRecovery","Cost Recovery"],["profitLoss","Net P/(L)"],["totalCost","Total Cost"],["waitlist","Waitlist"],["trend","Trend"],["status","Status"],[null,""]].map(([col,h])=>(
                  <th key={h} className={col?`px-3 py-2 text-left font-semibold cursor-pointer hover:text-slate-700 select-none ${sort.col===col?"text-slate-700":""}`:"px-3 py-2"}
                    onClick={col?()=>toggleSort(col):undefined}>
                    {h}{col&&<span className="ml-1 text-slate-300">{sortIcon(col)}</span>}
                  </th>
                ))}
              </tr></thead>
              <tbody>{sortedKpis.map((p,i)=>(
                <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-700">
                    <div className="flex items-center gap-1.5">
                      <button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button>
                      {p.notes&&<span title={p.notes} className="text-slate-300 hover:text-slate-500 cursor-help text-xs">●</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 text-xs">{p.staff_name}</td>
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
                  <td className="px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap"><button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button></td>
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
                  <button onClick={()=>onEdit(p)} className="font-semibold text-slate-700 hover:text-blue-600 hover:underline text-left">{p.name}</button>
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

      {/* ── Status Guide ── */}
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

// ─── Dashboard router ─────────────────────────────────────────────────────────
function Dashboard({programs,staffName,isManager,onEdit,onAddProgram}) {
  if(isManager) return <ManagerDashboard programs={programs} staffName={staffName} onEdit={onEdit} onAddProgram={onAddProgram}/>;
  return <StaffDashboard programs={programs} staffName={staffName} onEdit={onEdit} onAddProgram={onAddProgram}/>;
}

// ─── Multi-Season View ────────────────────────────────────────────────────────
function MultiSeasonView({programs,onEdit}) {
  const [search,setSearch] = useState("");
  const groups = useMemo(()=>{
    const map = {};
    programs.forEach(p=>{
      const key = `${p.name}__${p.area}__${p.staff_name}`;
      if(!map[key]) map[key]={name:p.name,area:p.area,staff:p.staff_name,seasons:[]};
      const k = calcKPIs(p);
      map[key].seasons.push({...p,...k});
    });
    return Object.values(map)
      .filter(g=>g.seasons.length>1)
      .filter(g=>!search||g.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a,b)=>a.name.localeCompare(b.name));
  },[programs,search]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm px-4 py-3">
        <input className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2"
          placeholder="Search programs..." value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>
      {groups.length===0&&(
        <div className="bg-white rounded-lg shadow-sm p-8 text-center text-slate-400 text-sm">
          {search?"No matching programs.":"No programs with multiple seasons yet."}
        </div>
      )}
      {groups.map(g=>(
        <div key={g.name+g.area} className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="font-bold text-slate-700">{g.name}</div>
              <div className="text-xs text-slate-400">{g.area}{g.staff?" — "+g.staff:""}</div>
            </div>
            <span className="text-xs text-slate-400">{g.seasons.length} seasons</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Season</th>
                <th className="px-4 py-2 text-left font-semibold">Fill Rate</th>
                <th className="px-4 py-2 text-left font-semibold">Cost Recovery</th>
                <th className="px-4 py-2 text-left font-semibold">Net P/(L)</th>
                <th className="px-4 py-2 text-left font-semibold">Enrollment</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-left font-semibold">Trend</th>
                <th className="px-4 py-2"/>
              </tr></thead>
              <tbody>{g.seasons.sort((a,b)=>`${a.year}${a.season}`.localeCompare(`${b.year}${b.season}`)).map((s,i)=>(
                <tr key={s.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-4 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{s.season} {s.year}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{pct(s.fillRate)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{pct(s.costRecovery)}</td>
                  <td className={`px-4 py-2.5 font-mono text-xs font-semibold ${s.profitLoss>=0?"text-green-700":"text-red-600"}`}>{dollar(s.profitLoss)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{s.act_enrollment||0}</td>
                  <td className="px-4 py-2.5"><Badge status={s.status}/></td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{s.trend}</td>
                  <td className="px-4 py-2.5"><button onClick={()=>onEdit(s)} className="text-xs text-slate-400 hover:text-slate-700">Edit</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Program Form ─────────────────────────────────────────────────────────────
function ProgramForm({initial,staffName,isManager,onSave,onDelete,onDuplicate,onCancel,saving}) {
  const [p,setP]         = useState(initial ? cleanForDB(initial) : newProgram(staffName));
  const set              = k => v => setP(prev=>({...prev,[k]:v}));
  const [sec,setSec]     = useState("info");
  const [confirm,setConfirm] = useState(false);
  const isNew            = !initial;
  const canEdit          = p.staff_name===staffName||!initial||isManager;
  const k                = calcKPIs(p);
  const hasActuals       = k.hasActuals;
  const lastUpdated      = initial?.updated_at||initial?.created_at;

  return (
    <div className="space-y-4">
      {confirm&&(
        <ConfirmModal
          message={`Permanently delete "${p.name}"? This cannot be undone.`}
          onConfirm={()=>onDelete(p.id)}
          onCancel={()=>setConfirm(false)}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-700">{isNew?"Add Program":"Edit Program"}</h2>
          {lastUpdated&&<div className="text-xs text-slate-400 mt-0.5">Last updated {new Date(lastUpdated).toLocaleDateString()}</div>}
        </div>
        <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-600">Back</button>
      </div>

      {!canEdit&&(
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          This program was entered by <strong>{p.staff_name}</strong>. View only.
        </div>
      )}
      {!hasActuals&&!isNew&&(
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
          No actuals entered yet. Switch to the <button onClick={()=>setSec("actuals")} className="underline font-semibold">Actuals tab</button> to add them.
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
                <Inp label="NPS Score"           type="number" value={p.nps}        onChange={set("nps")}      min={0} max={100} hint="0-100"/>
                <Inp label="Waitlist"            type="number" value={p.waitlist||0} onChange={set("waitlist")} min={0}/>
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
            {!isNew&&<button onClick={()=>setConfirm(true)} className="px-4 py-2 text-sm text-red-500 hover:text-red-700 font-medium">Delete</button>}
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

// ─── Programs List ────────────────────────────────────────────────────────────
function ProgramsList({programs,isManager,staffName,onEdit,onAdd,onBulkDup,onDupSingle}) {
  const [sf,setSf] = useState(isManager?"All":staffName);
  const [af,setAf] = useState("All");
  const [yf,setYf] = useState("All");
  const [search,setSearch] = useState("");

  const allStaff = ["All",...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas = ["All",...new Set(programs.map(p=>p.area))];
  const allYears = ["All",...YEARS];
  const selCls   = "rounded border border-slate-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400";

  const vis = programs
    .filter(p=>sf==="All"||p.staff_name===sf)
    .filter(p=>af==="All"||p.area===af)
    .filter(p=>yf==="All"||p.year===yf)
    .filter(p=>!search||p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-slate-700">All Programs ({programs.length})</h2>
        <div className="flex gap-2">
          {isManager&&(
            <button onClick={onBulkDup}
              className="text-xs font-semibold px-3 py-2 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition">
              Bulk Season Rollover
            </button>
          )}
          <button onClick={onAdd} className="text-xs font-bold px-3 py-2 rounded text-white" style={{backgroundColor:"#1e3a5f"}}>+ Add Program</button>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-3 items-end">
        <input className="rounded border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 min-w-[180px]"
          placeholder="Search programs..." value={search} onChange={e=>setSearch(e.target.value)}/>
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
        {(sf!=="All"||af!=="All"||yf!=="All"||search)&&(
          <button onClick={()=>{setSf(isManager?"All":staffName);setAf("All");setYf("All");setSearch("");}}
            className="text-xs text-slate-400 hover:text-slate-600 font-medium pb-1">Clear</button>
        )}
      </div>
      {vis.length===0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center text-slate-400 text-sm">No programs found.</div>
      ) : (
        <div className="space-y-2">{vis.map(p=>{
          const k = calcKPIs(p);
          const lastUpdated = p.updated_at||p.created_at;
          return (
            <div key={p.id} onClick={()=>onEdit(p)}
              className="bg-white rounded-lg shadow-sm px-4 py-3 flex items-center justify-between gap-4 hover:shadow-md transition cursor-pointer">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-semibold text-slate-700 truncate">{p.name}</div>
                  {!k.hasActuals&&<span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">No actuals</span>}
                  {p.notes&&<span className="text-slate-300 text-xs" title={p.notes}>●</span>}
                </div>
                <div className="text-xs text-slate-400">{p.area} - {p.season} {p.year} - {p.staff_name}
                  {lastUpdated&&<span className="ml-2 text-slate-300">· Updated {new Date(lastUpdated).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="hidden sm:flex gap-6 text-sm">
                <div className="text-center"><div className="text-xs text-slate-400">Fill</div><div className="font-mono font-semibold">{pct(k.fillRate)}</div></div>
                <div className="text-center"><div className="text-xs text-slate-400">Recovery</div><div className="font-mono font-semibold">{pct(k.costRecovery)}</div></div>
                <div className="text-center"><div className="text-xs text-slate-400">Net P/(L)</div><div className={`font-mono font-semibold ${k.profitLoss>=0?"text-green-700":"text-red-600"}`}>{dollar(k.profitLoss)}</div></div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={e=>{e.stopPropagation();onDupSingle(p);}}
                  className="text-xs text-slate-400 hover:text-slate-700 font-medium px-2 py-1 rounded hover:bg-slate-100 transition">Copy</button>
                <Badge status={k.status}/>
              </div>
            </div>
          );
        })}</div>
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
    {cat:"Open Access",                       target:"100% Subsidy",           bg:"#fee2e2",text:"#991b1b"},
    {cat:"Community Events",                  target:"80-100% Subsidy",        bg:"#fee2e2",text:"#991b1b"},
    {cat:"Specialty Events",                  target:"0-5% Subsidy",           bg:"#fef9c3",text:"#854d0e"},
    {cat:"Beg. / Intro. Activities",          target:"100% Cost Recovery",     bg:"#dcfce7",text:"#166534"},
    {cat:"Drop In Activities",                target:"100-105% Cost Recovery", bg:"#dcfce7",text:"#166534"},
    {cat:"Childcare Services",                target:"110-130% Cost Recovery", bg:"#d1fae5",text:"#065f46"},
    {cat:"Intermediate / Adv. Activities",    target:"110-130% Cost Recovery", bg:"#d1fae5",text:"#065f46"},
    {cat:"Private / Semi-Private Activities", target:"130-150% Cost Recovery", bg:"#a7f3d0",text:"#064e3b"},
    {cat:"Specialized Activities",            target:"130-150% Cost Recovery", bg:"#a7f3d0",text:"#064e3b"},
    {cat:"Rentals",                           target:"130-150% Cost Recovery", bg:"#a7f3d0",text:"#064e3b"},
    {cat:"Retail & Consumables",              target:"130-150% Cost Recovery", bg:"#a7f3d0",text:"#064e3b"},
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
  const [showBulkDup,setShowBulkDup]       = useState(false);
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
      await fetchAll(); setEditingProgram(null); setAddingProgram(false); setTab("programs");
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
      delete base.id; delete base.created_at;
      const actClear = {act_capacity:0,act_enrollment:0,act_revenue:0,act_personnel:0,act_commodities:0,act_contractuals:0,act_other1:0,act_other2:0,act_facility_hours:0,act_program_type:"",act_custom_workload:0};
      const antClear = carry ? {} : {ant_capacity:0,ant_enrollment:0,ant_revenue:0,ant_personnel:0,ant_commodities:0,ant_contractuals:0,ant_other1:0,ant_other2:0,ant_facility_hours:0,ant_program_type:"",ant_custom_workload:0};
      const{error:e}=await supabase.from("programs").insert({...base,...actClear,...antClear,season,year});
      if(e) throw e;
      await fetchAll(); setDupProgram(null); setEditingProgram(null); setAddingProgram(false); setTab("programs");
    } catch(e){ setError("Failed to duplicate: "+(e.message||"unknown error")); }
    setSaving(false);
  };

  const handleBulkDuplicate = async ({ids,season,year,carry}) => {
    setSaving(true); setError(null);
    try {
      const sources = programs.filter(p=>ids.includes(p.id));
      const inserts = sources.map(source=>{
        const base = cleanForDB(source);
        delete base.id; delete base.created_at;
        const actClear = {act_capacity:0,act_enrollment:0,act_revenue:0,act_personnel:0,act_commodities:0,act_contractuals:0,act_other1:0,act_other2:0,act_facility_hours:0,act_program_type:"",act_custom_workload:0};
        const antClear = carry ? {} : {ant_capacity:0,ant_enrollment:0,ant_revenue:0,ant_personnel:0,ant_commodities:0,ant_contractuals:0,ant_other1:0,ant_other2:0,ant_facility_hours:0,ant_program_type:"",ant_custom_workload:0};
        return {...base,...actClear,...antClear,season,year};
      });
      const{error:e}=await supabase.from("programs").insert(inserts);
      if(e) throw e;
      await fetchAll(); setShowBulkDup(false); setTab("programs");
    } catch(e){ setError("Failed to bulk duplicate: "+(e.message||"unknown error")); }
    setSaving(false);
  };

  const tabs = [
    {id:"dashboard",label:"Dashboard"},
    {id:"programs",label:"Programs"},
    {id:"history",label:"Multi-Season"},
    {id:"kpi",label:"Reference"},
  ];
  const showingForm = editingProgram||addingProgram;

  if(!staffName) return <StaffSetup onConfirm={handleConfirmName}/>;

  return (
    <div className="min-h-screen" style={{background:"#f1f5f9"}}>
      {dupProgram&&(
        <DupModal program={dupProgram} onConfirm={opts=>handleDuplicate(dupProgram,opts)} onCancel={()=>setDupProgram(null)}/>
      )}
      {showBulkDup&&(
        <BulkDupModal programs={programs} onConfirm={handleBulkDuplicate} onCancel={()=>setShowBulkDup(false)}/>
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
            {error}<button onClick={()=>setError(null)} className="font-bold ml-4">×</button>
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
              <ProgramsList
                programs={programs} isManager={isManager} staffName={staffName}
                onEdit={setEditingProgram}
                onAdd={()=>setAddingProgram(true)}
                onBulkDup={()=>setShowBulkDup(true)}
                onDupSingle={setDupProgram}/>
            )}
            {tab==="programs"&&showingForm&&(
              <ProgramForm
                initial={editingProgram||null}
                staffName={staffName}
                isManager={isManager}
                onSave={handleSaveProgram}
                onDelete={handleDeleteProgram}
                onDuplicate={p=>setDupProgram(p)}
                onCancel={()=>{setEditingProgram(null);setAddingProgram(false);}}
                saving={saving}/>
            )}
            {tab==="history"&&(
              <MultiSeasonView programs={programs} onEdit={p=>{setEditingProgram(p);setTab("programs");}}/>
            )}
            {tab==="kpi"&&<Reference/>}
          </>
        )}
      </main>
    </div>
  );
}
