import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const AREAS = ["Adult General","Adult Sports","Aquatics","Camps","Clubhouse","Dance","Fitness","Golf Dome","Museum","Performing Arts","Rentals","Seniors","Special Events","Youth General","Youth Sports","Other"];
const SEASONS = ["Spring","Summer","Fall","Winter","All Year"];
/* inject no-spinner CSS */
if(typeof document!=="undefined"){const s=document.createElement("style");s.textContent="input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}";document.head.appendChild(s);}
const YEARS = ["24-25","25-26","26-27","27-28","28-29","29-30"];
const YEAR_DISPLAY = {"24-25":"FY 24-25","25-26":"FY 25-26","26-27":"FY 26-27","27-28":"FY 27-28","28-29":"FY 28-29","29-30":"FY 29-30"};

// Convert FY string or 4-digit year → calendar year number for sorting
function toCalYear(year) {
  if (!year) return 0;
  const s = String(year).trim();
  if (/^\d{4}$/.test(s)) return parseInt(s);
  // "25-26" → 2025
  const m = s.match(/^(\d{2})-\d{2}$/);
  if (m) return 2000 + parseInt(m[1]);
  return parseInt(s) || 0;
}

// Convert stored year value to FY string (e.g. "2025" → "25-26", "25-26" → "25-26")
function toFY(year) {
  if (!year) return "";
  const s = String(year).trim();
  // Already in FY format
  if (/^\d{2}-\d{2}$/.test(s)) return s;
  // 4-digit year: fiscal year starts in May, so 2025 → "25-26"
  const n = parseInt(s);
  if (!isNaN(n) && n > 2000) {
    const y1 = String(n).slice(2);
    const y2 = String(n + 1).slice(2);
    return `${y1}-${y2}`;
  }
  return s;
}

const CLASSIFICATIONS = ["Community Driven","Revenue Driven","Both"];
const TRENDS = ["Growing","Stable","Declining","New"];
const SERVICE_CATEGORIES = [
  "Open Access","Community Events","Specialty Events","Beg./Intro. Activities",
  "Drop In Activities","Childcare Services","Intermediate/Adv. Activities",
  "Private/Semi-Private Activities","Specialized Activities","Rentals","Retail & Consumables",
];
const PROGRAM_TYPES = [
  {label:"Small Contractual Program", pct:0.005, hint:"Drop-ins, open access, and contractual classes run entirely by an outside instructor. Staff role is scheduling and contract only."},
  {label:"Large Contractual Program",  pct:0.01,  hint:"Multi-session contractual series (Karate, Chess, Fencing, Tennis). Staff monitors enrollment, communicates with contractor, handles complaints."},
  {label:"Drop-In Program",            pct:0.015, hint:"Open gym, open arts studio, drop-in museum visits. No registration pipeline. Staff manages scheduling and facility coordination only."},
  {label:"Small Event",                pct:0.025, hint:"Single-day community events under ~200 participants (Kite Fly, Canine Costume, Green Fair, Trick or Treat Trail). Moderate day-of coordination."},
  {label:"Small Program",              pct:0.03,  hint:"Short-run registered programs (4–8 weeks): fitness classes, beginner sports clinics, EC classes, youth enrichment. Staff manages registration and instructor."},
  {label:"Large Event",                pct:0.05,  hint:"High-attendance or revenue events (BG Days, Uniquely Us, Summer Concert Series, 5K, Boat Regatta, Senior Expo). Multi-week planning and day-of coordination."},
  {label:"Large Program",              pct:0.06,  hint:"Ongoing multi-session programs: swim lessons, advanced martial arts, dance, BG Singers, sports leagues, aquatics. Higher registration volume and instructor oversight."},
  {label:"League",                     pct:0.07,  hint:"Season-long competitive or recreational leagues (Flag Football, House League Basketball, Adult Softball, Soccer, Volleyball). Ongoing scheduling and facility management."},
  {label:"Camp",                       pct:0.09,  hint:"Day camps and specialty camps. High complexity: part-time staff management, licensing, safety, parent communication. Enter per curriculum group — not per week. Supervisors overseeing multiple camps: use Custom % for your full portfolio."},
  {label:"Production / Major Program", pct:0.10,  hint:"Preschool, Clubhouse, theater productions, Dance Company, Fitness Center operations. Year-round high-touch programs. Multi-site supervisors: use Custom % to reflect your full portfolio load."},
];
const ADMIN_OVERHEAD_RATE  = 0.1;
const FT_ANNUAL_SALARY     = 97700;
const FACILITY_COST_PER_HR = 3;
const MANAGER_NAMES        = ["admin","manager","joe zimmermann","erika strojinc","dan stanczak","brian o'malley","chris eckert","chuck burgess","diana clayson","amanda busch"];


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
  return {onTarget, label:t.label, min:t.min, max:t.max, expectSubsidy:t.expectSubsidy};
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
  "ant_program_type","ant_custom_workload","ant_custom_type_label",
  "act_capacity","act_enrollment","act_revenue",
  "act_personnel","act_commodities","act_contractuals",
  "act_other1","act_other2","act_facility_hours",
  "act_program_type","act_custom_workload","act_custom_type_label",
  "decision_log",
  "is_archived",
  "fee",
  "nps_promoters","nps_passives","nps_detractors","nps_total",
  "pricing_decision","pricing_target_fee","pricing_rationale","pricing_notes","pricing_subsidy","pricing_subsidy_amount",
  "budget_mode","sub_programs","clubhouse_alloc","clubhouse_alloc_act",
  "ant_clubhouse_fee","act_clubhouse_fee",
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
  const clubhouseFee = p[px+"clubhouse_fee"]  || 0;
  const facHrs       = p[px+"facility_hours"] || 0;
  const progType     = p[px+"program_type"]   || "";
  const customWL     = p[px+"custom_workload"]|| 0;
  const revenue      = p[px+"revenue"]        || 0;
  const enrollment   = p[px+"enrollment"]     || 0;
  const capacity     = p[px+"capacity"]       || 0;
  const wlPct = parseFloat(customWL) > 0
    ? parseFloat(customWL) / 100
    : progType && progType !== "Custom"
      ? (PROGRAM_TYPES.find(t => t.label === progType)?.pct || 0)
      : 0;
  const direct   = personnel + commodities + contractuals + other1 + other2 + clubhouseFee;
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
    hasActuals: b.enrollment > 0 || b.revenue > 0,
  };
}

function newProgram(staffName) {
  const last = getLastUsed(staffName);
  return {
    name:"", area:last.area||"Youth Sports", season:last.season||"Summer", year:last.year||"25-26",
    classification:last.classification||"Community Driven", service_category:last.service_category||"",
    trend:"New", nps:0, notes:"", staff_name: staffName||"", waitlist:0,
    ant_capacity:0, ant_enrollment:0, ant_revenue:0,
    ant_personnel:0, ant_commodities:0, ant_contractuals:0,
    ant_other1:0, ant_other2:0, ant_facility_hours:0,
    ant_program_type:last.program_type||"", ant_custom_workload:0, ant_custom_type_label:"",
    act_capacity:0, act_enrollment:0, act_revenue:0,
    act_personnel:0, act_commodities:0, act_contractuals:0,
    act_other1:0, act_other2:0, act_facility_hours:0,
    act_program_type:"", act_custom_workload:0, act_custom_type_label:"",
    other1_label:"Other Direct Costs", other2_label:"Other Direct Costs 2",
    decision_log: [],
    is_archived: false,
    fee: 0,
    nps_promoters:0,nps_passives:0,nps_detractors:0,nps_total:0,
    pricing_decision:"",pricing_target_fee:0,pricing_rationale:"",pricing_notes:"",pricing_subsidy:null,pricing_subsidy_amount:0,
    budget_mode:"seasonal",sub_programs:[],clubhouse_alloc:null,clubhouse_alloc_act:null,
    ant_clubhouse_fee:0,act_clubhouse_fee:0,
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
  const surplus     = kpis.reduce((a,p)=>a+(p.profitLoss||0),0);
  const plSignal    = surplus>=0 ? 1 : Math.max(0, 1+(surplus/(Math.max(kpis.reduce((a,p)=>a+(p.totalCost||0),0),1)*0.5)));
  const healthScore = kpis.length ? Math.round((Math.min(avgCR,2)/2*0.40 + avgFill*0.35 + plSignal*0.15 + (healthy/kpis.length)*0.10)*100) : 0;
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

// ─── Program Completion Status ────────────────────────────────────────────────
function completionTag(p) {
  const hasBudget = (p.ant_enrollment||0)>0 || (p.ant_revenue||0)>0;
  const hasActs   = (p.act_enrollment||0)>0 || (p.act_revenue||0)>0;
  if(hasActs)   return {label:"Complete",     bg:"#dcfce7",text:"#166534"};
  if(hasBudget) return {label:"Needs Actuals",bg:"#fef3c7",text:"#92400e"};
  return            {label:"Budgeted Only",   bg:"#f1f5f9",text:"#64748b"};
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
// ─── Cost Recovery Gap Panel ──────────────────────────────────────────────────
// ─── NPS CSV Uploader ──────────────────────────────────────────────────────────
// Reads a CSV where one column contains 1-10 ratings, calculates NPS
// Promoters = 9-10, Passives = 7-8, Detractors = 0-6
// NPS = ((Promoters - Detractors) / Total) * 100, rounded to nearest whole number
function NPSUploader({programId,programName,currentNPS,currentTotal,onSave,onClear}){
  const [dragging,setDragging]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState("");
  const [preview,setPreview]=useState(null);
  const [ratingCol,setRatingCol]=useState("");
  const [headers,setHeaders]=useState([]);
  const [rows,setRows]=useState([]);
  const [saving,setSaving]=useState(false);
  const [confirmClear,setConfirmClear]=useState(false);

  function processData(hdrs,data){
    setHeaders(hdrs);
    setRows(data);
    setError("");
    // Auto-detect rating column: mostly 0-10 integers
    let bestCol="";let bestScore=0;
    hdrs.forEach((h,i)=>{
      const vals=data.map(r=>parseFloat(r[i])).filter(v=>!isNaN(v)&&v>=0&&v<=10);
      const score=data.length>0?vals.length/data.length:0;
      if(score>bestScore){bestScore=score;bestCol=h;}
    });
    if(bestCol)setRatingCol(bestCol);
    setResult(null);
    setPreview({hdrs,data});
  }

  function parseCSV(text){
    const lines=text.trim().split(/\r?\n/);
    if(lines.length<2){setError("CSV needs at least a header row and one data row.");return;}
    const parseRow=(line)=>{
      const cells=[];let cur="";let inQ=false;
      for(let i=0;i<line.length;i++){
        const ch=line[i];
        if(ch==='"'){inQ=!inQ;}
        else if(ch===","&&!inQ){cells.push(cur.trim());cur="";}
        else{cur+=ch;}
      }
      cells.push(cur.trim());
      return cells;
    };
    const hdrs=parseRow(lines[0]);
    const data=lines.slice(1).filter(l=>l.trim()).map(parseRow);
    processData(hdrs,data);
  }

  function parseExcel(buffer){
    try{
      const XLSX=window.XLSX;
      if(!XLSX){setError("Excel support loading — try again in a moment.");return;}
      const wb=XLSX.read(buffer,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
      if(json.length<2){setError("Spreadsheet needs at least a header row and one data row.");return;}
      const hdrs=json[0].map(h=>String(h||""));
      const data=json.slice(1).filter(r=>r.some(c=>c!=="")).map(r=>r.map(c=>String(c||"")));
      processData(hdrs,data);
    }catch(e){
      setError("Could not read Excel file. Try saving as CSV and uploading that.");
    }
  }

  function handleFile(file){
    if(!file)return;
    const isCSV=file.name.match(/\.csv$/i);
    const isExcel=file.name.match(/\.(xlsx|xls)$/i);
    if(!isCSV&&!isExcel){setError("Please upload a .csv, .xlsx, or .xls file.");return;}
    setError("");
    const reader=new FileReader();
    if(isCSV){
      reader.onload=e=>parseCSV(e.target.result);
      reader.readAsText(file);
    } else {
      reader.onload=e=>parseExcel(new Uint8Array(e.target.result));
      reader.readAsArrayBuffer(file);
    }
  }

  function calculate(){
    if(!ratingCol){setError("Select the column containing ratings.");return;}
    const colIdx=headers.indexOf(ratingCol);
    if(colIdx<0){setError("Column not found.");return;}
    let promoters=0,passives=0,detractors=0,invalid=0;
    rows.forEach(row=>{
      const val=parseFloat(row[colIdx]);
      if(isNaN(val)||val<0||val>10){invalid++;return;}
      const rounded=Math.round(val);
      if(rounded>=9)promoters++;
      else if(rounded>=7)passives++;
      else detractors++;
    });
    const total=promoters+passives+detractors;
    if(total===0){setError("No valid 0–10 ratings found in that column.");return;}
    const nps=Math.round(((promoters-detractors)/total)*100);
    setResult({promoters,passives,detractors,total,nps,invalid});
    setError("");
  }

  async function saveNPS(){
    if(!result)return;
    setSaving(true);
    onSave(result.nps,result.promoters,result.passives,result.detractors,result.total);
    setSaving(false);
    setPreview(null);setRows([]);setHeaders([]);setResult(null);setRatingCol("");
  }

  const npsColor=result?(result.nps>=50?"#16a34a":result.nps>=0?"#d97706":"#dc2626"):"#64748b";

  // Load SheetJS if not already loaded
  if(typeof window!=="undefined"&&!window.XLSX){
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    document.head.appendChild(s);
  }

  return(
    <div className="space-y-4">
      {/* Current NPS display with delete */}
      {currentNPS>0&&(
        <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50">
          <div className="flex-1">
            <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Current NPS Score</div>
            <div className="text-2xl font-black" style={{color:currentNPS>=50?"#16a34a":currentNPS>=0?"#d97706":"#dc2626"}}>{currentNPS}</div>
            {currentTotal>0&&<div className="text-xs text-slate-400">Based on {currentTotal} responses</div>}
          </div>
          <div className="text-xs text-slate-400 leading-relaxed flex-1">
            NPS ranges from −100 to +100.<br/>≥50 = Excellent · ≥0 = Good · &lt;0 = Needs work
          </div>
          <div className="shrink-0">
            {!confirmClear?(
              <button onClick={()=>setConfirmClear(true)}
                className="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2.5 py-1 rounded-lg transition">
                Clear NPS
              </button>
            ):(
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Sure?</span>
                <button onClick={()=>{onClear();setConfirmClear(false);}}
                  className="text-xs font-bold text-white px-2.5 py-1 rounded-lg" style={{background:"#dc2626"}}>Yes, clear</button>
                <button onClick={()=>setConfirmClear(false)}
                  className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upload zone */}
      <div
        onDragOver={e=>{e.preventDefault();setDragging(true);}}
        onDragLeave={()=>setDragging(false)}
        onDrop={e=>{e.preventDefault();setDragging(false);handleFile(e.dataTransfer.files[0]);}}
        className="rounded-xl border-2 border-dashed p-6 text-center transition cursor-pointer"
        style={{borderColor:dragging?"#29ABE2":"#cbd5e1",background:dragging?"#f0f9ff":"#f8fafc"}}
        onClick={()=>document.getElementById("nps-csv-"+programId)?.click()}>
        <input id={"nps-csv-"+programId} type="file" accept=".csv,.xlsx,.xls" className="hidden"
          onChange={e=>handleFile(e.target.files[0])}/>
        <div className="text-2xl mb-2">📊</div>
        <div className="text-sm font-semibold text-slate-700">Drop your survey file here or click to browse</div>
        <div className="text-xs text-slate-400 mt-1">Supports <strong>.csv</strong>, <strong>.xlsx</strong>, and <strong>.xls</strong> — the app finds the rating column automatically</div>
      </div>

      {error&&<div className="text-sm text-red-600 font-medium">{error}</div>}

      {/* Column selector + calculate */}
      {preview&&(
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-48">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Which column has the 1–10 ratings?</label>
              <select value={ratingCol} onChange={e=>setRatingCol(e.target.value)}
                className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
                <option value="">Select column…</option>
                {headers.map(h=><option key={h}>{h}</option>)}
              </select>
            </div>
            <button onClick={calculate}
              className="shrink-0 px-4 py-2 text-sm font-bold rounded-lg text-white mt-4"
              style={{background:"#1e3a5f"}}>
              Calculate NPS
            </button>
          </div>
          <div className="text-xs text-slate-400">{preview.data.length} response{preview.data.length!==1?"s":""} loaded · {headers.length} columns detected</div>
        </div>
      )}

      {/* Result */}
      {result&&(
        <div className="rounded-xl border overflow-hidden" style={{borderColor:"#e2e8f0"}}>
          <div className="px-4 py-3 flex items-center justify-between" style={{background:"#f8fafc"}}>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-0.5">Calculated NPS</div>
              <div className="text-3xl font-black" style={{color:npsColor}}>{result.nps}</div>
            </div>
            <div className="text-right text-xs text-slate-500 space-y-0.5">
              <div><span className="font-bold text-green-600">{result.promoters}</span> Promoters (9–10)</div>
              <div><span className="font-bold text-amber-500">{result.passives}</span> Passives (7–8)</div>
              <div><span className="font-bold text-red-500">{result.detractors}</span> Detractors (0–6)</div>
              <div className="text-slate-400">{result.total} total{result.invalid>0?` · ${result.invalid} skipped`:""}</div>
            </div>
          </div>
          <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
            Formula: ((Promoters − Detractors) ÷ Total) × 100
          </div>
          <div className="px-4 py-3 border-t border-slate-100 flex justify-end">
            <button onClick={saveNPS} disabled={saving}
              className="px-5 py-2 text-sm font-bold rounded-lg text-white disabled:opacity-40"
              style={{background:"#1e3a5f"}}>
              {saving?"Saving…":"Save NPS to Program →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CRGapPanel({svcTarget,k,p}){
  if(!svcTarget) return null;
  const targetCR = svcTarget.min;
  const actualCR = k.costRecovery;
  const onTarget = actualCR >= targetCR;
  const targetRevenue = k.totalCost * targetCR;
  const gap = targetRevenue - k.revenue;
  // Use actuals enrollment, fall back to budgeted if not yet entered
  const enrollment = p.act_enrollment||p.ant_enrollment||0;
  // Use explicitly entered fee if available, otherwise fall back to implied fee
  const currentFeePerHead = p.fee>0 ? p.fee : (enrollment>0 ? k.revenue/enrollment : null);
  const suggestedFee = enrollment>0 ? targetRevenue/enrollment : null;
  const suggestedFeeIncrease = suggestedFee!=null&&currentFeePerHead!=null ? suggestedFee-currentFeePerHead : null;
  const usingEnteredFee = p.fee>0;
  return(
    <div className="rounded-xl border overflow-hidden"
      style={{borderColor:onTarget?"#bbf7d0":"#fde68a"}}>
      <div className="px-4 py-3 flex items-center gap-2 text-sm"
        style={{background:onTarget?"#f0fdf4":"#fffbeb"}}>
        <span className="text-base">{onTarget?"✓":"⚠"}</span>
        <div className="flex-1">
          <span className="font-semibold" style={{color:onTarget?"#166534":"#92400e"}}>
            {p.service_category} target: {svcTarget.label}
          </span>
          <span className="ml-2 text-xs opacity-75" style={{color:onTarget?"#166534":"#92400e"}}>
            Actual: {pct(actualCR)}
          </span>
        </div>
      </div>
      {!onTarget&&gap>0&&(
        <div className="px-4 py-3 border-t grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm"
          style={{borderColor:"#fde68a",background:"#fefce8"}}>
          <div>
            <div className="text-xs text-amber-700 font-semibold mb-0.5">Revenue Gap</div>
            <div className="text-base font-bold text-amber-800">{dollar(Math.ceil(gap))}</div>
            <div className="text-xs text-amber-600">needed to hit {svcTarget.label}</div>
          </div>
          {suggestedFeeIncrease!=null&&(
            <div>
              <div className="text-xs text-amber-700 font-semibold mb-0.5">Fee Increase Needed</div>
              <div className="text-base font-bold text-amber-800">+{dollar(Math.ceil(suggestedFeeIncrease))}/participant</div>
              <div className="text-xs text-amber-600">based on {enrollment} enrolled</div>
            </div>
          )}
          {suggestedFee!=null&&(
            <div>
              <div className="text-xs text-amber-700 font-semibold mb-0.5">Suggested Fee</div>
              <div className="text-base font-bold text-amber-800">{dollar(Math.ceil(suggestedFee))}/participant</div>
              <div className="text-xs text-amber-600">vs current {dollar(Math.round(currentFeePerHead||0))}/participant{!usingEnteredFee?" (implied from revenue)":""}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
            inputMode={type==="number"?"decimal":undefined}
            style={type==="number"?{MozAppearance:"textfield"}:{}}
            onChange={e=>onChange(type==="number"?parseFloat(e.target.value)||0:e.target.value)}/>
      }
      {hint&&<span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

// ─── Confirm Delete Modal ─────────────────────────────────────────────────────
function ConfirmModal({message,onConfirm,onCancel,confirmLabel="Delete",confirmColor="#ef4444"}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.5)"}} role="dialog" aria-modal="true">
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
function CostPanel({px,p,set,isManager=false}) {
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
          {p.area==="Clubhouse"&&(
            <div className="sm:col-span-2">
              <Inp label="Clubhouse Allocation Fees ($)" type="number"
                value={p[px+"clubhouse_fee"]||""}
                onChange={set(px+"clubhouse_fee")}
                min={0}
                hint="Set automatically by the Clubhouse Allocation Tool in Guide & Resources. Site-specific allocated costs — kept separate from general personnel, commodities, and contractuals above."/>
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Staff Workload</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Inp label="Program Type" value={p[px+"program_type"]||"Custom"} onChange={v=>{
              set(px+"program_type")(v);
              const typePct = PROGRAM_TYPES.find(t=>t.label===v)?.pct||0;
              if(v!=="Custom") set(px+"custom_workload")((typePct*100).toFixed(1));
            }} options={["Custom",...PROGRAM_TYPES.map(t=>t.label)]}/>
            {p[px+"program_type"]&&p[px+"program_type"]!=="Custom"&&(()=>{
              const hint=PROGRAM_TYPES.find(t=>t.label===p[px+"program_type"])?.hint;
              return hint?<div className="text-xs text-slate-400 mt-1 leading-snug">{hint}</div>:null;
            })()}
          </div>
          {(!p[px+"program_type"]||p[px+"program_type"]==="Custom")
            ? <div className="space-y-2">
                <Inp label="Custom Type Name (optional)" type="text"
                  value={p[px+"custom_type_label"]||""}
                  onChange={set(px+"custom_type_label")}
                  placeholder="e.g. Multi-Site Supervisor, Hybrid Program…"
                  hint="Describe this program type for your own reference."/>
                <Inp label="Custom Workload %" type="number" value={p[px+"custom_workload"]} onChange={set(px+"custom_workload")} min={0} max={100} hint="% of the $97,700 FT annual salary attributed to this program. Not your overall job — just this program's share."/>
              </div>
            : isManager
              ? <Inp label="Workload % (editable)" type="number"
                    value={p[px+"custom_workload"]??((PROGRAM_TYPES.find(t=>t.label===p[px+"program_type"])?.pct||0)*100).toFixed(1)}
                    onChange={e=>{
                      const val=e.target.value;
                      const typePct=((PROGRAM_TYPES.find(t=>t.label===p[px+"program_type"])?.pct||0)*100);
                      // Empty = reset to program type default
                      set(px+"custom_workload")(val===""?typePct:parseFloat(val)??typePct);
                    }}
                    min={0} max={100}
                    hint={`% of the $97,700 FT salary for this program only. Clear to reset to program type default (${((PROGRAM_TYPES.find(t=>t.label===p[px+"program_type"])?.pct||0)*100).toFixed(1)}%)`}/>
              : <div className="flex flex-col gap-1 justify-center">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Workload %</label>
                  <div className="text-lg font-bold text-slate-700">{((PROGRAM_TYPES.find(t=>t.label===p[px+"program_type"])?.pct||0)*100).toFixed(1)}%</div>
                  <div className="text-xs text-slate-400">Based on program type</div>
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
function BGPDLogo({size=48}){
  // Inline SVG recreation of BGPD logo: bison silhouette in a sky-blue circle
  return(
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      {/* Sky blue ring */}
      <circle cx="50" cy="50" r="44" fill="none" stroke="#29ABE2" strokeWidth="6"/>
      <circle cx="50" cy="50" r="38" fill="none" stroke="#29ABE2" strokeWidth="2" opacity="0.5"/>
      {/* Bison silhouette in bronze */}
      <g transform="translate(18,22) scale(0.64)">
        <path fill="#8B7335" d="M14,45 C14,45 10,38 12,30 C14,22 20,18 26,20 C28,14 34,10 40,12
          C42,8 48,6 52,10 C58,6 66,8 68,16 C74,16 80,22 78,30
          C82,32 84,38 80,44 C84,46 86,54 80,58
          C84,64 80,72 72,70 C70,76 62,78 56,72
          C52,76 44,76 40,70 C34,74 26,70 26,62
          C18,62 12,54 14,45 Z"/>
      </g>
    </svg>
  );
}

function StaffSetup({onConfirm}) {
  const [name,setName] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{background:"linear-gradient(160deg,#0a1628 0%,#0d2140 60%,#0a1628 100%)"}}>
      <div className="w-full max-w-sm space-y-5">
        {/* Brand header */}
        <div className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <BGPDLogo size={80}/>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">Buffalo Grove</div>
          <div className="text-sm font-bold tracking-widest uppercase mt-0.5" style={{color:"#29ABE2"}}>Park District</div>
          <div className="mt-1 text-xs font-semibold tracking-wider uppercase" style={{color:"#8B7335"}}>Recreation Program Management</div>
        </div>
        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div style={{background:"#29ABE2",height:"4px"}}/>
          <div className="p-8">
            <div className="text-center mb-6">
              <div className="text-base font-bold text-slate-700 mb-1">Sign In</div>
              <div className="text-sm text-slate-400">Enter your first and last name to continue</div>
            </div>
            <div className="space-y-4">
              <Inp label="First & Last Name" value={name} onChange={setName} placeholder="e.g. Jane Smith" required/>
              <button onClick={()=>name.trim()&&onConfirm(name.trim())} disabled={!name.trim()}
                className="w-full py-2.5 text-sm font-bold text-white rounded-lg transition disabled:opacity-40"
                style={{backgroundColor:"#29ABE2"}}>Get Started →</button>
            </div>
            <p className="text-xs text-slate-400 text-center mt-4">Your name is saved on this device only.</p>
          </div>
        </div>
        <p className="text-center text-xs opacity-40 text-white">© Buffalo Grove Park District</p>
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
                <div className="text-xs text-slate-400">{p.area} — {p.season} FY {toFY(p.year)} — {p.staff_name}</div>
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


// ─── Multi-select Filter Bar ──────────────────────────────────────────────────
// Each filter is a Set of selected values. Empty Set = "All" (no filter applied)
function MultiFilter({filters, onChange, counts}) {
  // filters: { staff: Set, area: Set, season: Set, year: Set }
  // counts: { staff:[...], area:[...], season:[...], year:[...] }
  const [open, setOpen] = useState(null); // which dropdown is open

  function toggle(key, val) {
    const next = new Set(filters[key]);
    if (next.has(val)) next.delete(val); else next.add(val);
    onChange(key, next);
  }

  function clearAll() {
    onChange('staff', new Set());
    onChange('area',  new Set());
    onChange('season',new Set());
    onChange('year',  new Set());
  }

  const anyActive = ['staff','area','season','year'].some(k => filters[k].size > 0);

  const LABELS = {staff:'Staff', area:'Area', season:'Season', year:'Year'};

  function label(key) {
    const sel = filters[key];
    if (sel.size === 0) return LABELS[key];
    if (sel.size === 1) {
      const v = [...sel][0];
      return key === 'year' ? `FY ${v}` : v;
    }
    return `${LABELS[key]} (${sel.size})`;
  }

  return (
    <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-2 items-center relative">
      {['staff','area','season','year'].map(key => (
        <div key={key} className="relative">
          <button
            onClick={() => setOpen(open === key ? null : key)}
            aria-expanded={open===key}
            aria-label={`Filter by ${LABELS[key]}`}
            className="flex items-center gap-1.5 text-sm rounded-lg border px-3 py-1.5 transition"
            style={filters[key].size > 0
              ? {background:'#1e3a5f', color:'white', borderColor:'#1e3a5f'}
              : {background:'white', color:'#64748b', borderColor:'#e2e8f0'}}>
            <span>{label(key)}</span>
            <span style={{fontSize:'9px', opacity:.7}}>{open===key?'▲':'▼'}</span>
          </button>
          {open === key && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 min-w-48 py-1 max-h-64 overflow-y-auto">
              {counts[key].map(opt => {
                const sel = filters[key].has(opt);
                const disp = key === 'year' ? `FY ${opt}` : opt;
                return (
                  <button key={opt} onClick={() => toggle(key, opt)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left hover:bg-slate-50 transition"
                    style={{color: sel ? '#1e3a5f' : '#374151'}}>
                    <span className="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-xs"
                      style={sel ? {background:'#1e3a5f', borderColor:'#1e3a5f', color:'white'} : {borderColor:'#d1d5db'}}>
                      {sel ? '✓' : ''}
                    </span>
                    <span className={sel ? 'font-semibold' : ''}>{disp}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      {anyActive && (
        <button onClick={clearAll}
          className="text-xs text-slate-400 hover:text-slate-600 font-medium px-1">
          Clear all
        </button>
      )}
      {/* click outside to close */}
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(null)}/>}
    </div>
  );
}

// ─── Dashboard (Staff View — unchanged from original) ─────────────────────────
function StaffDashboard({programs,staffName,onEdit,onAddProgram}) {
  // Default to filtering by own name so staff see their programs immediately
  const [filters,setFilters] = useState({staff:new Set([staffName].filter(Boolean)),area:new Set(),season:new Set(),year:new Set()});
  const [dv,setDv]           = useState("summary");
  const [showReport,setShowReport] = useState(false);

  function onFilterChange(key, val) { setFilters(f=>({...f,[key]:val})); }

  const allStaff   = [...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas   = [...new Set(programs.map(p=>p.area))];
  const allYears   = [...YEARS];
  const allSeasons = [...SEASONS];

  const vis  = programs
    .filter(p=>!p.is_archived)
    .filter(p=>filters.staff.size===0||filters.staff.has(p.staff_name))
    .filter(p=>filters.area.size===0||filters.area.has(p.area))
    .filter(p=>filters.year.size===0||filters.year.has(toFY(p.year)))
    .filter(p=>filters.season.size===0||filters.season.has(p.season));

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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <MultiFilter filters={filters} onChange={onFilterChange}
          counts={{staff:allStaff,area:allAreas,season:allSeasons,year:allYears}}/>
        <div className="flex gap-2 justify-end">
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
              <button onClick={()=>{ setShowReport(false); printSeasonReport(vis, `${[...filters.staff].join(", ")||"All Staff"} · ${[...filters.area].join(", ")||"All Areas"} · ${[...filters.season].join(", ")||"All Seasons"} · ${[...filters.year].map(y=>`FY ${y}`).join(", ")||"All Years"}`); }}
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
                {["Program","Staff","Area","Season","Fill Rate","Cost Recovery","Net P/(L)","Total Cost","Waitlist","Trend","NPS","Status",""].map(h=>(
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr></thead>
              <tbody>{kpis.map((p,i)=>(
                <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-3 py-2.5 font-semibold text-slate-700">
                    <button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button>
                    {(()=>{
                      const svt=getSvcTarget(p.service_category,p.costRecovery);
                      if(!svt||!p.hasActuals||p.costRecovery>=svt.min) return null;
                      const enrollment=p.act_enrollment||0;
                      const targetRev=p.totalCost*svt.min;
                      const currentFee=p.fee>0?p.fee:(enrollment>0?p.revenue/enrollment:null);
                      const sugFee=enrollment>0?targetRev/enrollment:null;
                      const gap=sugFee!=null&&currentFee!=null?sugFee-currentFee:null;
                      if(!gap||gap<=0) return null;
                      return <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded" style={{background:"#fef3c7",color:"#92400e"}}>+{dollar(Math.ceil(gap))}/person needed</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 text-xs">{p.staff_name}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.area}</td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{p.season} FY {toFY(p.year)}</td>
                  <td className="px-3 py-2.5 font-mono">{pct(p.fillRate)}</td>
                  <td className="px-3 py-2.5 font-mono">{pct(p.costRecovery)}</td>
                  <td className={`px-3 py-2.5 font-mono font-semibold ${p.profitLoss>=0?"text-green-700":"text-red-600"}`}>{dollar(p.profitLoss)}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-500">{dollar(p.totalCost)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.waitlist||0}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.trend}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {p.nps>0?<span className="font-bold" style={{color:p.nps>=50?"#16a34a":p.nps>=0?"#d97706":"#dc2626"}}>{p.nps}</span>:<span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Badge status={p.status}/>
                    
                  </td>
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
                  <td className="px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap">
                    <button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button>
                    {!p.hasActuals&&!p.is_archived&&(
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded font-semibold" style={{background:"#fef3c7",color:"#92400e"}}>Budgeted Only</span>
                    )}

                    {(()=>{
                      const svt=getSvcTarget(p.service_category,p.costRecovery);
                      if(!svt||!p.hasActuals||p.costRecovery>=svt.min) return null;
                      const enrollment=p.act_enrollment||0;
                      const targetRev=p.totalCost*svt.min;
                      const currentFee=p.fee>0?p.fee:(enrollment>0?p.revenue/enrollment:null);
                      const sugFee=enrollment>0?targetRev/enrollment:null;
                      const gap=sugFee!=null&&currentFee!=null?sugFee-currentFee:null;
                      if(!gap||gap<=0) return null;
                      return <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded" style={{background:"#fee2e2",color:"#991b1b"}}>+{dollar(Math.ceil(gap))}/person needed</span>;
                    })()}
                  </td>
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
                  <div className="text-xs text-slate-400">{p.area} - {p.season} FY {toFY(p.year)}</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge status={p.status}/>
                  
                </div>
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
// ─── Section Header (shared by ManagerDashboard) ─────────────────────────────
function SectionHeader({id,title,sub,badge,collapsed,onToggle}) {
  const open = !collapsed[id];
  return(
    <button onClick={()=>onToggle(id)} className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition border-b border-slate-100">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-700 text-sm">{title}</h3>
          {badge&&<span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{background:"#fef3c7",color:"#92400e"}}>{badge}</span>}
        </div>
        {sub&&<p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
      <span className="text-slate-400 text-xs font-bold ml-4 shrink-0" style={{transform:open?"rotate(180deg)":"rotate(0deg)",display:"inline-block",transition:"transform .2s"}}>▼</span>
    </button>
  );
}

// ─── Needs Attention Accordion ───────────────────────────────────────────────
function NeedsAttentionQueue({programs,onEdit}){
  const [open,setOpen]=useState(false);
  return(
    <div className="border border-red-200 rounded-lg overflow-hidden">
      <button onClick={()=>setOpen(o=>!o)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left"
        style={{backgroundColor:"#991b1b"}}>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm">⚠</span>
          <span className="text-xs font-bold uppercase tracking-widest text-white">
            Needs Attention — {programs.length} Program{programs.length!==1?"s":""}
          </span>
        </div>
        <span className="text-white font-bold shrink-0" style={{fontSize:"10px",display:"inline-block",transform:open?"rotate(180deg)":"rotate(0deg)",transition:"transform .2s"}}>▼</span>
      </button>
      {open&&(
        <div className="divide-y divide-red-100 bg-red-50">
          {programs.map(p=>(
            <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-red-100/40">
              <div className="flex-1 min-w-0">
                <button onClick={()=>onEdit(p)} className="text-sm font-semibold text-slate-700 hover:text-blue-600 hover:underline text-left truncate block">{p.name}</button>
                <div className="text-xs text-slate-400">{p.area} — {p.season} FY {toFY(p.year)} — {p.staff_name}</div>
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
      )}
    </div>
  );
}

function ManagerDashboard({programs,staffName,onEdit,onAddProgram}) {
  const [filters,setFilters] = useState({staff:new Set(),area:new Set(),season:new Set(),year:new Set()});
  function onFilterChange(key,val){setFilters(f=>({...f,[key]:val}));}
  const [collapsed,setCollapsed] = useState({topbottom:true,rpp:true,capacity:true,classmix:true,workload:true,snapshot:true,areabreakdown:true,nps:true});
  function toggleSection(id){setCollapsed(s=>({...s,[id]:!s[id]}));}
  // SectionHeader hoisted to module level — see below ManagerDashboard
  const [dv,setDv]           = useState("summary");
  const [sort,setSort]       = useState({col:"name",dir:1});
  const [showReport,setShowReport] = useState(false);

  const allStaff   = [...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas   = [...new Set(programs.map(p=>p.area))];
  const allYears   = [...YEARS];
  const allSeasons = [...SEASONS];

  const vis  = programs
    .filter(p=>!p.is_archived)
    .filter(p=>filters.staff.size===0||filters.staff.has(p.staff_name))
    .filter(p=>filters.area.size===0||filters.area.has(p.area))
    .filter(p=>filters.year.size===0||filters.year.has(toFY(p.year)))
    .filter(p=>filters.season.size===0||filters.season.has(p.season));

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
  // FT Staff allocation totals across all programs
  const antFtStaff = kpis.reduce((a,p)=>a+(calcCR(p,"ant_").ftStaff||0),0);
  const actFtStaff = kpis.reduce((a,p)=>a+(calcCR(p,"act_").ftStaff||0),0);
  // Unique FT staff count from program records (distinct staff_name values)
  const ftStaffCount = new Set(vis.map(p=>p.staff_name).filter(Boolean)).size;
  const ftStaffBudget = ftStaffCount * FT_ANNUAL_SALARY;
  const ftStaffCap60  = ftStaffBudget * 0.60; // 60% allocation target
  const antFtPct  = ftStaffBudget > 0 ? antFtStaff / ftStaffBudget : 0;
  const actFtPct  = ftStaffBudget > 0 ? actFtStaff / ftStaffBudget : 0;
  const healthy  = kpis.filter(p=>p.status==="Healthy").length;
  const monitor  = kpis.filter(p=>p.status==="Monitor").length;
  const redesign = kpis.filter(p=>p.status==="Needs Redesign").length;
  const noActuals= kpis.filter(p=>!p.hasActuals).length;

  // ── Program Snapshot health score (0–100) ──
  // Health Score: fill rate (30%) + cost recovery vs target (30%) +
  //   program status (20%) + participation trend (10%) + waitlist demand (10%)
  const totalPL     = kpis.reduce((a,p)=>a+(p.profitLoss||0),0);
  const totalCosts  = kpis.reduce((a,p)=>a+(p.totalCost||0),0);
  const plSignalMgr = totalPL>=0 ? 1 : Math.max(0, 1+(totalPL/(Math.max(totalCosts,1)*0.5)));
  const healthScore = kpis.length
    ? Math.round((Math.min(avgCR,2)/2*0.40 + avgFill*0.35 + plSignalMgr*0.15 + (healthy/kpis.length)*0.10)*100)
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
      const typePct = p.ant_program_type&&p.ant_program_type!=="Custom"
        ? (PROGRAM_TYPES.find(t=>t.label===p.ant_program_type)?.pct||0)*100
        : 0;
      const wlPct = parseFloat(p.ant_custom_workload)>0
        ? parseFloat(p.ant_custom_workload)
        : typePct;
      map[name].totalWL+=wlPct; map[name].count++;
      if(!map[name].programs) map[name].programs=[];
      map[name].programs.push({name:p.name,wlPct,type:p.ant_program_type||"Custom"});
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
        (toCalYear(p.year)<toCalYear(cur.year) ||
         (toCalYear(p.year)===toCalYear(cur.year) && SEASON_ORDER.indexOf(p.season)<SEASON_ORDER.indexOf(cur.season)))
      );
      if(!candidates.length) return;
      // pick closest prior
      const sorted = candidates.sort((a,b)=>{
        const ay=toCalYear(a.year),by2=toCalYear(b.year),cy=toCalYear(cur.year);
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


  return (
    <div className="space-y-6">

      {/* ── Filters + Export ── */}
      <div className="space-y-2">
        <MultiFilter filters={filters} onChange={onFilterChange}
          counts={{staff:allStaff,area:allAreas,season:allSeasons,year:allYears}}/>
        <div className="flex gap-2 justify-end">
          <button onClick={()=>exportCSV(vis)} className="text-xs font-semibold px-3 py-2 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 transition whitespace-nowrap">↓ Export CSV</button>
          <button onClick={()=>setShowReport(true)} className="text-xs font-semibold px-3 py-2 rounded transition whitespace-nowrap text-white" style={{backgroundColor:"#1e3a5f"}}>⬜ Season Report</button>
        </div>
      </div>
      {showReport&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.7)"}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4">
            <div className="text-base font-bold text-slate-800">Season Performance Report</div>
            <div className="text-sm text-slate-500">This will open your browser's print dialog. Choose "Save as PDF" to export.</div>
            <div className="text-xs text-slate-400">Filters applied: {[...filters.staff].join(", ")||"All Staff"} · {[...filters.area].join(", ")||"All Areas"} · {[...filters.season].join(", ")||"All Seasons"} · {[...filters.year].map(y=>`FY ${y}`).join(", ")||"All Years"} · {vis.length} programs</div>
            <div className="flex gap-3 justify-center pt-2">
              <button onClick={()=>setShowReport(false)} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button onClick={()=>{ setShowReport(false); printSeasonReport(vis, `${[...filters.staff].join(", ")||"All Staff"} · ${[...filters.area].join(", ")||"All Areas"} · ${[...filters.season].join(", ")||"All Seasons"} · ${[...filters.year].map(y=>`FY ${y}`).join(", ")||"All Years"}`); }}
                className="px-5 py-2 text-sm font-semibold text-white rounded-lg" style={{backgroundColor:"#1e3a5f"}}>Save as PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Needs Attention Queue ── */}
      {needsAttention.length>0&&<NeedsAttentionQueue programs={needsAttention} onEdit={onEdit}/>}

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
          <div className="text-xs text-slate-400 mt-1">Cost recovery (40%) · Fill rate (35%) · Net P/L (15%) · Program mix (10%)</div>
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
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <SectionHeader id="snapshot" title="Program Snapshot: Budgeted vs Actual" sub="Portfolio totals — revenue, enrollment, and cost vs. plan" collapsed={collapsed} onToggle={toggleSection}/>
        {!collapsed["snapshot"]&&<div className="p-5 space-y-5">
          <PBar label="Total Revenue"      actual={actRev}  budget={antRev}  ff={v=>dollar(v)}/>
          <PBar label="Total Enrollment"   actual={actEnr}  budget={antEnr}  ff={v=>v.toString()}/>
          <PBar label="Total Program Cost" actual={actCost} budget={antCost} ff={v=>dollar(v)} inv/>

          {/* FT Staff Allocation vs Capacity */}
          <div className="pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">FT Staff Allocation vs. Capacity</div>
                <div className="text-xs text-slate-400 mt-0.5">{ftStaffCount} FT staff × ${FT_ANNUAL_SALARY.toLocaleString()} = ${ftStaffBudget.toLocaleString()} total · 60% target = ${Math.round(ftStaffCap60).toLocaleString()}</div>
              </div>
            </div>
            {/* Budgeted */}
            <div className="mb-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500 font-medium">Budgeted FT Staff Cost</span>
                <span className="font-mono font-semibold" style={{color: antFtPct > 0.6 ? "#dc2626" : antFtPct > 0.5 ? "#d97706" : "#16a34a"}}>
                  {dollar(Math.round(antFtStaff))} — {(antFtPct*100).toFixed(1)}% of payroll
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{
                  width: Math.min(antFtPct/0.6*100, 100)+"%",
                  background: antFtPct > 0.6 ? "#dc2626" : antFtPct > 0.5 ? "#d97706" : "#29ABE2"
                }}/>
              </div>
            </div>
            {/* Actuals */}
            <div className="mb-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500 font-medium">Actual FT Staff Cost</span>
                <span className="font-mono font-semibold" style={{color: actFtPct > 0.6 ? "#dc2626" : actFtPct > 0.5 ? "#d97706" : "#16a34a"}}>
                  {dollar(Math.round(actFtStaff))} — {(actFtPct*100).toFixed(1)}% of payroll
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{
                  width: Math.min(actFtPct/0.6*100, 100)+"%",
                  background: actFtPct > 0.6 ? "#dc2626" : actFtPct > 0.5 ? "#d97706" : "#16a34a"
                }}/>
              </div>
            </div>
            {/* 60% target line label */}
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-3 h-0.5 bg-slate-400"/>
              <span className="text-xs text-slate-400">60% target = {dollar(Math.round(ftStaffCap60))}</span>
              {antFtPct > 0.6 && <span className="text-xs font-semibold text-red-500 ml-2">⚠ Budgeted over 60%</span>}
              {actFtPct > 0.6 && <span className="text-xs font-semibold text-red-500 ml-2">⚠ Actuals over 60%</span>}
              {antFtPct <= 0.6 && actFtPct <= 0.6 && antFtStaff > 0 && <span className="text-xs font-semibold text-green-600 ml-2">✓ Under 60%</span>}
            </div>
          </div>
        </div>}
      </div>

      {/* ── Programs by Area ── */}
      {areaRollup.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <SectionHeader id="areabreakdown" title="Programs by Area" sub="Inventory distribution, avg fill rate, and net P/L by area" collapsed={collapsed} onToggle={toggleSection}/>
          {!collapsed["areabreakdown"]&&<div className="p-4 space-y-2.5">
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
          </div>}
        </div>
      )}

      {/* ── Top/Bottom Performers ── */}
      {kpis.length>=3&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <SectionHeader id="topbottom" title="Top & Bottom Performers" sub="Fill rate and cost recovery leaders and laggards" collapsed={collapsed} onToggle={toggleSection}/>
          {!collapsed["topbottom"]&&<div className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    <div className="text-xs text-slate-400">{p.area} — {p.season} FY {toFY(p.year)}</div>
                  </div>
                  <div className={`text-sm font-bold ${good?"text-green-700":"text-red-600"}`}>{metric(p)}</div>
                </div>
              ))}
            </div>
          ))}
          </div>}
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
                <div className="text-xs text-slate-400">{p.area} — {p.season} FY {toFY(p.year)} — {p.staff_name}</div>
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
          <SectionHeader id="rpp" title="Revenue per Participant by Area" sub={`Overall avg: ${totalActEnr>0?dollar(revPerPart):"—"}`} collapsed={collapsed} onToggle={toggleSection}/>
          {!collapsed["rpp"]&&<div>
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
          </div>}
        </div>
      )}

      {/* ── NPS Summary ── */}
      {withNPS.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <SectionHeader id="nps" title="NPS Summary" sub={`${withNPS.length} of ${kpis.length} programs have NPS data · Portfolio avg NPS: ${avgNPS??'—'}`} badge={avgNPS!=null?(avgNPS>=50?"Strong":avgNPS>=0?"Acceptable":"Needs Review"):null} collapsed={collapsed} onToggle={toggleSection}/>
          {!collapsed["nps"]&&<><div className="px-4 py-3 border-b border-slate-100 flex items-center justify-end">
            <div className="text-right">
              <div className="text-xs text-slate-400">Portfolio Avg NPS</div>
              <div className={`text-2xl font-black ${avgNPS>=50?"text-green-600":avgNPS>=0?"text-amber-500":"text-red-500"}`}>{avgNPS??"—"}</div>
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
          {withNPS.length>0&&(
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-2 text-left font-semibold">Program</th>
                  <th className="px-4 py-2 text-center font-semibold text-green-600">Promoters</th>
                  <th className="px-4 py-2 text-center font-semibold text-amber-500">Passives</th>
                  <th className="px-4 py-2 text-center font-semibold text-red-500">Detractors</th>
                  <th className="px-4 py-2 text-center font-semibold">Total</th>
                  <th className="px-4 py-2 text-center font-semibold">NPS</th>
                </tr></thead>
                <tbody>{withNPS.sort((a,b)=>b.nps-a.nps).map((p,i)=>{
                  const npsColor=p.nps>=50?"#16a34a":p.nps>=0?"#d97706":"#dc2626";
                  return(
                    <tr key={p.id} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                      <td className="px-4 py-2.5">
                        <button onClick={()=>onEdit(p)} className="font-semibold text-slate-700 hover:text-blue-600 hover:underline text-left">{p.name}</button>
                        <div className="text-slate-400">{p.area} · {p.season}</div>
                      </td>
                      <td className="px-4 py-2.5 text-center font-bold text-green-600">{p.nps_promoters||"—"}</td>
                      <td className="px-4 py-2.5 text-center font-bold text-amber-500">{p.nps_passives||"—"}</td>
                      <td className="px-4 py-2.5 text-center font-bold text-red-500">{p.nps_detractors||"—"}</td>
                      <td className="px-4 py-2.5 text-center text-slate-400">{p.nps_total||"—"}</td>
                      <td className="px-4 py-2.5 text-center font-black" style={{color:npsColor}}>{p.nps}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </>}
        </div>
      )}

      {/* ── Capacity Utilization by Area ── */}
      {areaRollup.length>1&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <SectionHeader id="capacity" title="Capacity Utilization by Area" sub="Avg fill rate per area — green ≥70%, yellow 60–69%, red <60%" collapsed={collapsed} onToggle={toggleSection}/>
          {!collapsed["capacity"]&&<div className="p-4 space-y-3">
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
          </div>}
        </div>
      )}

      {/* ── Classification Mix ── */}
      {classMix.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <SectionHeader id="classmix" title="Program Mix by Classification" sub="Balance of community service vs. revenue-generating programs" collapsed={collapsed} onToggle={toggleSection}/>
          {!collapsed["classmix"]&&<div className="p-4">
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
          </div>}
        </div>
      )}


      {/* ── Staff Workload Allocation ── */}
      {workloadByStaff.length>0&&(
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <SectionHeader id="workload" title="Staff Workload Allocation"
            sub="Total FT time across all programs — 100% = one full-time salary"
            badge={workloadByStaff.some(s=>s.totalWL>60)?"⚠ Over-allocation flagged":null} collapsed={collapsed} onToggle={toggleSection}/>
          {!collapsed["workload"]&&<div className="p-4 space-y-3">
            {workloadByStaff.map(s=>{
              const over = s.totalWL>75;
              const warn = s.totalWL>60&&!over;
              const color = over?"#dc2626":warn?"#d97706":"#1e3a5f";
              const bg    = over?"#fee2e2":warn?"#fef3c7":"#e0e7ff";
              const barW  = Math.min((s.totalWL/60)*50,100); // 60% maps to midpoint (50% of bar width)
              const flagged = s.programs?.filter(p=>p.wlPct>0)||[];
              return(
                <div key={s.name}>
                  <div className="flex items-center justify-between mb-1 gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-slate-700 truncate">{s.name}</span>
                      <span className="text-xs text-slate-400">{s.count} program{s.count!==1?"s":""}</span>
                      {over&&<span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0" style={{background:"#fee2e2",color:"#dc2626"}}>Over-allocated</span>}
                      {warn&&<span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0" style={{background:"#fef3c7",color:"#d97706"}}>Review needed</span>}
                    </div>
                    <span className="text-sm font-bold shrink-0" style={{color}}>{s.totalWL.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden mb-1" style={{background:"#f1f5f9",position:"relative"}}>
                    {/* 60% marker line */}
                    <div className="absolute top-0 bottom-0 w-px bg-slate-400 opacity-50 z-10" style={{left:"50%"}}/>
                    <div className="h-full rounded-full transition-all" style={{width:`${barW}%`,background:color}}/>
                  </div>
                  {(over||warn)&&flagged.length>0&&(
                    <div className="mt-1.5 text-xs text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5">
                      {flagged.map((pr,i)=>(
                        <span key={i}>{pr.name} <span className="font-mono font-semibold" style={{color}}>{pr.wlPct.toFixed(1)}%</span></span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>}
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-400">
            Bar midpoint = 60% (recommended program allocation ceiling). Amber = 60–75%, Red = over 75%. The remaining ~40% covers meetings, marketing, planning, and strategic work.
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
                {[["name","Program"],["staff_name","Staff"],["area","Area"],["season","Season"],["fillRate","Fill Rate"],["costRecovery","Cost Recovery"],["profitLoss","Net P/(L)"],["totalCost","Total Cost"],["waitlist","Waitlist"],["trend","Trend"],["nps","NPS"],["status","Status"],[null,"vs Prior"],[null,""]].map(([col,h])=>(
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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button>
                      {p.notes&&<span title={p.notes} className="text-slate-300 hover:text-slate-500 cursor-help text-xs">●</span>}
                      {(()=>{
                        const svt=getSvcTarget(p.service_category,p.costRecovery);
                        if(!svt||!p.hasActuals||p.costRecovery>=svt.min) return null;
                        // If manager has set a pricing decision, show subsidy badge instead
                        if(p.pricing_decision==="Intentional full subsidy"||p.pricing_rationale){
                          return <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{background:"#e0e7ff",color:"#3730a3"}}>Subsidized</span>;
                        }
                        const enrollment=p.act_enrollment||0;
                        const targetRev=p.totalCost*svt.min;
                        const currentFee=p.fee>0?p.fee:(enrollment>0?p.revenue/enrollment:null);
                        const sugFee=enrollment>0?targetRev/enrollment:null;
                        const gap=sugFee!=null&&currentFee!=null?sugFee-currentFee:null;
                        if(!gap||gap<=0) return null;
                        return <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{background:"#fee2e2",color:"#991b1b"}}>+{dollar(Math.ceil(gap))}/person needed</span>;
                      })()}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 text-xs">{p.staff_name}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.area}</td>
                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{p.season} FY {toFY(p.year)}</td>
                  <td className="px-3 py-2.5 font-mono">{pct(p.fillRate)}</td>
                  <td className="px-3 py-2.5 font-mono">{pct(p.costRecovery)}</td>
                  <td className={`px-3 py-2.5 font-mono font-semibold ${p.profitLoss>=0?"text-green-700":"text-red-600"}`}>{dollar(p.profitLoss)}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-500">{dollar(p.totalCost)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.waitlist||0}</td>
                  <td className="px-3 py-2.5 text-slate-500">{p.trend}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {p.nps>0?<span className="font-bold" style={{color:p.nps>=50?"#16a34a":p.nps>=0?"#d97706":"#dc2626"}}>{p.nps}</span>:<span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Badge status={p.status}/>
                    
                  </td>
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
                  <td className="px-3 py-2.5 font-semibold text-slate-700 whitespace-nowrap">
                    <button onClick={()=>onEdit(p)} className="hover:text-blue-600 hover:underline text-left">{p.name}</button>
                    {!p.hasActuals&&!p.is_archived&&(
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded font-semibold" style={{background:"#fef3c7",color:"#92400e"}}>Budgeted Only</span>
                    )}

                    {(()=>{
                      const svt=getSvcTarget(p.service_category,p.costRecovery);
                      if(!svt||!p.hasActuals||p.costRecovery>=svt.min) return null;
                      const enrollment=p.act_enrollment||0;
                      const targetRev=p.totalCost*svt.min;
                      const currentFee=p.fee>0?p.fee:(enrollment>0?p.revenue/enrollment:null);
                      const sugFee=enrollment>0?targetRev/enrollment:null;
                      const gap=sugFee!=null&&currentFee!=null?sugFee-currentFee:null;
                      if(!gap||gap<=0) return null;
                      return <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded" style={{background:"#fee2e2",color:"#991b1b"}}>+{dollar(Math.ceil(gap))}/person needed</span>;
                    })()}
                  </td>
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
                  <div className="text-xs text-slate-400">{p.area} - {p.season} FY {toFY(p.year)}{p.staff_name?" - "+p.staff_name:""}</div>
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
  const [showSingle,setShowSingle] = useState(false);
  const multiCount = (() => {
    const groups = {};
    programs.filter(p=>!p.is_archived).forEach(p=>{
      const k = `${p.name}||${p.staff_name}`;
      groups[k] = (groups[k]||0)+1;
    });
    return Object.values(groups).filter(v=>v>=2).length;
  })();
  const groups = useMemo(()=>{
    const map = {};
    programs.filter(p=>!p.is_archived).forEach(p=>{
      const key = `${(p.name||"").toLowerCase().trim()}__${(p.staff_name||"").toLowerCase().trim()}`;
      if(!map[key]) map[key]={name:p.name,area:p.area,staff:p.staff_name,seasons:[]};
      const k = calcKPIs(p);
      map[key].seasons.push({...p,...k});
    });
    return Object.values(map)
      .filter(g=>showSingle||g.seasons.length>1)
      .filter(g=>!search||g.name.toLowerCase().includes(search.toLowerCase())||g.staff?.toLowerCase().includes(search.toLowerCase()))
      .sort((a,b)=>{
        if(b.seasons.length!==a.seasons.length) return b.seasons.length-a.seasons.length;
        return a.name.localeCompare(b.name);
      });
  },[programs,search,showSingle]);

  return (
    <div className="space-y-4">
      {multiCount===0&&(
        <div className="rounded-xl border border-slate-200 p-5 text-center space-y-2 bg-slate-50">
          <div className="text-2xl">📅</div>
          <div className="font-bold text-slate-700 text-sm">Multi-Season View</div>
          <div className="text-sm text-slate-500 max-w-sm mx-auto">This view groups programs that run across multiple seasons, showing trends over time. It becomes most valuable once you have two or more seasons of data entered. Keep entering programs and come back here next season.</div>
        </div>
      )}
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-slate-700 text-sm">Multi-Season View</h2>
            <p className="text-xs text-slate-400 mt-0.5">Programs offered in more than one season — matched by name and staff member. Sorted most seasons first.</p>
          </div>
          <button onClick={()=>setShowSingle(s=>!s)}
            className="text-xs px-3 py-1.5 rounded-lg border transition whitespace-nowrap shrink-0"
            style={showSingle?{background:"#1e3a5f",color:"white",borderColor:"#1e3a5f"}:{borderColor:"#e2e8f0",color:"#64748b"}}>
            {showSingle?"Showing all":"Show single-season"}
          </button>
        </div>
        <input className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2"
          placeholder="Search by program name or staff..." value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>
      {groups.length===0&&(
        <div className="bg-white rounded-lg shadow-sm p-8 text-center text-slate-400 text-sm">
          {search
            ? "No matching programs."
            : showSingle
              ? "No active programs found."
              : "No programs with more than one season yet. Try toggling \"Show single-season\" to see all programs."}
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
              <tbody>{g.seasons.sort((a,b)=>{
                const SO=["Spring","Summer","Fall","Winter","All Year"];
                const ya=toCalYear(a.year),yb=toCalYear(b.year);
                if(ya!==yb) return ya-yb;
                return SO.indexOf(a.season)-SO.indexOf(b.season);
              }).map((s,i)=>(
                <tr key={s.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                  <td className="px-4 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{s.season} FY {toFY(s.year)}</td>
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


const CB_COST_CATEGORIES = [
  "Program Supplies","Office Supplies","Staff Shirts","Kid Shirts",
  "MIS / Technology","Staffing","Other",
];



// ─── Sub-Program / Session Tracker ───────────────────────────────────────────
function SubProgramTracker({programs,onChange}){
  const [open,setOpen]=useState(false);
  const list=Array.isArray(programs)?programs:[];

  function addRow(){
    onChange([...list,{id:Date.now(),label:"",day:"",time:"",capacity:0,enrollment:0}]);
  }
  function updateRow(id,field,val){
    onChange(list.map(r=>r.id===id?{...r,[field]:val}:r));
  }
  function removeRow(id){
    onChange(list.filter(r=>r.id!==id));
  }

  const totalCap=list.reduce((a,r)=>a+(parseInt(r.capacity)||0),0);
  const totalEnr=list.reduce((a,r)=>a+(parseInt(r.enrollment)||0),0);
  const overallFill=totalCap>0?(totalEnr/totalCap)*100:0;

  return(
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={()=>setOpen(o=>!o)}
        className="w-full px-4 py-3 flex items-center justify-between text-left bg-slate-50 hover:bg-slate-100 transition">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-700">📋 Individual Classes / Sessions</span>
            {list.length>0&&<span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{background:"#e0e7ff",color:"#3730a3"}}>{list.length} session{list.length!==1?"s":""}</span>}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Optional — track separate days/times within this program (e.g. Mon 5pm, Wed 6pm)</div>
        </div>
        <span className="text-slate-400 text-xs font-bold ml-4 shrink-0" style={{transform:open?"rotate(180deg)":"rotate(0deg)",display:"inline-block",transition:"transform .2s"}}>▼</span>
      </button>
      {open&&(
        <div className="p-4 space-y-3">
          {list.length>0&&(
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-slate-400 uppercase tracking-wider">
                  <th className="px-2 py-1.5 text-left font-semibold">Class / Session</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Day</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Time</th>
                  <th className="px-2 py-1.5 text-center font-semibold">Capacity</th>
                  <th className="px-2 py-1.5 text-center font-semibold">Enrolled</th>
                  <th className="px-2 py-1.5 text-center font-semibold">Fill %</th>
                  <th className="px-2 py-1.5"/>
                </tr></thead>
                <tbody>{list.map((r,i)=>{
                  const fill=r.capacity>0?Math.round((r.enrollment/r.capacity)*100):null;
                  const fillColor=fill!=null?(fill>=70?"#16a34a":fill>=60?"#d97706":"#dc2626"):"#94a3b8";
                  return(
                    <tr key={r.id} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                      <td className="px-2 py-1.5"><input value={r.label} onChange={e=>updateRow(r.id,"label",e.target.value)} placeholder="e.g. Beginners" className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1"/></td>
                      <td className="px-2 py-1.5"><input value={r.day} onChange={e=>updateRow(r.id,"day",e.target.value)} placeholder="Mon" className="w-16 rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1"/></td>
                      <td className="px-2 py-1.5"><input value={r.time} onChange={e=>updateRow(r.id,"time",e.target.value)} placeholder="5:00pm" className="w-20 rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1"/></td>
                      <td className="px-2 py-1.5"><input type="number" min={0} value={r.capacity||""} onChange={e=>updateRow(r.id,"capacity",parseInt(e.target.value)||0)} className="w-16 rounded border border-slate-200 px-2 py-1 text-xs text-center focus:outline-none focus:ring-1" style={{MozAppearance:"textfield"}}/></td>
                      <td className="px-2 py-1.5"><input type="number" min={0} value={r.enrollment||""} onChange={e=>updateRow(r.id,"enrollment",parseInt(e.target.value)||0)} className="w-16 rounded border border-slate-200 px-2 py-1 text-xs text-center focus:outline-none focus:ring-1" style={{MozAppearance:"textfield"}}/></td>
                      <td className="px-2 py-1.5 text-center font-bold" style={{color:fillColor}}>{fill!=null?fill+"%":"—"}</td>
                      <td className="px-2 py-1.5"><button onClick={()=>removeRow(r.id)} className="text-red-300 hover:text-red-500 text-xs font-bold">✕</button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {list.length>0&&(
            <div className="flex items-center gap-4 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
              <span className="text-slate-500">Total: <span className="font-bold text-slate-700">{totalEnr}/{totalCap}</span> enrolled</span>
              <span className="font-bold" style={{color:overallFill>=70?"#16a34a":overallFill>=60?"#d97706":"#dc2626"}}>{totalCap>0?Math.round(overallFill)+"%":"—"} overall fill</span>
              {totalCap>0&&overallFill<70&&<span className="text-amber-600 font-semibold">⚠ Some classes may be underperforming</span>}
            </div>
          )}
          <button onClick={addRow} className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition">
            + Add Session
          </button>
          <p className="text-xs text-slate-400">Sessions are saved with this program. The main Enrollment field above should still reflect the total across all sessions.</p>
        </div>
      )}
    </div>
  );
}

function ProgramForm({initial,staffName,isManager,programs=[],onSave,onDelete,onArchive,onDuplicate,onCancel,saving}) {
  const [p,setP]             = useState(()=> initial ? {...cleanForDB(initial), decision_log: initial.decision_log||[], other1_label: initial.other1_label||"Other Direct Costs", other2_label: initial.other2_label||"Other Direct Costs 2"} : newProgram(staffName));
  const set                  = k => v => setP(prev=>({...prev,[k]:v}));
  const [sec,setSec]         = useState("info");
  const [confirm,setConfirm]         = useState(false);
  const [confirmArchive,setConfirmArchive] = useState(false);
  const [logEntry,setLogEntry] = useState("");
  const [dirty,setDirty]     = useState(false);
  const isNew                = !initial;
  const canEdit              = p.staff_name===staffName||!initial||isManager;

  // Compute this staff member's total workload across all their OTHER programs
  const staffTotalWL = useMemo(()=>{
    if(!isManager||!p.staff_name) return 0;
    return programs
      .filter(prog=>!prog.is_archived&&prog.staff_name===p.staff_name&&prog.id!==p.id)
      .reduce((sum,prog)=>{
        const cust=parseFloat(prog.ant_custom_workload)||0;
        const typePct=prog.ant_program_type&&prog.ant_program_type!=="Custom"
          ? (PROGRAM_TYPES.find(t=>t.label===prog.ant_program_type)?.pct||0)*100 : 0;
        return sum+(cust>0?cust:typePct);
      },0);
  },[programs,p.staff_name,p.id]);

  const thisWL = parseFloat(p.ant_custom_workload)>0
    ? parseFloat(p.ant_custom_workload)
    : p.ant_program_type&&p.ant_program_type!=="Custom"
      ? (PROGRAM_TYPES.find(t=>t.label===p.ant_program_type)?.pct||0)*100 : 0;
  const projectedWL = staffTotalWL + thisWL;
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

  const tabs = [{id:"info",label:"Program Info"},{id:"budgeted",label:p.ant_enrollment>0||p.ant_revenue>0?"Budgeted ✓":"Budgeted"},{id:"actuals",label:p.act_enrollment>0||p.act_revenue>0?"Actuals ✓":"Actuals"},{id:"summary",label:"Summary"},...(isManager?[{id:"pricing",label:"💰 Pricing"}]:[]),{id:"log",label:`Log${log.length>0?" ("+log.length+")":""}`}];

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
        <div className="rounded-xl border-2 px-5 py-5 flex items-start gap-4"
          style={{background:"#fffbeb",borderColor:"#d4a017"}}>
          <span className="text-2xl shrink-0">📋</span>
          <div className="flex-1">
            <div className="font-bold text-amber-800 text-base mb-1">No actuals entered yet</div>
            <div className="text-amber-700 text-sm mb-3">Once your program has run, come back and fill in the Actuals tab — enrollment, revenue, and any direct costs. This unlocks your cost recovery analysis, fee gap, and suggested pricing on the Summary tab.</div>
            <button onClick={()=>setSec("actuals")}
              className="inline-flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-lg text-white transition"
              style={{backgroundColor:"#d4a017",color:"#1e3a5f"}}>
              Go to Actuals tab →
            </button>
          </div>
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
        <div className="flex border-b border-slate-100 overflow-x-auto scrollbar-none">
          {tabs.map(s=>(
            <button key={s.id} onClick={()=>setSec(s.id)}
              className={`px-3 py-3 text-xs sm:text-sm font-semibold whitespace-nowrap border-b-2 transition ${sec===s.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`}
              style={sec===s.id?{borderColor:"#d4a017"}:{}}>{s.label}</button>
          ))}
        </div>
        {!isNew&&p.name&&(
          <div className="px-5 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 truncate">{p.name}</span>
            {p.area&&<span className="text-xs text-slate-300">·</span>}
            {p.area&&<span className="text-xs text-slate-400">{p.area}</span>}
            {p.season&&p.year&&<><span className="text-xs text-slate-300">·</span><span className="text-xs text-slate-400">{p.season} FY {toFY(p.year)}</span></>}
          </div>
        )}
        <div className="p-5">
          {sec==="info"&&(
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Inp label="Program Name"        value={p.name}                 onChange={setField("name")}              required placeholder="e.g. Youth Basketball"/>
                <Inp label="Staff Member"        value={p.staff_name}           onChange={setField("staff_name")}        required placeholder="Your name"/>
                <Inp label="Area"                value={p.area}                 onChange={setField("area")}              options={AREAS}/>
                <div>
                  <Inp label="Season"              value={p.season}               onChange={v=>{setField("season")(v);setField("budget_mode")(v==="All Year"?"annual":"seasonal");}}  options={SEASONS}/>
                  {p.season==="All Year"&&(
                    <div className="mt-1 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-700">
                      <span className="font-bold">Annual Budget Mode.</span> Costs and revenue are for the full year. Fill rate and cost recovery are calculated normally — but in dashboard filters, this program shows under "All Year" rather than a specific season.
                    </div>
                  )}
                </div>
                <Inp label="Year"                value={p.year}                 onChange={setField("year")}              options={YEARS}/>
                <Inp label="Classification"      value={p.classification}       onChange={setField("classification")}    options={CLASSIFICATIONS}/>
                <div>
                  <Inp label="Service Category"  value={p.service_category||""} onChange={setField("service_category")} options={["",...SERVICE_CATEGORIES]}/>
                  {p.service_category&&SVC_TARGET_MAP[p.service_category]&&(
                    <div className="mt-1 text-xs text-slate-400">Target: <span className="font-semibold text-slate-500">{SVC_TARGET_MAP[p.service_category].label}</span></div>
                  )}
                </div>
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
              <div className="mb-5 p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-blue-600 uppercase tracking-widest">Budgeted</div>
                  <div className="text-xs text-blue-400 mt-0.5">What you think this program will do. You can update these at any time.</div>
                </div>
                {(p.ant_enrollment>0||p.ant_revenue>0||p.ant_capacity>0)&&(
                  <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold" style={{background:"#dcfce7",color:"#166534"}}>
                    <span>✓</span><span>Budgeted</span>
                  </div>
                )}
              </div>
              <CostPanel px="ant_" p={p} set={k=>v=>{setField(k)(v);}} isManager={isManager}/>
              
              {(p.ant_enrollment>0||p.ant_revenue>0||p.ant_capacity>0)&&!hasActuals&&(
                <div className="mt-5 p-4 rounded-xl border-2 border-dashed text-center" style={{borderColor:"#d4a017",background:"#fffbeb"}}>
                  <div className="text-sm font-bold mb-1" style={{color:"#92400e"}}>✓ Budgeted complete — you're done for now</div>
                  <div className="text-xs" style={{color:"#b45309"}}>Come back after the season runs to enter actuals on the Actuals tab. That's when the cost recovery and fee gap analysis will appear.</div>
                </div>
              )}
            </div>
          )}
          {sec==="actuals"&&(
            <div>
              <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Actuals</div>
                <div className="text-xs text-slate-400 mt-0.5">Update these as the program runs or after it concludes.</div>
              </div>
              <CostPanel px="act_" p={p} set={k=>v=>{setField(k)(v);}} isManager={isManager}/>
              <div className="mt-6 pt-5 border-t border-slate-100">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Post-Program Observations</div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Inp label="Participation Trend" value={p.trend||"New"} onChange={setField("trend")} options={TRENDS}/>
                  <div className="sm:col-span-3 mt-2">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">NPS — Net Promoter Score</div>
                    {isManager?(
                      <div className="space-y-4">
                        {/* Toggle */}
                        <div className="flex gap-2">
                          {["manual","upload"].map(mode=>(
                            <button key={mode} onClick={()=>setField("_npsMode")(mode)}
                              className="text-xs px-3 py-1.5 rounded-lg border font-semibold transition"
                              style={(p._npsMode||"manual")===mode
                                ?{background:"#1e3a5f",color:"#fff",borderColor:"#1e3a5f"}
                                :{background:"#f8fafc",color:"#475569",borderColor:"#e2e8f0"}}>
                              {mode==="manual"?"✏ Enter manually":"📊 Upload CSV"}
                            </button>
                          ))}
                        </div>
                        {(p._npsMode||"manual")==="manual"?(
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <Inp label="NPS Score (-100 to 100)" type="number" value={p.nps||""} onChange={setField("nps")} min={-100} max={100} hint="Calculated or estimated"/>
                              <Inp label="Promoters (9–10)" type="number" value={p.nps_promoters||""} onChange={setField("nps_promoters")} min={0} hint="Optional"/>
                              <Inp label="Passives (7–8)" type="number" value={p.nps_passives||""} onChange={setField("nps_passives")} min={0} hint="Optional"/>
                              <Inp label="Detractors (0–6)" type="number" value={p.nps_detractors||""} onChange={setField("nps_detractors")} min={0} hint="Optional"/>
                            </div>
                            {p.nps_promoters>0||p.nps_passives>0||p.nps_detractors>0?(
                              <div className="text-xs text-slate-400 p-3 rounded-lg bg-slate-50 border border-slate-100">
                                {(()=>{
                                  const total=(parseInt(p.nps_promoters)||0)+(parseInt(p.nps_passives)||0)+(parseInt(p.nps_detractors)||0);
                                  const calc=total>0?Math.round(((parseInt(p.nps_promoters)||0)-(parseInt(p.nps_detractors)||0))/total*100):null;
                                  return calc!=null?(<span>Calculated NPS from breakdown: <strong className="text-slate-700">{calc}</strong> · {total} total responses</span>):null;
                                })()}
                              </div>
                            ):null}
                          </div>
                        ):(
                          <NPSUploader
                            programId={p.id||"new"}
                            programName={p.name}
                            currentNPS={p.nps||0}
                            currentTotal={p.nps_total||0}
                            onSave={(nps,promoters,passives,detractors,total)=>{
                              setField("nps")(nps);
                              setField("nps_promoters")(promoters);
                              setField("nps_passives")(passives);
                              setField("nps_detractors")(detractors);
                              setField("nps_total")(total);
                            }}
                            onClear={()=>{
                              setField("nps")(0);
                              setField("nps_promoters")(0);
                              setField("nps_passives")(0);
                              setField("nps_detractors")(0);
                              setField("nps_total")(0);
                            }}
                          />
                        )}
                      </div>
                    ):(
                      /* Staff: manual entry only */
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <Inp label="NPS Score (-100 to 100)" type="number" value={p.nps||""} onChange={setField("nps")} min={-100} max={100} hint="From your survey results"/>
                          <Inp label="Promoters (9–10)" type="number" value={p.nps_promoters||""} onChange={setField("nps_promoters")} min={0} hint="Optional"/>
                          <Inp label="Passives (7–8)" type="number" value={p.nps_passives||""} onChange={setField("nps_passives")} min={0} hint="Optional"/>
                          <Inp label="Detractors (0–6)" type="number" value={p.nps_detractors||""} onChange={setField("nps_detractors")} min={0} hint="Optional"/>
                        </div>
                        {(p.nps_promoters>0||p.nps_passives>0||p.nps_detractors>0)&&(()=>{
                          const total=(parseInt(p.nps_promoters)||0)+(parseInt(p.nps_passives)||0)+(parseInt(p.nps_detractors)||0);
                          const calc=total>0?Math.round(((parseInt(p.nps_promoters)||0)-(parseInt(p.nps_detractors)||0))/total*100):null;
                          return calc!=null?(<div className="text-xs text-slate-400 p-3 rounded-lg bg-slate-50 border border-slate-100">Calculated NPS from breakdown: <strong className="text-slate-700">{calc}</strong> · {total} total responses</div>):null;
                        })()}
                        <p className="text-xs text-slate-400">Enter the NPS score from your survey results. The score ranges from −100 to +100 — positive is good, 50+ is excellent.</p>
                      </div>
                    )}
                  </div>
                  <Inp label="Waitlist" type="number" value={p.waitlist!=null?p.waitlist:""} onChange={v=>setField("waitlist")(v===""?null:Math.max(0,parseInt(v)||0))} min={0} hint="Enter 0 to confirm no waitlist, or leave blank if unknown"/>
                </div>
              </div>
              
              <SubProgramTracker
                programs={Array.isArray(p.sub_programs)?p.sub_programs:[]}
                onChange={v=>setField("sub_programs")(v)}/>
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
              {/* Read-only CR status for all users on Summary tab */}
              {svcTarget&&(hasActuals||p.fee>0)&&(()=>{
                const onTarget=k.costRecovery>=svcTarget.min;
                return(
                  <div className={`rounded-xl px-4 py-3 flex items-center gap-3 border text-sm ${onTarget?"bg-green-50 border-green-200":"bg-amber-50 border-amber-200"}`}>
                    <span className="text-lg">{onTarget?"✓":"⚠"}</span>
                    <div className="flex-1">
                      <span className="font-semibold" style={{color:onTarget?"#166534":"#92400e"}}>{p.service_category} target: {svcTarget.label}</span>
                      <span className="ml-2 text-xs opacity-75" style={{color:onTarget?"#166534":"#92400e"}}>Actual: {pct(k.costRecovery)}</span>
                      {!onTarget&&<span className="ml-2 text-xs font-medium" style={{color:"#92400e"}}>— {isManager?"See Pricing tab for fee analysis":"Below target"}</span>}
                    </div>
                    {p.fee>0&&<div className="text-right"><div className="text-xs text-slate-400">Current fee</div><div className="font-bold text-slate-700">{dollar(p.fee)}/person</div></div>}
                  </div>
                );
              })()}
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
          {sec==="pricing"&&isManager&&(()=>{
            const enrollment=p.act_enrollment||p.ant_enrollment||0;
            const targetRev=svcTarget?k.totalCost*svcTarget.min:0;
            const gap=targetRev-k.revenue;
            const currentFee=p.fee>0?p.fee:(enrollment>0?k.revenue/enrollment:null);
            const sugFee=enrollment>0&&targetRev>0?targetRev/enrollment:null;
            const feeGap=sugFee!=null&&currentFee!=null?sugFee-currentFee:null;
            const onTarget=svcTarget?k.costRecovery>=svcTarget.min:true;

            // Live calculations from entered values
            const targetFeeEntered=parseFloat(p.pricing_target_fee)||0;
            const subsidyEntered=parseFloat(p.pricing_subsidy_amount)||0;

            // How much of the gap does each close?
            const gapClosedByFee=targetFeeEntered>0&&enrollment>0
              ?Math.max(0,Math.min((targetFeeEntered-(currentFee||0))*enrollment,Math.max(gap,0)))
              :0;
            const gapClosedBySubsidy=subsidyEntered>0?Math.min(subsidyEntered,Math.max(gap-gapClosedByFee,0)):0;
            const unresolvedGap=Math.max(0,gap-gapClosedByFee-gapClosedBySubsidy);

            return(
              <div className="space-y-5">
                <div>
                  <h3 className="font-bold text-slate-700 text-sm mb-1">Pricing Analysis</h3>
                  <p className="text-xs text-slate-400">Set the current fee, review the cost recovery gap, and document intentional pricing decisions.</p>
                </div>

                {/* Current fee */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Current In-District Fee</div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400">$</span>
                    <input type="number" value={p.fee||""} onChange={e=>setField("fee")(parseFloat(e.target.value)||0)}
                      className="w-32 rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-blue-400"
                      placeholder="0" min={0} style={{MozAppearance:"textfield"}}/>
                    <span className="text-xs text-slate-400">per participant</span>
                  </div>
                </div>

                {/* CR gap summary */}
                {svcTarget&&(hasActuals||p.fee>0)&&(
                  <div className={`rounded-xl border overflow-hidden`} style={{borderColor:onTarget?"#bbf7d0":"#fde68a"}}>
                    <div className="px-4 py-3 flex items-center gap-2" style={{background:onTarget?"#f0fdf4":"#fffbeb"}}>
                      <span className="text-base">{onTarget?"✓":"⚠"}</span>
                      <span className="font-semibold text-sm" style={{color:onTarget?"#166534":"#92400e"}}>
                        {p.service_category} target: {svcTarget.label}
                      </span>
                      <span className="text-xs opacity-75 ml-1" style={{color:onTarget?"#166534":"#92400e"}}>
                        Actual: {pct(k.costRecovery)}
                      </span>
                    </div>
                    {!onTarget&&gap>0&&(
                      <div className="px-4 py-3 grid grid-cols-3 gap-4 border-t" style={{borderColor:"#fde68a",background:"#fefce8"}}>
                        <div>
                          <div className="text-xs text-amber-700 font-semibold mb-0.5">Revenue Gap</div>
                          <div className="text-lg font-bold text-amber-800">{dollar(Math.ceil(gap))}</div>
                          <div className="text-xs text-amber-600">to reach {svcTarget.label}</div>
                        </div>
                        {feeGap!=null&&(
                          <div>
                            <div className="text-xs text-amber-700 font-semibold mb-0.5">Fee Increase Needed</div>
                            <div className="text-lg font-bold text-amber-800">+{dollar(Math.ceil(feeGap))}/person</div>
                            <div className="text-xs text-amber-600">based on {enrollment} enrolled</div>
                          </div>
                        )}
                        {sugFee!=null&&(
                          <div>
                            <div className="text-xs text-amber-700 font-semibold mb-0.5">Suggested Fee</div>
                            <div className="text-lg font-bold text-amber-800">{dollar(Math.ceil(sugFee))}/person</div>
                            <div className="text-xs text-amber-600">vs current {dollar(Math.round(currentFee||0))}/person</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Manager pricing decision */}
                {svcTarget&&!onTarget&&gap>0&&(
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100" style={{background:"#f0f4ff"}}>
                      <div>
                        <div className="text-xs font-bold text-slate-700 uppercase tracking-widest">Pricing Decision</div>
                        <div className="text-xs text-slate-500 mt-0.5">Enter a target fee, an intentional subsidy amount, or both</div>
                      </div>
                      <span className="text-xs font-bold px-2 py-1 rounded" style={{background:"#e0e7ff",color:"#3730a3"}}>Manager only</span>
                    </div>
                    <div className="p-4 space-y-4">

                      {/* Two editable fields side by side */}
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                          <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Target fee</div>
                          <div className="text-xs text-slate-400">What we'll realistically charge</div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400">$</span>
                            <input type="number" value={p.pricing_target_fee||""} onChange={e=>setField("pricing_target_fee")(parseFloat(e.target.value)||0)}
                              className="w-28 rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-blue-400 bg-white"
                              placeholder={sugFee?Math.ceil(sugFee):"0"} min={0} style={{MozAppearance:"textfield"}}/>
                            <span className="text-xs text-slate-400">/person</span>
                          </div>
                          {targetFeeEntered>0&&currentFee!=null&&(
                            <div className="text-xs font-semibold" style={{color:targetFeeEntered>currentFee?"#16a34a":"#dc2626"}}>
                              {targetFeeEntered>currentFee
                                ?`↑ +${dollar(targetFeeEntered-currentFee)} from current`
                                :`↓ ${dollar(currentFee-targetFeeEntered)} below current`}
                            </div>
                          )}
                          {targetFeeEntered>0&&enrollment>0&&(
                            <div className="text-xs text-slate-500">Closes {dollar(Math.min(gapClosedByFee,gap))} of the gap</div>
                          )}
                        </div>

                        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                          <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Intentional subsidy</div>
                          <div className="text-xs text-slate-400">District investment beyond the fee</div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400">$</span>
                            <input type="number" value={p.pricing_subsidy_amount||""} onChange={e=>setField("pricing_subsidy_amount")(parseFloat(e.target.value)||0)}
                              className="w-28 rounded border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-blue-400 bg-white"
                              placeholder="0" min={0} style={{MozAppearance:"textfield"}}/>
                          </div>
                          {subsidyEntered>0&&(
                            <div className="text-xs text-slate-500">Closes {dollar(Math.min(gapClosedBySubsidy,gap))} of the gap</div>
                          )}
                        </div>
                      </div>

                      {/* Live resolution summary */}
                      {(targetFeeEntered>0||subsidyEntered>0)&&(
                        <div className="rounded-lg border border-slate-200 p-3 space-y-2 bg-white">
                          {gapClosedByFee>0&&(
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-500">Closed by fee increase</span>
                              <span className="font-semibold text-green-700">{dollar(Math.ceil(gapClosedByFee))}</span>
                            </div>
                          )}
                          {gapClosedBySubsidy>0&&(
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-500">Intentional subsidy</span>
                              <span className="font-semibold" style={{color:"#3730a3"}}>{dollar(Math.ceil(gapClosedBySubsidy))}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-sm border-t border-slate-100 pt-2">
                            <span className="font-semibold">Remaining unresolved gap</span>
                            <span className="font-bold" style={{color:unresolvedGap<=0?"#16a34a":"#dc2626"}}>
                              {unresolvedGap<=0?"$0 — fully resolved":dollar(Math.ceil(unresolvedGap))}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Justification */}
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Justification</div>
                        <div className="flex gap-2 flex-wrap mb-3">
                          {["Community access / equity","New program — building enrollment","Board-directed mission program","Contractual obligation","Other"].map(r=>(
                            <button key={r} onClick={()=>setField("pricing_rationale")(p.pricing_rationale===r?"":r)}
                              className="text-xs px-2.5 py-1 rounded-full border transition"
                              style={p.pricing_rationale===r
                                ?{background:"#e0e7ff",color:"#3730a3",borderColor:"#a5b4fc"}
                                :{background:"#f8fafc",color:"#64748b",borderColor:"#e2e8f0"}}>
                              {r}
                            </button>
                          ))}
                        </div>
                        <textarea value={p.pricing_notes||""} onChange={e=>setField("pricing_notes")(e.target.value)}
                          placeholder="Add context — this carries into the Program Review..."
                          className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:border-blue-400 resize-y"
                          style={{minHeight:"60px",fontFamily:"inherit"}}/>
                      </div>

                    </div>
                  </div>
                )}
              </div>
            );
          })()}
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

      {isManager&&projectedWL>60&&(
        <div className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm mb-2"
          style={{background:projectedWL>120?"#fee2e2":"#fef3c7",borderLeft:`3px solid ${projectedWL>120?"#dc2626":"#d97706"}`}}>
          <span className="shrink-0 font-bold" style={{color:projectedWL>120?"#dc2626":"#d97706"}}>⚠</span>
          <div>
            <div className="font-semibold" style={{color:projectedWL>120?"#991b1b":"#92400e"}}>
              {p.staff_name||"This staff member"} would be at {projectedWL.toFixed(1)}% total workload allocation
              {projectedWL>75?" — significantly over allocated":" — above recommended 60% ceiling"}
            </div>
            <div className="text-xs mt-0.5" style={{color:projectedWL>120?"#b91c1c":"#a16207"}}>
              Other programs account for {staffTotalWL.toFixed(1)}% + this program adds {thisWL.toFixed(1)}%. The recommended ceiling is 60% to leave room for meetings, marketing, planning, and strategic work. Consider reducing the Workload % on this or related programs.
            </div>
          </div>
        </div>
      )}

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
              title="Save (Ctrl+S)"
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
  const [filters,setFilters] = useState({staff:new Set(),area:new Set(),season:new Set(),year:new Set()});
  const [search,setSearch]   = useState("");
  const [showArchived,setShowArchived] = useState(false);
  function onFilterChange(key,val){setFilters(f=>({...f,[key]:val}));}

  const allStaff   = [...new Set(programs.map(p=>p.staff_name).filter(Boolean))];
  const allAreas   = [...new Set(programs.map(p=>p.area))];
  const allYears   = [...YEARS];
  const allSeasons = [...SEASONS];

  const vis = programs
    .filter(p=>showArchived ? !!p.is_archived : !p.is_archived)
    .filter(p=>filters.staff.size===0||filters.staff.has(p.staff_name))
    .filter(p=>filters.area.size===0||filters.area.has(p.area))
    .filter(p=>filters.year.size===0||filters.year.has(toFY(p.year)))
    .filter(p=>filters.season.size===0||filters.season.has(p.season))
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
      <div className="space-y-2">
        <MultiFilter filters={filters} onChange={onFilterChange}
          counts={{staff:allStaff,area:allAreas,season:allSeasons,year:allYears}}/>
        <input className="w-full rounded border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:border-blue-400"
          placeholder="Search programs by name..." value={search} onChange={e=>setSearch(e.target.value)}/>
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
                <div className="text-xs text-slate-400">{p.area} - {p.season} FY {toFY(p.year)} - {p.staff_name}
                  {lastUpdated&&<span className="ml-2 text-slate-300">· Updated {new Date(lastUpdated).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="hidden sm:flex gap-6 text-sm">
                <div className="text-center"><div className="text-xs text-slate-400">Fill</div><div className="font-mono font-semibold">{pct(k.fillRate)}</div></div>
                <div className="text-center"><div className="text-xs text-slate-400">Recovery</div><div className="font-mono font-semibold">{pct(k.costRecovery)}</div></div>
                <div className="text-center"><div className="text-xs text-slate-400">Net P/(L)</div><div className={`font-mono font-semibold ${k.profitLoss>=0?"text-green-700":"text-red-600"}`}>{dollar(k.profitLoss)}</div></div>
              </div>
              <div className="flex items-center gap-2">
                {p.is_archived&&<span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{background:"#f1f5f9",color:"#64748b"}}>Archived</span>}
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

const ADMIN_FYS = ["2021-2022","2022-2023","2023-2024","2024-2025","2025-2026","2026-2027"];
const ADMIN_CUR = "2025-2026";

// ─── Program Review Checklist ─────────────────────────────────────────────────
function ProgramReviewSection({db,programs=[],staffName="",isManager=false}){
  const [reviews,setReviews]=useState([]);
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState("list");
  const [editRow,setEditRow]=useState(null);
  const [detailRow,setDetailRow]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [fyFilter,setFyFilter]=useState("all");
  const [decFilter,setDecFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [matchedProgram,setMatchedProgram]=useState(null);
  const [savedId,setSavedId]=useState(null);
  const [toast,setToast]=useState("");
  const [dbError,setDbError]=useState("");
  const [reviewMode,setReviewMode]=useState("full"); // "full" | "quick"
  const [autoSaving,setAutoSaving]=useState(false);

  const emptyForm={
    // Info
    program_name:"",supervisor:"",season:"",fy:ADMIN_CUR,review_date:new Date().toISOString().slice(0,10),
    classification:"Community Driven",target_age:"",seasons_offered:"",area:"",
    // Financial
    revenue:"",direct_costs:"",cost_recovery:"",prior_cr:"",
    below_50_cr:false,cr_action:"",fs_acceptable:true,fs_notes:"",fs_strengths:"",fs_concerns:"",
    // Data
    fill_rate:"",prior_fill_rate:"",seasons_below_threshold:"0",
    below_60_fill:false,needs_review:false,review_action:"",trend:"Stable",nps:"",
    da_notes:"",da_strengths:"",da_concerns:"",
    // Community
    enrollment:"",capacity:"",waitlist:"",
    retention_trend:"Stable",clear_audience:true,community_benefit:true,
    documented_need:false,ci_notes:"",ci_strengths:"",ci_concerns:"",
    // Space
    prime_time_use:"Strong",time_improvable:false,ratio_appropriate:true,space_notes:"",scheduling_changes:"",facility_barriers:"",
    // Innovation
    is_pilot:false,is_adaptation:false,pilot_goal:"",met_enrollment:false,met_financial:false,adaptation_made:"",future_potential:"",innovation_notes:"",
    // Decision
    decision:"Continue",decision_reason:"",action_items:"",next_review:"",pillars_met:"",
  };
  const [form,setForm]=useState(emptyForm);
  const [activeStep,setActiveStep]=useState(0);

  const AGE_GROUPS=["All Ages","Early Childhood (0–5)","Children (6–12)","Youth (13–17)","Young Adults (18–34)","Adults (35–54)","Older Adults (55–64)","Seniors (65+)","Multigenerational / Family","Adaptive / Inclusive","Workforce / Special Interest"];
  const AREAS=["Adult General","Adult Sports","Aquatics","Camps","Clubhouse","Dance","Fitness","Golf Dome","Museum","Performing Arts","Seniors","Special Events","Youth General","Youth Sports","Other"];
  const SEASONS_LIST=["Spring","Summer","Fall","Winter","Annual","Year-Round"];
  const DECISIONS=["Continue","Adjust","Redesign","Expand","Pilot Again","Sunset Review"];
  const CLASSIFICATIONS=["Community Driven","Both","Revenue Driven"];
  const TRENDS=["Growing","Stable","Declining","New"];
  const PRIME=["Strong","Moderate","Underutilized"];
  const RETENTION_OPTS=["Improving","Stable","Declining","N/A – First Season"];
  const WEAK_OPTS=["0","1","2","3+"];
  const dcColor={"Continue":"#16a34a","Adjust":"#d4a017","Redesign":"#dc2626","Expand":"#0369a1","Pilot Again":"#7c3aed","Sunset Review":"#991b1b"};

  const STEPS=[
    {label:"Program Info",icon:"📋"},
    {label:"Financial",icon:"💰"},
    {label:"Data",icon:"📊"},
    {label:"Community",icon:"🤝"},
    {label:"Space",icon:"🏢"},
    {label:"Innovation",icon:"💡"},
    {label:"Decision",icon:"✅"},
  ];

  async function load(localRow){
    setLoading(true);
    setDbError("");
    const {data,error}=await db.from("admin_reviews").select("*").order("created_at",{ascending:false});
    if(error){
      setDbError("Could not load reviews: "+error.message+". Check Supabase RLS policies on admin_reviews table — staff may need SELECT access.");
      if(localRow) setReviews(prev=>{
        const exists=prev.find(r=>r.id===localRow.id);
        return exists?prev:[localRow,...prev];
      });
    } else {
      setReviews(data||[]);
    }
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  function s(k,v){setForm(p=>({...p,[k]:v}));}

  // Auto-match program from programs list when name changes
  function handleProgramName(name){
    s("program_name",name);
    if(!reviewablePrograms||!reviewablePrograms.length) return;
    const match=reviewablePrograms.find(p=>p.name?.toLowerCase()===name.toLowerCase());
    if(match){
      const kpis=calcKPIs(match);
      setMatchedProgram(match);
      // direct costs = sum of all actual cost lines
      const directCosts=(match.act_personnel||0)+(match.act_commodities||0)+(match.act_contractuals||0)+(match.act_other1||0)+(match.act_other2||0);
      setForm(prev=>({
        ...prev,
        program_name:name,
        supervisor:prev.supervisor||match.staff_name||"",  // only fill if blank
        area:match.area||prev.area,
        season:match.season||prev.season,
        classification:match.classification||prev.classification,
        // calculated metrics
        fill_rate:kpis.fillRate?Math.round(kpis.fillRate*100):"",
        cost_recovery:kpis.costRecovery?Math.round(kpis.costRecovery*100):"",
        // actuals — financial
        revenue:match.act_revenue||"",
        direct_costs:directCosts||"",
        // actuals — participation
        enrollment:match.act_enrollment||"",
        capacity:match.act_capacity||"",
        waitlist:match.waitlist!=null?match.waitlist:"",
        // quality & trend
        nps:match.nps||"",
        trend:match.trend||"Stable",
        // auto-calculate seasons below threshold from program history
        seasons_below_threshold:(()=>{
          const history=(programs||[]).filter(p=>
            p.name?.toLowerCase()===name.toLowerCase()&&
            p.area===match.area&&
            p.id!==match.id
          );
          const weakSeasons=history.filter(p=>{
            const k=calcKPIs(p);
            return k.fillRate>0&&(k.fillRate<0.6||k.costRecovery<0.5);
          }).length;
          return weakSeasons>3?"3+":String(weakSeasons);
        })(),
      }));
    } else {
      setMatchedProgram(null);
    }
  }

  // Prior season lookup
  function priorSeasonData(name,season,fy){
    if(!reviewablePrograms||!name) return null;
    const fyIdx=ADMIN_FYS.indexOf(fy);
    const priorFY=fyIdx>0?ADMIN_FYS[fyIdx-1]:null;
    const prior=reviewablePrograms.find(p=>
      p.name?.toLowerCase()===name.toLowerCase()&&
      p.season===season&&
      p.year===priorFY?.slice(0,4)
    );
    if(!prior) return null;
    const kpis=calcKPIs(prior);
    return{
      fill_rate:kpis.fillRate?Math.round(kpis.fillRate*100):null,
      cost_recovery:kpis.costRecovery?Math.round(kpis.costRecovery*100):null,
      enrollment:prior.act_enrollment,
      fy:priorFY,
    };
  }

  // History from past reviews
  function reviewHistory(name){
    return reviews.filter(r=>r.program_name?.toLowerCase()===name?.toLowerCase())
      .sort((a,b)=>new Date(b.review_date)-new Date(a.review_date));
  }

  function computePillars(f){
    const cr=parseFloat(f.cost_recovery)||0;
    const fr=parseFloat(f.fill_rate)||0;
    const wk=parseInt(f.seasons_below_threshold)||0;
    const p1=f.fs_acceptable&&cr>=50;
    const p2=fr>=60&&wk<2;
    const p3=f.clear_audience&&f.community_benefit;
    const p4=f.prime_time_use!=="Underutilized"&&f.ratio_appropriate;
    const p5=!f.is_pilot||(f.met_enrollment&&f.met_financial);
    return[
      {n:1,label:"Fiscal Sustainability",met:p1,required:true,color:"#1e3a5f"},
      {n:2,label:"Data & Accountability",met:p2,required:true,color:"#1e3a5f"},
      {n:3,label:"Community Impact",met:p3,required:false,color:"#0f766e"},
      {n:4,label:"Space Optimization",met:p4,required:false,color:"#7c3aed"},
      {n:5,label:"Innovation",met:p5,required:false,color:"#b45309"},
    ];
  }

  // Shared payload builder — used by both save() and autoSave()
  function buildReviewPayload(pillarsStr){
    return {
      program_name:form.program_name||"",
      supervisor:form.supervisor||"",
      season:form.season||"",
      fy:form.fy||"",
      review_date:form.review_date||new Date().toISOString().slice(0,10),
      classification:form.classification||"",
      target_age:form.target_age||"",
      seasons_offered:parseInt(form.seasons_offered)||0,
      area:form.area||"",
      revenue:parseFloat(form.revenue)||0,
      direct_costs:parseFloat(form.direct_costs)||0,
      cost_recovery:parseFloat(form.cost_recovery)||0,
      prior_cr:parseFloat(form.prior_cr)||0,
      below_50_cr:!!form.below_50_cr,
      cr_action:form.cr_action||"",
      fs_acceptable:form.fs_acceptable!==false,
      fs_notes:form.fs_notes||"",
      fs_strengths:form.fs_strengths||"",
      fs_concerns:form.fs_concerns||"",
      fill_rate:parseFloat(form.fill_rate)||0,
      prior_fill_rate:parseFloat(form.prior_fill_rate)||0,
      seasons_below_threshold:parseInt(form.seasons_below_threshold)||0,
      below_60_fill:!!form.below_60_fill,
      needs_review:!!form.needs_review,
      review_action:form.review_action||"",
      trend:form.trend||"Stable",
      nps:form.nps?parseInt(form.nps):null,
      da_notes:form.da_notes||"",
      da_strengths:form.da_strengths||"",
      da_concerns:form.da_concerns||"",
      enrollment:parseInt(form.enrollment)||0,
      capacity:parseInt(form.capacity)||0,
      waitlist:parseInt(form.waitlist)||0,
      retention_trend:form.retention_trend||"",
      clear_audience:form.clear_audience!==false,
      community_benefit:form.community_benefit!==false,
      documented_need:!!form.documented_need,
      ci_notes:form.ci_notes||"",
      ci_strengths:form.ci_strengths||"",
      ci_concerns:form.ci_concerns||"",
      prime_time_use:form.prime_time_use||"",
      time_improvable:!!form.time_improvable,
      ratio_appropriate:form.ratio_appropriate!==false,
      space_notes:form.space_notes||"",
      scheduling_changes:form.scheduling_changes||"",
      facility_barriers:form.facility_barriers||"",
      is_pilot:!!form.is_pilot,
      is_adaptation:!!form.is_adaptation,
      pilot_goal:form.pilot_goal||"",
      met_enrollment:!!form.met_enrollment,
      met_financial:!!form.met_financial,
      adaptation_made:form.adaptation_made||"",
      future_potential:form.future_potential||"",
      innovation_notes:form.innovation_notes||"",
      decision:form.decision||"Continue",
      decision_reason:form.decision_reason||"",
      action_items:form.action_items||"",
      next_review:form.next_review||null,
      pillars_met:pillarsStr,
    };
  }

  const pillars=computePillars(form);
  const metCount=pillars.filter(p=>p.met).length;
  const requiredMet=pillars.filter(p=>p.required).every(p=>p.met);
  const overallPass=metCount>=3&&requiredMet;

  async function save(){
    const pillarsStr=pillars.filter(p=>p.met).map(p=>p.n).join(",");
    const d=buildReviewPayload(pillarsStr);
    let savedRow;
    try {
      if(editRow){
        const {error:e}=await db.from("admin_reviews").update(d).eq("id",editRow.id);
        if(e) throw e;
        savedRow=editRow;
      } else {
        const {data:ins,error:e}=await db.from("admin_reviews").insert(d).select().single();
        if(e) throw e;
        savedRow=ins;
      }
    } catch(err){
      setDbError("Failed to save review: "+(err.message||"unknown error")+". Please try again.");
      return;
    }
    // Clear all filters so the review is visible, then highlight it
    setFyFilter("all");setDecFilter("all");setSearch("");
    setSavedId(savedRow?.id||null);
    setToast(editRow?"Review updated ✓":"Review saved ✓");
    setTimeout(()=>{setToast("");setSavedId(null);},5000);
    await load(savedRow); // pass savedRow so it shows even if RLS blocks SELECT
    setView("list");setEditRow(null);setForm(emptyForm);setActiveStep(0);setMatchedProgram(null);
  }

  async function del(id){
    const {error:e}=await db.from("admin_reviews").delete().eq("id",id);
    if(e){setDbError("Failed to delete review: "+e.message);return;}
    setConfirm(null);load();
  }

  // Auto-save on Next — saves current form state without leaving the form
  async function autoSave(){
    if(autoSaving) return;
    setAutoSaving(true);
    const pillarsStr=computePillars(form).filter(p=>p.met).map(p=>p.n).join(",");
    const d=buildReviewPayload(pillarsStr);
    try {
      if(editRow){
        const {error:e}=await db.from("admin_reviews").update(d).eq("id",editRow.id);
        if(e) throw e;
      } else {
        // First auto-save: insert and store row so subsequent saves are updates
        const {data:ins,error:e}=await db.from("admin_reviews").insert(d).select().single();
        if(e) throw e;
        if(ins) setEditRow(ins);
      }
    } catch(err){
      setDbError("Auto-save failed: "+(err.message||"unknown error"));
    }
    setAutoSaving(false);
  }

  function startNew(mode="full"){
    setEditRow(null);
    setForm({...emptyForm, supervisor: isManager ? "" : staffName});
    setActiveStep(0);setMatchedProgram(null);setReviewMode(mode);setView("form");
  }
  function startEdit(r){
    setEditRow(r);
    setForm({...emptyForm,...r,
      revenue:r.revenue||"",direct_costs:r.direct_costs||"",
      cost_recovery:r.cost_recovery||"",prior_cr:r.prior_cr||"",
      fill_rate:r.fill_rate||"",prior_fill_rate:r.prior_fill_rate||"",
      cancellation_rate:r.cancellation_rate||"",
      enrollment:r.enrollment||"",capacity:r.capacity||"",
      waitlist:r.waitlist||"",nps:r.nps||"",
      retention_rate:r.retention_rate||"",
      seasons_below_threshold:r.seasons_below_threshold!=null?String(r.seasons_below_threshold):"0",
    });
    setActiveStep(0);setView("form");
  }

  // Debug: log every time filtered recalculates
  const filtered=reviews.filter(r=>{
    // Staff only see reviews where they are the supervisor (case-insensitive)
    // Always show the just-saved review regardless of name match
    if(!isManager && staffName && r.id!==savedId) {
      const sup=(r.supervisor||"").toLowerCase().trim();
      const me=staffName.toLowerCase().trim();
      if(sup!==me) return false;
    }
    if(fyFilter!=="all"&&r.fy!==fyFilter) return false;
    if(decFilter!=="all"&&r.decision!==decFilter) return false;
    if(search&&!r.program_name?.toLowerCase().includes(search.toLowerCase())&&!r.supervisor?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Programs this person can review: staff see only their own, managers see all
  const reviewablePrograms = isManager
    ? (programs||[])
    : (programs||[]).filter(p=>p.staff_name?.toLowerCase().trim()===staffName.toLowerCase().trim());

  // ── Helper sub-components ──────────────────────────────────────────────────
  const inp=(label,key,type="text",opts=null,req=false,hint="")=>(
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}{req&&<span className="text-red-400 ml-0.5">*</span>}</label>
      {opts?(
        <select value={form[key]||""} onChange={e=>s(key,e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
          {opts.map(o=><option key={o}>{o}</option>)}
        </select>
      ):(
        <input type={type} value={form[key]||""} onChange={e=>s(key,e.target.value)}
          inputMode={type==="number"?"decimal":undefined}
          className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2"
          style={type==="number"?{MozAppearance:"textfield"}:{}}/>
      )}
      {hint&&<div className="text-xs text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );

  const chk=(label,key,detail="")=>(
    <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-slate-100 hover:bg-slate-50">
      <input type="checkbox" checked={!!form[key]} onChange={e=>s(key,e.target.checked)} className="mt-0.5 shrink-0"/>
      <div><div className="text-sm font-medium text-slate-700">{label}</div>{detail&&<div className="text-xs text-slate-400 mt-0.5">{detail}</div>}</div>
    </label>
  );

  const ta=(label,key,rows=2,placeholder="")=>(
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      <textarea value={form[key]||""} onChange={e=>s(key,e.target.value)} rows={rows} placeholder={placeholder}
        className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 resize-none"/>
    </div>
  );

  const scPair=(sKey,cKey)=>(
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mt-1">
      <div>
        <label className="block text-xs font-semibold text-green-700 mb-1">✓ Strengths</label>
        <textarea value={form[sKey]||""} onChange={e=>s(sKey,e.target.value)} rows={2}
          placeholder="What is working well…"
          className="w-full text-sm rounded-lg border border-green-100 bg-green-50 px-3 py-2 resize-none"/>
      </div>
      <div>
        <label className="block text-xs font-semibold text-amber-700 mb-1">⚠ Concerns</label>
        <textarea value={form[cKey]||""} onChange={e=>s(cKey,e.target.value)} rows={2}
          placeholder="What needs attention…"
          className="w-full text-sm rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 resize-none"/>
      </div>
    </div>
  );

  const divider=(label)=>(
    <div className="flex items-center gap-2 my-1">
      <div className="h-px flex-1 bg-slate-100"/>
      <span className="text-xs text-slate-400 font-semibold uppercase tracking-widest">{label}</span>
      <div className="h-px flex-1 bg-slate-100"/>
    </div>
  );

  const delta=(cur,prior,suffix="%",invert=false)=>{
    if(cur===""||cur===null||prior===""||prior===null) return null;
    const diff=parseFloat(cur)-parseFloat(prior);
    if(isNaN(diff)) return null;
    const good=invert?diff<=0:diff>=0;
    return(
      <span className="text-xs font-bold ml-1" style={{color:good?"#16a34a":"#dc2626"}}>
        {diff>=0?"+":""}{diff.toFixed(1)}{suffix} vs prior
      </span>
    );
  };

  // ── LIST VIEW ─────────────────────────────────────────────────────────────
  if(view==="list") return(
    <div>
      {isManager&&(
        <div className="rounded-xl border border-slate-200 p-4 mb-5 flex items-start gap-3" style={{background:"#f8fafc"}}>
          <span className="text-lg shrink-0">📋</span>
          <div>
            <div className="font-bold text-slate-700 text-sm mb-1">Why BGPD does Program Reviews</div>
            <p className="text-xs text-slate-500 leading-relaxed">Program reviews are how BGPD makes intentional, documented decisions about its programming portfolio — a direct commitment from the 2025–2028 Strategic Plan's focus on fiscal sustainability and data-driven management. Every review creates a permanent record of why a program was continued, adjusted, expanded, or sunset, grounded in the 110% cost recovery framework. This protects the district from reactive decision-making, gives the board confidence that programming choices are strategic, and helps BGPD move its overall program margin toward long-term financial health. Complete a review for every program at the end of each season it runs.</p>
          </div>
        </div>
      )}
      {toast&&(
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-green-800 bg-green-50 border border-green-200">
          <span className="text-lg">✓</span>{toast}
        </div>
      )}
      {dbError&&(
        <div className="mb-4 px-4 py-3 rounded-xl text-sm text-red-700 bg-red-50 border border-red-200 space-y-1">
          <div className="font-bold">⚠ Database access issue</div>
          <div className="text-xs">{dbError}</div>
          <div className="text-xs font-semibold mt-1">Quick fix — run this in Supabase SQL Editor:<br/>
            <code className="bg-red-100 px-1 rounded">ALTER TABLE admin_reviews ENABLE ROW LEVEL SECURITY;</code><br/>
            <code className="bg-red-100 px-1 rounded">CREATE POLICY "allow_all" ON admin_reviews FOR ALL USING (true) WITH CHECK (true);</code>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-bold text-slate-800" style={{fontSize:"18px"}}>Program Review Checklist</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {isManager
              ? "All program reviews — visible to managers"
              : `Your program reviews — complete one after each season`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isManager&&filtered.length>0&&(
            <button onClick={()=>{
              const rows=filtered.map(r=>[
                r.program_name,r.supervisor,r.area,r.season,r.fy,r.review_date,
                r.fill_rate||0,r.cost_recovery||0,r.revenue||0,r.direct_costs||0,
                r.trend,r.decision,r.pillars_met,r.action_items||""
              ].map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(","));
              const headers=["Program","Supervisor","Area","Season","FY","Review Date","Fill %","CR %","Revenue","Direct Costs","Trend","Decision","Pillars Met","Action Items"].join(",");
              const blob=new Blob([headers+"\n"+rows.join("\n")],{type:"text/csv"});
              const a=document.createElement("a");
              a.href=URL.createObjectURL(blob);
              a.download=`BGPD_Program_Reviews_${new Date().toISOString().slice(0,10)}.csv`;
              a.click();
            }} className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition">
              ↓ Export CSV
            </button>
          )}
          <button onClick={()=>startNew("quick")} className="px-4 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#d4a017",color:"#1e3a5f"}}>
            ⚡ Quick Review
          </button>
          <button onClick={()=>startNew("full")} className="px-4 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>
            + Full Review
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 mb-6">
        {[
          {label:"Total",value:reviews.length,accent:"#1e3a5f"},
          {label:"Continue",value:reviews.filter(r=>r.decision==="Continue").length,accent:"#16a34a"},
          {label:"Adjust",value:reviews.filter(r=>r.decision==="Adjust").length,accent:"#d4a017"},
          {label:"Expand",value:reviews.filter(r=>r.decision==="Expand").length,accent:"#0369a1"},
          {label:"Redesign",value:reviews.filter(r=>r.decision==="Redesign").length,accent:"#dc2626"},
          {label:"Sunset",value:reviews.filter(r=>r.decision==="Sunset Review").length,accent:"#991b1b"},
        ].map(c=>(
          <div key={c.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 text-center cursor-pointer hover:border-slate-200 transition"
            onClick={()=>setDecFilter(decFilter===c.label||(c.label==="Total"&&decFilter==="all")?"all":c.label==="Total"?"all":c.label)}>
            <div className="text-2xl font-black" style={{color:c.accent}}>{c.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-wrap gap-3 items-center mb-5">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search program or supervisor…"
          className="flex-1 min-w-48 text-sm rounded-lg border border-slate-200 px-3 py-1.5"/>
        <select value={fyFilter} onChange={e=>setFyFilter(e.target.value)} className="text-sm rounded-lg border border-slate-200 px-3 py-1.5 bg-white">
          <option value="all">All FYs</option>
          {ADMIN_FYS.map(f=><option key={f}>{f}</option>)}
        </select>
        <select value={decFilter} onChange={e=>setDecFilter(e.target.value)} className="text-sm rounded-lg border border-slate-200 px-3 py-1.5 bg-white">
          <option value="all">All Decisions</option>
          {DECISIONS.map(d=><option key={d}>{d}</option>)}
        </select>
        {(search||fyFilter!=="all"||decFilter!=="all")&&(
          <button onClick={()=>{setSearch("");setFyFilter("all");setDecFilter("all");}} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
        )}
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} review{filtered.length!==1?"s":""}</span>
      </div>

      {filtered.length===0?(
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">📋</div>
          <div className="font-semibold text-slate-600 mb-1">No reviews yet</div>
          <div className="text-sm">{isManager ? 'Click "+ New Review" to log the first review.' : 'Click "+ New Review" to review one of your programs.'}</div>
        </div>
      ):(
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          {filtered.map((r,i)=>{
            const pMet=(r.pillars_met||"").split(",").filter(Boolean).length;
            const dc=dcColor[r.decision]||"#64748b";
            const frDelta=r.prior_fill_rate?r.fill_rate-r.prior_fill_rate:null;
            return(
              <div key={r.id} className={`${i>0?"border-t border-slate-50":""} px-4 py-4 flex items-start gap-4 hover:bg-slate-50 transition ${savedId===r.id?"bg-green-50 border-l-4 border-green-400":""}`}>
                <div className="shrink-0 mt-0.5 w-24 text-center">
                  <span className="inline-block px-2 py-1 rounded text-xs font-bold text-white w-full" style={{background:dc}}>{r.decision||"—"}</span>
                  <div className="text-xs text-slate-400 mt-1">{r.season} {r.fy?.slice(2,4)}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800">{r.program_name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{r.supervisor}{r.area?` · ${r.area}`:""} · {r.season&&r.fy?`${r.season} FY ${r.fy} · `:""}{r.review_date}
                    {r.updated_at&&<span className="ml-2 text-slate-300">· saved {new Date(r.updated_at).toLocaleDateString()}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
                    <span className="text-slate-500">Fill: <span className="font-bold">{r.fill_rate||0}%</span>
                      {frDelta!==null&&<span style={{color:frDelta>=0?"#16a34a":"#dc2626",marginLeft:"3px"}}>{frDelta>=0?"▲":"▼"}{Math.abs(frDelta).toFixed(0)}pp</span>}
                    </span>
                    <span className="text-slate-500">CR: <span className="font-bold">{r.cost_recovery||0}%</span></span>
                    {r.seasons_below_threshold>0&&<span className="font-semibold" style={{color:r.seasons_below_threshold>=2?"#dc2626":"#d4a017"}}>{r.seasons_below_threshold} season{r.seasons_below_threshold>1?"s":""} below threshold</span>}
                    <span style={{color:pMet>=3?"#16a34a":"#dc2626"}} className="font-semibold">{pMet}/5 pillars</span>
                    {r.next_review&&<span className="text-slate-400">→ {r.next_review}</span>}
                  </div>
                  {r.action_items&&(
                    <div className="mt-1.5 text-xs text-slate-500 italic truncate">Action: {r.action_items}</div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={()=>{setDetailRow(r);setView("detail");}} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-500">👁</button>
                  <button onClick={()=>startEdit(r)} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-500">✏</button>
                  <button onClick={()=>setConfirm(r.id)} className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-xs text-red-400">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {confirm&&<ConfirmModal message="Delete this review? This cannot be undone." onConfirm={()=>del(confirm)} onCancel={()=>setConfirm(null)} confirmLabel="Delete" confirmColor="#ef4444"/>}
    </div>
  );

  // ── DETAIL VIEW ───────────────────────────────────────────────────────────
  if(view==="detail"&&detailRow){
    const r=detailRow;
    const pMet=(r.pillars_met||"").split(",").filter(Boolean);
    const pillarMeta={1:{label:"Fiscal Sustainability",color:"#1e3a5f",req:true},2:{label:"Data & Accountability",color:"#1e3a5f",req:true},3:{label:"Community Impact",color:"#0f766e",req:false},4:{label:"Space Optimization",color:"#7c3aed",req:false},5:{label:"Innovation",color:"#b45309",req:false}};
    const history=reviewHistory(r.program_name).filter(h=>h.id!==r.id);
    const Row=({k,v})=>v!=null&&v!==""&&v!==false?(<div className="flex justify-between py-1 border-b border-slate-50"><span className="text-slate-400 text-xs">{k}</span><span className="font-semibold text-slate-700 text-xs text-right max-w-48">{String(v)}</span></div>):null;
    const Note=({label,val,color="#64748b"})=>val?(<div className="mt-2 p-2.5 rounded-lg bg-slate-50 text-xs text-slate-500"><span className="font-bold" style={{color}}>{label}: </span>{val}</div>):null;
    const SCP=({s,c})=>(s||c)?(
      <div className="grid grid-cols-2 gap-2 mt-2">
        {s&&<div className="p-2.5 rounded-lg bg-green-50 text-xs"><span className="font-bold text-green-700">Strengths: </span>{s}</div>}
        {c&&<div className="p-2.5 rounded-lg bg-amber-50 text-xs"><span className="font-bold text-amber-700">Concerns: </span>{c}</div>}
      </div>
    ):null;

    return(
      <div>
        <button onClick={()=>setView("list")} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-5">← All reviews</button>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5" style={{background:"linear-gradient(135deg,#1e3a5f,#0f2d4a)"}}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-black text-white">{r.program_name}</div>
                <div className="text-sm opacity-70 text-white mt-1">
                  {r.supervisor}{r.area?` · ${r.area}`:""} · {r.season} FY {r.fy} · Reviewed {r.review_date}
                </div>
                {r.target_age&&<div className="text-xs opacity-60 text-white mt-0.5">Target: {r.target_age}</div>}
              </div>
              <div className="text-right shrink-0">
                <span className="inline-block px-3 py-1.5 rounded-lg text-sm font-bold text-white mb-1" style={{background:dcColor[r.decision]||"#64748b"}}>{r.decision}</span>
                {r.seasons_offered&&<div className="text-xs opacity-60 text-white">{r.seasons_offered} seasons offered</div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {[1,2,3,4,5].map(n=>{
                const m=pillarMeta[n]; const met=pMet.includes(String(n));
                return <span key={n} className="text-xs font-bold px-2 py-1 rounded-full" style={{background:met?m.color:"rgba(255,255,255,0.1)",color:"white",opacity:met?1:0.45}}>{met?"✓":"○"} {m.label}{m.req?" ★":""}</span>;
              })}
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Key metrics row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {label:"Fill Rate",cur:r.fill_rate,prior:r.prior_fill_rate,suffix:"%"},
                {label:"Cost Recovery",cur:r.cost_recovery,prior:r.prior_cr,suffix:"%"},
                {label:"Enrollment",cur:r.enrollment?`${r.enrollment}/${r.capacity}`:"—",prior:null},
                {label:"Seasons Below Threshold",cur:r.seasons_below_threshold||0,prior:null,alert:r.seasons_below_threshold>=2},
              ].map(m=>(
                <div key={m.label} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                  <div className="text-xs text-slate-400 mb-1">{m.label}</div>
                  <div className="text-lg font-black" style={{color:m.alert?"#dc2626":"#1e3a5f"}}>{m.cur}</div>
                  {m.prior!=null&&m.prior!=""&&(
                    <div className="text-xs text-slate-400">
                      Prior: {m.prior}{m.suffix}
                      <span style={{color:(m.cur-m.prior)>=0?"#16a34a":"#dc2626",marginLeft:"4px"}}>
                        {(m.cur-m.prior)>=0?"▲":"▼"}{Math.abs(m.cur-m.prior).toFixed(0)}pp
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {/* Financial */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">💰 Financial</div>
                <Row k="Revenue" v={r.revenue?`$${Number(r.revenue).toLocaleString()}`:null}/>
                <Row k="Direct Costs" v={r.direct_costs?`$${Number(r.direct_costs).toLocaleString()}`:null}/>
                <Row k="Cost Recovery" v={r.cost_recovery?`${r.cost_recovery}%`:null}/>
                <Row k="Prior CR" v={r.prior_cr?`${r.prior_cr}%`:null}/>
                <Row k="Classification" v={r.classification}/>
                <Row k="Financial Acceptable?" v={r.fs_acceptable?"Yes":"No — Redesign Required"}/>
                {r.cr_action&&<Row k="CR Action" v={r.cr_action}/>}
                <SCP s={r.fs_strengths} c={r.fs_concerns}/>
                <Note label="Notes" val={r.fs_notes}/>
              </div>
              {/* Data */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">📊 Data</div>
                <Row k="Fill Rate" v={r.fill_rate?`${r.fill_rate}%`:null}/>
                <Row k="Prior Fill Rate" v={r.prior_fill_rate?`${r.prior_fill_rate}%`:null}/>
                <Row k="NPS" v={r.nps}/>
                <Row k="Trend" v={r.trend}/>
                <Row k="Seasons Below Threshold" v={r.seasons_below_threshold}/>
                {r.review_action&&<Row k="Review Action" v={r.review_action}/>}
                <SCP s={r.da_strengths} c={r.da_concerns}/>
                <Note label="Notes" val={r.da_notes}/>
              </div>
              {/* Community */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">🤝 Community</div>
                <Row k="Enrollment / Capacity" v={r.enrollment?`${r.enrollment} / ${r.capacity}`:"—"}/>
                <Row k="Waitlist" v={r.waitlist||0}/>
                <Row k="Participant Trend" v={r.retention_trend}/>
                <Row k="Target Age Group" v={r.target_age}/>
                <Row k="Clear Audience?" v={r.clear_audience?"Yes":"No"}/>
                <Row k="Community Benefit Documented?" v={r.community_benefit?"Yes":"No"}/>
                <Row k="Documented Community Need?" v={r.documented_need?"Yes":"No"}/>
                <SCP s={r.ci_strengths} c={r.ci_concerns}/>
                <Note label="Notes" val={r.ci_notes}/>
              </div>
              {/* Space + Innovation */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">🏢 Space & Innovation</div>
                <Row k="Prime Time Use" v={r.prime_time_use}/>
                <Row k="Time/Location Improvable?" v={r.time_improvable?"Yes":"No"}/>
                <Row k="Staff Ratio Appropriate?" v={r.ratio_appropriate?"Yes":"No"}/>
                <Row k="Day / Time" v={r.scheduling_changes||null}/>
                <Note label="Facility Barriers" val={r.facility_barriers}/>
                <Note label="Space Notes" val={r.space_notes}/>
                <div className="mt-3"/>
                <Row k="Is Pilot?" v={r.is_pilot?"Yes":"No"}/>
                {r.is_pilot&&<>
                  <Row k="Pilot Goal" v={r.pilot_goal||null}/>
                  <Row k="Met Enrollment?" v={r.met_enrollment?"Yes":"No"}/>
                  <Row k="Met Financial?" v={r.met_financial?"Yes":"No"}/>
                </>}
                <Note label="Adaptations Made" val={r.adaptation_made}/>
                <Note label="Future Potential" val={r.future_potential}/>
                <Note label="Innovation Notes" val={r.innovation_notes}/>
              </div>
            </div>

            {/* Decision + Action items */}
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between" style={{background:dcColor[r.decision]||"#64748b"}}>
                <span className="font-bold text-white">Decision: {r.decision}</span>
                {r.next_review&&<span className="text-xs text-white opacity-80">Next review: {r.next_review}</span>}
              </div>
              {r.decision_reason&&<div className="px-4 py-3 text-sm text-slate-600 border-b border-slate-50"><span className="font-semibold text-slate-700">Reason: </span>{r.decision_reason}</div>}
              {r.action_items&&<div className="px-4 py-3 text-sm text-slate-600"><span className="font-semibold text-slate-700">Action Items: </span>{r.action_items}</div>}
            </div>

            {/* History */}
            {history.length>0&&(
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Review History — {r.program_name}</div>
                <div className="space-y-2">
                  {history.slice(0,5).map((h,i)=>(
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                      <span className="px-2 py-0.5 rounded font-bold text-white" style={{background:dcColor[h.decision]||"#64748b"}}>{h.decision}</span>
                      <span className="text-slate-500">{h.season} {h.fy}</span>
                      <span className="text-slate-500">Fill: <span className="font-bold">{h.fill_rate||0}%</span></span>
                      <span className="text-slate-500">CR: <span className="font-bold">{h.cost_recovery||0}%</span></span>
                      <span className="text-slate-400 ml-auto">{h.review_date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="px-6 pb-6 flex gap-3 border-t border-slate-100 pt-4">
            <button onClick={()=>startEdit(r)} className="px-4 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>✏ Edit</button>
            <button onClick={()=>setView("list")} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Close</button>
          </div>
        </div>
      </div>
    );
  }

  // ── FORM VIEW ─────────────────────────────────────────────────────────────
  const prior=priorSeasonData(form.program_name,form.season,form.fy);
  const hist=reviewHistory(form.program_name).filter(r=>!editRow||r.id!==editRow.id);

  return(
    <div>
      <button onClick={()=>{setView("list");setActiveStep(0);setMatchedProgram(null);}} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-5">← All reviews</button>
      <div className="mb-5 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-slate-800 text-lg">{editRow?"Edit Review":reviewMode==="quick"?"⚡ Quick Review":"New Program Review"}</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {reviewMode==="quick"
              ? "Essential fields only — saves automatically as you go"
              : "Complete all sections, then submit"}
          </p>
        </div>
        {!editRow&&(
          <button onClick={()=>setReviewMode(m=>m==="quick"?"full":"quick")}
            className="text-xs px-3 py-1.5 rounded-lg border font-semibold transition"
            style={reviewMode==="quick"
              ?{background:"#1e3a5f",color:"white",borderColor:"#1e3a5f"}
              :{background:"#fef3c7",color:"#92400e",borderColor:"#fde68a"}}>
            {reviewMode==="quick"?"Switch to Full Review →":"⚡ Switch to Quick Review"}
          </button>
        )}
      </div>

      {/* Step nav — full mode only */}
      {reviewMode==="full"&&(
      <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
        {STEPS.map((st,i)=>{
          const done=i<activeStep; const active=i===activeStep;
          return(
            <button key={i} onClick={()=>setActiveStep(i)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition whitespace-nowrap shrink-0"
              style={active?{background:"#1e3a5f",color:"white"}:done?{background:"#dcfce7",color:"#166534"}:{background:"#f1f5f9",color:"#94a3b8"}}>
              <span>{done?"✓":st.icon}</span>{st.label}
            </button>
          );
        })}
      </div>
      )}

      {/* Live pillar bar — full mode only */}
      {reviewMode==="full"&&<div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Pillar Score</div>
          <div className={`text-sm font-bold ${overallPass?"text-green-600":"text-red-500"}`}>
            {metCount}/5 — {overallPass?"✓ Passes":"✗ Needs 3+ pillars incl. both required"}
          </div>
        </div>
        <div className="flex gap-1.5">
          {pillars.map(p=>(
            <div key={p.n} className="flex-1 text-center">
              <div className="h-2 rounded-full mb-1 transition-all" style={{background:p.met?p.color:"#e2e8f0"}}/>
              <div style={{fontSize:"9px",color:p.met?p.color:"#94a3b8"}}>{p.n}{p.required?"★":""}</div>
            </div>
          ))}
        </div>
      </div>}

      {/* ── QUICK REVIEW FORM ── */}
      {reviewMode==="quick"&&(
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-5">
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-700">
            <span className="font-bold">Quick Review</span> — fill in what you know and hit Next to auto-save. You can come back and add more detail anytime.
          </div>
          {/* Program Info */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Program Name <span className="text-red-400">*</span></label>
              <input value={form.program_name} onChange={e=>handleProgramName(e.target.value)}
                list="program-list-q" className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2"/>
              <datalist id="program-list-q">
                {[...new Set((programs||[]).map(p=>p.name).filter(Boolean))].sort().map(n=><option key={n} value={n}/>)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Supervisor</label>
              <input value={form.supervisor} onChange={e=>s("supervisor",e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Season</label>
              <select value={form.season} onChange={e=>s("season",e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
                {["","Spring","Summer","Fall","Winter","Annual","Year-Round"].map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Fiscal Year</label>
              <select value={form.fy} onChange={e=>s("fy",e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
                {ADMIN_FYS.map(f=><option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Fill Rate (%)</label>
              <input type="number" value={form.fill_rate} onChange={e=>s("fill_rate",e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2" style={{MozAppearance:"textfield"}} placeholder="e.g. 72"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Cost Recovery (%)</label>
              <input type="number" value={form.cost_recovery} onChange={e=>s("cost_recovery",e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2" style={{MozAppearance:"textfield"}} placeholder="e.g. 105"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Trend</label>
              <select value={form.trend} onChange={e=>s("trend",e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
                {["Growing","Stable","Declining","New"].map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Decision</label>
              <select value={form.decision} onChange={e=>s("decision",e.target.value)} className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
                {DECISIONS.map(d=><option key={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Notes / Action Items</label>
            <textarea value={form.action_items} onChange={e=>s("action_items",e.target.value)} rows={3}
              placeholder="Key observations, next steps…"
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 resize-none"/>
          </div>
          {autoSaving&&<div className="text-xs text-slate-400 italic">Saving…</div>}
          <div className="flex justify-between pt-2 border-t border-slate-100">
            <button onClick={()=>{setView("list");setActiveStep(0);setMatchedProgram(null);}} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">← Back</button>
            <button onClick={async()=>{await autoSave();setFyFilter("all");setDecFilter("all");setSearch("");await load();setView("list");setActiveStep(0);setMatchedProgram(null);}}
              className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>
              Save & Close
            </button>
          </div>
        </div>
      )}

      {reviewMode==="full"&&<div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-5">

        {/* ── STEP 0: Program Info ── */}
        {activeStep===0&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">📋 Program Information</div>

            {/* Program name with auto-match */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Program Name <span className="text-red-400">*</span></label>
              <input value={form.program_name} onChange={e=>handleProgramName(e.target.value)}
                list="program-list" className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2"/>
              <datalist id="program-list">
                {[...new Set((programs||[]).map(p=>p.name).filter(Boolean))].sort().map(n=><option key={n} value={n}/>)}
              </datalist>
              {matchedProgram&&(()=>{
                const mk=calcKPIs(matchedProgram);
                const dc=(matchedProgram.act_personnel||0)+(matchedProgram.act_commodities||0)+(matchedProgram.act_contractuals||0)+(matchedProgram.act_other1||0)+(matchedProgram.act_other2||0);
                return(
                  <div className="mt-1.5 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-700 space-y-1">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                      <span className="font-bold">✓ Matched —</span>
                      <span>Fill: <b>{Math.round((mk.fillRate||0)*100)}%</b></span>
                      <span>CR: <b>{Math.round((mk.costRecovery||0)*100)}%</b></span>
                      <span>Revenue: <b>{dollar(matchedProgram.act_revenue||0)}</b></span>
                      <span>Direct Costs: <b>{dollar(dc)}</b></span>
                      {matchedProgram.act_enrollment>0&&<span>Enrolled: <b>{matchedProgram.act_enrollment}/{matchedProgram.act_capacity}</b></span>}
                      <span className="text-blue-500">All fields pre-filled ↓</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {inp("Supervisor","supervisor","text",null,true)}
              {inp("Program Area","area",null,[""].concat(AREAS))}
              {inp("Season","season",null,SEASONS_LIST)}
              {inp("Fiscal Year","fy",null,ADMIN_FYS)}
              {inp("Review Date","review_date","date")}
              {inp("Classification","classification",null,CLASSIFICATIONS)}
              {inp("Target Age Group","target_age",null,AGE_GROUPS)}
              {inp("Seasons Offered (total)","seasons_offered","number","",false,"How many seasons has this program run in total?")}
            </div>

            {/* Prior season snapshot if available */}
            {prior&&(
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-4">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Prior Season Data — {prior.fy}</div>
                <div className="flex gap-6 text-sm">
                  <div><span className="text-slate-400">Fill Rate: </span><span className="font-bold text-slate-700">{prior.fill_rate}%</span></div>
                  <div><span className="text-slate-400">Cost Recovery: </span><span className="font-bold text-slate-700">{prior.cost_recovery}%</span></div>
                  {prior.enrollment&&<div><span className="text-slate-400">Enrollment: </span><span className="font-bold text-slate-700">{prior.enrollment}</span></div>}
                </div>
              </div>
            )}

            {/* Review history */}
            {hist.length>0&&(
              <div className="rounded-lg border border-slate-100 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-widest">Past Reviews — {form.program_name||"this program"}</div>
                {hist.slice(0,3).map((h,i)=>(
                  <div key={i} className="px-4 py-2.5 border-t border-slate-50 flex items-center gap-3 text-xs">
                    <span className="px-2 py-0.5 rounded font-bold text-white" style={{background:dcColor[h.decision]||"#64748b"}}>{h.decision}</span>
                    <span className="text-slate-500">{h.season} {h.fy}</span>
                    <span>Fill: <b>{h.fill_rate||0}%</b></span>
                    <span>CR: <b>{h.cost_recovery||0}%</b></span>
                    {h.action_items&&<span className="text-slate-400 truncate ml-2">→ {h.action_items}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── STEP 1: Financial ── */}
        {activeStep===1&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">💰 Financial Stewardship <span className="text-xs font-normal text-red-500 ml-2">Required Pillar</span></div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {inp("Revenue ($)","revenue","number")}
              {inp("Direct Costs ($)","direct_costs","number")}
              {inp("Cost Recovery (%)","cost_recovery","number")}
              {inp("Prior Season CR (%)","prior_cr","number","",false,"Last season's cost recovery for comparison")}
            </div>
            {form.revenue&&form.direct_costs&&(
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 flex items-center gap-6 text-sm">
                <div><span className="text-slate-400">Net: </span>
                  <span className={`font-bold ${parseFloat(form.revenue)-parseFloat(form.direct_costs)>=0?"text-green-600":"text-red-600"}`}>
                    ${(parseFloat(form.revenue||0)-parseFloat(form.direct_costs||0)).toLocaleString()}
                  </span>
                </div>
                {form.prior_cr&&form.cost_recovery&&(
                  <div><span className="text-slate-400">CR Change: </span>{delta(form.cost_recovery,form.prior_cr)}</div>
                )}
              </div>
            )}
            <div className="space-y-2">
              {chk("Below 50% cost recovery?","below_50_cr","Requires redesign or documented intentional subsidy")}
              {form.below_50_cr&&inp("Required Action","cr_action",null,["Redesign required","Intentional Community subsidy (documented)"])}
              {chk("Financial performance is acceptable for this classification","fs_acceptable")}
            </div>
            {divider("Reflection")}
            {scPair("fs_strengths","fs_concerns")}
            {ta("Additional Notes","fs_notes",2,"Any context on revenue, cost drivers, pricing changes…")}
          </>
        )}

        {/* ── STEP 2: Data ── */}
        {activeStep===2&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">📊 Data & Accountability <span className="text-xs font-normal text-red-500 ml-2">Required Pillar</span></div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 mb-2">
              Leave any field blank if you don't have the data — it will not count against the review.
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {inp("Fill Rate (%)","fill_rate","number","",false,"Actual enrollment ÷ capacity")}
              {inp("Prior Season Fill (%)","prior_fill_rate","number","",false,"Last season for comparison")}
              {inp("NPS Score (0–100)","nps","number","",false,"Leave blank if not collected")}
            </div>

            {form.fill_rate&&form.prior_fill_rate&&(
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-sm flex items-center gap-6">
                <div><span className="text-slate-400">Fill Change: </span>{delta(form.fill_rate,form.prior_fill_rate)}</div>
                {parseFloat(form.fill_rate)<60&&<span className="font-bold text-red-600">⚠ Below 60% threshold</span>}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {inp("Trend Direction","trend",null,TRENDS)}
              {inp("Seasons Below Threshold","seasons_below_threshold",null,WEAK_OPTS,"","Number of seasons below fill rate or cost recovery target")}
            </div>

            <div className="space-y-2">
              {chk("Fill rate is currently below 60%","below_60_fill")}
              {chk("Program needs additional review this season","needs_review","Triggers a required follow-up plan")}
              {form.needs_review&&inp("Follow-Up Action","review_action",null,["Redesign plan in progress","Sunset review scheduled","Schedule planning conversation"])}
            </div>

            {parseInt(form.seasons_below_threshold)>=2&&(
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 font-medium">
                📋 {form.seasons_below_threshold} seasons below threshold — a follow-up plan is recommended per district policy.
              </div>
            )}

            {divider("Reflection")}
            {scPair("da_strengths","da_concerns")}
            {ta("Additional Notes","da_notes",2,"Enrollment context, data anomalies, known one-time factors…")}
          </>
        )}

        {/* ── STEP 3: Community ── */}
        {activeStep===3&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">🤝 Participation & Community Impact</div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 mb-2">
              Leave any field blank if you don't have the data — it will not count against the review.
            </div>
            <div className="grid grid-cols-3 gap-4">
              {inp("Enrollment","enrollment","number")}
              {inp("Capacity","capacity","number")}
              {inp("Waitlist","waitlist","number")}
            </div>
            {form.enrollment&&form.capacity&&(
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
                <span className="text-slate-400">Fill: </span>
                <span className="font-bold text-slate-700">{Math.round((parseFloat(form.enrollment)/parseFloat(form.capacity))*100)}%</span>
                {parseFloat(form.waitlist)>0&&<span className="ml-4 text-amber-600 font-semibold">{form.waitlist} on waitlist — expansion opportunity?</span>}
              </div>
            )}
            <div className="space-y-2">
              {chk("Clear target audience identified","clear_audience","Program has a defined population it serves")}
              {chk("Community benefit is documented","community_benefit","Evidence of value beyond enrollment numbers — feedback, outcomes, mission alignment")}
              {chk("Documented community need or request drives this program","documented_need","E.g. resident survey, staff observation, needs assessment, board direction")}
            </div>
            {divider("Reflection")}
            {scPair("ci_strengths","ci_concerns")}
            {ta("Additional Notes","ci_notes",2,"Participant feedback, demographic observations, community relationships…")}
          </>
        )}

        {/* ── STEP 4: Space ── */}
        {activeStep===4&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">🏢 Space & Operational Efficiency</div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 mb-2">
              Leave any field blank if you don't have the data.
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {inp("Prime Time Space Use","prime_time_use",null,PRIME)}
              {inp("Day / Time of Program","scheduling_changes","text","",false,"E.g. Tuesday evenings, Saturday mornings")}
            </div>
            <div className="space-y-2">
              {chk("Time or location could be improved","time_improvable","A different day, time, or facility could improve attendance or efficiency")}
              {chk("Participant-to-staff ratio is appropriate","ratio_appropriate","Ratio reflects actual enrollment — not just what was budgeted")}
            </div>
            {ta("Facility Barriers or Constraints","facility_barriers",2,"Any issues with space availability, setup time, equipment access, or scheduling conflicts…")}
            {ta("Space & Operations Notes","space_notes",2,"Scheduling opportunities, ratio adjustments, facility improvements that would help…")}
          </>
        )}

        {/* ── STEP 5: Innovation ── */}
        {activeStep===5&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">💡 Innovation & Responsiveness</div>
            <div className="space-y-2 mb-4">
              {chk("This is a new or pilot program","is_pilot","New offering within the last 2 seasons")}
              {chk("An adaptation or change was made this season","is_adaptation","Format, pricing, timing, instructor, or audience was intentionally adjusted")}
            </div>
            {form.is_pilot&&(
              <div className="space-y-4 p-4 rounded-lg bg-purple-50 border border-purple-100">
                <div className="text-xs font-bold text-purple-700 uppercase tracking-widest">Pilot Program Details</div>
                {ta("Pilot Goal","pilot_goal",2,"What was this pilot trying to achieve? What was the hypothesis?")}
                <div className="space-y-2">
                  {chk("Met enrollment expectations","met_enrollment")}
                  {chk("Met financial expectations","met_financial")}
                </div>
              </div>
            )}
            {ta("Adaptations Made This Season","adaptation_made",2,"What changed from the prior season — intentionally or in response to feedback? Leave blank if nothing changed.")}
            {ta("Future Potential","future_potential",2,"Is there an opportunity to grow, expand, or modify this program? Any emerging community interest worth exploring?")}
            {ta("Innovation Notes","innovation_notes",2,"Ideas, lessons learned, things you'd try differently…")}
          </>
        )}

        {/* ── STEP 6: Decision ── */}
        {activeStep===6&&(
          <>
            <div className="text-sm font-bold text-slate-700 border-b border-slate-100 pb-2">✅ Final Decision</div>

            {/* Pillar summary */}
            <div className="rounded-lg border border-slate-100 overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-widest">Pillar Summary</div>
              {pillars.map(p=>(
                <div key={p.n} className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-50">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{background:p.met?p.color:"#e2e8f0",color:p.met?"white":"#94a3b8"}}>{p.met?"✓":"○"}</span>
                  <span className="text-sm text-slate-600 flex-1">{p.label}</span>
                  {p.required&&<span className="text-xs text-red-500 font-semibold shrink-0">Required</span>}
                </div>
              ))}
              <div className="px-4 py-3 border-t" style={{background:overallPass?"#f0fdf4":"#fef2f2"}}>
                <span className={`text-sm font-bold ${overallPass?"text-green-700":"text-red-600"}`}>
                  {overallPass?"✓ Meets 3-pillar minimum":"✗ Does not meet minimum — redesign or sunset recommended"}
                </span>
              </div>
            </div>

            {/* Decision buttons */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2">Decision</label>
              <div className="grid grid-cols-3 gap-2">
                {DECISIONS.map(d=>(
                  <button key={d} onClick={()=>s("decision",d)}
                    className="py-2.5 px-3 rounded-lg text-xs font-bold border-2 transition"
                    style={form.decision===d?{background:dcColor[d],color:"white",borderColor:dcColor[d]}:{borderColor:"#e2e8f0",color:"#64748b"}}>
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {ta("Reason for Decision","decision_reason",2,"Why this decision was made, what context drove it…")}
            {ta("Action Items","action_items",3,"Specific next steps, who is responsible, and any deadlines. One item per line recommended.")}
            {inp("Next Review Date","next_review","date")}
          </>
        )}

        {/* Nav buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <button onClick={()=>setActiveStep(a=>Math.max(0,a-1))} disabled={activeStep===0}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 disabled:opacity-30">← Back</button>
          <div className="flex items-center gap-2">
            {autoSaving&&<span className="text-xs text-slate-400 italic">Saving…</span>}
            {activeStep<STEPS.length-1?(
              <button onClick={async()=>{await autoSave();setActiveStep(a=>a+1);}}
                className="px-5 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#1e3a5f"}}>Next →</button>
            ):(
              <button onClick={save}
                className="px-6 py-2 text-sm font-bold rounded-lg text-white" style={{background:"#16a34a"}}>
                {editRow?"Update Review":"Save Review"}
              </button>
            )}
          </div>
        </div>
      </div>}
    </div>
  );
}






// ─── Reference Tab ────────────────────────────────────────────────────────────
// ─── Program Guide Section ────────────────────────────────────────────────────
const BUILTIN_GUIDE = [
  // ─ Open Access ──────────────────────────────────────────────────────────────
  {program:"Alcott Center and Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Apple Hill",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Bicentennial Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Bison Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Cambridge Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Candlewood Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Canterbury Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Cherbourg Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Children's Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Churchill Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Commons Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Cooper Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Crossings Pond",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Didier Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Drazner Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Emmerich Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Frenchman's Cove",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Ivy Hall Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Kilmer Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Lions Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Longfellow Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Marth Weiss Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Mill Creek Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Mirielle Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Nicole / Site 21",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Northwood / Detention",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Old Farm Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Oxford Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Prairie Grove Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Prairie School Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Raupp Museum",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Reiner Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Reservoir 7",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Risinger Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Rolling Hills",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Rolling Hills North",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Rylko Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Sommerset / Detention",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Tartan Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Veterans Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Weidner Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Wellington Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Westchester Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Willow Stream Park North",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Willow Stream Park South",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Windfield / Detention",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Windsor Ridge Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  {program:"Woodland Park",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"},
  // ─ Community Events ─────────────────────────────────────────────────────────
  {program:"Veterans Day",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Uniquely Us Events",type:"Large Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Earth Day Celebration",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Kite Fly",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Mighty Machine Meet-Up",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Flag Day",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"NNO",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Movies Under the Stars",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"BG Days",type:"Large Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Summer Kickoff",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Summer Concert Series",type:"Large Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Tots in the Park",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Canine Costume Contest",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Green Fair",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  {program:"Trick or Treat Trail",type:"Small Event",bucket:"Community Events",cr:"80-100% Subsidy"},
  // ─ Specialty Events ─────────────────────────────────────────────────────────
  {program:"Senior Expo",type:"Large Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Scout Badge Day",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Puzzle Palooza",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Productions / Recitals",type:"Production / Major Program",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Arts & Crafts Fair",type:"Large Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Holiday Shop",type:"Large Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Santa's Mailbox",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Superhero and Princess Party",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"BG STEM Expo",type:"Large Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"You've Been Egged",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Night Owl Egg Hunt",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Disc Golf Tournament",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Bow Wow Dog Expo",type:"Large Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Camping Under the Stars",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Glow & Show 5K",type:"Large Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Huck Finn Fishing Derby",type:"Large Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"AARP",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Cardboard Boat Regatta",type:"Large Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  {program:"Membership Appreciation",type:"Small Event",bucket:"Specialty Events",cr:"0-5% Subsidy"},
  // ─ Beg/Intro Activities ─────────────────────────────────────────────────────
  {program:"Kid Rock",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Gymnastics 2-6",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Karate Beginner",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Cricket Beginner",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Chess Beginner",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Karate Adult/Youth Beginning",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Tennis 4-6",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Twin Rinks",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Hot Shots",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Tae Kwon Do Beginner",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Safety Town",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Fencing Beginner",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Pickleball Clinic",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Junior Golf Level 1",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Adult Golf Level 1",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Lifeguard Classes",type:"Large Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Camp in a Bag",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"School Educational Programs",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Thanksgiving Class",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Love, Murder, Science",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Gardening Classes",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Mom and Me Tea",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Scout Programs",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Water Babies",type:"Large Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Water Tots",type:"Large Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Tadpoles",type:"Large Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Broadway Buddies",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Showbiz Kids",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Center Stage Stars",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Acting, Improv, Musical Theater",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Visual Arts Classes Beginners",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Dance Academy",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Nature Classroom Programs",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Family Dig Day",type:"Small Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  {program:"Affiliates",type:"Large Contractual Program",bucket:"Beg./Intro. Activities",cr:"100%+"},
  // ─ Drop-In Activities ───────────────────────────────────────────────────────
  {program:"Open Gym Sports",type:"Drop-In Program",bucket:"Drop In Activities",cr:"100-105%+"},
  {program:"Open Arts Studio",type:"Drop-In Program",bucket:"Drop In Activities",cr:"100-105%+"},
  {program:"Drop-In Fencing",type:"Drop-In Program",bucket:"Drop In Activities",cr:"100-105%+"},
  {program:"Drop-In Museum Visits",type:"Drop-In Program",bucket:"Drop In Activities",cr:"100-105%+"},
  // ─ Childcare Services ───────────────────────────────────────────────────────
  {program:"Camps (all)",type:"Camp",bucket:"Childcare Services",cr:"110-130%+"},
  {program:"Preschool",type:"Production / Major Program",bucket:"Childcare Services",cr:"110-130%+"},
  {program:"Clubhouse (all sites)",type:"Production / Major Program",bucket:"Childcare Services",cr:"110-130%+"},
  {program:"EC Classes",type:"Small Program",bucket:"Childcare Services",cr:"110-130%+"},
  // ─ Int/Adv Activities ───────────────────────────────────────────────────────
  {program:"Chess Intermediate / Advanced",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Computer Explorers",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Gymnastics 5-10",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Karate (Intermediate/Adv)",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Lacrosse",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Tennis 7-15",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Cheerleading",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Boys Flag Football",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Girls Flag Football",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"All-Star Sports",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"OTA",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Tae Kwon Do (Adv)",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Fencing (Intermediate/Adv)",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Softball",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Pickleball",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Volleyball",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Bags",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Whiffleball",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Kickball",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Aqua Arthritis",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Choose to Lose / Spring Fit",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Stress Management",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Team Fit & Strong",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Group Weight Lifting",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"TRX Core Training",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Youth Boxing",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Strong Girls",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Youth Fitness",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Teen Boxing",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Swim for Fitness",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Evolution Basketball Camp",type:"Camp",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Junior Golf Level 2",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Golf Level 2",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Challenger Soccer Camp",type:"Camp",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Spring Fit Challenge",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Rotational Sports Conditioning",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Kickboxing Fitness",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Sound Journeys",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"FC Member Workshops",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Drawing & Painting",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Mah Jongg Tournament",type:"Small Event",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Trips",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Cyclones Swim Team",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Hurricane Swim Team",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Group Swim Lessons",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Forever Fit",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Hatha Yoga",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Zumba",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Zumba Gold",type:"Large Contractual Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Wedding Dress Workshop",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Bingo Luncheon",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Monthly Parties",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Holiday Party",type:"Small Event",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Luncheons",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Youth Soccer",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"BG Singers",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"BG Singers Encore",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Scene Study",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Skyline Theater",type:"Production / Major Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Big Deal Acting Troupe",type:"Production / Major Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Visual Arts (Advanced)",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Dance Company",type:"Production / Major Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Winter Dance Prep",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"House League BBall",type:"League",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Adult Non-Musical",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Fall Children's Theater",type:"Production / Major Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Winter Teen Theater",type:"Production / Major Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Summer Musical",type:"Production / Major Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Fall Young Children's Musical",type:"Production / Major Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Spring Children's Theater",type:"Production / Major Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Swim Team Prep",type:"Large Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Audition Workshops",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  {program:"Swim Team Tryouts",type:"Small Program",bucket:"Intermediate/Adv. Activities",cr:"110-130%+"},
  // ─ Private/Semi-Private ─────────────────────────────────────────────────────
  {program:"FC Personal Training",type:"Large Program",bucket:"Private/Semi-Private Activities",cr:"130-150%+"},
  {program:"FC Reformer",type:"Large Program",bucket:"Private/Semi-Private Activities",cr:"130-150%+"},
  {program:"FC Pilates",type:"Large Program",bucket:"Private/Semi-Private Activities",cr:"130-150%+"},
  {program:"FC Wellness Coaching",type:"Large Program",bucket:"Private/Semi-Private Activities",cr:"130-150%+"},
  {program:"Golf Pro Lessons",type:"Large Contractual Program",bucket:"Private/Semi-Private Activities",cr:"130-150%+"},
  {program:"Private Swim Lessons",type:"Large Program",bucket:"Private/Semi-Private Activities",cr:"130-150%+"},
  {program:"Piano Lessons",type:"Large Contractual Program",bucket:"Private/Semi-Private Activities",cr:"130-150%+"},
  {program:"Swim Team Privates",type:"Large Program",bucket:"Private/Semi-Private Activities",cr:"130-150%+"},
  // ─ Specialized Services ─────────────────────────────────────────────────────
  {program:"FC Memberships",type:"Production / Major Program",bucket:"Specialized Activities",cr:"130-150%+"},
  {program:"5 Hour Pass",type:"Small Contractual Program",bucket:"Specialized Activities",cr:"130-150%+"},
  {program:"Season Pass",type:"Small Contractual Program",bucket:"Specialized Activities",cr:"130-150%+"},
  {program:"Golf Dome (admissions)",type:"Small Contractual Program",bucket:"Specialized Activities",cr:"130-150%+"},
  {program:"Dog Park",type:"Small Contractual Program",bucket:"Specialized Activities",cr:"130-150%+"},
  {program:"SNP Admission / Passes",type:"Small Contractual Program",bucket:"Specialized Activities",cr:"130-150%+"},
  {program:"WSP Admission / Passes",type:"Small Contractual Program",bucket:"Specialized Activities",cr:"130-150%+"},
  {program:"Senior Membership Fee",type:"Small Contractual Program",bucket:"Specialized Activities",cr:"130-150%+"},
  // ─ Rentals ──────────────────────────────────────────────────────────────────
  {program:"CAC Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"Alcott Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"GD Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"SNP Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"WSP Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"Amphitheater Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"Shelter Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"Fields & Courts Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"FC Rentals",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"Birthday Parties",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  {program:"Food Trucks",type:"Small Contractual Program",bucket:"Rentals",cr:"130-150%+"},
  // ─ Retail ───────────────────────────────────────────────────────────────────
  {program:"Concessions",type:"Small Contractual Program",bucket:"Retail & Consumables",cr:"130-150%+"},
  {program:"Pro Shop",type:"Small Contractual Program",bucket:"Retail & Consumables",cr:"130-150%+"},
];

const BUCKET_COLORS={"Open Access":"#e0e7ff","Community Events":"#fef3c7","Specialty Events":"#fef9c3","Beg./Intro. Activities":"#dcfce7","Drop In Activities":"#d1fae5","Childcare Services":"#dbeafe","Intermediate/Adv. Activities":"#ede9fe","Private/Semi-Private Activities":"#fce7f3","Specialized Activities":"#fee2e2","Rentals":"#f1f5f9","Retail & Consumables":"#f1f5f9"};
const BUCKET_TEXT={"Open Access":"#3730a3","Community Events":"#92400e","Specialty Events":"#854d0e","Beg./Intro. Activities":"#166534","Drop In Activities":"#065f46","Childcare Services":"#1e40af","Intermediate/Adv. Activities":"#5b21b6","Private/Semi-Private Activities":"#9d174d","Specialized Activities":"#991b1b","Rentals":"#334155","Retail & Consumables":"#334155"};
const BUCKET_CR={"Open Access":"100% Subsidy","Community Events":"80-100% Subsidy","Specialty Events":"0-5% Subsidy","Beg./Intro. Activities":"100%+ CR","Drop In Activities":"100-105%+ CR","Childcare Services":"110-130%+ CR","Intermediate/Adv. Activities":"110-130%+ CR","Private/Semi-Private Activities":"130-150%+ CR","Specialized Activities":"130-150%+ CR","Rentals":"130-150%+ CR","Retail & Consumables":"130-150%+ CR"};

function ProgramGuideSection({isManager,db}){
  const [search,setSearch]=useState("");
  const [custom,setCustom]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showAdd,setShowAdd]=useState(false);
  const [editRow,setEditRow]=useState(null);
  const [form,setForm]=useState({program:"",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"});
  const [saving,setSaving]=useState(false);

  const BUCKETS=[...new Set(BUILTIN_GUIDE.map(g=>g.bucket))];
  const CR_OPTIONS=["100% Subsidy","80-100% Subsidy","0-5% Subsidy","100%+","100-105%+","110-130%+","130-150%+"];
  const [openBuckets,setOpenBuckets]=useState({});
  function toggleBucket(b){setOpenBuckets(prev=>({...prev,[b]:!prev[b]}));}

  async function loadCustom(){
    setLoading(true);
    const {data,error}=await db.from("admin_program_guide").select("*").order("bucket").order("program");
    if(error) console.warn("Program guide load error:", error.message);
    setCustom(data||[]);
    setLoading(false);
  }
  useEffect(()=>{loadCustom();},[]);

  async function saveEntry(){
    if(!form.program.trim()) return;
    setSaving(true);
    try {
      if(editRow){
        if(editRow.id){
          const {error:ue}=await db.from("admin_program_guide").update({program:form.program,type:form.type,bucket:form.bucket,cr:form.cr}).eq("id",editRow.id);
          if(ue) throw ue;
        } else {
          const {error:be}=await db.from("admin_program_guide").insert({...form,builtin_key:editRow.builtin_key||editRow.program});
          if(be) throw be;
        }
      } else {
        const {error:ne}=await db.from("admin_program_guide").insert({...form});
        if(ne) throw ne;
      }
      setShowAdd(false);
      setEditRow(null);
      setForm({program:"",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"});
      loadCustom();
    } catch(err){
      alert("Failed to save guide entry: "+(err.message||"unknown error"));
    }
    setSaving(false);
  }
  async function deleteEntry(id,builtinKey){
    if(id){
      const {error:de}=await db.from("admin_program_guide").delete().eq("id",id);
      if(de) console.warn("Guide delete error:", de.message);
    } else if(builtinKey){
      const {error:ie}=await db.from("admin_program_guide").insert({program:builtinKey,type:"",bucket:"",cr:"",builtin_key:builtinKey,is_deleted:true});
      if(ie) console.warn("Guide tombstone error:", ie.message);
    }
    loadCustom();
  }
  function startEdit(row){
    setEditRow(row);
    setForm({program:row.program,type:row.type,bucket:row.bucket,cr:row.cr});
    setShowAdd(true);
  }

  // Build merged entry list:
  // - Deleted built-ins are excluded
  // - Overridden built-ins show the override instead
  // - New custom entries appended
  const deletedKeys = new Set(custom.filter(c=>c.is_deleted&&c.builtin_key).map(c=>c.builtin_key));
  const overrideMap = {};
  custom.filter(c=>!c.is_deleted&&c.builtin_key).forEach(c=>{overrideMap[c.builtin_key]=c;});
  const mergedBuiltins = BUILTIN_GUIDE
    .filter(g=>!deletedKeys.has(g.program))
    .map(g=>overrideMap[g.program]?{...overrideMap[g.program],overridden:true}:{...g,builtin:true});
  const pureCustom = custom.filter(c=>!c.is_deleted&&!c.builtin_key).map(c=>({...c,custom:true}));
  const allEntries=[...mergedBuiltins,...pureCustom];
  const q=search.trim().toLowerCase();
  const filtered=q?allEntries.filter(g=>g.program.toLowerCase().includes(q)||g.type.toLowerCase().includes(q)||g.bucket.toLowerCase().includes(q)):null;

  const selCls="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white";

  return(
    <div className="p-5 space-y-5">
      <div>
        <h2 className="font-bold text-slate-800 text-base mb-1">Program Types & Guide</h2>
        <p className="text-sm text-slate-500">Every BGPD program mapped to its Program Type and 110% cost recovery target. Use this when entering a new program to pick the right type.</p>
      </div>

      {/* Program Type workload table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-800 text-slate-100 text-xs font-bold uppercase tracking-widest">Program Type Workload Reference</div>
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 text-slate-400 uppercase tracking-wider text-left">
            <th className="px-4 py-2 font-semibold">Program Type</th>
            <th className="px-4 py-2 font-semibold">Default %</th>
            <th className="px-4 py-2 font-semibold">When to use</th>
          </tr></thead>
          <tbody>{PROGRAM_TYPES.map((t,i)=>(
            <tr key={t.label} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
              <td className="px-4 py-2.5 font-semibold text-slate-700">{t.label}</td>
              <td className="px-4 py-2.5 font-mono text-slate-500">{(t.pct*100).toFixed(1)}%</td>
              <td className="px-4 py-2.5 text-slate-400 leading-snug">{t.hint}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
          <span className="font-bold">Camp & Clubhouse / Preschool supervisors:</span> Both types can stack quickly across multiple programs. Use <span className="font-semibold">Custom Workload %</span> to enter your actual total allocation for the full portfolio in one entry.
        </div>
      </div>

      {/* Search + add */}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search program name, type, or bucket…"
          className="flex-1 min-w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:border-blue-400"/>
        {search&&<button onClick={()=>setSearch("")} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>}
        <span className="text-xs text-slate-400">{filtered?`${filtered.length} match${filtered.length!==1?"es":""}`:`${allEntries.length} programs${custom.length>0?` (${custom.length} custom)`:""}`}</span>
        {isManager&&(
          <button onClick={()=>{setShowAdd(true);setEditRow(null);setForm({program:"",type:"Small Contractual Program",bucket:"Open Access",cr:"100% Subsidy"});}}
            className="text-xs font-bold px-3 py-2 rounded-lg text-white shrink-0" style={{background:"#1e3a5f"}}>
            + Add Program
          </button>
        )}
      </div>

      {/* Manager add/edit form */}
      {isManager&&showAdd&&(
        <div className="rounded-xl border border-slate-200 p-5 space-y-4 bg-slate-50">
          <div className="font-semibold text-slate-700 text-sm">{editRow?"Edit Entry":"Add Program to Guide"}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Program Name *</label>
              <input value={form.program} onChange={e=>setForm(f=>({...f,program:e.target.value}))}
                className={selCls} placeholder="e.g. New Pilates Class"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Program Type</label>
              <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} className={selCls}>
                {PROGRAM_TYPES.map(t=><option key={t.label}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Service Category</label>
              <select value={form.bucket} onChange={e=>{
                const b=e.target.value;
                const autoCR=BUCKET_CR[b]||"";
                setForm(f=>({...f,bucket:b,cr:autoCR}));
              }} className={selCls}>
                {BUCKETS.map(b=><option key={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">CR Target <span className="font-normal text-slate-400">(auto-fills from category)</span></label>
              <input value={form.cr} onChange={e=>setForm(f=>({...f,cr:e.target.value}))}
                className={selCls} placeholder="e.g. 110-130%+"/>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveEntry} disabled={!form.program.trim()||saving}
              className="px-4 py-2 text-sm font-bold rounded-lg text-white disabled:opacity-40"
              style={{background:"#1e3a5f"}}>{saving?"Saving…":editRow?"Update":"Save"}</button>
            <button onClick={()=>{setShowAdd(false);setEditRow(null);}}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {/* Search results */}
      {filtered&&(
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
              <th className="px-4 py-2 text-left font-semibold">Program</th>
              <th className="px-4 py-2 text-left font-semibold">Program Type</th>
              <th className="px-4 py-2 text-left font-semibold">Service Category</th>
              <th className="px-4 py-2 text-left font-semibold">CR Target</th>
              {isManager&&<th className="px-4 py-2"/>}
            </tr></thead>
            <tbody>{filtered.map((g,i)=>(
              <tr key={i} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                <td className="px-4 py-2.5 font-medium text-slate-700">
                  {g.program}
                  {g.custom&&<span className="ml-1.5 text-xs font-semibold text-blue-500">custom</span>}{g.overridden&&<span className="ml-1.5 text-xs font-semibold text-amber-500">edited</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-400 text-xs">{g.type}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{background:BUCKET_COLORS[g.bucket]||"#f1f5f9",color:BUCKET_TEXT[g.bucket]||"#334155"}}>
                    {g.bucket}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{g.cr}</td>
                {isManager&&<td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button onClick={()=>startEdit(g)} className="text-xs text-slate-400 hover:text-slate-700 mr-2">Edit</button>
                  <button onClick={()=>deleteEntry(g.id,!g.id?g.program:null)} className="text-xs text-red-300 hover:text-red-600">Delete</button>
                </td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Grouped by bucket */}
      {!filtered&&BUCKETS.map(bucket=>{
        const builtIn=BUILTIN_GUIDE.filter(g=>g.bucket===bucket);
        const cust=custom.filter(g=>g.bucket===bucket);
        const items=[...builtIn,...cust.map(c=>({...c,custom:true}))];
        const bg=BUCKET_COLORS[bucket]||"#f1f5f9";
        const tx=BUCKET_TEXT[bucket]||"#334155";
        const isOpen=!!openBuckets[bucket];
        return(
          <div key={bucket} className="rounded-xl border border-slate-200 overflow-hidden">
            <button onClick={()=>toggleBucket(bucket)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left transition hover:opacity-90"
              style={{background:bg}}>
              <span className="text-xs font-bold uppercase tracking-widest" style={{color:tx}}>{bucket}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold" style={{color:tx}}>{BUCKET_CR[bucket]}</span>
                <span className="text-xs" style={{color:tx,opacity:.7}}>{items.length} program{items.length!==1?"s":""}</span>
                <span className="text-xs font-bold" style={{color:tx,opacity:.6,transform:isOpen?"rotate(180deg)":"rotate(0deg)",display:"inline-block",transition:"transform .2s"}}>▼</span>
              </div>
            </button>
            {isOpen&&(
              <table className="w-full text-sm">
                <thead><tr className="bg-white text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-4 py-2 text-left font-semibold">Program</th>
                  <th className="px-4 py-2 text-left font-semibold">Program Type to Use</th>
                  {isManager&&<th className="px-4 py-2"/>}
                </tr></thead>
                <tbody>{items.map((g,i)=>(
                  <tr key={i} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                    <td className="px-4 py-2.5 text-slate-700 font-medium">
                      {g.program}
                      {g.custom&&<span className="ml-1.5 text-xs font-semibold text-blue-500">custom</span>}{g.overridden&&<span className="ml-1.5 text-xs font-semibold text-amber-500">edited</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{g.type}</td>
                    {isManager&&<td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={()=>startEdit(g)} className="text-xs text-slate-400 hover:text-slate-700 mr-2">Edit</button>
                      <button onClick={()=>deleteEntry(g.id,!g.id?g.program:null)} className="text-xs text-red-300 hover:text-red-600">Delete</button>
                    </td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}


function Reference({isManager,db,programs,staffName}) {
  const [sec,setSec] = useState("standards");
  const workload = [
    {activity:"Program planning & management", pct:"50-60%"},
    {activity:"Meetings / admin",              pct:"15-20%"},
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
          {id:"kpis",label:"Program Types & Guide"},
          {id:"philosophy",label:"🏛 Philosophy"},
          {id:"guide",label:"Dashboard Guide"},
          {id:"training",label:"📋 Training Guide"},
          {id:"review",label:"📋 Program Review"},
          ...(isManager?[{id:"clubhouse",label:"🏫 Clubhouse Allocation"}]:[]),
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
      {sec==="kpis"&&<ProgramGuideSection isManager={isManager} db={db}/>}

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
            <p className="text-sm text-slate-600 mb-3">A single composite number summarizing overall program inventory performance. Weighted across four dimensions:</p>
            <div className="space-y-2 mb-4">
              {[
                {weight:"35%", label:"Average Fill Rate",      desc:"Across all visible programs. Are people showing up? The most direct demand signal."},
                {weight:"35%", label:"Average Cost Recovery",  desc:"How well programs are meeting their financial targets. Capped at 200% so outliers don't skew the score."},
                {weight:"15%", label:"% of Programs Healthy",  desc:"What proportion of programs have Healthy status. Rewards a well-distributed portfolio, not just a few standouts."},
                {weight:"15%", label:"Net P/L Signal",         desc:"Is the portfolio generating a surplus or running a loss? Surplus = full credit, scales down proportionally for losses."},
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
              Score = (min(avgCR, 2)/2 × 40) + (avgFill × 35) + (plSignal × 15) + (healthyPct × 10)
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
                  <th className="px-4 py-2 text-left font-semibold">Default %</th>
                  <th className="px-4 py-2 text-left font-semibold">FT $ Cost</th>
                  <th className="px-4 py-2 text-left font-semibold">When to use</th>
                </tr></thead>
                <tbody>{PROGRAM_TYPES.map((t,i)=>(
                  <tr key={t.label} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                    <td className="px-4 py-2 font-semibold text-slate-700">{t.label}</td>
                    <td className="px-4 py-2 text-slate-500 font-mono">{(t.pct*100).toFixed(1)}%</td>
                    <td className="px-4 py-2 text-slate-500 font-mono">${(97700*t.pct).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                    <td className="px-4 py-2 text-slate-400 leading-snug">{t.hint||""}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              <p>A staff member running 5 Small Programs (3% each) and 1 Large Event (5%) would show <span className="font-mono font-bold">20% allocated</span> — well within the 60% ceiling. The remaining 40% covers non-program time: planning, meetings, marketing, and strategic work.</p>
              <p className="font-semibold text-slate-700 mt-2">Multi-Site Supervisors (Clubhouse)</p>
              <p>A rec supervisor overseeing 11 clubhouse sites should select <span className="font-semibold">Production / Major Program</span> and use the <span className="font-semibold">Custom Workload %</span> field to set their actual portfolio allocation (e.g. 50% total). Do not use the default 10% per site — that would stack to 110% and overstate the cost. The individual site entries used for revenue and cost tracking can be left at a low type or 0% custom workload.</p>
              <p className="font-semibold text-slate-700 mt-2">Camp Supervisors</p>
              <p>Select <span className="font-semibold">Camp</span> and enter once per curriculum group (Day Camp, Specialty Camp, EC) — not per individual week. If one supervisor runs several camp types, use Custom % to reflect the combined effort.</p>
              <p className="text-amber-700 font-medium mt-2">⚠ If a staff member shows 0% or unexpectedly low allocation, check that their programs have a Program Type selected in the Budgeted section.</p>
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

      {sec==="review"&&(
        <ProgramReviewSection db={db} programs={programs} staffName={staffName} isManager={isManager}/>
      )}
      {sec==="clubhouse"&&isManager&&(
        <ClubhouseAllocationTool db={db} programs={programs} staffName={staffName}/>
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
                    {icon:"📚",label:"Guide & Resources",color:"#d4a017",desc:"District standards, formulas, and this training guide. If you ever wonder what a number means or how it's calculated, this is where to look."},
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
                        {field:"Classification",tip:"Community Driven = offered for public benefit even at a subsidy (e.g. community events, adaptive programs). Revenue Driven = expected to cover costs (e.g. fitness classes, swimming lessons). Not sure? Ask your manager."},
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
                    <p>Not every program is expected to reach 100%. Community Driven programs (adaptive rec, community events, free events) may have a target of 0–20% by design — the district intentionally subsidizes them because they serve the community. Check the District Standards tab for your specific program category's target.</p>
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
                    {icon:"📊",label:"Health Score (0–100)",desc:"A composite score: Fill rate (35%) + Cost recovery vs. target (35%) + Program mix — % healthy (15%) + Net P/L signal (15%). One number that tells you how the portfolio is doing at a glance."},
                    {icon:"🚨",label:"Needs Attention queue",desc:"Auto-surfaced programs falling below thresholds. Your weekly action list — sorted worst first."},
                    {icon:"↕",label:"Year-over-year comparison",desc:"Each program row shows how fill rate and cost recovery changed vs. the same season last year."},
                    {icon:"💰",label:"Subsidy Burden",desc:"Total dollar amount the district subsidizes — the sum of all program deficits. Useful for budget conversations."},
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
                <p className="text-sm text-slate-600 mb-3">A composite 0–100 score combining four key signals. Useful for quick portfolio scanning and board-level communication.</p>
                <table className="w-full text-sm mb-4">
                  <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                    <th className="px-4 py-2 text-left font-semibold">Component</th>
                    <th className="px-4 py-2 text-left font-semibold">Weight</th>
                    <th className="px-4 py-2 text-left font-semibold">What it captures</th>
                  </tr></thead>
                  <tbody>
                    {[
                      {c:"Cost Recovery",     w:"40%",d:"Are programs meeting their service category financial targets? Primary signal — aligned with the 110% fiscal sustainability framework."},
                      {c:"Fill Rate",         w:"35%",d:"Are people showing up? Strong demand signal."},
                      {c:"Program Mix",       w:"10%",d:"What proportion of programs have Healthy status — lowest weight, as it flows from fill rate and CR."},
                      {c:"Net P/L Signal",    w:"15%",d:"Is the portfolio generating surplus or running a loss? Surplus = full credit, scales down for losses."},
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
                    {q:"The Health Score dropped significantly. What should I look for?",a:"Health Score weights cost recovery most heavily (40%), reflecting the 110% fiscal sustainability framework, then fill rate (35%), net P/L (15%), and program mix (10%). A significant drop usually means enrollment fell, cost recovery slipped below targets, or the ratio of Healthy programs declined. Filter by season or area to isolate which segment pulled the score down."},
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
      )}
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
  const effectiveManager = isManager && viewAsManager;

  const fetchAll = useCallback(async()=>{
    setLoading(true);
    const {data:p, error:fe} = await supabase.from("programs").select("*").order("created_at",{ascending:false});
    if(fe) setError("Failed to load programs: "+fe.message);
    // Normalize year format: convert any 4-digit years to YY-YY on load
    const normalized=(p||[]).map(prog=>{
      if(prog.year&&/^\d{4}$/.test(String(prog.year))){
        return {...prog, year:toFY(prog.year)};
      }
      return prog;
    });
    setPrograms(normalized); setLoading(false);
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
    const {error:de}=await supabase.from("programs").delete().eq("id",id);
    if(de) setError("Failed to delete program: "+de.message);
    else { await fetchAll(); setEditingProgram(null); setTab("dashboard"); }
    setSaving(false);
  };

  const handleArchiveProgram = async (id, archive) => {
    setSaving(true);
    const {error:ae}=await supabase.from("programs").update({is_archived: archive}).eq("id", id);
    if(ae) setError("Failed to archive program: "+ae.message);
    else { await fetchAll(); setEditingProgram(null); setTab("programs"); }
    setSaving(false);
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
    {id:"kpi",label:"Guide & Resources"},
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
          <div className="flex items-center gap-3">
            <BGPDLogo size={36}/>
            <div>
              <div className="text-white font-bold text-base leading-tight">Buffalo Grove Park District</div>
              <div className="text-xs font-semibold tracking-widest uppercase" style={{color:"#29ABE2"}}>
                {staffName}{isManager?(effectiveManager?" · Manager View":" · Staff View"):""}
              </div>
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
                programs={programs}
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
            {tab==="kpi"&&<Reference isManager={effectiveManager} db={supabase} programs={programs} staffName={staffName}/>}
          </>
        )}
      </main>
    </div>
  );
}
function ClubhouseAllocationTool({db,programs,staffName}){
  const SITES = [
    "Country Meadows","Ivy Hall","Kildeer","Kilmer","Longfellow",
    "Meridian","Prairie","Pritchett","Tripp","Willow Grove",
  ];

  const [season,setSeason]   = useState("all");
  const [year,setYear]       = useState("all");
  const [which,setWhich]     = useState("budgeted");
  const [mode,setMode]       = useState("enrollment"); // "enrollment"|"manual"
  const [catTotals,setCatTotals] = useState(Object.fromEntries(CB_COST_CATEGORIES.map(c=>[c,""])));
  // siteMap: site name → program id (user picks or auto-maps)
  const [siteMap,setSiteMap] = useState(Object.fromEntries(SITES.map(s=>[s,""])));
  // siteBasis: site name → enrollment count or manual %
  const [siteBasis,setSiteBasis] = useState(Object.fromEntries(SITES.map(s=>[s,""])));
  const [result,setResult]   = useState(null);
  const [applying,setApplying] = useState(false);
  const [applyStatus,setApplyStatus] = useState({});
  const [lastApplied,setLastApplied] = useState(null);
  const [err,setErr]         = useState("");

  const px       = which==="budgeted" ? "ant_" : "act_";
  const feeField = which==="budgeted" ? "ant_clubhouse_fee" : "act_clubhouse_fee";
  const allocField = which==="budgeted" ? "clubhouse_alloc" : "clubhouse_alloc_act";

  // Clubhouse programs for selected period
  const clubhouseProgs = useMemo(()=>
    programs.filter(p=>
      !p.is_archived &&
      p.area==="Clubhouse" &&
      (season==="all"||p.season===season) &&
      (year==="all"||toFY(p.year)===year)
    ).sort((a,b)=>a.name.localeCompare(b.name))
  ,[programs,season,year]);

  // Auto-map: match site names to programs, pull enrollment from program record
  function autoMap(){
    const newMap={...siteMap};
    const newBasis={...siteBasis};
    SITES.forEach(site=>{
      const match=clubhouseProgs.find(p=>
        p.name.toLowerCase().includes(site.toLowerCase())
      );
      if(match){
        newMap[site]=match.id;
        if(mode==="enrollment"){
          const enr=match[px+"enrollment"]||match.act_enrollment||match.ant_enrollment||"";
          newBasis[site]=enr?String(enr):"";
        }
      }
    });
    setSiteMap(newMap);
    setSiteBasis(newBasis);
    setResult(null);
    setApplyStatus({});
  }

  const grandTotal  = Object.values(catTotals).reduce((a,v)=>a+(parseFloat(v)||0),0);
  const totalBasis  = Object.values(siteBasis).reduce((a,v)=>a+(parseFloat(v)||0),0);
  const mappedCount = SITES.filter(s=>siteMap[s]).length;
  const pctValid    = mode==="manual" && Math.abs(totalBasis-100)<0.5;
  const enrValid    = mode==="enrollment" && totalBasis>0;
  const canCalc     = grandTotal>0 && (pctValid||enrValid) && mappedCount>0;

  function calculate(){
    setErr("");
    // Build per-site weight
    const weights={};
    SITES.forEach(s=>{
      weights[s] = mode==="enrollment"
        ? (totalBasis>0?(parseFloat(siteBasis[s])||0)/totalBasis:0)
        : (parseFloat(siteBasis[s])||0)/100;
    });

    // Allocate each category
    const alloc={};
    SITES.forEach(s=>{
      alloc[s]={};
      CB_COST_CATEGORIES.forEach(cat=>{
        alloc[s][cat]=Math.round((parseFloat(catTotals[cat])||0)*weights[s]);
      });
      alloc[s].total=CB_COST_CATEGORIES.reduce((sum,cat)=>sum+(alloc[s][cat]||0),0);
    });

    // Fix rounding: make sure mapped sites sum to grandTotal exactly
    const mappedSites=SITES.filter(s=>siteMap[s]);
    if(mappedSites.length>0){
      const distributed=mappedSites.reduce((sum,s)=>sum+alloc[s].total,0);
      const diff=Math.round(grandTotal)-distributed;
      if(diff!==0){
        // Apply rounding remainder to the site with the largest share
        const biggest=mappedSites.reduce((a,b)=>weights[a]>=weights[b]?a:b);
        alloc[biggest].total+=diff;
        const bigCat=CB_COST_CATEGORIES.reduce((a,b)=>
          (parseFloat(catTotals[b])||0)>=(parseFloat(catTotals[a])||0)?b:a,
          CB_COST_CATEGORIES[0]);
        alloc[biggest][bigCat]+=diff;
      }
    }
    setResult({weights,alloc,grandTotal});
    setApplyStatus({});
  }

  async function applyAll(){
    if(!result) return;
    setApplying(true);
    setErr("");
    const status={};
    const now=new Date().toISOString();

    for(const site of SITES){
      const progId=siteMap[site];
      if(!progId){status[site]="skipped";continue;}
      const fee=result.alloc[site].total;
      const snapshot={
        catTotals,siteBasis,mode,which,season,year,
        weight:(result.weights[site]*100).toFixed(1)+"%",
        appliedAt:now,appliedBy:staffName,siteTotal:fee,
      };
      try{
        const {error:e}=await db.from("programs")
          .update({[feeField]:fee,[allocField]:snapshot})
          .eq("id",progId);
        status[site]=e?"error":"ok";
        if(e) setErr(prev=>prev+(prev?"\n":"")+site+": "+e.message);
      } catch(ex){
        status[site]="error";
      }
    }
    setApplyStatus(status);
    setLastApplied(now);
    setApplying(false);
  }

  const appliedCount=Object.values(applyStatus).filter(v=>v==="ok").length;
  const errorCount=Object.values(applyStatus).filter(v=>v==="error").length;

  return(
    <div className="p-5 space-y-6">

      {/* Header */}
      <div className="rounded-xl p-5 text-white" style={{background:"linear-gradient(135deg,#1e3a5f,#0f2d4a)"}}>
        <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{color:"#29ABE2"}}>Clubhouse</div>
        <div className="text-xl font-black mb-1">Cost Allocation Tool</div>
        <p className="text-sm opacity-80">Enter district-wide cost totals, then weight each site by enrollment (or a custom %). The tool calculates each site's share and applies the allocated fee directly to each program record.</p>
      </div>

      {err&&(
        <div className="px-4 py-3 rounded-xl text-sm text-red-700 bg-red-50 border border-red-200">
          <div className="font-bold mb-1">⚠ Some sites failed to save</div>
          <div className="text-xs whitespace-pre-wrap">{err}</div>
        </div>
      )}

      {/* Step 1 — Period + Type */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Step 1 — Select Period & Type</div>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Season</label>
            <select value={season} onChange={e=>{setSeason(e.target.value);setResult(null);setApplyStatus({});}}
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
              <option value="all">All Seasons</option>
              {SEASONS.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Fiscal Year</label>
            <select value={year} onChange={e=>{setYear(e.target.value);setResult(null);setApplyStatus({});}}
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
              <option value="all">All Years</option>
              {YEARS.map(y=><option key={y} value={y}>{`FY ${y}`}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Apply To</label>
            <select value={which} onChange={e=>{setWhich(e.target.value);setApplyStatus({});}}
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
              <option value="budgeted">Budgeted Costs</option>
              <option value="actuals">Actual Costs</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Weight By</label>
            <select value={mode} onChange={e=>{setMode(e.target.value);setSiteBasis(Object.fromEntries(SITES.map(s=>[s,""])));setResult(null);}}
              className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
              <option value="enrollment">Enrollment</option>
              <option value="manual">Manual %</option>
            </select>
          </div>
        </div>
        <div className="px-5 pb-5 flex items-center gap-3 flex-wrap">
          <button onClick={autoMap} disabled={clubhouseProgs.length===0}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition">
            ↺ Auto-map & pull enrollment from program records
          </button>
          {lastApplied&&<span className="text-xs text-slate-400">Last applied {new Date(lastApplied).toLocaleString()}</span>}
          {clubhouseProgs.length===0&&(
            <span className="text-xs text-amber-600 font-medium">⚠ No Clubhouse programs found for this period</span>
          )}
        </div>
      </div>

      {/* Step 2 — Cost Totals */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
            Step 2 — District-Wide {which==="budgeted"?"Budgeted":"Actual"} Cost Totals
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Enter the combined total for all sites — the tool splits by enrollment weight</div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CB_COST_CATEGORIES.map(cat=>(
              <div key={cat}>
                <label className="block text-xs text-slate-500 mb-1">{cat}</label>
                <input type="number" min={0} value={catTotals[cat]}
                  onChange={e=>setCatTotals(t=>({...t,[cat]:e.target.value}))}
                  placeholder="0" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{MozAppearance:"textfield"}}/>
              </div>
            ))}
          </div>
          {grandTotal>0&&(
            <div className="mt-3 text-sm font-semibold text-slate-600">
              District Total: <span className="text-slate-800 font-bold">${Math.round(grandTotal).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Step 3 — Site Mapping + Weights */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Step 3 — Map Sites & Enter {mode==="enrollment"?"Enrollment":"Weight %"}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {mode==="enrollment"
                ? "Sites with more enrollment absorb more cost. Use the auto-map button above to pull enrollment from existing program records."
                : "Enter the percentage share for each site. Must total 100%."}
            </div>
          </div>
          <span className="text-xs text-slate-400 shrink-0">{mappedCount}/{SITES.length} mapped</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
              <th className="px-4 py-2 text-left font-semibold">Site</th>
              <th className="px-4 py-2 text-left font-semibold">Program Record</th>
              <th className="px-4 py-2 text-center font-semibold">{mode==="enrollment"?"Enrollment":"Weight %"}</th>
              <th className="px-4 py-2 text-center font-semibold">Share</th>
              <th className="px-4 py-2 text-right font-semibold">Current Fee</th>
            </tr></thead>
            <tbody>{SITES.map((site,i)=>{
              const prog=programs.find(p=>p.id===siteMap[site]);
              const currentFee=prog?prog[feeField]:null;
              const basisVal=parseFloat(siteBasis[site])||0;
              const share=mode==="enrollment"
                ?(totalBasis>0?basisVal/totalBasis:0)
                :basisVal/100;
              return(
                <tr key={site} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}>
                  <td className="px-4 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{site}</td>
                  <td className="px-4 py-2.5">
                    <select value={siteMap[site]} onChange={e=>{setSiteMap(m=>({...m,[site]:e.target.value}));setResult(null);}}
                      className="w-full text-sm rounded border border-slate-200 px-2 py-1 bg-white">
                      <option value="">— not mapped —</option>
                      {clubhouseProgs.map(p=>(
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <input type="number" min={0} max={mode==="manual"?100:undefined}
                      value={siteBasis[site]}
                      onChange={e=>{setSiteBasis(b=>({...b,[site]:e.target.value}));setResult(null);}}
                      placeholder={mode==="manual"?"0":""} 
                      className="w-20 rounded border border-slate-200 px-2 py-1 text-sm text-center focus:outline-none focus:ring-1"
                      style={{MozAppearance:"textfield"}}/>
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs font-mono text-slate-500">
                    {totalBasis>0||(mode==="manual"&&Math.abs(totalBasis-100)<0.5)
                      ?<span className="font-semibold text-slate-600">{(share*100).toFixed(1)}%</span>
                      :<span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-400">
                    {currentFee!=null&&currentFee>0
                      ?<span className="text-slate-600">${Math.round(currentFee).toLocaleString()}</span>
                      :<span>—</span>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        {mode==="manual"&&(
          <div className="px-4 py-2 border-t border-slate-100 text-xs font-semibold" style={{color:Math.abs(totalBasis-100)<0.5?"#16a34a":"#dc2626"}}>
            Total: {totalBasis.toFixed(1)}% {Math.abs(totalBasis-100)<0.5?"✓ Adds to 100%":"— must equal 100%"}
          </div>
        )}
        {mode==="enrollment"&&totalBasis>0&&(
          <div className="px-4 py-2 border-t border-slate-100 text-xs text-slate-400">
            Total enrollment across mapped sites: {Math.round(totalBasis)}
          </div>
        )}
      </div>

      {/* Calculate */}
      <button onClick={calculate} disabled={!canCalc}
        className="w-full py-3 text-sm font-bold rounded-xl text-white disabled:opacity-40 transition"
        style={{background:"#1e3a5f"}}>
        {!canCalc&&grandTotal===0?"Enter cost totals to continue":
         !canCalc&&mappedCount===0?"Map at least one site to continue":
         !canCalc&&mode==="manual"?"Percentages must total 100%":
         "Calculate Weighted Allocations →"}
      </button>

      {/* Step 4 — Results + Apply */}
      {result&&(
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Step 4 — Review & Apply</div>
            {appliedCount>0&&(
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{background:"#dcfce7",color:"#166534"}}>
                ✓ {appliedCount} site{appliedCount!==1?"s":""} updated{errorCount>0?` · ${errorCount} error${errorCount!==1?"s":""}`:""}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-semibold">Site</th>
                <th className="px-4 py-2 text-center font-semibold">Weight</th>
                {CB_COST_CATEGORIES.map(cat=>(
                  <th key={cat} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{cat}</th>
                ))}
                <th className="px-4 py-2 text-right font-semibold">Alloc. Fee</th>
                <th className="px-4 py-2 text-center font-semibold">Status</th>
              </tr></thead>
              <tbody>{SITES.map((site,i)=>{
                const mapped=!!siteMap[site];
                const st=applyStatus[site];
                const weight=result.weights[site]||0;
                return(
                  <tr key={site} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"} ${!mapped?"opacity-35":""}`}>
                    <td className="px-4 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{site}</td>
                    <td className="px-4 py-2.5 text-center text-xs font-mono font-semibold text-slate-600">{(weight*100).toFixed(1)}%</td>
                    {CB_COST_CATEGORIES.map(cat=>(
                      <td key={cat} className="px-3 py-2.5 text-right font-mono text-xs text-slate-500">
                        ${(result.alloc[site][cat]||0).toLocaleString()}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-700">
                      ${(result.alloc[site].total||0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs">
                      {!mapped&&<span className="text-slate-300">Not mapped</span>}
                      {mapped&&!st&&<span className="text-slate-300">—</span>}
                      {st==="ok"&&<span className="font-semibold text-green-600">✓ Applied</span>}
                      {st==="error"&&<span className="font-semibold text-red-500">✗ Error</span>}
                      {st==="skipped"&&<span className="text-slate-300">Skipped</span>}
                    </td>
                  </tr>
                );
              })}</tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-4 py-2.5 font-bold text-slate-700" colSpan={2}>District Total</td>
                  {CB_COST_CATEGORIES.map(cat=>(
                    <td key={cat} className="px-3 py-2.5 text-right font-mono font-semibold text-xs text-slate-600">
                      ${Math.round(parseFloat(catTotals[cat])||0).toLocaleString()}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-800">
                    ${Math.round(result.grandTotal).toLocaleString()}
                  </td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="p-5 border-t border-slate-100 space-y-3">
            <div className="text-xs text-slate-400">
              Writes the <strong className="text-slate-600">Clubhouse Allocation Fee ({which==="budgeted"?"Budgeted":"Actual"})</strong> field on each mapped program record.
              {SITES.filter(s=>!siteMap[s]).length>0&&` ${SITES.filter(s=>!siteMap[s]).length} unmapped site${SITES.filter(s=>!siteMap[s]).length!==1?"s":""} will be skipped.`}
            </div>
            <button onClick={applyAll} disabled={applying||mappedCount===0}
              className="px-6 py-2.5 text-sm font-bold rounded-xl text-white disabled:opacity-40 transition"
              style={{background:"#16a34a"}}>
              {applying?"Applying…":`✓ Apply to ${mappedCount} Site Program${mappedCount!==1?"s":""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
