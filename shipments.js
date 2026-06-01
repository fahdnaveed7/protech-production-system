/* =====================================================================
   Protech PWA — Shipments / Export order book
   Loaded after stock.js. Registers:
     App.views.orderbook   — pending order pipeline (value, by buyer)   [Office + Manager]
     App.views.shipped     — shipped history (distinct-PI value)         [Office + Manager]
     App.views.projections — May projections: required vs ready vs short [Office + Manager]
     App.views.neworder    — Office: create / edit a shipment + lines    [Office]
   Seeded from "MAY SHIPMENT PROJECTIONS.xlsm". Export values are USD
   (Western K/M notation) — never mixed with the INR cost layer.
   ===================================================================== */
(function(){
  "use strict";
  const App = window.App;
  if(!App){ console.error("shipments.js loaded before App"); return; }
  const DB = ()=> window.PROTECH_DB;
  const el = App.ui.el;
  const { notConnected, emptyState, loading } = App.ui;
  const toast = App.ui.toast;

  const num = (v)=>{ const n = parseFloat(v); return isFinite(n) ? n : null; };
  function compactW(n){
    if(n==null || !isFinite(n)) return "0";
    const a = Math.abs(n);
    if(a >= 1e6) return (n/1e6).toFixed(a>=1e7?0:2)+"M";
    if(a >= 1e3) return (n/1e3).toFixed(a>=1e4?0:1)+"K";
    return String(Math.round(n));
  }
  const usd = (n)=> "$"+compactW(n||0);
  const cs  = (n)=> (n==null?"—":Math.round(n).toLocaleString())+" cs";
  const sumBy = (rows,f)=> rows.reduce((a,r)=> a+(num(f(r))||0), 0);

  const STATUS_BADGE = {
    pending:   {bg:"#fef3c7", fg:"#92400e", label:"Pending"},
    shipped:   {bg:"#d1fae5", fg:"#065f46", label:"Shipped"},
    projected: {bg:"#dbeafe", fg:"#1e40af", label:"Projected"},
  };

  function kpi(value, label, sub){
    return el("div",{style:"flex:1;min-width:96px;background:var(--card-2,#f1f5f9);border-radius:12px;padding:11px 13px"},[
      el("div",{style:"font-size:19px;font-weight:800;color:var(--primary-dark)",text:value}),
      el("div",{style:"font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)",text:label}),
      sub?el("div",{style:"font-size:11px;color:var(--muted);margin-top:2px",text:sub}):null,
    ]);
  }
  function kpiRow(items){
    return el("div",{style:"display:flex;gap:10px;margin:4px 0 14px;flex-wrap:wrap"}, items);
  }
  function badge(status){
    const b = STATUS_BADGE[status] || {bg:"#e2e8f0",fg:"#475569",label:status||"—"};
    return el("span",{style:`background:${b.bg};color:${b.fg};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:2px 7px;border-radius:999px`,text:b.label});
  }
  function srow(left, sub, right, onclick){
    const r = el("div",{class:"srow", style:onclick?"cursor:pointer":""},[
      el("div",{},[ el("div",{class:"l",text:left}), sub?el("div",{class:"s",text:sub}):null ]),
      el("div",{class:"r",text:right||""}),
    ]);
    if(onclick) r.addEventListener("click", onclick);
    return r;
  }
  async function loadAll(db, table, opts){
    // page past PostgREST's 1000-row cap
    const PAGE=1000; let all=[]; const o=opts||{};
    for(let from=0;;from+=PAGE){
      let q = db.client.from(table).select(o.select||"*");
      if(o.eq) for(const [k,v] of Object.entries(o.eq)) q=q.eq(k,v);
      if(o.order) q=q.order(o.order,{ascending:!!o.asc});
      q=q.range(from, from+PAGE-1);
      const { data, error } = await q;
      if(error) throw error;
      all=all.concat(data||[]);
      if(!data || data.length<PAGE) break;
    }
    return all;
  }
  function host(main){ const h=el("div",{}); main.appendChild(h); return h; }

  // ===================================================================
  //  Shipment detail — header panel + grade/size line items
  // ===================================================================
  async function openShipment(main, id){
    main.innerHTML="";
    const back = el("button",{class:"back",onclick:()=>App.home()},["← Back"]);
    main.appendChild(back);
    const db = DB(); if(!db || !db.isOnline()) return notConnected(main);
    const card = el("div",{class:"card"}); main.appendChild(card);
    const spin = loading(card, "Loading shipment…");
    try{
      const [sRows, lines] = await Promise.all([
        db.list("shipments",{ filters:{ id }, limit:1 }),
        db.list("shipment_lines",{ filters:{ shipment_id:id }, order:"line_no", ascending:true }),
      ]);
      spin.remove();
      const s = sRows[0];
      if(!s){ emptyState(card,"❓","Shipment not found",""); return; }
      const head = el("div",{class:"form-head"},[ el("h3",{text:(s.buyer||"—")}), badge(s.status) ]);
      card.appendChild(head);
      const panel = el("div",{style:"background:var(--card-2,#f1f5f9);border-radius:12px;padding:12px 14px;margin-bottom:14px"});
      const line=(k,v)=> v?el("div",{style:"display:flex;justify-content:space-between;gap:12px;padding:3px 0;font-size:14px"},[
        el("span",{style:"color:var(--muted)",text:k}), el("span",{style:"font-weight:700;text-align:right",text:v}) ]):null;
      [["PI no",s.pi_no],["PO no",s.po_no],["Agent",s.agent],["Processed by",s.processed_by],
       ["Destination",s.destination],["Ship date",s.ship_date_text],
       ["Order value", s.amount_usd!=null?usd(s.amount_usd):null],["Year",s.fiscal_year]]
        .forEach(([k,v])=>{ const n=line(k,v); if(n) panel.appendChild(n); });
      card.appendChild(panel);

      const lh = el("div",{}); card.appendChild(lh);
      lh.appendChild(el("div",{style:"font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:4px 0 8px",text:"Line items ("+lines.length+")"}));
      let curDesc=null;
      lines.forEach(l=>{
        if(l.description && l.description!==curDesc){
          curDesc=l.description;
          lh.appendChild(el("div",{style:"font-weight:700;margin:10px 0 2px;font-size:13px",text:l.description+(l.packing?("  ·  "+l.packing):"")}));
        }
        const right = l.line_amount_usd!=null ? usd(l.line_amount_usd)
          : (l.num_cases!=null ? cs(l.num_cases)+(l.rate!=null?("  @ "+l.rate):"")
          : (l.ready_cases!=null||l.cartons_required!=null
              ? ("ready "+(l.ready_cases!=null?Math.round(l.ready_cases):"—")+" / "+(l.cartons_required!=null?Math.round(l.cartons_required):"—"))
              : ""));
        const sub = [];
        if(l.short!=null && l.short<0) sub.push("short "+Math.round(l.short));
        if(l.selling_rate) sub.push("sell "+l.selling_rate);
        lh.appendChild(srow(l.grade_size||"—", sub.join(" · ")||null, right));
      });
    }catch(e){ spin.remove(); emptyState(card,"⚠️","Could not load", String(e.message||e)); }
  }
  App.openShipment = (id)=> openShipment(document.getElementById("main"), id);

  // ===================================================================
  //  ORDER BOOK — pending pipeline
  // ===================================================================
  App.views.orderbook = function(h){
    const db = DB(); if(!db || !db.isOnline()) return notConnected(h);
    const spin = loading(h, "Loading order book…");
    (async()=>{
      try{
        const rows = await loadAll(db,"shipments",{ eq:{status:"pending"} });
        spin.remove();
        if(!rows.length) return emptyState(h,"📭","No pending orders","");
        rows.sort((a,b)=> (num(b.amount_usd)||0)-(num(a.amount_usd)||0));
        const total = sumBy(rows, r=>r.amount_usd);
        const buyers = new Set(rows.map(r=>r.buyer).filter(Boolean));
        const card = el("div",{class:"card"});
        card.appendChild(el("div",{class:"form-head"},[ el("h3",{text:"Order book — pending"}) ]));
        card.appendChild(kpiRow([
          kpi(usd(total),"Pipeline value"),
          kpi(String(rows.length),"Open orders"),
          kpi(String(buyers.size),"Buyers"),
        ]));
        rows.forEach(s=> card.appendChild(srow(
          s.buyer||"—",
          [s.country||s.destination, s.ship_date_text, s.agent].filter(Boolean).join(" · "),
          s.amount_usd!=null?usd(s.amount_usd):"—",
          ()=> App.openShipment(s.id))));
        h.appendChild(card);
      }catch(e){ spin.remove(); emptyState(h,"⚠️","Could not load", String(e.message||e)); }
    })();
  };

  // ===================================================================
  //  SHIPPED — history, distinct-PI value
  // ===================================================================
  App.views.shipped = function(h){
    const db = DB(); if(!db || !db.isOnline()) return notConnected(h);
    const spin = loading(h, "Loading shipped history…");
    (async()=>{
      try{
        const rows = await loadAll(db,"shipments",{ eq:{status:"shipped"} });
        spin.remove();
        if(!rows.length) return emptyState(h,"📦","No shipped records","");
        // value per PI = max amount across its rows (SHIPPED log has null amounts
        // that would otherwise shadow the SHIPPED DTLS value for the same PI).
        const maxByPi = {};
        rows.forEach(r=>{ const k=r.pi_no||r.id; const a=num(r.amount_usd)||0; if(a>(maxByPi[k]||0)) maxByPi[k]=a; });
        const distinctVal = Object.values(maxByPi).reduce((a,b)=>a+b,0);
        const seen = { size: Object.keys(maxByPi).length };
        const byBuyer = {};
        rows.forEach(r=>{ const b=r.buyer||"—"; (byBuyer[b]=byBuyer[b]||{n:0,v:0}); byBuyer[b].n++; byBuyer[b].v+=num(r.amount_usd)||0; });
        const card = el("div",{class:"card"});
        card.appendChild(el("div",{class:"form-head"},[ el("h3",{text:"Shipped history"}) ]));
        card.appendChild(kpiRow([
          kpi(usd(distinctVal),"Shipped value", seen.size+" priced PIs"),
          kpi(String(rows.length),"Shipment rows"),
          kpi(String(Object.keys(byBuyer).length),"Buyers"),
        ]));
        rows.sort((a,b)=> (num(b.amount_usd)||0)-(num(a.amount_usd)||0));
        rows.forEach(s=> card.appendChild(srow(
          s.buyer||"—",
          [s.country||s.destination, s.ship_date_text, s.pi_no].filter(Boolean).join(" · "),
          s.amount_usd!=null?usd(s.amount_usd):"—",
          ()=> App.openShipment(s.id))));
        h.appendChild(card);
      }catch(e){ spin.remove(); emptyState(h,"⚠️","Could not load", String(e.message||e)); }
    })();
  };

  // ===================================================================
  //  PROJECTIONS — required vs ready vs short (May)
  // ===================================================================
  App.views.projections = function(h){
    const db = DB(); if(!db || !db.isOnline()) return notConnected(h);
    const spin = loading(h, "Loading projections…");
    (async()=>{
      try{
        const rows = await loadAll(db,"shipments",{ eq:{status:"projected"} });
        const ids = rows.map(r=>r.id);
        const allLines = ids.length ? await loadAll(db,"shipment_lines",{}) : [];
        const linesBy = {}; allLines.forEach(l=>{ (linesBy[l.shipment_id]=linesBy[l.shipment_id]||[]).push(l); });
        spin.remove();
        if(!rows.length) return emptyState(h,"🎯","No projections","");
        let req=0, ready=0;
        rows.forEach(s=>{ const ls=linesBy[s.id]||[]; req+=sumBy(ls,l=>l.cartons_required); ready+=sumBy(ls,l=>l.ready_cases); });
        const short = req-ready;
        const card = el("div",{class:"card"});
        card.appendChild(el("div",{class:"form-head"},[ el("h3",{text:"May projections — readiness"}) ]));
        card.appendChild(kpiRow([
          kpi(String(rows.length),"Orders"),
          kpi(cs(req),"Required"),
          kpi(cs(ready),"Ready", (req>0?Math.round(ready/req*100):0)+"% packed"),
          kpi(cs(short),"Short"),
        ]));
        rows.forEach(s=>{
          const ls=linesBy[s.id]||[];
          const r=sumBy(ls,l=>l.cartons_required), rd=sumBy(ls,l=>l.ready_cases), sh=r-rd;
          const right = cs(rd)+" / "+cs(r);
          const row = srow(s.buyer||"—",
            [s.country||s.destination, ls.length+" grade"+(ls.length>1?"s":"")].filter(Boolean).join(" · "),
            right, ()=> App.openShipment(s.id));
          if(sh>0.5){ const r2=row.querySelector(".r"); if(r2) r2.appendChild(el("div",{style:"font-size:11px;color:var(--danger,#ef4444);font-weight:700",text:"short "+Math.round(sh)})); }
          card.appendChild(row);
        });
        h.appendChild(card);
      }catch(e){ spin.remove(); emptyState(h,"⚠️","Could not load", String(e.message||e)); }
    })();
  };

  // ===================================================================
  //  NEW / EDIT ORDER — Office editable shipment + line items
  // ===================================================================
  const STATUSES = [{v:"pending",label:"Pending"},{v:"projected",label:"Projected"},{v:"shipped",label:"Shipped"}];
  function input(attrs){ return el("input",Object.assign({class:"in"},attrs)); }
  function field(label, node, full){ return el("div",{class:"fld"+(full?" full":"")},[ el("label",{text:label}), node ]); }

  App.views.neworder = function(h){
    const db = DB(); if(!db || !db.isOnline()) return notConnected(h);
    h.innerHTML="";
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"form-head"},[ el("h3",{text:"New / Edit order"}) ]));
    card.appendChild(el("div",{class:"hint",style:"margin:-6px 0 12px;text-transform:none",
      text:"Start a blank order, or search an existing one to edit it."}));
    const search = input({ placeholder:"Search existing by buyer / PI…" });
    card.appendChild(field("Edit existing", search, true));
    const results = el("div",{style:"margin:6px 0 12px"});
    card.appendChild(results);
    card.appendChild(el("button",{class:"btn btn-primary",text:"＋ New blank order",onclick:()=> buildForm(h, db, null)}));
    h.appendChild(card);

    let tmr=null;
    search.addEventListener("input", ()=>{ clearTimeout(tmr); tmr=setTimeout(async()=>{
      results.innerHTML="";
      const q=(search.value||"").trim(); if(!q) return;
      const spin=loading(results,"Searching…");
      try{
        const safe=q.replace(/[%,()]/g," ");
        const { data, error } = await db.client.from("shipments").select("*")
          .or(`buyer.ilike.%${safe}%,pi_no.ilike.%${safe}%`).order("created_at",{ascending:false}).limit(20);
        if(error) throw error; spin.remove();
        if(!data||!data.length){ emptyState(results,"🔍","No match",""); return; }
        data.forEach(s=> results.appendChild(srow(s.buyer||"—",
          [s.status,s.pi_no,s.country].filter(Boolean).join(" · "),
          s.amount_usd!=null?usd(s.amount_usd):"", ()=> buildForm(h, db, s))));
      }catch(e){ spin.remove(); emptyState(results,"⚠️","Search failed",String(e.message||e)); }
    }, 220); });
  };

  function lineRow(l){
    l = l||{};
    const cell=(ph,val,w)=> input({ placeholder:ph, value:(val!=null?val:""), style:"min-width:0;width:"+(w||"100%") });
    const desc=cell("Description",l.description), pack=cell("Packing",l.packing),
      grade=cell("Grade/size",l.grade_size),
      cases=input({type:"number",inputmode:"decimal",placeholder:"Cases",value:(l.num_cases!=null?l.num_cases:(l.cartons_required!=null?l.cartons_required:"")),style:"min-width:0"}),
      ready=input({type:"number",inputmode:"decimal",placeholder:"Ready",value:(l.ready_cases!=null?l.ready_cases:""),style:"min-width:0"}),
      rate=input({type:"number",inputmode:"decimal",placeholder:"Rate",value:(l.rate!=null?l.rate:""),style:"min-width:0"}),
      sell=cell("Sell",l.selling_rate);
    const grid = el("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px;border:1px solid var(--line,#e2e8f0);border-radius:10px;margin-bottom:8px;position:relative"});
    [["Description",desc],["Packing",pack],["Grade / size",grade],["Cases / cartons",cases],["Ready (proj.)",ready],["Rate",rate],["Selling rate",sell]]
      .forEach(([lab,node])=> grid.appendChild(el("div",{},[ el("label",{style:"font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)",text:lab}), node ])));
    const rm = el("button",{class:"btn btn-ghost",style:"grid-column:1/-1;padding:4px;font-size:12px",text:"✕ Remove line",onclick:()=>grid.remove()});
    grid.appendChild(rm);
    grid.collect = ()=>{
      const g=grade.value.trim(), c=num(cases.value);
      if(!g && c==null && !desc.value.trim()) return null;
      return { description:desc.value.trim()||null, packing:pack.value.trim()||null, grade_size:g||null,
        cases:c, ready:num(ready.value), rate:num(rate.value), selling:sell.value.trim()||null };
    };
    return grid;
  }

  async function buildForm(h, db, existing){
    h.innerHTML="";
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"form-head"},[ el("h3",{text: existing?"Edit order":"New order"}),
      el("span",{class:"fmt",text: existing?"editing":"new"}) ]));

    const fStatus=el("select",{class:"in"}); STATUSES.forEach(s=> fStatus.appendChild(el("option",{value:s.v,text:s.label, selected: existing&&existing.status===s.v?"selected":null})));
    const fBuyer=input({value:existing?.buyer||"", placeholder:"Buyer (required)"});
    const fPi=input({value:existing?.pi_no||""}), fPo=input({value:existing?.po_no||""});
    const fAgent=input({value:existing?.agent||""}), fProc=input({value:existing?.processed_by||""});
    const fDest=input({value:existing?.destination||"", placeholder:"City, Country"});
    const fShip=input({value:existing?.ship_date_text||"", placeholder:"e.g. IMMEDIATE / 2026-05-30"});
    const fAmt=input({type:"number",inputmode:"decimal",value:existing?.amount_usd!=null?existing.amount_usd:"", placeholder:"Order value USD"});
    const fYear=input({value:existing?.fiscal_year||"", placeholder:"2026-2027"});
    const fRem=el("textarea",{class:"in",rows:"2",placeholder:"Remarks"}); if(existing?.remarks) fRem.value=existing.remarks;

    const grid=el("div",{class:"fgrid"});
    grid.appendChild(field("Status",fStatus));
    grid.appendChild(field("Buyer",fBuyer));
    grid.appendChild(field("PI no",fPi));
    grid.appendChild(field("PO no",fPo));
    grid.appendChild(field("Agent",fAgent));
    grid.appendChild(field("Processed by",fProc));
    grid.appendChild(field("Destination",fDest,true));
    grid.appendChild(field("Ship date",fShip));
    grid.appendChild(field("Order value (USD)",fAmt));
    grid.appendChild(field("Fiscal year",fYear));
    grid.appendChild(field("Remarks",fRem,true));
    card.appendChild(grid);

    card.appendChild(el("div",{style:"font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:6px 0 8px",text:"Line items"}));
    const linesHost=el("div",{});
    card.appendChild(linesHost);
    const addBtn=el("button",{class:"btn btn-ghost",text:"＋ Add line",onclick:()=> linesHost.appendChild(lineRow())});
    card.appendChild(addBtn);

    // existing lines
    if(existing){
      try{ const ls=await db.list("shipment_lines",{filters:{shipment_id:existing.id},order:"line_no",ascending:true});
        (ls.length?ls:[{}]).forEach(l=> linesHost.appendChild(lineRow(l))); }
      catch(_){ linesHost.appendChild(lineRow()); }
    } else { linesHost.appendChild(lineRow()); }

    const errEl=el("div",{class:"err-msg hidden"}); card.appendChild(errEl);
    const btn=el("button",{class:"btn btn-primary",text: existing?"Save changes":"Create order"});
    const cancel=el("button",{class:"btn btn-ghost",text:"Cancel",onclick:()=>App.home()});
    card.appendChild(el("div",{class:"form-actions"},[cancel,btn]));
    h.appendChild(card);

    btn.addEventListener("click", async ()=>{
      errEl.classList.add("hidden");
      const status=fStatus.value;
      if(!fBuyer.value.trim()){ errEl.textContent="Buyer is required"; errEl.classList.remove("hidden"); return; }
      const header={ status, buyer:fBuyer.value.trim(), pi_no:fPi.value.trim()||null, po_no:fPo.value.trim()||null,
        agent:fAgent.value.trim()||null, processed_by:fProc.value.trim()||null,
        destination:fDest.value.trim()||null, country:(fDest.value.split(",").pop()||"").trim()||null,
        ship_date_text:fShip.value.trim()||null, amount_usd:num(fAmt.value),
        fiscal_year:fYear.value.trim()||null, remarks:fRem.value.trim()||null };
      const lineDefs=[...linesHost.children].map(g=>g.collect&&g.collect()).filter(Boolean);
      btn.disabled=true; btn.textContent="Saving…";
      try{
        let shipId;
        if(existing){
          const { error } = await db.client.from("shipments").update(header).eq("id",existing.id);
          if(error) throw error; shipId=existing.id;
          await db.client.from("shipment_lines").delete().eq("shipment_id",shipId);
        } else {
          const row = await DB().insert("shipments", header);
          shipId = row && row.id; if(!shipId) throw new Error("header not created");
        }
        let ln=0;
        for(const d of lineDefs){
          ln++;
          await DB().insert("shipment_lines", {
            shipment_id:shipId, line_no:ln, description:d.description, packing:d.packing,
            grade_size:d.grade_size,
            cartons_required: status==="projected" ? d.cases : null,
            ready_cases: d.ready,
            num_cases: status==="projected" ? null : d.cases,
            rate:d.rate, selling_rate:d.selling,
            short: (status==="projected" && d.cases!=null && d.ready!=null) ? (d.cases-d.ready) : null,
          });
        }
        toast(existing?"Order updated ✓":"Order created ✓","ok");
        App.home();
      }catch(e){ btn.disabled=false; btn.textContent= existing?"Save changes":"Create order";
        errEl.textContent="Could not save: "+(e.message||e); errEl.classList.remove("hidden"); }
    });
  }
})();
