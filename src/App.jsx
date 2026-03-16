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
const ADMIN_NAMES          = ["admin","joe zimmermann"]; // Director-level: sees ★ Admin tab


// Service category cost recovery targets
const SVC_TARGET_MAP = {
  "Open Access":                       {min:0,    max:0,    label:"100% Subsidy",           expectSubsidy:true},
  "Community Events":                  {min:0,    max:0.2,  label:"80-100% Subsidy",         expectSubsidy:true},
  "Specialty Events":                  {min:0.95, max:1.05, label:"0-5% Subsidy",            expectSubsidy:false},
  "Beg./Intro. Activities":            {min:1.0,  max:1.05, label:"100% Cost Recovery",      expectSubsidy:false},
  "Drop In Activities":                {min:1.0,  max:1.05, label:"100-105% Cost Recovery",  expectSubsidy:false},
  "Childcare Services":                {min:1.1,  max:1.3,  label:"110-130% Cost Recovery",  expectSubsidy:false},
  "Intermediate/Adv. Activities":      {min:1.1,  max:1.3,  label:"110-130% Cost Recovery",  expectSubsidy:false},
  "Private/Semi-Private Activities":   {min:1.3,  max:1.5,  label:"130-150% Cost Recovery",  expectSubsidy:false},
  "Specialized Activities":            {min:1.3,  max:1.5,  label:"130-150% Cost Recovery",  expectSubsidy:false},
  "Rentals":                           {min:1.3,  max:1.5,  label:"130-150% Cost Recovery",  expectSubsidy:false},
  "Retail & Consumables":              {min:1.3,  max:1.5,  label:"130-150% Cost Recovery",  expectSubsidy:false},
};
function getSvcTarget(svc, cr) {
  const t = SVC_TARGET_MAP[svc]; if(!t) return null;
  const onTarget = t.expectSubsidy ? (cr <= t.max + 0.01) : (cr >= t.min);
  return {onTarget, label:t.label};
}
function getLastUsed(staffName) {
  try { return JSON.parse(localStorage.getItem("bgpd_lastused_"+staffName)||"{}"); } catch{return {};}
}
function saveLastUsed(staffName, patch) {
  try { const p=getLastUsed(staffName); localStorage.setItem("bgpd_lastused_"+staffName, JSON.stringify({...p,...patch})); } catch{}
}
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
  "decision_log",
  "is_archived",
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
  const last = getLastUsed(staffName);
  return {
    name:"", area:last.area||"Youth Sports", season:last.season||"Summer", year:last.year||"2026",
    classification:last.classification||"Community Driven", service_category:last.service_category||"",
    trend:"Stable", nps:0, notes:"", staff_name: staffName||"", waitlist:0,
    ant_capacity:0, ant_enrollment:0, ant_revenue:0,
    ant_personnel:0, ant_commodities:0, ant_contractuals:0,
    ant_other1:0, ant_other2:0, ant_facility_hours:0,
    ant_program_type:last.program_type||"", ant_custom_workload:0,
    act_capacity:0, act_enrollment:0, act_revenue:0,
    act_personnel:0, act_commodities:0, act_contractuals:0,
    act_other1:0, act_other2:0, act_facility_hours:0,
    act_program_type:"", act_custom_workload:0,
    other1_label:"Other Direct Costs", other2_label:"Other Direct Costs 2",
    decision_log: [],
    is_archived: false,
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


// ─── Season Report (print-to-PDF) ─────────────────────────────────────────────
function printSeasonReport(programs, filters) {
  const kpis        = programs.map(p=>({...p,...calcKPIs(p)}));
  const avgFill     = kpis.length ? kpis.reduce((a,p)=>a+p.fillRate,0)/kpis.length : 0;
  const avgCR       = kpis.length ? kpis.reduce((a,p)=>a+p.costRecovery,0)/kpis.length : 0;
  const totalRev    = kpis.reduce((a,p)=>a+p.revenue,0);
  const totalCost   = kpis.reduce((a,p)=>a+p.totalCost,0);
  const totalPL     = kpis.reduce((a,p)=>a+p.profitLoss,0);
  const subsidy     = kpis.reduce((a,p)=>a+Math.max(0,-p.profitLoss),0);
  const antRev      = kpis.reduce((a,p)=>a+p.antRevenue,0);
  const antCost     = kpis.reduce((a,p)=>a+p.antTotal,0);
  const antPL       = kpis.reduce((a,p)=>a+p.antProfit,0);
  const healthy     = kpis.filter(p=>p.status==="Healthy").length;
  const monitor     = kpis.filter(p=>p.status==="Monitor").length;
  const redesign    = kpis.filter(p=>p.status==="Needs Redesign").length;
  const healthScore = kpis.length ? Math.round((avgFill*0.4+Math.min(avgCR,2)/2*0.4+(healthy/kpis.length)*0.2)*100) : 0;
  const healthColor = healthScore>=75?"#16a34a":healthScore>=50?"#b45309":"#dc2626";
  const needsWork   = [...kpis].filter(p=>p.status==="Needs Redesign"||p.fillRate<0.5).sort((a,b)=>a.fillRate-b.fillRate).slice(0,5);
  const topPerf     = [...kpis].filter(p=>p.hasActuals).sort((a,b)=>b.fillRate-a.fillRate).slice(0,5);
  const today       = new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});

  const th = `padding:6px 10px;font-weight:600;font-size:11px;background:#1e3a5f;color:white;text-align:left;`;
  const td = `padding:6px 10px;font-size:11px;border-bottom:1px solid #f1f5f9;`;
  const tdR = td+`text-align:right;font-family:monospace;`;
  const secH = `font-weight:700;font-size:13px;color:#1e3a5f;border-bottom:2px solid #d4a017;padding-bottom:4px;margin-bottom:10px;margin-top:20px;`;

  const kpiCards = [
    {label:"Programs",      value:kpis.length,     color:"#1e3a5f"},
    {label:"Avg Fill Rate", value:pct(avgFill),    color:avgFill>=0.7?"#16a34a":"#dc2626"},
    {label:"Avg Recovery",  value:pct(avgCR),      color:avgCR>=1?"#16a34a":"#dc2626"},
    {label:"Total Net P/L", value:dollar(totalPL), color:totalPL>=0?"#16a34a":"#dc2626"},
    {label:"Subsidy",       value:dollar(subsidy), color:"#991b1b"},
  ].map(c=>`<div style="border:1px solid #e2e8f0;border-top:3px solid ${c.color};border-radius:6px;padding:10px 12px;">
    <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">${c.label}</div>
    <div style="font-size:16px;font-weight:800;color:${c.color};margin-top:2px;">${c.value}</div>
  </div>`).join("");

  const statusCards = [
    {label:"Healthy",       value:healthy,  p:kpis.length?Math.round(healthy/kpis.length*100):0,  color:"#16a34a",bg:"#dcfce7"},
    {label:"Monitor",       value:monitor,  p:kpis.length?Math.round(monitor/kpis.length*100):0,  color:"#b45309",bg:"#fef9c3"},
    {label:"Needs Redesign",value:redesign, p:kpis.length?Math.round(redesign/kpis.length*100):0, color:"#dc2626",bg:"#fee2e2"},
  ].map(c=>`<div style="background:${c.bg};border-radius:6px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:12px;font-weight:600;color:${c.color};">${c.label}</div>
    <div style="font-size:18px;font-weight:800;color:${c.color};">${c.value} <span style="font-size:11px;font-weight:500;">(${c.p}%)</span></div>
  </div>`).join("");

  const finRows = [
    {label:"Total Revenue", bud:antRev,  act:totalRev},
    {label:"Total Cost",    bud:antCost, act:totalCost, inv:true},
    {label:"Net P/(L)",     bud:antPL,   act:totalPL},
  ].map((r,i)=>{
    const v=r.act-r.bud; const good=r.inv?v<=0:v>=0;
    return `<tr style="background:${i%2===0?"white":"#f8fafc"}">
      <td style="${td}font-weight:600;">${r.label}</td>
      <td style="${tdR}">${dollar(r.bud)}</td>
      <td style="${tdR}">${dollar(r.act)}</td>
      <td style="${tdR}color:${good?"#16a34a":"#dc2626"};font-weight:700;">${v>=0?"+":""}${dollar(v)}</td>
    </tr>`;
  }).join("");

  const topRows = topPerf.map((p,i)=>`<tr style="background:${i%2===0?"white":"#f8fafc"}">
    <td style="${td}font-weight:600;">${p.name}</td>
    <td style="${td}">${p.staff_name}</td>
    <td style="${td}">${p.area}</td>
    <td style="${tdR}color:${p.fillRate>=0.7?"#16a34a":"#dc2626"};font-weight:700;">${pct(p.fillRate)}</td>
    <td style="${tdR}color:${p.costRecovery>=1?"#16a34a":"#dc2626"};font-weight:700;">${pct(p.costRecovery)}</td>
    <td style="${tdR}color:${p.profitLoss>=0?"#16a34a":"#dc2626"};font-weight:700;">${dollar(p.profitLoss)}</td>
    <td style="${td}">${p.status}</td>
  </tr>`).join("");

  const attnRows = needsWork.map((p,i)=>`<tr style="background:${i%2===0?"white":"#fff5f5"}">
    <td style="${td}font-weight:600;">${p.name}</td>
    <td style="${td}">${p.staff_name}</td>
    <td style="${td}">${p.area}</td>
    <td style="${tdR}color:#dc2626;font-weight:700;">${pct(p.fillRate)}</td>
    <td style="${tdR}color:${p.costRecovery<0.5?"#dc2626":"#b45309"};font-weight:700;">${pct(p.costRecovery)}</td>
    <td style="${td}color:${p.trend==="Declining"?"#dc2626":"inherit"};">${p.trend}</td>
    <td style="${td}">${p.status}</td>
  </tr>`).join("");

  const allRows = [...kpis].sort((a,b)=>a.name.localeCompare(b.name)).map((p,i)=>`<tr style="background:${i%2===0?"white":"#f8fafc"}">
    <td style="${td}font-weight:600;">${p.name}</td>
    <td style="${td}">${p.staff_name}</td>
    <td style="${td}">${p.area}</td>
    <td style="${td}">${p.season} ${p.year}</td>
    <td style="${tdR}color:${p.fillRate>=0.7?"#16a34a":p.fillRate>=0.6?"#b45309":"#dc2626"};font-weight:600;">${pct(p.fillRate)}</td>
    <td style="${tdR}color:${p.costRecovery>=1?"#16a34a":p.costRecovery>=0.5?"#b45309":"#dc2626"};font-weight:600;">${pct(p.costRecovery)}</td>
    <td style="${tdR}color:${p.profitLoss>=0?"#16a34a":"#dc2626"};font-weight:600;">${dollar(p.profitLoss)}</td>
    <td style="${td}">${p.status}</td>
  </tr>`).join("");

  // Build the body HTML separately (no wrapping html/head/body tags)
  const bodyHTML = `
  <div style="font-family:'Segoe UI',sans-serif;color:#1e293b;background:white;width:750px;">
    <div style="background:#1e3a5f;color:white;padding:20px 28px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-weight:700;font-size:20px;">BGPD Recreation — Season Performance Report</div>
        <div style="font-size:12px;opacity:0.75;margin-top:4px;">${filters} · Generated ${today}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:28px;font-weight:900;color:${healthColor};">${healthScore}<span style="font-size:14px;font-weight:400;color:rgba(255,255,255,0.6);">/100</span></div>
        <div style="font-size:11px;opacity:0.7;">Health Score</div>
      </div>
    </div>
    <div style="padding:0 16px 28px;">
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px;">${kpiCards}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">${statusCards}</div>
      <div style="${secH}">Financial Summary</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><thead><tr>
        <th style="${th}">Metric</th><th style="${th}">Budget</th><th style="${th}">Actual</th><th style="${th}">Variance</th>
      </tr></thead><tbody>${finRows}</tbody></table>
      ${topPerf.length>0?`<div style="${secH}">Top Performers by Fill Rate</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><thead><tr>
        <th style="${th}">Program</th><th style="${th}">Staff</th><th style="${th}">Area</th><th style="${th}">Fill Rate</th><th style="${th}">Cost Recovery</th><th style="${th}">Net P/(L)</th><th style="${th}">Status</th>
      </tr></thead><tbody>${topRows}</tbody></table>`:""}
      ${needsWork.length>0?`<div style="${secH}">Programs Needing Attention</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><thead><tr>
        <th style="${th}">Program</th><th style="${th}">Staff</th><th style="${th}">Area</th><th style="${th}">Fill Rate</th><th style="${th}">Cost Recovery</th><th style="${th}">Trend</th><th style="${th}">Status</th>
      </tr></thead><tbody>${attnRows}</tbody></table>`:""}
      <div style="${secH}">All Programs</div>
      <table style="width:100%;border-collapse:collapse;"><thead><tr>
        <th style="${th}">Program</th><th style="${th}">Staff</th><th style="${th}">Area</th><th style="${th}">Season</th><th style="${th}">Fill</th><th style="${th}">Recovery</th><th style="${th}">Net P/(L)</th><th style="${th}">Status</th>
      </tr></thead><tbody>${allRows}</tbody></table>
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;">
        <span>Barrington Park District · Recreation Management System</span>
        <span>Confidential — Internal Use Only · Generated ${today}</span>
      </div>
    </div>
  </div>`;

  // Build full HTML document as a Blob and open via object URL — avoids popup blockers
  const fullHTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>BGPD Season Report</title>
  <style>
    * { font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; box-sizing: border-box; }
    body { background: white; color: #1e293b; }
    table { border-collapse: collapse; width: 100%; }
    @page { margin: 0.6in; size: letter; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
  </head><body>${bodyHTML}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 500);
      window.onafterprint = function() { window.close(); };
    };
  <\/script>
  </body></html>`;

  const blob = new Blob([fullHTML], {type: "text/html"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.target   = "_blank";
  a.rel      = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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

function KCard({label,value,sub,accent,onClick,target}) {
  return (
    <div onClick={onClick} style={{borderTop:`3px solid ${accent||"#1e3a5f"}`}}
      className={`bg-white rounded-lg p-4 shadow-sm ${onClick?"cursor-pointer hover:shadow-md transition":""}`}>
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
        {target && <div className="text-xs text-slate-300 font-medium shrink-0">↗ {target}</div>}
      </div>
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
        <span>Budget: <span className="font-semibold text-slate-600">{ff?ff(budget):budget}</span></span>
        <span>Actual: <span className="font-semibold text-slate-600">{ff?ff(actual):actual}</span></span>
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
function ConfirmModal({message,onConfirm,onCancel,confirmLabel="Delete",confirmColor="#ef4444"}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.5)"}}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="text-base font-bold text-slate-800">Are you sure?</div>
        <div className="text-sm text-slate-500">{message}</div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm font-semibold text-white rounded-lg" style={{backgroundColor:confirmColor}}>{confirmLabel}</button>
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
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input
                className="text-xs font-semibold text-slate-500 uppercase tracking-wide bg-transparent border-b border-dashed border-slate-300 focus:border-blue-400 focus:outline-none w-full"
                value={p.other1_label||"Other Direct Costs"}
                onChange={e=>set("other1_label")(e.target.value)}
                placeholder="Other Direct Costs"
                title="Click to rename this cost line"
              />
              <span className="text-xs text-slate-400 shrink-0">($)</span>
            </div>
            <input type="number" min={0} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300" value={p[px+"other1"]||""} onChange={e=>set(px+"other1")(parseFloat(e.target.value)||0)} placeholder="0"/>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input
                className="text-xs font-semibold text-slate-500 uppercase tracking-wide bg-transparent border-b border-dashed border-slate-300 focus:border-blue-400 focus:outline-none w-full"
                value={p.other2_label||"Other Direct Costs 2"}
                onChange={e=>set("other2_label")(e.target.value)}
                placeholder="Other Direct Costs 2"
                title="Click to rename this cost line"
              />
              <span className="text-xs text-slate-400 shrink-0">($)</span>
            </div>
            <input type="number" min={0} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300" value={p[px+"other2"]||""} onChange={e=>set(px+"other2")(parseFloat(e.target.value)||0)} placeholder="0"/>
          </div>
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
          <div className="text-sm text-slate-400">Enter your first and last name to get started</div>
        </div>
        <div className="space-y-4">
          <Inp label="First & Last Name" value={name} onChange={setName} placeholder="e.g. Jane Smith" required/>
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
  const [sf,setSf]           = useState("All");
  const [af,setAf]           = useState("All");
  const [yf,setYf]           = useState("All");
  const [snf,setSnf]         = useState("All");
  const [dv,setDv]           = useState("summary");
  const [showReport,setShowReport] = useState(false);

  const allStaff   = ["All",...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas   = ["All",...new Set(programs.map(p=>p.area))];
  const allYears   = ["All",...YEARS];
  const allSeasons = ["All",...SEASONS];

  const vis  = programs
    .filter(p=>!p.is_archived)
    .filter(p=>sf==="All"||p.staff_name===sf)
    .filter(p=>af==="All"||p.area===af)
    .filter(p=>yf==="All"||p.year===yf)
    .filter(p=>snf==="All"||p.season===snf);

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
  const low50    = kpis.filter(p=>p.costRecovery<0.5).length;
  const selCls = "rounded border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400 min-w-[140px]";
  const anyFilter = sf!=="All"||af!=="All"||yf!=="All"||snf!=="All";

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-4 items-end">
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
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Season</label>
          <select value={snf} onChange={e=>setSnf(e.target.value)} className={selCls}>
            {allSeasons.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Year</label>
          <select value={yf} onChange={e=>setYf(e.target.value)} className={selCls}>
            {allYears.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {anyFilter&&<button onClick={()=>{setSf("All");setAf("All");setYf("All");setSnf("All");}} className="text-xs text-slate-400 hover:text-slate-600 pb-1.5 font-medium">Clear filters</button>}
        <div className="flex gap-2 ml-auto">
          <button onClick={()=>exportCSV(vis)} className="text-xs font-semibold px-3 py-2 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition whitespace-nowrap">↓ Export CSV</button>
          <button onClick={()=>setShowReport(true)} className="text-xs font-semibold px-3 py-2 rounded transition whitespace-nowrap text-white" style={{backgroundColor:"#1e3a5f"}}>⬜ Season Report</button>
        </div>
      </div>
      {showReport&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.7)"}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
            <div className="text-base font-bold text-slate-800">Season Performance Report</div>
            <div className="text-sm text-slate-500">This will open your browser's print dialog. Choose "Save as PDF" to export.</div>
            <div className="text-xs text-slate-400">{vis.length} programs with current filters applied</div>
            <div className="flex gap-3 justify-center pt-2">
              <button onClick={()=>setShowReport(false)} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button onClick={()=>{ setShowReport(false); printSeasonReport(vis, `${sf!=="All"?`Staff: ${sf}`:"All Staff"} · ${af!=="All"?`Area: ${af}`:"All Areas"} · ${snf!=="All"?`Season: ${snf}`:"All Seasons"} · ${yf!=="All"?`Year: ${yf}`:"All Years"}`); }}
                className="px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{backgroundColor:"#1e3a5f"}}>Save as PDF</button>
            </div>
          </div>
        </div>
      )}
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
                {["Program","Staff","Area","Season","Fill Rate","Cost Recovery","Net P/(L)","Total Cost","Waitlist","Trend","Status",""].map(h=>(
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr></thead>
              <tbody>{kpis.map((p,i)=>(
                <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-700"><button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button></td>
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
  const [sf,setSf]           = useState("All");
  const [af,setAf]           = useState("All");
  const [yf,setYf]           = useState("All");
  const [snf,setSnf]         = useState("All");
  const [dv,setDv]           = useState("summary");
  const [sort,setSort]       = useState({col:"name",dir:1});
  const [showReport,setShowReport] = useState(false);

  const allStaff   = ["All",...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas   = ["All",...new Set(programs.map(p=>p.area))];
  const allYears   = ["All",...YEARS];
  const allSeasons = ["All",...SEASONS];

  const vis  = programs
    .filter(p=>!p.is_archived)
    .filter(p=>sf==="All"||p.staff_name===sf)
    .filter(p=>af==="All"||p.area===af)
    .filter(p=>yf==="All"||p.year===yf)
    .filter(p=>snf==="All"||p.season===snf);

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

  // ── Prior season lookup (same name + area, year-1 or prev season ordering) ──
  const SEASON_ORDER = ["Spring","Summer","Fall","Winter","All Year"];
  const priorMap = useMemo(()=>{
    const map={};
    // Build lookup: for each program in full `programs` array, key = name|area
    // Pick the most recent prior program that isn't itself
    kpis.forEach(cur=>{
      const candidates = programs.filter(p=>
        p.id!==cur.id &&
        p.name===cur.name &&
        p.area===cur.area &&
        (Number(p.year)<Number(cur.year) ||
         (Number(p.year)===Number(cur.year) && SEASON_ORDER.indexOf(p.season)<SEASON_ORDER.indexOf(cur.season)))
      );
      if(!candidates.length) return;
      // pick closest prior
      const sorted = candidates.sort((a,b)=>{
        const ay=Number(a.year),by2=Number(b.year),cy=Number(cur.year);
        const as2=SEASON_ORDER.indexOf(a.season),bs=SEASON_ORDER.indexOf(b.season),cs=SEASON_ORDER.indexOf(cur.season);
        const adiff = (cy-ay)*10+(cs-as2);
        const bdiff = (cy-by2)*10+(cs-bs);
        return adiff-bdiff;
      });
      const prior = sorted[0];
      const pk = calcKPIs(prior);
      map[cur.id]={
        fillDelta: cur.fillRate - pk.fillRate,
        crDelta:   cur.costRecovery - pk.costRecovery,
        label:     `${prior.season} ${prior.year}`,
      };
    });
    return map;
  },[kpis,programs]);

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
  const anyFilter = sf!=="All"||af!=="All"||yf!=="All"||snf!=="All";

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
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Season</label>
            <select value={snf} onChange={e=>setSnf(e.target.value)} className={selCls}>
              {allSeasons.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Year</label>
            <select value={yf} onChange={e=>setYf(e.target.value)} className={selCls}>
              {allYears.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {anyFilter&&<button onClick={()=>{setSf("All");setAf("All");setYf("All");setSnf("All");}} className="text-xs text-slate-400 hover:text-slate-600 pb-1.5 font-medium">Clear filters</button>}
        </div>
        <div className="flex gap-2">
          <button onClick={()=>exportCSV(vis)} className="text-xs font-semibold px-3 py-2 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition whitespace-nowrap">↓ Export CSV</button>
          <button onClick={()=>setShowReport(true)} className="text-xs font-semibold px-3 py-2 rounded transition whitespace-nowrap text-white" style={{backgroundColor:"#1e3a5f"}}>⬜ Season Report</button>
        </div>
      </div>
      {showReport&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.7)"}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
            <div className="text-base font-bold text-slate-800">Season Performance Report</div>
            <div className="text-sm text-slate-500">This will open your browser's print dialog. Choose "Save as PDF" to export.</div>
            <div className="text-xs text-slate-400">Filters applied: {sf!=="All"?`Staff: ${sf} · `:""}{ af!=="All"?`Area: ${af} · `:""}{ yf!=="All"?`Year: ${yf}`:"All Programs"} · {vis.length} programs</div>
            <div className="flex gap-3 justify-center pt-2">
              <button onClick={()=>setShowReport(false)} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button onClick={()=>{ setShowReport(false); printSeasonReport(vis, `${sf!=="All"?`Staff: ${sf}`:"All Staff"} · ${af!=="All"?`Area: ${af}`:"All Areas"} · ${snf!=="All"?`Season: ${snf}`:"All Seasons"} · ${yf!=="All"?`Year: ${yf}`:"All Years"}`); }}
                className="px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{backgroundColor:"#1e3a5f"}}>Save as PDF</button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── KPI Row 1 — headline metrics ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div style={{borderTop:`3px solid ${healthColor}`}} className="bg-white rounded-lg p-4 shadow-sm">
          <div className="flex items-start justify-between gap-1 mb-1">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Health Score</div>
          </div>
          <div className="text-2xl font-bold" style={{color:healthColor}}>{healthScore}<span className="text-sm font-normal text-slate-400">/100</span></div>
          <div className="text-xs text-slate-400 mt-0.5">Fill · Recovery · Status</div>
        </div>
        <KCard label="Avg Fill Rate"     value={pct(avgFill)}    accent="#d4a017" target="≥70%"/>
        <KCard label="Avg Cost Recovery" value={pct(avgCR)}      accent="#d4a017" target="≥100%"/>
        <KCard label="Total Net P/(L)"   value={dollar(surplus)} accent={surplus>=0?"#22c55e":"#ef4444"}/>
        <div style={{borderTop:"3px solid #991b1b",background:"#fff1f2"}} className="rounded-lg p-4 shadow-sm border border-red-200">
          <div className="flex items-start justify-between gap-1 mb-1">
            <div className="text-xs font-bold text-red-700 uppercase tracking-wider">⚠ Subsidy</div>
            {actCost>0&&<div className="text-xs font-semibold text-red-400 shrink-0">{pct(subsidyBurden/actCost)} of cost</div>}
          </div>
          <div className="text-2xl font-black text-red-700">{dollar(subsidyBurden)}</div>
          <div className="text-xs text-red-400 mt-0.5">tax dollars supporting programs</div>
        </div>
        <KCard label="Programs"          value={vis.length}      accent="#1e3a5f"
          sub={`${noActuals} missing actuals`}/>
      </div>

      {/* ── KPI Row 2 — status distribution ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KCard label="Healthy"          value={healthy}   sub={`${kpis.length>0?Math.round(healthy/kpis.length*100):0}% of programs`} accent="#22c55e"/>
        <KCard label="Monitor"          value={monitor}   sub={`${kpis.length>0?Math.round(monitor/kpis.length*100):0}% of programs`} accent="#eab308"/>
        <KCard label="Needs Redesign"   value={redesign}  sub={`${kpis.length>0?Math.round(redesign/kpis.length*100):0}% of programs`} accent="#ef4444"/>
        <KCard label="Missing Actuals"  value={noActuals} sub="programs without actuals" accent="#f97316"/>
      </div>

      {/* ── KPI Row 3 — financial detail ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KCard label="Total Revenue"     value={dollar(actRev)}    accent="#22c55e"/>
        <KCard label="Total Cost"        value={dollar(actCost)}   accent="#64748b"/>
        <KCard label="Rev / Participant" value={totalActEnr>0?dollar(revPerPart):"—"} sub="portfolio avg" accent="#1e3a5f"/>
        <KCard label="Waitlist Demand"   value={pct(waitlistPct)}  sub={`${totalWaitlist} on waitlists`} accent="#d4a017"/>
      </div>

      {/* ── Program Snapshot bars ── */}
      <div className="bg-white rounded-lg shadow-sm p-5 space-y-5">
        <h3 className="font-bold text-slate-700 text-sm">Program Snapshot: Budgeted vs Actual</h3>
        <PBar label="Total Revenue"      actual={actRev}  budget={antRev}  ff={v=>dollar(v)}/>
        <PBar label="Total Enrollment"   actual={actEnr}  budget={antEnr}  ff={v=>v.toString()}/>
        <PBar label="Total Program Cost" actual={actCost} budget={antCost} ff={v=>dollar(v)} inv/>
      </div>

      {/* ── Programs by Area ── */}
      {areaRollup.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-700 text-sm">Programs by Area</h3>
            <p className="text-xs text-slate-400 mt-0.5">Inventory distribution across program areas</p>
          </div>
          <div className="p-4 space-y-2.5">
            {[...areaRollup].sort((a,b)=>b.count-a.count).map(r=>{
              const barW = Math.round((r.count/kpis.length)*100);
              const barColor = r.avgFill>=0.7?"#22c55e":r.avgFill>=0.6?"#eab308":"#ef4444";
              const healthyN  = kpis.filter(p=>p.area===r.area&&p.status==="Healthy").length;
              const redesignN = kpis.filter(p=>p.area===r.area&&p.status==="Needs Redesign").length;
              return (
                <div key={r.area}>
                  <div className="flex items-center justify-between mb-1 gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-slate-700 truncate">{r.area}</span>
                      <span className="text-xs text-slate-400 shrink-0">{r.count} program{r.count!==1?"s":""}</span>
                      {healthyN>0&&<span className="text-xs font-semibold text-green-600 shrink-0">{healthyN} healthy</span>}
                      {redesignN>0&&<span className="text-xs font-semibold text-red-500 shrink-0">{redesignN} needs redesign</span>}
                    </div>
                    <span className={`text-xs font-mono font-semibold shrink-0 ${r.profit>=0?"text-green-700":"text-red-600"}`}>{dollar(r.profit)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{width:`${barW}%`,backgroundColor:barColor}}/>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-slate-400 pt-1">Bar width = share of total programs · Bar color = avg fill rate (green ≥70%, yellow 60–69%, red &lt;60%)</p>
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
            <p className="text-xs text-slate-400 mt-0.5">Overall avg: {totalActEnr>0?dollar(revPerPart):"—"}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Area</th>
                <th className="px-4 py-2 text-left font-semibold">Participants</th>
                <th className="px-4 py-2 text-left font-semibold">Revenue</th>
                <th className="px-4 py-2 text-left font-semibold">Rev / Participant</th>
              </tr></thead>
              <tbody>{rppByArea.filter(r=>r.enr>0).map((r,i)=>(
                <tr key={r.area} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-4 py-2.5 font-semibold text-slate-700">{r.area}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.enr}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{dollar(r.rev)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-bold">{dollar(r.rpp)}</td>
                </tr>
              ))}</tbody>
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

      {/* ── Capacity Utilization by Area ── */}
      {areaRollup.length>1&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-700 text-sm">Capacity Utilization by Area</h3>
            <p className="text-xs text-slate-400 mt-0.5">Avg fill rate per area — green ≥70%, yellow 60–69%, red &lt;60%</p>
          </div>
          <div className="p-4 space-y-3">
            {[...areaRollup].sort((a,b)=>b.avgFill-a.avgFill).map(r=>{
              const fillColor = r.avgFill>=0.7?"#22c55e":r.avgFill>=0.6?"#eab308":"#ef4444";
              return(
                <div key={r.area}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-700">{r.area}</span>
                      <span className="text-xs text-slate-400">{r.count} program{r.count!==1?"s":""}</span>
                      {r.waitlist>0&&<span className="text-xs font-semibold text-amber-600">{r.waitlist} waitlisted</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span className="font-bold" style={{color:fillColor}}>{pct(r.avgFill)} fill</span>
                      <span className="text-slate-400">{pct(r.avgCR)} CR</span>
                      <span className={r.profit>=0?"text-green-700 font-semibold":"text-red-600 font-semibold"}>{dollar(r.profit)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width:`${Math.min(r.avgFill*100,100)}%`,backgroundColor:fillColor}}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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


      {/* ── Program Detail ── */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-wrap gap-2">
          <div>
            <h2 className="font-bold text-slate-700 text-sm">Program Detail</h2>
            {dv==="summary"&&<p className="text-xs text-slate-400 mt-0.5">Year-over-year in <span className="font-semibold text-slate-500">vs Prior</span> column · Full trend history in <span className="font-semibold text-amber-600">Multi-Season</span> tab</p>}
          </div>
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
                {[["name","Program"],["staff_name","Staff"],["area","Area"],["season","Season"],["fillRate","Fill Rate"],["costRecovery","Cost Recovery"],["profitLoss","Net P/(L)"],["totalCost","Total Cost"],["waitlist","Waitlist"],["trend","Trend"],["status","Status"],[null,"vs Prior"],[null,""]].map(([col,h])=>(
                  <th key={h} className={col?`px-3 py-2 text-left font-semibold cursor-pointer hover:text-slate-700 select-none ${sort.col===col?"text-slate-700":""}`:"px-3 py-2 text-left font-semibold"}
                    onClick={col?()=>toggleSort(col):undefined}>
                    {h}{col&&<span className="ml-1 text-slate-300">{sortIcon(col)}</span>}
                  </th>
                ))}
              </tr></thead>
              <tbody>{sortedKpis.map((p,i)=>{
                const prior = priorMap[p.id];
                return (
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
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {prior ? (
                      <div className="text-xs space-y-0.5">
                        <div className={`font-mono font-semibold ${prior.fillDelta>=0?"text-green-600":"text-red-500"}`}>
                          Fill: {prior.fillDelta>=0?"+":""}{(prior.fillDelta*100).toFixed(1)}pp
                        </div>
                        <div className={`font-mono font-semibold ${prior.crDelta>=0?"text-green-600":"text-red-500"}`}>
                          CR: {prior.crDelta>=0?"+":""}{(prior.crDelta*100).toFixed(1)}pp
                        </div>
                        <div className="text-slate-300">vs {prior.label}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><button onClick={()=>onEdit(p)} className="text-xs text-slate-400 hover:text-slate-700 font-medium">Edit</button></td>
                </tr>
                );
              })}</tbody>
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
function ProgramForm({initial,staffName,isManager,onSave,onDelete,onArchive,onDuplicate,onCancel,saving}) {
  const [p,setP]             = useState(()=> initial ? {...cleanForDB(initial), decision_log: initial.decision_log||[], other1_label: initial.other1_label||"Other Direct Costs", other2_label: initial.other2_label||"Other Direct Costs 2"} : newProgram(staffName));
  const set                  = k => v => setP(prev=>({...prev,[k]:v}));
  const [sec,setSec]         = useState("info");
  const [confirm,setConfirm]         = useState(false);
  const [confirmArchive,setConfirmArchive] = useState(false);
  const [logEntry,setLogEntry] = useState("");
  const [dirty,setDirty]     = useState(false);
  const isNew                = !initial;
  const canEdit              = p.staff_name===staffName||!initial||isManager;
  const k                    = calcKPIs(p);
  const hasActuals           = k.hasActuals;
  const lastUpdated          = initial?.updated_at||initial?.created_at;
  const svcTarget            = getSvcTarget(p.service_category, k.costRecovery);
  const log                  = Array.isArray(p.decision_log) ? p.decision_log : [];

  // Track dirty state
  const setField = key => val => { setP(prev=>({...prev,[key]:val})); setDirty(true); };

  // Keyboard shortcut: Escape = back (with confirm if dirty), Ctrl/Cmd+S = save
  useEffect(()=>{
    const handler = e => {
      if((e.ctrlKey||e.metaKey)&&e.key==="s"){ e.preventDefault(); if(canEdit&&p.name&&!saving) handleSave(); }
      if(e.key==="Escape"){ handleBack(); }
    };
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  });

  const handleBack = () => {
    if(dirty && !window.confirm("You have unsaved changes. Leave anyway?")) return;
    onCancel();
  };

  const handleSave = () => {
    saveLastUsed(staffName, {area:p.area, season:p.season, year:p.year, classification:p.classification, service_category:p.service_category, program_type:p.ant_program_type});
    setDirty(false);
    onSave(p);
  };

  const addLogEntry = () => {
    if(!logEntry.trim()) return;
    const entry = {date: new Date().toISOString(), author: staffName, text: logEntry.trim()};
    const updated = [entry, ...log];
    setP(prev=>({...prev, decision_log: updated}));
    setLogEntry("");
    setDirty(true);
  };

  const tabs = [{id:"info",label:"Program Info"},{id:"budgeted",label:"Budgeted"},{id:"actuals",label:"Actuals"},{id:"summary",label:"Summary"},{id:"log",label:`Log${log.length>0?" ("+log.length+")":""}`}];

  return (
    <div className="space-y-4">
      {confirm&&(
        <ConfirmModal
          message={`Permanently delete "${p.name}"? This cannot be undone.`}
          onConfirm={()=>onDelete(p.id)}
          onCancel={()=>setConfirm(false)}
        />
      )}
      {confirmArchive&&(
        <ConfirmModal
          message={p.is_archived ? `Restore "${p.name}" to active programs?` : `Archive "${p.name}"? It will be hidden from dashboards and reports but can be restored later.`}
          onConfirm={()=>onArchive(p.id, !p.is_archived)}
          onCancel={()=>setConfirmArchive(false)}
          confirmLabel={p.is_archived?"Restore":"Archive"}
          confirmColor={p.is_archived?"#16a34a":"#64748b"}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-slate-700">{isNew?"Add Program":"Edit Program"}</h2>
            {dirty&&<span className="text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-medium">Unsaved</span>}
          </div>
          {lastUpdated&&<div className="text-xs text-slate-400 mt-0.5">Last updated {new Date(lastUpdated).toLocaleDateString()}</div>}
        </div>
        <button onClick={handleBack} className="text-sm text-slate-400 hover:text-slate-600">Back</button>
      </div>

      {p.is_archived&&(
        <div className="bg-slate-100 border border-slate-300 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-600 font-medium">📦 This program is archived and hidden from dashboards and reports.</span>
          {canEdit&&<button onClick={()=>setConfirmArchive(true)} className="text-sm font-semibold text-green-700 hover:underline">Restore</button>}
        </div>
      )}
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

      {/* Service category target banner */}
      {svcTarget&&hasActuals&&(
        <div className={`rounded-lg px-4 py-2.5 flex items-center gap-3 border text-sm ${svcTarget.onTarget?"bg-green-50 border-green-200 text-green-800":"bg-amber-50 border-amber-200 text-amber-800"}`}>
          <span className="text-base">{svcTarget.onTarget?"✓":"⚠"}</span>
          <div>
            <span className="font-semibold">{p.service_category} target: {svcTarget.label}</span>
            <span className="ml-2 font-normal opacity-75">— Actual cost recovery: {pct(k.costRecovery)}</span>
            {!svcTarget.onTarget&&<span className="ml-2 text-amber-700 font-medium">Not yet on target.</span>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {tabs.map(s=>(
            <button key={s.id} onClick={()=>setSec(s.id)}
              className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${sec===s.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`}
              style={sec===s.id?{borderColor:"#d4a017"}:{}}>{s.label}</button>
          ))}
        </div>
        <div className="p-5">
          {sec==="info"&&(
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Inp label="Program Name"        value={p.name}                 onChange={setField("name")}              required placeholder="e.g. Youth Basketball"/>
                <Inp label="Staff Member"        value={p.staff_name}           onChange={setField("staff_name")}        required placeholder="Your name"/>
                <Inp label="Area"                value={p.area}                 onChange={setField("area")}              options={AREAS}/>
                <Inp label="Season"              value={p.season}               onChange={setField("season")}            options={SEASONS}/>
                <Inp label="Year"                value={p.year}                 onChange={setField("year")}              options={YEARS}/>
                <Inp label="Classification"      value={p.classification}       onChange={setField("classification")}    options={CLASSIFICATIONS}/>
                <div>
                  <Inp label="Service Category"  value={p.service_category||""} onChange={setField("service_category")} options={["",...SERVICE_CATEGORIES]}/>
                  {p.service_category&&SVC_TARGET_MAP[p.service_category]&&(
                    <div className="mt-1 text-xs text-slate-400">Target: <span className="font-semibold text-slate-500">{SVC_TARGET_MAP[p.service_category].label}</span></div>
                  )}
                </div>
                <Inp label="Participation Trend" value={p.trend}                onChange={setField("trend")}             options={TRENDS}/>
                <Inp label="NPS Score"           type="number" value={p.nps}        onChange={setField("nps")}      min={0} max={100} hint="0-100"/>
                <Inp label="Waitlist"            type="number" value={p.waitlist||0} onChange={setField("waitlist")} min={0}/>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
                <textarea className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none" rows={3}
                  placeholder="Strategy notes, drivers, multi-year context..."
                  value={p.notes||""} onChange={e=>{setP(prev=>({...prev,notes:e.target.value}));setDirty(true);}}/>
              </div>
            </div>
          )}
          {sec==="budgeted"&&(
            <div>
              <div className="mb-5 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <div className="text-xs font-bold text-blue-600 uppercase tracking-widest">Budgeted</div>
                <div className="text-xs text-blue-400 mt-0.5">What you think this program will do. You can update these at any time.</div>
              </div>
              <CostPanel px="ant_" p={p} set={k=>v=>{setField(k)(v);}} />
            </div>
          )}
          {sec==="actuals"&&(
            <div>
              <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Actuals</div>
                <div className="text-xs text-slate-400 mt-0.5">Update these as the program runs or after it concludes.</div>
              </div>
              <CostPanel px="act_" p={p} set={k=>v=>{setField(k)(v);}} />
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
              {svcTarget&&hasActuals&&(
                <div className={`rounded-lg px-3 py-2 flex items-center gap-2 text-xs border ${svcTarget.onTarget?"bg-green-50 border-green-200 text-green-800":"bg-amber-50 border-amber-200 text-amber-800"}`}>
                  <span>{svcTarget.onTarget?"✓":"⚠"}</span>
                  <span><strong>{p.service_category}</strong> target: {svcTarget.label} · Actual: {pct(k.costRecovery)}</span>
                </div>
              )}
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
          {sec==="log"&&(
            <div className="space-y-4">
              <div className="text-xs text-slate-400 mb-2">Record decisions, fee changes, pivots, or anything worth remembering. Each entry is timestamped automatically.</div>
              {canEdit&&(
                <div className="flex gap-2">
                  <input className="flex-1 rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder='e.g. "Dropped fee from $85 to $65 to boost enrollment"'
                    value={logEntry} onChange={e=>setLogEntry(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addLogEntry();}}}/>
                  <button onClick={addLogEntry} disabled={!logEntry.trim()}
                    className="px-4 py-2 text-sm font-semibold text-white rounded disabled:opacity-40"
                    style={{backgroundColor:"#1e3a5f"}}>Add</button>
                </div>
              )}
              {log.length===0?(
                <div className="text-center py-8 text-slate-300 text-sm">No entries yet. Add the first one above.</div>
              ):(
                <div className="space-y-2">
                  {log.map((entry,i)=>(
                    <div key={i} className="flex gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="shrink-0 w-1.5 rounded-full bg-amber-400 mt-1" style={{minHeight:"1rem"}}/>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-700">{entry.text}</div>
                        <div className="text-xs text-slate-400 mt-1">{entry.author} · {new Date(entry.date).toLocaleDateString()} {new Date(entry.date).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {canEdit&&(
        <div className="flex gap-3 justify-between">
          <div className="flex gap-2">
            {!isNew&&<button onClick={()=>setConfirm(true)} className="px-4 py-2 text-sm text-red-500 hover:text-red-700 font-medium">Delete</button>}
            {!isNew&&<button onClick={()=>setConfirmArchive(true)}
              className={`px-4 py-2 text-sm font-medium rounded border transition ${p.is_archived?"border-green-300 text-green-700 hover:bg-green-50":"border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
              {p.is_archived?"Restore":"Archive"}
            </button>}
            {!isNew&&<button onClick={()=>onDuplicate(p)} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded hover:bg-slate-50 font-medium">Duplicate</button>}
          </div>
          <div className="flex gap-3">
            <button onClick={handleBack} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded">Cancel</button>
            <button onClick={handleSave} disabled={!p.name||saving}
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
  const [sf,setSf]           = useState("All");
  const [af,setAf]           = useState("All");
  const [yf,setYf]           = useState("All");
  const [snf,setSnf]         = useState("All");
  const [search,setSearch]   = useState("");
  const [showArchived,setShowArchived] = useState(false);

  const allStaff   = ["All",...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas   = ["All",...new Set(programs.map(p=>p.area))];
  const allYears   = ["All",...YEARS];
  const allSeasons = ["All",...SEASONS];
  const selCls     = "rounded border border-slate-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400";

  const vis = programs
    .filter(p=>showArchived ? !!p.is_archived : !p.is_archived)
    .filter(p=>sf==="All"||p.staff_name===sf)
    .filter(p=>af==="All"||p.area===af)
    .filter(p=>yf==="All"||p.year===yf)
    .filter(p=>snf==="All"||p.season===snf)
    .filter(p=>!search||p.name.toLowerCase().includes(search.toLowerCase()));
  const archivedCount = programs.filter(p=>p.is_archived&&(isManager||p.staff_name===staffName)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-slate-700">{showArchived ? "Archived Programs" : "Active Programs"} ({vis.length})</h2>
        <div className="flex gap-2">
          {isManager&&(
            <button onClick={onBulkDup}
              className="text-xs font-semibold px-3 py-2 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition">
              Bulk Season Rollover
            </button>
          )}
          <button onClick={()=>setShowArchived(s=>!s)}
            className={`text-xs font-semibold px-3 py-2 rounded border transition ${showArchived?"text-white border-transparent":"border-slate-200 text-slate-500 hover:bg-slate-50"}`}
            style={showArchived?{backgroundColor:"#64748b"}:{}}>
            📦 {showArchived?"← Active Programs":`Archived (${archivedCount})`}
          </button>
          {!showArchived&&<button onClick={onAdd} className="text-xs font-bold px-3 py-2 rounded text-white" style={{backgroundColor:"#1e3a5f"}}>+ Add Program</button>}
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
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Season</label>
          <select value={snf} onChange={e=>setSnf(e.target.value)} className={selCls}>
            {allSeasons.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Year</label>
          <select value={yf} onChange={e=>setYf(e.target.value)} className={selCls}>
            {allYears.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {(sf!=="All"||af!=="All"||yf!=="All"||snf!=="All"||search)&&(
          <button onClick={()=>{setSf("All");setAf("All");setYf("All");setSnf("All");setSearch("");}}
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

// ─── Program Review Checklist ─────────────────────────────────────────────────
function ProgramReviewSection({db}){
  const [reviews,setReviews]=useState([]);
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState("list"); // "list" | "form" | "detail"
  const [editRow,setEditRow]=useState(null);
  const [detailRow,setDetailRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [fyFilter,setFyFilter]=useState("all");
  const [search,setSearch]=useState("");

  const emptyForm={
    program_name:"",supervisor:"",season:"",fy:ADMIN_CUR,review_date:new Date().toISOString().slice(0,10),
    // Financial
    revenue:"",direct_costs:"",cost_recovery:"",classification:"Community Driven",
    below_50_cr:false,cr_action:"",fs_acceptable:true,fs_notes:"",
    // Data
    fill_rate:"",below_60_fill:false,two_weak_seasons:false,weak_action:"",trend:"Stable",da_notes:"",
    // Community
    enrollment:"",capacity:"",waitlist:"",retention_trend:"Stable",
    clear_audience:true,community_benefit:true,
    // Space
    prime_time_use:"Strong",time_improvable:false,ratio_appropriate:true,
    // Innovation
    is_pilot:false,met_enrollment:false,met_financial:false,
    // Final
    decision:"Continue",decision_reason:"",next_review:"",pillars_met:"",
  };
  const [form,setForm]=useState(emptyForm);
  const [activeStep,setActiveStep]=useState(0);

  async function load(){
    setLoading(true);
    const {data}=await db.from("admin_reviews").select("*").order("created_at",{ascending:false});
    setReviews(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  function s(k,v){setForm(p=>({...p,[k]:v}));}

  // Auto-compute pillar scores
  function computePillars(f){
    const p1 = f.fs_acceptable;
    const p2 = parseFloat(f.fill_rate)>=60 && !f.two_weak_seasons;
    const p3 = f.clear_audience && f.community_benefit;
    const p4 = f.prime_time_use!=="Underutilized" && f.ratio_appropriate;
    const p5 = !f.is_pilot || (f.met_enrollment && f.met_financial);
    return [{n:1,label:"Fiscal Sustainability",met:p1,required:true},
            {n:2,label:"Data & Accountability",met:p2,required:true},
            {n:3,label:"Community Impact",met:p3,required:false},
            {n:4,label:"Space Optimization",met:p4,required:false},
            {n:5,label:"Innovation",met:p5,required:false}];
  }

  const pillars = computePillars(form);
  const metCount = pillars.filter(p=>p.met).length;
  const requiredMet = pillars.filter(p=>p.required).every(p=>p.met);
  const overallPass = metCount>=3 && requiredMet;

  async function save(){
    const pillarsStr = pillars.filter(p=>p.met).map(p=>p.n).join(",");
    const d={...form,
      revenue:parseFloat(form.revenue)||0,
      direct_costs:parseFloat(form.direct_costs)||0,
      cost_recovery:parseFloat(form.cost_recovery)||0,
      fill_rate:parseFloat(form.fill_rate)||0,
      enrollment:parseInt(form.enrollment)||0,
      capacity:parseInt(form.capacity)||0,
      waitlist:parseInt(form.waitlist)||0,
      pillars_met:pillarsStr,
    };
    if(editRow){await db.from("admin_reviews").update(d).eq("id",editRow.id);}
    else{await db.from("admin_reviews").insert(d);}
    setView("list");setEditRow(null);setForm(emptyForm);setActiveStep(0);load();
  }
  async function del(id){await db.from("admin_reviews").delete().eq("id",id);setConfirm(null);load();}

  function startNew(){setEditRow(null);setForm(emptyForm);setActiveStep(0);setView("form");}
  function startEdit(r){
    setEditRow(r);
    setForm({...emptyForm,...r,
      revenue:r.revenue||"",direct_costs:r.direct_costs||"",
      cost_recovery:r.cost_recovery||"",fill_rate:r.fill_rate||"",
      enrollment:r.enrollment||"",capacity:r.capacity||"",waitlist:r.waitlist||"",
    });
    setActiveStep(0);setView("form");
  }

  const filtered=reviews.filter(r=>{
    if(fyFilter!=="all"&&r.fy!==fyFilter) return false;
    if(search&&!r.program_name?.toLowerCase().includes(search.toLowerCase())&&!r.supervisor?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const DECISIONS=["Continue","Adjust","Redesign","Expand","Pilot Again","Sunset Review"];
  const CLASSIFICATIONS=["Community Driven","Both","Revenue Driven"];
  const TRENDS=["Growing","Stable","Declining"];
  const PRIME=["Strong","Moderate","Underutilized"];
  const RETENTION=["Improving","Stable","Declining"];

  const STEPS=[
    {label:"Program Info",icon:"📋"},
    {label:"Financial",icon:"💰"},
    {label:"Data",icon:"📊"},
    {label:"Community",icon:"🤝"},
    {label:"Space",icon:"🏢"},
    {label:"Innovation",icon:"💡"},
    {label:"Decision",icon:"✅"},
  ];

  const dcColor={
    "Continue":"#16a34a","Adjust":"#d4a017","Redesign":"#dc2626",
    "Expand":"#0369a1","Pilot Again":"#7c3aed","Sunset Review":"#991b1b",
  };

  if(loading) return <div className="text-center py-20 text-slate-400">Loading reviews…</div>;

  /* ── LIST VIEW ── */
  if(view==="list") return(
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-slate-800" style={{fontSize:"18px"}}>Program Review Checklist</h2>
          <p className="text-sm text-slate-400 mt-0.5">Quarterly supervisor reviews — visible to all managers</p>
        </div>
        <button onClick={startNew} className="px-4 py-2 text-sm font-bold rounded-lg text-white flex items-center gap-2" style={{background:"#1e3a5f"}}>
          + New Review
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        {[
          {label:"Total Reviews",value:reviews.length,accent:"#1e3a5f"},
          {label:"Continue",value:reviews.filter(r=>r.decision==="Continue").length,accent:"#16a34a"},
          {label:"Redesign",value:reviews.filter(r=>r.decision==="Redesign"||r.decision==="Sunset Review").length,accent:"#dc2626"},
          {label:"This FY",value:reviews.filter(r=>r.fy===ADMIN_CUR).length,accent:"#d4a017"},
        ].map(c=>(
          <div key={c.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <div className="text-xs text-slate-400 mb-1">{c.label}</div>
            <div className="text-2xl font-black" style={{color:c.accent}}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-wrap gap-3 items-center mb-5">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search program or supervisor…"
          className="flex-1 min-w-48 text-sm rounded-lg border border-slate-200 px-3 py-1.5"/>
        <select value={fyFilter} onChange={e=>setFyFilter(e.target.value)} className="text-sm rounded-lg border border-slate-200 px-3 py-1.5 bg-white">
          <option value="all">All FYs</option>
          {ADMIN_FYS.map(f=><option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Reviews list */}
      {filtered.length===0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">📋</div>
          <div className="font-semibold text-slate-600 mb-1">No reviews yet</div>
          <div className="text-sm">Click "+ New Review" to log your first quarterly program review.</div>
        </div>
      ):(
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          {filtered.map((r,i)=>{
            const pMet=(r.pillars_met||"").split(",").filter(Boolean).length;
            const dc=dcColor[r.decision]||"#64748b";
            return(
              <div key={r.id} className={`${i>0?"border-t border-slate-50":""} px-4 py-4 flex items-start gap-4 hover:bg-slate-50 transition`}>
                <div className="shrink-0 mt-0.5">
                  <span className="inline-block px-2 py-1 rounded text-xs font-bold text-white" style={{background:dc}}>{r.decision||"—"}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800">{r.program_name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{r.supervisor} · {r.season} {r.fy} · Reviewed {r.review_date}</div>
                  <div className="flex items-center gap-3 mt-2 text-xs">
                    <span className="text-slate-500">Fill: <span className="font-bold">{r.fill_rate||0}%</span></span>
                    <span className="text-slate-500">CR: <span className="font-bold">{r.cost_recovery||0}%</span></span>
                    <span className="text-slate-500">Pillars: <span className="font-bold" style={{color:pMet>=3?"#16a34a":"#dc2626"}}>{pMet}/5</span></span>
                    {r.next_review&&<span className="text-slate-400">Next review: {r.next_review}</span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={()=>{setDetailRow(r);setView("detail");}} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-500">👁 View</button>
                  <button onClick={()=>startEdit(r)} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-500">✏ Edit</button>
                  <button onClick={()=>setConfirm(r.id)} className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-xs text-red-400">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {confirm&&<AConfirm message="Delete this review?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );

  /* ── DETAIL VIEW ── */
  if(view==="detail"&&detailRow){
    const r=detailRow;
    const pMet=(r.pillars_met||"").split(",").filter(Boolean);
    const pillarLabels={1:"Fiscal Sustainability",2:"Data & Accountability",3:"Community Impact",4:"Space Optimization",5:"Innovation"};
    const pillarRequired={1:true,2:true,3:false,4:false,5:false};
    const pillarColor={1:"#1e3a5f",2:"#1e3a5f",3:"#0f766e",4:"#7c3aed",5:"#b45309"};
    return(
      <div>
        <button onClick={()=>setView("list")} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-5">← Back to all reviews</button>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-100" style={{background:"linear-gradient(135deg,#1e3a5f,#0f2d4a)"}}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xl font-black text-white">{r.program_name}</div>
                <div className="text-sm opacity-70 text-white mt-1">{r.supervisor} · {r.season} {r.fy} · Reviewed {r.review_date}</div>
              </div>
              <span className="px-3 py-1.5 rounded-lg text-sm font-bold text-white" style={{background:dcColor[r.decision]||"#64748b"}}>{r.decision}</span>
            </div>
            {/* Pillar badges */}
            <div className="flex flex-wrap gap-2 mt-4">
              {[1,2,3,4,5].map(n=>{
                const met=pMet.includes(String(n));
                return(
                  <span key={n} className="text-xs font-bold px-2 py-1 rounded-full" style={{
                    background:met?pillarColor[n]:"rgba(255,255,255,0.1)",
                    color:"white",
                    opacity:met?1:0.4,
                  }}>
                    {met?"✓":"○"} {pillarLabels[n]}{pillarRequired[n]?" (req)":""}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="p-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Financial */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Financial Stewardship</div>
              <div className="space-y-2 text-sm">
                {[["Revenue",`$${(r.revenue||0).toLocaleString()}`],["Direct Costs",`$${(r.direct_costs||0).toLocaleString()}`],["Cost Recovery",`${r.cost_recovery||0}%`],["Classification",r.classification],["Acceptable?",r.fs_acceptable?"Yes":"No — Redesign Required"]].map(([k,v])=>(
                  <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span className="font-semibold text-slate-700">{v}</span></div>
                ))}
                {r.fs_notes&&<div className="text-xs text-slate-400 italic mt-1">{r.fs_notes}</div>}
              </div>
            </div>
            {/* Data */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Data & Accountability</div>
              <div className="space-y-2 text-sm">
                {[["Fill Rate",`${r.fill_rate||0}%`],["Below 60%?",r.below_60_fill?"Yes":"No"],["Two Weak Seasons?",r.two_weak_seasons?"Yes":"No"],["Trend",r.trend]].map(([k,v])=>(
                  <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span className="font-semibold text-slate-700">{v}</span></div>
                ))}
                {r.da_notes&&<div className="text-xs text-slate-400 italic mt-1">{r.da_notes}</div>}
              </div>
            </div>
            {/* Community */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Community Impact</div>
              <div className="space-y-2 text-sm">
                {[["Enrollment",`${r.enrollment||0} / ${r.capacity||0}`],["Waitlist",r.waitlist||0],["Retention",r.retention_trend],["Clear Audience?",r.clear_audience?"Yes":"No"]].map(([k,v])=>(
                  <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span className="font-semibold text-slate-700">{v}</span></div>
                ))}
              </div>
            </div>
            {/* Space + Innovation */}
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Space & Innovation</div>
              <div className="space-y-2 text-sm">
                {[["Prime Time Use",r.prime_time_use],["Ratio Appropriate?",r.ratio_appropriate?"Yes":"No"],["Is Pilot?",r.is_pilot?"Yes":"No"]].map(([k,v])=>(
                  <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span className="font-semibold text-slate-700">{v}</span></div>
                ))}
              </div>
            </div>
          </div>
          {/* Decision */}
          {r.decision_reason&&(
            <div className="px-6 pb-6">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Decision Reason</div>
              <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{r.decision_reason}</div>
            </div>
          )}
          {r.next_review&&(
            <div className="px-6 pb-6">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Next Review Date</div>
              <div className="text-sm font-semibold text-slate-700">{r.next_review}</div>
            </div>
          )}
          <div className="px-6 pb-6 flex gap-3">
            <button onClick={()=>startEdit(r)} className="px-4 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>✏ Edit Review</button>
            <button onClick={()=>setView("list")} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Close</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── FORM VIEW ── */
  const inp=(label,key,type="text",opts=null,req=false)=>(
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}{req&&<span className="text-red-400 ml-0.5">*</span>}</label>
      {opts?(
        <select value={form[key]} onChange={e=>s(key,e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
          {opts.map(o=><option key={o}>{o}</option>)}
        </select>
      ):(
        <input type={type} value={form[key]} onChange={e=>s(key,type==="number"?parseFloat(e.target.value)||"":e.target.value)}
          className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2"/>
      )}
    </div>
  );
  const chk=(label,key,detail="")=>(
    <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-slate-100 hover:bg-slate-50">
      <input type="checkbox" checked={!!form[key]} onChange={e=>s(key,e.target.checked)} className="mt-0.5"/>
      <div><div className="text-sm font-medium text-slate-700">{label}</div>{detail&&<div className="text-xs text-slate-400 mt-0.5">{detail}</div>}</div>
    </label>
  );
  const textarea=(label,key)=>(
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      <textarea value={form[key]||""} onChange={e=>s(key,e.target.value)} rows={2}
        className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 resize-none"/>
    </div>
  );

  return(
    <div>
      <button onClick={()=>{setView("list");setActiveStep(0);}} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-5">← Back to all reviews</button>

      <div className="mb-6">
        <h2 className="font-bold text-slate-800 text-lg">{editRow?"Edit Review":"New Program Review"}</h2>
        <p className="text-sm text-slate-400 mt-0.5">Program Review Checklist — complete all sections, then submit</p>
      </div>

      {/* Step nav */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {STEPS.map((st,i)=>{
          const done=i<activeStep;
          const active=i===activeStep;
          return(
            <button key={i} onClick={()=>setActiveStep(i)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap shrink-0"
              style={active?{background:"#1e3a5f",color:"white"}:done?{background:"#dcfce7",color:"#166534"}:{background:"#f1f5f9",color:"#94a3b8"}}>
              <span>{done?"✓":st.icon}</span>{st.label}
            </button>
          );
        })}
      </div>

      {/* Pillar progress bar */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Pillar Score</div>
          <div className={`text-sm font-bold ${overallPass?"text-green-600":"text-red-500"}`}>
            {metCount}/5 pillars met — {overallPass?"✓ Passes":"✗ Does not meet minimum (3 required, both required pillars must be met)"}
          </div>
        </div>
        <div className="flex gap-1.5">
          {pillars.map(p=>(
            <div key={p.n} className="flex-1 text-center">
              <div className="h-2 rounded-full mb-1" style={{background:p.met?(p.required?"#1e3a5f":"#16a34a"):"#e2e8f0"}}/>
              <div className="text-xs truncate" style={{color:p.met?"#1e3a5f":"#94a3b8",fontSize:"9px"}}>{p.n}{p.required?"★":""}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-5">

        {/* Step 0: Program Info */}
        {activeStep===0&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2 mb-4">Program Information</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {inp("Program Name","program_name","text",null,true)}
              {inp("Supervisor","supervisor","text",null,true)}
              {inp("Season","season",null,["Spring","Summer","Fall","Winter","Annual"])}
              {inp("Fiscal Year","fy",null,ADMIN_FYS)}
              {inp("Review Date","review_date","date")}
              {inp("Classification","classification",null,CLASSIFICATIONS)}
            </div>
          </>
        )}

        {/* Step 1: Financial */}
        {activeStep===1&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2 mb-4">💰 Financial Stewardship <span className="text-xs font-normal text-red-500 ml-2">Required Pillar</span></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {inp("Program Revenue ($)","revenue","number")}
              {inp("Direct Program Costs ($)","direct_costs","number")}
              {inp("Cost Recovery (%)","cost_recovery","number")}
            </div>
            {(form.revenue&&form.direct_costs)&&(
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
                <span className="text-slate-500">Calculated Net: </span>
                <span className={`font-bold ${parseFloat(form.revenue)-parseFloat(form.direct_costs)>=0?"text-green-600":"text-red-600"}`}>
                  ${(parseFloat(form.revenue||0)-parseFloat(form.direct_costs||0)).toLocaleString()}
                </span>
              </div>
            )}
            <div className="space-y-2">
              {chk("Below 50% cost recovery?","below_50_cr","Programs below 50% CR require redesign or documented intentional subsidy")}
              {form.below_50_cr&&inp("Action Required","cr_action",null,["Redesign required","Intentional Community subsidy (documented)"])}
              {chk("Financial performance is acceptable for this program's classification","fs_acceptable")}
            </div>
            {textarea("Notes","fs_notes")}
          </>
        )}

        {/* Step 2: Data */}
        {activeStep===2&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2 mb-4">📊 Data & Accountability <span className="text-xs font-normal text-red-500 ml-2">Required Pillar</span></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {inp("Fill Rate (%)","fill_rate","number")}
              {inp("Trend Direction","trend",null,TRENDS)}
            </div>
            <div className="space-y-2">
              {chk("Below 60% fill rate?","below_60_fill")}
              {chk("Two consecutive weak seasons?","two_weak_seasons","If yes, a redesign plan or sunset review is required")}
              {form.two_weak_seasons&&inp("Action","weak_action",null,["Redesign plan required","Sunset review"])}
            </div>
            {textarea("Notes","da_notes")}
          </>
        )}

        {/* Step 3: Community */}
        {activeStep===3&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2 mb-4">🤝 Participation & Community Impact</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {inp("Enrollment","enrollment","number")}
              {inp("Capacity","capacity","number")}
              {inp("Waitlist","waitlist","number")}
            </div>
            {inp("Retention Trend","retention_trend",null,RETENTION)}
            <div className="space-y-2">
              {chk("Clear target audience identified","clear_audience")}
              {chk("Community benefit documented","community_benefit")}
            </div>
          </>
        )}

        {/* Step 4: Space */}
        {activeStep===4&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2 mb-4">🏢 Space & Operational Efficiency</div>
            {inp("Prime Time Use","prime_time_use",null,PRIME)}
            <div className="space-y-2">
              {chk("Could time or location be improved?","time_improvable")}
              {chk("Participant to staff ratio is appropriate","ratio_appropriate")}
            </div>
          </>
        )}

        {/* Step 5: Innovation */}
        {activeStep===5&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2 mb-4">💡 Innovation & Responsiveness</div>
            {chk("This is a new or pilot program","is_pilot")}
            {form.is_pilot&&(
              <div className="space-y-2 ml-4">
                {chk("Met enrollment expectations","met_enrollment")}
                {chk("Met financial expectations","met_financial")}
              </div>
            )}
          </>
        )}

        {/* Step 6: Decision */}
        {activeStep===6&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2 mb-4">✅ Final Decision</div>

            {/* Pillar summary before decision */}
            <div className="rounded-lg border border-slate-100 overflow-hidden mb-4">
              <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-widest">Pillar Summary</div>
              {pillars.map(p=>(
                <div key={p.n} className="flex items-center gap-3 px-4 py-2 border-t border-slate-50">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0`} style={{background:p.met?"#16a34a":"#e2e8f0",color:p.met?"white":"#94a3b8"}}>
                    {p.met?"✓":"○"}
                  </span>
                  <span className="text-sm text-slate-600">{p.label}</span>
                  {p.required&&<span className="text-xs text-red-500 font-semibold">Required</span>}
                </div>
              ))}
              <div className="px-4 py-2.5 border-t border-slate-100" style={{background:overallPass?"#f0fdf4":"#fef2f2"}}>
                <span className={`text-sm font-bold ${overallPass?"text-green-700":"text-red-600"}`}>
                  {overallPass?"✓ Program meets the 3-pillar minimum":"✗ Program does not meet minimum — redesign or sunset review recommended"}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-500 mb-2">Decision</label>
              <div className="grid grid-cols-3 gap-2">
                {DECISIONS.map(d=>(
                  <button key={d} onClick={()=>s("decision",d)}
                    className="py-2 px-3 rounded-lg text-xs font-bold border-2 transition"
                    style={form.decision===d?{background:dcColor[d],color:"white",borderColor:dcColor[d]}:{borderColor:"#e2e8f0",color:"#64748b"}}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            {textarea("Reason for Decision","decision_reason")}
            {inp("Next Review Date","next_review","date")}
          </>
        )}

        {/* Step nav buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <button onClick={()=>setActiveStep(s=>Math.max(0,s-1))} disabled={activeStep===0}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30">← Back</button>
          {activeStep<STEPS.length-1?(
            <button onClick={()=>setActiveStep(s=>s+1)}
              className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>Next →</button>
          ):(
            <button onClick={save}
              className="px-6 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#16a34a"}}>
              {editRow?"Update Review":"Save Review"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Reference Tab ────────────────────────────────────────────────────────────
function Reference({isManager,db}) {
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
      <div className="flex border-b border-slate-100 overflow-x-auto">
        {[
          {id:"standards",label:"District Standards"},
          {id:"kpis",label:"KPI Menu"},
          {id:"philosophy",label:"🏛 Philosophy"},
          {id:"guide",label:"Dashboard Guide"},
          {id:"training",label:"📋 Training Guide"},
          ...(isManager?[{id:"review",label:"📋 Program Review"}]:[]),
        ].map(s=>(
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
      {sec==="guide"&&(
        <div className="p-5 space-y-8">
          <div>
            <p className="text-sm text-slate-500">{isManager ? "This guide explains exactly how every number on the manager dashboard is calculated. Use it to understand what the data is telling you and where to focus attention." : "This guide explains how program performance is measured and what each metric means for your programs."}</p>
          </div>

          {/* ── Program Cost ── */}
          <GuideSection title="How Program Cost Is Calculated" accent="#1e3a5f">
            <p className="text-sm text-slate-600 mb-4">Every program's total cost is built from four layers. Understanding these helps you know where cost is actually coming from.</p>
            <div className="space-y-3">
              {[
                {step:"1",label:"Direct Costs",color:"#1e3a5f",desc:"Personnel + Commodities + Contractuals + two custom cost lines (labeled per program). These are costs you enter directly on the program form."},
                {step:"2",label:"Admin Overhead (10%)",color:"#64748b",desc:"10% of direct costs is added automatically to account for district-level administrative support. You don't enter this — it's always applied."},
                {step:"3",label:"Allocated FT Staff Cost",color:"#d4a017",desc:"$97,700 × the program's workload %. This represents the portion of a full-time staff salary attributed to managing this program. If no Program Type is selected, this is $0 — which understates the real cost."},
                {step:"4",label:"Allocated Facility Cost",color:"#22c55e",desc:"$3/hr × the number of facility hours entered. This covers the shared cost of using district space."},
              ].map(r=>(
                <div key={r.step} className="flex gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0 mt-0.5" style={{backgroundColor:r.color}}>{r.step}</div>
                  <div>
                    <div className="text-sm font-bold text-slate-700">{r.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{r.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-lg bg-slate-800 text-slate-100 font-mono text-xs">
              Total Cost = Direct + (Direct × 10%) + ($97,700 × Workload%) + ($3 × Facility Hrs)
            </div>
          </GuideSection>

          {/* ── Fill Rate & Cost Recovery ── */}
          <GuideSection title="Fill Rate & Cost Recovery" accent="#d4a017">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="p-4 rounded-lg border border-slate-200 space-y-2">
                <div className="text-sm font-bold text-slate-700">Fill Rate</div>
                <div className="p-2 rounded bg-slate-800 text-slate-100 font-mono text-xs">Actual Enrollment ÷ Actual Capacity</div>
                <p className="text-xs text-slate-500">How full the program was relative to available spots. A 70%+ fill rate is the district target for Healthy status. Below 60% triggers Needs Redesign.</p>
                <div className="text-xs text-slate-400 italic">Example: 18 enrolled ÷ 25 spots = 72% fill rate → Healthy</div>
              </div>
              <div className="p-4 rounded-lg border border-slate-200 space-y-2">
                <div className="text-sm font-bold text-slate-700">Cost Recovery</div>
                <div className="p-2 rounded bg-slate-800 text-slate-100 font-mono text-xs">Actual Revenue ÷ Total Program Cost</div>
                <p className="text-xs text-slate-500">What percentage of the program's total cost was covered by participant fees. 100% means break-even. Below 100% means the district subsidized the rest.</p>
                <div className="text-xs text-slate-400 italic">Example: $1,200 revenue ÷ $1,500 total cost = 80% recovery → district covered $300</div>
              </div>
            </div>
          </GuideSection>

          {/* ── Program Status ── */}
          <GuideSection title="Program Status Logic" accent="#1e3a5f">
            <p className="text-sm text-slate-600 mb-3">Status is determined by fill rate and cost recovery together. It uses actual numbers when available, budgeted numbers when not.</p>
            <div className="space-y-2">
              {[
                {status:"Healthy",   color:"#22c55e", rule:"Fill rate ≥ 70% AND cost recovery ≥ 100%",        detail:"Program is well-attended and covering its costs. No action needed."},
                {status:"Monitor",   color:"#eab308", rule:"Fill rate 60–69.9%",                               detail:"Getting close to thresholds. Watch enrollment trends and consider light marketing or schedule adjustments."},
                {status:"Needs Redesign", color:"#ef4444", rule:"Fill rate < 60% OR cost recovery < 50%",     detail:"Program is significantly underperforming on at least one dimension. Review pricing, format, timing, or consider discontinuing."},
              ].map(r=>(
                <div key={r.status} className="flex gap-3 p-3 rounded-lg border border-slate-100">
                  <div className="px-2 py-0.5 rounded text-xs font-bold text-white h-fit mt-0.5 shrink-0 whitespace-nowrap" style={{backgroundColor:r.color}}>{r.status}</div>
                  <div>
                    <div className="text-xs font-bold text-slate-600">{r.rule}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{r.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </GuideSection>

          {/* ── Health Score — manager only ── */}
          {isManager&&<GuideSection title="Health Score (0–100)" accent="#d4a017">
            <p className="text-sm text-slate-600 mb-3">A single composite number summarizing overall program inventory performance. Weighted across three dimensions:</p>
            <div className="space-y-2 mb-4">
              {[
                {weight:"40%", label:"Average Fill Rate",      desc:"Across all visible programs. Higher attendance = higher score."},
                {weight:"40%", label:"Average Cost Recovery",  desc:"Capped at 200% so one exceptionally profitable program doesn't skew the whole score. At 100% recovery you get the full 40 points."},
                {weight:"20%", label:"% of Programs Healthy",  desc:"What proportion of programs have Healthy status. Rewards a well-distributed inventory, not just a few standouts."},
              ].map(r=>(
                <div key={r.label} className="flex gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-sm font-black text-slate-700 w-10 shrink-0">{r.weight}</div>
                  <div>
                    <div className="text-sm font-bold text-slate-700">{r.label}</div>
                    <div className="text-xs text-slate-500">{r.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 rounded-lg bg-slate-800 text-slate-100 font-mono text-xs mb-3">
              Score = (avgFill × 40) + (min(avgCR, 2)/2 × 40) + (healthyPct × 20)
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-center">
              <div className="p-2 rounded-lg bg-green-50 border border-green-200"><span className="font-bold text-green-700">75–100</span><div className="text-slate-500 mt-0.5">Strong</div></div>
              <div className="p-2 rounded-lg bg-yellow-50 border border-yellow-200"><span className="font-bold text-yellow-700">50–74</span><div className="text-slate-500 mt-0.5">Developing</div></div>
              <div className="p-2 rounded-lg bg-red-50 border border-red-200"><span className="font-bold text-red-600">0–49</span><div className="text-slate-500 mt-0.5">Needs Attention</div></div>
            </div>
          </GuideSection>}

          {isManager&&<GuideSection title="Subsidy Burden ($)" accent="#ef4444">
            <p className="text-sm text-slate-600 mb-3">The total dollar amount the district is subsidizing — i.e., the sum of all program deficits. Only programs that lost money contribute. Profitable programs do not offset losses here.</p>
            <div className="p-3 rounded-lg bg-slate-800 text-slate-100 font-mono text-xs mb-3">
              Subsidy Burden = Σ max(0, Total Cost − Revenue) for each program
            </div>
            <p className="text-sm text-slate-600 mb-2">This is intentional — it tells you the gross tax dollar commitment, not a net number. It answers the question: <span className="font-semibold italic">"How much are we spending beyond what participants pay?"</span></p>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <span className="font-bold">NRPA benchmark:</span> The national average cost recovery for public parks & recreation is approximately 24.6%, meaning most agencies subsidize about 75 cents of every dollar of program cost. Your subsidy burden relative to total cost gives you your effective subsidy rate to compare against this benchmark.
            </div>
          </GuideSection>}

          {isManager&&<GuideSection title="Staff Workload Distribution" accent="#1e3a5f">
            <p className="text-sm text-slate-600 mb-3">Shows how much of each staff member's estimated FT capacity is allocated to programs in the current view. It is based entirely on the <span className="font-semibold">Program Type</span> selected on each program's budget form.</p>
            <div className="rounded-lg border border-slate-200 overflow-hidden mb-4">
              <div className="px-4 py-2 bg-slate-800 text-slate-100 text-xs font-bold uppercase tracking-widest">Program Type Workload %</div>
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left font-semibold">Program Type</th>
                  <th className="px-4 py-2 text-left font-semibold">FT Workload %</th>
                  <th className="px-4 py-2 text-left font-semibold">FT $ Cost</th>
                </tr></thead>
                <tbody>{PROGRAM_TYPES.map((t,i)=>(
                  <tr key={t.label} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                    <td className="px-4 py-2 font-semibold text-slate-700">{t.label}</td>
                    <td className="px-4 py-2 text-slate-500 font-mono">{(t.pct*100).toFixed(1)}%</td>
                    <td className="px-4 py-2 text-slate-500 font-mono">${(97700*t.pct).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              <p>A staff member managing 10 Small Programs (4% each) would show <span className="font-mono font-bold">40% allocated</span> — meaning 40% of their FT salary ($39,080) is attributed to programs. The remaining 60% covers non-program time: planning, meetings, marketing, admin.</p>
              <p className="text-amber-700 font-medium">⚠ If a staff member shows 0% or unexpectedly low allocation, it almost always means their programs are missing a Program Type selection. Open each flagged program and select the appropriate type in the budgeted section.</p>
            </div>
          </GuideSection>}

          {isManager&&<GuideSection title="Revenue per Participant" accent="#d4a017">
            <p className="text-sm text-slate-600 mb-3">The average revenue generated per enrolled participant. Useful for comparing pricing efficiency across areas.</p>
            <div className="p-3 rounded-lg bg-slate-800 text-slate-100 font-mono text-xs mb-3">
              Rev / Participant = Total Actual Revenue ÷ Total Actual Enrollment
            </div>
            <p className="text-sm text-slate-600">Areas significantly below the portfolio average may be underpriced for their service category. Areas well above average may be priced appropriately for higher-tier services (private lessons, specialized camps) — context matters. Use the Service Category Cost Recovery targets on the District Standards tab to validate.</p>
          </GuideSection>}

          <GuideSection title="Waitlist Demand (%)" accent="#d4a017">
            <p className="text-sm text-slate-600 mb-3">Shows unmet demand as a percentage of total budgeted capacity.</p>
            <div className="p-3 rounded-lg bg-slate-800 text-slate-100 font-mono text-xs mb-3">
              Waitlist Demand % = Total Waitlist ÷ Total Budgeted Capacity
            </div>
            <p className="text-sm text-slate-600">A waitlist demand of 10%+ across a program area suggests the district could expand capacity, add sections, or increase pricing. Individual programs with high waitlists relative to their size are prime candidates for additional sessions.</p>
          </GuideSection>

          {/* ── Classification Mix — manager only ── */}
          {isManager&&<GuideSection title="Program Mix by Classification" accent="#1e3a5f">
            <p className="text-sm text-slate-600 mb-3">Breaks down the inventory by how programs are classified and shows the financial profile of each group.</p>
            <div className="space-y-2">
              {[
                {label:"Community Driven",color:"#1e3a5f", desc:"Programs offered primarily for public benefit regardless of revenue. These are expected to run at a subsidy. Monitor total subsidy cost relative to district mission priorities."},
                {label:"Revenue Driven",  color:"#22c55e", desc:"Programs expected to generate surplus revenue that can offset community-driven program subsidies. If these are not hitting 100%+ cost recovery, investigate pricing or attendance."},
                {label:"Both",            color:"#d4a017", desc:"Programs with mixed objectives. Review individually — the target depends on the specific program context."},
              ].map(r=>(
                <div key={r.label} className="flex gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50">
                  <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{backgroundColor:r.color}}/>
                  <div>
                    <div className="text-sm font-bold text-slate-700">{r.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{r.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </GuideSection>}

          <GuideSection title="NPS (Net Promoter Score)" accent="#d4a017">
            <p className="text-sm text-slate-600 mb-3">NPS measures how likely participants are to recommend the program. Scores range from 0 to 100. It is entered manually on the program form — it is not calculated automatically.</p>
            <div className="grid grid-cols-3 gap-2 text-xs text-center mb-3">
              <div className="p-2 rounded-lg bg-green-50 border border-green-200"><span className="font-bold text-green-700">70–100</span><div className="text-slate-500 mt-0.5">Strong — promoters far outnumber detractors</div></div>
              <div className="p-2 rounded-lg bg-yellow-50 border border-yellow-200"><span className="font-bold text-yellow-700">50–69</span><div className="text-slate-500 mt-0.5">Acceptable — room to improve</div></div>
              <div className="p-2 rounded-lg bg-red-50 border border-red-200"><span className="font-bold text-red-600">0–49</span><div className="text-slate-500 mt-0.5">Needs Review — participant dissatisfaction likely</div></div>
            </div>
            <p className="text-sm text-slate-600">Programs with low NPS but healthy fill rates are worth investigating — participants may be returning out of convenience rather than satisfaction, and a competitor or format change could quickly erode enrollment.</p>
          </GuideSection>

          {/* ── Needs Attention — manager only ── */}
          {isManager&&<GuideSection title="Needs Attention Queue" accent="#991b1b">
            <p className="text-sm text-slate-600 mb-3">An automatically generated action list of programs that meet at least one of the following conditions, sorted by fill rate ascending (worst first):</p>
            <div className="space-y-1.5">
              {[
                {flag:"Status = Needs Redesign", detail:"Fill rate below 60% or cost recovery below 50%"},
                {flag:"Trend = Declining",       detail:"Staff has marked this program as declining over time"},
                {flag:"Fill Rate < 50%",         detail:"Critically low attendance — fewer than half of spots filled"},
              ].map(r=>(
                <div key={r.flag} className="flex gap-2 text-sm">
                  <span className="text-red-500 shrink-0">▸</span>
                  <span><span className="font-semibold text-slate-700">{r.flag}</span> — <span className="text-slate-500">{r.detail}</span></span>
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-600 mt-3">Use this queue as your weekly check-in list. Programs that appear here need a decision: redesign, remarket, adjust pricing, or sunset. The queue is capped at 8 programs — if more qualify, the 8 with the lowest fill rates are shown.</p>
          </GuideSection>}

        </div>
      )}
      {sec==="philosophy"&&(
        <div className="p-5 space-y-6">
          {!isManager ? (
            /* ─────────────────── STAFF VIEW ─────────────────── */
            <>
              <div className="rounded-xl p-6 text-white" style={{background:"linear-gradient(135deg,#1e3a5f 0%,#0f2d4a 100%)"}}>
                <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{color:"#d4a017"}}>BGPD Recreation</div>
                <div className="text-2xl font-black mb-2">Recreation Programming Philosophy</div>
                <div className="text-sm opacity-80">Our goal is to offer great programs while using our resources responsibly. Every program should support at least three of the five pillars below — including both required pillars.</div>
              </div>

              {/* Required badge */}
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-slate-200"/>
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Five Pillars</span>
                <div className="h-px flex-1 bg-slate-200"/>
              </div>

              <div className="space-y-3">
                {[
                  {n:"1",label:"Fiscal Sustainability",required:true,color:"#1e3a5f",icon:"💰",
                    what:"Programs should cover their costs when possible, be priced appropriately, and use staff and resources efficiently.",
                    simple:"Avoid unintentional losses. Some programs may be intentionally subsidized because they serve the community — that's okay when it's a deliberate choice."},
                  {n:"2",label:"Data Driven Decisions",required:true,color:"#1e3a5f",icon:"📊",
                    what:"Decisions are guided by measurable data: fill rate, enrollment trend, waitlist volume, participant satisfaction, and retention rate.",
                    simple:"Most programs should reach at least 60% enrollment. Programs that struggle multiple seasons should be redesigned or reconsidered."},
                  {n:"3",label:"Community Impact",required:false,color:"#0f766e",icon:"🤝",
                    what:"Strong programs serve a clear audience, attract participants, and provide meaningful experiences.",
                    simple:"Mission-driven programs remain important even if they require subsidy — as long as the community benefit is clear and intentional."},
                  {n:"4",label:"Space Optimization",required:false,color:"#7c3aed",icon:"🏢",
                    what:"Programs should use prime time space effectively, align staffing with participation, and improve scheduling when possible.",
                    simple:"Use space and staff wisely. A program running at 30% in a peak-demand room is a scheduling opportunity."},
                  {n:"5",label:"Innovation",required:false,color:"#b45309",icon:"💡",
                    what:"Staff are encouraged to test new ideas. Pilot programs are supported when they address community interests, have clear goals, and stay within budget.",
                    simple:"Try new things responsibly. Pilots need a goal and a plan — not just an idea."},
                ].map(p=>(
                  <div key={p.n} className="rounded-xl border border-slate-100 overflow-hidden shadow-sm">
                    <div className="px-4 py-3 flex items-center gap-3" style={{background:p.color}}>
                      <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sm font-black shrink-0" style={{color:p.color}}>{p.n}</div>
                      <div className="flex-1">
                        <div className="font-bold text-white text-sm">{p.label}</div>
                      </div>
                      {p.required&&<span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:"#d4a017",color:"#1e3a5f"}}>REQUIRED</span>}
                      <span className="text-xl">{p.icon}</span>
                    </div>
                    <div className="p-4 space-y-2">
                      <p className="text-sm text-slate-700 font-medium">{p.what}</p>
                      <p className="text-xs text-slate-400 italic">{p.simple}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom summary */}
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-5">
                <div className="font-bold text-slate-700 text-sm mb-3">What we're aiming for</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {["Intentional","Well attended","Financially responsible","Valuable to the community"].map(v=>(
                    <div key={v} className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{background:"#d4a017"}}/>
                      {v}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-3">The goal is not to eliminate programs. The goal is to ensure every program is intentional and aligned with the District's long-term health.</p>
              </div>
            </>
          ) : (
            /* ─────────────────── MANAGER VIEW ─────────────────── */
            <>
              <div className="rounded-xl p-6 text-white" style={{background:"linear-gradient(135deg,#1e3a5f 0%,#7c3aed 100%)"}}>
                <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{color:"#d4a017"}}>Manager Reference</div>
                <div className="text-2xl font-black mb-2">Recreation Programming Philosophy</div>
                <div className="text-sm opacity-80">The framework for evaluating, improving, and managing recreation programs as a unified service offering — not isolated decisions. Programs must align with at least 3 of 5 pillars, including both required pillars.</div>
              </div>

              {/* Purpose */}
              <GuideSection title="Purpose & Financial Goals" accent="#1e3a5f">
                <p className="text-sm text-slate-600 mb-4">This framework ensures programming decisions are intentional, data-informed, and aligned with the District's long-term financial health. The broader goal is to move overall program margin from 6–7% today toward <span className="font-bold text-slate-700">10–12% over several years</span> — generating meaningful capital capacity internally.</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    {label:"Improve financial sustainability",icon:"📈"},
                    {label:"Reduce unintentional program losses",icon:"🛡"},
                    {label:"Protect long-term capital stability",icon:"🏛"},
                    {label:"Maintain mission-driven programming",icon:"❤️"},
                  ].map(g=>(
                    <div key={g.label} className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-center">
                      <div className="text-2xl mb-1">{g.icon}</div>
                      <div className="text-xs text-slate-600 font-medium">{g.label}</div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* Five Pillars — detailed */}
              <GuideSection title="The Five Pillars — Full Detail" accent="#1e3a5f">
                <div className="space-y-4">
                  {[
                    {n:"1",label:"Fiscal Sustainability",required:true,color:"#1e3a5f",
                      expectations:[
                        "Programs must align with assigned cost recovery bands (see District Standards tab)",
                        "Program surplus or loss must be understood and tracked — not just reported",
                        "Programs below 50% cost recovery require redesign unless intentionally subsidized with documentation",
                        "Pricing and staffing should reflect actual demand",
                      ],
                      note:"Community-driven programs may operate below market recovery levels — but subsidy must be intentional and documented. Unintentional loss should always be corrected."},
                    {n:"2",label:"Data Driven Decisions",required:true,color:"#1e3a5f",
                      expectations:[
                        "Minimum 60% fill rate to run most programs — below this triggers a review conversation",
                        "Programs with two consecutive weak seasons require a documented redesign plan",
                        "Programs with three weak seasons require a formal sunset review",
                        "Participation trends, feedback, and retention data should inform every renewal decision",
                      ],
                      note:"'Weak season' means below fill rate or cost recovery thresholds. One off-season can happen. Two in a row is a pattern. Three requires a decision."},
                    {n:"3",label:"Community Impact",required:false,color:"#0f766e",
                      expectations:[
                        "Program must serve a clear, identifiable audience",
                        "Enrollment relative to capacity should be tracked and improving",
                        "Waitlists signal expansion opportunities — document and act on them",
                        "Retention trends indicate whether the program is delivering ongoing value",
                      ],
                      note:"Mission-driven programs can justify subsidy when community benefit is clearly documented. 'We've always offered it' is not sufficient justification."},
                    {n:"4",label:"Space Optimization",required:false,color:"#7c3aed",
                      expectations:[
                        "Prime-time slots should be occupied by high-demand, revenue-appropriate programs",
                        "Participant-to-staff ratios should align with actual enrollment — not budgeted enrollment",
                        "Scheduling reviews should happen at least annually per program area",
                        "Underutilized high-demand spaces represent a direct financial opportunity",
                      ],
                      note:"Scheduling changes can improve both participation and financial sustainability simultaneously — it's not always about pricing or programming."},
                    {n:"5",label:"Innovation",required:false,color:"#b45309",
                      expectations:[
                        "Pilot programs must have defined goals and a measurement plan before launch",
                        "Pilot spending should remain within approved budget limits",
                        "Success is measured by participation AND financial performance together",
                        "Pilots not meeting targets should be modified or sunset, not carried forward indefinitely",
                      ],
                      note:"Innovation should support both community needs and long-term sustainability. A great idea that loses money without a path to viability is not a sustainable pilot."},
                  ].map(p=>(
                    <div key={p.n} className="rounded-xl border border-slate-100 overflow-hidden">
                      <div className="px-4 py-3 flex items-center gap-3" style={{background:p.color}}>
                        <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-xs font-black shrink-0" style={{color:p.color}}>{p.n}</div>
                        <span className="font-bold text-white">{p.label}</span>
                        {p.required&&<span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full" style={{background:"#d4a017",color:"#1e3a5f"}}>REQUIRED</span>}
                      </div>
                      <div className="p-4">
                        <div className="space-y-1.5 mb-3">
                          {p.expectations.map((e,i)=>(
                            <div key={i} className="flex gap-2 text-xs text-slate-600">
                              <span className="shrink-0 mt-0.5 font-bold" style={{color:p.color}}>›</span>
                              {e}
                            </div>
                          ))}
                        </div>
                        <div className="rounded-lg px-3 py-2 text-xs text-slate-500 italic border-l-2" style={{borderColor:p.color,background:"#f8fafc"}}>{p.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* Service Offering Management */}
              <GuideSection title="Managing Programs as a Service Offering" accent="#0f766e">
                <p className="text-sm text-slate-600 mb-4">The Recreation Department manages programs as a <span className="font-bold text-slate-700">service offering portfolio</span> — not isolated decisions. Annual targets for the portfolio:</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
                  {[
                    {label:"Improve overall program margin",icon:"📈"},
                    {label:"Improve cost recovery distribution",icon:"⚖️"},
                    {label:"Redesign or retire ~5% of programs annually",icon:"🔄"},
                    {label:"Strengthen capital reserve via net contribution",icon:"🏦"},
                  ].map(g=>(
                    <div key={g.label} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                      <div className="text-xl mb-1">{g.icon}</div>
                      <div className="text-xs text-slate-600">{g.label}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                  <span className="font-bold">Capital link:</span> Improving program margin from 6–7% to 10–12% over several years directly supports operating reserves, deferred maintenance reduction, facility reinvestment, and capital reserve strengthening. Program discipline is infrastructure investment.
                </div>
              </GuideSection>

              {/* Quarterly Review */}
              <GuideSection title="Quarterly Review Process" accent="#d4a017">
                <p className="text-sm text-slate-600 mb-3">Rec Admin conducts quarterly program reviews focusing on five areas. Use the Program Review tab to log reviews for individual programs.</p>
                <div className="space-y-2">
                  {[
                    {item:"Margin movement",detail:"Which programs improved or declined? Are the right programs growing?"},
                    {item:"Programs below thresholds",detail:"Any new programs crossing into Monitor or Needs Redesign? What's the plan?"},
                    {item:"Redesign plans",detail:"Status check on programs that were flagged last quarter. Are changes being made?"},
                    {item:"Innovation pilots",detail:"How are pilots performing? Continue, modify, or sunset?"},
                    {item:"Service offering balance",detail:"Is the portfolio mix still aligned with the district's mission and financial targets?"},
                  ].map((r,i)=>(
                    <div key={i} className="flex gap-3 p-3 rounded-lg border border-slate-100">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0 mt-0.5" style={{background:"#d4a017",color:"#1e3a5f"}}>{i+1}</span>
                      <div>
                        <div className="text-sm font-bold text-slate-700">{r.item}</div>
                        <div className="text-xs text-slate-400">{r.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* Action thresholds quick ref */}
              <GuideSection title="Action Thresholds — Quick Reference" accent="#dc2626">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase">
                      <th className="px-4 py-2 text-left font-semibold">Condition</th>
                      <th className="px-4 py-2 text-left font-semibold">Trigger</th>
                      <th className="px-4 py-2 text-left font-semibold">Required Action</th>
                    </tr></thead>
                    <tbody>
                      {[
                        {cond:"Cost recovery below 50%",  trigger:"Any season",            action:"Redesign required OR document intentional subsidy",color:"#fee2e2"},
                        {cond:"Fill rate below 60%",      trigger:"Any season",            action:"Review conversation with supervisor",              color:"#fef9c3"},
                        {cond:"Two weak seasons",         trigger:"Consecutive",           action:"Documented redesign plan required",               color:"#fef3c7"},
                        {cond:"Three weak seasons",       trigger:"Consecutive",           action:"Formal sunset review required",                   color:"#fee2e2"},
                        {cond:"Pilot misses targets",     trigger:"End of pilot season",   action:"Modify or sunset — do not carry forward",         color:"#fef9c3"},
                        {cond:"Prime time underutilized", trigger:"Scheduling review",     action:"Reschedule or replace with higher-demand program", color:"#f1f5f9"},
                      ].map((r,i)=>(
                        <tr key={i} className="border-t border-slate-50" style={{background:r.color}}>
                          <td className="px-4 py-2.5 font-semibold text-slate-700 text-xs">{r.cond}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{r.trigger}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 font-medium">{r.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GuideSection>
            </>
          )}
        </div>
      )}

      {sec==="review"&&isManager&&(
        <ProgramReviewSection db={db}/>
      )}

      {sec==="training"&&(
        <div className="p-5 space-y-6">
          {!isManager ? (
            <>
              {/* ── STAFF HEADER ── */}
              <div className="rounded-xl p-6 text-white" style={{background:"linear-gradient(135deg,#1e3a5f 0%,#0f2d4a 100%)"}}>
                <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{color:"#d4a017"}}>Staff Training Guide</div>
                <div className="text-2xl font-black mb-2">Using the BGPD Recreation App</div>
                <div className="text-sm opacity-80 mb-4">This guide walks you through everything in the app — what each number means, how to enter your programs, and how to keep your data current. Read it once and refer back as needed.</div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  {[{n:"1",l:"Log in & set up"},{n:"2",l:"Add your programs"},{n:"3",l:"Update as they run"}].map(s=>(
                    <div key={s.n} className="rounded-lg p-2" style={{background:"rgba(255,255,255,0.1)"}}>
                      <div className="text-lg font-black" style={{color:"#d4a017"}}>{s.n}</div>
                      <div className="opacity-80">{s.l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── GETTING STARTED ── */}
              <GuideSection title="Step 1 — Getting Started" accent="#1e3a5f">
                <p className="text-sm text-slate-600 mb-4">The app runs in your browser — nothing to download or install. Your manager will share a link. Open it on any computer or phone.</p>
                <div className="rounded-lg border border-slate-200 overflow-hidden mb-4">
                  <div className="px-4 py-2 bg-slate-800 text-white text-xs font-bold uppercase tracking-widest">First Time Setup</div>
                  <div className="p-4 space-y-3">
                    {[
                      {n:"1",text:"Open the app link in your browser"},
                      {n:"2",text:'Type your first and last name (e.g. "Jane Smith") and click Enter — always use both names'},
                      {n:"3",text:"Your name is saved automatically — you won't need to type it again on this device"},
                    ].map(s=>(
                      <div key={s.n} className="flex gap-3 items-start">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0" style={{background:"#1e3a5f"}}>{s.n}</div>
                        <div className="text-sm text-slate-600 pt-0.5">{s.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                  <span className="font-bold">Important — always use your first and last name.</span> "Jane" and "Jane Smith" are treated as two different people. If your name isn't consistent across all your programs, they won't appear together when someone filters by staff name. Use the same spelling every time.
                </div>
              </GuideSection>

              {/* ── TABS OVERVIEW ── */}
              <GuideSection title="What Each Tab Does" accent="#1e3a5f">
                <div className="space-y-3">
                  {[
                    {icon:"📊",label:"Dashboard",color:"#1e3a5f",desc:"Your home screen. Shows all your programs as a list with performance numbers. This is where you'll spend most of your time — checking fill rates, updating status, and spotting anything that needs attention."},
                    {icon:"📁",label:"Programs",color:"#0f766e",desc:"Where you add new programs and edit existing ones. Think of this as your filing cabinet — every program you run gets an entry here with its enrollment, costs, and revenue."},
                    {icon:"📅",label:"Multi-Season",color:"#7c3aed",desc:"A side-by-side view of the same program across multiple seasons. Useful when your manager asks how Fall Dance has trended over the past few years."},
                    {icon:"📚",label:"Reference",color:"#d4a017",desc:"District standards, formulas, and this training guide. If you ever wonder what a number means or how it's calculated, this is where to look."},
                  ].map(t=>(
                    <div key={t.label} className="flex gap-3 p-4 rounded-lg border border-slate-100 bg-slate-50">
                      <div className="text-2xl shrink-0">{t.icon}</div>
                      <div>
                        <div className="text-sm font-bold mb-0.5" style={{color:t.color}}>{t.label}</div>
                        <div className="text-xs text-slate-500">{t.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* ── ADDING A PROGRAM ── */}
              <GuideSection title="Step 2 — How to Add a Program" accent="#0f766e">
                <p className="text-sm text-slate-600 mb-4">Every program you run — classes, camps, events, leagues — should have its own entry. Click <span className="font-bold text-slate-800">+ Add Program</span> on the Dashboard or Programs tab to get started.</p>

                <div className="space-y-3">
                  {/* Section 1 - Basic Info */}
                  <div className="rounded-lg border border-slate-100 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center gap-2" style={{background:"#1e3a5f"}}>
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs font-black shrink-0" style={{color:"#1e3a5f"}}>1</span>
                      <span className="text-sm font-bold text-white">Basic Info</span>
                    </div>
                    <div className="p-4 space-y-3">
                      {[
                        {field:"Program Name",tip:"Be specific. \"Adult Watercolor – Fall 2025\" is better than just \"Watercolor.\" This helps you find it later and makes year-over-year comparisons clear."},
                        {field:"Area",tip:"Pick the closest match from the dropdown (Aquatics, Camps, Dance, etc.). This groups your programs with similar ones in department reports."},
                        {field:"Season & Year",tip:"The season when this program runs — Spring, Summer, Fall, or Winter. Use the year it starts. Summer 2026 = June 2026 start."},
                        {field:"Staff Name",tip:"Your name, typed exactly as you entered it when you logged in. If you manage this program with someone else, enter the primary responsible person."},
                        {field:"Classification",tip:"Community Driven = offered for public benefit even at a subsidy (e.g. teen drop-ins, adaptive programs). Revenue Driven = expected to cover costs (e.g. fitness classes, swimming lessons). Not sure? Ask your manager."},
                      ].map(r=>(
                        <div key={r.field} className="text-sm">
                          <div className="font-semibold text-slate-700 mb-0.5">{r.field}</div>
                          <div className="text-xs text-slate-500">{r.tip}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section 2 - Enrollment */}
                  <div className="rounded-lg border border-slate-100 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center gap-2" style={{background:"#0f766e"}}>
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs font-black shrink-0" style={{color:"#0f766e"}}>2</span>
                      <span className="text-sm font-bold text-white">Enrollment Numbers</span>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-800 mb-3">
                        <span className="font-bold">Budgeted = your plan before the program runs. Actual = what really happened.</span> You'll fill in Budgeted first, then come back and update Actual after registration closes.
                      </div>
                      {[
                        {field:"Budgeted Enrollment",tip:"Your registration target. How many participants are you hoping to get? This is your goal before the program starts."},
                        {field:"Actual Enrollment",tip:"How many actually registered. Update this once registration closes or the program ends. Leave blank until you know — don't guess."},
                        {field:"Capacity",tip:"The maximum number your space or instructor can handle. If a room holds 20, capacity is 20. Always fill this in — the app needs it to calculate your fill rate."},
                        {field:"Waitlist",tip:"Anyone who wanted to register but couldn't because the program was full. Enter this separately. It signals that you could run another section."},
                      ].map(r=>(
                        <div key={r.field} className="text-sm">
                          <div className="font-semibold text-slate-700 mb-0.5">{r.field}</div>
                          <div className="text-xs text-slate-500">{r.tip}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section 3 - Revenue */}
                  <div className="rounded-lg border border-slate-100 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center gap-2" style={{background:"#d4a017"}}>
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs font-black shrink-0" style={{color:"#d4a017"}}>3</span>
                      <span className="text-sm font-bold text-white">Revenue</span>
                    </div>
                    <div className="p-4 space-y-3">
                      {[
                        {field:"Budgeted Revenue",tip:"Budgeted revenue before the program runs. A quick estimate: your fee × budgeted enrollment is a good starting point. (Example: $85/person × 20 people = $1,700)"},
                        {field:"Actual Revenue",tip:"What was actually collected after the program. This might differ from budgeted if enrollment was higher or lower than expected, or if scholarships/discounts were applied."},
                      ].map(r=>(
                        <div key={r.field} className="text-sm">
                          <div className="font-semibold text-slate-700 mb-0.5">{r.field}</div>
                          <div className="text-xs text-slate-500">{r.tip}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section 4 - Costs */}
                  <div className="rounded-lg border border-slate-100 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center gap-2" style={{background:"#64748b"}}>
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-xs font-black shrink-0" style={{color:"#64748b"}}>4</span>
                      <span className="text-sm font-bold text-white">Costs — What Goes Where</span>
                    </div>
                    <div className="p-4 space-y-3">
                      <p className="text-xs text-slate-500 mb-2">You enter direct costs. The app automatically adds overhead (10%) and facility cost ($3/hr). You don't need to calculate those yourself.</p>
                      {[
                        {field:"Personnel",tip:"Wages paid to part-time instructors, lifeguards, counselors, or any hourly staff. Do not include your own salary here — that's handled by Program Type."},
                        {field:"Commodities",tip:"Supplies, materials, equipment, uniforms, printing — anything physical you buy for the program."},
                        {field:"Contractuals",tip:"Payments to outside vendors or contractors. For example, a hired performer, a DJ, a licensed curriculum provider."},
                        {field:"Custom Cost Lines",tip:"Two extra lines you can label yourself. Use these for anything that doesn't fit above — for example, transportation, food, permits."},
                        {field:"Facility Hours",tip:"How many hours of district space did this program use? The app charges $3/hour automatically. A 10-week class meeting 2 hrs/week = 20 facility hours."},
                        {field:"Program Type — Very Important",tip:"This tells the app how much of your full-time staff salary to allocate to this program. If you leave it blank, your staff cost shows as $0 — which makes the program look cheaper than it really is. Use Core Program for regular offerings, Special Event for one-time events."},
                      ].map(r=>(
                        <div key={r.field} className="text-sm">
                          <div className="font-semibold text-slate-700 mb-0.5">{r.field}</div>
                          <div className="text-xs text-slate-500">{r.tip}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </GuideSection>

              {/* ── UNDERSTANDING METRICS ── */}
              <GuideSection title="Step 3 — Understanding Your Numbers" accent="#d4a017">
                <p className="text-sm text-slate-600 mb-1">Once your program is saved, the app calculates several performance numbers automatically. Here's exactly what each one means and why it matters.</p>
                <p className="text-xs text-slate-400 mb-4">You'll see these on your Dashboard and in the Programs list.</p>

                {/* Fill Rate */}
                <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">Fill Rate</div>
                    <div className="font-mono text-xs bg-slate-800 text-slate-100 rounded px-2 py-1 mt-1 inline-block">Actual Enrollment ÷ Capacity</div>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-slate-600">
                    <p>Fill rate tells you how full your program was compared to how many spots were available. If you had 25 spots and 18 people registered, your fill rate is 72%.</p>
                    <p className="font-semibold text-slate-700">What the targets mean:</p>
                    <div className="space-y-1">
                      <div className="flex gap-2 items-center"><span className="w-2 h-2 rounded-full bg-green-500 shrink-0"/><span><span className="font-semibold text-green-700">70% or above = Healthy.</span> Strong demand. No action needed.</span></div>
                      <div className="flex gap-2 items-center"><span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0"/><span><span className="font-semibold text-yellow-700">60–69% = Monitor.</span> Getting close to the threshold. Keep an eye on registration trends.</span></div>
                      <div className="flex gap-2 items-center"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0"/><span><span className="font-semibold text-red-600">Below 60% = Needs Redesign.</span> Low demand. Expect a conversation with your manager about whether to adjust timing, format, or marketing.</span></div>
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-amber-800 mt-2">
                      <span className="font-bold">Common issue:</span> If your fill rate shows 0%, it usually means you forgot to enter Capacity. Go back and edit the program.
                    </div>
                  </div>
                </div>

                {/* Cost Recovery */}
                <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">Cost Recovery</div>
                    <div className="font-mono text-xs bg-slate-800 text-slate-100 rounded px-2 py-1 mt-1 inline-block">Actual Revenue ÷ Total Program Cost</div>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-slate-600">
                    <p>Cost recovery tells you what percentage of the program's cost was covered by what participants paid. 100% means break-even — fees covered every dollar of cost. Below 100% means the district subsidized the rest.</p>
                    <p><span className="font-semibold text-slate-700">Example:</span> Your program cost $1,500 to run and brought in $1,200 in fees. Cost recovery = 80%. The district covered the remaining $300.</p>
                    <p className="font-semibold text-slate-700">Important context:</p>
                    <p>Not every program is expected to reach 100%. Community Driven programs (adaptive rec, teen drop-ins, free events) may have a target of 0–20% by design — the district intentionally subsidizes them because they serve the community. Check the District Standards tab for your specific program category's target.</p>
                    <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-blue-800 mt-2">
                      <span className="font-bold">Low cost recovery does not mean your program was bad.</span> It depends entirely on what type of program it is. A swim lesson class should cover its costs. A free family event is not expected to.
                    </div>
                  </div>
                </div>

                {/* Net P/L */}
                <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">Net Profit / (Loss)</div>
                    <div className="font-mono text-xs bg-slate-800 text-slate-100 rounded px-2 py-1 mt-1 inline-block">Actual Revenue − Total Program Cost</div>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-slate-600">
                    <p>The dollar amount left over (or the dollar amount the district covered). A positive number means the program generated more in fees than it cost to run. A negative number means the district made up the difference.</p>
                    <p><span className="font-semibold text-slate-700">Example:</span> Revenue $1,200, total cost $1,500 → Net ($300). The district subsidized this program by $300.</p>
                    <p>Use this to understand financial impact, not to judge whether a program should continue. A ($2,000) loss on a community skating event serving 400 residents is a very different story than a ($2,000) loss on a small fitness class with 3 participants.</p>
                  </div>
                </div>

                {/* Total Program Cost */}
                <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">Total Program Cost — How It's Built</div>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-slate-600">
                    <p>The total cost shown in the app is <span className="font-semibold">not just what you entered</span>. Four layers are stacked together:</p>
                    <div className="space-y-2 mt-2">
                      {[
                        {n:"1",label:"Your Direct Costs",text:"Personnel + Commodities + Contractuals + custom cost lines. These are numbers you entered."},
                        {n:"2",label:"Admin Overhead (10%)",text:"Added automatically. Covers district-level administrative support. You don't enter this."},
                        {n:"3",label:"FT Staff Cost",text:"$97,700 × your Program Type percentage. This is your salary allocated to the program based on how complex it is to manage."},
                        {n:"4",label:"Facility Cost",text:"$3/hour × the facility hours you entered. Covers the cost of using district space."},
                      ].map(r=>(
                        <div key={r.n} className="flex gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0" style={{background:"#1e3a5f"}}>{r.n}</div>
                          <div><span className="font-semibold text-slate-700">{r.label} — </span><span className="text-slate-500">{r.text}</span></div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 mt-2">
                      <span className="font-bold">This is why Program Type matters so much.</span> If you don't select a Program Type, layer 3 becomes $0 — which makes the program look much cheaper than it really is, and inflates the cost recovery percentage artificially.
                    </div>
                  </div>
                </div>

                {/* Program Status */}
                <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">Program Status — the Badge</div>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-slate-600">
                    <p>The colored badge next to each program is calculated automatically from fill rate and cost recovery combined. You cannot manually set it.</p>
                    <div className="space-y-2 mt-2">
                      {[
                        {s:"Healthy",color:"#22c55e",rule:"Fill rate ≥ 70% AND cost recovery ≥ 100%",detail:"Program is well-attended and financially sound. No action needed."},
                        {s:"Monitor",color:"#eab308",rule:"Fill rate between 60–69%",detail:"One metric is borderline. Keep an eye on it — no action required yet but trends matter."},
                        {s:"Needs Redesign",color:"#ef4444",rule:"Fill rate below 60% OR cost recovery below 50%",detail:"Significantly underperforming on at least one dimension. Your manager will likely follow up."},
                      ].map(r=>(
                        <div key={r.s} className="flex gap-3 p-3 rounded-lg border border-slate-100">
                          <span className="px-2 py-0.5 rounded text-xs font-bold text-white h-fit mt-0.5 shrink-0" style={{backgroundColor:r.color}}>{r.s}</span>
                          <div><div className="font-semibold text-slate-600 mb-0.5">{r.rule}</div><div className="text-slate-400">{r.detail}</div></div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-blue-800 mt-2">
                      <span className="font-bold">Status uses Actual numbers when available.</span> If you haven't entered Actual Enrollment or Actual Revenue yet, it falls back to Budgeted numbers — so it may not reflect what really happened until you update those fields.
                    </div>
                  </div>
                </div>

                {/* Trend */}
                <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">Trend</div>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-slate-600">
                    <p>Trend shows whether enrollment is growing, stable, or declining compared to the same season last year. You set this manually on the program form — it's not calculated automatically.</p>
                    <div className="space-y-1.5">
                      {[
                        {t:"Growing",c:"#22c55e",d:"Enrollment is up vs. the same season last year"},
                        {t:"Stable",c:"#64748b",d:"Enrollment is roughly the same year over year"},
                        {t:"Declining",c:"#ef4444",d:"Enrollment is down vs. last year — flags for manager attention"},
                        {t:"New",c:"#7c3aed",d:"First time offering — no prior year to compare"},
                      ].map(r=>(
                        <div key={r.t} className="flex gap-2 items-center"><span className="font-bold text-xs w-16 shrink-0" style={{color:r.c}}>{r.t}</span><span className="text-slate-500">{r.d}</span></div>
                      ))}
                    </div>
                    <p className="text-slate-400 mt-2">If you're unsure, use Stable. Your manager may update this during review.</p>
                  </div>
                </div>

                {/* NPS */}
                <div className="rounded-xl border border-slate-200 overflow-hidden mb-4">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">NPS — Net Promoter Score</div>
                  </div>
                  <div className="p-4 space-y-2 text-xs text-slate-600">
                    <p>NPS is a standard customer satisfaction measure ranging from 0 to 100. It comes from a survey question: <span className="italic">"How likely are you to recommend this program to a friend?"</span> You enter it manually if you collected it.</p>
                    <div className="grid grid-cols-3 gap-2 text-center mt-2">
                      <div className="p-2 rounded-lg bg-green-50 border border-green-100"><div className="font-bold text-green-700">70–100</div><div className="text-slate-500 mt-0.5">Strong — participants are enthusiastic</div></div>
                      <div className="p-2 rounded-lg bg-yellow-50 border border-yellow-100"><div className="font-bold text-yellow-700">50–69</div><div className="text-slate-500 mt-0.5">Acceptable — room to improve</div></div>
                      <div className="p-2 rounded-lg bg-red-50 border border-red-100"><div className="font-bold text-red-600">0–49</div><div className="text-slate-500 mt-0.5">Needs review — some dissatisfaction</div></div>
                    </div>
                    <p className="text-slate-400 mt-2">NPS is optional. If you didn't collect it, leave the field blank. It won't affect fill rate or cost recovery calculations.</p>
                  </div>
                </div>
              </GuideSection>

              {/* ── WHEN TO UPDATE ── */}
              <GuideSection title="Step 4 — When to Update Your Data" accent="#0f766e">
                <p className="text-sm text-slate-600 mb-4">The dashboard is only useful if the data is current. Here's what to do and when.</p>
                <div className="space-y-2">
                  {[
                    {when:"Before registration opens",icon:"📋",color:"#1e3a5f",what:"Create the program entry. Fill in: Program Name, Area, Season/Year, Staff Name, Classification, Program Type, Capacity, Budgeted Enrollment, Budgeted Revenue, and all known direct costs. This gives your manager a planning view."},
                    {when:"When registration closes",icon:"✅",color:"#0f766e",what:"Update Actual Enrollment with the final count. Add any Waitlist numbers. Revenue doesn't need to be final yet if collection isn't complete."},
                    {when:"When the program ends",icon:"💰",color:"#d4a017",what:"Update Actual Revenue with what was collected. Confirm costs are accurate. Set the Trend field (Growing/Stable/Declining). Add any Notes that explain unusual results — a canceled week, a weather cancellation, an unusually large group."},
                    {when:"If you collected participant feedback",icon:"⭐",color:"#7c3aed",what:"Add your NPS score. Optional but valuable for long-term program tracking."},
                    {when:"Anytime something changes",icon:"✏️",color:"#64748b",what:"Click the program name from the Dashboard or Programs tab and edit it. Every change saves immediately and metrics recalculate right away."},
                  ].map((r,i)=>(
                    <div key={i} className="flex gap-3 p-4 rounded-lg border border-slate-100">
                      <div className="text-xl shrink-0">{r.icon}</div>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{color:r.color}}>{r.when}</div>
                        <div className="text-sm text-slate-500">{r.what}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* ── EXPORTING ── */}
              <GuideSection title="Exporting and Reports" accent="#64748b">
                <div className="space-y-3">
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-sm font-bold text-slate-700 mb-1">↓ Export CSV</div>
                    <div className="text-xs text-slate-500 mb-2">Downloads a spreadsheet of all visible programs with all metrics calculated. Opens in Excel or Google Sheets.</div>
                    <div className="text-xs text-slate-400">Tip: filter to your name first, then export — so you only get your own programs.</div>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-sm font-bold text-slate-700 mb-1">⬜ Season Report (PDF)</div>
                    <div className="text-xs text-slate-500 mb-2">Generates a printable summary of your filtered programs. Opens your browser's print dialog — choose "Save as PDF."</div>
                    <div className="text-xs text-slate-400">Tip: set your filters first (your name, a specific season) before clicking — the report shows exactly what's on screen.</div>
                  </div>
                </div>
              </GuideSection>

              {/* ── FAQ ── */}
              <GuideSection title="Common Questions" accent="#7c3aed">
                <div className="space-y-3">
                  {[
                    {q:"My program shows 'Needs Redesign' but it actually went really well. What's wrong?",a:"Status is calculated from your actual numbers. If Actual Enrollment or Actual Revenue hasn't been updated since the program ran, the app is still using your budgeted figures — which may have been conservative. Go edit the program and enter the real numbers. Status will update immediately."},
                    {q:"My fill rate shows 0% but the program ran fine.",a:"This almost always means Capacity was left blank or set to 0. Without a capacity number, the app can't calculate how full you were. Go back and add it."},
                    {q:"I don't know what Program Type to pick.",a:"Start here: is it a regular ongoing class or activity? Pick Core Program. Is it a one-time event? Pick Special Event. Is it a series of classes? Pick Small Program or Large Program depending on how complex it is. Your manager can help you pick if you're unsure — it's better to ask than leave it blank."},
                    {q:"My cost recovery is very low. Am I doing something wrong?",a:"Not necessarily. Cost recovery targets vary by program type. A community benefit program (adaptive rec, a free event, a subsidized youth program) may have a 0–20% target by design. Check the District Standards tab under your program's category. If your target is low, a low cost recovery is expected and appropriate."},
                    {q:"Should I enter every program, even small or one-time ones?",a:"Yes. The dashboard averages and comparisons are only accurate when all programs are entered. A partial list skews the metrics and makes the portfolio look healthier or sicker than it really is."},
                    {q:"A program was canceled midway. How do I enter it?",a:"Enter it as you planned, then update Actual Enrollment and Actual Revenue to reflect what happened before the cancellation. Add a note explaining it was canceled (e.g. 'Canceled after week 4 — low enrollment'). This keeps the record honest and gives context for future planning."},
                    {q:"I made a mistake. Can I change data after saving?",a:"Yes, anytime. Click the program name on the Dashboard or Programs tab, edit any field, and save. All metrics recalculate immediately. There's no lock-out period."},
                    {q:"What's the difference between Budgeted and Actual fields?",a:"Budgeted = your plan before the program runs (enrollment target, budgeted revenue). Actual = what really happened (real enrollment count, real revenue collected). You fill in Budgeted first, then come back and update Actual after the program ends."},
                  ].map((r,i)=>(
                    <div key={i} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 text-sm font-semibold text-slate-700 border-b border-slate-100">{r.q}</div>
                      <div className="px-4 py-3 text-sm text-slate-500">{r.a}</div>
                    </div>
                  ))}
                </div>
              </GuideSection>
            </>
          ) : (
            <>
              {/* ── MANAGER HEADER ── */}
              <div className="rounded-xl p-6 text-white" style={{background:"linear-gradient(135deg,#1e3a5f 0%,#7c3aed 100%)"}}>
                <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{color:"#d4a017"}}>Manager Training Guide</div>
                <div className="text-2xl font-black mb-2">Leading with Data — BGPD Recreation App</div>
                <div className="text-sm opacity-80 mb-4">How to use the dashboard to manage your team, evaluate programs, and communicate results. This guide covers everything you see that staff don't — and how to use it.</div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  {["Portfolio view","Analytics","Action queues","Admin KPIs"].map(l=>(
                    <div key={l} className="rounded-lg p-2" style={{background:"rgba(255,255,255,0.1)"}}>
                      <div className="opacity-80">{l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── MANAGER vs STAFF VIEW ── */}
              <GuideSection title="What You See That Staff Don't" accent="#1e3a5f">
                <p className="text-sm text-slate-600 mb-4">When you toggle to Manager View, the dashboard expands significantly. Here's what's added:</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    {icon:"👁",label:"Full portfolio view",desc:"See every staff member's programs, not just your own. Filter by staff name, area, season, or year in any combination."},
                    {icon:"📊",label:"Health Score (0–100)",desc:"A composite score across fill rate, cost recovery, trend, and NPS. One number that tells you how the portfolio is doing at a glance."},
                    {icon:"🚨",label:"Needs Attention queue",desc:"Auto-surfaced programs falling below thresholds. Your weekly action list — sorted worst first."},
                    {icon:"↕",label:"Year-over-year comparison",desc:"Each program row shows how fill rate and cost recovery changed vs. the same season last year."},
                    {icon:"💰",label:"Subsidy Burden",desc:"Total dollar amount the district subsidizes — the sum of all program deficits. Useful for budget conversations."},
                    {icon:"⭐",label:"Admin tab (★)",desc:"Fund-level financials, G&O tracking, rental history, and historical KPIs. Directors and managers only."},
                  ].map(c=>(
                    <div key={c.label} className="flex gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                      <div className="text-xl shrink-0">{c.icon}</div>
                      <div>
                        <div className="text-sm font-bold text-slate-700">{c.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{c.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* ── FILTERS ── */}
              <GuideSection title="Using Filters Strategically" accent="#d4a017">
                <p className="text-sm text-slate-600 mb-3">Every metric, chart, and table updates in real time when you change a filter. Filters are your primary analysis tool.</p>
                <div className="space-y-2">
                  {[
                    {use:"Staff review prep",how:"Filter to one staff member. Every metric — fill rate, cost recovery, status counts, Needs Attention — reflects only their programs. Export CSV for a one-pager to bring to the meeting."},
                    {use:"Season benchmarking",how:"Filter to a single season (e.g. Summer) across all years. The YoY column in Program Detail shows growth or decline for each program. The top/bottom performers update accordingly."},
                    {use:"Area budget review",how:"Filter to one area. Revenue, costs, and capacity utilization reflect only that area. Capacity Utilization shows fill rates sorted highest to lowest so you can immediately see where demand is strongest."},
                    {use:"End-of-year reporting",how:"Clear all filters for the full portfolio view. Health Score, Subsidy Burden, and all aggregates show the complete picture. Use Season Report or Export CSV for documentation."},
                    {use:"Pricing review",how:"Revenue per Participant by Area shows which areas generate more revenue per enrolled person. Use this alongside cost recovery targets from District Standards to identify where fees may warrant adjustment."},
                  ].map((r,i)=>(
                    <div key={i} className="flex gap-3 p-3 rounded-lg border border-slate-100">
                      <div className="shrink-0 mt-0.5"><span className="inline-block bg-slate-800 text-white text-xs font-bold px-2 py-0.5 rounded">{r.use}</span></div>
                      <div className="text-sm text-slate-500">{r.how}</div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* ── READING THE DASHBOARD ── */}
              <GuideSection title="Reading Each Dashboard Section" accent="#1e3a5f">
                <div className="space-y-3">
                  {[
                    {title:"KPI Cards (top row)",color:"#1e3a5f",points:["Avg Fill Rate and Avg Cost Recovery are portfolio-wide averages across all visible programs — they respond to your filters","Total Net P/(L) is combined surplus/deficit at program-cost level, not fund-level","Health distribution: Healthy, Monitor, Needs Redesign counts with a dot showing 'Below 50% Recovery' as a separate flag"]},
                    {title:"Program Snapshot: Budgeted vs. Actual",color:"#0f766e",points:["Dark bar = actual, lighter bar = budget. The goal: actual revenue and enrollment at or above budget; actual cost at or below","Large gaps are conversation starters — check if actuals have been updated by staff before drawing conclusions","If a program shows $0 actual revenue but it ran, the staff member hasn't updated it yet"]},
                    {title:"Needs Attention Queue",color:"#dc2626",points:["Auto-populated with programs meeting one of three conditions: Needs Redesign status, Declining trend, or fill rate below 50%","Sorted by lowest fill rate — worst performers first. Capped at 8 programs","Each program here needs a decision: redesign format, remarket, adjust price, reduce capacity, or sunset"]},
                    {title:"Top & Bottom Performers",color:"#166534",points:["Top 3 and Bottom 3 by fill rate and cost recovery — tells you what's working and what isn't","Click any program name to open it for editing","Bottom performers may be misclassified or missing data — check Program Type and actuals before drawing conclusions"]},
                    {title:"Capacity Utilization by Area",color:"#7c3aed",points:["Areas sorted by fill rate descending — highest demand at top. Green = 70%+, Yellow = 60–69%, Red = below 60%","Cost recovery and net P/(L) shown inline so you see both financial dimensions at once","Waitlist count shown when present — areas with waitlists have proven demand for expansion"]},
                    {title:"Revenue per Participant by Area",color:"#b45309",points:["Higher figure = more revenue per enrolled person. Community service areas will be lower by design","Overall average in the subheader is your portfolio benchmark","Use alongside cost recovery targets — a low Rev/Participant is fine if the cost recovery target for that area is low"]},
                    {title:"Program Mix by Classification",color:"#64748b",points:["Shows the balance of Community Driven, Revenue Driven, and Both programs","Revenue and net figures per classification frame subsidy discussions: 'We subsidize X% of Community Driven programs totaling $Y'","Too skewed toward revenue-driven may signal under-investment in community benefit; too skewed the other way may create budget pressure"]},
                  ].map(s=>(
                    <div key={s.title} className="rounded-lg border border-slate-100 overflow-hidden">
                      <div className="px-4 py-2.5 text-sm font-bold text-white" style={{backgroundColor:s.color}}>{s.title}</div>
                      <ul className="p-3 space-y-1.5">
                        {s.points.map(pt=>(
                          <li key={pt} className="flex gap-2 text-xs text-slate-600"><span className="shrink-0 mt-0.5" style={{color:s.color}}>›</span>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* ── HEALTH SCORE ── */}
              <GuideSection title="The Health Score — What It Measures" accent="#d4a017">
                <p className="text-sm text-slate-600 mb-3">A composite 0–100 score combining the four most important signals. Useful for quick portfolio scanning and board-level communication.</p>
                <table className="w-full text-sm mb-4">
                  <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-2 text-left font-semibold">Component</th>
                    <th className="px-4 py-2 text-left font-semibold">Weight</th>
                    <th className="px-4 py-2 text-left font-semibold">What it captures</th>
                  </tr></thead>
                  <tbody>
                    {[
                      {c:"Fill Rate",w:"40%",d:"Are people showing up? Highest weight — most direct demand signal."},
                      {c:"Cost Recovery",w:"30%",d:"Is the program meeting its financial target? Community benefit programs get credit at lower levels."},
                      {c:"Trend",w:"20%",d:"Is enrollment growing, stable, or declining vs. same season last year?"},
                      {c:"NPS",w:"10%",d:"Are participants satisfied? Only scored when NPS data exists; excluded if blank."},
                    ].map((r,i)=>(
                      <tr key={r.c} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                        <td className="px-4 py-2.5 font-semibold text-slate-700">{r.c}</td>
                        <td className="px-4 py-2.5"><span className="font-mono font-bold text-sm" style={{color:"#d4a017"}}>{r.w}</span></td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{r.d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  {[{r:"75–100",l:"Strong",c:"#166534",bg:"#dcfce7"},{r:"50–74",l:"Developing",c:"#854d0e",bg:"#fef9c3"},{r:"0–49",l:"Needs Attention",c:"#991b1b",bg:"#fee2e2"}].map(b=>(
                    <div key={b.l} className="p-2 rounded-lg border" style={{backgroundColor:b.bg}}>
                      <div className="font-bold" style={{color:b.c}}>{b.r}</div>
                      <div className="text-slate-500 mt-0.5">{b.l}</div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* ── ADMIN TAB ── */}
              <GuideSection title="The Admin Tab — Fund-Level KPIs" accent="#0f766e">
                <p className="text-sm text-slate-600 mb-3">The ★ Admin tab contains financial and operational data above the program level — organized by fund and tracked year over year.</p>
                <div className="space-y-2">
                  {[
                    {tab:"★ Executive Summary",desc:"FY-level overview: total revenue, expenses, net P/(L), and goal completion across all funds. YoY tables for Fund 4, Fitness, Clubhouse, and Camps with sparklines. Use for board prep and annual reporting."},
                    {tab:"$ Fund Performance",desc:"Monthly revenue and expenses by fund, compared against monthly goal. Select any fund for a bar chart and full data table. Entries can be added or edited directly here, or they can sync from Google Sheets automatically."},
                    {tab:"✓ Goals & Objectives",desc:"All department G&Os for the current FY. Filter by quarter, core value, or status. Update status inline without opening a modal. Archive completed goals to keep the view clean."},
                    {tab:"⌂ Rentals",desc:"Year-over-year rental revenue by category (Alcott, CAC, Birthdays, Outdoor, etc.). Click any category row to drill into monthly detail and add or edit individual months."},
                    {tab:"◎ Program Areas",desc:"Enrollment and revenue trends for Camps, Clubhouse, and Special Events — year-over-year tables with sparklines and bar charts per FY."},
                    {tab:"◈ Fee History",desc:"Complete fee schedule across fiscal years. Amber highlights show changes vs. prior year. Search by program name or filter by area. Contractual items flagged separately."},
                  ].map((r,i)=>(
                    <div key={i} className="flex gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50">
                      <div className="shrink-0"><span className="inline-block font-mono text-xs font-bold text-white px-2 py-0.5 rounded" style={{background:"#1e3a5f"}}>{r.tab}</span></div>
                      <div className="text-xs text-slate-500">{r.desc}</div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* ── COACHING STAFF ── */}
              <GuideSection title="Coaching Staff on Data Quality" accent="#7c3aed">
                <p className="text-sm text-slate-600 mb-3">The most common data entry issues and how to address them:</p>
                <div className="space-y-3">
                  {[
                    {issue:"Missing Program Type",impact:"Staff cost allocates as $0 — total program cost is understated, cost recovery looks artificially high",fix:"Ask staff to open the program and select Program Type from the dropdown in the Budgeted section. Cost recalculates immediately."},
                    {issue:"Actuals never updated",impact:"Program shows 0% fill rate and $0 revenue even after running — makes all portfolio averages inaccurate",fix:"Set an expectation: update actuals within 2 weeks of program close. Use the 'Needs Attention' queue — programs with missing actuals often show up here."},
                    {issue:"Capacity left blank",impact:"Fill rate shows 0% for every program that staff member manages",fix:"Ask staff to edit each program and enter the maximum capacity (room size, instructor limit, etc.)."},
                    {issue:"All programs entered under one name",impact:"Filtering by staff member doesn't work; workload distribution is inaccurate",fix:"Staff name on each program must match exactly how staff logged in. If someone uses 'Joe' in one program and 'Joe Smith' in another, they appear as two different people."},
                    {issue:"Revenue not updated after collection",impact:"Net P/(L) is negative even for financially healthy programs",fix:"Remind staff to update Actual Revenue after all payments are processed — not when registration closes, but after the program ends and final collections are confirmed."},
                  ].map((r,i)=>(
                    <div key={i} className="rounded-lg border border-slate-100 overflow-hidden">
                      <div className="px-4 py-2.5 bg-red-50 border-b border-red-100 text-xs font-bold text-red-700">⚠ {r.issue}</div>
                      <div className="p-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
                        <div className="text-xs text-slate-500"><span className="font-semibold text-slate-600">Impact: </span>{r.impact}</div>
                        <div className="text-xs text-slate-500"><span className="font-semibold text-slate-600">Fix: </span>{r.fix}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GuideSection>

              {/* ── MANAGER FAQ ── */}
              <GuideSection title="Common Manager Questions" accent="#1e3a5f">
                <div className="space-y-3">
                  {[
                    {q:"A program shows Needs Redesign but the staff member says it went great. How do I reconcile that?",a:"Check whether actuals have been updated. If Actual Enrollment and Actual Revenue are still blank or showing budgeted numbers, the status is based on pre-program estimates. Ask the staff member to update their actuals first — then revisit the status."},
                    {q:"The Health Score dropped significantly. What should I look for?",a:"Health Score weights fill rate most heavily (40%). A significant drop usually means one or more high-enrollment programs declined, or a batch of new programs with low actuals were added. Filter by season or area to isolate which segment pulled the score down."},
                    {q:"How do I prepare for an annual report using this app?",a:"Clear all filters to show the full portfolio. Note the Health Score, total Net P/(L), and Subsidy Burden. Use the Classification Mix section for the community-benefit vs. revenue narrative. Export CSV for a full data appendix. Export Season Report as a PDF summary. Admin → Executive Summary has fund-level P&L."},
                    {q:"A staff member left. What happens to their programs?",a:"Their programs stay in the system under their name. You can edit each program and reassign it to a new staff member by changing the Staff Name field. Alternatively, leave them as-is for historical accuracy and create new entries for the replacement's future work."},
                    {q:"Can I see how a specific program has performed over multiple years?",a:"Yes — use the Multi-Season tab. Search for the program by name and you'll see its enrollment, revenue, fill rate, and cost recovery side-by-side across all seasons it's been offered."},
                    {q:"What's the difference between the Dashboard Net P/(L) and what I see in the Admin Fund Performance tab?",a:"The Dashboard P/(L) is at the program-cost level — it includes allocated FT staff cost, overhead, and facility charges. The Fund Performance tab tracks actual fund-level revenue and expenses from your financial system. They measure different things and will not match."},
                  ].map((r,i)=>(
                    <div key={i} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 text-sm font-semibold text-slate-700 border-b border-slate-100">{r.q}</div>
                      <div className="px-4 py-3 text-sm text-slate-500">{r.a}</div>
                    </div>
                  ))}
                </div>
              </GuideSection>
            </>
          )}
        </div>
      )
}
    </div>
  );
}

// ─── Guide Section helper ─────────────────────────────────────────────────────
function GuideSection({title,accent,children}) {
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100" style={{borderLeft:`4px solid ${accent}`}}>
        <h3 className="font-bold text-slate-800 text-sm">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN MODULE — Complete Rebuild with Real Data
// ═══════════════════════════════════════════════════════════════════════════════

const ADMIN_FYS   = ["2021-2022","2022-2023","2023-2024","2024-2025","2025-2026","2026-2027"];
const ADMIN_CUR   = "2025-2026";
const FY_MONTHS   = ["May","June","July","August","September","October","November","December","January","February","March","April"];
const QUARTERS_GO = ["Q1 (May–Aug)","Q2 (Sep–Dec)","Q3 (Jan–Mar)","Q4 (Apr)"];
const CORE_VALUES = ["Character","Excellence","Stewardship","Innovation","Community"];
const GOAL_STATUSES = ["Complete","Not Complete","Ongoing","Paused","Not Started"];
const CAMP_LIST   = ["Preschool 2s","Preschool 3s","Preschool 4s & 5s","Kinder Camp","Safety Stars","Adventure","Fun & Games","Grove","Sports Camp","Cycle & Surf","Xtreme Teens","Star Makers","Broadway Bound","Dance","CIT","Camp Connection","Post Camp"];
const CLUB_SITES  = ["Country Meadows","Ivy Hall","Kildeer","Kilmer","Longfellow","Meridian","Prairie","Pritchett","Tripp","Willow Grove"];
const RENTAL_CATS = ["Alcott Center","CAC","Birthdays","Outdoor/FCS","Fields & Courts","Shelters","Amphitheater","Dog Park","Spray N Play","Willow Stream Pool"];
const FUND_LIST   = ["Fund 4 – Recreation","Fitness Center (FCBG)","Clubhouse – All Sites","Camps – All Programs","Special Events","Golf Dome","Museum","Aquatics"];
const EVENT_TYPES = ["Summer Concert","Movie Under the Stars","Holiday Event","Community Festival","Sports Tournament","Special Event","Other"];
const STATUS_CLR  = {"Complete":"#16a34a","Not Complete":"#dc2626","Ongoing":"#b45309","Paused":"#64748b","Not Started":"#94a3b8"};
const STATUS_BG   = {"Complete":"#dcfce7","Not Complete":"#fee2e2","Ongoing":"#fef9c3","Paused":"#f1f5f9","Not Started":"#f8fafc"};
const FUND_COLORS = {
  "Fund 4 – Recreation":"#1e3a5f",
  "Fitness Center (FCBG)":"#0369a1",
  "Clubhouse – All Sites":"#0f766e",
  "Camps – All Programs":"#7c3aed",
  "Special Events":"#b45309",
  "Golf Dome":"#15803d",
  "Museum":"#9f1239",
  "Aquatics":"#0284c7",
};

// ─── Seed data from spreadsheets ─────────────────────────────────────────────
const SEED_GOALS = [
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Aly Stanczak",supporting_staff:"Jenn Foreman",objective:"By June 15, 2025, Aly & Jen will research and order reusable icepacks for performing arts camps to reduce injuries and single-use plastics.",core_value:"Stewardship",status:"Complete",updates:"All camps at the CAC have had access to the reusable ice packs and have been using them throughout the summer.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Aly Stanczak",supporting_staff:"",objective:"Aly will create a new digital dance pamphlet containing the full schedule, dress code, and guidelines for all dance programming.",core_value:"Innovation",status:"Complete",updates:"The new digital dance pamphlet is complete and accessible by QR code in the park district's catalog.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Amanda Busch",supporting_staff:"Shannon McClure",objective:"Amanda and Shannon will design and implement a new organization system for Clubhouse registration that ensures accurate deposit tracking.",core_value:"Excellence",status:"Complete",updates:"We developed a streamlined system that ensured deposit payments were processed properly for all Clubhouse sites.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Ann Marie Shipstad-Schwartz",supporting_staff:"",objective:"Ann Marie will meet with staff from Chicago Kiln to implement ceramic offerings for the art room.",core_value:"Innovation",status:"Complete",updates:"A meeting was held in early June with Carl Mankert from Chicago Kiln. After touring the facility, a partnership plan was established.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Brian O'Malley",supporting_staff:"",objective:"Brian will improve office security by replacing the shared office code with unique codes for each part-time staff member.",core_value:"Excellence",status:"Complete",updates:"The shared office code has been removed, and fall staff have been issued unique codes.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Carol Lucido",supporting_staff:"",objective:"Create a comprehensive backup of all relevant membership and program data before SmartRec go-live.",core_value:"Excellence",status:"Complete",updates:"Reports run and archived representing all memberships, programs, and financial history.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Carol Lucido",supporting_staff:"",objective:"Beginning on the date of the RT data download, maintain a running log of all data adjustments made during the SmartRec migration.",core_value:"Innovation",status:"Complete",updates:"We have been keeping track of all adjustments throughout the transition period.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Carol Lucido",supporting_staff:"",objective:"Establish a clear and enforceable Freeze and Cancellation policy for membership holds in SmartRec.",core_value:"Excellence",status:"Complete",updates:"A new policy was put in place and an email notification system created for members.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Chris Eckert",supporting_staff:"",objective:"Enhance member satisfaction by gathering qualitative feedback from at least 10 Fitness Center members through structured interviews.",core_value:"Excellence",status:"Not Complete",updates:"Ongoing - met with a couple of members to gather feedback. Will continue through Q2.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Chuck Burgess",supporting_staff:"Dani Hoefle",objective:"Review and revise the Bills Youth Football affiliate agreement to reflect current operations and standards.",core_value:"Excellence",status:"Not Complete",updates:"Paused as we wait for the BGRA agreement to be finalized first.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Chuck Burgess",supporting_staff:"",objective:"Develop a facility rental dashboard to track key performance metrics across all rental categories monthly.",core_value:"Innovation",status:"Complete",updates:"Chuck built two dashboards (2025-2026 and 2026-2027) tracking all rental categories on a monthly basis.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Debbie Fandrei",supporting_staff:"",objective:"Debbie will research park district–foundation agreements to identify best practices and a model for BGPD.",core_value:"Excellence",status:"Ongoing",updates:"Found a good example MOU with the Naperville Park Foundation. Continuing research.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Debbie Fandrei",supporting_staff:"",objective:"Debbie will develop a series of eight educational plant social media posts for the district's parks.",core_value:"Innovation",status:"Complete",updates:"Eleven Plant of the Week social media posts were created and published throughout the summer.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Diana Clayson",supporting_staff:"Greg Ney",objective:"Diana will work with Greg to create an Inclusion folder in the shared drive for all adaptive recreation materials.",core_value:"Innovation",status:"Complete",updates:"Folder created and discussed with the Recreation team. All adaptive materials are now centrally accessible.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Diana Clayson",supporting_staff:"",objective:"By July 31, 2025, implement a monthly check-in meeting schedule for Inclusion program staff.",core_value:"Character",status:"Complete",updates:"Meetings scheduled for August. A template was created for consistent check-in structure.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Jimmy Mix",supporting_staff:"Shannon McClure",objective:"Develop and implement a daily checklist for camp supervisors to ensure consistent facility readiness.",core_value:"Excellence",status:"Complete",updates:"Completed the daily checklist and shared it with camp leadership for implementation.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Jimmy Mix",supporting_staff:"Chris Eckert",objective:"Reorganize the golf dome garage to enhance accessibility and efficiency for seasonal equipment storage.",core_value:"Excellence",status:"Not Complete",updates:"Scheduled for August 22. Will complete before end of Q1.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Joe Zimmermann",supporting_staff:"",objective:"Oversee the successful district-wide transition to SmartRec registration and membership system.",core_value:"Innovation",status:"Complete",updates:"Successfully went live with SmartRec at the start of the fiscal year. All staff trained.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Joe Zimmermann",supporting_staff:"",objective:"Develop and facilitate a Fiscal Sustainability training for all recreation supervisors.",core_value:"Excellence",status:"Complete",updates:"Completed the first training session and sent a follow-up resource guide to all supervisors.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Marina Mayne",supporting_staff:"",objective:"Marina will complete the CPRP examination to achieve professional certification.",core_value:"Excellence",status:"Complete",updates:"Passed the CPRP exam on the first attempt.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Marina Mayne",supporting_staff:"",objective:"Marina will complete a partial inventory of the Museum collection to improve accessibility and tracking.",core_value:"Excellence",status:"Not Complete",updates:"Inventory is now 90% complete, with new inventory system being tested.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Mike Pfeiffer",supporting_staff:"",objective:"Mike will contact a skateboarding instructor to explore the possibility of structured skateboard programming.",core_value:"Community",status:"Not Complete",updates:"Ongoing — reached out to Asylum Skate Park, waiting on response.",is_archived:false},
  {fy:"2025-2026",quarter:"Q1 (May–Aug)",staff_lead:"Shannon McClure",supporting_staff:"",objective:"Partner with local law enforcement to co-develop and deliver a safety training for all camp staff.",core_value:"Excellence",status:"Complete",updates:"Officer Chad conducted a comprehensive training session for all camp staff before summer began.",is_archived:false},
  {fy:"2025-2026",quarter:"Q2 (Sep–Dec)",staff_lead:"Aly Stanczak",supporting_staff:"",objective:"Aly will open Nutcracker staff roles—like choreographers and rehearsal directors—to new candidates via audition process.",core_value:"Character",status:"Complete",updates:"Three new staff brought on as choreographers through the audition process.",is_archived:false},
  {fy:"2025-2026",quarter:"Q2 (Sep–Dec)",staff_lead:"Joe Zimmermann",supporting_staff:"",objective:"Finalize and implement a formal agreement with the BGRA outlining mutual responsibilities and expectations.",core_value:"Excellence",status:"Ongoing",updates:"A draft has been created and will be presented to the BGRA board in Q3.",is_archived:false},
  {fy:"2025-2026",quarter:"Q2 (Sep–Dec)",staff_lead:"Joe Zimmermann",supporting_staff:"",objective:"Develop a standardized monthly report using SmartRec data for all recreation program areas.",core_value:"Stewardship",status:"Ongoing",updates:"Still working with superintendents to define the reporting format and key metrics.",is_archived:false},
  {fy:"2025-2026",quarter:"Q2 (Sep–Dec)",staff_lead:"Joe Zimmermann",supporting_staff:"",objective:"Lead the full classification of all recreation services into the Fiscal Sustainability framework by December 2025.",core_value:"Stewardship",status:"Ongoing",updates:"First FS exercise completed in October. Working toward full classification by end of Q2.",is_archived:false},
  {fy:"2025-2026",quarter:"Q2 (Sep–Dec)",staff_lead:"Carol Lucido",supporting_staff:"",objective:"Create a partnership with The Clove to offer a special membership discount for Fitness Center members.",core_value:"Stewardship",status:"Not Complete",updates:"Pushing to Q3 due to SmartRec transition demands.",is_archived:false},
  {fy:"2025-2026",quarter:"Q2 (Sep–Dec)",staff_lead:"Chris Eckert",supporting_staff:"",objective:"Onboard the new Group Exercise Manager with a structured 90-day onboarding and training plan.",core_value:"Character",status:"Not Complete",updates:"Allison started August 4. Continuing onboarding process through Q2.",is_archived:false},
  {fy:"2025-2026",quarter:"Q2 (Sep–Dec)",staff_lead:"Chuck Burgess",supporting_staff:"",objective:"Complete an audit of all current field and court rental contracts to identify gaps and pricing inconsistencies.",core_value:"Stewardship",status:"Ongoing",updates:"Audit underway. Several contracts identified for renegotiation.",is_archived:false},
  {fy:"2025-2026",quarter:"Q2 (Sep–Dec)",staff_lead:"Diana Clayson",supporting_staff:"",objective:"Develop a resource guide for staff working with participants with disabilities across all program areas.",core_value:"Community",status:"Ongoing",updates:"Draft resource guide created. Gathering feedback from program staff.",is_archived:false},
  {fy:"2025-2026",quarter:"Q3 (Jan–Mar)",staff_lead:"Joe Zimmermann",supporting_staff:"",objective:"Present the fiscal year department budget recommendation to the Board of Commissioners.",core_value:"Stewardship",status:"Not Started",updates:"",is_archived:false},
  {fy:"2025-2026",quarter:"Q3 (Jan–Mar)",staff_lead:"Carol Lucido",supporting_staff:"",objective:"Launch the redesigned fitness membership tiers in SmartRec with updated pricing and benefits.",core_value:"Excellence",status:"Not Started",updates:"",is_archived:false},
  {fy:"2025-2026",quarter:"Q3 (Jan–Mar)",staff_lead:"Shannon McClure",supporting_staff:"Amanda Busch",objective:"Complete spring camp registration planning and ensure all camp programs are fully staffed by April 1.",core_value:"Excellence",status:"Not Started",updates:"",is_archived:false},
];

const SEED_RENTALS = [
  // 2024-2025
  {fy:"2024-2025",category:"Alcott Center",month:"May",amount:5819,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"June",amount:1635,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"July",amount:2015,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"August",amount:1380,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"September",amount:2777,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"October",amount:3717,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"November",amount:2544,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"December",amount:2293,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"January",amount:3180,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"February",amount:4080,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"March",amount:4641,is_archived:false},
  {fy:"2024-2025",category:"Alcott Center",month:"April",amount:5071,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"May",amount:15293,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"June",amount:12639,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"July",amount:5704,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"August",amount:10054,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"September",amount:25828,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"October",amount:5170,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"November",amount:16757,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"December",amount:9743,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"January",amount:7841,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"February",amount:18459,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"March",amount:13850,is_archived:false},
  {fy:"2024-2025",category:"CAC",month:"April",amount:9707,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"May",amount:5384,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"June",amount:5494,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"July",amount:2718,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"August",amount:5802,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"September",amount:4496,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"October",amount:4885,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"November",amount:6963,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"December",amount:4124,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"January",amount:4348,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"February",amount:5300,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"March",amount:3119,is_archived:false},
  {fy:"2024-2025",category:"Birthdays",month:"April",amount:6053,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"May",amount:6280,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"June",amount:1425,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"July",amount:5210,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"August",amount:2280,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"September",amount:3150,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"October",amount:50,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"February",amount:1020,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"March",amount:22720,is_archived:false},
  {fy:"2024-2025",category:"Outdoor/FCS",month:"April",amount:3455,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"May",amount:261,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"June",amount:388,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"July",amount:488,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"August",amount:488,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"September",amount:537,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"October",amount:657,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"November",amount:594,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"December",amount:624,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"January",amount:640,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"February",amount:599,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"March",amount:753,is_archived:false},
  {fy:"2024-2025",category:"Dog Park",month:"April",amount:925,is_archived:false},
  {fy:"2024-2025",category:"Willow Stream Pool",month:"May",amount:200,is_archived:false},
  {fy:"2024-2025",category:"Willow Stream Pool",month:"June",amount:1035,is_archived:false},
  {fy:"2024-2025",category:"Willow Stream Pool",month:"July",amount:400,is_archived:false},
  // 2025-2026
  {fy:"2025-2026",category:"Alcott Center",month:"May",amount:3238,is_archived:false},
  {fy:"2025-2026",category:"Alcott Center",month:"June",amount:400,is_archived:false},
  {fy:"2025-2026",category:"Alcott Center",month:"July",amount:2978,is_archived:false},
  {fy:"2025-2026",category:"Alcott Center",month:"August",amount:2870,is_archived:false},
  {fy:"2025-2026",category:"Alcott Center",month:"September",amount:1763,is_archived:false},
  {fy:"2025-2026",category:"Alcott Center",month:"October",amount:4256,is_archived:false},
  {fy:"2025-2026",category:"Alcott Center",month:"November",amount:4664,is_archived:false},
  {fy:"2025-2026",category:"Alcott Center",month:"December",amount:1638,is_archived:false},
  {fy:"2025-2026",category:"Alcott Center",month:"January",amount:5626,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"May",amount:14631,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"June",amount:6561,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"July",amount:9664,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"August",amount:7315,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"September",amount:6933,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"October",amount:7823,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"November",amount:14358,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"December",amount:12322,is_archived:false},
  {fy:"2025-2026",category:"CAC",month:"January",amount:10234,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"May",amount:4170,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"June",amount:3190,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"July",amount:2718,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"August",amount:5052,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"September",amount:2295,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"October",amount:3949,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"November",amount:4071,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"December",amount:5197,is_archived:false},
  {fy:"2025-2026",category:"Birthdays",month:"January",amount:5498,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"May",amount:1480,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"June",amount:599,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"July",amount:2285,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"August",amount:1338,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"September",amount:1545,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"October",amount:780,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"November",amount:940,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"December",amount:850,is_archived:false},
  {fy:"2025-2026",category:"Outdoor/FCS",month:"January",amount:995,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"May",amount:315,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"June",amount:75,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"July",amount:760,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"August",amount:494,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"September",amount:554,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"October",amount:586,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"November",amount:596,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"December",amount:597,is_archived:false},
  {fy:"2025-2026",category:"Dog Park",month:"January",amount:238,is_archived:false},
  {fy:"2025-2026",category:"Spray N Play",month:"May",amount:3668,is_archived:false},
  {fy:"2025-2026",category:"Spray N Play",month:"June",amount:2546,is_archived:false},
  {fy:"2025-2026",category:"Spray N Play",month:"July",amount:8403,is_archived:false},
  {fy:"2025-2026",category:"Spray N Play",month:"August",amount:7188,is_archived:false},
  {fy:"2025-2026",category:"Willow Stream Pool",month:"July",amount:935,is_archived:false},
  {fy:"2025-2026",category:"Willow Stream Pool",month:"August",amount:1150,is_archived:false},
];

const SEED_FUNDS = [
  // Fund 4 Recreation — full actual data from spreadsheet
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"May",revenue:237576,expenses:167547,goal:200000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"June",revenue:1256921,expenses:187267,goal:1100000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"July",revenue:990937,expenses:195467,goal:900000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"August",revenue:332899,expenses:259792,goal:300000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"September",revenue:793427,expenses:199562,goal:700000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"October",revenue:381879,expenses:183537,goal:350000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"November",revenue:359311,expenses:177339,goal:330000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"December",revenue:368073,expenses:186387,goal:340000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"January",revenue:429191,expenses:258541,goal:400000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"February",revenue:319745,expenses:195022,goal:300000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"March",revenue:463157,expenses:210000,goal:430000},
  {fund_name:"Fund 4 – Recreation",fy:"2022-2023",month:"April",revenue:438576,expenses:220000,goal:400000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"May",revenue:266127,expenses:180476,goal:240000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"June",revenue:1496810,expenses:230598,goal:1350000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"July",revenue:1058615,expenses:317929,goal:980000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"August",revenue:339328,expenses:181172,goal:310000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"September",revenue:855746,expenses:197168,goal:800000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"October",revenue:423240,expenses:190943,goal:390000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"November",revenue:505936,expenses:177779,goal:470000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"December",revenue:455301,expenses:189418,goal:420000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"January",revenue:293481,expenses:258084,goal:270000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"February",revenue:400851,expenses:211380,goal:370000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"March",revenue:572257,expenses:230000,goal:530000},
  {fund_name:"Fund 4 – Recreation",fy:"2023-2024",month:"April",revenue:359000,expenses:210000,goal:330000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"May",revenue:309130,expenses:394890,goal:280000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"June",revenue:1649705,expenses:662758,goal:1550000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"July",revenue:1267791,expenses:1312805,goal:1100000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"August",revenue:499625,expenses:644635,goal:350000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"September",revenue:1010077,expenses:507796,goal:860000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"October",revenue:368228,expenses:520674,goal:400000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"November",revenue:337919,expenses:430820,goal:360000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"December",revenue:271777,expenses:312400,goal:310000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"January",revenue:331901,expenses:380100,goal:350000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"February",revenue:445183,expenses:398200,goal:400000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"March",revenue:592346,expenses:524100,goal:550000},
  {fund_name:"Fund 4 – Recreation",fy:"2024-2025",month:"April",revenue:960768,expenses:820300,goal:900000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"May",revenue:376796,expenses:352100,goal:350000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"June",revenue:906101,expenses:718400,goal:950000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"July",revenue:1886507,expenses:798200,goal:1400000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"August",revenue:262596,expenses:622300,goal:520000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"September",revenue:863761,expenses:614800,goal:1060000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"October",revenue:511072,expenses:592100,goal:400000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"November",revenue:361152,expenses:498400,goal:360000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"December",revenue:381880,expenses:412000,goal:310000},
  {fund_name:"Fund 4 – Recreation",fy:"2025-2026",month:"January",revenue:574044,expenses:480000,goal:350000},
  // Fitness Center — full actuals
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"May",revenue:166045,expenses:120000,goal:128675},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"June",revenue:155482,expenses:110000,goal:143675},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"July",revenue:155173,expenses:108000,goal:128675},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"August",revenue:176045,expenses:122000,goal:128675},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"September",revenue:152517,expenses:106000,goal:158775},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"October",revenue:145587,expenses:103000,goal:138775},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"November",revenue:221890,expenses:150000,goal:194275},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"December",revenue:189750,expenses:132000,goal:168775},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"January",revenue:197030,expenses:137000,goal:169179},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"February",revenue:182000,expenses:127000,goal:165000},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"March",revenue:195000,expenses:136000,goal:175000},
  {fund_name:"Fitness Center (FCBG)",fy:"2022-2023",month:"April",revenue:148186,expenses:103000,goal:130000},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"May",revenue:237870,expenses:164000,goal:177226},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"June",revenue:194710,expenses:136000,goal:169562},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"July",revenue:226756,expenses:158000,goal:153627},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"August",revenue:208336,expenses:146000,goal:156656},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"September",revenue:194294,expenses:136000,goal:161634},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"October",revenue:188850,expenses:133000,goal:166292},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"November",revenue:261994,expenses:183000,goal:245457},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"December",revenue:239722,expenses:168000,goal:204820},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"January",revenue:219448,expenses:154000,goal:200144},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"February",revenue:225000,expenses:158000,goal:205000},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"March",revenue:241000,expenses:169000,goal:218000},
  {fund_name:"Fitness Center (FCBG)",fy:"2023-2024",month:"April",revenue:202718,expenses:142000,goal:183000},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"May",revenue:275071,expenses:195000,goal:231757},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"June",revenue:235495,expenses:178000,goal:221734},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"July",revenue:231537,expenses:172000,goal:200896},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"August",revenue:254942,expenses:188000,goal:204858},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"September",revenue:230880,expenses:175000,goal:207815},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"October",revenue:219457,expenses:168000,goal:213803},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"November",revenue:311867,expenses:225000,goal:276138},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"December",revenue:263664,expenses:195000,goal:243224},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"January",revenue:276432,expenses:200000,goal:237671},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"February",revenue:253513,expenses:185000,goal:237852},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"March",revenue:238930,expenses:176000,goal:223991},
  {fund_name:"Fitness Center (FCBG)",fy:"2024-2025",month:"April",revenue:260830,expenses:186000,goal:240000},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"May",revenue:311570,expenses:218000,goal:316331},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"June",revenue:266827,expenses:192000,goal:270819},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"July",revenue:256526,expenses:186000,goal:266267},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"August",revenue:272138,expenses:196000,goal:293183},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"September",revenue:257846,expenses:188000,goal:265512},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"October",revenue:243886,expenses:178000,goal:252375},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"November",revenue:340422,expenses:241000,goal:358647},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"December",revenue:316697,expenses:228000,goal:303213},
  {fund_name:"Fitness Center (FCBG)",fy:"2025-2026",month:"January",revenue:320561,expenses:231000,goal:317897},
];

const SEED_CAMPS = [
  {fy:"2021-2022",camp_name:"Adventure",enrollment:0,revenue:0,expenses:0,notes:"COVID recovery year"},
  {fy:"2021-2022",camp_name:"Fun & Games",enrollment:571,revenue:0,expenses:0,notes:""},
  {fy:"2021-2022",camp_name:"Kinder Camp",enrollment:90,revenue:0,expenses:0,notes:""},
  {fy:"2021-2022",camp_name:"CIT",enrollment:16,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Preschool 3s",enrollment:45,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Preschool 4s & 5s",enrollment:95,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Kinder Camp",enrollment:94,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Safety Stars",enrollment:18,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Adventure",enrollment:296,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Fun & Games",enrollment:192,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Grove",enrollment:192,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Sports Camp",enrollment:254,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Cycle & Surf",enrollment:94,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Star Makers",enrollment:62,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Broadway Bound",enrollment:160,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Dance",enrollment:172,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"CIT",enrollment:41,revenue:0,expenses:0,notes:""},
  {fy:"2022-2023",camp_name:"Camp Connection",enrollment:1861,revenue:0,expenses:0,notes:"Day-use"},
  {fy:"2022-2023",camp_name:"Post Camp",enrollment:243,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Preschool 3s",enrollment:48,revenue:28892,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Preschool 4s & 5s",enrollment:97,revenue:55948,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Kinder Camp",enrollment:117,revenue:66892,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Safety Stars",enrollment:24,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Adventure",enrollment:514,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Fun & Games",enrollment:187,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Grove",enrollment:205,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Sports Camp",enrollment:242,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Cycle & Surf",enrollment:96,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Xtreme Teens",enrollment:0,revenue:0,expenses:0,notes:"Did not run"},
  {fy:"2023-2024",camp_name:"Star Makers",enrollment:91,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Broadway Bound",enrollment:196,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Dance",enrollment:186,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"CIT",enrollment:43,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",camp_name:"Camp Connection",enrollment:2469,revenue:0,expenses:0,notes:"Day-use"},
  {fy:"2023-2024",camp_name:"Post Camp",enrollment:253,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Preschool 2s",enrollment:19,revenue:7225,expenses:2500,notes:"New program"},
  {fy:"2024-2025",camp_name:"Preschool 3s",enrollment:43,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Preschool 4s & 5s",enrollment:52,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Kinder Camp",enrollment:88,revenue:65105,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Safety Stars",enrollment:21,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Adventure",enrollment:531,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Fun & Games",enrollment:202,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Grove",enrollment:209,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Sports Camp",enrollment:204,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Cycle & Surf",enrollment:96,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Xtreme Teens",enrollment:139,revenue:0,expenses:0,notes:"Returned after hiatus"},
  {fy:"2024-2025",camp_name:"Star Makers",enrollment:91,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Broadway Bound",enrollment:181,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Dance",enrollment:192,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"CIT",enrollment:22,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",camp_name:"Camp Connection",enrollment:2298,revenue:0,expenses:0,notes:"Day-use"},
  {fy:"2024-2025",camp_name:"Post Camp",enrollment:446,revenue:0,expenses:0,notes:""},
];

const SEED_CLUBHOUSE = [
  {fy:"2022-2023",site:"Country Meadows",enrollment:24,revenue:41863,is_archived:false},
  {fy:"2022-2023",site:"Ivy Hall",enrollment:68,revenue:127992,is_archived:false},
  {fy:"2022-2023",site:"Kildeer",enrollment:56,revenue:86786,is_archived:false},
  {fy:"2022-2023",site:"Kilmer",enrollment:19,revenue:41753,is_archived:false},
  {fy:"2022-2023",site:"Longfellow",enrollment:99,revenue:208469,is_archived:false},
  {fy:"2022-2023",site:"Meridian",enrollment:45,revenue:86434,is_archived:false},
  {fy:"2022-2023",site:"Prairie",enrollment:75,revenue:130880,is_archived:false},
  {fy:"2022-2023",site:"Pritchett",enrollment:59,revenue:0,is_archived:false},
  {fy:"2022-2023",site:"Tripp",enrollment:81,revenue:0,is_archived:false},
  {fy:"2022-2023",site:"Willow Grove",enrollment:51,revenue:0,is_archived:false},
  {fy:"2023-2024",site:"Country Meadows",enrollment:39,revenue:96538,is_archived:false},
  {fy:"2023-2024",site:"Ivy Hall",enrollment:81,revenue:205214,is_archived:false},
  {fy:"2023-2024",site:"Kildeer",enrollment:66,revenue:148566,is_archived:false},
  {fy:"2023-2024",site:"Kilmer",enrollment:19,revenue:44122,is_archived:false},
  {fy:"2023-2024",site:"Longfellow",enrollment:116,revenue:295076,is_archived:false},
  {fy:"2023-2024",site:"Meridian",enrollment:46,revenue:89351,is_archived:false},
  {fy:"2023-2024",site:"Prairie",enrollment:72,revenue:169340,is_archived:false},
  {fy:"2023-2024",site:"Pritchett",enrollment:58,revenue:0,is_archived:false},
  {fy:"2023-2024",site:"Tripp",enrollment:71,revenue:0,is_archived:false},
  {fy:"2023-2024",site:"Willow Grove",enrollment:47,revenue:0,is_archived:false},
  {fy:"2024-2025",site:"Country Meadows",enrollment:50.5,revenue:114970,is_archived:false},
  {fy:"2024-2025",site:"Ivy Hall",enrollment:92.6,revenue:233765,is_archived:false},
  {fy:"2024-2025",site:"Kildeer",enrollment:71.8,revenue:172083,is_archived:false},
  {fy:"2024-2025",site:"Kilmer",enrollment:32.2,revenue:74263,is_archived:false},
  {fy:"2024-2025",site:"Longfellow",enrollment:121.2,revenue:348483,is_archived:false},
  {fy:"2024-2025",site:"Meridian",enrollment:61.3,revenue:103644,is_archived:false},
  {fy:"2024-2025",site:"Prairie",enrollment:82,revenue:171253,is_archived:false},
  {fy:"2024-2025",site:"Pritchett",enrollment:63.2,revenue:0,is_archived:false},
  {fy:"2024-2025",site:"Tripp",enrollment:79.3,revenue:0,is_archived:false},
  {fy:"2024-2025",site:"Willow Grove",enrollment:52.4,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Country Meadows",enrollment:43,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Ivy Hall",enrollment:90,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Kildeer",enrollment:63,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Kilmer",enrollment:35,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Longfellow",enrollment:125,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Meridian",enrollment:47,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Prairie",enrollment:65,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Pritchett",enrollment:39,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Tripp",enrollment:67,revenue:0,is_archived:false},
  {fy:"2025-2026",site:"Willow Grove",enrollment:48,revenue:0,is_archived:false},
];

const SEED_EVENTS = [
  {fy:"2022-2023",event_name:"Summer Concert Series",event_type:"Summer Concert",attendance:6281,revenue:0,expenses:0,notes:"8 concerts total"},
  {fy:"2022-2023",event_name:"Movies Under the Stars",event_type:"Movie Under the Stars",attendance:1648,revenue:0,expenses:0,notes:"3 movies"},
  {fy:"2022-2023",event_name:"Bow Wow",event_type:"Community Festival",attendance:245,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Summer Concert — Pino Farina Band",event_type:"Summer Concert",attendance:330,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Summer Concert — Members Only",event_type:"Summer Concert",attendance:967,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Summer Concert — Triadd",event_type:"Summer Concert",attendance:240,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Summer Concert — Yankee Cowboy",event_type:"Summer Concert",attendance:409,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Summer Concert — Classical Beat",event_type:"Summer Concert",attendance:608,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Summer Concert — Industrial Drive",event_type:"Summer Concert",attendance:736,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Summer Concert — Serendipity",event_type:"Summer Concert",attendance:2200,revenue:0,expenses:0,notes:"Highest attended"},
  {fy:"2023-2024",event_name:"Movie Under the Stars — Sonic the Hedgehog",event_type:"Movie Under the Stars",attendance:623,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Movie Under the Stars — DC Leagues of Super-Pets",event_type:"Movie Under the Stars",attendance:113,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Movie Under the Stars — Puss in Boots",event_type:"Movie Under the Stars",attendance:387,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Kite Fly",event_type:"Community Festival",attendance:556,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Bow Wow",event_type:"Community Festival",attendance:290,revenue:0,expenses:0,notes:""},
  {fy:"2023-2024",event_name:"Trick or Treat Trail",event_type:"Holiday Event",attendance:500,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",event_name:"Summer Concert 1",event_type:"Summer Concert",attendance:400,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",event_name:"Summer Concert 2",event_type:"Summer Concert",attendance:440,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",event_name:"Movie Under the Stars — Elemental",event_type:"Movie Under the Stars",attendance:208,revenue:0,expenses:0,notes:""},
  {fy:"2024-2025",event_name:"Kite Fly",event_type:"Community Festival",attendance:760,revenue:0,expenses:0,notes:"YoY growth from 556"},
  {fy:"2024-2025",event_name:"Bow Wow",event_type:"Community Festival",attendance:198,revenue:0,expenses:0,notes:"Declined from 290"},
  {fy:"2024-2025",event_name:"Parks and Public Lands",event_type:"Community Festival",attendance:733,revenue:0,expenses:0,notes:"New event"},
];

// ─── Shared admin utilities ───────────────────────────────────────────────────
function adm$(v,compact){
  const n=Number(v)||0;
  const abs=Math.abs(Math.round(n));
  const s=compact&&abs>=1000000?`$${(abs/1000000).toFixed(1)}M`:compact&&abs>=1000?`$${(abs/1000).toFixed(0)}K`:`$${abs.toLocaleString()}`;
  return n<0?`(${s})`:s;
}
function admPct(v){return `${((Number(v)||0)*100).toFixed(1)}%`;}
function fyLabel(fy){return fy?`FY ${fy}`:"All Years";}
function sumField(arr,key){return arr.reduce((a,r)=>a+(Number(r[key])||0),0);}
function yoyPct(cur,prev){if(!prev)return null;return ((cur-prev)/prev)*100;}
function arrowBadge(pct){
  if(pct===null)return null;
  const pos=pct>=0;
  return <span style={{color:pos?"#16a34a":"#dc2626",fontSize:"11px",fontWeight:700}}>{pos?"▲":"▼"}{Math.abs(pct).toFixed(1)}%</span>;
}

// ─── Admin UI primitives ─────────────────────────────────────────────────────
function AModal({title,onClose,children,wide,extraWide}){
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.5)"}}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{width:extraWide?"900px":wide?"680px":"480px",maxWidth:"95vw",maxHeight:"90vh"}}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800" style={{fontSize:"15px"}}>{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto p-6 flex-1">{children}</div>
      </div>
    </div>
  );
}

function AInp({label,value,onChange,type="text",options,hint,rows,required,half,className=""}){
  const base="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300";
  return(
    <div className={`mb-4 ${half?"":"w-full"} ${className}`}>
      {label&&<label className="block text-xs font-semibold text-slate-500 mb-1">{label}{required&&<span className="text-red-400 ml-1">*</span>}</label>}
      {options
        ?<select value={value} onChange={e=>onChange(e.target.value)} className={base}>
            <option value="">— Select —</option>
            {options.map(o=><option key={o} value={o}>{o}</option>)}
          </select>
        :rows
          ?<textarea value={value} onChange={e=>onChange(e.target.value)} rows={rows} className={base}/>
          :<input type={type} value={value} onChange={e=>onChange(e.target.value)} className={base}/>
      }
      {hint&&<p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function AConfirm({message,onConfirm,onCancel,label="Delete",color="#ef4444"}){
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.4)"}}>
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
        <p className="text-sm text-slate-700 mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{" Cancel"}</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm rounded-lg text-white font-semibold" style={{background:color}}>{label}</button>
        </div>
      </div>
    </div>
  );
}

function AKpi({label,value,sub,color,arrow}){
  return(
    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <div className="text-xs text-slate-500 font-semibold mb-1 uppercase tracking-wide">{label}</div>
      <div className="font-bold text-slate-800 flex items-baseline gap-2" style={{fontSize:"22px"}}>
        {value}
        {arrow}
      </div>
      {sub&&<div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function ABar({label,value,max,color="#1e3a5f",height=18,showPct,suffix=""}){
  const pct=max>0?Math.min((value/max)*100,100):0;
  return(
    <div className="w-full">
      {label&&<div className="flex justify-between text-xs text-slate-600 mb-1"><span>{label}</span><span className="font-semibold">{suffix||adm$(value,true)}{showPct&&max>0&&<span className="text-slate-400 ml-1">({pct.toFixed(0)}%)</span>}</span></div>}
      <div className="rounded-full overflow-hidden" style={{background:"#f1f5f9",height}}>
        <div className="h-full rounded-full transition-all" style={{width:`${pct}%`,background:color}}/>
      </div>
    </div>
  );
}

function ASection({title,sub,children,action}){
  return(
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-slate-800" style={{fontSize:"15px"}}>{title}</h3>
          {sub&&<p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function FYPicker({value,onChange,include2027=false}){
  const fys=ADMIN_FYS.filter(f=>include2027||f!=="2026-2027");
  return(
    <select value={value} onChange={e=>onChange(e.target.value)}
      className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
      {fys.map(f=><option key={f} value={f}>{f}</option>)}
    </select>
  );
}

function ABadge({status}){
  return(
    <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{background:STATUS_BG[status]||"#f1f5f9",color:STATUS_CLR[status]||"#64748b"}}>
      {status}
    </span>
  );
}

function EmptyState({msg,action,onAction}){
  return(
    <div className="text-center py-12 text-slate-400">
      <div className="text-3xl mb-2">📋</div>
      <div className="text-sm mb-4">{msg}</div>
      {onAction&&<button onClick={onAction} className="px-4 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>{action}</button>}
    </div>
  );
}

// ─── SEED HELPER ─────────────────────────────────────────────────────────────
// Track which tables have been seeded this session
const _seeded=new Set();
async function seedIfEmpty(db,table,data){
  if(_seeded.has(table)) return false;
  _seeded.add(table);
  try{
    const {count}=await db.from(table).select("*",{count:"exact",head:true});
    if((count||0)===0 && data.length>0){
      // Insert in batches of 50 to avoid payload limits
      for(let i=0;i<data.length;i+=50){
        await db.from(table).insert(data.slice(i,i+50));
      }
      return true;
    }
  }catch(e){console.warn("seed error",table,e);}
  return false;
}

// ─── YoY SPARKLINE ───────────────────────────────────────────────────────────
function Sparkline({values,color="#1e3a5f",height=32,labels}){
  if(!values||values.length<2) return null;
  const valid=values.filter(v=>v!=null&&!isNaN(v));
  if(valid.length<2) return null;
  const min=Math.min(...valid), max=Math.max(...valid);
  const range=max-min||1;
  const w=80, h=height;
  const pts=values.map((v,i)=>{
    const x=(i/(values.length-1))*w;
    const y=v!=null?h-((v-min)/range)*(h-4)-2:null;
    return {x,y};
  }).filter(p=>p.y!=null);
  const d=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
  return(
    <svg width={w} height={h} style={{overflow:"visible"}}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color}/>)}
    </svg>
  );
}

// ─── EXECUTIVE SUMMARY ───────────────────────────────────────────────────────
function ExecSummary({programs,db}){
  const [fy,setFy]=useState(ADMIN_CUR);
  const [funds,setFunds]=useState([]);
  const [goals,setGoals]=useState([]);
  const [rentals,setRentals]=useState([]);
  const [camps,setCamps]=useState([]);
  const [clubhouse,setClubhouse]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      await Promise.all([
        seedIfEmpty(db,"admin_funds",SEED_FUNDS),
        seedIfEmpty(db,"admin_goals",SEED_GOALS),
        seedIfEmpty(db,"admin_rentals",SEED_RENTALS),
        seedIfEmpty(db,"admin_camps",SEED_CAMPS),
        seedIfEmpty(db,"admin_clubhouse",SEED_CLUBHOUSE),
      ]);
      const [f,g,r,c,ch]=await Promise.all([
        db.from("admin_funds").select("*"),
        db.from("admin_goals").select("*"),
        db.from("admin_rentals").select("*"),
        db.from("admin_camps").select("*"),
        db.from("admin_clubhouse").select("*"),
      ]);
      setFunds(f.data||[]);
      setGoals(g.data||[]);
      setRentals(r.data||[]);
      setCamps(c.data||[]);
      setClubhouse(ch.data||[]);
      setLoading(false);
    }
    load();
  },[]);

  if(loading) return <div className="text-center py-20 text-slate-400">Loading Executive Summary…</div>;

  const prevFy=ADMIN_FYS[ADMIN_FYS.indexOf(fy)-1];

  // Programs KPIs
  const progFy=programs.filter(p=>!p.is_archived&&p.year&&fy.includes(p.year.split("-")[0]||p.year));
  const progPrev=prevFy?programs.filter(p=>!p.is_archived&&p.year&&prevFy.includes(p.year.split("-")[0]||p.year)):[];

  // Fund totals for selected FY
  const fyFunds=funds.filter(f=>f.fy===fy);
  const prevFunds=prevFy?funds.filter(f=>f.fy===prevFy):[];
  const totalRev=sumField(fyFunds,"revenue");
  const totalExp=sumField(fyFunds,"expenses");
  const totalRevPrev=sumField(prevFunds,"revenue");
  const totalExpPrev=sumField(prevFunds,"expenses");

  // Goals
  const fyGoals=goals.filter(g=>g.fy===fy&&!g.is_archived);
  const complete=fyGoals.filter(g=>g.status==="Complete").length;
  const total=fyGoals.length;

  // Rentals
  const fyRentals=rentals.filter(r=>r.fy===fy);
  const prevRentals=prevFy?rentals.filter(r=>r.fy===prevFy):[];
  const totalRental=sumField(fyRentals,"amount");
  const totalRentalPrev=sumField(prevRentals,"amount");

  // Camps
  const fyCamps=camps.filter(c=>c.fy===fy);
  const prevCamps=prevFy?camps.filter(c=>c.fy===prevFy):[];
  const campEnroll=sumField(fyCamps.filter(c=>c.camp_name!=="Camp Connection"),"enrollment");
  const campEnrollPrev=sumField(prevCamps.filter(c=>c.camp_name!=="Camp Connection"),"enrollment");

  // Clubhouse
  const fyClub=clubhouse.filter(c=>c.fy===fy);
  const prevClub=prevFy?clubhouse.filter(c=>c.fy===prevFy):[];
  const clubEnroll=sumField(fyClub,"enrollment");
  const clubEnrollPrev=sumField(prevClub,"enrollment");

  // Fund P&L by fund name for selected FY
  const fundNames=[...new Set(funds.map(f=>f.fund_name))];
  const fundSummary=fundNames.map(name=>{
    const rows=fyFunds.filter(f=>f.fund_name===name);
    const prev=prevFunds.filter(f=>f.fund_name===name);
    const rev=sumField(rows,"revenue");
    const exp=sumField(rows,"expenses");
    const goal=sumField(rows,"goal");
    const prevRev=sumField(prev,"revenue");
    return {name,rev,exp,pl:rev-exp,goal,prevRev,yoy:yoyPct(rev,prevRev)};
  }).filter(f=>f.rev>0||f.exp>0);

  // Goals by status
  const statusCounts=GOAL_STATUSES.map(s=>({status:s,count:fyGoals.filter(g=>g.status===s).length}));

  // YoY revenue trend (last 4 FYs)
  const trendFYs=ADMIN_FYS.slice(1,6);
  const f4Trend=trendFYs.map(f=>sumField(funds.filter(x=>x.fy===f&&x.fund_name==="Fund 4 – Recreation"),"revenue"));
  const fitTrend=trendFYs.map(f=>sumField(funds.filter(x=>x.fy===f&&x.fund_name==="Fitness Center (FCBG)"),"revenue"));

  return(
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-slate-800" style={{fontSize:"18px"}}>Executive Summary</h2>
          <p className="text-sm text-slate-500 mt-0.5">District-wide performance overview</p>
        </div>
        <FYPicker value={fy} onChange={setFy} include2027/>
      </div>

      {/* Top KPI row */}
      <div className="grid grid-cols-2 gap-3 mb-6" style={{gridTemplateColumns:"repeat(4,1fr)"}}>
        <AKpi label="Total Revenue" value={adm$(totalRev,true)} sub={prevFy?`${adm$(totalRevPrev,true)} prior year`:undefined} arrow={arrowBadge(yoyPct(totalRev,totalRevPrev))}/>
        <AKpi label="Total Expenses" value={adm$(totalExp,true)} sub={prevFy?`${adm$(totalExpPrev,true)} prior year`:undefined} arrow={arrowBadge(yoyPct(totalExp,totalExpPrev))}/>
        <AKpi label="Net P/(L)" value={adm$(totalRev-totalExp,true)} sub={(totalRev-totalExp)>=0?"Surplus":"Deficit"}/>
        <AKpi label="Goals Complete" value={total>0?`${complete}/${total}`:"—"} sub={total>0?`${((complete/total)*100).toFixed(0)}% completion rate`:undefined}/>
      </div>

      <div className="grid gap-6" style={{gridTemplateColumns:"2fr 1fr"}}>
        {/* Left column */}
        <div>
          {/* Fund P&L table */}
          <ASection title="Fund Performance" sub={`FY ${fy} — Revenue, Expenses & Net by fund`}>
            <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{background:"#f8fafc"}}>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Fund</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Revenue</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Expenses</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Net P/(L)</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">YoY</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase" style={{minWidth:100}}>vs Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {fundSummary.map((f,i)=>{
                    const vsGoal=f.goal>0?(f.rev/f.goal)*100:null;
                    return(
                      <tr key={f.name} className="border-t border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{background:FUND_COLORS[f.name]||"#94a3b8"}}/>
                            <span className="font-medium text-slate-700 text-xs">{f.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{adm$(f.rev,true)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{adm$(f.exp,true)}</td>
                        <td className="px-4 py-3 text-right font-semibold" style={{color:f.pl>=0?"#16a34a":"#dc2626"}}>{adm$(f.pl,true)}</td>
                        <td className="px-4 py-3 text-right">{f.yoy!=null?arrowBadge(f.yoy):<span className="text-slate-300 text-xs">—</span>}</td>
                        <td className="px-4 py-3">
                          {vsGoal!=null
                            ?<div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span style={{color:vsGoal>=100?"#16a34a":vsGoal>=80?"#b45309":"#dc2626"}}>{vsGoal.toFixed(0)}%</span>
                                </div>
                                <div className="h-1.5 rounded-full overflow-hidden" style={{background:"#f1f5f9"}}>
                                  <div className="h-full rounded-full" style={{width:`${Math.min(vsGoal,100)}%`,background:vsGoal>=100?"#16a34a":vsGoal>=80?"#f59e0b":"#dc2626"}}/>
                                </div>
                              </div>
                            :<span className="text-slate-300 text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200" style={{background:"#f8fafc"}}>
                    <td className="px-4 py-3 text-xs font-bold text-slate-700">TOTAL</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800">{adm$(totalRev,true)}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-700">{adm$(totalExp,true)}</td>
                    <td className="px-4 py-3 text-right font-bold" style={{color:(totalRev-totalExp)>=0?"#16a34a":"#dc2626"}}>{adm$(totalRev-totalExp,true)}</td>
                    <td className="px-4 py-3 text-right">{arrowBadge(yoyPct(totalRev,totalRevPrev))}</td>
                    <td className="px-4 py-3"/>
                  </tr>
                </tfoot>
              </table>
            </div>
          </ASection>

          {/* YoY Revenue Trend */}
          <ASection title="Revenue Trend" sub="Fund 4 & Fitness Center year-over-year (annual totals)">
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="flex gap-4 mb-4 text-xs">
                <span className="flex items-center gap-1"><span className="w-3 h-1 rounded inline-block" style={{background:"#1e3a5f"}}/>Fund 4</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1 rounded inline-block" style={{background:"#0369a1"}}/>Fitness</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <td className="py-2 font-semibold text-slate-500 pr-4">Fund</td>
                      {trendFYs.map(f=><td key={f} className="py-2 text-center font-semibold text-slate-500 px-2">{f.replace("20","'")}</td>)}
                      <td className="py-2 text-center font-semibold text-slate-500 px-2">Trend</td>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100">
                      <td className="py-3 font-semibold text-slate-700 pr-4 flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{background:"#1e3a5f"}}/>Fund 4</td>
                      {f4Trend.map((v,i)=>{
                        const prev=f4Trend[i-1];
                        const chg=prev&&prev>0?((v-prev)/prev)*100:null;
                        return(
                          <td key={i} className="py-3 text-center px-2">
                            <div className="font-bold text-slate-800">{v>0?adm$(v,true):"—"}</div>
                            {chg!=null&&<div style={{color:chg>=0?"#16a34a":"#dc2626",fontSize:"10px"}}>{chg>=0?"▲":"▼"}{Math.abs(chg).toFixed(1)}%</div>}
                          </td>
                        );
                      })}
                      <td className="py-3 px-2 text-center"><Sparkline values={f4Trend} color="#1e3a5f" height={28}/></td>
                    </tr>
                    <tr className="border-t border-slate-100">
                      <td className="py-3 font-semibold text-slate-700 pr-4 flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{background:"#0369a1"}}/>Fitness</td>
                      {fitTrend.map((v,i)=>{
                        const prev=fitTrend[i-1];
                        const chg=prev&&prev>0?((v-prev)/prev)*100:null;
                        return(
                          <td key={i} className="py-3 text-center px-2">
                            <div className="font-bold text-slate-800">{v>0?adm$(v,true):"—"}</div>
                            {chg!=null&&<div style={{color:chg>=0?"#16a34a":"#dc2626",fontSize:"10px"}}>{chg>=0?"▲":"▼"}{Math.abs(chg).toFixed(1)}%</div>}
                          </td>
                        );
                      })}
                      <td className="py-3 px-2 text-center"><Sparkline values={fitTrend} color="#0369a1" height={28}/></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </ASection>

          {/* Clubhouse YoY Trend */}
          <ASection title="Clubhouse — Year over Year" sub="Avg enrollment & revenue by site across fiscal years">
            <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm overflow-x-auto">
              <table className="w-full text-xs" style={{minWidth:620}}>
                <thead>
                  <tr style={{background:"#f8fafc"}}>
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase sticky left-0 bg-slate-50" style={{minWidth:140}}>Site</th>
                    {ADMIN_FYS.filter(f=>clubhouse.some(c=>c.fy===f)).map(f=>(
                      <th key={f} className="text-right px-3 py-2.5 font-semibold text-slate-500 uppercase" style={{minWidth:80}}>{f.replace("20","'")}</th>
                    ))}
                    <th className="px-3 py-2.5 font-semibold text-slate-500 uppercase" style={{minWidth:70}}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {CLUB_SITES.map(site=>{
                    const clFYs=ADMIN_FYS.filter(f=>clubhouse.some(c=>c.fy===f));
                    const vals=clFYs.map(f=>{const r=clubhouse.find(c=>c.fy===f&&c.site===site);return r?.enrollment||null;});
                    const revVals=clFYs.map(f=>{const r=clubhouse.find(c=>c.fy===f&&c.site===site);return r?.revenue||null;});
                    if(vals.every(v=>!v)) return null;
                    return(
                      <tr key={site} className="border-t border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2 font-semibold text-slate-700 sticky left-0 bg-white">{site}</td>
                        {vals.map((v,i)=>{
                          const prev=vals[i-1];
                          const pct=prev&&prev>0&&v?((v-prev)/prev)*100:null;
                          const rev=revVals[i];
                          return(
                            <td key={i} className="px-3 py-2 text-right">
                              <div className="font-bold text-slate-800">{v!=null?v.toFixed(0):"—"}</div>
                              {rev>0&&<div className="text-slate-400" style={{fontSize:"10px"}}>{adm$(rev,true)}</div>}
                              {pct!=null&&<div style={{color:pct>=0?"#16a34a":"#dc2626",fontSize:"10px"}}>{pct>=0?"▲":"▼"}{Math.abs(pct).toFixed(1)}%</div>}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center"><Sparkline values={vals.filter(v=>v!=null)} color="#0f766e" height={22}/></td>
                      </tr>
                    );
                  })}
                  {/* Totals row */}
                  {(()=>{
                    const clFYs=ADMIN_FYS.filter(f=>clubhouse.some(c=>c.fy===f));
                    return(
                      <tr className="border-t-2 border-slate-200" style={{background:"#f8fafc"}}>
                        <td className="px-4 py-2 font-bold text-slate-700 sticky left-0 bg-slate-50">TOTAL</td>
                        {clFYs.map(f=>{
                          const totEnroll=sumField(clubhouse.filter(c=>c.fy===f),"enrollment");
                          const totRev=sumField(clubhouse.filter(c=>c.fy===f),"revenue");
                          return(
                            <td key={f} className="px-3 py-2 text-right">
                              <div className="font-bold text-slate-800">{totEnroll>0?totEnroll.toFixed(0):"—"}</div>
                              {totRev>0&&<div className="text-slate-400" style={{fontSize:"10px"}}>{adm$(totRev,true)}</div>}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center">
                          <Sparkline values={clFYs.map(f=>sumField(clubhouse.filter(c=>c.fy===f),"enrollment")).filter(v=>v>0)} color="#0f766e" height={22}/>
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </ASection>

          {/* Program Areas Quick View */}
          <div className="grid gap-4" style={{gridTemplateColumns:"1fr 1fr"}}>
            <ASection title="Camps Enrollment" sub={`By camp — FY ${fy}`}>
              <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm space-y-2">
                {fyCamps.filter(c=>c.camp_name!=="Camp Connection").sort((a,b)=>b.enrollment-a.enrollment).slice(0,8).map(c=>{
                  const max=Math.max(...fyCamps.map(x=>x.enrollment||0),1);
                  return <ABar key={c.camp_name} label={c.camp_name} value={c.enrollment} max={max} color="#7c3aed" height={12} suffix={` ${c.enrollment}`}/>;
                })}
                {fyCamps.length===0&&<div className="text-xs text-slate-400 text-center py-4">No camp data for FY {fy}</div>}
              </div>
            </ASection>
            <ASection title="Clubhouse Sites" sub={`Avg enrollment — FY ${fy}`}>
              <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm space-y-2">
                {fyClub.sort((a,b)=>b.enrollment-a.enrollment).map(c=>{
                  const max=Math.max(...fyClub.map(x=>x.enrollment||0),1);
                  return(
                    <div key={c.site}>
                      <ABar label={c.site} value={c.enrollment} max={max} color="#0f766e" height={12} suffix={` ${c.enrollment}`}/>
                      {c.revenue>0&&<div className="text-right text-xs text-slate-400 -mt-0.5">{adm$(c.revenue,true)}</div>}
                    </div>
                  );
                })}
                {fyClub.length===0&&<div className="text-xs text-slate-400 text-center py-4">No clubhouse data for FY {fy}</div>}
              </div>
            </ASection>
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* Goals status */}
          <ASection title="Goals & Objectives" sub={`FY ${fy} completion`}>
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              {total>0
                ?<>
                  <div className="flex items-center justify-center mb-4">
                    <div className="relative" style={{width:80,height:80}}>
                      <svg width="80" height="80" style={{transform:"rotate(-90deg)"}}>
                        <circle cx="40" cy="40" r="32" fill="none" stroke="#f1f5f9" strokeWidth="10"/>
                        <circle cx="40" cy="40" r="32" fill="none" stroke="#16a34a" strokeWidth="10"
                          strokeDasharray={`${2*Math.PI*32*complete/total} ${2*Math.PI*32}`}
                          strokeLinecap="round"/>
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="font-bold text-slate-800" style={{fontSize:"18px"}}>{((complete/total)*100).toFixed(0)}%</div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {statusCounts.filter(s=>s.count>0).map(s=>(
                      <div key={s.status} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{background:STATUS_CLR[s.status]}}/>
                          <span className="text-slate-600">{s.status}</span>
                        </div>
                        <span className="font-bold text-slate-800">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </>
                :<div className="text-xs text-slate-400 text-center py-4">No goals for FY {fy}</div>}
            </div>
          </ASection>

          {/* Rentals summary */}
          <ASection title="Rentals Revenue" sub="By category — current FY">
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-center mb-3">
                <div className="font-bold text-slate-800" style={{fontSize:"20px"}}>{adm$(totalRental,true)}</div>
                <div className="text-xs text-slate-400 flex items-center justify-center gap-1">
                  YTD {prevFy&&<>{arrowBadge(yoyPct(totalRental,totalRentalPrev))}</>}
                </div>
              </div>
              <div className="space-y-2">
                {RENTAL_CATS.map(cat=>{
                  const amt=sumField(fyRentals.filter(r=>r.category===cat),"amount");
                  if(!amt) return null;
                  return <ABar key={cat} label={cat} value={amt} max={totalRental||1} color="#b45309" height={10} showPct/>;
                })}
              </div>
            </div>
          </ASection>

          {/* Program counts from programs table */}
          <ASection title="Programs Summary" sub="Active programs in system">
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              {[
                {label:"Total Active",value:programs.filter(p=>!p.is_archived).length},
                {label:"Healthy",value:programs.filter(p=>!p.is_archived).length>0?programs.filter(p=>{
                  const fill=p.act_capacity>0?p.act_enrollment/p.act_capacity:0;
                  const cost=(Number(p.act_personnel||0)+Number(p.act_commodities||0)+Number(p.act_contractuals||0));
                  const cr=cost>0?p.act_revenue/cost:0;
                  return fill>=0.7&&cr>=1;
                }).length:"—"},
                {label:"Needs Redesign",value:programs.filter(p=>!p.is_archived).length>0?programs.filter(p=>{
                  const fill=p.act_capacity>0?p.act_enrollment/p.act_capacity:0;
                  return fill<0.6;
                }).length:"—"},
              ].map(r=>(
                <div key={r.label} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                  <span className="text-xs text-slate-600">{r.label}</span>
                  <span className="font-bold text-slate-800">{r.value}</span>
                </div>
              ))}
            </div>
          </ASection>
        </div>
      </div>
    </div>
  );
}

// ─── FUND MONTH CHART (proper component so hooks are valid) ─────────────────
function FundMonthChart({rows,fname,fy,allFunds}){
  const [showYoY,setShowYoY]=useState(false);
  const prevFy=ADMIN_FYS[ADMIN_FYS.indexOf(fy)-1];
  const prevRows=prevFy?allFunds.filter(r=>r.fund_name===fname&&r.fy===prevFy):[];
  const allRevVals=[...rows.map(x=>x.revenue||0),...(showYoY?prevRows.map(x=>x.revenue||0):[])];
  const maxV=Math.max(...allRevVals,1);
  return(
    <div className="px-5 py-4 border-b border-slate-50">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Monthly Revenue vs Goal</div>
        {prevRows.length>0&&<button onClick={()=>setShowYoY(s=>!s)}
          className="text-xs px-2 py-1 rounded-lg border font-semibold transition"
          style={showYoY?{background:FUND_COLORS[fname]||"#1e3a5f",color:"white",borderColor:FUND_COLORS[fname]||"#1e3a5f"}:{borderColor:"#e2e8f0",color:"#64748b"}}>
          {showYoY?"Hide":"+"} Prior Year ({prevFy})
        </button>}
      </div>
      <div className="flex items-end gap-1" style={{height:64}}>
        {FY_MONTHS.map(mon=>{
          const r=rows.find(x=>x.month===mon);
          const prev=prevRows.find(x=>x.month===mon);
          const rev=r?.revenue||0;
          const goal=r?.goal||0;
          const prevRev=prev?.revenue||0;
          const barH=Math.round((rev/maxV)*52);
          const prevH=showYoY&&prevRev?Math.round((prevRev/maxV)*52):0;
          const goalH=goal?Math.round((goal/maxV)*52):0;
          return(
            <div key={mon} className="flex-1 relative flex flex-col justify-end" style={{height:60}}
              title={`${mon}: ${adm$(rev)}${showYoY&&prevRev?" | Prior: "+adm$(prevRev):""}${goal?" | Goal: "+adm$(goal):""}`}>
              {goal>0&&<div className="absolute w-full border-t-2 border-dashed border-amber-400 pointer-events-none" style={{bottom:goalH+4,opacity:0.8,zIndex:2}}/>}
              <div className="absolute bottom-4 w-full flex items-end gap-px px-px">
                {showYoY&&<div className="flex-1 rounded-t" style={{height:prevH||1,background:FUND_COLORS[fname]||"#1e3a5f",opacity:0.3}}/>}
                <div className={showYoY?"flex-1 rounded-t":"w-full rounded-t"} style={{height:barH||2,background:FUND_COLORS[fname]||"#1e3a5f",opacity:rev>0?1:0.12}}/>
              </div>
              <div className="absolute bottom-0 w-full text-center" style={{color:"#94a3b8",fontSize:"8px"}}>{mon.slice(0,1)}</div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-2 text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded inline-block" style={{background:FUND_COLORS[fname]||"#1e3a5f"}}/>Revenue</span>
        {showYoY&&<span className="flex items-center gap-1"><span className="w-2 h-2 rounded inline-block opacity-30" style={{background:FUND_COLORS[fname]||"#1e3a5f"}}/>Prior Year</span>}
        <span className="flex items-center gap-1"><span className="w-4 border-t-2 border-dashed border-amber-400 inline-block"/>Goal</span>
      </div>
    </div>
  );
}

// ─── CLUBHOUSE ENROLL CHART (proper component) ───────────────────────────────
function ClubEnrollChart({fyRows,allRows,fy,maxEnroll,onEdit,onAdd}){
  const [showYoY,setShowYoY]=useState(false);
  const prevFy=ADMIN_FYS[ADMIN_FYS.indexOf(fy)-1];
  const prevRows=prevFy?allRows.filter(r=>r.fy===prevFy):[];
  const allMax=Math.max(maxEnroll,...(showYoY?prevRows.map(r=>r.enrollment||0):[]),1);
  return(
    <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold text-sm text-slate-700">FY {fy} — Enrollment by Site</div>
        {prevRows.length>0&&<button onClick={()=>setShowYoY(s=>!s)}
          className="text-xs px-2 py-1 rounded-lg border font-semibold transition"
          style={showYoY?{background:"#0f766e",color:"white",borderColor:"#0f766e"}:{borderColor:"#e2e8f0",color:"#64748b"}}>
          {showYoY?"Hide":"+"} Prior Year ({prevFy})
        </button>}
      </div>
      <div className="space-y-2">
        {CLUB_SITES.map(site=>{
          const r=fyRows.find(x=>x.site===site);
          const prevR=prevRows.find(x=>x.site===site);
          const enroll=r?.enrollment||0;
          const prevEnroll=prevR?.enrollment||0;
          const pct=yoyPct(enroll,prevEnroll);
          return(
            <div key={site} className="flex items-center gap-3">
              <div className="text-xs text-slate-600 w-28 flex-shrink-0 truncate">{site}</div>
              <div className="flex-1 relative h-4" style={{background:"#f1f5f9",borderRadius:9999}}>
                {showYoY&&prevEnroll>0&&<div className="absolute inset-y-0 left-0 rounded-full" style={{width:`${(prevEnroll/allMax)*100}%`,background:"#0f766e",opacity:0.28}}/>}
                {enroll>0&&<div className="absolute inset-y-0 left-0 rounded-full" style={{width:`${(enroll/allMax)*100}%`,background:"#0f766e"}}/>}
              </div>
              <div className="text-xs font-bold text-slate-800 w-8 text-right">{enroll||"—"}</div>
              {showYoY&&pct!==null&&enroll>0&&<div className="w-12 text-right flex-shrink-0" style={{fontSize:"10px",color:pct>=0?"#16a34a":"#dc2626"}}>{pct>=0?"▲":"▼"}{Math.abs(pct).toFixed(0)}%</div>}
              {r?<button onClick={()=>onEdit(r)} className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-400 text-xs flex-shrink-0">✏</button>
                :<button onClick={()=>onAdd(site)} className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 hover:bg-slate-200 flex-shrink-0">+</button>}
            </div>
          );
        })}
      </div>
      {showYoY&&<div className="flex gap-4 mt-3 text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded inline-block" style={{background:"#0f766e"}}/>Current FY</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded inline-block opacity-30" style={{background:"#0f766e"}}/>Prior FY ({prevFy})</span>
      </div>}
    </div>
  );
}

// ─── FUND PERFORMANCE ────────────────────────────────────────────────────────
function FundSection({db}){
  const [funds,setFunds]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState(ADMIN_CUR);
  const [activeFund,setActiveFund]=useState("all");
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [form,setForm]=useState({fund_name:"",fy:ADMIN_CUR,month:"",revenue:"",expenses:"",goal:"",notes:""});

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_funds",SEED_FUNDS);
    const {data}=await db.from("admin_funds").select("*").order("fund_name").order("month",{foreignTable:undefined});
    setFunds(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fund_name:form.fund_name,fy:form.fy,month:form.month,
      revenue:parseFloat(form.revenue)||0,expenses:parseFloat(form.expenses)||0,
      goal:parseFloat(form.goal)||0,notes:form.notes};
    if(editRow){await db.from("admin_funds").update(d).eq("id",editRow.id);}
    else{await db.from("admin_funds").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_funds").delete().eq("id",id);setConfirm(null);load();}

  function openEdit(r){setEditRow(r);setForm({fund_name:r.fund_name,fy:r.fy,month:r.month||"",revenue:r.revenue||"",expenses:r.expenses||"",goal:r.goal||"",notes:r.notes||""});setShowModal(true);}
  function openAdd(){setEditRow(null);setForm({fund_name:activeFund==="all"?"":activeFund,fy,month:"",revenue:"",expenses:"",goal:"",notes:""});setShowModal(true);}
  const f=v=>form[v];
  const s=(k,v)=>setForm(p=>({...p,[k]:v}));

  if(loading) return <div className="text-center py-20 text-slate-400">Loading…</div>;

  const fyFunds=funds.filter(r=>r.fy===fy);
  const fundNames=[...new Set(funds.map(f=>f.fund_name))].sort();
  const displayFunds=activeFund==="all"?fundNames:[activeFund];

  // All FYs trend table
  const allFYs=ADMIN_FYS.filter(f=>funds.some(r=>r.fy===f));

  return(
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-slate-800" style={{fontSize:"18px"}}>Fund Performance</h2>
          <p className="text-sm text-slate-500 mt-0.5">Revenue, expenses & goals by fund and fiscal year</p>
        </div>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy} include2027/>
          <button onClick={openAdd} className="px-4 py-2 text-sm font-bold rounded-lg text-white flex items-center gap-1" style={{background:"#1e3a5f"}}>+ Add Entry</button>
        </div>
      </div>

      {/* Fund selector tabs */}
      <div className="flex gap-1 mb-6 flex-wrap">
        {["all",...fundNames].map(fn=>(
          <button key={fn} onClick={()=>setActiveFund(fn)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg transition"
            style={activeFund===fn?{background:fn==="all"?"#1e3a5f":FUND_COLORS[fn]||"#1e3a5f",color:"white"}:{background:"#f1f5f9",color:"#64748b"}}>
            {fn==="all"?"All Funds":fn}
          </button>
        ))}
      </div>

      {/* YoY Summary Table (when All selected) */}
      {activeFund==="all"&&(
        <div className="mb-8">
          <h3 className="font-semibold text-slate-700 text-sm mb-3">Year-over-Year Summary</h3>
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-sm" style={{minWidth:700}}>
              <thead>
                <tr style={{background:"#f8fafc"}}>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase sticky left-0 bg-slate-50" style={{minWidth:180}}>Fund</th>
                  {allFYs.map(f=><th key={f} className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase" style={{minWidth:100}}>{f.replace("20","'")}</th>)}
                  <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase" style={{minWidth:80}}>Trend</th>
                </tr>
              </thead>
              <tbody>
                {fundNames.map(fname=>{
                  const revByFY=allFYs.map(f=>sumField(funds.filter(r=>r.fy===f&&r.fund_name===fname),"revenue"));
                  if(revByFY.every(v=>v===0)) return null;
                  return(
                    <tr key={fname} className="border-t border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-3 sticky left-0 bg-white">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{background:FUND_COLORS[fname]||"#94a3b8"}}/>
                          <span className="text-xs font-semibold text-slate-700">{fname}</span>
                        </div>
                      </td>
                      {revByFY.map((v,i)=>{
                        const prev=revByFY[i-1];
                        const pct=prev&&prev>0?((v-prev)/prev)*100:null;
                        return(
                          <td key={i} className="px-3 py-3 text-right">
                            <div className="font-bold text-slate-800 text-xs">{v>0?adm$(v,true):"—"}</div>
                            {pct!=null&&<div style={{color:pct>=0?"#16a34a":"#dc2626",fontSize:"10px"}}>{pct>=0?"▲":"▼"}{Math.abs(pct).toFixed(1)}%</div>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-center"><Sparkline values={revByFY.filter(v=>v>0)} color={FUND_COLORS[fname]||"#94a3b8"} height={24}/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Individual fund detail */}
      {displayFunds.map(fname=>{
        const rows=fyFunds.filter(r=>r.fund_name===fname);
        const totalRev=sumField(rows,"revenue");
        const totalExp=sumField(rows,"expenses");
        const totalGoal=sumField(rows,"goal");
        const allFYRows=ADMIN_FYS.map(f=>({fy:f,rev:sumField(funds.filter(r=>r.fy===f&&r.fund_name===fname),"revenue"),exp:sumField(funds.filter(r=>r.fy===f&&r.fund_name===fname),"expenses")}));
        const prevFyRev=sumField(funds.filter(r=>r.fy===ADMIN_FYS[ADMIN_FYS.indexOf(fy)-1]&&r.fund_name===fname),"revenue");

        return(
          <div key={fname} className="mb-8 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            {/* Fund header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100" style={{background:"#f8fafc"}}>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{background:FUND_COLORS[fname]||"#94a3b8"}}/>
                <div>
                  <div className="font-bold text-slate-800">{fname}</div>
                  <div className="text-xs text-slate-500">FY {fy}</div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-xs text-slate-500">Revenue</div>
                  <div className="font-bold text-slate-800">{adm$(totalRev)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Expenses</div>
                  <div className="font-bold text-slate-700">{adm$(totalExp)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Net P/(L)</div>
                  <div className="font-bold" style={{color:(totalRev-totalExp)>=0?"#16a34a":"#dc2626"}}>{adm$(totalRev-totalExp)}</div>
                </div>
                {prevFyRev>0&&<div className="text-right">
                  <div className="text-xs text-slate-500">YoY</div>
                  <div>{arrowBadge(yoyPct(totalRev,prevFyRev))}</div>
                </div>}
              </div>
            </div>

            {/* Monthly chart with YoY */}
            {rows.length>0&&<FundMonthChart rows={rows} fname={fname} fy={fy} allFunds={funds}/>}

            {/* Monthly data table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{background:"#f8fafc"}}>
                    <th className="text-left px-4 py-2 text-slate-500 font-semibold">Month</th>
                    <th className="text-right px-4 py-2 text-slate-500 font-semibold">Revenue</th>
                    <th className="text-right px-4 py-2 text-slate-500 font-semibold">Expenses</th>
                    <th className="text-right px-4 py-2 text-slate-500 font-semibold">Net</th>
                    <th className="text-right px-4 py-2 text-slate-500 font-semibold">Goal</th>
                    <th className="text-right px-4 py-2 text-slate-500 font-semibold">vs Goal</th>
                    <th className="px-4 py-2"/>
                  </tr>
                </thead>
                <tbody>
                  {FY_MONTHS.map(mon=>{
                    const r=rows.find(x=>x.month===mon);
                    if(!r&&!rows.length) return null;
                    if(!r) return(
                      <tr key={mon} className="border-t border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-400">{mon}</td>
                        <td className="px-4 py-2 text-right text-slate-300">—</td>
                        <td className="px-4 py-2 text-right text-slate-300">—</td>
                        <td className="px-4 py-2 text-right text-slate-300">—</td>
                        <td className="px-4 py-2 text-right text-slate-300">—</td>
                        <td className="px-4 py-2 text-right text-slate-300">—</td>
                        <td className="px-4 py-2"/>
                      </tr>
                    );
                    const net=r.revenue-r.expenses;
                    const vsGoal=r.goal>0?((r.revenue/r.goal)*100).toFixed(0)+"%":"—";
                    return(
                      <tr key={mon} className="border-t border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-700">{mon}</td>
                        <td className="px-4 py-2 text-right font-semibold text-slate-800">{adm$(r.revenue)}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{r.expenses>0?adm$(r.expenses):"—"}</td>
                        <td className="px-4 py-2 text-right font-semibold" style={{color:net>=0?"#16a34a":"#dc2626"}}>{adm$(net)}</td>
                        <td className="px-4 py-2 text-right text-slate-500">{r.goal>0?adm$(r.goal):"—"}</td>
                        <td className="px-4 py-2 text-right">
                          {r.goal>0?<span style={{color:r.revenue>=r.goal?"#16a34a":r.revenue>=r.goal*0.8?"#b45309":"#dc2626",fontWeight:700}}>{vsGoal}</span>:"—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex gap-1 justify-end">
                            <button onClick={()=>openEdit(r)} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-500">✏</button>
                            <button onClick={()=>setConfirm(r.id)} className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-400">✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200" style={{background:"#f8fafc"}}>
                    <td className="px-4 py-2 font-bold text-slate-700">TOTAL</td>
                    <td className="px-4 py-2 text-right font-bold text-slate-800">{adm$(totalRev)}</td>
                    <td className="px-4 py-2 text-right font-bold text-slate-700">{adm$(totalExp)}</td>
                    <td className="px-4 py-2 text-right font-bold" style={{color:(totalRev-totalExp)>=0?"#16a34a":"#dc2626"}}>{adm$(totalRev-totalExp)}</td>
                    <td className="px-4 py-2 text-right font-bold text-slate-500">{totalGoal>0?adm$(totalGoal):"—"}</td>
                    <td className="px-4 py-2 text-right font-bold">{totalGoal>0?<span style={{color:totalRev>=totalGoal?"#16a34a":"#dc2626"}}>{((totalRev/totalGoal)*100).toFixed(0)}%</span>:"—"}</td>
                    <td className="px-4 py-2"/>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {/* Add/Edit Modal */}
      {showModal&&(
        <AModal title={editRow?"Edit Fund Entry":"Add Fund Entry"} onClose={()=>setShowModal(false)}>
          <div className="grid grid-cols-2 gap-x-4">
            <AInp label="Fund" value={f("fund_name")} onChange={v=>s("fund_name",v)} options={FUND_LIST} required/>
            <AInp label="Fiscal Year" value={f("fy")} onChange={v=>s("fy",v)} options={ADMIN_FYS} required/>
            <AInp label="Month" value={f("month")} onChange={v=>s("month",v)} options={FY_MONTHS} required/>
            <AInp label="Revenue ($)" value={f("revenue")} onChange={v=>s("revenue",v)} type="number"/>
            <AInp label="Expenses ($)" value={f("expenses")} onChange={v=>s("expenses",v)} type="number"/>
            <AInp label="Goal ($)" value={f("goal")} onChange={v=>s("goal",v)} type="number"/>
          </div>
          <AInp label="Notes" value={f("notes")} onChange={v=>s("notes",v)} rows={2}/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this fund entry?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ─── GOALS & OBJECTIVES ──────────────────────────────────────────────────────
function GoalsSection({db}){
  const [goals,setGoals]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState(ADMIN_CUR);
  const [qFilter,setQFilter]=useState("all");
  const [sFilter,setSFilter]=useState("all");
  const [cvFilter,setCvFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [expandedId,setExpandedId]=useState(null);
  const [showArchived,setShowArchived]=useState(false);
  const emptyForm={fy:ADMIN_CUR,quarter:"Q1 (May–Aug)",staff_lead:"",supporting_staff:"",objective:"",core_value:"Excellence",status:"Not Started",updates:"",is_archived:false};
  const [form,setForm]=useState(emptyForm);

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_goals",SEED_GOALS);
    const {data}=await db.from("admin_goals").select("*").order("quarter").order("staff_lead");
    setGoals(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fy:form.fy,quarter:form.quarter,staff_lead:form.staff_lead,supporting_staff:form.supporting_staff,
      objective:form.objective,core_value:form.core_value,status:form.status,updates:form.updates,is_archived:form.is_archived};
    if(editRow){await db.from("admin_goals").update(d).eq("id",editRow.id);}
    else{await db.from("admin_goals").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_goals").delete().eq("id",id);setConfirm(null);load();}
  async function toggleArchive(r){await db.from("admin_goals").update({is_archived:!r.is_archived}).eq("id",r.id);load();}
  async function quickStatus(id,status){await db.from("admin_goals").update({status}).eq("id",id);load();}

  function openEdit(r){setEditRow(r);setForm({fy:r.fy,quarter:r.quarter,staff_lead:r.staff_lead,supporting_staff:r.supporting_staff||"",objective:r.objective,core_value:r.core_value,status:r.status,updates:r.updates||"",is_archived:r.is_archived});setShowModal(true);}

  if(loading) return <div className="text-center py-20 text-slate-400">Loading…</div>;

  const fyGoals=goals.filter(g=>g.fy===fy&&!g.is_archived);
  const archivedGoals=goals.filter(g=>g.is_archived);

  const base=showArchived?archivedGoals:fyGoals;
  const filtered=base.filter(g=>{
    if(qFilter!=="all"&&g.quarter!==qFilter) return false;
    if(sFilter!=="all"&&g.status!==sFilter) return false;
    if(cvFilter!=="all"&&g.core_value!==cvFilter) return false;
    if(search&&!g.objective.toLowerCase().includes(search.toLowerCase())&&!g.staff_lead.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const statusCounts=GOAL_STATUSES.reduce((a,s)=>({...a,[s]:fyGoals.filter(g=>g.status===s).length}),{});
  const complete=statusCounts["Complete"]||0;
  const total=fyGoals.length;
  const completePct=total>0?Math.round((complete/total)*100):0;

  return(
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-slate-800" style={{fontSize:"18px"}}>Goals & Objectives</h2>
          <p className="text-sm text-slate-500 mt-0.5">Track staff goals by quarter, core value, and status</p>
        </div>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy}/>
          <button onClick={()=>{setEditRow(null);setForm({...emptyForm,fy});setShowModal(true);}}
            className="px-4 py-2 text-sm font-bold rounded-lg text-white flex items-center gap-1" style={{background:"#1e3a5f"}}>+ Add Goal</button>
        </div>
      </div>

      {/* Status summary cards */}
      <div className="grid gap-3 mb-6" style={{gridTemplateColumns:"repeat(5,1fr)"}}>
        {GOAL_STATUSES.map(s=>(
          <button key={s} onClick={()=>setSFilter(sFilter===s?"all":s)}
            className="rounded-xl p-3 text-center transition border-2"
            style={{background:sFilter===s?STATUS_BG[s]:"white",borderColor:sFilter===s?STATUS_CLR[s]:"#e2e8f0"}}>
            <div className="font-bold text-2xl" style={{color:STATUS_CLR[s]}}>{statusCounts[s]||0}</div>
            <div className="text-xs font-semibold mt-1" style={{color:STATUS_CLR[s]}}>{s}</div>
          </button>
        ))}
      </div>

      {/* Progress bar */}
      {total>0&&(
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm mb-5">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-semibold text-slate-700">Overall Completion — FY {fy}</span>
            <span className="font-bold" style={{color:"#16a34a"}}>{completePct}% ({complete}/{total})</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{background:"#f1f5f9"}}>
            <div className="h-full rounded-full transition-all" style={{width:`${completePct}%`,background:"#16a34a"}}/>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm mb-5 flex flex-wrap gap-3 items-center">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search goals or staff…"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm flex-1" style={{minWidth:160}}/>
        <select value={qFilter} onChange={e=>setQFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
          <option value="all">All Quarters</option>
          {QUARTERS_GO.map(q=><option key={q} value={q}>{q}</option>)}
        </select>
        <select value={cvFilter} onChange={e=>setCvFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
          <option value="all">All Core Values</option>
          {CORE_VALUES.map(v=><option key={v} value={v}>{v}</option>)}
        </select>
        <button onClick={()=>setShowArchived(!showArchived)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border transition"
          style={showArchived?{background:"#1e3a5f",color:"white",borderColor:"#1e3a5f"}:{borderColor:"#e2e8f0",color:"#64748b"}}>
          {showArchived?`📂 Archived (${archivedGoals.length})`:"📦 View Archived"}
        </button>
        <span className="text-xs text-slate-400">{filtered.length} shown</span>
      </div>

      {/* Goals list grouped by quarter */}
      {!showArchived&&QUARTERS_GO.map(q=>{
        const qGoals=filtered.filter(g=>g.quarter===q);
        if(qGoals.length===0&&qFilter!=="all"&&qFilter!==q) return null;
        if(qGoals.length===0) return null;
        const qComplete=qGoals.filter(g=>g.status==="Complete").length;
        return(
          <div key={q} className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-700">{q}</h3>
              <span className="text-xs text-slate-500">{qComplete}/{qGoals.length} complete</span>
            </div>
            <div className="space-y-2">
              {qGoals.map(g=>(
                <div key={g.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={()=>setExpandedId(expandedId===g.id?null:g.id)}>
                    <div className="flex-shrink-0 mt-0.5">
                      <select value={g.status} onClick={e=>e.stopPropagation()}
                        onChange={e=>quickStatus(g.id,e.target.value)}
                        className="text-xs font-bold rounded-full px-2 py-1 border-0 cursor-pointer"
                        style={{background:STATUS_BG[g.status],color:STATUS_CLR[g.status]}}>
                        {GOAL_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 leading-snug">{g.objective}</div>
                      <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-slate-500">
                        <span>👤 {g.staff_lead}</span>
                        {g.supporting_staff&&<span>+ {g.supporting_staff}</span>}
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{background:"#eff6ff",color:"#1d4ed8"}}>{g.core_value}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={e=>{e.stopPropagation();openEdit(g);}} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500">✏</button>
                      <button onClick={e=>{e.stopPropagation();toggleArchive(g);}} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500" title="Archive">📦</button>
                      <button onClick={e=>{e.stopPropagation();setConfirm(g.id);}} className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-400">✕</button>
                      <span className="text-slate-300 text-xs ml-1">{expandedId===g.id?"▲":"▼"}</span>
                    </div>
                  </div>
                  {expandedId===g.id&&(
                    <div className="px-4 pb-4 border-t border-slate-50 pt-3">
                      {g.updates
                        ?<div><div className="text-xs font-semibold text-slate-500 mb-1">Progress Update</div>
                          <div className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">{g.updates}</div></div>
                        :<div className="text-xs text-slate-400 italic">No updates yet</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Archived list */}
      {showArchived&&(
        <div className="space-y-2">
          {filtered.map(g=>(
            <div key={g.id} className="bg-slate-50 rounded-xl border border-slate-200 p-4 flex items-start gap-3">
              <ABadge status={g.status}/>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-600 line-through">{g.objective}</div>
                <div className="text-xs text-slate-400 mt-1">{g.staff_lead} · {g.fy} · {g.quarter}</div>
              </div>
              <button onClick={()=>toggleArchive(g)} className="text-xs px-2 py-1 rounded-lg border border-slate-300 text-slate-500 hover:bg-white">↩ Restore</button>
              <button onClick={()=>setConfirm(g.id)} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-400 hover:bg-red-100">✕</button>
            </div>
          ))}
          {filtered.length===0&&<EmptyState msg="No archived goals"/>}
        </div>
      )}

      {filtered.length===0&&!showArchived&&<EmptyState msg="No goals match filters" action="Add Goal" onAction={()=>{setEditRow(null);setForm({...emptyForm,fy});setShowModal(true);}}/>}

      {/* Modal */}
      {showModal&&(
        <AModal title={editRow?"Edit Goal":"Add Goal"} onClose={()=>setShowModal(false)} wide>
          <div className="grid grid-cols-2 gap-x-4">
            <AInp label="Fiscal Year" value={form.fy} onChange={v=>setForm(p=>({...p,fy:v}))} options={ADMIN_FYS} required/>
            <AInp label="Quarter" value={form.quarter} onChange={v=>setForm(p=>({...p,quarter:v}))} options={QUARTERS_GO} required/>
            <AInp label="Staff Lead" value={form.staff_lead} onChange={v=>setForm(p=>({...p,staff_lead:v}))} required/>
            <AInp label="Supporting Staff" value={form.supporting_staff} onChange={v=>setForm(p=>({...p,supporting_staff:v}))}/>
            <AInp label="Core Value" value={form.core_value} onChange={v=>setForm(p=>({...p,core_value:v}))} options={CORE_VALUES}/>
            <AInp label="Status" value={form.status} onChange={v=>setForm(p=>({...p,status:v}))} options={GOAL_STATUSES}/>
          </div>
          <AInp label="Objective (SMART goal)" value={form.objective} onChange={v=>setForm(p=>({...p,objective:v}))} rows={3} required/>
          <AInp label="Progress Updates" value={form.updates} onChange={v=>setForm(p=>({...p,updates:v}))} rows={3}/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this goal permanently?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ─── RENTALS ─────────────────────────────────────────────────────────────────
function RentalsSection({db}){
  const [rentals,setRentals]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState(ADMIN_CUR);
  const [activeCat,setActiveCat]=useState("all");
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [form,setForm]=useState({fy:ADMIN_CUR,category:"",month:"",amount:"",is_archived:false});

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_rentals",SEED_RENTALS);
    const {data}=await db.from("admin_rentals").select("*").eq("is_archived",false);
    setRentals(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fy:form.fy,category:form.category,month:form.month,amount:parseFloat(form.amount)||0,is_archived:false};
    if(editRow){await db.from("admin_rentals").update(d).eq("id",editRow.id);}
    else{await db.from("admin_rentals").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_rentals").delete().eq("id",id);setConfirm(null);load();}
  function openEdit(r){setEditRow(r);setForm({fy:r.fy,category:r.category,month:r.month||"",amount:r.amount||"",is_archived:false});setShowModal(true);}

  if(loading) return <div className="text-center py-20 text-slate-400">Loading…</div>;

  const fyRows=rentals.filter(r=>r.fy===fy);
  const allFYs=ADMIN_FYS.filter(f=>rentals.some(r=>r.fy===f));

  // YoY totals by FY
  const fyTotals=allFYs.reduce((a,f)=>({...a,[f]:sumField(rentals.filter(r=>r.fy===f),"amount")}),{});
  const fyTotalsCat=RENTAL_CATS.reduce((a,cat)=>({...a,[cat]:allFYs.reduce((b,f)=>({...b,[f]:sumField(rentals.filter(r=>r.fy===f&&r.category===cat),"amount")}),{})}),{});
  const prevFy=ADMIN_FYS[ADMIN_FYS.indexOf(fy)-1];
  const totalFY=sumField(fyRows,"amount");
  const totalPrev=prevFy?sumField(rentals.filter(r=>r.fy===prevFy),"amount"):0;

  const dispCats=activeCat==="all"?RENTAL_CATS:[activeCat];

  return(
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-slate-800" style={{fontSize:"18px"}}>Rentals</h2>
          <p className="text-sm text-slate-500 mt-0.5">Monthly rental revenue by category with YoY comparisons</p>
        </div>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy} include2027/>
          <button onClick={()=>{setEditRow(null);setForm({fy,category:activeCat==="all"?"":activeCat,month:"",amount:""});setShowModal(true);}}
            className="px-4 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>+ Add Entry</button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid gap-3 mb-6" style={{gridTemplateColumns:"repeat(3,1fr)"}}>
        <AKpi label="Total Rentals Revenue" value={adm$(totalFY)} sub={`FY ${fy}`} arrow={prevFy&&arrowBadge(yoyPct(totalFY,totalPrev))}/>
        <AKpi label="YTD vs Prior Year" value={prevFy?adm$(totalFY-totalPrev,true):"—"} sub={prevFy?`Prior: ${adm$(totalPrev,true)}`:undefined}/>
        <AKpi label="Top Category" value={RENTAL_CATS.reduce((a,c)=>{const t=sumField(fyRows.filter(r=>r.category===c),"amount");return t>a.v?{n:c,v:t}:a},{n:"—",v:0}).n} sub="by revenue"/>
      </div>

      {/* YoY Trend Table */}
      <div className="mb-8">
        <h3 className="font-semibold text-slate-700 text-sm mb-3">Year-over-Year by Category</h3>
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm overflow-x-auto">
          <table className="w-full text-xs" style={{minWidth:600}}>
            <thead>
              <tr style={{background:"#f8fafc"}}>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase sticky left-0 bg-slate-50" style={{minWidth:150}}>Category</th>
                {allFYs.map(f=><th key={f} className="text-right px-3 py-3 font-semibold text-slate-500 uppercase" style={{minWidth:90}}>{f.replace("20","'")}</th>)}
                <th className="px-3 py-3 font-semibold text-slate-500 uppercase" style={{minWidth:70}}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {RENTAL_CATS.map(cat=>{
                const byCY=allFYs.map(f=>fyTotalsCat[cat]?.[f]||0);
                if(byCY.every(v=>v===0)) return null;
                return(
                  <tr key={cat} className={`border-t border-slate-50 hover:bg-slate-50 ${activeCat===cat?"bg-amber-50":""}`}
                    onClick={()=>setActiveCat(activeCat===cat?"all":cat)} style={{cursor:"pointer"}}>
                    <td className="px-4 py-2 font-semibold text-slate-700 sticky left-0 bg-white">{cat}</td>
                    {byCY.map((v,i)=>{
                      const prev=byCY[i-1];
                      const pct=prev&&prev>0?((v-prev)/prev)*100:null;
                      return(
                        <td key={i} className="px-3 py-2 text-right">
                          <div className="font-bold text-slate-800">{v>0?adm$(v,true):"—"}</div>
                          {pct!=null&&<div style={{color:pct>=0?"#16a34a":"#dc2626",fontSize:"10px"}}>{pct>=0?"▲":"▼"}{Math.abs(pct).toFixed(1)}%</div>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center"><Sparkline values={byCY.filter(v=>v>0)} color="#b45309" height={22}/></td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-200" style={{background:"#f8fafc"}}>
                <td className="px-4 py-2 font-bold text-slate-700 sticky left-0 bg-slate-50">TOTAL</td>
                {allFYs.map(f=>{
                  const t=fyTotals[f]||0;
                  return <td key={f} className="px-3 py-2 text-right font-bold text-slate-800">{t>0?adm$(t,true):"—"}</td>;
                })}
                <td className="px-3 py-2 text-center"><Sparkline values={allFYs.map(f=>fyTotals[f]||0)} color="#b45309" height={22}/></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Category detail */}
      {dispCats.map(cat=>{
        const rows=fyRows.filter(r=>r.category===cat);
        const catTotal=sumField(rows,"amount");
        const prevCatTotal=prevFy?sumField(rentals.filter(r=>r.fy===prevFy&&r.category===cat),"amount"):0;
        if(activeCat==="all"&&catTotal===0) return null;
        return(
          <div key={cat} className="mb-6 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100" style={{background:"#f8fafc"}}>
              <div className="font-semibold text-slate-800">{cat}</div>
              <div className="flex items-center gap-4 text-sm">
                <span className="font-bold text-slate-800">{adm$(catTotal)}</span>
                {prevFy&&prevCatTotal>0&&arrowBadge(yoyPct(catTotal,prevCatTotal))}
              </div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr style={{background:"#f8fafc"}}>
                  {["Month","Amount","Actions"].map(h=><th key={h} className={`py-2 px-4 text-slate-500 font-semibold ${h==="Month"?"text-left":"text-right"}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {FY_MONTHS.map(mon=>{
                  const r=rows.find(x=>x.month===mon);
                  if(!r) return(
                    <tr key={mon} className="border-t border-slate-50">
                      <td className="px-4 py-2 text-slate-400">{mon}</td>
                      <td className="px-4 py-2 text-right text-slate-300">—</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={()=>{setEditRow(null);setForm({fy,category:cat,month:mon,amount:""});setShowModal(true);}} className="text-xs px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-500">+ Add</button>
                      </td>
                    </tr>
                  );
                  return(
                    <tr key={mon} className="border-t border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-700">{mon}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800">{adm$(r.amount)}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <button onClick={()=>openEdit(r)} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-500">✏</button>
                          <button onClick={()=>setConfirm(r.id)} className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-400">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200" style={{background:"#f8fafc"}}>
                  <td className="px-4 py-2 font-bold text-slate-700">TOTAL</td>
                  <td className="px-4 py-2 text-right font-bold text-slate-800">{adm$(catTotal)}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}

      {showModal&&(
        <AModal title={editRow?"Edit Rental Entry":"Add Rental Entry"} onClose={()=>setShowModal(false)}>
          <AInp label="Fiscal Year" value={form.fy} onChange={v=>setForm(p=>({...p,fy:v}))} options={ADMIN_FYS} required/>
          <AInp label="Category" value={form.category} onChange={v=>setForm(p=>({...p,category:v}))} options={RENTAL_CATS} required/>
          <AInp label="Month" value={form.month} onChange={v=>setForm(p=>({...p,month:v}))} options={FY_MONTHS} required/>
          <AInp label="Amount ($)" value={form.amount} onChange={v=>setForm(p=>({...p,amount:v}))} type="number" required/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this rental entry?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ─── PROGRAM AREAS (Camps + Clubhouse + Events) ───────────────────────────────
function ProgramAreasSection({db}){
  const [sub,setSub]=useState("camps");
  const tabs=[{id:"camps",l:"🏕 Camps"},{id:"clubhouse",l:"🏫 Clubhouse"},{id:"events",l:"🎉 Special Events"}];
  return(
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-slate-800" style={{fontSize:"18px"}}>Program Areas</h2>
          <p className="text-sm text-slate-500 mt-0.5">Enrollment & revenue trends for camps, clubhouse, and events</p>
        </div>
        <div className="flex gap-1 bg-white rounded-xl border border-slate-100 p-1 shadow-sm">
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setSub(t.id)}
              className="px-4 py-1.5 text-xs font-bold rounded-lg transition"
              style={sub===t.id?{background:"#1e3a5f",color:"white"}:{color:"#64748b"}}>
              {t.l}
            </button>
          ))}
        </div>
      </div>
      {sub==="camps"&&<CampsDetail db={db}/>}
      {sub==="clubhouse"&&<ClubhouseDetail db={db}/>}
      {sub==="events"&&<EventsDetail db={db}/>}
    </div>
  );
}

function CampsDetail({db}){
  const [camps,setCamps]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState("2024-2025");
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [form,setForm]=useState({fy:"2024-2025",camp_name:"",enrollment:"",revenue:"",expenses:"",notes:""});

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_camps",SEED_CAMPS);
    const {data}=await db.from("admin_camps").select("*").order("camp_name");
    setCamps(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fy:form.fy,camp_name:form.camp_name,enrollment:parseInt(form.enrollment)||0,revenue:parseFloat(form.revenue)||0,expenses:parseFloat(form.expenses)||0,notes:form.notes||""};
    if(editRow){await db.from("admin_camps").update(d).eq("id",editRow.id);}
    else{await db.from("admin_camps").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_camps").delete().eq("id",id);setConfirm(null);load();}
  function openEdit(r){setEditRow(r);setForm({fy:r.fy,camp_name:r.camp_name,enrollment:r.enrollment||"",revenue:r.revenue||"",expenses:r.expenses||"",notes:r.notes||""});setShowModal(true);}

  if(loading) return <div className="text-center py-12 text-slate-400">Loading…</div>;

  const allFYs=ADMIN_FYS.filter(f=>camps.some(c=>c.fy===f));
  const fyRows=camps.filter(c=>c.fy===fy&&c.camp_name!=="Camp Connection");
  const maxEnroll=Math.max(...fyRows.map(c=>c.enrollment||0),1);

  return(
    <div>
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-slate-700">Camps Enrollment & Revenue</h3>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy}/>
          <button onClick={()=>{setEditRow(null);setForm({fy,camp_name:"",enrollment:"",revenue:"",expenses:"",notes:""});setShowModal(true);}}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-white" style={{background:"#7c3aed"}}>+ Add</button>
        </div>
      </div>

      {/* YoY enrollment table */}
      <div className="mb-6 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm text-slate-700">Enrollment by Camp — Year over Year</div>
        <table className="w-full text-xs" style={{minWidth:600}}>
          <thead>
            <tr style={{background:"#f8fafc"}}>
              <th className="text-left px-4 py-2 font-semibold text-slate-500 sticky left-0 bg-slate-50" style={{minWidth:150}}>Camp</th>
              {allFYs.map(f=><th key={f} className="text-right px-3 py-2 font-semibold text-slate-500">{f.replace("20","'")}</th>)}
              <th className="px-3 py-2 text-slate-500 font-semibold">Trend</th>
            </tr>
          </thead>
          <tbody>
            {CAMP_LIST.filter(c=>c!=="Camp Connection").map(camp=>{
              const vals=allFYs.map(f=>{const r=camps.find(c=>c.fy===f&&c.camp_name===camp);return r?.enrollment||null;});
              if(vals.every(v=>!v)) return null;
              return(
                <tr key={camp} className="border-t border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2 font-semibold text-slate-700 sticky left-0 bg-white">{camp}</td>
                  {vals.map((v,i)=>{
                    const prev=vals[i-1];
                    const pct=prev&&prev>0&&v?((v-prev)/prev)*100:null;
                    return(
                      <td key={i} className="px-3 py-2 text-right">
                        <div className="font-bold text-slate-800">{v!=null?v:"—"}</div>
                        {pct!=null&&<div style={{color:pct>=0?"#16a34a":"#dc2626",fontSize:"10px"}}>{pct>=0?"▲":"▼"}{Math.abs(pct).toFixed(1)}%</div>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center"><Sparkline values={vals.filter(v=>v!=null)} color="#7c3aed" height={22}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* FY detail bar chart */}
      <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm mb-6">
        <div className="font-semibold text-sm text-slate-700 mb-4">FY {fy} — Enrollment by Camp</div>
        <div className="space-y-2">
          {fyRows.sort((a,b)=>(b.enrollment||0)-(a.enrollment||0)).map(c=>(
            <div key={c.id} className="flex items-center gap-3">
              <div className="text-xs text-slate-600 w-32 flex-shrink-0 truncate">{c.camp_name}</div>
              <div className="flex-1 h-5 rounded-full overflow-hidden" style={{background:"#f1f5f9"}}>
                <div className="h-full rounded-full" style={{width:`${((c.enrollment||0)/maxEnroll)*100}%`,background:"#7c3aed"}}/>
              </div>
              <div className="text-xs font-bold text-slate-800 w-8 text-right">{c.enrollment||0}</div>
              <div className="flex gap-1">
                <button onClick={()=>openEdit(c)} className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-400 text-xs">✏</button>
                <button onClick={()=>setConfirm(c.id)} className="p-1 rounded bg-red-50 hover:bg-red-100 text-red-300 text-xs">✕</button>
              </div>
            </div>
          ))}
          {fyRows.length===0&&<div className="text-xs text-slate-400 text-center py-4">No camp data for FY {fy} — click "+ Add" to enter data</div>}
        </div>
      </div>

      {showModal&&(
        <AModal title={editRow?"Edit Camp Record":"Add Camp Record"} onClose={()=>setShowModal(false)}>
          <AInp label="Fiscal Year" value={form.fy} onChange={v=>setForm(p=>({...p,fy:v}))} options={ADMIN_FYS} required/>
          <AInp label="Camp" value={form.camp_name} onChange={v=>setForm(p=>({...p,camp_name:v}))} options={CAMP_LIST} required/>
          <div className="grid grid-cols-3 gap-x-4">
            <AInp label="Enrollment" value={form.enrollment} onChange={v=>setForm(p=>({...p,enrollment:v}))} type="number"/>
            <AInp label="Revenue ($)" value={form.revenue} onChange={v=>setForm(p=>({...p,revenue:v}))} type="number"/>
            <AInp label="Expenses ($)" value={form.expenses} onChange={v=>setForm(p=>({...p,expenses:v}))} type="number"/>
          </div>
          <AInp label="Notes" value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} rows={2}/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#7c3aed"}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this camp record?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

function ClubhouseDetail({db}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState(ADMIN_CUR);
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [form,setForm]=useState({fy:ADMIN_CUR,site:"",enrollment:"",revenue:"",is_archived:false});

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_clubhouse",SEED_CLUBHOUSE);
    const {data}=await db.from("admin_clubhouse").select("*").eq("is_archived",false).order("site");
    setRows(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fy:form.fy,site:form.site,enrollment:parseFloat(form.enrollment)||0,revenue:parseFloat(form.revenue)||0,is_archived:false};
    if(editRow){await db.from("admin_clubhouse").update(d).eq("id",editRow.id);}
    else{await db.from("admin_clubhouse").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_clubhouse").delete().eq("id",id);setConfirm(null);load();}
  function openEdit(r){setEditRow(r);setForm({fy:r.fy,site:r.site,enrollment:r.enrollment||"",revenue:r.revenue||"",is_archived:false});setShowModal(true);}

  if(loading) return <div className="text-center py-12 text-slate-400">Loading…</div>;

  const allFYs=ADMIN_FYS.filter(f=>rows.some(r=>r.fy===f));
  const fyRows=rows.filter(r=>r.fy===fy);
  const maxEnroll=Math.max(...fyRows.map(r=>r.enrollment||0),1);
  const fyTotal=sumField(fyRows,"enrollment");
  const fyRevTotal=sumField(fyRows,"revenue");

  return(
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="font-semibold text-slate-700">Clubhouse Sites</h3>
          {fyTotal>0&&<p className="text-xs text-slate-500 mt-0.5">FY {fy}: {fyTotal.toFixed(0)} avg total enrollment · {adm$(fyRevTotal)} revenue</p>}
        </div>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy}/>
          <button onClick={()=>{setEditRow(null);setForm({fy,site:"",enrollment:"",revenue:""});setShowModal(true);}}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-white" style={{background:"#0f766e"}}>+ Add</button>
        </div>
      </div>

      {/* YoY table */}
      <div className="mb-6 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm text-slate-700">Average Enrollment by Site — Year over Year</div>
        <table className="w-full text-xs" style={{minWidth:500}}>
          <thead>
            <tr style={{background:"#f8fafc"}}>
              <th className="text-left px-4 py-2 font-semibold text-slate-500 sticky left-0 bg-slate-50" style={{minWidth:140}}>Site</th>
              {allFYs.map(f=><th key={f} className="text-right px-3 py-2 font-semibold text-slate-500">{f.replace("20","'")}</th>)}
              <th className="px-3 py-2 text-slate-500 font-semibold">Trend</th>
            </tr>
          </thead>
          <tbody>
            {CLUB_SITES.map(site=>{
              const vals=allFYs.map(f=>{const r=rows.find(x=>x.fy===f&&x.site===site);return r?.enrollment||null;});
              if(vals.every(v=>!v)) return null;
              return(
                <tr key={site} className="border-t border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2 font-semibold text-slate-700 sticky left-0 bg-white">{site}</td>
                  {vals.map((v,i)=>{
                    const prev=vals[i-1];
                    const pct=prev&&prev>0&&v?((v-prev)/prev)*100:null;
                    return(
                      <td key={i} className="px-3 py-2 text-right">
                        <div className="font-bold text-slate-800">{v!=null?v.toFixed(0):"—"}</div>
                        {pct!=null&&<div style={{color:pct>=0?"#16a34a":"#dc2626",fontSize:"10px"}}>{pct>=0?"▲":"▼"}{Math.abs(pct).toFixed(1)}%</div>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center"><Sparkline values={vals.filter(v=>v!=null)} color="#0f766e" height={22}/></td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200" style={{background:"#f8fafc"}}>
              <td className="px-4 py-2 font-bold text-slate-700 sticky left-0 bg-slate-50">TOTAL</td>
              {allFYs.map(f=>{
                const t=sumField(rows.filter(r=>r.fy===f),"enrollment");
                return <td key={f} className="px-3 py-2 text-right font-bold text-slate-800">{t>0?t.toFixed(0):"—"}</td>;
              })}
              <td/>
            </tr>
          </tbody>
        </table>
      </div>

      {/* FY detail with YoY */}
      <ClubEnrollChart fyRows={fyRows} allRows={rows} fy={fy} maxEnroll={maxEnroll}
        onEdit={openEdit} onAdd={(site)=>{setEditRow(null);setForm({fy,site,enrollment:"",revenue:""});setShowModal(true);}}/>

      {showModal&&(
        <AModal title={editRow?"Edit Clubhouse Record":"Add Clubhouse Record"} onClose={()=>setShowModal(false)}>
          <AInp label="Fiscal Year" value={form.fy} onChange={v=>setForm(p=>({...p,fy:v}))} options={ADMIN_FYS} required/>
          <AInp label="Site" value={form.site} onChange={v=>setForm(p=>({...p,site:v}))} options={CLUB_SITES} required/>
          <AInp label="Avg Enrollment" value={form.enrollment} onChange={v=>setForm(p=>({...p,enrollment:v}))} type="number"/>
          <AInp label="Total Revenue ($)" value={form.revenue} onChange={v=>setForm(p=>({...p,revenue:v}))} type="number"/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#0f766e"}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this clubhouse record?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

function EventsDetail({db}){
  const [events,setEvents]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState("2024-2025");
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [form,setForm]=useState({fy:"2024-2025",event_name:"",event_type:"Summer Concert",attendance:"",revenue:"",expenses:"",notes:""});

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_events",SEED_EVENTS);
    const {data}=await db.from("admin_events").select("*").order("event_type").order("fy");
    setEvents(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fy:form.fy,event_name:form.event_name,event_type:form.event_type,attendance:parseInt(form.attendance)||0,revenue:parseFloat(form.revenue)||0,expenses:parseFloat(form.expenses)||0,notes:form.notes||""};
    if(editRow){await db.from("admin_events").update(d).eq("id",editRow.id);}
    else{await db.from("admin_events").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_events").delete().eq("id",id);setConfirm(null);load();}
  function openEdit(r){setEditRow(r);setForm({fy:r.fy,event_name:r.event_name,event_type:r.event_type,attendance:r.attendance||"",revenue:r.revenue||"",expenses:r.expenses||"",notes:r.notes||""});setShowModal(true);}

  if(loading) return <div className="text-center py-12 text-slate-400">Loading…</div>;

  const allFYs=ADMIN_FYS.filter(f=>events.some(e=>e.fy===f));
  const fyRows=events.filter(e=>e.fy===fy);
  const totalAtt=sumField(fyRows,"attendance");

  // YoY by event type
  const eventTypes=[...new Set(events.map(e=>e.event_type))];

  return(
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="font-semibold text-slate-700">Special Events</h3>
          {totalAtt>0&&<p className="text-xs text-slate-500 mt-0.5">FY {fy}: {totalAtt.toLocaleString()} total attendance</p>}
        </div>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy}/>
          <button onClick={()=>{setEditRow(null);setForm({fy,event_name:"",event_type:"Summer Concert",attendance:"",revenue:"",expenses:"",notes:""});setShowModal(true);}}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-white" style={{background:"#b45309"}}>+ Add Event</button>
        </div>
      </div>

      {/* YoY summary by event series */}
      <div className="mb-6 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm text-slate-700">Attendance by Year</div>
        <table className="w-full text-xs" style={{minWidth:500}}>
          <thead>
            <tr style={{background:"#f8fafc"}}>
              <th className="text-left px-4 py-2 font-semibold text-slate-500" style={{minWidth:180}}>Event</th>
              {allFYs.map(f=><th key={f} className="text-right px-3 py-2 font-semibold text-slate-500">{f.replace("20","'")}</th>)}
              <th className="px-3 py-2 text-slate-500 font-semibold">Trend</th>
            </tr>
          </thead>
          <tbody>
            {[...new Set(events.map(e=>e.event_name))].map(nm=>{
              const vals=allFYs.map(f=>sumField(events.filter(e=>e.fy===f&&e.event_name===nm),"attendance")||null);
              if(vals.every(v=>!v)) return null;
              return(
                <tr key={nm} className="border-t border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2 font-semibold text-slate-700">{nm}</td>
                  {vals.map((v,i)=>{
                    const prev=vals[i-1];
                    const pct=prev&&prev>0&&v?((v-prev)/prev)*100:null;
                    return(
                      <td key={i} className="px-3 py-2 text-right">
                        <div className="font-bold text-slate-800">{v||"—"}</div>
                        {pct!=null&&<div style={{color:pct>=0?"#16a34a":"#dc2626",fontSize:"10px"}}>{pct>=0?"▲":"▼"}{Math.abs(pct).toFixed(1)}%</div>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center"><Sparkline values={vals.filter(v=>v!=null)} color="#b45309" height={22}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* FY event list */}
      <div className="space-y-2">
        {fyRows.sort((a,b)=>(b.attendance||0)-(a.attendance||0)).map(e=>(
          <div key={e.id} className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm flex items-center gap-4">
            <div className="flex-1">
              <div className="font-semibold text-slate-800 text-sm">{e.event_name}</div>
              <div className="text-xs text-slate-500 mt-0.5 flex gap-3">
                <span>{e.event_type}</span>
                {e.revenue>0&&<span>{adm$(e.revenue)} revenue</span>}
                {e.notes&&<span className="text-slate-400">{e.notes}</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold text-slate-800">{(e.attendance||0).toLocaleString()}</div>
              <div className="text-xs text-slate-500">attendees</div>
            </div>
            <div className="flex gap-1">
              <button onClick={()=>openEdit(e)} className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-500">✏</button>
              <button onClick={()=>setConfirm(e.id)} className="p-1.5 rounded bg-red-50 hover:bg-red-100 text-red-400">✕</button>
            </div>
          </div>
        ))}
        {fyRows.length===0&&<EmptyState msg={`No events for FY ${fy}`} action="Add Event" onAction={()=>{setEditRow(null);setForm({fy,event_name:"",event_type:"Summer Concert",attendance:"",revenue:"",expenses:"",notes:""});setShowModal(true);}}/>}
      </div>

      {showModal&&(
        <AModal title={editRow?"Edit Event":"Add Event"} onClose={()=>setShowModal(false)} wide>
          <div className="grid grid-cols-2 gap-x-4">
            <AInp label="Fiscal Year" value={form.fy} onChange={v=>setForm(p=>({...p,fy:v}))} options={ADMIN_FYS} required/>
            <AInp label="Event Type" value={form.event_type} onChange={v=>setForm(p=>({...p,event_type:v}))} options={EVENT_TYPES}/>
            <AInp label="Attendance" value={form.attendance} onChange={v=>setForm(p=>({...p,attendance:v}))} type="number"/>
            <AInp label="Revenue ($)" value={form.revenue} onChange={v=>setForm(p=>({...p,revenue:v}))} type="number"/>
            <AInp label="Expenses ($)" value={form.expenses} onChange={v=>setForm(p=>({...p,expenses:v}))} type="number"/>
          </div>
          <AInp label="Event Name" value={form.event_name} onChange={v=>setForm(p=>({...p,event_name:v}))} required/>
          <AInp label="Notes" value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} rows={2}/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#b45309"}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this event?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

const SEED_FEES = [
  {fy:"2026-2027",area:"Other",program_name:"Dog Park Passes - Annual",resident_fee:"$25/$31",nonresident_fee:"$28/$40/$52 & $35/$50/$60",contractual:false,notes:"SR & created tiers for dogs - 1, 2, 3 etc.",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dog Park Passes - Late Season",resident_fee:"$15/$19",nonresident_fee:"$20/$24/$32 & $25/$30/$40",contractual:false,notes:"SR & created tiers for dogs - 1, 2, 3 etc.",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dog Park Passes - Daily",resident_fee:"8.0",nonresident_fee:"$8/$12/$16",contractual:false,notes:"SR & created tiers for dogs - 1, 2, 3 etc.",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Drawing & Painting",resident_fee:"$91/$114",nonresident_fee:"$80/$100",contractual:false,notes:"The number of classes/sessions decreased",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Mah Jongg Tournament",resident_fee:"25.0",nonresident_fee:"27.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Trips",resident_fee:"varies dep on destination",nonresident_fee:"varies dep on destination",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Basketball - Open Gym",resident_fee:"$6 Per Class",nonresident_fee:"$7 Per Class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Fall Softball",resident_fee:"750.0",nonresident_fee:"800.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Pickleball Clinics",resident_fee:"$75 Per Class",nonresident_fee:"$80 Per Class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Pickleball",resident_fee:"$6 Per Class",nonresident_fee:"$7 Per Class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Summer Softball Competitive",resident_fee:"750.0",nonresident_fee:"800.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Summer Softball Recreational",resident_fee:"750.0",nonresident_fee:"800.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Volleyball",resident_fee:"$6 Per Class",nonresident_fee:"$7 Per Class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fall Adult Karate",resident_fee:"$15 - $19",nonresident_fee:"$15 - $19",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Spring Adult Karate",resident_fee:"$15 - $19",nonresident_fee:"$15 - $19",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Summer Adult Karate",resident_fee:"$15 - $19",nonresident_fee:"$15 - $19",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Winter Adult Karate",resident_fee:"$15 - $19",nonresident_fee:"$15 - $19",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Bags League",resident_fee:"$65 Per Team",nonresident_fee:"$65 Per Team",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Kickball League",resident_fee:"$65 Per Team",nonresident_fee:"$65 Per Team",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Whiffle Ball League",resident_fee:"$65 Per Team",nonresident_fee:"$65 Per Team",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"All Ages - Fall/Winter",resident_fee:"380.0",nonresident_fee:"385.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"All Ages - Summer",resident_fee:"205.0",nonresident_fee:"210.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"8 & Under - Fall/Winter",resident_fee:"490.0",nonresident_fee:"495.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"9-10, 11-12, 13-14, 15 and older - Fall/Winter",resident_fee:"565.0",nonresident_fee:"570.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"8 & Under - Summer",resident_fee:"380.0",nonresident_fee:"385.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"9-10, 11-12, 13-14, 15 and older - Summer",resident_fee:"465.0",nonresident_fee:"470.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Swim Team Tryouts",resident_fee:"10.0",nonresident_fee:"15.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Per session (8 - 30 min.) Tadpoles Swim Classes",resident_fee:"$111/$139",nonresident_fee:"$115/$145",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Per session (8 - 30 min.) Water Babies",resident_fee:"$70/$88",nonresident_fee:"$75/$95",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Per session (8 - 30 min.) Water Tots",resident_fee:"$83/$104",nonresident_fee:"$90/$115",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Per session (8 - 30 min.) Group Swim Classes",resident_fee:"$99/$124",nonresident_fee:"$100/$125",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Per session (6 - 60 min.) Swim Team Prep (26-27 based on 6 classes)",resident_fee:"$166/$207",nonresident_fee:"$125/$160",contractual:false,notes:"The number of classes/sessions decreased",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Private Lessons Fee (8 lessons)",resident_fee:"250.0",nonresident_fee:"260.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Small Group Training (swim team)",resident_fee:"45.0",nonresident_fee:"45.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Hurricanes Private Lessons (30 min lessons)",resident_fee:"42.0",nonresident_fee:"45.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Member Priority Private Lessons (8 lessons) (Members)",resident_fee:"210.0",nonresident_fee:"215.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Member Priority Private Lessons (8 lessons) (Non-Member Residents)",resident_fee:"250.0",nonresident_fee:"260.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Member Priority Private Lessons (8 lessons) (Non-Member Non-Res)",resident_fee:"313.0",nonresident_fee:"325.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Lifeguard (New)",resident_fee:"85.0",nonresident_fee:"100.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"12 months and under",resident_fee:"Free",nonresident_fee:"Free",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Children and Adults",resident_fee:"5.0",nonresident_fee:"5.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Seniors",resident_fee:"3.0",nonresident_fee:"3.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Twilight Time",resident_fee:"3.0",nonresident_fee:"3.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"With Current Pool Pass",resident_fee:"4.0",nonresident_fee:"4.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Splasher Pass",resident_fee:"80.0",nonresident_fee:"80.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Party Deck Rental",resident_fee:"$175 / $215",nonresident_fee:"$177 / $265",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Ultimate (Private) Rental (Full Facility Rental)",resident_fee:"$440 / $540",nonresident_fee:"$440 / $660",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Splash Bash (Semi Private - Max 65) Rental",resident_fee:"$245 / $307",nonresident_fee:"$247 / $370",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Mini Splash Bash (Semi Private - Max 50) Rental",resident_fee:"$215 / $269",nonresident_fee:"$217 / $325",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Lap Swim",resident_fee:"8.0",nonresident_fee:"8.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Open Swim",resident_fee:"8.0",nonresident_fee:"8.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Senior Rate",resident_fee:"5.0",nonresident_fee:"5.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Twilight Time Public/Senior",resident_fee:"5.0",nonresident_fee:"5.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Pool Punch Pass",resident_fee:"$120/$150",nonresident_fee:"$120/$150",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Individual",resident_fee:"$125/$156",nonresident_fee:"$125/$160",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Family of 2",resident_fee:"$140/$174",nonresident_fee:"$140/$175",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Family of 3",resident_fee:"$155/$192",nonresident_fee:"$155/$195",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Family of 4",resident_fee:"$170/$210",nonresident_fee:"$170/$215",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Family of 5",resident_fee:"$185/$228",nonresident_fee:"$185/$235",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Family of 6",resident_fee:"$200/$246",nonresident_fee:"$200/$250",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 102 - Pritchett, Tripp - AM",resident_fee:"13.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 102 - Pritchett, Tripp - PM",resident_fee:"16.0",nonresident_fee:"17.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 102 - Meridian - AM",resident_fee:"7.0",nonresident_fee:"7.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 102 - Meridian - PM",resident_fee:"23.0",nonresident_fee:"24.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 21 - Kilmer, Longfellow - AM",resident_fee:"13.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 21 - Kilmer, Longfellow - PM",resident_fee:"16.0",nonresident_fee:"17.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 96  - Ivy, Kld, Pra, Ctry Meadows - AM",resident_fee:"8.0",nonresident_fee:"9.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 96  - Ivy, Kld, Pra, Ctry Meadows - PM",resident_fee:"20.0",nonresident_fee:"21.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 96  - Willow Grove - AM",resident_fee:"11.0",nonresident_fee:"12.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"District 96  - Willow Grove - PM",resident_fee:"20.0",nonresident_fee:"21.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"One Day Field Trip (Clubhouse Participant)",resident_fee:"60.0",nonresident_fee:"65.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Field Trip Only (Attends field trips but not a Clubhouse participant)",resident_fee:"70.0",nonresident_fee:"75.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Birthday Parties - Basic",resident_fee:"345.0",nonresident_fee:"$300 In/$375 Out",contractual:false,notes:"SR & Created In/Out-of-District Pricing",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Birthday Parites - Specialty",resident_fee:"430.0",nonresident_fee:"$400 In/$500 Out",contractual:false,notes:"SR & Created In/Out-of-District Pricing",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Two Year Old Preschool- 2 days",resident_fee:"19.0",nonresident_fee:"24.66",contractual:false,notes:"Extended class to 2 hours/day & one extra week",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Two Year Old Preschool- 3 days",resident_fee:"19.0",nonresident_fee:"24.75",contractual:false,notes:"Extended class to 2 hours/day & one extra week",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Pre Threes Preschool- 2 days",resident_fee:"24.0",nonresident_fee:"27.0",contractual:false,notes:"Extended class to 2.25 hours/day",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Pre Threes Preschool- 3 days",resident_fee:"24.0",nonresident_fee:"27.0",contractual:false,notes:"Extended class to 2.25 hours/day",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Three Year Old Preschool- 2 days",resident_fee:"35.0",nonresident_fee:"N/A",contractual:false,notes:"Lack of registration",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Three Year Old Preschool- 3 days",resident_fee:"35.0",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Three Year Old Preschool- 5 days",resident_fee:"35.0",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Four Year Old Preschool- 2 days",resident_fee:"35.0",nonresident_fee:"N/A",contractual:false,notes:"Lack of registration",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Four Year Old Preschool- 3 days",resident_fee:"35.0",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Four Year Old Preschool- 5 days",resident_fee:"35.0",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Alphabet Zoo",resident_fee:"13.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Hands on Art",resident_fee:"29.0",nonresident_fee:"N/A",contractual:true,notes:"Program cancelled",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Game On",resident_fee:"19.5",nonresident_fee:"21.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Passport to Adventure",resident_fee:"20.0",nonresident_fee:"21.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Kid Rock",resident_fee:"13.0",nonresident_fee:"13.0",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Friendship Cafe'",resident_fee:"13.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Math Detectives",resident_fee:"13.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Sprinkle and Sparkle Crafts",resident_fee:"13.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Add-On",resident_fee:"$44IN/$44OUT",nonresident_fee:"$47IN/$47OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult",resident_fee:"$73IN/$83OUT",nonresident_fee:"$76IN/$86OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Corporate",resident_fee:"$65IN/$65OUT",nonresident_fee:"$68IN/$68OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Corporate B",resident_fee:"$60IN/$60OUT",nonresident_fee:"$63IN/$63OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Corporate Special (EMERG PERS)",resident_fee:"$44IN/$44OUT",nonresident_fee:"$47IN/$47OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Senior",resident_fee:"$55IN/$65OUT",nonresident_fee:"$58IN/$68OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Military/Veteran",resident_fee:"$44IN/$44OUT",nonresident_fee:"$47IN/$47OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Annual Adult",resident_fee:"$876IN/$996OUT",nonresident_fee:"$912IN/$1032OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Annual Add-On",resident_fee:"$528 IN/OUT",nonresident_fee:"$564 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Annual Senior",resident_fee:"$660IN/$780OUT",nonresident_fee:"$696IN/$816OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Annual Corporate",resident_fee:"$780 IN/OUT",nonresident_fee:"$816 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Annual Corporate B",resident_fee:"$720 IN/OUT",nonresident_fee:"$756 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Annual Military/Veteran",resident_fee:"$528 IN/OUT",nonresident_fee:"$564 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Reinrollment Fee",resident_fee:"$100 IN/OUT",nonresident_fee:"$100 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"10 Day Student Pass",resident_fee:"$20 IN/OUT",nonresident_fee:"$30 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"30 Day Student Pass",resident_fee:"$40 IN/OUT",nonresident_fee:"$50 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"100 Day Student Pass",resident_fee:"$100 IN/OUT",nonresident_fee:"$150 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"10 Day Family of Member Pass",resident_fee:"$29 IN/OUT",nonresident_fee:"$32 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"1 Month Family of Member Pass",resident_fee:"$59 IN/OUT",nonresident_fee:"$62 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"1 Month Adult",resident_fee:"$95 IN/OUT",nonresident_fee:"$98 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"1 Month Senior",resident_fee:"$75 IN/OUT",nonresident_fee:"$78 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"1 Week Adult Guest",resident_fee:"$50 IN/OUT",nonresident_fee:"$53 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"2 Week Adult Guest",resident_fee:"$75 IN/OUT",nonresident_fee:"$78 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"3 Week Adult Guest",resident_fee:"$85 IN/OUT",nonresident_fee:"$88 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"1 Day Guest",resident_fee:"$15 IN/OUT",nonresident_fee:"$18 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"1 Day Corp",resident_fee:"$7 IN/OUT",nonresident_fee:"$10 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Flex Pass 12 Visits",resident_fee:"$150 IN/OUT",nonresident_fee:"$180 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Starter Pack 5-Half Hour Sessions",resident_fee:"$135M/$185NM",nonresident_fee:"$175M/$225NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Single Session Half Hour Rate",resident_fee:"$37M/$47NM",nonresident_fee:"$40M/$50NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"5 Pack",resident_fee:"$176 M/$223NM",nonresident_fee:"$190M/$228NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"10 Pack",resident_fee:"$333 M/$423NM",nonresident_fee:"$360 M/$450NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"15 Pack",resident_fee:"$472 M/$599NM",nonresident_fee:"$510M/$638NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"20 Pack",resident_fee:"$592M/$752NM",nonresident_fee:"$640M/$800NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Buddy Half Hour Rate",resident_fee:"$27M/$37NM",nonresident_fee:"$30M/$40NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"5 Pack",resident_fee:"$128M/ $176NM",nonresident_fee:"$143M/ $190NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"10 Pack",resident_fee:"$243M/$333NM",nonresident_fee:"$270M/$360NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"15 Pack",resident_fee:"$344M/$472NM",nonresident_fee:"$383M/$510NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"20 Pack",resident_fee:"$432M/$592NM",nonresident_fee:"$480M/$640NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Single Session Hour Rate",resident_fee:"$65 M/$75 NM",nonresident_fee:"$68 M/$78 NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"5 Pack",resident_fee:"$309 M/$356 NM",nonresident_fee:"$323 M/$371 NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"10 Pack",resident_fee:"$585 M/$675 NM",nonresident_fee:"$612 M/$702 NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"15 Pack",resident_fee:"$829 M/ $956NM",nonresident_fee:"$867 M/ $995NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"20 Pack",resident_fee:"$1040M/ $1200NM",nonresident_fee:"$1088M/ $1248NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Buddy Hour Rate",resident_fee:"$45M/$55NM",nonresident_fee:"$48M/$58NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"5 Pack",resident_fee:"$214M/$261NM",nonresident_fee:"$228M/$276NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"10 Pack",resident_fee:"$405M/$495NM",nonresident_fee:"$43M/$522NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"15 Pack",resident_fee:"$574M/$701NM",nonresident_fee:"$612M/$740NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"20 Pack",resident_fee:"$720M/$880NM",nonresident_fee:"$768M/$928NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Stretch Single Session",resident_fee:"$20M/$25NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"5 Pack Stretch",resident_fee:"$95M/$119NM",nonresident_fee:"$95M/$119NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 3 Day Monthly Membership USSA",resident_fee:"N/A",nonresident_fee:"$270 IN/$290 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 3 Day Add-on Monthly Membership USSA",resident_fee:"N/A",nonresident_fee:"$230 IN/$247 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 2 Day Monthly Membership USSA",resident_fee:"N/A",nonresident_fee:"$250 IN/$270 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 2 Day Add-on Monthly Membership USSA",resident_fee:"N/A",nonresident_fee:"$213 IN/$230 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 1 Day Monthly Membership USSA",resident_fee:"N/A",nonresident_fee:"$160 IN/$180 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 1 Day Add-on Monthly USSA",resident_fee:"N/A",nonresident_fee:"$136 IN/$153 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing Starter Pack 5/2 USSA",resident_fee:"N/A",nonresident_fee:"$250 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 1/2 hour - 1",resident_fee:"$56 IN/OUT",nonresident_fee:"$56 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 1/2 hour - 5 pack",resident_fee:"$260 IN/OUT",nonresident_fee:"$260 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 1/2 hour - 10 pack",resident_fee:"$510 IN/OUT",nonresident_fee:"$510 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing 1/2 hour - 15 pack",resident_fee:"$750 IN/OUT",nonresident_fee:"$750 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Open Fencing USSA",resident_fee:"50.0",nonresident_fee:"$25 IN/$35 OUT",contractual:true,notes:"The price was incorrectly inputted last year.",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Drop-in Fencing USSA",resident_fee:"65.0",nonresident_fee:"50.0",contractual:true,notes:"The price was incorrectly inputted last year.",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing Monthly Adult IFC",resident_fee:"N/A",nonresident_fee:"$30 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fencing Group Class IFC",resident_fee:"$28 IN/ $33 OUT",nonresident_fee:"$28 IN/$32 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Drop-in Fencing Adult  IFC",resident_fee:"15.0",nonresident_fee:"15.0",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Group Reformer Class",resident_fee:"$26M/$32NM",nonresident_fee:"$30M/$35",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Starter Pack  4- One Hour Sessions",resident_fee:"$200M/$250NM",nonresident_fee:"$230M/$270NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Single Sessions",resident_fee:"$67M/$77NM",nonresident_fee:"$70M/$80NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Hour 5 Pack",resident_fee:"$318M/$366NM",nonresident_fee:"$333M/$380NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Hour 10 Pack",resident_fee:"$603M/$693NM",nonresident_fee:"$630M/$720NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Hour 15 pack",resident_fee:"$855M/$982NM",nonresident_fee:"$893M/$1020NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Hour 20 Pack",resident_fee:"$1072M/$1232NM",nonresident_fee:"$1120M/$1280NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Duet Hour Single Session",resident_fee:"$47M/$57NM",nonresident_fee:"$50M/$60NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Duet 5 Pack",resident_fee:"$225M/$271NM",nonresident_fee:"$238M/$285NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Duet 10 Pack",resident_fee:"$423M/$513NM",nonresident_fee:"$450M/$540NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Duet 15 Pack",resident_fee:"$600M/$727NM",nonresident_fee:"$638M/$765NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Duet 20 Pack",resident_fee:"$752M/$912NM",nonresident_fee:"$800M/$960NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Aqua Arthritis",resident_fee:"$10M/$13NM",nonresident_fee:"$12M/$15NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Choose To Lose,Spring Fit, Beach Body",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Stress Management",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Team Fit & Strong",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Group Weight Lifting",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"TRX Core Training",resident_fee:"$10M/$13NM",nonresident_fee:"$12M/$15NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Youth Boxing",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Strong Girls",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Youth Fitness",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Teen Boxing",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Swim for Fitness",resident_fee:"$18 M/$20 NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Evolution Basketball Training Camp",resident_fee:"$500 IN/$600 OUT",nonresident_fee:"$160 IN/$180 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Single Session 45 minutes",resident_fee:"$95M/$110NM",nonresident_fee:"$95M/$110NM",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Starter Pack 6 -  45 minute sessions",resident_fee:"$510M/$510NM",nonresident_fee:"$510M/$510NM",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"8 Pack 45 minutes",resident_fee:"$720M/$800NM",nonresident_fee:"$720M/$800NM",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"10 Pack 45 minutes",resident_fee:"$900M/$1000NM",nonresident_fee:"$900M/$1000NM",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"12 Pack 45 minutes",resident_fee:"$1080M/$1200NM",nonresident_fee:"$1080M/$1200NM",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Forever Fit",resident_fee:"7.0",nonresident_fee:"8.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Hatha Yoga",resident_fee:"12.0",nonresident_fee:"16.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Zumba",resident_fee:"$70-$175",nonresident_fee:"$120/$150",contractual:true,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Junior Golf Level 1",resident_fee:"$140In/$175Out",nonresident_fee:"$160In/$200Out",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Junior Golf Level 2",resident_fee:"$140In/$175Out",nonresident_fee:"$160In/$200Out",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Level 1",resident_fee:"$140In/$175Out",nonresident_fee:"$160In/$200Out",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Adult Level 2",resident_fee:"$140In/$175Out",nonresident_fee:"$160In/$200Out",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"5 Hour Pass",resident_fee:"$95in Nov/$105ROS",nonresident_fee:"$100in Nov/$110 ROS",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Season Pass",resident_fee:"700.0",nonresident_fee:"725.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"30 Min Tee Admission (weekday before 6pm)",resident_fee:"13.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"30 Min Tee Admission (weekends)",resident_fee:"14.0",nonresident_fee:"15.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"30 Min Tee Admission (Senior rate)",resident_fee:"11.0",nonresident_fee:"12.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"30 Min Tee Admission (Student rate)",resident_fee:"12.0",nonresident_fee:"13.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Golf Pro Lessons",resident_fee:"$13Wkdy/$14Wknd",nonresident_fee:"$14Wkdy/$15Wknd",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Alcott Small Room (Monday - Thursday)",resident_fee:"$40 in/$60 out",nonresident_fee:"$40 in/$60 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Alcott Large Room (Monday - Thursday)",resident_fee:"$60 in/$90 out",nonresident_fee:"$85 in/$130 out",contractual:false,notes:"Adjusted to match CAC rates",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Alcott Small Room (Friday - Sunday)",resident_fee:"$50 in/$75 out",nonresident_fee:"$50 in/$75 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Alcott Large Room (Friday - Sunday)",resident_fee:"$80 in/$120 out",nonresident_fee:"$110 in/$165 out",contractual:false,notes:"Adjusted to match CAC rates",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Rooms 6, 7 (Monday - Thursday)",resident_fee:"$40 in/ $60 out",nonresident_fee:"$40 in/ $60 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Rooms 19, 21 (Monday - Thursday)",resident_fee:"$75 in/ $115 out",nonresident_fee:"$85 in/ $130 out",contractual:false,notes:"Adjusted to align with rooms of the same size",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Room 20 (Monday - Thursday)",resident_fee:"$85 in/ $130 out",nonresident_fee:"$95 in/ $140 out",contractual:false,notes:"Increased because of size",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Full MPR (20 & 21) (Monday - Thursday)",resident_fee:"$100 in/ $150 out",nonresident_fee:"$125 in/ $180 out",contractual:false,notes:"Increased because of size",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Theater (Monday - Thursday)",resident_fee:"$125 in/ $190 out",nonresident_fee:"$125 in/ $190 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Rooms 6, 7 (Friday - Sunday)",resident_fee:"$50 in/ $75 out",nonresident_fee:"$50 in/ $75 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Rooms 19, 21 (Friday - Sunday)",resident_fee:"$95 in/ $145 out",nonresident_fee:"$110 in/ $165 out",contractual:false,notes:"Increased because of size",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Room 20 (Friday - Sunday)",resident_fee:"$110 in/ $165 out",nonresident_fee:"$120 in/ $175 out",contractual:false,notes:"Increased by $10 since it's a larger space than 19 or 20",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Full MPR (20 & 21) (Friday - Sunday)",resident_fee:"$125 in/ $190 out",nonresident_fee:"$150 in/ $215 out",contractual:false,notes:"Increased because of size",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"CAC Theater (Friday - Sunday)",resident_fee:"$155 in/ $235 out",nonresident_fee:"$155 in/ $235 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Scout Badge Day",resident_fee:"10.0",nonresident_fee:"$5/$10",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Camp in a bag - I",resident_fee:"25.0",nonresident_fee:"N/A",contractual:false,notes:"Program cancelled",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"School Educational Programs",resident_fee:"$25/$30",nonresident_fee:"$50$65",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Thanksgiving Class",resident_fee:"10.0",nonresident_fee:"12.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Love, Murder, Science",resident_fee:"5.0",nonresident_fee:"5.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Mom and Me Tea",resident_fee:"30.0",nonresident_fee:"30.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Puzzle Palooza",resident_fee:"40.0",nonresident_fee:"40.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Wedding Dress Workshop",resident_fee:"65.0",nonresident_fee:"65.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Scout Programs",resident_fee:"$5/$10",nonresident_fee:"$5/$10",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Nature Classroom Birthday Party",resident_fee:"300.0",nonresident_fee:"300.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fields",resident_fee:"$40/hr",nonresident_fee:"$50/$75/hr",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Parking Lots",resident_fee:"$100/day",nonresident_fee:"$100/day",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Shelters Monday - Friday (Public and Nonprofits)",resident_fee:"$40/ $60",nonresident_fee:"$40/ $60",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Shelters Saturday - Sunday (Public and Nonprofits)",resident_fee:"$60/ $90",nonresident_fee:"$60/ $90",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Shelters Monday - Friday (Corporations)",resident_fee:"$70/$105",nonresident_fee:"N/A",contractual:false,notes:"Not offereing",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Shelters Saturday - Sunday (Corportations)",resident_fee:"$90/$135",nonresident_fee:"N/A",contractual:false,notes:"Not offereing",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Special Events",resident_fee:"$100 - $2500",nonresident_fee:"$100 - $2500",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Amphitheater Pavilion Monday-Friday",resident_fee:"$100/$150",nonresident_fee:"$150/$225",contractual:false,notes:"Increased because of size",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Amphitheater Pavilion Saturday-Sunday",resident_fee:"$150/ $225",nonresident_fee:"$200/$300",contractual:false,notes:"Increased because of size",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Sport Courts",resident_fee:"$10/$13",nonresident_fee:"$10/$15/hour",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Commercial Rentals Monday-Thursday. 1 day package",resident_fee:"$1,150 in/ $1,725 out",nonresident_fee:"$1,150 in/ $1,725 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Commercial Rentals Monday-Thursday. 2 day package",resident_fee:"$2,100 in/ $3,150 out",nonresident_fee:"$2,100 in/ $3,150 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Commercial Rentals Monday-Thursday. 3 day package",resident_fee:"$3,000 in/ $4,500 out",nonresident_fee:"$3,000 in/ $4,500 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Commercial Rentals Friday-Sunday. 1 day package",resident_fee:"$1,300 in/ $2,100 out",nonresident_fee:"$1,300 in/ $2,100 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Commercial Rentals Friday-Sunday. 2 day package",resident_fee:"$2,350 in/$3,525 out",nonresident_fee:"$2,350 in/$3,525 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Commercial Rentals Friday-Sunday. 3 day package",resident_fee:"$3,250 in/ $4,875 out",nonresident_fee:"$3,250 in/ $4,875 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Private Rentals Monday-Thursday",resident_fee:"$300 in/ $450 out",nonresident_fee:"$300 in/ $450 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Private Rentals Friday-Sunday",resident_fee:"$500 in/$750 out",nonresident_fee:"$500 in/$750 out",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fall Young Children's Theater",resident_fee:"350.0",nonresident_fee:"$400/$500",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fall Children's Theater",resident_fee:"400.0",nonresident_fee:"$400/$500",contractual:false,notes:"SR & Added out-of-district rates",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Winter Teen Theater",resident_fee:"400.0",nonresident_fee:"$400/$500",contractual:false,notes:"SR & Added out-of-district rates",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Spring Kids Theater",resident_fee:"400.0",nonresident_fee:"$400/$500",contractual:false,notes:"SR & Added out-of-district rates",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Summer Musical",resident_fee:"25.0",nonresident_fee:"N/A",contractual:false,notes:"Eliminating registration fee",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Workshop Series",resident_fee:"25.0",nonresident_fee:"25.0",contractual:false,notes:"SR",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Acting Studio",resident_fee:"$12.40-$13",nonresident_fee:"$12.50-$14 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Advanced Theatre Co.",resident_fee:"$15-$18 per class",nonresident_fee:"$15-$18 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Piano Instruction",resident_fee:"380.0",nonresident_fee:"$380/$475",contractual:false,notes:"SR & Added out-of-district rates",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Special Recreation Theater: Broadway Buddies",resident_fee:"$20 per class",nonresident_fee:"$20 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"BG Singers",resident_fee:"230.0",nonresident_fee:"230.0",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dance Company Minis",resident_fee:"$14 per class",nonresident_fee:"$14 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dance Company Duets/Trios",resident_fee:"$16 per class",nonresident_fee:"$18 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dance Company Choreography Classes",resident_fee:"$11 per class",nonresident_fee:"$12 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dance Company Solos",resident_fee:"$28 per class",nonresident_fee:"$30 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dance - 30 minute classes",resident_fee:"$11 per class",nonresident_fee:"$11 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dance - 45 minute classes",resident_fee:"$12 per class",nonresident_fee:"$13 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Dance - 60 minute classes",resident_fee:"$13 per class",nonresident_fee:"$15 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Winter Dance Production",resident_fee:"325.0",nonresident_fee:"$350/$440",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Baby Brushstrokes",resident_fee:"$15/$19",nonresident_fee:"$15-$20",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Art Together: Family & Friends Art Night",resident_fee:"$15/$19",nonresident_fee:"$15-$20",contractual:false,notes:"",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Mixed Media",resident_fee:"$165/$205",nonresident_fee:"$15 per class",contractual:false,notes:"Adjusting display to per class fee",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Art Club",resident_fee:"$180/$225",nonresident_fee:"$15 per class",contractual:false,notes:"Adjusting display to per class fee",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Beginning Sewing",resident_fee:"$180/$225",nonresident_fee:"$25 per class",contractual:true,notes:"Adjusting display to per class fee",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Fashion Design & Intermediate Sewing",resident_fee:"$180/$225",nonresident_fee:"$25 per class",contractual:true,notes:"Adjusting display to per class fee",is_archived:false},
  {fy:"2026-2027",area:"Other",program_name:"Bingo Luncheon",resident_fee:"7.0",nonresident_fee:"7.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Dog Park Passes - Annual",resident_fee:"$25/$31",nonresident_fee:"$25/$31",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Dog Park Passes - Late Season",resident_fee:"$15/$19",nonresident_fee:"$15/$19",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Dog Park Passes - Daily",resident_fee:"8.0",nonresident_fee:"8.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Drawing & Painting",resident_fee:"$85/$105",nonresident_fee:"$91/$114",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Mah Jongg Tournament",resident_fee:"20.0",nonresident_fee:"25.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Puppy/Dog Socializing & Obedience",resident_fee:"$100/$125",nonresident_fee:"",contractual:true,notes:"No longer running",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult Basketball - Open Gym",resident_fee:"5.0",nonresident_fee:"$6 Per Class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult Fall Softball",resident_fee:"700.0",nonresident_fee:"750.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Pickleball Clinics",resident_fee:"20.0",nonresident_fee:"$75 Per Class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult Pickleball",resident_fee:"5.0",nonresident_fee:"$6 Per Class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult Summer Softball Competitive",resident_fee:"700.0",nonresident_fee:"750.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult Summer Softball Recreational",resident_fee:"650.0",nonresident_fee:"750.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult Volleyball",resident_fee:"6.0",nonresident_fee:"$6 Per Class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Fall Adult Karate",resident_fee:"$13 - $16.50 per class",nonresident_fee:"$15 - $19",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Spring Adult Karate",resident_fee:"$13 - $16.50 per class",nonresident_fee:"$15 - $19",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Summer Adult Karate",resident_fee:"$13 - $16.50 per class",nonresident_fee:"$15 - $19",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Winter Adult Karate",resident_fee:"$13 - $16.50 per class",nonresident_fee:"$15 - $19",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"All Ages - Fall/Winter",resident_fee:"360.0",nonresident_fee:"380.0",contractual:false,notes:"Increased fees for high school use",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"All Ages - Summer",resident_fee:"185.0",nonresident_fee:"205.0",contractual:false,notes:"Increased fees for high school use",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"8 & Under - Fall/Winter",resident_fee:"440.0",nonresident_fee:"490.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"9-10, 11-12, 13-14, 15 and older - Fall/Winter",resident_fee:"525.0",nonresident_fee:"565.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"8 & Under - Summer",resident_fee:"340.0",nonresident_fee:"380.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"9-10, 11-12, 13-14, 15 and older - Summer",resident_fee:"425.0",nonresident_fee:"465.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Swim Team Tryouts",resident_fee:"10.0",nonresident_fee:"10.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Per session (8 - 30 min.) Tadpoles Swim Classes",resident_fee:"$102/$127",nonresident_fee:"$111/$139",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Per session (8 - 30 min.) Water Babies",resident_fee:"$61/$75",nonresident_fee:"$70/$88",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Per session (8 - 30 min.) Water Tots",resident_fee:"$74/$92",nonresident_fee:"$83/$104",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Per session (8 - 30 min.) Group Swim Classes",resident_fee:"$90/$112",nonresident_fee:"$99/$124",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Per session (10 - 60 min.) Swim Team Prep",resident_fee:"$152/$189",nonresident_fee:"$166/$207",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Private Lessons Fee (8 lessons)",resident_fee:"208.0",nonresident_fee:"250.0",contractual:false,notes:"Increased 20% to get to the 30% profit margin for programs  CB 2/11/25",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Hurricanes Private Lessons (30 min lessons)",resident_fee:"$35/lesson",nonresident_fee:"42.0",contractual:false,notes:"Increased 20% to get to the 30% profit margin for programs  CB 2/11/25",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Member Priority Private Lessons (8 lessons) (Members)",resident_fee:"175.0",nonresident_fee:"210.0",contractual:false,notes:"Increased 20% to get to the 30% profit margin for programs  CB 2/11/25",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Member Priority Private Lessons (8 lessons) (Non-Member Residents)",resident_fee:"208.0",nonresident_fee:"250.0",contractual:false,notes:"Increased 20% to get to the 30% profit margin for programs  CB 2/11/25",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Member Priority Private Lessons (8 lessons) (Non-Member Non-Res)",resident_fee:"260.0",nonresident_fee:"313.0",contractual:false,notes:"Increased 20% to get to the 30% profit margin for programs  CB 2/11/25",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Lifeguard (New)",resident_fee:"75.0",nonresident_fee:"85.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Lifeguard (Recertification)",resident_fee:"75.0",nonresident_fee:"NA",contractual:false,notes:"Not a public program, remove",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Lifeguard (Trainer)",resident_fee:"200.0",nonresident_fee:"NA",contractual:false,notes:"Not a public program, remove",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"12 months and under",resident_fee:"NA",nonresident_fee:"Free",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Children and Adults",resident_fee:"NA",nonresident_fee:"5.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Seniors",resident_fee:"NA",nonresident_fee:"3.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Twilight Time",resident_fee:"NA",nonresident_fee:"3.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"With Current Pool Pass",resident_fee:"NA",nonresident_fee:"4.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Splasher Pass",resident_fee:"NA",nonresident_fee:"80.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Party Deck Rental",resident_fee:"NA",nonresident_fee:"$175 / $215",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Ultimate (Private) Rental (Full Facility Rental)",resident_fee:"NA",nonresident_fee:"$440 / $540",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Mini Splash Bash (Semi Private - Max 50) Rental",resident_fee:"NA",nonresident_fee:"$245 / $307",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Splash Bash (Semi Private - Max 65) Rental",resident_fee:"NA",nonresident_fee:"$215 / $269",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Lap Swim",resident_fee:"7.0",nonresident_fee:"8.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Open Swim",resident_fee:"7.0",nonresident_fee:"8.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Senior Rate",resident_fee:"5.0",nonresident_fee:"5.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Twilight Time Public/Senior",resident_fee:"$5/$4",nonresident_fee:"5.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Pool Punch Pass",resident_fee:"$100/$125",nonresident_fee:"$120/$150",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Individual",resident_fee:"$125/$156",nonresident_fee:"$125/$156",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Family of 2",resident_fee:"$140/$174",nonresident_fee:"$140/$174",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Family of 3",resident_fee:"$155/$192",nonresident_fee:"$155/$192",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Family of 4",resident_fee:"$170/$210",nonresident_fee:"$170/$210",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Family of 5",resident_fee:"$185/$228",nonresident_fee:"$185/$228",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Family of 6",resident_fee:"$200/$246",nonresident_fee:"$200/$246",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 102 - Pritchett, Tripp - AM",resident_fee:"12.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 102 - Pritchett, Tripp - PM",resident_fee:"15.0",nonresident_fee:"18.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 102 - Meridian - AM",resident_fee:"6.0",nonresident_fee:"7.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 102 - Meridian - PM",resident_fee:"21.0",nonresident_fee:"24.5",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 21 - Kilmer, Longfellow - AM",resident_fee:"12.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 21 - Kilmer, Longfellow - PM",resident_fee:"15.0",nonresident_fee:"17.5",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 96  - Ivy, Kld, Pra, Ctry Meadows - AM",resident_fee:"8.0",nonresident_fee:"8.75",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 96  - Ivy, Kld, Pra, Ctry Meadows - PM",resident_fee:"18.0",nonresident_fee:"21.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 96  - Willow Grove - AM",resident_fee:"11.0",nonresident_fee:"13.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"District 96  - Willow Grove - PM",resident_fee:"18.0",nonresident_fee:"21.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"One Day Field Trip (Clubhouse Participant)",resident_fee:"50.0",nonresident_fee:"60.0",contractual:false,notes:"raised to help cover cost of supplies/field trips",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Field Trip Only (Attends field trips but not a Clubhouse participant)",resident_fee:"60.0",nonresident_fee:"70.0",contractual:false,notes:"raised to help cover cost of supplies/field trips",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Birthday Parties",resident_fee:"$275/$375",nonresident_fee:"$345 in/ $430 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Two Year Old Preschool- 2 days",resident_fee:"17.0",nonresident_fee:"19.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Two Year Old Preschool- 3 days",resident_fee:"17.0",nonresident_fee:"19.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Pre Threes Preschool- 2 days",resident_fee:"22.0",nonresident_fee:"24.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Pre Threes Preschool- 3 days",resident_fee:"22.0",nonresident_fee:"24.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Three Year Old Preschool- 2 days",resident_fee:"34.61",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Three Year Old Preschool- 3 days",resident_fee:"33.0",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Three Year Old Preschool- 5 days",resident_fee:"33.0",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Four Year Old Preschool- 2 days",resident_fee:"34.61",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Four Year Old Preschool- 3 days",resident_fee:"33.0",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Four Year Old Preschool- 5 days",resident_fee:"33.0",nonresident_fee:"35.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Alphabet Mystery Party",resident_fee:"11.0",nonresident_fee:"13.0",contractual:false,notes:"Increased staffing cost",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Hands on Art",resident_fee:"14.0",nonresident_fee:"29.0",contractual:true,notes:"Only running Friday Fun Class. Increased cost",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Nature Safari",resident_fee:"11.0",nonresident_fee:"19.5",contractual:false,notes:"Increase in base cost $11-S13.Cost from previous year didn't reflect length of class. Should be 1.5 hour class.",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Stories Come Alive",resident_fee:"11.0",nonresident_fee:"20.0",contractual:false,notes:"Increase in base cost $11-S13.Cost from previous year didn't reflect length of class. Should be 1.5 hour class.",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Kid Rock",resident_fee:"12.25",nonresident_fee:"13.0",contractual:true,notes:"Contractual increase",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Friendship Cafe'",resident_fee:"11.0",nonresident_fee:"13.0",contractual:false,notes:"Increased staffing cost",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Number Ninjas",resident_fee:"11.0",nonresident_fee:"13.0",contractual:false,notes:"Increased staffing cost",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Ooey Gooey Science and Exploration",resident_fee:"11.0",nonresident_fee:"13.0",contractual:false,notes:"Increased staffing cost",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Add-On",resident_fee:"$44IN/$44OUT",nonresident_fee:"$44IN/$44OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult",resident_fee:"$73IN/$83OUT",nonresident_fee:"$73IN/$83OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Corporate",resident_fee:"$65IN/$65OUT",nonresident_fee:"$65IN/$65OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Corporate B",resident_fee:"$60IN/$60OUT",nonresident_fee:"$60IN/$60OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Corporate Special (EMERG PERS)",resident_fee:"$44IN/$44OUT",nonresident_fee:"$44IN/$44OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Senior",resident_fee:"$55IN/$65OUT",nonresident_fee:"$55IN/$65OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Military/Veteran",resident_fee:"$44IN/$44OUT",nonresident_fee:"$44IN/$44OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Annual Adult",resident_fee:"$876IN/$996OUT",nonresident_fee:"$876IN/$996OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Annual Add-On",resident_fee:"$528 IN/OUT",nonresident_fee:"$528 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Annual Senior",resident_fee:"$660IN/$780OUT",nonresident_fee:"$660IN/$780OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Annual Corporate",resident_fee:"$780 IN/OUT",nonresident_fee:"$780 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Annual Corporate B",resident_fee:"$720 IN/OUT",nonresident_fee:"$720 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Annual Military/Veteran",resident_fee:"$528 IN/OUT",nonresident_fee:"$528 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Reinrollment Fee",resident_fee:"$100 IN/OUT",nonresident_fee:"$100 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"10 Day Student Pass",resident_fee:"$20 IN/OUT",nonresident_fee:"$20 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"30 Day Student Pass",resident_fee:"$40 IN/OUT",nonresident_fee:"$40 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"100 Day Student Pass",resident_fee:"$100 IN/OUT",nonresident_fee:"$100 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"10 Day Family of Member Pass",resident_fee:"$29 IN/OUT",nonresident_fee:"$29 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"1 Month Family of Member Pass",resident_fee:"$59 IN/OUT",nonresident_fee:"$59 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"1 Month Adult",resident_fee:"$95 IN/OUT",nonresident_fee:"$95 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"1 Month Senior",resident_fee:"$75 IN/OUT",nonresident_fee:"$75 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"1 Week Adult Guest",resident_fee:"$50 IN/OUT",nonresident_fee:"$50 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"2 Week Adult Guest",resident_fee:"$75 IN/OUT",nonresident_fee:"$75 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"3 Week Adult Guest",resident_fee:"$85 IN/OUT",nonresident_fee:"$85 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"1 Day Guest",resident_fee:"$15 IN/OUT",nonresident_fee:"$15 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"1 Day Corp",resident_fee:"$7 IN/OUT",nonresident_fee:"$7 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Flex Pass 12 Visits",resident_fee:"$150 IN/OUT",nonresident_fee:"$150 IN/OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Specialty Programs Small Group Training",resident_fee:"$18M/$22NM",nonresident_fee:"$18M/$22NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Aqua Arthritis",resident_fee:"$10M/$13NM",nonresident_fee:"$10M/$13NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Starter Pack 5-Half Hour Sessions",resident_fee:"$135M/$185NM",nonresident_fee:"$135M/$185NM",contractual:false,notes:"One Time Purchase",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Single Session Half Hour Rate",resident_fee:"$37M/$47NM",nonresident_fee:"$37M/$47NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"5 Pack",resident_fee:"$176 M/$223NM",nonresident_fee:"$176 M/$223NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"10 Pack",resident_fee:"$333 M/$423NM",nonresident_fee:"$333 M/$423NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"15 Pack",resident_fee:"$472 M/$599NM",nonresident_fee:"$472 M/$599NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"20 Pack",resident_fee:"$592M/$752NM",nonresident_fee:"$592M/$752NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Buddy Half Hour Rate",resident_fee:"$27M/$37NM",nonresident_fee:"$27M/$37NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"5 Pack",resident_fee:"$128M/ $176NM",nonresident_fee:"$128M/ $176NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"10 Pack",resident_fee:"$243M/$333NM",nonresident_fee:"$243M/$333NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"15 Pack",resident_fee:"$344M/$472NM",nonresident_fee:"$344M/$472NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"20 Pack",resident_fee:"$432M/$592NM",nonresident_fee:"$432M/$592NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Single Session Hour Rate",resident_fee:"$65 M/$75 NM",nonresident_fee:"$65 M/$75 NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"5 Pack",resident_fee:"$309 M/$356 NM",nonresident_fee:"$309 M/$356 NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"10 Pack",resident_fee:"$585 M/$675 NM",nonresident_fee:"$585 M/$675 NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"15 Pack",resident_fee:"$829 M/ $956NM",nonresident_fee:"$829 M/ $956NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"20 Pack",resident_fee:"$1040M/ $1200NM",nonresident_fee:"$1040M/ $1200NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Buddy Hour Rate",resident_fee:"$45M/$55NM",nonresident_fee:"$45M/$55NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"5 Pack",resident_fee:"$214M/$261NM",nonresident_fee:"$214M/$261NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"10 Pack",resident_fee:"$405M/$495NM",nonresident_fee:"$405M/$495NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"15 Pack",resident_fee:"$574M/$701NM",nonresident_fee:"$574M/$701NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"20 Pack",resident_fee:"$720M/$880NM",nonresident_fee:"$720M/$880NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Stretch Single Session",resident_fee:"$20M/$25NM",nonresident_fee:"$20M/$25NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"5 Pack",resident_fee:"$95M/$119NM",nonresident_fee:"$95M/$119NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Youth Programs Small Group Training",resident_fee:"$18IN/$22OUT",nonresident_fee:"$18IN/$22OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Fencing 1/2 hour - 1",resident_fee:"$56 IN/OUT",nonresident_fee:"$56 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Fencing 1/2 hour - 5 pack",resident_fee:"$260 IN/OUT",nonresident_fee:"$260 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Fencing 1/2 hour - 10 pack",resident_fee:"$510 IN/OUT",nonresident_fee:"$510 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Fencing 1/2 hour - 15 pack",resident_fee:"$750 IN/OUT",nonresident_fee:"$750 IN/OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Fencing Group Class",resident_fee:"$28 IN/ $33 OUT",nonresident_fee:"$28 IN/ $33 OUT",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Open Fencing",resident_fee:"50.0",nonresident_fee:"50.0",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Drop-in Fencing",resident_fee:"65.0",nonresident_fee:"65.0",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Fencing High School Students",resident_fee:"15.0",nonresident_fee:"15.0",contractual:true,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Group Reformer Class",resident_fee:"$25M/$31NM",nonresident_fee:"$26M/$32NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Starter Pack  4- One Hour Sessions",resident_fee:"$200M/$250NM",nonresident_fee:"$200M/$250NM",contractual:false,notes:"One time purchase",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Single Sessions",resident_fee:"$67M/$77NM",nonresident_fee:"$67M/$77NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Hour 5 Pack",resident_fee:"$318M/$366NM",nonresident_fee:"$318M/$366NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Hour 10 Pack",resident_fee:"$603M/$693NM",nonresident_fee:"$603M/$693NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Hour 15 pack",resident_fee:"$855M/$982NM",nonresident_fee:"$855M/$982NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Hour 20 Pack",resident_fee:"$1072M/$1232NM",nonresident_fee:"$1072M/$1232NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Duet Hour Single Session",resident_fee:"$47M/$57NM",nonresident_fee:"$47M/$57NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Duet 5 Pack",resident_fee:"$225M/$271NM",nonresident_fee:"$225M/$271NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Duet 10 Pack",resident_fee:"$423M/$513NM",nonresident_fee:"$423M/$513NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Duet 15 Pack",resident_fee:"$600M/$727NM",nonresident_fee:"$600M/$727NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Duet 20 Pack",resident_fee:"$752M/$912NM",nonresident_fee:"$752M/$912NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Choose To Lose,Spring Fit, Beach Body",resident_fee:"$90 M/$110 NM",nonresident_fee:"$90M/$110NM",contractual:false,notes:"No change in fee - Running program at minimum enrollment required to run.",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"TRX Core Training",resident_fee:"$80 M/$104 NM",nonresident_fee:"$80M/$104NM",contractual:false,notes:"No change in fee - Running program at minimum enrollment required to run.",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Youth Boxing",resident_fee:"$171 IN/$207 OUT",nonresident_fee:"$171 IN/$207 OUT",contractual:false,notes:"No change in fee - Running program at minimum enrollment required to run.",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Youth Fitness",resident_fee:"$171 IN/$207 OUT",nonresident_fee:"$171 IN/$207 OUT",contractual:false,notes:"No change in fee - Running program at minimum enrollment required to run.",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Teen Boxing",resident_fee:"$144 IN/$184 OUT",nonresident_fee:"",contractual:false,notes:"Cancelled",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Swim for Fitness",resident_fee:"$108 M/$132 NM",nonresident_fee:"$108 M/$132 NM",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Evolution Basketball Training Camp",resident_fee:"$500 IN/$600 ID",nonresident_fee:"$500 IN/$600 ID",contractual:true,notes:"New program that started in November 24 - February 25",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Forever Fit",resident_fee:"6.0",nonresident_fee:"7.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Hatha Yoga",resident_fee:"11.0",nonresident_fee:"12.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Zumba",resident_fee:"$70-$175",nonresident_fee:"$70-$175",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Junior Golf Level 1",resident_fee:"$135In/$169Out",nonresident_fee:"$140In/$175Out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Junior Golf Level 2",resident_fee:"$135In/$169Out",nonresident_fee:"$140In/$175Out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult Level 1",resident_fee:"$135In/$169Out",nonresident_fee:"$140In/$175Out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Adult Level 2",resident_fee:"$135In/$169Out",nonresident_fee:"$140In/$175Out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"5 Hour Pass",resident_fee:"$95-$104",nonresident_fee:"$95in Nov/$105ROS",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Season Pass",resident_fee:"700.0",nonresident_fee:"700.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"30 Min Tee Admission (weekday before 6pm)",resident_fee:"13.0",nonresident_fee:"13.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"30 Min Tee Admission (weekends)",resident_fee:"14.0",nonresident_fee:"14.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"30 Min Tee Admission (Senior rate)",resident_fee:"11.0",nonresident_fee:"11.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"30 Min Tee Admission (Student rate)",resident_fee:"12.0",nonresident_fee:"12.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Golf Pro Lessons",resident_fee:"$13/$13",nonresident_fee:"$13Wkdy/$14Wknd",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Alcott Small Room (Monday - Thursday)",resident_fee:"$40/hr",nonresident_fee:"$40 in/$60 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Alcott Large Room (Monday - Thursday)",resident_fee:"$60/hr",nonresident_fee:"$60 in/$90 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Alcott Small Room (Friday - Sunday)",resident_fee:"$50/hr",nonresident_fee:"$50 in/$75 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Alcott Large Room (Friday - Sunday)",resident_fee:"$80/hr",nonresident_fee:"$80 in/$120 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Rooms 6, 7 (Monday - Thursday)",resident_fee:"$40/hr",nonresident_fee:"$40 in/ $60 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Rooms 19, 21 (Monday - Thursday)",resident_fee:"$75/hr",nonresident_fee:"$75 in/ $115 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Room 20 (Monday - Thursday)",resident_fee:"$85/hr",nonresident_fee:"$85 in/ $130 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Full MPR (20 & 21) (Monday - Thursday)",resident_fee:"$100/hr",nonresident_fee:"$100 in/ $150 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Theater (Monday - Thursday)",resident_fee:"$125/hr",nonresident_fee:"$125 in/ $190 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Rooms 6, 7 (Friday - Sunday)",resident_fee:"$50/hr",nonresident_fee:"$50 in/ $75 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Rooms 19, 21 (Friday - Sunday)",resident_fee:"$95/hr",nonresident_fee:"$95 in/ $145 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Room 20 (Friday - Sunday)",resident_fee:"$110/hr",nonresident_fee:"$110 in/ $165 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Full MPR (20 & 21) (Friday - Sunday)",resident_fee:"$125/hr",nonresident_fee:"$125 in/ $190 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"CAC Theater (Friday - Sunday)",resident_fee:"$175/hr",nonresident_fee:"$175 in/ $265 out",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Scout Badge Day",resident_fee:"10.0",nonresident_fee:"10.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Camp in a bag - I",resident_fee:"25.0",nonresident_fee:"25.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"School Educational Programs",resident_fee:"25.0",nonresident_fee:"$25/$30",contractual:false,notes:"$25 for onsite, $30 for offsite",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Thanksgiving Class",resident_fee:"10.0",nonresident_fee:"10.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Love, Murder, Science",resident_fee:"5.0",nonresident_fee:"5.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Gardening Classes",resident_fee:"10.0",nonresident_fee:"",contractual:false,notes:"No longer offered",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Mom and Me Tea",resident_fee:"25.0",nonresident_fee:"30.0",contractual:false,notes:"Increse due to supply costs",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Scout Programs",resident_fee:"$5/$10",nonresident_fee:"$5/$10",contractual:false,notes:"$10 fee is for 2 hour long program",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Nature Classroom Birthday Party",resident_fee:"300.0",nonresident_fee:"300.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Fields",resident_fee:"$40/hr",nonresident_fee:"$40/hr",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Parking Lots",resident_fee:"$100/day",nonresident_fee:"$100/day",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Shelters Monday - Friday (Public and Nonprofits)",resident_fee:"$25In/$30 Out",nonresident_fee:"$40/ $60",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Shelters Saturday - Sunday (Public and Nonprofits)",resident_fee:"$40In/$50 Out",nonresident_fee:"$60/ $90",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Shelters Monday - Friday (Corporations)",resident_fee:"$50In/$60 Out",nonresident_fee:"$70/$105",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Other",program_name:"Shelters Saturday - Sunday (Corportations)",resident_fee:"$75In/$90 Out",nonresident_fee:"$90/$135",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Sport Courts",resident_fee:"$10In/$13 OUt",nonresident_fee:"$10/$13",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Acting Studio",resident_fee:"$10/$12.4",nonresident_fee:"$12.40-$13",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Fall Adult Non Musical",resident_fee:"350.0",nonresident_fee:"",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Advanced Theatre Co.",resident_fee:"250.0",nonresident_fee:"$15-$18 per class",contractual:false,notes:"Class is 1.5 in length/ $18 for the class, plus funds to cover tickets",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"BG Singers",resident_fee:"230.0",nonresident_fee:"230.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Fall Children's Theatre",resident_fee:"350.0",nonresident_fee:"400.0",contractual:false,notes:"Raising the price to cover staff costs",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Dance Company Minis",resident_fee:"14.0",nonresident_fee:"$14 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Dance Company Duets/Trios",resident_fee:"16.0",nonresident_fee:"$16 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Dance Company Choreography Classes",resident_fee:"11.0",nonresident_fee:"$11 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Dance Company Solos",resident_fee:"28.0",nonresident_fee:"$28 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Piano Instruction",resident_fee:"380.0",nonresident_fee:"380.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Spring Kids Theatre",resident_fee:"350.0",nonresident_fee:"400.0",contractual:false,notes:"Increasing fees to be competitive with similar programs & cover increasing staff costs",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Winter Teen Theatre",resident_fee:"350.0",nonresident_fee:"400.0",contractual:false,notes:"Increasing fees to be competitive with similar programs & cover increasing staff costs",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Special Recreation Theatre: Broadway Buddies",resident_fee:"250.0",nonresident_fee:"$20 per class",contractual:false,notes:"This is the agreed upon rate with NWSRA for the program that each adgency will charge.",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Workshop Series",resident_fee:"25.0",nonresident_fee:"25.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Dance - 30 minute classes",resident_fee:"11.0",nonresident_fee:"$11 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Dance - 45 minute classes",resident_fee:"12.0",nonresident_fee:"$12 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Dance - 60 minute classes",resident_fee:"13.0",nonresident_fee:"$13 per class",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Winter Dance Production",resident_fee:"325.0",nonresident_fee:"325.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Baby Brushstrokes",resident_fee:"$15/$19",nonresident_fee:"$15/$19",contractual:false,notes:"Price will stay the same as this is a new program",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Art Together: Family & Friends Art Night",resident_fee:"$15/$19",nonresident_fee:"$15/$19",contractual:false,notes:"Price will stay the same as this is a new program",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Pinspiration Kids: Creative Arts Class",resident_fee:"$15/$19",nonresident_fee:"$165/$205",contractual:false,notes:"Price will stay the same as this is a new program",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Art Club",resident_fee:"$15/$19",nonresident_fee:"$180/$225",contractual:false,notes:"Price will stay the same as this is a new program",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Beginning Sewing",resident_fee:"$15/$19",nonresident_fee:"$180/$225",contractual:false,notes:"This class is $15 per class to cover material",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Fashion Design & Intermediate Sewing",resident_fee:"$15/$19",nonresident_fee:"$180/$225",contractual:false,notes:"This class is $15 per class to cover material",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Bingo Luncheon",resident_fee:"7.0",nonresident_fee:"7.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Monthly Parties",resident_fee:"$7IN/$9OUT",nonresident_fee:"$7IN/$9OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Holiday Party",resident_fee:"$12IN/$15OUT",nonresident_fee:"$12IN/$15OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Luncheons",resident_fee:"6.0",nonresident_fee:"7.0",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Senior Membership Fee",resident_fee:"$20IN/$25OUT",nonresident_fee:"$20IN/$25OUT",contractual:false,notes:"",is_archived:false},
  {fy:"2025-2026",area:"Special Events",program_name:"Adventure Challenge",resident_fee:"14.0",nonresident_fee:"",contractual:false,notes:"No longer offering",is_archived:false},
];

// ─── FEE HISTORY ─────────────────────────────────────────────────────────────
function FeeHistorySection({db}){
  const [fees,setFees]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState("2026-2027");
  const [areaF,setAreaF]=useState("all");
  const [search,setSearch]=useState("");
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const emptyForm={fy:"2026-2027",area:"",program_name:"",resident_fee:"",nonresident_fee:"",contractual:false,notes:"",is_archived:false};
  const [form,setForm]=useState(emptyForm);

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_fees",SEED_FEES);
    const {data}=await db.from("admin_fees").select("*").order("area").order("program_name");
    setFees(data||[]);
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fy:form.fy,area:form.area,program_name:form.program_name,resident_fee:form.resident_fee,nonresident_fee:form.nonresident_fee,contractual:form.contractual,notes:form.notes,is_archived:false};
    if(editRow){await db.from("admin_fees").update(d).eq("id",editRow.id);}
    else{await db.from("admin_fees").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_fees").delete().eq("id",id);setConfirm(null);load();}
  function openEdit(r){setEditRow(r);setForm({fy:r.fy,area:r.area,program_name:r.program_name,resident_fee:r.resident_fee||"",nonresident_fee:r.nonresident_fee||"",contractual:r.contractual||false,notes:r.notes||""});setShowModal(true);}

  if(loading) return <div className="text-center py-20 text-slate-400">Loading…</div>;

  const fyFees=fees.filter(f=>f.fy===fy&&!f.is_archived);
  const prevFy=ADMIN_FYS[ADMIN_FYS.indexOf(fy)-1];
  const filtered=fyFees.filter(f=>{
    if(areaF!=="all"&&f.area!==areaF) return false;
    if(search&&!f.program_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const areas=[...new Set(fees.map(f=>f.area))].filter(Boolean).sort();

  function feeChanged(f){
    if(!prevFy) return false;
    const prev=fees.find(p=>p.fy===prevFy&&p.program_name===f.program_name&&p.area===f.area);
    if(!prev) return false;
    return prev.resident_fee!==f.resident_fee||prev.nonresident_fee!==f.nonresident_fee;
  }

  return(
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-slate-800" style={{fontSize:"18px"}}>Fee History</h2>
          <p className="text-sm text-slate-500 mt-0.5">Resident & non-resident fees by program and fiscal year</p>
        </div>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy}/>
          <button onClick={()=>{setEditRow(null);setForm({...emptyForm,fy});setShowModal(true);}}
            className="px-4 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>+ Add Fee</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm mb-5 flex gap-3 flex-wrap items-center">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search program…"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm flex-1" style={{minWidth:160}}/>
        <select value={areaF} onChange={e=>setAreaF(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
          <option value="all">All Areas</option>
          {AREAS.map(a=><option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-xs text-slate-400">{filtered.length} programs</span>
      </div>

      {/* Table */}
      {filtered.length>0?(
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{background:"#f8fafc"}}>
                {["Area","Program","Resident Fee","Non-Res Fee","Contractual","Prior Year","Notes",""].map(h=>(
                  <th key={h} className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase ${h==="Area"||h==="Program"?"text-left":"text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f=>{
                const changed=feeChanged(f);
                const prevF=prevFy?fees.find(p=>p.fy===prevFy&&p.program_name===f.program_name&&p.area===f.area):null;
                return(
                  <tr key={f.id} className={`border-t border-slate-50 hover:bg-slate-50 ${changed?"":""}` } style={changed?{background:"#fffbeb"}:{}}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{f.area}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{f.program_name}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{f.resident_fee||"—"}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{f.nonresident_fee||"—"}</td>
                    <td className="px-4 py-2.5 text-center">{f.contractual&&<span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">C</span>}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                      {prevF?<span className={changed?"font-semibold text-amber-700":""}>{prevF.resident_fee||"—"}</span>:"—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400 max-w-xs truncate">{f.notes}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1 justify-end">
                        <button onClick={()=>openEdit(f)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs">✏</button>
                        <button onClick={()=>setConfirm(f.id)} className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-400 text-xs">✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ):(
        <EmptyState msg={`No fees for FY ${fy}${search?` matching "${search}"`:""}. Import from the Master Fee Report or add manually.`} action="Add Fee" onAction={()=>{setEditRow(null);setForm({...emptyForm,fy});setShowModal(true);}}/>
      )}

      {showModal&&(
        <AModal title={editRow?"Edit Fee":"Add Fee"} onClose={()=>setShowModal(false)} wide>
          <div className="grid grid-cols-2 gap-x-4">
            <AInp label="Fiscal Year" value={form.fy} onChange={v=>setForm(p=>({...p,fy:v}))} options={ADMIN_FYS} required/>
            <AInp label="Area" value={form.area} onChange={v=>setForm(p=>({...p,area:v}))} options={AREAS} required/>
          </div>
          <AInp label="Program Name" value={form.program_name} onChange={v=>setForm(p=>({...p,program_name:v}))} required/>
          <div className="grid grid-cols-2 gap-x-4">
            <AInp label="Resident Fee" value={form.resident_fee} onChange={v=>setForm(p=>({...p,resident_fee:v}))} hint="e.g. $45 or $40/$50"/>
            <AInp label="Non-Resident Fee" value={form.nonresident_fee} onChange={v=>setForm(p=>({...p,nonresident_fee:v}))}/>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <input type="checkbox" checked={form.contractual} onChange={e=>setForm(p=>({...p,contractual:e.target.checked}))} id="contractual" className="w-4 h-4"/>
            <label htmlFor="contractual" className="text-sm text-slate-700">Contractual program</label>
          </div>
          <AInp label="Notes" value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} rows={2}/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this fee record?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </div>
  );
}

// ─── ADMIN CONTAINER ─────────────────────────────────────────────────────────

// ─── STANDALONE DASHBOARD SHELL ──────────────────────────────────────────────
// Shared header + accent bar used by every standalone dashboard tab
function DashShell({title,sub,accent,icon,children}){
  return(
    <div>
      <div className="rounded-xl mb-6 px-6 py-5 flex items-center gap-4 text-white shadow-sm"
        style={{background:`linear-gradient(135deg,${accent} 0%,${accent}cc 100%)`}}>
        <div className="text-3xl">{icon}</div>
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{color:"rgba(255,255,255,0.65)"}}>Standalone Dashboard</div>
          <div className="text-xl font-black leading-tight">{title}</div>
          {sub&&<div className="text-sm mt-0.5" style={{color:"rgba(255,255,255,0.75)"}}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── FUND 4 DASHBOARD ────────────────────────────────────────────────────────
function Fund4Dashboard({db}){
  const [funds,setFunds]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState(ADMIN_CUR);
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const FNAME="Fund 4 – Recreation";
  const COLOR="#1e3a5f";
  const [form,setForm]=useState({fund_name:FNAME,fy:ADMIN_CUR,month:"",revenue:"",expenses:"",goal:"",notes:""});
  const f=v=>form[v]; const s=(k,v)=>setForm(p=>({...p,[k]:v}));

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_funds",SEED_FUNDS);
    const {data}=await db.from("admin_funds").select("*").eq("fund_name",FNAME).order("fy").order("month");
    setFunds(data||[]); setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fund_name:FNAME,fy:form.fy,month:form.month,revenue:parseFloat(form.revenue)||0,expenses:parseFloat(form.expenses)||0,goal:parseFloat(form.goal)||0,notes:form.notes};
    if(editRow){await db.from("admin_funds").update(d).eq("id",editRow.id);}
    else{await db.from("admin_funds").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_funds").delete().eq("id",id);setConfirm(null);load();}
  function openEdit(r){setEditRow(r);setForm({fund_name:FNAME,fy:r.fy,month:r.month||"",revenue:r.revenue||"",expenses:r.expenses||"",goal:r.goal||"",notes:r.notes||""});setShowModal(true);}

  if(loading) return <div className="text-center py-20 text-slate-400">Loading…</div>;

  const allFYs=ADMIN_FYS.filter(f=>funds.some(r=>r.fy===f));
  const fyRows=funds.filter(r=>r.fy===fy);
  const totalRev=sumField(fyRows,"revenue");
  const totalExp=sumField(fyRows,"expenses");
  const totalGoal=sumField(fyRows,"goal");
  const prevFyRev=sumField(funds.filter(r=>r.fy===ADMIN_FYS[ADMIN_FYS.indexOf(fy)-1]),"revenue");
  const net=totalRev-totalExp;

  return(
    <DashShell title="Fund 4 — Recreation" sub="Monthly revenue, expenses & goals" accent={COLOR} icon="🏛">

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <AKpi label="Total Revenue" val={adm$(totalRev)} accent={COLOR}/>
        <AKpi label="Total Expenses" val={adm$(totalExp)} accent="#64748b"/>
        <AKpi label="Net P/(L)" val={adm$(net)} accent={net>=0?"#16a34a":"#dc2626"}/>
        <AKpi label="vs Goal" val={totalGoal>0?admPct(totalRev/totalGoal):"—"} accent={totalRev>=totalGoal?"#16a34a":"#b45309"}/>
      </div>

      {/* YoY sparkline table */}
      {allFYs.length>1&&(
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm mb-6 overflow-hidden overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-semibold text-sm text-slate-700">Year-over-Year Revenue</div>
          </div>
          <table className="w-full text-xs" style={{minWidth:560}}>
            <thead><tr style={{background:"#f8fafc"}}>
              <th className="text-left px-4 py-2 text-slate-500 font-semibold">FY</th>
              <th className="text-right px-4 py-2 text-slate-500 font-semibold">Revenue</th>
              <th className="text-right px-4 py-2 text-slate-500 font-semibold">Expenses</th>
              <th className="text-right px-4 py-2 text-slate-500 font-semibold">Net</th>
              <th className="text-right px-4 py-2 text-slate-500 font-semibold">YoY</th>
              <th className="px-4 py-2 text-slate-500 font-semibold">Trend</th>
            </tr></thead>
            <tbody>
              {allFYs.map((f,i)=>{
                const rev=sumField(funds.filter(r=>r.fy===f),"revenue");
                const exp=sumField(funds.filter(r=>r.fy===f),"expenses");
                const prevRev=i>0?sumField(funds.filter(r=>r.fy===allFYs[i-1]),"revenue"):null;
                const pct=prevRev&&prevRev>0?((rev-prevRev)/prevRev)*100:null;
                return(
                  <tr key={f} className={`border-t border-slate-50 ${f===fy?"bg-blue-50":""}`}>
                    <td className="px-4 py-2.5 font-semibold text-slate-700">{f}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-slate-800">{adm$(rev,true)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{adm$(exp,true)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold" style={{color:(rev-exp)>=0?"#16a34a":"#dc2626"}}>{adm$(rev-exp,true)}</td>
                    <td className="px-4 py-2.5 text-right">{pct!=null?arrowBadge(pct):"—"}</td>
                    <td className="px-4 py-2.5"><Sparkline values={FY_MONTHS.map(m=>{const r=funds.find(x=>x.fy===f&&x.month===m);return r?.revenue||0;}).filter(v=>v>0)} color={COLOR} height={22}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* FY selector + chart */}
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold text-slate-700">FY {fy} — Monthly Detail</div>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy} include2027/>
          <button onClick={()=>{setEditRow(null);setForm({fund_name:FNAME,fy,month:"",revenue:"",expenses:"",goal:"",notes:""});setShowModal(true);}}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-white" style={{background:COLOR}}>+ Add Entry</button>
        </div>
      </div>

      {fyRows.length>0&&<FundMonthChart rows={fyRows} fname={FNAME} fy={fy} allFunds={funds}/>}

      {/* Monthly table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr style={{background:"#f8fafc"}}>
            <th className="text-left px-4 py-2 text-slate-500 font-semibold">Month</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Revenue</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Expenses</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Net</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Goal</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Attainment</th>
            <th className="px-2 py-2"/>
          </tr></thead>
          <tbody>
            {FY_MONTHS.map(mon=>{
              const r=fyRows.find(x=>x.month===mon);
              if(!r) return(
                <tr key={mon} className="border-t border-slate-50">
                  <td className="px-4 py-2 text-slate-400">{mon}</td>
                  {[...Array(5)].map((_,i)=><td key={i} className="px-4 py-2 text-right text-slate-200">—</td>)}
                  <td className="px-4 py-2 text-right">
                    <button onClick={()=>{setEditRow(null);setForm({fund_name:FNAME,fy,month:mon,revenue:"",expenses:"",goal:"",notes:""});setShowModal(true);}}
                      className="text-xs px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-400">+</button>
                  </td>
                </tr>
              );
              const net=r.revenue-r.expenses;
              return(
                <tr key={mon} className="border-t border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-700">{mon}</td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-800">{adm$(r.revenue)}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{r.expenses>0?adm$(r.expenses):"—"}</td>
                  <td className="px-4 py-2 text-right font-semibold" style={{color:net>=0?"#16a34a":"#dc2626"}}>{adm$(net)}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{r.goal>0?adm$(r.goal):"—"}</td>
                  <td className="px-4 py-2 text-right">{r.goal>0?<span style={{color:r.revenue>=r.goal?"#16a34a":r.revenue>=r.goal*0.8?"#b45309":"#dc2626",fontWeight:700}}>{((r.revenue/r.goal)*100).toFixed(0)}%</span>:"—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1 justify-end">
                      <button onClick={()=>openEdit(r)} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs">✏</button>
                      <button onClick={()=>setConfirm(r.id)} className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-400 text-xs">✕</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-200" style={{background:"#f8fafc"}}>
            <td className="px-4 py-2.5 font-bold text-slate-700">TOTAL</td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-800">{adm$(totalRev)}</td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-600">{adm$(totalExp)}</td>
            <td className="px-4 py-2.5 text-right font-bold" style={{color:net>=0?"#16a34a":"#dc2626"}}>{adm$(net)}</td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-500">{totalGoal>0?adm$(totalGoal):"—"}</td>
            <td className="px-4 py-2.5 text-right font-bold">{totalGoal>0?<span style={{color:totalRev>=totalGoal?"#16a34a":"#dc2626"}}>{((totalRev/totalGoal)*100).toFixed(0)}%</span>:"—"}</td>
            <td/>
          </tr></tfoot>
        </table>
      </div>

      {showModal&&(
        <AModal title={editRow?"Edit Entry":"Add Entry"} onClose={()=>setShowModal(false)}>
          <div className="grid grid-cols-2 gap-x-4">
            <AInp label="Fiscal Year" value={f("fy")} onChange={v=>s("fy",v)} options={ADMIN_FYS} required/>
            <AInp label="Month" value={f("month")} onChange={v=>s("month",v)} options={FY_MONTHS} required/>
            <AInp label="Revenue ($)" value={f("revenue")} onChange={v=>s("revenue",v)} type="number"/>
            <AInp label="Expenses ($)" value={f("expenses")} onChange={v=>s("expenses",v)} type="number"/>
            <AInp label="Goal ($)" value={f("goal")} onChange={v=>s("goal",v)} type="number"/>
          </div>
          <AInp label="Notes" value={f("notes")} onChange={v=>s("notes",v)} rows={2}/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:COLOR}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this entry?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </DashShell>
  );
}

// ─── FUND 21 / FITNESS CENTER DASHBOARD ──────────────────────────────────────
function FitnessDashboard({db}){
  const [funds,setFunds]=useState([]);
  const [loading,setLoading]=useState(true);
  const [fy,setFy]=useState(ADMIN_CUR);
  const [showModal,setShowModal]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const FNAME="Fitness Center (FCBG)";
  const COLOR="#0369a1";
  const [form,setForm]=useState({fund_name:FNAME,fy:ADMIN_CUR,month:"",revenue:"",expenses:"",goal:"",notes:""});
  const f=v=>form[v]; const s=(k,v)=>setForm(p=>({...p,[k]:v}));

  async function load(){
    setLoading(true);
    await seedIfEmpty(db,"admin_funds",SEED_FUNDS);
    const {data}=await db.from("admin_funds").select("*").eq("fund_name",FNAME).order("fy").order("month");
    setFunds(data||[]); setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function save(){
    const d={fund_name:FNAME,fy:form.fy,month:form.month,revenue:parseFloat(form.revenue)||0,expenses:parseFloat(form.expenses)||0,goal:parseFloat(form.goal)||0,notes:form.notes};
    if(editRow){await db.from("admin_funds").update(d).eq("id",editRow.id);}
    else{await db.from("admin_funds").insert(d);}
    setShowModal(false);setEditRow(null);load();
  }
  async function del(id){await db.from("admin_funds").delete().eq("id",id);setConfirm(null);load();}
  function openEdit(r){setEditRow(r);setForm({fund_name:FNAME,fy:r.fy,month:r.month||"",revenue:r.revenue||"",expenses:r.expenses||"",goal:r.goal||"",notes:r.notes||""});setShowModal(true);}

  if(loading) return <div className="text-center py-20 text-slate-400">Loading…</div>;

  const allFYs=ADMIN_FYS.filter(f=>funds.some(r=>r.fy===f));
  const fyRows=funds.filter(r=>r.fy===fy);
  const totalRev=sumField(fyRows,"revenue");
  const totalExp=sumField(fyRows,"expenses");
  const totalGoal=sumField(fyRows,"goal");
  const net=totalRev-totalExp;

  return(
    <DashShell title="Fund 21 — Fitness Center (FCBG)" sub="Monthly revenue, expenses & membership trends" accent={COLOR} icon="🏋">

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <AKpi label="Total Revenue" val={adm$(totalRev)} accent={COLOR}/>
        <AKpi label="Total Expenses" val={adm$(totalExp)} accent="#64748b"/>
        <AKpi label="Net P/(L)" val={adm$(net)} accent={net>=0?"#16a34a":"#dc2626"}/>
        <AKpi label="vs Goal" val={totalGoal>0?admPct(totalRev/totalGoal):"—"} accent={totalRev>=totalGoal?"#16a34a":"#b45309"}/>
      </div>

      {allFYs.length>1&&(
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm mb-6 overflow-hidden overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm text-slate-700">Year-over-Year Revenue</div>
          <table className="w-full text-xs" style={{minWidth:560}}>
            <thead><tr style={{background:"#f8fafc"}}>
              <th className="text-left px-4 py-2 text-slate-500 font-semibold">FY</th>
              <th className="text-right px-4 py-2 text-slate-500 font-semibold">Revenue</th>
              <th className="text-right px-4 py-2 text-slate-500 font-semibold">Expenses</th>
              <th className="text-right px-4 py-2 text-slate-500 font-semibold">Net</th>
              <th className="text-right px-4 py-2 text-slate-500 font-semibold">YoY</th>
              <th className="px-4 py-2 text-slate-500 font-semibold">Trend</th>
            </tr></thead>
            <tbody>
              {allFYs.map((f,i)=>{
                const rev=sumField(funds.filter(r=>r.fy===f),"revenue");
                const exp=sumField(funds.filter(r=>r.fy===f),"expenses");
                const prevRev=i>0?sumField(funds.filter(r=>r.fy===allFYs[i-1]),"revenue"):null;
                const pct=prevRev&&prevRev>0?((rev-prevRev)/prevRev)*100:null;
                return(
                  <tr key={f} className={`border-t border-slate-50 ${f===fy?"bg-blue-50":""}`}>
                    <td className="px-4 py-2.5 font-semibold text-slate-700">{f}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-slate-800">{adm$(rev,true)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{adm$(exp,true)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold" style={{color:(rev-exp)>=0?"#16a34a":"#dc2626"}}>{adm$(rev-exp,true)}</td>
                    <td className="px-4 py-2.5 text-right">{pct!=null?arrowBadge(pct):"—"}</td>
                    <td className="px-4 py-2.5"><Sparkline values={FY_MONTHS.map(m=>{const r=funds.find(x=>x.fy===f&&x.month===m);return r?.revenue||0;}).filter(v=>v>0)} color={COLOR} height={22}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold text-slate-700">FY {fy} — Monthly Detail</div>
        <div className="flex items-center gap-3">
          <FYPicker value={fy} onChange={setFy} include2027/>
          <button onClick={()=>{setEditRow(null);setForm({fund_name:FNAME,fy,month:"",revenue:"",expenses:"",goal:"",notes:""});setShowModal(true);}}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-white" style={{background:COLOR}}>+ Add Entry</button>
        </div>
      </div>

      {fyRows.length>0&&<FundMonthChart rows={fyRows} fname={FNAME} fy={fy} allFunds={funds}/>}

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr style={{background:"#f8fafc"}}>
            <th className="text-left px-4 py-2 text-slate-500 font-semibold">Month</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Revenue</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Expenses</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Net</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Goal</th>
            <th className="text-right px-4 py-2 text-slate-500 font-semibold">Attainment</th>
            <th className="px-2 py-2"/>
          </tr></thead>
          <tbody>
            {FY_MONTHS.map(mon=>{
              const r=fyRows.find(x=>x.month===mon);
              if(!r) return(
                <tr key={mon} className="border-t border-slate-50">
                  <td className="px-4 py-2 text-slate-400">{mon}</td>
                  {[...Array(5)].map((_,i)=><td key={i} className="px-4 py-2 text-right text-slate-200">—</td>)}
                  <td className="px-4 py-2 text-right">
                    <button onClick={()=>{setEditRow(null);setForm({fund_name:FNAME,fy,month:mon,revenue:"",expenses:"",goal:"",notes:""});setShowModal(true);}}
                      className="text-xs px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-400">+</button>
                  </td>
                </tr>
              );
              const net=r.revenue-r.expenses;
              return(
                <tr key={mon} className="border-t border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-700">{mon}</td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-800">{adm$(r.revenue)}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{r.expenses>0?adm$(r.expenses):"—"}</td>
                  <td className="px-4 py-2 text-right font-semibold" style={{color:net>=0?"#16a34a":"#dc2626"}}>{adm$(net)}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{r.goal>0?adm$(r.goal):"—"}</td>
                  <td className="px-4 py-2 text-right">{r.goal>0?<span style={{color:r.revenue>=r.goal?"#16a34a":r.revenue>=r.goal*0.8?"#b45309":"#dc2626",fontWeight:700}}>{((r.revenue/r.goal)*100).toFixed(0)}%</span>:"—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1 justify-end">
                      <button onClick={()=>openEdit(r)} className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs">✏</button>
                      <button onClick={()=>setConfirm(r.id)} className="px-2 py-0.5 rounded bg-red-50 hover:bg-red-100 text-red-400 text-xs">✕</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-200" style={{background:"#f8fafc"}}>
            <td className="px-4 py-2.5 font-bold text-slate-700">TOTAL</td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-800">{adm$(totalRev)}</td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-600">{adm$(totalExp)}</td>
            <td className="px-4 py-2.5 text-right font-bold" style={{color:net>=0?"#16a34a":"#dc2626"}}>{adm$(net)}</td>
            <td className="px-4 py-2.5 text-right font-bold text-slate-500">{totalGoal>0?adm$(totalGoal):"—"}</td>
            <td className="px-4 py-2.5 text-right font-bold">{totalGoal>0?<span style={{color:totalRev>=totalGoal?"#16a34a":"#dc2626"}}>{((totalRev/totalGoal)*100).toFixed(0)}%</span>:"—"}</td>
            <td/>
          </tr></tfoot>
        </table>
      </div>

      {showModal&&(
        <AModal title={editRow?"Edit Entry":"Add Entry"} onClose={()=>setShowModal(false)}>
          <div className="grid grid-cols-2 gap-x-4">
            <AInp label="Fiscal Year" value={f("fy")} onChange={v=>s("fy",v)} options={ADMIN_FYS} required/>
            <AInp label="Month" value={f("month")} onChange={v=>s("month",v)} options={FY_MONTHS} required/>
            <AInp label="Revenue ($)" value={f("revenue")} onChange={v=>s("revenue",v)} type="number"/>
            <AInp label="Expenses ($)" value={f("expenses")} onChange={v=>s("expenses",v)} type="number"/>
            <AInp label="Goal ($)" value={f("goal")} onChange={v=>s("goal",v)} type="number"/>
          </div>
          <AInp label="Notes" value={f("notes")} onChange={v=>s("notes",v)} rows={2}/>
          <div className="flex gap-3 justify-end mt-2">
            <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
            <button onClick={save} className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:COLOR}}>{editRow?"Update":"Save"}</button>
          </div>
        </AModal>
      )}
      {confirm&&<AConfirm message="Delete this entry?" onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)}/>}
    </DashShell>
  );
}

// ─── CLUBHOUSE DASHBOARD ──────────────────────────────────────────────────────
function ClubhouseDashboard({db}){
  return(
    <DashShell title="Clubhouse Dashboard" sub="Enrollment & revenue across all sites, year over year" accent="#0f766e" icon="🏫">
      <ClubhouseDetail db={db}/>
    </DashShell>
  );
}

// ─── GOALS DASHBOARD ─────────────────────────────────────────────────────────
function GoalsDashboard({db}){
  return(
    <DashShell title="Goals & Objectives" sub="Department G&Os — track, update, and archive by quarter" accent="#7c3aed" icon="✓">
      <GoalsSection db={db}/>
    </DashShell>
  );
}

// ─── RENTALS DASHBOARD ───────────────────────────────────────────────────────
function RentalsDashboard({db}){
  return(
    <DashShell title="Rentals Dashboard" sub="Revenue by category and month, year over year" accent="#b45309" icon="🏠">
      <RentalsSection db={db}/>
    </DashShell>
  );
}

// ─── SPECIAL EVENTS DASHBOARD ────────────────────────────────────────────────
function EventsDashboard({db}){
  return(
    <DashShell title="Special Events Dashboard" sub="Attendance & revenue trends by event type and fiscal year" accent="#dc2626" icon="🎉">
      <EventsDetail db={db}/>
    </DashShell>
  );
}

// ─── FEE REPORT DASHBOARD ────────────────────────────────────────────────────
function FeeDashboard({db}){
  return(
    <DashShell title="Fee Report" sub="Program fees by area and fiscal year — amber highlights show changes" accent="#64748b" icon="💲">
      <FeeHistorySection db={db}/>
    </DashShell>
  );
}


function AdminView({programs,db}){
  const [sub,setSub]=useState("summary");
  const tabs=[
    {id:"summary",l:"★ Executive Summary"},
    {id:"funds",  l:"$ Fund Performance"},
    {id:"goals",  l:"✓ Goals & Objectives"},
    {id:"rentals",l:"⌂ Rentals"},
    {id:"areas",  l:"◎ Program Areas"},
    {id:"fees",   l:"◈ Fee History"},
  ];
  return(
    <div>
      <div className="flex gap-1 mb-6 bg-white rounded-xl shadow-sm border border-slate-100 p-1 overflow-x-auto">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setSub(t.id)}
            className="px-4 py-2 text-xs font-bold rounded-lg transition whitespace-nowrap"
            style={sub===t.id?{background:"#1e3a5f",color:"white"}:{color:"#64748b"}}>
            {t.l}
          </button>
        ))}
      </div>
      <div className="min-h-96">
        {sub==="summary"&&<ExecSummary programs={programs} db={db}/>}
        {sub==="funds"  &&<FundSection db={db}/>}
        {sub==="goals"  &&<GoalsSection db={db}/>}
        {sub==="rentals"&&<RentalsSection db={db}/>}
        {sub==="areas"  &&<ProgramAreasSection db={db}/>}
        {sub==="fees"   &&<FeeHistorySection db={db}/>}
      </div>
    </div>
  );
}

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
  const [viewAsManager,setViewAsManager]   = useState(true);
  const isManager = MANAGER_NAMES.includes(staffName.toLowerCase().trim());
  const isAdmin   = ADMIN_NAMES.includes(staffName.toLowerCase().trim());
  const effectiveManager = isManager && viewAsManager;

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

  const handleArchiveProgram = async (id, archive) => {
    setSaving(true);
    await supabase.from("programs").update({is_archived: archive}).eq("id", id);
    await fetchAll(); setEditingProgram(null); setTab("programs"); setSaving(false);
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
    ...(effectiveManager?[
      {id:"fund4",   label:"Fund 4"},
      {id:"fitness", label:"Fitness"},
      {id:"clubhouse",label:"Clubhouse"},
      {id:"goals",   label:"Goals"},
      {id:"rentals", label:"Rentals"},
      {id:"events",  label:"Events"},
      {id:"fees",    label:"Fees"},
    ]:[]),
    ...(isAdmin?[{id:"admin",label:"★ Admin"}]:[]),
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
            <div style={{color:"#d4a017"}} className="text-xs font-semibold tracking-widest uppercase">
              {staffName}{isManager?(effectiveManager?" · Manager View":" · Staff View"):""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isManager&&(
              <button onClick={()=>setViewAsManager(v=>!v)}
                className="text-xs font-bold px-3 py-2 rounded border transition"
                style={effectiveManager
                  ? {backgroundColor:"rgba(255,255,255,0.15)",borderColor:"rgba(255,255,255,0.3)",color:"#fff"}
                  : {backgroundColor:"#d4a017",borderColor:"#d4a017",color:"#1e3a5f"}}>
                {effectiveManager?"⇄ Staff View":"⇄ Manager View"}
              </button>
            )}
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
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${tab===t.id?(t.id==="admin"?"text-amber-700":"text-slate-800"):"border-transparent text-slate-400 hover:text-slate-600"}`}
              style={tab===t.id?{borderColor:t.id==="admin"?"#d4a017":"#d4a017",borderBottomWidth:"2px"}:{}}>{t.label}</button>
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
              <Dashboard programs={programs} staffName={staffName} isManager={effectiveManager}
                onEdit={p=>{setEditingProgram(p);setTab("programs");}}
                onAddProgram={()=>{setAddingProgram(true);setTab("programs");}}/>
            )}
            {tab==="programs"&&!showingForm&&(
              <ProgramsList
                programs={programs} isManager={effectiveManager} staffName={staffName}
                onEdit={setEditingProgram}
                onAdd={()=>setAddingProgram(true)}
                onBulkDup={()=>setShowBulkDup(true)}
                onDupSingle={setDupProgram}/>
            )}
            {tab==="programs"&&showingForm&&(
              <ProgramForm
                initial={editingProgram||null}
                staffName={staffName}
                isManager={effectiveManager}
                onSave={handleSaveProgram}
                onDelete={handleDeleteProgram}
                onArchive={handleArchiveProgram}
                onDuplicate={p=>setDupProgram(p)}
                onCancel={()=>{setEditingProgram(null);setAddingProgram(false);}}
                saving={saving}/>
            )}
            {tab==="history"&&(
              <MultiSeasonView programs={programs} onEdit={p=>{setEditingProgram(p);setTab("programs");}}/>
            )}
            {tab==="kpi"&&<Reference isManager={effectiveManager} db={supabase}/>}
            {tab==="fund4"   &&effectiveManager&&<Fund4Dashboard db={supabase}/>}
            {tab==="fitness" &&effectiveManager&&<FitnessDashboard db={supabase}/>}
            {tab==="clubhouse"&&effectiveManager&&<ClubhouseDashboard db={supabase}/>}
            {tab==="goals"   &&effectiveManager&&<GoalsDashboard db={supabase}/>}
            {tab==="rentals" &&effectiveManager&&<RentalsDashboard db={supabase}/>}
            {tab==="events"  &&effectiveManager&&<EventsDashboard db={supabase}/>}
            {tab==="fees"    &&effectiveManager&&<FeeDashboard db={supabase}/>}
            {tab==="admin"&&isAdmin&&<AdminView programs={programs} db={supabase}/>}
          </>
        )}
      </main>
    </div>
  );
}
