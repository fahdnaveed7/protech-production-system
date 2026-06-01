/* =====================================================================
   Protech PWA — stage views (registered on App.views)
   Loaded after the core shell. Each renderer: fn(host, App).
   ===================================================================== */
(function(){
  "use strict";
  const App = window.App;
  if(!App){ console.error("views.js loaded before App"); return; }
  const DB = ()=> window.PROTECH_DB;

  // ---------- tiny DOM helpers ----------
  function el(tag, attrs, children){
    const n = document.createElement(tag);
    if(attrs) for(const k in attrs){
      if(k==="class") n.className = attrs[k];
      else if(k==="html") n.innerHTML = attrs[k];
      else if(k==="text") n.textContent = attrs[k];
      else if(k.startsWith("on") && typeof attrs[k]==="function") n.addEventListener(k.slice(2), attrs[k]);
      else if(attrs[k]!=null) n.setAttribute(k, attrs[k]);
    }
    if(children) (Array.isArray(children)?children:[children]).forEach(c=>{
      if(c==null) return;
      n.appendChild(typeof c==="string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  App.ui = { el };

  function notConnected(host, what){
    host.appendChild(el("div",{class:"card"},
      el("div",{class:"stub"},[
        el("div",{class:"big",text:"📡"}),
        el("div",{style:"font-weight:600;color:var(--ink)",text:"Not connected to data"}),
        el("div",{text:"This view needs the Supabase connection. Status: "+(DB()?DB().status:"none")+". "+(what||"")}),
      ])));
  }
  App.ui.notConnected = notConnected;

  function emptyState(host, icon, title, sub){
    host.appendChild(el("div",{class:"card"},
      el("div",{class:"stub"},[
        el("div",{class:"big",text:icon}),
        el("div",{style:"font-weight:600;color:var(--ink)",text:title}),
        sub?el("div",{text:sub}):null,
      ])));
  }
  App.ui.emptyState = emptyState;

  function loading(host, label){
    const n = el("div",{class:"card"}, el("div",{class:"stub"},[
      el("div",{class:"big",text:"⏳"}), el("div",{text:label||"Loading…"})]));
    host.appendChild(n); return n;
  }
  App.ui.loading = loading;

  // ===================================================================
  //  Step 3 — PRODUCTION PLAN DASHBOARD (live progress)
  // ===================================================================
  App.views.plan = async function(host){
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    const spin = loading(host, "Loading production plan…");
    try{
      const [plans, packing] = await Promise.all([
        db.list("production_plans", { order:"created_at", ascending:false, limit:100 }),
        db.list("packing_status",   { order:"recorded_at", ascending:false, limit:300 }),
      ]);
      spin.remove();

      if(!plans.length){
        return emptyState(host,"📋","No production plans yet",
          App.role.id==="production" ? "Add today's plan from the Daily Plan task." : "Production hasn't posted a plan yet.");
      }

      // latest packing row per lot_number+buyer
      const packKey = (l,b)=> (l||"")+"|"+(b||"");
      const latestPack = {};
      packing.forEach(p=>{ const k=packKey(p.lot_number,p.buyer); if(!(k in latestPack)) latestPack[k]=p; });

      // ---- aggregate summary ----
      let totTargetKg=0, totCases=0, totPacked=0;
      plans.forEach(pl=>{
        totTargetKg += Number(pl.target_kg)||0;
        const pk = latestPack[packKey(pl.lot_number, pl.buyer)];
        if(pk){ totCases += Number(pk.cases_target)||0; totPacked += Number(pk.cases_packed)||0; }
      });
      const pct = totCases>0 ? Math.round(totPacked/totCases*100) : 0;

      const summary = el("div",{class:"card",style:"margin-bottom:16px"},[
        el("div",{style:"display:flex; flex-wrap:wrap; gap:18px; align-items:center; justify-content:space-between"},[
          el("div",{},[
            el("div",{style:"font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px",text:"Today across all buyers"}),
            el("div",{style:"font-size:26px;font-weight:700",text:pct+"% packed"}),
            el("div",{style:"font-size:13px;color:var(--muted)",text:`${totPacked} / ${totCases||"—"} cases · ${plans.length} plan line${plans.length>1?"s":""} · ${totTargetKg||0} kg target`}),
          ]),
        ]),
        progressBar(pct),
      ]);
      host.appendChild(summary);

      // ---- per-plan cards ----
      const wrap = el("div",{style:"display:flex; flex-direction:column; gap:12px"});
      plans.forEach(pl=>{
        const pk = latestPack[packKey(pl.lot_number, pl.buyer)];
        const cp = pk ? Number(pk.cases_packed)||0 : 0;
        const ct = pk ? Number(pk.cases_target)||0 : 0;
        const p = ct>0 ? Math.round(cp/ct*100) : 0;
        const card = el("div",{class:"card"},[
          el("div",{style:"display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap"},[
            el("div",{},[
              el("div",{style:"display:flex; align-items:center; gap:8px; flex-wrap:wrap"},[
                el("span",{style:"font-weight:700;font-size:16px",text:pl.lot_number||"—"}),
                pl.buyer?el("span",{class:"chip",text:pl.buyer}):null,
              ]),
              el("div",{style:"font-size:13px;color:var(--muted);margin-top:4px",
                text:[pl.target_count?("Count "+pl.target_count):null,
                      pl.target_kg?(pl.target_kg+" kg"):null,
                      pl.workforce?(pl.workforce+" workers"):null].filter(Boolean).join(" · ") || "—"}),
              pl.remarks?el("div",{style:"font-size:12px;color:var(--muted);margin-top:4px",text:pl.remarks}):null,
            ]),
            el("div",{style:"text-align:right"},[
              el("div",{style:"font-size:20px;font-weight:700;color:"+(p>=100?"var(--success)":"var(--ink)"),text:p+"%"}),
              el("div",{style:"font-size:12px;color:var(--muted)",text:pk?`${cp}/${ct} cases`:"no packing yet"}),
            ]),
          ]),
          progressBar(p),
        ]);
        wrap.appendChild(card);
      });
      host.appendChild(wrap);
    }catch(e){
      spin.remove();
      emptyState(host,"⚠️","Could not load plan", String(e.message||e));
    }
  };

  function progressBar(pct){
    pct = Math.max(0, Math.min(100, pct||0));
    const fillColor = pct>=100 ? "var(--success)" : "var(--primary)";
    return el("div",{style:"margin-top:14px"},
      el("div",{style:"height:10px;border-radius:999px;background:#eef2f6;overflow:hidden"},
        el("div",{style:`height:100%;width:${pct}%;background:${fillColor};border-radius:999px;transition:width .4s`})));
  }
  App.ui.progressBar = progressBar;

  // ===================================================================
  //  Lightbox (tap a photo to view full size)
  // ===================================================================
  function lightbox(url){
    const box = el("div",{class:"lightbox", onclick:()=>box.remove()},[
      el("button",{class:"x", text:"✕"}),
      el("img",{src:url, alt:"photo"}),
    ]);
    document.body.appendChild(box);
  }
  App.ui.lightbox = lightbox;

  // ===================================================================
  //  Step 4 — LOT LIST + LOT-DETAIL TIMELINE (inline photos per stage)
  // ===================================================================
  App.views.lots = async function(host){
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    const spin = loading(host, "Loading lots…");
    try{
      const lots = await db.listLots();
      spin.remove();
      if(!lots.length) return emptyState(host,"🦐","No lots yet","Create the first lot from RM Receiving → New Lot.");
      renderLotList(host, lots);
    }catch(e){ spin.remove(); emptyState(host,"⚠️","Could not load lots", String(e.message||e)); }
  };

  function renderLotList(host, lots){
    host.innerHTML = "";
    const search = el("input",{class:"search", type:"search", placeholder:"Search lot number, product, market…"});
    host.appendChild(search);
    const list = el("div",{style:"display:flex; flex-direction:column; gap:10px"});
    host.appendChild(list);

    function draw(filter){
      list.innerHTML = "";
      const f = (filter||"").trim().toLowerCase();
      const rows = lots.filter(l=> !f ||
        [l.lot_number,l.product,l.market,l.species].some(v=> (v||"").toLowerCase().includes(f)));
      if(!rows.length){ list.appendChild(el("div",{class:"none-fields",style:"padding:8px",text:"No lots match."})); return; }
      rows.forEach(l=>{
        const meta = [l.species, l.product, l.market, l.intake_date].filter(Boolean).join(" · ");
        list.appendChild(el("button",{class:"lotrow", onclick:()=>openLot(host, l.lot_number)},[
          el("div",{},[
            el("div",{class:"ln"},[ l.lot_number,
              l.status?el("span",{class:"chip gray",style:"margin-left:8px",text:l.status}):null ]),
            el("div",{class:"meta",text:meta||"—"}),
          ]),
          el("span",{class:"arr",html:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'}),
        ]));
      });
    }
    search.addEventListener("input", ()=>draw(search.value));
    draw("");
  }

  // ---- stage map (temp_logs/qc_logs routed by their `stage` column) ----
  const STAGES = [
    { key:"intake",   icon:"🚚", name:"Raw Material Intake",            tables:["lot_grades","shed_receipts"] },
    { key:"peeling",  icon:"✂️", name:"Peeling",                        tables:["peeling_shed_reports","peeling_output"] },
    { key:"treatment",icon:"🧪", name:"Treatment / Soaking",            tables:["treatment_logs"] },
    { key:"freezing", icon:"❄️", name:"Production / Freezing",          tables:["production_plans","machine_events"], temp:["freezing"] },
    { key:"qc",       icon:"🔬", name:"Production-Line QC",             tables:["online_inspection"], temp:["qc"], qc:["depanning","repacking"] },
    { key:"stuffing", icon:"🧊", name:"Repacking / Stuffing / Dispatch",tables:["packing_status","inventory_transactions"], temp:["stuffing"], qc:["stuffing"] },
  ];

  async function openLot(host, lotNumber){
    host.innerHTML = "";
    host.appendChild(el("button",{class:"back", onclick:()=>App.views.lots(host),
      html:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg> All lots'}));
    const spin = loading(host, "Building lot timeline…");
    const db = DB();
    try{
      const lot = await db.getLot(lotNumber);
      const [grades, shedRcpt, shedRep, peelOut, treat, plans, machine, temps, oirSamples, qc, packing, inv] =
        await Promise.all([
          db.listByLot("lot_grades", lotNumber),
          db.listByLot("shed_receipts", lotNumber),
          db.listByLot("peeling_shed_reports", lotNumber),
          db.listByLot("peeling_output", lotNumber),
          db.listByLot("treatment_logs", lotNumber),
          db.listByLot("production_plans", lotNumber),
          db.listByLot("machine_events", lotNumber),
          db.listByLot("temp_logs", lotNumber),
          db.listByLot("online_inspection_samples", lotNumber),  // samples carry lot_number
          db.listByLot("qc_logs", lotNumber),
          db.listByLot("packing_status", lotNumber),
          db.listByLot("inventory_transactions", lotNumber),
        ]);
      // inspection report headers have no lot_number — resolve via the samples' report_id
      const repIds = [...new Set(oirSamples.map(s=>s.report_id).filter(Boolean))];
      let oirReports = [];
      if(repIds.length){
        const { data } = await db.client.from("online_inspection_reports").select("*").in("id", repIds);
        oirReports = data || [];
      }
      spin.remove();

      // lot header
      const tags = [lot&&lot.species, lot&&lot.product, lot&&lot.market].filter(Boolean)
        .map(t=>el("span",{class:"chip",text:t}));
      if(lot&&lot.status) tags.push(el("span",{class:"chip gray",text:lot.status}));
      host.appendChild(el("div",{class:"lothead"},[
        el("div",{class:"big",text:lotNumber}),
        el("div",{class:"tags"}, tags),
        el("div",{style:"font-size:13px;color:var(--muted)",
          text:[lot&&lot.intake_date?("Intake "+lot.intake_date):null, lot&&lot.truck_plate].filter(Boolean).join(" · ")}),
        el("a",{class:"trace-link", href:"trace.html?lot="+encodeURIComponent(lotNumber), target:"_blank", rel:"noopener",
          html:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 21v.01M21 14v.01M14 21v.01"/></svg> Public trace page + QR'}),
      ]));

      // bucket data per stage
      const tempByStage = {}; temps.forEach(t=>{ (tempByStage[t.stage||"freezing"]=tempByStage[t.stage||"freezing"]||[]).push(t); });
      const qcByStage = {};   qc.forEach(q=>{ (qcByStage[q.stage||"qc"]=qcByStage[q.stage||"qc"]||[]).push(q); });
      const samplesByReport = {}; oirSamples.forEach(s=>{ (samplesByReport[s.report_id]=samplesByReport[s.report_id]||[]).push(s); });

      const dataFor = {
        lot_grades:grades, shed_receipts:shedRcpt, peeling_shed_reports:shedRep,
        peeling_output:peelOut, treatment_logs:treat, production_plans:plans,
        machine_events:machine, packing_status:packing, inventory_transactions:inv,
      };

      const tl = el("div",{class:"tl"});
      STAGES.forEach(stage=>{
        const entries = [];
        stage.tables.forEach(tbl=>{
          if(tbl==="online_inspection"){
            oirReports.forEach(rep=> entries.push(fmtInspection(rep, samplesByReport[rep.id]||[])));
          } else {
            (dataFor[tbl]||[]).forEach(row=> entries.push(FMT[tbl](row)));
          }
        });
        (stage.temp||[]).forEach(s=> (tempByStage[s]||[]).forEach(t=> entries.push(FMT.temp_logs(t))));
        (stage.qc||[]).forEach(s=> (qcByStage[s]||[]).forEach(q=> entries.push(FMT.qc_logs(q))));

        const done = entries.length>0;
        const stageEl = el("div",{class:"tl-stage"+(done?" done":"")},[
          el("div",{class:"tl-dot",text:stage.icon}),
          el("h3",{text:stage.name}),
          el("div",{class:"cnt",text: done ? (entries.length+" record"+(entries.length>1?"s":"")) : "No records yet"}),
        ]);
        entries.forEach(en=> stageEl.appendChild(renderEntry(en)));
        tl.appendChild(stageEl);
      });
      host.appendChild(tl);
    }catch(e){
      spin.remove();
      host.appendChild(el("div",{class:"none-fields",style:"padding:8px",text:"Could not load lot: "+String(e.message||e)}));
    }
  }
  App.openLot = (lotNumber)=>{ /* convenience for other views */ const m=document.getElementById("main"); m.innerHTML=""; const h=el("div"); m.appendChild(h); openLot(h, lotNumber); };

  // ---- entry rendering ----
  function renderEntry(en){
    const node = el("div",{class:"entry"});
    node.appendChild(el("div",{class:"et"},[
      el("span",{}, [en.title, en.fmt?el("span",{class:"fmt-tag",text:en.fmt}):null]),
      en.when?el("span",{class:"ew",text:en.when}):null,
    ]));
    const fields = (en.fields||[]).filter(f=> f[1]!=null && f[1]!=="" );
    if(fields.length){
      const dl = el("dl",{class:"kv"});
      fields.forEach(([k,v])=>{ dl.appendChild(el("dt",{text:k})); dl.appendChild(el("dd",{text:String(v)})); });
      node.appendChild(dl);
    }
    const photos = (en.photos||[]).filter(Boolean);
    if(photos.length){
      const tw = el("div",{class:"thumbs"});
      photos.forEach(u=> tw.appendChild(el("img",{class:"thumb", src:u, loading:"lazy", alt:"photo", onclick:()=>lightbox(u)})));
      node.appendChild(tw);
    }
    if(!fields.length && !photos.length) node.appendChild(el("div",{class:"none-fields",text:"Recorded."}));
    return node;
  }

  // ---- helpers for formatters ----
  function whenOf(row){
    const t = row.recorded_at || row.start_at || row.created_at || row.date;
    if(!t) return "";
    const d = new Date(t);
    if(isNaN(d)) return String(t);
    return d.toLocaleString(undefined,{ month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
  }
  const F = (label,val)=>[label,val];
  function dur(sec){
    if(sec==null) return null;
    const m=Math.floor(sec/60), s=sec%60, h=Math.floor(m/60);
    return h>0 ? `${h}h ${m%60}m` : (m>0 ? `${m}m ${s}s` : `${s}s`);
  }
  function additivesList(r){
    const a=[]; if(r.additive_stpp_np)a.push("STPP/NP"); if(r.additive_paprika)a.push("Paprika"); if(r.additive_salt)a.push("Salt");
    return a.length?a.join(", "):null;
  }

  // ---- per-table formatters → {title, when, fmt, fields, photos} ----
  const FMT = {
    lot_grades:(r)=>({ title:"Grade "+(r.grade||"—"), when:whenOf(r), fields:[
      F("Count/kg",r.count_per_kg), F("Boxes",r.boxes), F("Qty (kg)",r.qty_kg)] }),
    shed_receipts:(r)=>({ title:"Shed Receipt"+(r.shed_name?" — "+r.shed_name:""), when:whenOf(r), fields:[
      F("Contact",r.shed_contact), F("Species",r.species), F("Header count",r.header_count),
      F("Total boxes",r.total_boxes), F("Total kg",r.total_kg), F("Notes",r.notes)], photos:[r.photo_url] }),
    peeling_shed_reports:(r)=>({ title:"Peeling Shed Report", when:whenOf(r), fields:[
      F("Report no",r.report_no), F("Species",r.species),
      F("Input",[r.input_count,r.input_qty_kg?r.input_qty_kg+" kg":null].filter(Boolean).join(" · ")||null),
      F("Converted",[r.converted_count,r.converted_qty_kg?r.converted_qty_kg+" kg":null].filter(Boolean).join(" · ")||null),
      F("Yield %",r.yield_pct), F("Time",[r.time_start,r.time_finish].filter(Boolean).join(" – ")||null),
      F("Section i/c",r.section_in_charge), F("Production i/c",r.production_in_charge), F("Remarks",r.remarks)],
      photos:[r.photo_url] }),
    peeling_output:(r)=>({ title:"Peeling Output"+(r.source?" — "+r.source:""), when:whenOf(r), fields:[
      F("Input",[r.input_count,r.input_qty_kg?r.input_qty_kg+" kg":null].filter(Boolean).join(" · ")||null),
      F("Converted",[r.converted_count,r.converted_qty_kg?r.converted_qty_kg+" kg":null].filter(Boolean).join(" · ")||null),
      F("Yield %",r.yield_pct), F("Boxes",r.boxes),
      F("Time",[r.time_start,r.time_finish].filter(Boolean).join(" – ")||null), F("Remarks",r.remarks)] }),
    treatment_logs:(r)=>({ title:"Treatment — Tub "+(r.tub_no||"—"), fmt:"FMT POF/PC/004", when:whenOf(r), fields:[
      F("Shift",r.shift), F("Product",r.product), F("Species",r.species), F("Grade",r.grade),
      F("pH",r.ph_solution), F("Weight (kg)",r.weight_kg),
      F("Count before",r.count_before_soak), F("Count after",r.count_after_soak), F("% gain",r.pct_gain),
      F("Soak in",r.soak_in_time), F("Soak out",r.soak_out_time),
      F("Soln temp (1/2/3h)",[r.soln_temp_hr1,r.soln_temp_hr2,r.soln_temp_hr3].some(v=>v!=null)?[r.soln_temp_hr1,r.soln_temp_hr2,r.soln_temp_hr3].map(v=>v==null?"–":v).join(" / "):null),
      F("Additives",additivesList(r)),
      F("Chemical/Salt/Colour ID",[r.chemical_id,r.salt_id,r.colour_id].some(Boolean)?[r.chemical_id||"–",r.salt_id||"–",r.colour_id||"–"].join(" / "):null),
      F("Checked by",r.checked_by), F("Verified by",r.verified_by)] }),
    production_plans:(r)=>({ title:"Production Plan"+(r.buyer?" — "+r.buyer:""), when:whenOf(r), fields:[
      F("Target count",r.target_count), F("Target kg",r.target_kg), F("Workforce",r.workforce), F("Remarks",r.remarks)] }),
    machine_events:(r)=>({ title:(machineName(r.machine_type))+(r.load_no?" (Load "+r.load_no+")":""), when:whenOf(r), fields:[
      F("Start",fmtTime(r.start_at)), F("Stop",fmtTime(r.stop_at)), F("Duration",dur(r.duration_seconds)), F("Remarks",r.remarks)] }),
    temp_logs:(r)=>({ title:(pointName(r.point))+" temperature", when:whenOf(r), fields:[
      F("Temp (°C)",r.temp_c)], photos:[r.photo_url] }),
    qc_logs:(r)=>({ title:"QC — "+(stageName(r.stage)), when:whenOf(r), fields:[
      F("Block setting",r.block_setting), F("Core temp before",r.core_temp_before), F("Core temp after",r.core_temp_after),
      F("Buyer",r.buyer), F("Glaze %",r.glaze_pct),
      F("Filling weight",[r.filling_weight_min,r.filling_weight_max].some(v=>v!=null)?`${r.filling_weight_min??"–"}–${r.filling_weight_max??"–"} g`:null),
      F("Rider inserted",r.rider_inserted==null?null:(r.rider_inserted?"Yes":"No")),
      F("Stuffing temp (°C)",r.stuffing_temp_c), F("Notes",r.notes)], photos:[r.photo_url] }),
    packing_status:(r)=>({ title:"Packing"+(r.buyer?" — "+r.buyer:""), when:whenOf(r), fields:[
      F("Cases packed",r.cases_packed), F("Cases target",r.cases_target), F("Packets",r.packets)] }),
    inventory_transactions:(r)=>({ title:(txnName(r.txn_type)), when:whenOf(r), fields:[
      F("Product",r.product), F("Buyer",r.buyer), F("Cases",r.qty_cases), F("Kg",r.qty_kg),
      F("Container",r.container_no), F("Dispatch date",r.dispatch_date), F("Notes",r.notes)] }),
  };

  function fmtInspection(rep, samples){
    // summarise defects across samples
    const defectCols = {
      defect_freezer_burn:"Freezer burn", defect_deterioration:"Deterioration", defect_discolouration:"Discolouration",
      defect_dehydration:"Dehydration", defect_black_spot:"Black spot", defect_black_ring:"Black ring",
      defect_broken:"Broken", defect_damaged_bruised:"Damaged/bruised", defect_vein:"Vein",
      defect_loose_shell:"Loose shell", defect_soft_shell:"Soft shell", defect_semi_peeled:"Semi-peeled",
      defect_clumps:"Clumps", defect_foreign_matter:"Foreign matter", defect_foreign_veg_matter:"Foreign veg matter",
    };
    const totals = {};
    samples.forEach(s=>{ for(const k in defectCols){ const v=Number(s[k])||0; if(v) totals[k]=(totals[k]||0)+v; } });
    const defectSummary = Object.keys(totals).map(k=> defectCols[k]+" "+totals[k]).join(", ") || "None recorded";
    const cases = samples.reduce((a,s)=>a+(Number(s.no_of_cases)||0),0);
    return { title:"Online Inspection"+(rep.market?" — "+rep.market:""), when:whenOf(rep), fields:[
      F("Target glaze %",rep.target_glaze_pct), F("Shift",rep.shift),
      F("Samples",samples.length||null), F("Cases",cases||null),
      F("Defects",defectSummary), F("Checked by",rep.checked_by), F("Verified by",rep.verified_by)] };
  }

  function fmtTime(t){ if(!t) return null; const d=new Date(t); return isNaN(d)?String(t):d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}); }
  function machineName(m){ return ({ice:"Ice machine",plate_freezer:"Plate freezer",tunnel:"Tunnel",iqf_infeed:"IQF infeed"})[m]||m||"Machine"; }
  function pointName(p){ return ({iqf_infeed:"IQF infeed",tunnel:"Tunnel",core_before:"Core (before)",core_after:"Core (after)",stuffing:"Stuffing"})[p]||p||"Point"; }
  function stageName(s){ return ({depanning:"Depanning",repacking:"Repacking",stuffing:"Stuffing"})[s]||s||"QC"; }
  function txnName(t){ return ({in:"Inventory in",dispatch:"Dispatch",reglaze:"Reglaze"})[t]||t||"Transaction"; }
})();
