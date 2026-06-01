/* =====================================================================
   Protech PWA — management / controlling layer (SAP-style)
   Manager-only, view-only. Reads daily_costs, process_charges,
   lot_economics (the management tables that sit beside the lot spine).
   Registers: cockpit, cost, economics, charges, buyers.
   Cost figures are INR (₹, per-day across all lots — Controlling/CO).
   Export figures are USD ($, per lot/buyer — Sales/SD).
   The two are never silently mixed: each number keeps its own unit.
   ===================================================================== */
(function(){
  "use strict";
  const App = window.App;
  if(!App){ console.error("management.js loaded before App"); return; }
  const DB = ()=> window.PROTECH_DB;
  const el = App.ui.el;
  const { notConnected, emptyState, loading } = App.ui;

  // ---------- formatting ----------
  const num = (v)=> (v==null||v===""||isNaN(v)) ? null : Number(v);
  function compact(n){            // Indian notation — natural unit for INR costs
    n = Number(n)||0; const a=Math.abs(n);
    if(a>=1e7) return (n/1e7).toFixed(2)+" Cr";   // crore
    if(a>=1e5) return (n/1e5).toFixed(2)+" L";    // lakh
    if(a>=1e3) return (n/1e3).toFixed(1)+"K";
    return String(Math.round(n));
  }
  function compactW(n){           // Western notation — for USD export figures
    n = Number(n)||0; const a=Math.abs(n);
    if(a>=1e6) return (n/1e6).toFixed(2)+"M";
    if(a>=1e3) return (n/1e3).toFixed(1)+"K";
    return String(Math.round(n));
  }
  const inr = (n)=> n==null ? "—" : "₹"+compact(n);
  const usd = (n)=> n==null ? "—" : "$"+compactW(n);
  const kg  = (n)=> n==null ? "—" : Math.round(n).toLocaleString()+" kg";
  const pct = (n)=> n==null ? "—" : (Number(n)*100).toFixed(1)+"%";   // glaze stored as fraction
  const money2 = (sym,n)=> n==null ? "—" : sym+Number(n).toFixed(2);

  // ---------- shared helpers ----------
  function srow(left, sub, right, rightColor){
    return el("div",{class:"srow"},[
      el("div",{},[ el("div",{class:"l",text:left}), sub?el("div",{class:"s",text:sub}):null ]),
      el("div",{class:"r",style:rightColor?("color:"+rightColor):null,text:right||""}),
    ]);
  }
  async function loadInto(host, label, fn){
    const db = DB(); if(!db || !db.isOnline()) return notConnected(host);
    const spin = loading(host, label);
    try{ const node = await fn(db); spin.remove(); host.appendChild(node); }
    catch(e){ spin.remove(); emptyState(host,"⚠️","Could not load", String(e.message||e)); }
  }
  // KPI tile
  function kpi(value, label, sub, accent){
    return el("div",{style:"flex:1 1 140px;min-width:140px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow)"},[
      el("div",{style:"font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px",text:label}),
      el("div",{style:"font-size:24px;font-weight:800;margin-top:4px;color:"+(accent||"var(--ink)"),text:value}),
      sub?el("div",{style:"font-size:12px;color:var(--muted);margin-top:2px",text:sub}):null,
    ]);
  }
  // robust scale cap: ignore a lone extreme spike (e.g. an idle-production day)
  function robustCap(values){
    const v = values.map(x=>Math.abs(x)||0).sort((a,b)=>a-b);
    if(v.length<4) return Math.max(1, ...v);
    const med = v[Math.floor(v.length/2)];
    return Math.max(med*2.5, v[Math.floor(v.length*0.8)]) || 1;  // ~p80, floored at 2.5×median
  }
  // horizontal mini bar chart from [{label,value,tip}]. opts.cap clamps bar width.
  function bars(series, fmt, color, opts){
    const cap = (opts && opts.cap) ? opts.cap : Math.max(1, ...series.map(s=>Math.abs(s.value)||0));
    const wrap = el("div",{style:"display:flex;flex-direction:column;gap:6px;margin-top:4px"});
    series.forEach(s=>{
      const w = Math.max(2, Math.min(100, Math.round((Math.abs(s.value)||0)/cap*100)));
      wrap.appendChild(el("div",{style:"display:flex;align-items:center;gap:8px"},[
        el("div",{style:"width:62px;font-size:11px;color:var(--muted);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis",text:s.label}),
        el("div",{style:"flex:1;background:#eef2f6;border-radius:999px;height:14px;overflow:hidden"},
          el("div",{style:`height:100%;width:${w}%;background:${color||"var(--primary)"};border-radius:999px`})),
        el("div",{style:"width:62px;font-size:11px;font-weight:700;white-space:nowrap",text:(fmt?fmt(s.value):s.value)}),
      ]));
    });
    return wrap;
  }
  function section(title, sub, body){
    return el("div",{class:"card",style:"margin-bottom:14px"},[
      el("div",{style:"display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:12px"},[
        el("div",{style:"font-weight:700;font-size:15px",text:title}),
        sub?el("div",{style:"font-size:12px;color:var(--muted)",text:sub}):null,
      ]),
      body,
    ]);
  }
  const sumBy = (rows, f)=> rows.reduce((a,r)=> a+(num(f(r))||0), 0);
  const uniq  = (rows, f)=> new Set(rows.map(f).filter(v=>v!=null)).size;

  // ===================================================================
  //  COCKPIT — Fiori-style KPI launchpad
  // ===================================================================
  App.views.cockpit = function(host){
    loadInto(host, "Building management cockpit…", async (db)=>{
      const [costs, econ] = await Promise.all([
        db.list("daily_costs",   { order:"cost_date", ascending:true, limit:200 }),
        db.list("lot_economics", { order:"dpr_date",  ascending:true, limit:1000 }),
      ]);
      const wrap = el("div");

      // ---- KPI row ----
      const totExp = sumBy(costs, r=>r.total_expense);
      const totKg  = sumBy(costs, r=>r.prod_total);
      const cpk    = totKg>0 ? totExp/totKg : null;
      const totUsd = sumBy(econ, r=>r.amount_usd);
      const totQty = sumBy(econ, r=>r.total_qty);
      const usdKg  = totQty>0 ? totUsd/totQty : null;
      const lots   = uniq(econ, r=>r.lot_no);
      const buyers = uniq(econ, r=>r.buyer);
      const cases  = sumBy(econ, r=>r.cases);

      const period = costs.length ? (costs[0].cost_date+" → "+costs[costs.length-1].cost_date) : "no cost data";
      wrap.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px"},[
        kpi(usd(totUsd), "Export value", lots+" lots · "+buyers+" buyers", "var(--primary-dark)"),
        kpi(kg(totKg),   "Production",   "MTD · "+costs.length+" days"),
        kpi(inr(totExp), "Processing cost", "utilities + labour"),
        kpi(money2("₹",cpk), "Cost / kg", "blended", cpk!=null && cpk>22 ? "var(--danger)":"var(--success)"),
        kpi(money2("$",usdKg), "Revenue / kg", "export price density"),
        kpi(Math.round(cases).toLocaleString(), "Cases shipped", buyers+" buyers"),
      ]));

      // ---- cost/kg trend (last 14 days) ----
      const withCpk = costs.filter(r=> num(r.cost_per_kg)!=null && num(r.prod_total)>0);
      if(withCpk.length){
        const last = withCpk.slice(-14).map(r=>({ label:String(r.cost_date).slice(5), value:num(r.cost_per_kg) }));
        wrap.appendChild(section("Cost per kg — daily trend", "₹/kg · last "+last.length+" production days",
          bars(last, (v)=>"₹"+Number(v).toFixed(1), "var(--primary)", {cap:robustCap(last.map(x=>x.value))})));
      }

      // ---- top buyers by export value ----
      const byBuyer = groupAgg(econ, r=>r.buyer, r=>num(r.amount_usd)||0);
      const topB = byBuyer.slice(0,6).map(b=>({label:b.key, value:b.value}));
      if(topB.length){
        wrap.appendChild(section("Top buyers", "by export value (USD)",
          bars(topB, usd, "var(--success)")));
      }

      // ---- production split by freezer ----
      const split = [
        ["Plate", sumBy(costs,r=>r.prod_plate)],
        ["IQF",   sumBy(costs,r=>r.prod_iqf)],
        ["Blast", sumBy(costs,r=>r.prod_blast)],
        ["Aqua",  sumBy(costs,r=>r.prod_aqua)],
        ["Dolphin",sumBy(costs,r=>r.prod_dolphin)],
        ["Ghan",  sumBy(costs,r=>r.prod_ghan)],
      ].filter(x=>x[1]>0).map(x=>({label:x[0], value:x[1]}));
      if(split.length){
        wrap.appendChild(section("Production by freezer", "kg this period",
          bars(split, (v)=>compact(v), "var(--primary-dark)")));
      }
      return wrap;
    });
  };

  // group + sum helper → sorted desc
  function groupAgg(rows, keyFn, valFn){
    const m = {};
    rows.forEach(r=>{ const k=keyFn(r); if(k==null) return; m[k]=(m[k]||0)+(valFn(r)||0); });
    return Object.entries(m).map(([key,value])=>({key,value})).sort((a,b)=>b.value-a.value);
  }

  // ===================================================================
  //  COST — Controlling (CO): daily cost centres
  // ===================================================================
  App.views.cost = function(host){
    loadInto(host, "Loading daily costs…", async (db)=>{
      const costs = await db.list("daily_costs", { order:"cost_date", ascending:true, limit:200 });
      if(!costs.length) return el("div",{class:"card"}, el("div",{class:"stub"},[el("div",{class:"big",text:"💡"}),el("div",{text:"No daily cost data yet"})]));
      const wrap = el("div");

      const totExp = sumBy(costs, r=>r.total_expense);
      const totKg  = sumBy(costs, r=>r.prod_total);
      const cpk    = totKg>0 ? totExp/totKg : null;
      const period = costs[0].cost_date+" → "+costs[costs.length-1].cost_date;

      wrap.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px"},[
        kpi(inr(totExp), "Total expense", period),
        kpi(kg(totKg),   "Production",    costs.length+" days"),
        kpi(money2("₹",cpk), "Blended cost / kg", "all centres", cpk!=null&&cpk>22?"var(--danger)":"var(--success)"),
      ]));

      // ---- cost component breakdown ----
      const comps = [
        ["Power",    sumBy(costs,r=>r.power_total)],
        ["Wages",    sumBy(costs,r=>r.wages_total)],
        ["Salary",   sumBy(costs,r=>r.salary_total)],
        ["Water",    sumBy(costs,r=>r.water_total)],
        ["Peeling",  sumBy(costs,r=>r.peeling_cost)],
        ["Firewood", sumBy(costs,r=>r.firewood_amt)],
        ["Diesel",   sumBy(costs,r=>r.diesel_amt)],
      ].filter(c=>c[1]>0).sort((a,b)=>b[1]-a[1]);
      const breakdown = el("div");
      comps.forEach(([name,val])=>{
        const share = totExp>0 ? (val/totExp*100) : 0;
        const perkg = totKg>0 ? val/totKg : null;
        breakdown.appendChild(srow(name, share.toFixed(0)+"% of spend · "+money2("₹",perkg)+"/kg", inr(val)));
      });
      wrap.appendChild(section("Cost centres", "this period · INR", breakdown));

      // ---- daily cost/kg trend ----
      const withCpk = costs.filter(r=> num(r.cost_per_kg)!=null && num(r.prod_total)>0);
      const trend = withCpk.map(r=>({ label:String(r.cost_date).slice(5), value:num(r.cost_per_kg) }));
      if(trend.length){
        wrap.appendChild(section("Daily cost per kg", "₹/kg",
          bars(trend, (v)=>"₹"+Number(v).toFixed(1),
            "var(--primary)", {cap:robustCap(trend.map(x=>x.value))})));
      }
      return wrap;
    });
  };

  // ===================================================================
  //  ECONOMICS — per-lot rollup (yield, glaze variance, export value)
  // ===================================================================
  App.views.economics = function(host){
    loadInto(host, "Loading lot economics…", async (db)=>{
      const rows = await db.list("lot_economics", { order:"dpr_date", ascending:false, limit:1000 });
      if(!rows.length) return el("div",{class:"card"}, el("div",{class:"stub"},[el("div",{class:"big",text:"📈"}),el("div",{text:"No lot economics imported yet"})]));

      // group by lot
      const lotsMap = {};
      rows.forEach(r=>{
        const k = r.lot_no; if(k==null) return;
        const g = lotsMap[k] || (lotsMap[k]={ lot:k, usd:0, qty:0, cases:0, lines:0,
          buyers:new Set(), products:new Set(), gActual:[], gTarget:[], rm:0, net:0 });
        g.usd  += num(r.amount_usd)||0;
        g.qty  += num(r.total_qty)||0;
        g.cases+= num(r.cases)||0;
        g.lines++;
        if(r.buyer)   g.buyers.add(r.buyer);
        if(r.product) g.products.add(r.product);
        if(num(r.actual_glaze)!=null) g.gActual.push(num(r.actual_glaze));
        if(num(r.target_glaze)!=null) g.gTarget.push(num(r.target_glaze));
        g.rm  = Math.max(g.rm, num(r.rm_weight)||0);   // rm_weight repeats per line → take the lot value
        g.net += num(r.net_yield)||0;
      });
      const lots = Object.values(lotsMap).sort((a,b)=>b.usd-a.usd);

      const wrap = el("div");
      const totUsd = lots.reduce((a,l)=>a+l.usd,0);
      const avg = (arr)=> arr.length ? arr.reduce((x,y)=>x+y,0)/arr.length : null;
      // count lots with material glaze under-run (giving away product: actual < target by >3pts)
      let giveaway=0, shortglaze=0;
      lots.forEach(l=>{ const a=avg(l.gActual), t=avg(l.gTarget);
        if(a!=null&&t!=null){ if(a < t-0.03) giveaway++; else if(a > t+0.03) shortglaze++; } });

      wrap.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px"},[
        kpi(usd(totUsd), "Export value", lots.length+" lots"),
        kpi(String(giveaway), "Product giveaway", "glaze under target >3pts", giveaway?"var(--danger)":"var(--success)"),
        kpi(String(shortglaze), "Over-glaze", "actual over target >3pts", shortglaze?"var(--danger)":"var(--success)"),
      ]));

      const list = el("div",{class:"card"});
      lots.forEach(l=>{
        const a=avg(l.gActual), t=avg(l.gTarget);
        let flag=null, flagColor=null;
        if(a!=null&&t!=null){
          if(a < t-0.03){ flag="giveaway "+pct(t-a); flagColor="var(--danger)"; }
          else if(a > t+0.03){ flag="over-glaze "+pct(a-t); flagColor="var(--danger)"; }
        }
        const sub = [
          [...l.buyers].slice(0,2).join(", ")+(l.buyers.size>2?" +"+(l.buyers.size-2):""),
          Math.round(l.cases)+" cases",
          a!=null?("glaze "+pct(a)+(t!=null?"/"+pct(t):"")):null,
        ].filter(Boolean).join(" · ");
        const row = srow(l.lot, sub, usd(l.usd));
        if(flag) row.querySelector(".r").appendChild(
          el("div",{style:"font-size:11px;font-weight:700;color:"+flagColor,text:flag}));
        // tap a lot → open full traceability timeline
        row.style.cursor="pointer";
        row.addEventListener("click", ()=> App.openLot(l.lot));
        list.appendChild(row);
      });
      wrap.appendChild(section("Lots by export value", "tap a lot for full traceability · USD", list));
      return wrap;
    });
  };

  // ===================================================================
  //  CHARGES — process-charge rate card (MM / pricing master)
  // ===================================================================
  App.views.charges = function(host){
    loadInto(host, "Loading rate card…", async (db)=>{
      const rows = await db.list("process_charges", { order:"sort_order", ascending:true, limit:100 });
      if(!rows.length) return el("div",{class:"card"}, el("div",{class:"stub"},[el("div",{class:"big",text:"🧾"}),el("div",{text:"No process charges defined"})]));
      const card = el("div",{class:"card"});
      const priced = rows.filter(r=>num(r.rate)!=null).length;
      rows.forEach(r=>{
        card.appendChild(srow(
          r.process_name,
          r.unit||"per kg",
          num(r.rate)!=null ? "₹"+Number(r.rate).toFixed(2) : "rate TBD",
          num(r.rate)!=null ? null : "var(--muted)"));
      });
      return section("Process charge rate card", priced+" of "+rows.length+" priced", card);
    });
  };

  // ===================================================================
  //  BUYERS — sales analytics (SD)
  // ===================================================================
  App.views.buyers = function(host){
    loadInto(host, "Loading buyer analytics…", async (db)=>{
      const rows = await db.list("lot_economics", { order:"dpr_date", ascending:false, limit:1000 });
      if(!rows.length) return el("div",{class:"card"}, el("div",{class:"stub"},[el("div",{class:"big",text:"🌍"}),el("div",{text:"No sales data imported yet"})]));

      const m = {};
      rows.forEach(r=>{
        const k=r.buyer; if(k==null) return;
        const g=m[k]||(m[k]={buyer:k, usd:0, qty:0, cases:0, lots:new Set(), products:new Set()});
        g.usd+=num(r.amount_usd)||0; g.qty+=num(r.total_qty)||0; g.cases+=num(r.cases)||0;
        if(r.lot_no) g.lots.add(r.lot_no); if(r.product) g.products.add(r.product);
      });
      const buyers = Object.values(m).sort((a,b)=>b.usd-a.usd);
      const totUsd = buyers.reduce((a,b)=>a+b.usd,0);
      const wrap = el("div");

      wrap.appendChild(el("div",{style:"display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px"},[
        kpi(usd(totUsd), "Total export", buyers.length+" buyers"),
        kpi(buyers.length?buyers[0].buyer:"—", "Top buyer", buyers.length?usd(buyers[0].usd):""),
      ]));

      wrap.appendChild(section("Export value share", "USD by buyer",
        bars(buyers.slice(0,8).map(b=>({label:b.buyer,value:b.usd})), usd, "var(--success)")));

      const list = el("div",{class:"card"});
      buyers.forEach(b=>{
        const usdKg = b.qty>0 ? b.usd/b.qty : null;
        const share = totUsd>0 ? (b.usd/totUsd*100) : 0;
        list.appendChild(srow(
          b.buyer,
          b.lots.size+" lots · "+Math.round(b.cases)+" cases · "+money2("$",usdKg)+"/kg",
          usd(b.usd)+"  ·  "+share.toFixed(0)+"%"));
      });
      wrap.appendChild(section("Buyers", "ranked by export value", list));
      return wrap;
    });
  };

})();
