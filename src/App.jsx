import { useState } from "react";

const PROGRAM_TYPES = [
  {label:"Small Contractual Program",pct:0.005},{label:"Large Contractual Program",pct:0.01},
  {label:"Drop-In Program",pct:0.02},{label:"Small Event",pct:0.03},{label:"Large Event",pct:0.06},
  {label:"League",pct:0.07},{label:"Camp",pct:0.1},{label:"Production / Major Program",pct:0.12},
];
const SEASONS=["Spring","Summer","Fall","Winter"],YEARS=["2025","2026","2027","2028","2029","2030"];
const ADMIN_OVERHEAD_RATE=0.1,FT_ANNUAL_SALARY=97700,FACILITY_COST_PER_HOUR=3;

const SAMPLE=[
  {id:"1",name:"Youth Basketball",area:"Sports",season:"Summer",year:"2026",classification:"Revenue Driven",service_category:"Intermediate/Adv. Activities",staff_name:"Sarah Johnson",trend:"Growing",nps:72,waitlist:14,
   ant_capacity:100,ant_enrollment:90,ant_revenue:18000,ant_personnel:4200,ant_commodities:800,ant_contractuals:2000,ant_other1:0,ant_other2:0,ant_facility_hours:40,ant_program_type:"League",ant_custom_workload:0,
   act_capacity:100,act_enrollment:88,act_revenue:18700,act_personnel:4200,act_commodities:950,act_contractuals:2000,act_other1:0,act_other2:0,act_facility_hours:40,act_program_type:"League",act_custom_workload:0},
  {id:"2",name:"Art Camp",area:"Camps",season:"Summer",year:"2026",classification:"Both",service_category:"Camp",staff_name:"Mike Torres",trend:"Declining",nps:43,waitlist:0,
   ant_capacity:40,ant_enrollment:35,ant_revenue:7000,ant_personnel:3200,ant_commodities:1200,ant_contractuals:500,ant_other1:0,ant_other2:0,ant_facility_hours:30,ant_program_type:"Camp",ant_custom_workload:0,
   act_capacity:40,act_enrollment:23,act_revenue:4600,act_personnel:3200,act_commodities:1100,act_contractuals:500,act_other1:0,act_other2:0,act_facility_hours:30,act_program_type:"Camp",act_custom_workload:0},
  {id:"3",name:"Senior Social",area:"Seniors",season:"Summer",year:"2026",classification:"Community Driven",service_category:"Community Events",staff_name:"Jordan Lee",trend:"Stable",nps:74,waitlist:0,
   ant_capacity:30,ant_enrollment:25,ant_revenue:1200,ant_personnel:800,ant_commodities:400,ant_contractuals:0,ant_other1:0,ant_other2:0,ant_facility_hours:20,ant_program_type:"Small Event",ant_custom_workload:0,
   act_capacity:30,act_enrollment:12,act_revenue:600,act_personnel:800,act_commodities:350,act_contractuals:0,act_other1:0,act_other2:0,act_facility_hours:20,act_program_type:"Small Event",act_custom_workload:0},
  {id:"4",name:"Pickleball League",area:"Sports",season:"Summer",year:"2026",classification:"Revenue Driven",service_category:"Intermediate/Adv. Activities",staff_name:"Mike Torres",trend:"Growing",nps:81,waitlist:25,
   ant_capacity:48,ant_enrollment:44,ant_revenue:13000,ant_personnel:2000,ant_commodities:500,ant_contractuals:1500,ant_other1:0,ant_other2:0,ant_facility_hours:50,ant_program_type:"League",ant_custom_workload:0,
   act_capacity:48,act_enrollment:46,act_revenue:14200,act_personnel:2000,act_commodities:480,act_contractuals:1500,act_other1:0,act_other2:0,act_facility_hours:50,act_program_type:"League",act_custom_workload:0},
  {id:"5",name:"Swim Lessons",area:"Aquatics",season:"Summer",year:"2026",classification:"Revenue Driven",service_category:"Beg./Intro. Activities",staff_name:"Sarah Johnson",trend:"Stable",nps:68,waitlist:8,
   ant_capacity:60,ant_enrollment:55,ant_revenue:11000,ant_personnel:5000,ant_commodities:300,ant_contractuals:0,ant_other1:0,ant_other2:0,ant_facility_hours:60,ant_program_type:"Drop-In Program",ant_custom_workload:0,
   act_capacity:60,act_enrollment:57,act_revenue:11400,act_personnel:5000,act_commodities:290,act_contractuals:0,act_other1:0,act_other2:0,act_facility_hours:60,act_program_type:"Drop-In Program",act_custom_workload:0},
];

function calcCR(p,px){
  const pe=p[`${px}personnel`]||0,co=p[`${px}commodities`]||0,cn=p[`${px}contractuals`]||0,
        o1=p[`${px}other1`]||0,o2=p[`${px}other2`]||0,fh=p[`${px}facility_hours`]||0,
        pt=p[`${px}program_type`]||"",wl=p[`${px}custom_workload`]||0,
        rv=p[`${px}revenue`]||0,en=p[`${px}enrollment`]||0,cp=p[`${px}capacity`]||0;
  const wp=pt&&pt!=="Custom"?(PROGRAM_TYPES.find(t=>t.label===pt)?.pct||0):(parseFloat(wl)||0)/100;
  const d=pe+co+cn+o1+o2,ao=d*ADMIN_OVERHEAD_RATE,af=FT_ANNUAL_SALARY*wp,afc=FACILITY_COST_PER_HOUR*fh;
  const tot=d+ao+af+afc,cr=tot>0?rv/tot:0;
  return{directTotal:d,adminOverhead:ao,allocatedFTStaff:af,allocatedFacility:afc,
         totalProgramCost:tot,revenue:rv,costRecoveryPct:cr,subsidyPct:1-cr,
         netProfit:rv-tot,fillRate:cp>0?en/cp:0,enrollment:en,capacity:cp};
}
function calcKPIs(p){
  const a=calcCR(p,"ant_"),b=calcCR(p,"act_");
  let status="Monitor";
  if(b.fillRate>=0.7&&b.costRecoveryPct>=1.0)status="Healthy";
  else if(b.fillRate<0.6||b.costRecoveryPct<0.5)status="Needs Redesign";
  return{fillRate:b.fillRate,costRecovery:b.costRecoveryPct,profitLoss:b.netProfit,
         totalProgramCost:b.totalProgramCost,revenue:b.revenue,status,
         antFillRate:a.fillRate,antCostRecovery:a.costRecoveryPct,antProfitLoss:a.netProfit,
         antTotalCost:a.totalProgramCost,antRevenue:a.revenue,
         varEnrollment:b.enrollment-a.enrollment,varRevenue:b.revenue-a.revenue,
         varCost:b.totalProgramCost-a.totalProgramCost,varFillRate:b.fillRate-a.fillRate,
         varCostRecovery:b.costRecoveryPct-a.costRecoveryPct,varNetProfit:b.netProfit-a.netProfit};
}

const fmt={
  pct:v=>`${((v||0)*100).toFixed(1)}%`,
  dollar:v=>(v||0)<0?`($${Math.abs(Math.round(v||0)).toLocaleString()})`:`$${Math.round(v||0).toLocaleString()}`,
  vd:v=>v>0?`+$${Math.round(v).toLocaleString()}`:v<0?`($${Math.abs(Math.round(v)).toLocaleString()})`:`$0`,
  vn:v=>v>0?`+${v}`:`${v}`,
  vp:v=>v>0?`+${(v*100).toFixed(1)}%`:`${(v*100).toFixed(1)}%`,
};
const sc=s=>s==="Healthy"?{bg:"#dcfce7",tx:"#166534",dot:"#22c55e"}:s==="Monitor"?{bg:"#fef9c3",tx:"#854d0e",dot:"#eab308"}:{bg:"#fee2e2",tx:"#991b1b",dot:"#ef4444"};
const vc=(v,inv)=>!v||v===0?"text-slate-400":(inv?v<0:v>0)?"text-green-600 font-semibold":"text-red-500 font-semibold";

function Badge({s}){const c=sc(s);return<span style={{background:c.bg,color:c.tx}} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"><span style={{background:c.dot}} className="w-1.5 h-1.5 rounded-full inline-block"/>{s}</span>;}
function KCard({label,value,sub,accent}){return<div style={{borderTop:`3px solid ${accent}`}} className="bg-white rounded-lg p-4 shadow-sm"><div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</div><div className="text-2xl font-bold text-slate-800">{value}</div>{sub&&<div className="text-xs text-slate-400 mt-0.5">{sub}</div>}</div>;}
function PBar({label,actual,ant,ff,inv}){
  const pct=ant>0?Math.min((actual/ant)*100,150):0,v=actual-ant,good=inv?v<=0:v>=0;
  const bc=pct>=100?(inv?"#ef4444":"#22c55e"):pct>=75?"#eab308":"#ef4444";
  return<div className="space-y-1"><div className="flex justify-between"><span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span><span className={`text-xs font-bold ${good?"text-green-600":"text-red-500"}`}>{v>=0?"+":""}{ff?ff(v):v}</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:`${Math.min(pct,100)}%`,backgroundColor:bc}}/></div><div className="flex justify-between text-xs text-slate-400"><span>Actual: <span className="font-semibold text-slate-600">{ff?ff(actual):actual}</span></span><span>Budget: <span className="font-semibold text-slate-600">{ff?ff(ant):ant}</span></span></div></div>;
}
function FI({label,value,blue}){return<div className="flex flex-col gap-1"><label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label><div className={`w-full rounded border px-3 py-2 text-sm ${blue?"border-blue-200 bg-white":"border-slate-200 bg-slate-50"} text-slate-700`}>{value||"—"}</div></div>;}

const workload=[{a:"Program planning & management",p:"45–50%"},{a:"Meetings / admin",p:"20–25%"},{a:"Marketing / outreach",p:"10–15%"},{a:"Strategic work / projects",p:"10–15%"}];
const svcT=[
  {c:"Open Access",t:"100% Subsidy",bg:"#fee2e2",tx:"#991b1b"},{c:"Community Events",t:"80–100% Subsidy",bg:"#fee2e2",tx:"#991b1b"},
  {c:"Specialty Events",t:"0–5% Subsidy",bg:"#fef9c3",tx:"#854d0e"},{c:"Beg. / Intro. Activities",t:"100% Cost Recovery",bg:"#dcfce7",tx:"#166534"},
  {c:"Drop In Activities",t:"100–105% Cost Recovery",bg:"#dcfce7",tx:"#166534"},{c:"Childcare Services",t:"110–130% Cost Recovery",bg:"#d1fae5",tx:"#065f46"},
  {c:"Intermediate / Adv. Activities",t:"110–130% Cost Recovery",bg:"#d1fae5",tx:"#065f46"},{c:"Private / Semi-Private Activities",t:"130–150% Cost Recovery",bg:"#a7f3d0",tx:"#064e3b"},
  {c:"Specialized Activities",t:"130–150% Cost Recovery",bg:"#a7f3d0",tx:"#064e3b"},{c:"Rentals",t:"130–150% Cost Recovery",bg:"#a7f3d0",tx:"#064e3b"},{c:"Retail & Consumables",t:"130–150% Cost Recovery",bg:"#a7f3d0",tx:"#064e3b"},
];
const tiers=[
  {label:"Tier 1 – Always Tracked",color:"#1e3a5f",items:[{m:"Fill Rate",d:"Percent of available spots filled",w:"Quarterly"},{m:"Cost Recovery",d:"Revenue divided by total program cost",w:"Quarterly"},{m:"Net Profit / (Loss)",d:"Revenue minus total program cost",w:"Quarterly"},{m:"Participation Trend",d:"Growing, stable, or declining over time",w:"Quarterly"},{m:"Status",d:"Healthy, Monitor, or Needs Redesign",w:"Quarterly"}]},
  {label:"Tier 2 – Participation",color:"#d4a017",items:[{m:"Total Enrollment",d:"Number of registered participants",w:"As needed"},{m:"Waitlist Volume",d:"Demand beyond capacity",w:"As needed"},{m:"Waitlist Conversion Rate",d:"Percent of waitlisted who enroll",w:"As needed"},{m:"Retention Rate",d:"Percent who return to a future session",w:"As needed"},{m:"Cancellation Rate",d:"Registrants who drop before start",w:"As needed"}]},
  {label:"Tier 2 – Financial",color:"#d4a017",items:[{m:"Margin %",d:"Surplus divided by revenue",w:"As needed"},{m:"Revenue per Participant",d:"Revenue divided by enrolled participants",w:"As needed"},{m:"Revenue per Program Hour",d:"Revenue earned per scheduled hour",w:"As needed"},{m:"Direct Cost per Participant",d:"Direct costs divided by enrollment",w:"As needed"}]},
  {label:"Tier 2 – Operational / Space",color:"#d4a017",items:[{m:"Participant to Staff Ratio",d:"Enrollment relative to staffing",w:"As needed"},{m:"Facility Utilization Rate",d:"Extent to which a space is booked or used",w:"As needed"},{m:"Prime Time Usage Rate",d:"Use during high demand periods",w:"As needed"},{m:"Revenue per Facility Hour",d:"Financial productivity of space",w:"As needed"}]},
  {label:"Tier 2 – Quality / Innovation",color:"#d4a017",items:[{m:"NPS",d:"Likelihood participants recommend the program",w:"As needed"},{m:"Participant Satisfaction",d:"Program quality score",w:"As needed"},{m:"Pilot Success Rate",d:"Pilot met participation and financial targets",w:"As needed"},{m:"New Program Retention Rate",d:"Whether pilots continue or return",w:"As needed"}]},
];

const SEL=SAMPLE[0],SEL_ANT=calcCR(SEL,"ant_"),SEL_ACT=calcCR(SEL,"act_"),SEL_K=calcKPIs(SEL);

export default function App(){
  const [tab,setTab]=useState("dashboard");
  const [dv,setDv]=useState("summary");
  const [fs,setFs]=useState("info");
  const [view,setView]=useState("list");
  const [rs,setRs]=useState("standards");
  const [sf,setSf]=useState("All");
  const [af,setAf]=useState("All");
  const [dc,setDc]=useState(null);
  const [ds,setDs]=useState("Fall");
  const [dy,setDy]=useState("2026");

  const allStaff=["All",...new Set(SAMPLE.map(p=>p.staff_name))];
  const allAreas=["All",...new Set(SAMPLE.map(p=>p.area))];
  const visible=SAMPLE.filter(p=>sf==="All"||p.staff_name===sf).filter(p=>af==="All"||p.area===af);
  const kpis=visible.map(p=>({...p,...calcKPIs(p)}));

  const T={
    avgFill:kpis.length?kpis.reduce((a,p)=>a+p.fillRate,0)/kpis.length:0,
    avgCR:kpis.length?kpis.reduce((a,p)=>a+p.costRecovery,0)/kpis.length:0,
    surplus:kpis.reduce((a,p)=>a+p.profitLoss,0),
    antRev:kpis.reduce((a,p)=>a+p.antRevenue,0),actRev:kpis.reduce((a,p)=>a+p.revenue,0),
    antEnr:visible.reduce((a,p)=>a+(p.ant_enrollment||0),0),actEnr:visible.reduce((a,p)=>a+(p.act_enrollment||0),0),
    antCost:kpis.reduce((a,p)=>a+p.antTotalCost,0),actCost:kpis.reduce((a,p)=>a+p.totalProgramCost,0),
    healthy:kpis.filter(p=>p.status==="Healthy").length,
    redesign:kpis.filter(p=>p.status==="Needs Redesign").length,
    low60:kpis.filter(p=>p.fillRate<0.6).length,
    low50:kpis.filter(p=>p.costRecovery<0.5).length,
  };
  const crCalc=calcCR(SAMPLE[0],"act_");
  const navTo=t=>{setTab(t);setView("list");setFs("info");};
  const sel="rounded border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:border-blue-400";

  return(
    <div className="min-h-screen" style={{background:"#f1f5f9",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>

      {/* Duplicate modal */}
      {view==="dup"&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.55)"}}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-slate-100">
              <div className="text-base font-bold text-slate-800">Duplicate Program</div>
              <div className="text-sm text-slate-400 mt-0.5">Creating a copy of <span className="font-semibold text-slate-600">Youth Basketball</span></div>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">New Season</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Season</label><select className={sel} value={ds} onChange={e=>setDs(e.target.value)}>{SEASONS.map(s=><option key={s}>{s}</option>)}</select></div>
                  <div className="flex flex-col gap-1"><label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Year</label><select className={sel} value={dy} onChange={e=>setDy(e.target.value)}>{YEARS.map(y=><option key={y}>{y}</option>)}</select></div>
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Budgeted Numbers</div>
                <div className="space-y-2">
                  {[[true,"Carry over from previous season","Pre-fill with the same budget — good starting point for recurring programs"],[false,"Start fresh","Clear budgeted numbers so you enter new estimates for this season"]].map(([val,title,desc])=>(
                    <div key={title} onClick={()=>setDc(val)} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${dc===val?"border-blue-400 bg-blue-50":"border-slate-200 hover:border-slate-300"}`}>
                      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${dc===val?"border-blue-500 bg-blue-500":"border-slate-300"}`}>{dc===val&&<div className="w-1.5 h-1.5 rounded-full bg-white"/>}</div>
                      <div><div className="text-sm font-semibold text-slate-700">{title}</div><div className="text-xs text-slate-400 mt-0.5">{desc}</div></div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-3">Actuals always start empty on a duplicate.</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={()=>setView("form")} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button disabled={dc===null} onClick={()=>setView("list")} className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40" style={{backgroundColor:"#1e3a5f"}}>Duplicate Program</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{backgroundColor:"#1e3a5f"}} className="px-4 py-4 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div><div className="text-white font-bold text-lg leading-tight">BGPD Recreation</div><div style={{color:"#d4a017"}} className="text-xs font-semibold tracking-widest uppercase">Sarah Johnson · Manager View</div></div>
          <div className="flex items-center gap-2">
            <button onClick={()=>{setTab("programs");setView("form");setFs("info");}} className="text-xs font-bold px-3 py-2 rounded" style={{backgroundColor:"#d4a017",color:"#1e3a5f"}}>+ Add Program</button>
            <button className="text-xs text-slate-300 px-2 py-2">⇄</button>
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto flex gap-1 px-4 overflow-x-auto">
          {[["dashboard","Dashboard"],["programs","Programs"],["cost","Cost Recovery"],["kpi","Reference"]].map(([id,label])=>(
            <button key={id} onClick={()=>navTo(id)} className={`px-4 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${tab===id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`} style={tab===id?{borderColor:"#d4a017",borderBottomWidth:"2px"}:{}}>{label}</button>
          ))}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ══ DASHBOARD ══ */}
        {tab==="dashboard"&&(
          <>
            {/* Dropdown filters */}
            <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Staff</label>
                <select value={sf} onChange={e=>setSf(e.target.value)} className={`${sel} min-w-[180px]`}>
                  {allStaff.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Area</label>
                <select value={af} onChange={e=>setAf(e.target.value)} className={`${sel} min-w-[160px]`}>
                  {allAreas.map(a=><option key={a}>{a}</option>)}
                </select>
              </div>
              {(sf!=="All"||af!=="All")&&<button onClick={()=>{setSf("All");setAf("All");}} className="text-xs text-slate-400 hover:text-slate-600 pb-1.5 font-medium transition">Clear filters ✕</button>}
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KCard label="Programs" value={visible.length} accent="#1e3a5f"/>
              <KCard label="Avg Fill Rate" value={fmt.pct(T.avgFill)} accent="#d4a017"/>
              <KCard label="Avg Cost Recovery" value={fmt.pct(T.avgCR)} accent="#d4a017"/>
              <KCard label="Total Net Profit/(Loss)" value={fmt.dollar(T.surplus)} accent={T.surplus>=0?"#22c55e":"#ef4444"}/>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KCard label="Healthy" value={T.healthy} sub="programs" accent="#22c55e"/>
              <KCard label="Needs Redesign" value={T.redesign} sub="programs" accent="#ef4444"/>
              <KCard label="Below 60% Fill" value={T.low60} sub="programs" accent="#f97316"/>
              <KCard label="Below 50% Recovery" value={T.low50} sub="programs" accent="#f97316"/>
            </div>

            {/* Portfolio bars */}
            <div className="bg-white rounded-lg shadow-sm p-5 space-y-5">
              <h3 className="font-bold text-slate-700 text-sm">Portfolio: Budgeted vs Actual</h3>
              <PBar label="Total Revenue" actual={T.actRev} ant={T.antRev} ff={v=>fmt.dollar(v)}/>
              <PBar label="Total Enrollment" actual={T.actEnr} ant={T.antEnr} ff={v=>v.toString()}/>
              <PBar label="Total Program Cost" actual={T.actCost} ant={T.antCost} ff={v=>fmt.dollar(v)} inv/>
            </div>

            {/* Program detail */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-wrap gap-2">
                <h2 className="font-bold text-slate-700 text-sm">Program Detail</h2>
                <div className="flex gap-1">
                  {[["summary","Summary"],["variances","Variances"],["progress","Progress"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setDv(v)} className={`text-xs px-3 py-1.5 rounded font-medium transition ${dv===v?"text-white":"bg-slate-100 text-slate-500"}`} style={dv===v?{backgroundColor:"#1e3a5f"}:{}}>{l}</button>
                  ))}
                </div>
              </div>

              {dv==="summary"&&(
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider">
                      {["Program","Staff","Area","Season","Fill Rate","Cost Recovery","Net P/(L)","Total Cost","Waitlist","Trend","Status",""].map(h=><th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}
                    </tr></thead>
                    <tbody>{kpis.map((p,i)=>(
                      <tr key={p.id} className={`border-t border-slate-50 hover:bg-slate-50 ${i%2===0?"bg-white":"bg-slate-50/50"}`}>
                        <td className="px-3 py-2.5 font-semibold text-slate-700">{p.name}</td>
                        <td className="px-3 py-2.5 text-slate-400 text-xs">{p.staff_name}</td>
                        <td className="px-3 py-2.5 text-slate-500">{p.area}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{p.season} {p.year}</td>
                        <td className="px-3 py-2.5 font-mono">{fmt.pct(p.fillRate)}</td>
                        <td className="px-3 py-2.5 font-mono">{fmt.pct(p.costRecovery)}</td>
                        <td className={`px-3 py-2.5 font-mono font-semibold ${p.profitLoss>=0?"text-green-700":"text-red-600"}`}>{fmt.dollar(p.profitLoss)}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-500">{fmt.dollar(p.totalProgramCost)}</td>
                        <td className="px-3 py-2.5 text-slate-500">{p.waitlist}</td>
                        <td className="px-3 py-2.5 text-slate-500">{p.trend}</td>
                        <td className="px-3 py-2.5"><Badge s={p.status}/></td>
                        <td className="px-3 py-2.5"><button onClick={()=>{setTab("programs");setView("form");}} className="text-xs text-slate-400 hover:text-slate-700 font-medium">Edit</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {dv==="variances"&&(
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
                        <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs">{p.ant_enrollment}</td><td className="px-2 py-2.5 text-center font-mono text-xs">{p.act_enrollment}</td><td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varEnrollment)}`}>{fmt.vn(p.varEnrollment)}</td>
                        <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{fmt.dollar(p.antRevenue)}</td><td className="px-2 py-2.5 text-center font-mono text-xs">{fmt.dollar(p.revenue)}</td><td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varRevenue)}`}>{fmt.vd(p.varRevenue)}</td>
                        <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{fmt.dollar(p.antTotalCost)}</td><td className="px-2 py-2.5 text-center font-mono text-xs">{fmt.dollar(p.totalProgramCost)}</td><td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varCost,true)}`}>{fmt.vd(p.varCost)}</td>
                        <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{fmt.pct(p.antCostRecovery)}</td><td className="px-2 py-2.5 text-center font-mono text-xs">{fmt.pct(p.costRecovery)}</td><td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varCostRecovery)}`}>{fmt.vp(p.varCostRecovery)}</td>
                        <td className="px-2 py-2.5 text-center text-slate-400 font-mono text-xs border-l border-slate-100">{fmt.dollar(p.antProfitLoss)}</td><td className="px-2 py-2.5 text-center font-mono text-xs">{fmt.dollar(p.profitLoss)}</td><td className={`px-2 py-2.5 text-center font-mono text-xs ${vc(p.varNetProfit)}`}>{fmt.vd(p.varNetProfit)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}

              {dv==="progress"&&(
                <div className="p-4 space-y-5">{kpis.map(p=>(
                  <div key={p.id} className="border border-slate-100 rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between"><div><div className="font-semibold text-slate-700">{p.name}</div><div className="text-xs text-slate-400">{p.area} · {p.season} {p.year} · {p.staff_name}</div></div><Badge s={p.status}/></div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <PBar label="Enrollment" actual={p.act_enrollment} ant={p.ant_enrollment} ff={v=>v.toString()}/>
                      <PBar label="Revenue" actual={p.revenue} ant={p.antRevenue} ff={v=>fmt.dollar(v)}/>
                      <PBar label="Total Cost" actual={p.totalProgramCost} ant={p.antTotalCost} ff={v=>fmt.dollar(v)} inv/>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <PBar label="Cost Recovery" actual={p.costRecovery*100} ant={p.antCostRecovery*100} ff={v=>`${v.toFixed(1)}%`}/>
                      <PBar label="Net Profit/(Loss)" actual={p.profitLoss} ant={p.antProfitLoss} ff={v=>fmt.dollar(v)}/>
                    </div>
                  </div>
                ))}</div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm p-4">
              <h3 className="font-bold text-slate-700 text-sm mb-3">Status Guide</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3"><Badge s="Healthy"/><span className="text-slate-500">70%+ fill rate and 100%+ cost recovery</span></div>
                <div className="flex items-center gap-3"><Badge s="Monitor"/><span className="text-slate-500">60–69.9% fill rate or approaching targets</span></div>
                <div className="flex items-center gap-3"><Badge s="Needs Redesign"/><span className="text-slate-500">Below 60% fill rate or below 50% cost recovery</span></div>
              </div>
            </div>
          </>
        )}

        {/* ══ PROGRAMS LIST ══ */}
        {tab==="programs"&&view==="list"&&(
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-700">All Programs ({SAMPLE.length})</h2>
              <button onClick={()=>setView("form")} className="text-xs font-bold px-3 py-2 rounded text-white" style={{backgroundColor:"#1e3a5f"}}>+ Add Program</button>
            </div>
            {SAMPLE.map(p=>{const k=calcKPIs(p);return(
              <div key={p.id} onClick={()=>setView("form")} className="bg-white rounded-lg shadow-sm px-4 py-3 flex items-center justify-between gap-4 hover:shadow-md transition cursor-pointer">
                <div className="flex-1 min-w-0"><div className="font-semibold text-slate-700 truncate">{p.name}</div><div className="text-xs text-slate-400">{p.area} · {p.season} {p.year} · {p.staff_name}</div></div>
                <div className="hidden sm:flex gap-6 text-sm">
                  <div className="text-center"><div className="text-xs text-slate-400">Fill</div><div className="font-mono font-semibold">{fmt.pct(k.fillRate)}</div></div>
                  <div className="text-center"><div className="text-xs text-slate-400">Recovery</div><div className="font-mono font-semibold">{fmt.pct(k.costRecovery)}</div></div>
                  <div className="text-center"><div className="text-xs text-slate-400">Net P/(L)</div><div className={`font-mono font-semibold ${k.profitLoss>=0?"text-green-700":"text-red-600"}`}>{fmt.dollar(k.profitLoss)}</div></div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={e=>{e.stopPropagation();setDc(null);setView("dup");}} className="text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100 transition font-medium" title="Duplicate">⧉</button>
                  <Badge s={k.status}/>
                </div>
              </div>
            );})}
          </div>
        )}

        {/* ══ PROGRAM FORM ══ */}
        {tab==="programs"&&view==="form"&&(
          <div className="space-y-4">
            <div className="flex items-center justify-between"><h2 className="font-bold text-slate-700">Edit Program</h2><button onClick={()=>setView("list")} className="text-sm text-slate-400 hover:text-slate-600">← Back</button></div>
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="flex border-b border-slate-100 overflow-x-auto">
                {[{id:"info",label:"Program Info"},{id:"budgeted",label:"Budgeted"},{id:"actuals",label:"Actuals"},{id:"summary",label:"Summary"}].map(s=>(
                  <button key={s.id} onClick={()=>setFs(s.id)} className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${fs===s.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`} style={fs===s.id?{borderColor:"#d4a017"}:{}}>{s.label}</button>
                ))}
              </div>

              {fs==="info"&&(<div className="p-5 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FI label="Program Name" value="Youth Basketball"/><FI label="Staff Member" value="Sarah Johnson"/>
                  <FI label="Area" value="Sports"/><FI label="Season" value="Summer"/>
                  <FI label="Year" value="2026"/><FI label="Classification" value="Revenue Driven"/>
                  <FI label="Service Category" value="Intermediate / Adv. Activities"/><FI label="Participation Trend" value="Growing"/>
                  <FI label="NPS Score" value="72"/><FI label="Waitlist" value="14"/>
                </div>
                <div><label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label><div className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 min-h-[60px]">Strong demand — consider adding a second session next year.</div></div>
              </div>)}

              {fs==="budgeted"&&(<div className="p-5 space-y-5">
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg"><div className="text-xs font-bold text-blue-600 uppercase tracking-widest">Budgeted</div><div className="text-xs text-blue-400 mt-0.5">What you think this program will do. You can update these at any time.</div></div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><FI label="Capacity" value="100" blue/><FI label="Enrollment" value="90" blue/><FI label="Revenue ($)" value="18,000" blue/></div>
                <div><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Direct Costs</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><FI label="Personnel ($)" value="4,200" blue/><FI label="Commodities ($)" value="800" blue/><FI label="Contractuals ($)" value="2,000" blue/><FI label="Other Direct Costs ($)" value="0" blue/><FI label="Other Direct Costs 2 ($)" value="0" blue/><FI label="Facility Hours" value="40" blue/></div>
                </div>
                <div><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Staff Workload</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><FI label="Program Type" value="League" blue/><div className="flex flex-col gap-1 justify-center"><label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Workload %</label><div className="text-lg font-bold text-slate-700">7.0%</div></div></div>
                </div>
                <div className="rounded-lg p-4 space-y-3" style={{background:"#eff6ff",border:"1px solid #bfdbfe"}}>
                  <div className="text-xs font-bold text-blue-600 uppercase tracking-widest">Calculated Results</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
                    {[["Direct Costs",fmt.dollar(SEL_ANT.directTotal)],["Admin Overhead (10%)",fmt.dollar(SEL_ANT.adminOverhead)],["Allocated FT Staff",fmt.dollar(SEL_ANT.allocatedFTStaff)],["Allocated Facility",fmt.dollar(SEL_ANT.allocatedFacility)],["Total Program Cost",fmt.dollar(SEL_ANT.totalProgramCost)],["Fill Rate",fmt.pct(SEL_ANT.fillRate)]].map(([l,v])=>(
                      <div key={l}><div className="text-xs text-blue-500">{l}</div><div className="font-bold text-blue-700">{v}</div></div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-blue-200">
                    <div><div className="text-xs text-blue-500">Cost Recovery</div><div className={`text-xl font-black ${SEL_ANT.costRecoveryPct>=1?"text-green-600":"text-amber-500"}`}>{fmt.pct(SEL_ANT.costRecoveryPct)}</div></div>
                    <div><div className="text-xs text-blue-500">Subsidy</div><div className="text-xl font-black text-blue-700">{fmt.pct(Math.max(0,SEL_ANT.subsidyPct))}</div></div>
                    <div><div className="text-xs text-blue-500">Net Profit/(Loss)</div><div className={`text-xl font-black ${SEL_ANT.netProfit>=0?"text-green-600":"text-red-500"}`}>{fmt.dollar(SEL_ANT.netProfit)}</div></div>
                  </div>
                </div>
              </div>)}

              {fs==="actuals"&&(<div className="p-5 space-y-5">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg"><div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Actuals</div><div className="text-xs text-slate-400 mt-0.5">Update these as the program runs or after it concludes.</div></div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><FI label="Capacity" value="100"/><FI label="Enrollment" value="88"/><FI label="Revenue ($)" value="18,700"/></div>
                <div><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Direct Costs</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><FI label="Personnel ($)" value="4,200"/><FI label="Commodities ($)" value="950"/><FI label="Contractuals ($)" value="2,000"/><FI label="Other Direct Costs ($)" value="0"/><FI label="Other Direct Costs 2 ($)" value="0"/><FI label="Facility Hours" value="40"/></div>
                </div>
                <div><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Staff Workload</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><FI label="Program Type" value="League"/><div className="flex flex-col gap-1 justify-center"><label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Workload %</label><div className="text-lg font-bold text-slate-700">7.0%</div></div></div>
                </div>
                <div className="rounded-lg p-4 space-y-3" style={{background:"#f8fafc",border:"1px solid #e2e8f0"}}>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">Calculated Results</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
                    {[["Direct Costs",fmt.dollar(SEL_ACT.directTotal)],["Admin Overhead (10%)",fmt.dollar(SEL_ACT.adminOverhead)],["Allocated FT Staff",fmt.dollar(SEL_ACT.allocatedFTStaff)],["Allocated Facility",fmt.dollar(SEL_ACT.allocatedFacility)],["Total Program Cost",fmt.dollar(SEL_ACT.totalProgramCost)],["Fill Rate",fmt.pct(SEL_ACT.fillRate)]].map(([l,v])=>(
                      <div key={l}><div className="text-xs text-slate-500">{l}</div><div className="font-bold text-slate-700">{v}</div></div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200">
                    <div><div className="text-xs text-slate-500">Cost Recovery</div><div className={`text-xl font-black ${SEL_ACT.costRecoveryPct>=1?"text-green-600":"text-amber-500"}`}>{fmt.pct(SEL_ACT.costRecoveryPct)}</div></div>
                    <div><div className="text-xs text-slate-500">Subsidy</div><div className="text-xl font-black text-slate-700">{fmt.pct(Math.max(0,SEL_ACT.subsidyPct))}</div></div>
                    <div><div className="text-xs text-slate-500">Net Profit/(Loss)</div><div className={`text-xl font-black ${SEL_ACT.netProfit>=0?"text-green-600":"text-red-500"}`}>{fmt.dollar(SEL_ACT.netProfit)}</div></div>
                  </div>
                </div>
              </div>)}

              {fs==="summary"&&(<div className="p-5 space-y-6">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div><div className="text-xs text-slate-400">Actual Fill Rate</div><div className="text-xl font-bold text-slate-700">{fmt.pct(SEL_K.fillRate)}</div></div>
                  <div><div className="text-xs text-slate-400">Actual Cost Recovery</div><div className="text-xl font-bold text-slate-700">{fmt.pct(SEL_K.costRecovery)}</div></div>
                  <div><div className="text-xs text-slate-400">Net Profit/(Loss)</div><div className={`text-xl font-bold ${SEL_K.profitLoss>=0?"text-green-700":"text-red-600"}`}>{fmt.dollar(SEL_K.profitLoss)}</div></div>
                  <div><div className="text-xs text-slate-400">Status</div><div className="mt-1"><Badge s={SEL_K.status}/></div></div>
                </div>
                <div className="border-t border-slate-100 pt-4 space-y-4">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Variance vs Budget</div>
                  <PBar label="Enrollment" actual={SEL.act_enrollment} ant={SEL.ant_enrollment} ff={v=>v.toString()}/>
                  <PBar label="Revenue" actual={SEL_K.revenue} ant={SEL_K.antRevenue} ff={v=>fmt.dollar(v)}/>
                  <PBar label="Total Cost" actual={SEL_K.totalProgramCost} ant={SEL_K.antTotalCost} ff={v=>fmt.dollar(v)} inv/>
                  <PBar label="Cost Recovery" actual={SEL_K.costRecovery*100} ant={SEL_K.antCostRecovery*100} ff={v=>`${v.toFixed(1)}%`}/>
                  <PBar label="Net Profit/(Loss)" actual={SEL_K.profitLoss} ant={SEL_K.antProfitLoss} ff={v=>fmt.dollar(v)}/>
                </div>
                <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {[["Enrollment",fmt.vn(SEL_K.varEnrollment),vc(SEL_K.varEnrollment)],["Revenue",fmt.vd(SEL_K.varRevenue),vc(SEL_K.varRevenue)],["Total Cost",fmt.vd(SEL_K.varCost),vc(SEL_K.varCost,true)],["Fill Rate",fmt.vp(SEL_K.varFillRate),vc(SEL_K.varFillRate)],["Cost Recovery",fmt.vp(SEL_K.varCostRecovery),vc(SEL_K.varCostRecovery)],["Net Profit/(Loss)",fmt.vd(SEL_K.varNetProfit),vc(SEL_K.varNetProfit)]].map(([l,v,c])=>(
                    <div key={l}><div className="text-xs text-slate-400">{l}</div><div className={`text-base font-bold ${c}`}>{v}</div></div>
                  ))}
                </div>
              </div>)}
            </div>
            <div className="flex gap-3 justify-between">
              <div className="flex gap-2">
                <button className="px-4 py-2 text-sm text-red-500 hover:text-red-700 font-medium">Delete</button>
                <button onClick={()=>{setDc(null);setView("dup");}} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded hover:bg-slate-50 font-medium">⧉ Duplicate</button>
              </div>
              <div className="flex gap-3">
                <button onClick={()=>setView("list")} className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded">Cancel</button>
                <button className="px-5 py-2 text-sm font-semibold text-white rounded" style={{backgroundColor:"#1e3a5f"}}>Update Program</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ COST RECOVERY ══ */}
        {tab==="cost"&&(
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-5"><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Select Program</div>
              <select className="w-full rounded border border-slate-200 px-3 py-2 text-sm bg-white">{SAMPLE.map(p=><option key={p.id}>{p.name} – {p.season} {p.year} ({p.staff_name})</option>)}</select>
              <div className="mt-2 text-xs text-slate-400">Sports · Revenue Driven</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 space-y-3"><div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Program Info</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FI label="Service Category" value="Intermediate / Adv. Activities"/><FI label="Season" value="Summer"/><FI label="Total Revenue ($)" value="18,700"/><FI label="Facility Hours" value="40"/></div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 space-y-3"><div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Direct Costs</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FI label="Personnel ($)" value="4,200"/><FI label="Commodities ($)" value="950"/><FI label="Contractuals ($)" value="2,000"/><FI label="Other Direct Costs ($)" value="0"/></div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 space-y-3"><div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Staff Workload</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FI label="Program Type" value="League"/><div className="flex flex-col gap-1 justify-center"><label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Estimated Workload %</label><div className="text-lg font-bold text-slate-700">7.0%</div></div></div>
            </div>
            <div className="bg-slate-800 rounded-lg p-5 text-white space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Results (Auto-Calculated)</div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {[["Direct Costs",fmt.dollar(crCalc.directTotal)],["Admin Overhead (10%)",fmt.dollar(crCalc.adminOverhead)],["Allocated FT Staff",fmt.dollar(crCalc.allocatedFTStaff)],["Allocated Facility",fmt.dollar(crCalc.allocatedFacility)],["Total Program Cost",fmt.dollar(crCalc.totalProgramCost)],["Total Revenue",fmt.dollar(crCalc.revenue)]].map(([l,v])=>(
                  <div key={l}><div className="text-xs text-slate-400">{l}</div><div className="text-base font-bold">{v}</div></div>
                ))}
              </div>
              <div className="border-t border-slate-600 pt-3 grid grid-cols-3 gap-4">
                <div><div className="text-xs text-slate-400">Cost Recovery</div><div className={`text-2xl font-black ${crCalc.costRecoveryPct>=1?"text-green-400":"text-amber-400"}`}>{fmt.pct(crCalc.costRecoveryPct)}</div></div>
                <div><div className="text-xs text-slate-400">Subsidy</div><div className="text-2xl font-black text-slate-200">{fmt.pct(Math.max(0,crCalc.subsidyPct))}</div></div>
                <div><div className="text-xs text-slate-400">Net Profit/(Loss)</div><div className={`text-2xl font-black ${crCalc.netProfit>=0?"text-green-400":"text-red-400"}`}>{fmt.dollar(crCalc.netProfit)}</div></div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5"><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Notes</div><div className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 min-h-[60px]">Strong registration — waitlist of 25 suggests capacity expansion opportunity.</div></div>
            <div className="flex justify-end"><button className="px-5 py-2 text-sm font-semibold text-white rounded" style={{backgroundColor:"#1e3a5f"}}>Save Worksheet</button></div>
          </div>
        )}

        {/* ══ REFERENCE ══ */}
        {tab==="kpi"&&(
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="flex border-b border-slate-100">
              {[{id:"standards",label:"District Standards"},{id:"kpis",label:"KPI Menu"}].map(s=>(
                <button key={s.id} onClick={()=>setRs(s.id)} className={`px-5 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${rs===s.id?"text-slate-800":"border-transparent text-slate-400 hover:text-slate-600"}`} style={rs===s.id?{borderColor:"#d4a017"}:{}}>{s.label}</button>
              ))}
            </div>

            {rs==="standards"&&(<div className="p-5 space-y-8">
              <p className="text-sm text-slate-500">District standard assumption numbers to use consistently across all program cost worksheets.</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #1e3a5f"}}><div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Facility Overhead</div><div className="text-3xl font-black text-slate-800">$3<span className="text-lg font-semibold text-slate-400">/hr</span></div><div className="text-xs text-slate-400">Applied to all facility hours used</div></div>
                <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #d4a017"}}><div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Annual FT Compensation</div><div className="text-3xl font-black text-slate-800">$97,700</div><div className="text-xs text-slate-400">Salary + benefits for workload allocation</div></div>
                <div className="rounded-lg border border-slate-200 p-4 space-y-1" style={{borderTop:"3px solid #64748b"}}><div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Admin Overhead Rate</div><div className="text-3xl font-black text-slate-800">10%</div><div className="text-xs text-slate-400">Applied to total direct costs</div></div>
              </div>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:"#1e3a5f"}}>Staff Workload Allocation</div>
                <table className="w-full text-sm"><thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider"><th className="px-4 py-2 text-left font-semibold">Activity</th><th className="px-4 py-2 text-left font-semibold">% of Time</th></tr></thead>
                <tbody>{workload.map((r,i)=><tr key={r.a} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}><td className="px-4 py-3 font-semibold text-slate-700">{r.a}</td><td className="px-4 py-3"><span className="inline-block bg-slate-100 text-slate-600 font-mono font-semibold text-xs px-2.5 py-1 rounded">{r.p}</span></td></tr>)}</tbody></table>
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">Remaining time (program delivery) is accounted for in per-program workload % assigned in cost worksheets.</div>
              </div>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider" style={{backgroundColor:"#d4a017",color:"#1e3a5f"}}>Service Category Cost Recovery / Subsidy Targets</div>
                <table className="w-full text-sm"><thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider"><th className="px-4 py-2 text-left font-semibold">Service Category</th><th className="px-4 py-2 text-left font-semibold">Target</th></tr></thead>
                <tbody>{svcT.map((r,i)=><tr key={r.c} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}><td className="px-4 py-3 font-semibold text-slate-700">{r.c}</td><td className="px-4 py-3"><span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold" style={{background:r.bg,color:r.tx}}>{r.t}</span></td></tr>)}</tbody></table>
              </div>
            </div>)}

            {rs==="kpis"&&(<div className="p-5 space-y-5">
              <p className="text-sm text-slate-500">Use Tier 1 metrics quarterly. Use Tier 2 when a program needs a deeper review.</p>
              {tiers.map(tier=>(
                <div key={tier.label} className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white" style={{backgroundColor:tier.color}}>{tier.label}</div>
                  <table className="w-full text-sm"><thead><tr className="bg-slate-50 text-xs text-slate-400 uppercase tracking-wider"><th className="px-4 py-2 text-left">Metric</th><th className="px-4 py-2 text-left">Definition</th><th className="px-4 py-2 text-left">When to Use</th></tr></thead>
                  <tbody>{tier.items.map((item,i)=><tr key={item.m} className={`border-t border-slate-50 ${i%2===0?"bg-white":"bg-slate-50/40"}`}><td className="px-4 py-2.5 font-semibold text-slate-700">{item.m}</td><td className="px-4 py-2.5 text-slate-500">{item.d}</td><td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">{item.w}</td></tr>)}</tbody></table>
                </div>
              ))}
            </div>)}
          </div>
        )}
      </main>
      <div className="text-center py-4 text-xs text-slate-400 border-t border-slate-200 mt-4 bg-white">Preview only — sample data</div>
    </div>
  );
}

