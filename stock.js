/* =====================================================================
   Protech PWA — Stock & Reglaze (cold-store holdings)
   Loaded after forms.js. Registers:
     App.views.stock    — Stock on hand (searchable, grouped)  [Office + Manager]
     App.views.reglaze  — Reglaze: draw down a source stock row,
                          produce a new on-hand row, write an audit txn.
   The `stock` table is the live cold-store (one row per pallet line).
   Reglaze consumes cases from a source row and creates the reglazed
   output as a fresh on-hand row. glaze % is ENTERED, never derived.
   ===================================================================== */
(function(){
  "use strict";
  const App = window.App;
  if(!App){ console.error("stock.js loaded before App"); return; }
  const DB = ()=> window.PROTECH_DB;
  const el = App.ui.el;
  const { notConnected, emptyState, loading } = App.ui;
  const toast = App.ui.toast;

  const GLAZE_GROUPS = ["No Glz","1-5","6-10","11-15","16-20","21-25","26-30","31-35","36-40","41-45"];

  const num = (v)=>{ const n = parseFloat(v); return isFinite(n) ? n : null; };
  const r4  = (n)=> n==null ? null : Math.round(n*10000)/10000;
  const kg  = (n)=> (n==null?"—":Math.round(n).toLocaleString())+" kg";
  const cs  = (n)=> (n==null?"—":(Math.round(n*100)/100).toLocaleString())+" cs";

  function field(label, node, full){
    return el("div",{class:"fld"+(full?" full":"")},[ el("label",{text:label}), node ]);
  }
  function input(attrs){ return el("input",Object.assign({class:"in"},attrs)); }

  // ===================================================================
  //  STOCK ON HAND — searchable, grouped by item › grade
  // ===================================================================
  App.views.stock = function(host){
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    host.innerHTML = "";
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"form-head"},[ el("h3",{text:"Stock on hand"}) ]));
    const search = input({ placeholder:"Search item / grade / location…", style:"margin-bottom:12px" });
    card.appendChild(field("Search", search, true));
    const kpiRow = el("div",{class:"kpi-row", style:"display:flex;gap:10px;margin:4px 0 14px;flex-wrap:wrap"});
    card.appendChild(kpiRow);
    const listHost = el("div",{});
    card.appendChild(listHost);
    host.appendChild(card);

    const spin = loading(listHost, "Loading stock…");
    let ALL = [];
    (async ()=>{
      try{
        // PostgREST caps each response at 1000 rows — page through with range().
        const PAGE = 1000;
        for(let from=0; ; from+=PAGE){
          const { data, error } = await db.client.from("stock")
            .select("item,grade,location,cases,total_qty")
            .eq("status","on_hand").order("item").range(from, from+PAGE-1);
          if(error) throw error;
          ALL = ALL.concat(data||[]);
          if(!data || data.length < PAGE) break;
        }
      }catch(e){ spin.remove(); emptyState(listHost,"⚠️","Could not load stock", String(e.message||e)); return; }
      spin.remove();
      render("");
    })();

    function kpi(value, label){
      return el("div",{style:"flex:1;min-width:90px;background:var(--card-2,#f1f5f9);border-radius:12px;padding:10px 12px"},[
        el("div",{style:"font-size:18px;font-weight:800;color:var(--primary-dark)",text:value}),
        el("div",{style:"font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)",text:label}),
      ]);
    }
    function srow(left, sub, right){
      return el("div",{class:"srow"},[
        el("div",{},[ el("div",{class:"l",text:left}), sub?el("div",{class:"s",text:sub}):null ]),
        el("div",{class:"r",text:right||""}),
      ]);
    }

    function render(q){
      listHost.innerHTML = "";
      q = (q||"").trim().toLowerCase();
      const rows = q ? ALL.filter(r=>
        (r.item||"").toLowerCase().includes(q) ||
        (r.grade||"").toLowerCase().includes(q) ||
        (r.location||"").toLowerCase().includes(q)) : ALL;

      let totCases=0, totKg=0;
      const byItem = {};
      rows.forEach(r=>{
        totCases += num(r.cases)||0; totKg += num(r.total_qty)||0;
        const key = (r.item||"—")+" ‖ "+(r.grade||"—");
        const g = byItem[key] || (byItem[key] = { item:r.item||"—", grade:r.grade||"—", cases:0, kg:0, lines:0 });
        g.cases += num(r.cases)||0; g.kg += num(r.total_qty)||0; g.lines += 1;
      });
      kpiRow.innerHTML = "";
      kpiRow.appendChild(kpi(kg(totKg), "On hand"));
      kpiRow.appendChild(kpi(cs(totCases), "Cases"));
      kpiRow.appendChild(kpi(String(Object.keys(byItem).length), "Item · grade"));

      const groups = Object.values(byItem).sort((a,b)=> b.kg - a.kg);
      if(!groups.length){ emptyState(listHost,"📦","No matching stock", q?"Try a different search.":""); return; }
      const wrap = el("div",{});
      groups.forEach(g=> wrap.appendChild(
        srow(g.item, "Grade "+g.grade+" · "+g.lines+" line"+(g.lines>1?"s":""), kg(g.kg)+" · "+cs(g.cases))));
      listHost.appendChild(wrap);
    }

    let tmr=null;
    search.addEventListener("input", ()=>{ clearTimeout(tmr); tmr=setTimeout(()=>render(search.value), 160); });
  };

  // ===================================================================
  //  REGLAZE — draw down a source stock row → new on-hand row + audit
  // ===================================================================
  App.views.reglaze = function(host){
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    renderPicker(host, db);
  };

  function renderPicker(host, db){
    host.innerHTML = "";
    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"form-head"},[ el("h3",{text:"Reglaze — pick source stock"}) ]));
    card.appendChild(el("div",{class:"hint",style:"margin:-6px 0 14px;text-transform:none",
      text:"Search the cold store, pick the pallet line to reglaze. Reglaze draws cases out of it and creates the reglazed output as a new on-hand line."}));
    const search = input({ placeholder:"Search item / grade / location / pallet…" });
    card.appendChild(field("Search stock", search, true));
    const results = el("div",{style:"margin-top:8px"});
    card.appendChild(results);
    card.appendChild(el("div",{class:"form-actions"},[ el("button",{class:"btn btn-ghost",text:"Cancel",onclick:()=>App.home()}) ]));
    host.appendChild(card);

    async function run(q){
      results.innerHTML = "";
      const spin = loading(results, "Searching…");
      try{
        let query = db.client.from("stock").select("*").eq("status","on_hand");
        q = (q||"").trim();
        if(q){
          const safe = q.replace(/[%,()]/g," ");
          query = query.or(`item.ilike.%${safe}%,grade.ilike.%${safe}%,location.ilike.%${safe}%,pallet_no.ilike.%${safe}%,brand.ilike.%${safe}%`);
        }
        const { data, error } = await query.order("item").limit(40);
        if(error) throw error;
        spin.remove();
        if(!data || !data.length){ emptyState(results,"🔍","No on-hand stock found", q?"Try a different search.":""); return; }
        data.forEach(s=>{
          const avail = (num(s.cases)||0);
          const row = el("div",{class:"srow", style:"cursor:pointer", onclick:()=> renderForm(host, db, s)},[
            el("div",{},[
              el("div",{class:"l",text:(s.item||"—")+"  ·  "+(s.grade||"—")}),
              el("div",{class:"s",text:[s.brand, s.glaze_grp?("glaze "+s.glaze_grp):null, s.location?("@ "+s.location+(s.rack?("/"+s.rack):"")):null, s.pallet_no?("plt "+s.pallet_no):null].filter(Boolean).join(" · ")}),
            ]),
            el("div",{class:"r",text:cs(avail)+"\n"+kg(num(s.total_qty)), style:"white-space:pre-line;text-align:right"}),
          ]);
          results.appendChild(row);
        });
      }catch(e){ spin.remove(); emptyState(results,"⚠️","Search failed", String(e.message||e)); }
    }
    let tmr=null;
    search.addEventListener("input", ()=>{ clearTimeout(tmr); tmr=setTimeout(()=>run(search.value), 220); });
    run("");
  }

  function renderForm(host, db, src){
    host.innerHTML = "";
    const availCases = num(src.cases)||0;
    const availKg = num(src.total_qty)||0;
    const wtCase = num(src.wt_per_case_kg);

    const card = el("div",{class:"card"});
    card.appendChild(el("div",{class:"form-head"},[ el("h3",{text:"Reglaze "+(src.item||"")} ) ]));

    // source summary panel
    const panel = el("div",{style:"background:var(--card-2,#f1f5f9);border-radius:12px;padding:12px 14px;margin-bottom:14px"});
    const line = (k,v)=> el("div",{style:"display:flex;justify-content:space-between;gap:12px;padding:3px 0;font-size:14px"},[
      el("span",{style:"color:var(--muted)",text:k}), el("span",{style:"font-weight:700;text-align:right",text:v}) ]);
    panel.appendChild(line("Grade", (src.grade||"—")+(src.brand?("  ·  "+src.brand):"")));
    panel.appendChild(line("Current glaze", (src.glaze_grp||"—")+(src.a_glaze!=null?("  ·  "+src.a_glaze+"%"):"")));
    panel.appendChild(line("On hand", cs(availCases)+"  ·  "+kg(availKg)));
    panel.appendChild(line("Location", (src.location||"—")+(src.rack?(" / "+src.rack):"")+(src.pallet_no?("   (plt "+src.pallet_no+")"):"")));
    card.appendChild(panel);

    const grid = el("div",{class:"fgrid"});

    const fCasesOut = input({ type:"number", inputmode:"decimal", value:String(availCases||""), min:"0" });
    const fGlazeGrp = input({ list:"glz-list", placeholder:"e.g. 11-15", value:"" });
    const dl = el("datalist",{id:"glz-list"}); GLAZE_GROUPS.forEach(g=> dl.appendChild(el("option",{value:g})));
    const fAGlaze  = input({ type:"number", inputmode:"decimal", placeholder:"% measured" });
    const fKgOut   = input({ type:"number", inputmode:"decimal", placeholder:"resulting kg" });
    const fLoc     = input({ value: src.location||"" });
    const fRack    = input({ value: src.rack||"" });
    const fLot     = input({ placeholder:"optional e.g. 5/89/26" });
    const fNotes   = el("textarea",{class:"in", rows:"2", placeholder:"optional"});

    // default output kg from cases × wt/case (editable; glaze entered, not derived)
    const recalcKg = ()=>{
      if(document.activeElement===fKgOut) return;
      const c = num(fCasesOut.value);
      if(c!=null && wtCase!=null) fKgOut.value = String(r4(c*wtCase));
    };
    fCasesOut.addEventListener("input", recalcKg);
    recalcKg();

    const fldCasesOut = field("Output cases", fCasesOut);
    fldCasesOut.appendChild(el("div",{class:"hint",style:"text-transform:none",text:"Drawn from on-hand "+cs(availCases)}));
    grid.appendChild(fldCasesOut);
    grid.appendChild(field("New glaze group", el("div",{},[fGlazeGrp, dl])));
    const fldA = field("New A-glaze %", fAGlaze); fldA.classList.add("entered"); grid.appendChild(fldA);
    const fldKg = field("Output qty (kg)", fKgOut); fldKg.classList.add("entered");
    fldKg.appendChild(el("div",{class:"hint",style:"text-transform:none",text:"Suggested from cases × wt/case — adjust to measured"}));
    grid.appendChild(fldKg);
    grid.appendChild(field("Output location", fLoc));
    grid.appendChild(field("Output rack", fRack));
    grid.appendChild(field("Lot (optional)", fLot));
    grid.appendChild(field("Notes", fNotes, true));
    card.appendChild(grid);

    const errEl = el("div",{class:"err-msg hidden"});
    card.appendChild(errEl);
    const btn = el("button",{class:"btn btn-primary", text:"Record reglaze"});
    const back = el("button",{class:"btn btn-ghost", text:"← Back", onclick:()=> renderPicker(host, db)});
    card.appendChild(el("div",{class:"form-actions"},[back, btn]));
    host.appendChild(card);

    btn.addEventListener("click", async ()=>{
      errEl.classList.add("hidden");
      const casesOut = num(fCasesOut.value);
      const glazeOut = (fGlazeGrp.value||"").trim();
      const aGlaze   = num(fAGlaze.value);
      const kgOut    = num(fKgOut.value);
      const errs = [];
      if(casesOut==null || casesOut<=0) errs.push("output cases");
      if(!glazeOut) errs.push("new glaze group");
      if(kgOut==null || kgOut<=0) errs.push("output qty (kg)");
      if(casesOut!=null && casesOut > availCases + 1e-6) errs.push("cases exceed on-hand ("+cs(availCases)+")");
      if(errs.length){ errEl.textContent = "Check: "+errs.join(", "); errEl.classList.remove("hidden"); return; }

      btn.disabled=true; btn.textContent="Saving…";
      try{
        // consumed kg proportional to cases drawn (source may include loose)
        const consumedKg = availCases>0 ? r4(availKg * (casesOut/availCases)) : availKg;
        const remCases = r4(availCases - casesOut);
        const remKg    = r4(Math.max(0, availKg - consumedKg));
        const fully    = remCases <= 1e-6;

        // 1) draw down source
        const upd = fully
          ? { cases:0, loose:0, total_qty:0, status:"reglazed_out" }
          : { cases:remCases, total_qty:remKg };
        const { error:e1 } = await db.client.from("stock").update(upd).eq("id", src.id);
        if(e1) throw e1;

        // 2) reglazed output as a new on-hand line
        const outRow = await DB().insert("stock", {
          pallet_no: src.pallet_no, prod_date: src.prod_date, item: src.item,
          grade: src.grade, brand: src.brand, b_count: src.b_count,
          glaze_grp: glazeOut, a_glaze: aGlaze, a_count: src.a_count,
          packing: src.packing, wt_per_case_kg: src.wt_per_case_kg,
          cases: casesOut, loose: null, location: (fLoc.value||"").trim()||null,
          rack: (fRack.value||"").trim()||null, total_qty: kgOut, status:"on_hand",
          notes: "Reglazed from "+(src.glaze_grp||"?")+(src.pallet_no?(" · plt "+src.pallet_no):""),
        });

        // 3) audit transaction
        await DB().insert("inventory_transactions", {
          txn_type:"reglaze", source_stock_id: src.id,
          glaze_before: src.glaze_grp||null, glaze_after: glazeOut,
          product: src.item, qty_cases: casesOut, qty_kg: kgOut,
          lot_number: (fLot.value||"").trim()||null,
          notes: (fNotes.value||"").trim()||null,
        });

        toast("Reglaze recorded ✓  "+cs(casesOut)+" → "+glazeOut, "ok");
        App.home();
      }catch(e){
        btn.disabled=false; btn.textContent="Record reglaze";
        errEl.textContent = "Could not save: "+(e.message||e); errEl.classList.remove("hidden");
      }
    });
  }
})();
