/* =====================================================================
   Protech PWA — stage data-entry forms (Step 5)
   Registered on App.views. Loaded after views.js.
   Each digital form mirrors its paper form: same field order, labels,
   and FMT number. yield% / soak / glaze / gain are ENTERED (plain
   number inputs), never auto-calculated. Machine duration IS derived.
   Manager (view-only) gets read-only summary views, never a form.
   ===================================================================== */
(function(){
  "use strict";
  const App = window.App;
  if(!App){ console.error("forms.js loaded before App"); return; }
  const DB = ()=> window.PROTECH_DB;
  const el = App.ui.el;
  const { notConnected, emptyState, loading, lightbox } = App.ui;

  const today = ()=> new Date().toISOString().slice(0,10);
  const yy = ()=> new Date().getFullYear().toString().slice(-2);

  // ---------- toast ----------
  function toast(msg, kind){
    const t = el("div",{class:"toast"+(kind?" "+kind:""), text:msg});
    document.body.appendChild(t);
    requestAnimationFrame(()=> t.classList.add("show"));
    setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),320); }, 2600);
  }
  App.ui.toast = toast;

  // ---------- single field ----------
  function makeField(def, ctx){
    if(def.type==="checks"){
      const wrap = el("div",{class:"fld full"});
      wrap.appendChild(el("label",{text:def.label}));
      const row = el("div",{class:"checks"});
      const setters = {}, itemNodes = {};
      const truthy = (val)=> val===true || val==="true" || val===1 || val==="1" ||
                             (typeof val==="string" && /^(y|yes|✓|tick|present)$/i.test(val.trim()));
      const boxes = def.items.map(it=>{
        const cb = el("input",{type:"checkbox"});
        const lab = el("label",{class:"chk"},[cb, document.createTextNode(" "+it.label)]);
        cb.addEventListener("change", ()=> lab.classList.toggle("on", cb.checked));
        // scan / edit: set this single additive's checkbox by its column key
        setters[it.k] = (val)=>{ const on = truthy(val); cb.checked = on; lab.classList.toggle("on", on); };
        itemNodes[it.k] = lab;   // amber-flag the specific additive, not the whole row
        row.appendChild(lab);
        return { k:it.k, cb };
      });
      wrap.appendChild(row);
      return { node:wrap, collect:(v)=> boxes.forEach(b=> v[b.k]=b.cb.checked), setters, itemNodes };
    }
    if(def.type==="computed"){
      const wrap = el("div",{class:"fld"+(def.full?" full":"")});
      wrap.appendChild(el("label",{text:def.label}));
      const out = el("div",{style:"font-size:20px;font-weight:800;color:var(--primary-dark);padding:8px 0;letter-spacing:.5px"});
      wrap.appendChild(out);
      return { node:wrap, recompute:(v)=>{ out.textContent = def.fn(v) || "—"; } };
    }
    const wrap = el("div",{class:"fld"+(def.entered?" entered":"")+(def.full?" full":"")});
    wrap.appendChild(el("label",{text:def.label}));

    if(def.type==="photo"){
      const file = el("input",{type:"file", accept:"image/*", capture:"environment", style:"display:none"});
      const prev = el("img",{class:"photo-prev hidden", alt:"preview"});
      const pick = el("button",{class:"photo-pick", type:"button", text:"📷 Take / choose photo",
        onclick:()=> file.click()});
      file.addEventListener("change", ()=>{
        const f = file.files[0];
        if(f){ prev.src = URL.createObjectURL(f); prev.classList.remove("hidden"); pick.textContent="📷 Change photo"; }
      });
      wrap.appendChild(el("div",{class:"photo-field"},[pick, prev, file]));
      // set(url) shows an already-stored image (edit prefill / re-used scan shot)
      const setPhoto = (url)=>{ if(url){ prev.src=url; prev.classList.remove("hidden"); pick.textContent="📷 Change photo"; } };
      return { node:wrap, k:def.k, file:()=> file.files[0]||null, set:setPhoto };
    }

    let input;
    if(def.type==="select" || def.type==="lot"){
      input = el("select");
      let opts;
      if(def.type==="lot"){
        opts = [{v:"",label:"Select lot…"}].concat((ctx.lots||[]).map(l=>({
          v:l.lot_number, label:l.lot_number + (l.product?" · "+l.product:(l.species?" · "+l.species:"")) })));
      } else {
        opts = [{v:"",label:def.placeholder||"Select…"}].concat((def.options||[]).map(o=>
          typeof o==="string" ? {v:o,label:o} : o));
      }
      opts.forEach(o=> input.appendChild(el("option",{value:o.v}, o.label)));
      if(def.default!=null) input.value = def.default;
    } else if(def.type==="textarea"){
      input = el("textarea",{placeholder:def.placeholder||"", rows:"3"});
      if(def.default!=null) input.value = def.default;
    } else {
      const t = def.type==="number" ? "number"
              : def.type==="date" ? "date"
              : def.type==="time" ? "time"
              : def.type==="datetime" ? "datetime-local" : "text";
      input = el("input",{type:t, placeholder:def.placeholder||""});
      if(def.type==="number"){ input.setAttribute("inputmode","decimal"); input.step = def.step||"any"; }
      if(def.default!=null) input.value = def.default;
    }
    wrap.appendChild(input);
    if(def.hint) wrap.appendChild(el("div",{class:"hint",text:def.hint}));

    const collect = (v)=>{
      let val = input.value;
      if(typeof val==="string") val = val.trim();
      if(val==="" || val==null){ v[def.k]=null; return; }
      if(def.type==="number") v[def.k] = Number(val);
      else if(def.type==="datetime") v[def.k] = new Date(val).toISOString();
      else v[def.k] = val;
    };
    // set(val) prefills a field for scan / edit. Mirrors collect's coercions.
    const set = (val)=>{
      if(val==null){ input.value=""; return; }
      if(def.type==="datetime"){
        try{ input.value = new Date(val).toISOString().slice(0,16); }catch(_){ input.value = String(val); }
      } else {
        input.value = String(val);
      }
      // notify any computed fields listening on the form
      input.dispatchEvent(new Event("change", { bubbles:true }));
    };
    return { node:wrap, k:def.k, collect, set };
  }

  // ---------- generic single-table form ----------
  // opts: {title, fmt, table, stage, fields[], prepare, submitLabel, successMsg, needLots, intro}
  function formView(opts){
    return async function(host){
      const db = DB();
      if(!db || !db.isOnline()) return notConnected(host);
      let lots = [];
      if(opts.needLots !== false){ try{ lots = await db.listLots(); }catch(_){} }
      // Edit mode: scan.js hands us a saved row to reopen via App.scan.pendingEdit.
      let editRow = null;
      if(App.scan && App.scan.pendingEdit && opts.formType &&
         App.scan.pendingEdit.formType === opts.formType){
        editRow = App.scan.pendingEdit.row;
        App.scan.pendingEdit = null;
      }
      buildForm(host, opts, lots, editRow);
    };
  }

  const SCAN_CFG = ()=> (window.PROTECH_CONFIG && window.PROTECH_CONFIG.SCAN) || {};
  const scanReady = (opts)=> !!(opts.formType && App.scan && App.scan.enabled() &&
                               App.scan.CLIENT_REGISTRY[opts.formType]);

  function buildForm(host, opts, lots, editRow){
    host.innerHTML = "";
    const editing = !!(editRow && editRow.id);
    const card = el("div",{class:"card"});
    const form = el("div",{class:"form"});
    form.appendChild(el("div",{class:"form-head"},[
      el("h3",{text:opts.title}),
      opts.fmt ? el("span",{class:"fmt",text:opts.fmt}) : null,
    ]));
    if(opts.intro) form.appendChild(el("div",{class:"hint",style:"margin:-6px 0 14px;text-transform:none",text:opts.intro}));

    const errEl = el("div",{class:"err-msg hidden"});

    // ---- Scan / Edit bar (only when this form is scan-enabled) ----
    let scanInput = null, scanBtn = null;
    if(scanReady(opts)){
      const bar = el("div",{class:"scan-bar"});
      scanInput = el("input",{type:"file", accept:"image/*", style:"display:none"});
      scanBtn = el("button",{class:"btn btn-scan", type:"button",
        text:"📸 Scan or upload sheet", onclick:()=> scanInput.click()});
      bar.appendChild(scanInput);
      bar.appendChild(scanBtn);
      if(!editing){
        bar.appendChild(el("button",{class:"btn btn-ghost", type:"button",
          text:"✏️ Edit saved", onclick:()=> App.scan.listView(opts.formType)}));
      }
      form.appendChild(bar);
      form.appendChild(el("div",{class:"hint",style:"margin:-4px 0 12px;text-transform:none",
        text: editing
          ? "Editing a saved record — Save updates it in place."
          : "Photograph the sheet to auto-fill, then check anything highlighted amber."}));
    }
    if(editing && !scanReady(opts)){
      form.appendChild(el("div",{class:"hint",style:"margin:-6px 0 12px;text-transform:none",
        text:"Editing a saved record — Save updates it in place."}));
    }

    const grid = el("div",{class:"fgrid"});
    const collectors=[], fileFields=[], computeds=[];
    const setters = {};   // column -> set(val)
    const nodes   = {};   // column -> field DOM node (for amber low-conf marking)
    opts.fields.forEach(def=>{
      const f = makeField(def, { lots });
      grid.appendChild(f.node);
      if(def.k) nodes[def.k] = f.node;
      if(f.set) setters[def.k] = f.set;
      if(f.setters) Object.assign(setters, f.setters);     // multi-key (checks)
      if(f.itemNodes) Object.assign(nodes, f.itemNodes);   // per-item amber target
      if(f.collect) collectors.push(f.collect);
      if(f.file) fileFields.push({ k:def.k, read:f.file });
      if(f.recompute) computeds.push(f.recompute);
    });
    form.appendChild(grid);
    form.appendChild(errEl);

    const btn = el("button",{class:"btn btn-primary",
      text: opts.submitLabel || (editing ? "Update record" : "Save record")});
    const cancel = el("button",{class:"btn btn-ghost", text:"Cancel", onclick:()=> App.home()});
    form.appendChild(el("div",{class:"form-actions"},[cancel, btn]));
    card.appendChild(form);
    host.appendChild(card);

    if(computeds.length){
      const run = ()=>{ const v={}; collectors.forEach(c=>c(v)); computeds.forEach(rc=>rc(v)); };
      form.addEventListener("input", run);
      form.addEventListener("change", run);
      run();
    }

    // Per-save scan/edit state.
    let extraction = null;   // { source_photo_url, extraction_json, extraction_confidence }
    let scanned = false;     // a fresh scan filled this form

    // ---- prefill on edit ----
    if(editing){
      Object.keys(setters).forEach(k=>{ if(editRow[k]!=null) setters[k](editRow[k]); });
    }

    // ---- apply an extraction result to the fields ----
    function applyExtraction(res){
      const fields = res.fields || {};
      const conf   = res.confidence || {};
      const thr    = App.scan.threshold();
      Object.keys(setters).forEach(k=>{
        nodes[k] && nodes[k].classList.remove("lowconf");
        if(k in fields && fields[k]!=null && fields[k]!==""){
          setters[k](fields[k]);
          const c = conf[k];
          if(typeof c==="number" && c < thr && nodes[k]) nodes[k].classList.add("lowconf");
        }
      });
      if(res.photo_url && setters.photo_url) setters.photo_url(res.photo_url);
      extraction = {
        source_photo_url: res.photo_url || null,
        extraction_json:  { fields, confidence: conf, raw_text: res.raw_text || "" },
        extraction_confidence: conf,
      };
      scanned = true;
    }

    if(scanInput){
      scanInput.addEventListener("change", async ()=>{
        const f = scanInput.files[0]; if(!f) return;
        errEl.classList.add("hidden");
        scanBtn.disabled = true; scanBtn.textContent = "📸 Reading…";
        try{
          const res = await App.scan.extract(opts.formType, f, { lot: null });
          applyExtraction(res);
          toast("Scanned — review highlighted fields", "ok");
          if(App.scan.autoCommit()) btn.click();   // TRIAL MODE: save immediately
        }catch(e){
          errEl.textContent = "Scan failed: " + (e.message||e);
          errEl.classList.remove("hidden");
        }finally{
          scanBtn.disabled = false; scanBtn.textContent = "📸 Scan or upload sheet";
          scanInput.value = "";
        }
      });
    }

    btn.addEventListener("click", async ()=>{
      errEl.classList.add("hidden");
      const values = {};
      collectors.forEach(c=> c(values));
      const missing = opts.fields.filter(d=> d.required && (values[d.k]==null || values[d.k]==="")).map(d=> d.label);
      if(missing.length){ errEl.textContent = "Please fill: " + missing.join(", "); errEl.classList.remove("hidden"); return; }

      btn.disabled = true; btn.textContent = editing ? "Updating…" : "Saving…";
      try{
        for(const ff of fileFields){
          const file = ff.read();
          if(file){
            const lotForPath = values.lot_number || opts.stage || "misc";
            values[ff.k] = await DB().uploadPhoto(file, lotForPath, opts.stage || opts.table);
          } else if(values[ff.k]==null){
            // keep the existing/scanned image when no new file is chosen
            if(editing && editRow[ff.k]!=null) values[ff.k] = editRow[ff.k];
            else if(extraction && ff.k==="photo_url" && extraction.source_photo_url) values[ff.k] = extraction.source_photo_url;
          }
        }
        const row = opts.prepare ? opts.prepare(values) : values;

        // ---- scan / edit audit metadata (only on scan-enabled forms) ----
        if(scanReady(opts)){
          if(editing){
            const prev = editRow.entry_mode || "manual";
            row.entry_mode = (prev === "manual") ? "manual" : "scan_edited";
          } else {
            row.entry_mode = scanned ? "scan" : "manual";
          }
          if(extraction){
            row.source_photo_url      = extraction.source_photo_url;
            row.extraction_json       = extraction.extraction_json;
            row.extraction_confidence = extraction.extraction_confidence;
          } else if(editing){
            // preserve the original audit trail when editing without re-scanning
            if(editRow.source_photo_url!=null)      row.source_photo_url      = editRow.source_photo_url;
            if(editRow.extraction_json!=null)       row.extraction_json       = editRow.extraction_json;
            if(editRow.extraction_confidence!=null) row.extraction_confidence = editRow.extraction_confidence;
          }
        }

        if(editing){
          const { error } = await DB().client.from(opts.table).update(row).eq("id", editRow.id);
          if(error) throw error;
        } else {
          await DB().insert(opts.table, row);
        }
        toast(opts.successMsg || (editing ? "Record updated ✓" : "Saved ✓"), "ok");
        App.home();
      }catch(e){
        btn.disabled = false; btn.textContent = opts.submitLabel || (editing ? "Update record" : "Save record");
        errEl.textContent = "Could not save: " + (e.message||e);
        errEl.classList.remove("hidden");
      }
    });
  }

  // Product codes mirror the LOT Analysis / lot_economics sheet so new lots
  // string-match the historical economics data. RAW = raw, BLC = blanched,
  // CKD = cooked; PD = peeled-deveined, PDT/ON = PD tail-on, PUD = peeled
  // undeveined, PVPD = PV peeled-deveined, HL = headless, H/ON = head-on,
  // ECPL = easy-peel.
  const PRODUCTS = [
    "RAW PD","RAW PDT/ON","RAW PUD","RAW PVPD","RAW HL","RAW H/ON","RAW ECPL",
    "BLC PD","BLC PDT/ON","BLC PUD","BLC HL","CKD PDT/ON",
  ];
  const SPECIES  = ["Vannamei","Black Tiger","Squid","Tuna","Mackerel","Seer Fish"];
  const SPECIES_CODES = { "Vannamei":"V", "Black Tiger":"BT", "Squid":"SQ", "Tuna":"TU", "Mackerel":"MK", "Seer Fish":"SF" };
  const speciesCode = (s)=> SPECIES_CODES[s] || (s? s.replace(/[^A-Za-z]/g,"").slice(0,2).toUpperCase() : null);
  // Shrimp species run the full line; everything else skips peeling + treatment.
  const SHRIMP_SPECIES = ["Vannamei","Black Tiger"];
  const isShrimp = (s)=> SHRIMP_SPECIES.indexOf(s) !== -1;
  const MARKETS  = ["Russia","China"];
  const SHIFTS   = [{v:"D",label:"Day"},{v:"N",label:"Night"}];

  function nextSeqFor(lots, year){
    let mx = 0;
    (lots||[]).forEach(l=>{ if(String(l.year||"")===String(year)){ const n=Number(l.lot_seq)||0; if(n>mx) mx=n; } });
    return mx + 1;
  }

  // ===================================================================
  //  RM RECEIVING (1111)
  // ===================================================================

  // New Lot — creates the lot with an auto-sequential code series/seq/year
  App.views.newlot = async function(host){
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    let lots = []; try{ lots = await db.listLots(); }catch(_){}
    const seq = nextSeqFor(lots, yy());
    buildForm(host, {
      title:"New Lot", stage:"intake", table:"lots", needLots:false,
      intro:"Lot code is series / sequence / year — e.g. 5/89/26. Sequence is suggested from existing lots; adjust if needed. Shrimp lots run the full line (peeling → treatment → freezing → QC → packing). Fish & squid lots skip peeling and treatment — go straight from intake to freezing.",
      successMsg:"Lot created ✓",
      submitLabel:"Create lot",
      fields:[
        { k:"series",  label:"Series",   type:"text",   default:"5", required:true },
        { k:"lot_seq", label:"Sequence", type:"number", step:"1", default:String(seq), required:true },
        { k:"year",    label:"Year (YY)",type:"text",   default:yy(), required:true },
        { k:"lot_number", label:"Lot code", type:"computed", full:true,
          fn:(v)=> (v.series||"?")+"/"+(v.lot_seq||"?")+"/"+(v.year||"?") },
        { k:"species", label:"Species", type:"select", options:SPECIES, default:"Vannamei", required:true,
          hint:"Vannamei / Black Tiger = shrimp (full line). Squid & fish skip peeling + treatment." },
        { k:"product", label:"Product", type:"select", options:PRODUCTS },
        { k:"market",  label:"Market",  type:"select", options:MARKETS },
        { k:"intake_date", label:"Intake date", type:"date", default:today() },
        { k:"truck_plate", label:"Truck plate", type:"text", placeholder:"KL-07-AB-1234" },
        { k:"remarks", label:"Remarks", type:"textarea", full:true },
      ],
      prepare:(v)=>({
        lot_number: (v.series||"")+"/"+(v.lot_seq||"")+"/"+(v.year||""),
        series:v.series, lot_seq:v.lot_seq, year:v.year,
        species:v.species, species_code:speciesCode(v.species), product:v.product, market:v.market,
        intake_date:v.intake_date, truck_plate:v.truck_plate, status:"open", remarks:v.remarks,
      }),
    }, lots);
  };

  // Truck Arrival — grade / count breakdown at intake (one grade row per save)
  App.views.arrival = formView({
    title:"Truck Arrival — Grade", stage:"intake", table:"lot_grades",
    intro:"Record one grade line per save. Repeat for each grade on the truck.",
    successMsg:"Grade line added ✓", submitLabel:"Add grade line",
    fields:[
      { k:"lot_number",  label:"Lot", type:"lot", required:true },
      { k:"grade",       label:"Grade / count", type:"text", placeholder:"e.g. 26/30" },
      { k:"count_per_kg",label:"Count / kg", type:"text", placeholder:"26/30" },
      { k:"boxes",       label:"Boxes", type:"number" },
      { k:"qty_kg",      label:"Qty (kg)", type:"number" },
    ],
  });

  // 5A — Peeling Shed Report
  App.views.shedrep = formView({
    title:"Peeling Shed Report", stage:"peeling", table:"peeling_shed_reports", fmt:"FORM 5A",
    formType:"peeling_shed_report",
    intro:"Shrimp lots only. Fish & squid lots skip peeling — leave this stage blank for them.",
    successMsg:"Shed report saved ✓",
    fields:[
      { k:"report_no",   label:"Report no", type:"text" },
      { k:"date",        label:"Date", type:"date", default:today() },
      { k:"lot_number",  label:"Lot", type:"lot", required:true },
      { k:"species",     label:"Species", type:"select", options:SPECIES, default:"Vannamei" },
      { k:"input_count", label:"Input count", type:"text", placeholder:"e.g. HO 30/40" },
      { k:"input_qty_kg",label:"Input qty (kg)", type:"number" },
      { k:"converted_count", label:"Converted count", type:"text" },
      { k:"converted_qty_kg",label:"Converted qty (kg)", type:"number" },
      { k:"yield_pct",   label:"Yield %", type:"number", entered:true, hint:"Measured on the floor — not auto-calculated" },
      { k:"time_start",  label:"Time start", type:"time" },
      { k:"time_finish", label:"Time finish", type:"time" },
      { k:"section_in_charge",   label:"Section in-charge", type:"text" },
      { k:"production_in_charge",label:"Production in-charge", type:"text" },
      { k:"remarks",     label:"Remarks", type:"textarea", full:true },
      { k:"photo_url",   label:"Photo of paper form", type:"photo", full:true },
    ],
  });

  // 5D — Shed Receipt (operational: header + scanned image)
  App.views.shedrcpt = formView({
    title:"Shed Receipt", stage:"intake", table:"shed_receipts", fmt:"FORM 5D",
    formType:"shed_receipt",
    intro:"Attach the scanned shed invoice. Costing stays operational in v1 — image is for reconciliation.",
    successMsg:"Shed receipt saved ✓",
    fields:[
      { k:"shed_name",   label:"Shed name", type:"text" },
      { k:"shed_contact",label:"Contact", type:"text" },
      { k:"date",        label:"Date", type:"date", default:today() },
      { k:"lot_number",  label:"Lot", type:"lot", required:true },
      { k:"species",     label:"Species", type:"select", options:SPECIES, default:"Vannamei" },
      { k:"header_count",label:"Header count", type:"text", placeholder:"26/30" },
      { k:"total_boxes", label:"Total boxes", type:"number" },
      { k:"total_kg",    label:"Total kg", type:"number" },
      { k:"notes",       label:"Notes", type:"textarea", full:true },
      { k:"photo_url",   label:"Scanned receipt", type:"photo", full:true },
    ],
  });

  // ===================================================================
  //  PEELING (2222)
  // ===================================================================
  App.views.peeling = formView({
    title:"Peeling Output", stage:"peeling", table:"peeling_output",
    intro:"Shrimp lots only. Fish & squid lots skip peeling — leave this stage blank for them.",
    successMsg:"Peeling output saved ✓",
    fields:[
      { k:"lot_number",  label:"Lot", type:"lot", required:true },
      { k:"source",      label:"Source", type:"text", placeholder:"Shed name or PPC (in-house)" },
      { k:"input_count", label:"Input count", type:"text" },
      { k:"input_qty_kg",label:"Input qty (kg)", type:"number" },
      { k:"converted_count", label:"Converted count", type:"text" },
      { k:"converted_qty_kg",label:"Converted qty (kg)", type:"number" },
      { k:"yield_pct",   label:"Yield %", type:"number", entered:true, hint:"Measured — not auto-calculated" },
      { k:"boxes",       label:"Boxes", type:"number" },
      { k:"time_start",  label:"Time start", type:"time" },
      { k:"time_finish", label:"Time finish", type:"time" },
      { k:"remarks",     label:"Remarks", type:"textarea", full:true },
    ],
  });

  // ===================================================================
  //  PRODUCTION (3333)
  // ===================================================================
  // Daily Production Plan — the target/workforce row the live dashboard reads
  App.views.planentry = formView({
    title:"Daily Production Plan", stage:"production", table:"production_plans",
    intro:"Set the day's target and workforce per lot. The Live Progress board tracks packing against this.",
    successMsg:"Plan saved ✓", submitLabel:"Save plan",
    fields:[
      { k:"date",         label:"Date", type:"date", default:today() },
      { k:"lot_number",   label:"Lot", type:"lot", required:true },
      { k:"buyer",        label:"Buyer", type:"text" },
      { k:"target_count", label:"Target count", type:"text", placeholder:"e.g. 26/30" },
      { k:"target_kg",    label:"Target (kg)", type:"number" },
      { k:"workforce",    label:"Workforce", type:"number", step:"1" },
      { k:"remarks",      label:"Remarks", type:"textarea", full:true },
    ],
  });

  App.views.machine = formView({
    title:"Machine Event", stage:"freezing", table:"machine_events",
    intro:"Pick the freezing line, then log the run. Duration is calculated from start and stop times. The Spiral line is the IQF freezer.",
    successMsg:"Machine event saved ✓",
    fields:[
      { k:"lot_number",  label:"Lot", type:"lot", required:true },
      { k:"machine_type",label:"Line / machine", type:"select", options:[
          {v:"plate",label:"Plate freezer"},
          {v:"spiral_iqf",label:"Spiral / IQF freezer"},
          {v:"blast",label:"Blast freezer"},
          {v:"aqua",label:"Aqua freezer"},
          {v:"dolphin",label:"Dolphin freezer"},
          {v:"ghan",label:"Ghan freezer"},
          {v:"ice",label:"Ice machine"},
          {v:"tunnel",label:"Tunnel"} ], required:true,
        hint:"Same six lines tracked in daily costing. Spiral = IQF." },
      { k:"load_no",  label:"Load no", type:"text" },
      { k:"start_at", label:"Start", type:"datetime" },
      { k:"stop_at",  label:"Stop", type:"datetime" },
      { k:"duration_seconds", label:"Duration", type:"computed", full:true,
        fn:(v)=>{ if(!v.start_at||!v.stop_at) return "—"; const s=Math.round((new Date(v.stop_at)-new Date(v.start_at))/1000);
                  if(s<0) return "stop is before start"; const m=Math.floor(s/60), h=Math.floor(m/60);
                  return h>0?`${h}h ${m%60}m`:(m>0?`${m}m ${s%60}s`:`${s}s`); } },
      { k:"remarks", label:"Remarks", type:"textarea", full:true },
    ],
    prepare:(v)=>{
      let dur=null;
      if(v.start_at && v.stop_at){ dur=Math.round((new Date(v.stop_at)-new Date(v.start_at))/1000); if(dur<0) dur=null; }
      return { lot_number:v.lot_number, machine_type:v.machine_type, load_no:v.load_no,
               start_at:v.start_at, stop_at:v.stop_at, duration_seconds:dur, remarks:v.remarks };
    },
  });

  App.views.prodtemp = formView({
    title:"Temperature + Photo", stage:"freezing", table:"temp_logs",
    successMsg:"Temperature logged ✓",
    fields:[
      { k:"lot_number", label:"Lot", type:"lot", required:true },
      { k:"point", label:"Point", type:"select", options:[
          {v:"iqf_infeed",label:"IQF infeed"},{v:"tunnel",label:"Tunnel"},
          {v:"core_before",label:"Core (before)"},{v:"core_after",label:"Core (after)"},
          {v:"stuffing",label:"Stuffing"} ], required:true },
      { k:"temp_c", label:"Temp (°C)", type:"number" },
      { k:"recorded_at", label:"Recorded at", type:"datetime" },
      { k:"photo_url", label:"Gauge / probe photo", type:"photo", full:true },
    ],
    prepare:(v)=>{
      const row = { lot_number:v.lot_number, point:v.point, stage:"freezing", temp_c:v.temp_c, photo_url:v.photo_url };
      if(v.recorded_at) row.recorded_at = v.recorded_at;
      return row;
    },
  });

  // Packing Status — editable. Pick a lot, see its current numbers, update them.
  // Saving overwrites the lot's latest packing record (or creates the first one).
  App.views.packing = async function(host){
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    let lots = []; try{ lots = await db.listLots(); }catch(_){}

    host.innerHTML = "";
    const card = el("div",{class:"card"});
    const form = el("div",{class:"form"});
    form.appendChild(el("div",{class:"form-head"},[ el("h3",{text:"Packing Status"}) ]));
    form.appendChild(el("div",{class:"hint",style:"margin:-6px 0 14px;text-transform:none",
      text:"Pick a lot to load its current packing numbers, then update them. Saving overwrites that lot's latest packing record."}));

    const grid = el("div",{class:"fgrid"});

    // Lot selector
    const lotSel = el("select");
    [{v:"",label:"Select lot…"}].concat(lots.map(l=>({
      v:l.lot_number, label:l.lot_number + (l.product?" · "+l.product:(l.species?" · "+l.species:"")) })))
      .forEach(o=> lotSel.appendChild(el("option",{value:o.v}, o.label)));
    const lotFld = el("div",{class:"fld"},[ el("label",{text:"Lot"}), lotSel ]);
    grid.appendChild(lotFld);

    const mkNum = (label)=>{
      const i = el("input",{type:"number"}); i.setAttribute("inputmode","decimal"); i.step="any";
      grid.appendChild(el("div",{class:"fld"},[ el("label",{text:label}), i ]));
      return i;
    };
    const buyerIn = el("input",{type:"text", placeholder:"Buyer"});
    grid.appendChild(el("div",{class:"fld"},[ el("label",{text:"Buyer"}), buyerIn ]));
    const targetIn = mkNum("Cases target");
    const packedIn = mkNum("Cases packed");
    const packetsIn = mkNum("Packets");

    // live remaining
    const remOut = el("div",{style:"font-size:20px;font-weight:800;color:var(--primary-dark);padding:8px 0;letter-spacing:.5px",text:"—"});
    grid.appendChild(el("div",{class:"fld full"},[ el("label",{text:"Remaining (target − packed)"}), remOut ]));
    const recomputeRem = ()=>{
      const t=Number(targetIn.value), p=Number(packedIn.value);
      remOut.textContent = (targetIn.value!==""&&packedIn.value!=="" && !isNaN(t) && !isNaN(p)) ? String(t-p) : "—";
    };
    targetIn.addEventListener("input",recomputeRem); packedIn.addEventListener("input",recomputeRem);

    form.appendChild(grid);

    const statusLine = el("div",{class:"hint",style:"text-transform:none",text:""});
    form.appendChild(statusLine);
    const errEl = el("div",{class:"err-msg hidden"});
    form.appendChild(errEl);

    const btn = el("button",{class:"btn btn-primary", text:"Save packing"});
    const cancel = el("button",{class:"btn btn-ghost", text:"Cancel", onclick:()=> App.home()});
    form.appendChild(el("div",{class:"form-actions"},[cancel, btn]));
    card.appendChild(form);
    host.appendChild(card);

    let existingId = null;
    const fill = (row)=>{
      existingId = row ? row.id : null;
      buyerIn.value   = row && row.buyer!=null        ? row.buyer        : "";
      targetIn.value  = row && row.cases_target!=null ? row.cases_target : "";
      packedIn.value  = row && row.cases_packed!=null ? row.cases_packed : "";
      packetsIn.value = row && row.packets!=null      ? row.packets      : "";
      recomputeRem();
      statusLine.textContent = row
        ? "Editing this lot's existing packing record — saving will update it."
        : "No packing record yet for this lot — saving will create the first one.";
      btn.textContent = row ? "Update packing" : "Save packing";
    };

    lotSel.addEventListener("change", async ()=>{
      const lot = lotSel.value;
      existingId = null; statusLine.textContent = "";
      if(!lot){ fill(null); statusLine.textContent=""; return; }
      statusLine.textContent = "Loading current packing…";
      try{
        const { data, error } = await db.client.from("packing_status").select("*")
          .eq("lot_number", lot).order("recorded_at",{ascending:false}).limit(1);
        if(error) throw error;
        fill(data && data.length ? data[0] : null);
      }catch(e){ fill(null); statusLine.textContent="Could not load existing record: "+(e.message||e); }
    });

    btn.addEventListener("click", async ()=>{
      errEl.classList.add("hidden");
      const lot = lotSel.value;
      if(!lot){ errEl.textContent="Please pick a lot"; errEl.classList.remove("hidden"); return; }
      const numOrNull = (s)=> (s==="" || s==null || isNaN(Number(s))) ? null : Number(s);
      const row = {
        lot_number: lot,
        buyer: buyerIn.value.trim() || null,
        cases_target: numOrNull(targetIn.value),
        cases_packed: numOrNull(packedIn.value),
        packets: numOrNull(packetsIn.value),
        recorded_at: new Date().toISOString(),
      };
      btn.disabled=true; const lbl=btn.textContent; btn.textContent="Saving…";
      try{
        if(existingId){
          const { error } = await db.client.from("packing_status").update(row).eq("id", existingId);
          if(error) throw error;
          toast("Packing updated ✓","ok");
        }else{
          await DB().insert("packing_status", row);
          toast("Packing saved ✓","ok");
        }
        App.home();
      }catch(e){ btn.disabled=false; btn.textContent=lbl;
        errEl.textContent="Could not save: "+(e.message||e); errEl.classList.remove("hidden"); }
    });
  };

  // Frozen Output (form 144, IQF Production Report) — built per-batch.
  // The floor adds ONE short line each time a batch comes off the freezer;
  // the screen sums them into a live "Frozen: X kg · Y cases" total per lot,
  // so the day's record builds itself instead of one big sheet at shift end.
  App.views.prodout = async function(host){
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    let lots = []; try{ lots = await db.listLots(); }catch(_){}
    const lotMeta = {}; lots.forEach(l=> lotMeta[l.lot_number]=l);

    host.innerHTML = "";
    const card = el("div",{class:"card"});
    const form = el("div",{class:"form"});
    form.appendChild(el("div",{class:"form-head"},[
      el("h3",{text:"Frozen Output"}),
      el("span",{class:"fmt",text:"FORM 144"}),
    ]));
    form.appendChild(el("div",{class:"hint",style:"margin:-6px 0 14px;text-transform:none",
      text:"Pick a lot, then add each batch as it comes off the freezer. Just the few boxes per batch — the total adds up by itself."}));

    // ---- lot selector ----
    const lotSel = el("select");
    [{v:"",label:"Select lot…"}].concat(lots.map(l=>({
      v:l.lot_number, label:l.lot_number + (l.product?" · "+l.product:(l.species?" · "+l.species:"")) })))
      .forEach(o=> lotSel.appendChild(el("option",{value:o.v}, o.label)));
    form.appendChild(el("div",{class:"fld"},[ el("label",{text:"Lot"}), lotSel ]));

    // ---- live running total for the lot ----
    const totalBox = el("div",{style:"font-size:20px;font-weight:800;color:var(--primary-dark);padding:10px 0;letter-spacing:.3px",text:"—"});
    form.appendChild(el("div",{class:"fld full"},[ el("label",{text:"This lot so far"}), totalBox ]));

    // ---- list of batches already logged for the lot ----
    const listWrap = el("div",{style:"display:flex;flex-direction:column;gap:8px;margin:4px 0 18px"});
    form.appendChild(listWrap);

    // ---- add-a-batch mini form ----
    const addHead = el("div",{class:"hint",style:"text-transform:none;font-weight:700;margin:6px 0 8px",text:"Add a batch"});
    form.appendChild(addHead);
    const grid = el("div",{class:"fgrid"});
    const mkNum = (label, full)=>{
      const i = el("input",{type:"number"}); i.setAttribute("inputmode","decimal"); i.step="any";
      grid.appendChild(el("div",{class:"fld"+(full?" full":"")},[ el("label",{text:label}), i ]));
      return i;
    };
    const mkText = (label, ph)=>{
      const i = el("input",{type:"text", placeholder:ph||""});
      grid.appendChild(el("div",{class:"fld"},[ el("label",{text:label}), i ]));
      return i;
    };
    const prodSel = el("select");
    [{v:"",label:"Product…"}].concat((typeof PRODUCTS!=="undefined"?PRODUCTS:[]).map(p=>({v:p,label:p})))
      .forEach(o=> prodSel.appendChild(el("option",{value:o.v}, o.label)));
    grid.appendChild(el("div",{class:"fld"},[ el("label",{text:"Product"}), prodSel ]));
    const gradeIn  = mkText("Grade / count","e.g. 11/15");
    const fcountIn = mkText("Frozen count","e.g. 15ct");
    const grossIn  = mkNum("Gross weight (kg)");
    const glazeIn  = mkNum("Achieved glaze %");
    const casesIn  = mkNum("No. of cases");
    // optional / less-common
    const netIn    = mkNum("Net weight (kg)");
    const tglazeIn = mkNum("Target glaze %");
    const packIn   = mkText("Packing","e.g. 1x12");
    const looseIn  = mkNum("Loose cases");
    form.appendChild(grid);

    const errEl = el("div",{class:"err-msg hidden"});
    form.appendChild(errEl);
    const addBtn = el("button",{class:"btn btn-primary", text:"+ Add batch"});
    const doneBtn = el("button",{class:"btn btn-ghost", text:"Done", onclick:()=> App.home()});
    form.appendChild(el("div",{class:"form-actions"},[doneBtn, addBtn]));
    card.appendChild(form);
    host.appendChild(card);

    const numOrNull = (s)=> (s==="" || s==null || isNaN(Number(s))) ? null : Number(s);
    const fmtKg = (n)=> (Math.round(n*10)/10).toLocaleString();

    let rows = [];
    function renderList(){
      listWrap.innerHTML = "";
      if(!lotSel.value){ totalBox.textContent="—"; return; }
      let kg=0, cs=0;
      rows.forEach(r=>{ kg += Number(r.gross_weight_kg)||0; cs += Number(r.cases)||0; });
      totalBox.textContent = rows.length
        ? ("Frozen: " + fmtKg(kg) + " kg · " + cs + " cases  ·  " + rows.length + " batch"+(rows.length>1?"es":""))
        : "No batches yet — add the first one below.";
      rows.forEach(r=>{
        const bits = [r.product, r.grade, r.frozen_count,
          (r.gross_weight_kg!=null? r.gross_weight_kg+" kg":null),
          (r.achieved_glaze!=null? r.achieved_glaze+"% glz":null),
          (r.cases!=null? r.cases+" cs":null)].filter(Boolean).join("  ·  ");
        const row = el("div",{class:"lotrow",style:"cursor:default"});
        row.appendChild(el("div",{class:"ln",style:"flex:1",text:bits||"(batch)"}));
        const del = el("button",{class:"btn btn-ghost",style:"padding:4px 10px;font-size:13px",text:"✕",
          title:"Remove this batch", onclick:async ()=>{
            if(!confirm("Remove this batch?")) return;
            try{
              const { error } = await db.client.from("production_output").delete().eq("id", r.id);
              if(error) throw error;
              rows = rows.filter(x=> x.id!==r.id);
              renderList();
              toast("Batch removed","ok");
            }catch(e){ toast("Could not remove: "+(e.message||e),"err"); }
          }});
        row.appendChild(del);
        listWrap.appendChild(row);
      });
    }

    async function loadRows(){
      rows = [];
      if(!lotSel.value){ renderList(); return; }
      totalBox.textContent = "Loading…";
      try{
        const { data, error } = await db.client.from("production_output").select("*")
          .eq("lot_number", lotSel.value).order("created_at",{ascending:true});
        if(error) throw error;
        rows = data || [];
      }catch(e){ toast("Could not load batches: "+(e.message||e),"err"); }
      renderList();
    }

    lotSel.addEventListener("change", ()=>{
      // default the product to the lot's product, if known and not yet picked
      const m = lotMeta[lotSel.value];
      if(m && m.product && !prodSel.value){
        const opt = Array.from(prodSel.options).find(o=>o.value===m.product);
        if(opt) prodSel.value = m.product;
      }
      loadRows();
    });

    function clearAdd(){
      gradeIn.value=fcountIn.value=grossIn.value=glazeIn.value=casesIn.value="";
      netIn.value=tglazeIn.value=packIn.value=looseIn.value="";
      // keep product selected — usually same across a lot's batches
    }

    addBtn.addEventListener("click", async ()=>{
      errEl.classList.add("hidden");
      if(!lotSel.value){ errEl.textContent="Pick a lot first."; errEl.classList.remove("hidden"); return; }
      const hasSomething = [gradeIn.value,fcountIn.value,grossIn.value,glazeIn.value,casesIn.value,prodSel.value]
        .some(v=> v!=null && String(v).trim()!=="");
      if(!hasSomething){ errEl.textContent="Enter at least the grade, weight or cases for this batch."; errEl.classList.remove("hidden"); return; }
      const rec = {
        lot_number: lotSel.value,
        product: prodSel.value || null,
        grade: gradeIn.value.trim() || null,
        frozen_count: fcountIn.value.trim() || null,
        gross_weight_kg: numOrNull(grossIn.value),
        achieved_glaze: numOrNull(glazeIn.value),
        cases: numOrNull(casesIn.value),
        net_weight_kg: numOrNull(netIn.value),
        target_glaze: numOrNull(tglazeIn.value),
        packing: packIn.value.trim() || null,
        loose_cases: numOrNull(looseIn.value),
        entry_mode: "manual",
      };
      addBtn.disabled=true; const lbl=addBtn.textContent; addBtn.textContent="Adding…";
      try{
        const saved = await DB().insert("production_output", rec);
        // insert returns the row(s); fall back to the local rec if shape differs
        const newRow = Array.isArray(saved) ? saved[0] : (saved && saved.id ? saved : rec);
        rows.push(newRow.id ? newRow : Object.assign({id:"tmp-"+Date.now()}, rec));
        renderList(); clearAdd(); toast("Batch added ✓","ok");
        gradeIn.focus();
      }catch(e){ errEl.textContent="Could not add: "+(e.message||e); errEl.classList.remove("hidden"); }
      finally{ addBtn.disabled=false; addBtn.textContent=lbl; }
    });
  };

  // ===================================================================
  //  QC (4444)
  // ===================================================================

  // 5B — Treatment Log (FMT POF/PC/004) — one row per tub, additives presence-only
  App.views.treatment = formView({
    title:"Treatment Log", stage:"treatment", table:"treatment_logs", fmt:"FMT POF/PC/004",
    formType:"treatment_log",
    intro:"Shrimp soaking/treatment only. Fish & squid lots are not soaked — skip this stage for them.",
    successMsg:"Treatment log saved ✓",
    fields:[
      { k:"date",   label:"Date", type:"date", default:today() },
      { k:"shift",  label:"Shift", type:"select", options:SHIFTS },
      { k:"tub_no", label:"Tub no", type:"text" },
      { k:"lot_number", label:"Lot", type:"lot", required:true },
      { k:"product", label:"Product", type:"select", options:PRODUCTS },
      { k:"species", label:"Species", type:"select", options:SPECIES, default:"Vannamei" },
      { k:"grade",   label:"Grade / count", type:"text", placeholder:"e.g. 26/30" },
      { k:"chemical_id", label:"Chemical ID", type:"text" },
      { k:"salt_id",     label:"Salt ID", type:"text" },
      { k:"colour_id",   label:"Colour ID", type:"text" },
      { k:"ph_solution", label:"pH of solution", type:"number" },
      { k:"weight_kg",   label:"Weight (kg)", type:"number" },
      { k:"count_before_soak", label:"Count before soak", type:"text" },
      { k:"count_after_soak",  label:"Count after soak", type:"text" },
      { k:"pct_gain", label:"% gain", type:"number", entered:true, hint:"Measured — not auto-calculated" },
      { k:"soak_in_time",  label:"Soak in", type:"time" },
      { k:"soak_out_time", label:"Soak out", type:"time" },
      { k:"soln_temp_hr1", label:"Soln temp 1h (°C)", type:"number" },
      { k:"soln_temp_hr2", label:"Soln temp 2h (°C)", type:"number" },
      { k:"soln_temp_hr3", label:"Soln temp 3h (°C)", type:"number" },
      { type:"checks", label:"Additives (presence only)", items:[
          {k:"additive_stpp_np", label:"STPP / NP"},
          {k:"additive_paprika", label:"Paprika"},
          {k:"additive_salt",    label:"Salt"} ] },
      { k:"checked_by",  label:"Checked by", type:"text" },
      { k:"verified_by", label:"Verified by", type:"text" },
    ],
  });

  // 5C — Online Inspection Report (IQF): header + fixed 9 sample columns
  const SAMPLE_ROWS = [
    ["lot_number","Lot","lot"],
    ["variety","Variety","text"],
    ["grade","Grade / count","text"],
    ["frozen_count","Frozen count","text"],
    ["frozen_weight","Frozen wt (g)","num"],
    ["glaze_pct","Glaze % (entered)","num"],
    ["deglazed_count","Deglazed count","text"],
    ["deglazed_weight","Deglazed wt (g)","num"],
    ["thawed_weight","Thawed wt (g)","num"],
    ["thawed_count","Thawed count","text"],
    ["uniformity","Uniformity","text"],
    ["defect_freezer_burn","Freezer burn","num"],
    ["defect_deterioration","Deterioration","num"],
    ["defect_discolouration","Discolouration","num"],
    ["defect_dehydration","Dehydration","num"],
    ["defect_black_spot","Black spot","num"],
    ["defect_black_ring","Black ring","num"],
    ["defect_broken","Broken","num"],
    ["defect_damaged_bruised","Damaged / bruised","num"],
    ["defect_vein","Vein","num"],
    ["defect_loose_shell","Loose shell","num"],
    ["defect_soft_shell","Soft shell","num"],
    ["defect_semi_peeled","Semi-peeled","num"],
    ["defect_clumps","Clumps","num"],
    ["defect_foreign_matter","Foreign matter","num"],
    ["defect_foreign_veg_matter","Foreign veg matter","num"],
    ["core_temp","Core temp (°C)","num"],
    ["surface_temp","Surface temp (°C)","num"],
    ["no_of_cases","No. of cases","num"],
  ];

  App.views.inspection = async function(host){
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    let lots = []; try{ lots = await db.listLots(); }catch(_){}
    host.innerHTML = "";

    // ---- header card ----
    const headCard = el("div",{class:"card",style:"margin-bottom:16px"});
    const headForm = el("div",{class:"form"});
    headForm.appendChild(el("div",{class:"form-head"},[
      el("h3",{text:"Online Inspection Report (IQF)"}),
      el("span",{class:"fmt",text:"FORM 5C"}),
    ]));
    const headGrid = el("div",{class:"fgrid"});
    const headFields = [
      { k:"report_no", label:"Report no", type:"text" },
      { k:"date", label:"Date", type:"date", default:today() },
      { k:"time", label:"Time", type:"time" },
      { k:"market", label:"Market", type:"select", options:MARKETS },
      { k:"target_glaze_pct", label:"Target glaze %", type:"number", entered:true },
      { k:"shift", label:"Shift", type:"select", options:SHIFTS },
      { k:"raw_production", label:"Raw / production", type:"text" },
      { k:"checked_by", label:"Checked by", type:"text" },
      { k:"verified_by", label:"Verified by", type:"text" },
    ];
    const headCollect = [];
    const headSetters = {}, headNodes = {};
    headFields.forEach(def=>{
      const f=makeField(def,{lots});
      headGrid.appendChild(f.node);
      headCollect.push(f.collect);
      if(f.set) headSetters[def.k] = f.set;
      headNodes[def.k] = f.node;
    });

    // ---- scan bar (photograph the 9-sample sheet to auto-fill) ----
    let inspExtraction = null, inspScanned = false;
    if(App.scan && App.scan.enabled()){
      const bar = el("div",{class:"scan-bar", style:"margin-bottom:12px"});
      const scanInput = el("input",{type:"file", accept:"image/*", style:"display:none"});
      const scanBtn = el("button",{class:"btn btn-scan", type:"button",
        text:"📸 Scan or upload sheet", onclick:()=> scanInput.click()});
      bar.appendChild(scanInput);
      bar.appendChild(scanBtn);
      headForm.appendChild(bar);
      headForm.appendChild(el("div",{class:"hint",style:"text-transform:none;margin:-4px 0 12px",
        text:"Photograph the inspection sheet to auto-fill the header and all sample columns. Check anything highlighted amber."}));
      scanInput.addEventListener("change", async ()=>{
        const f = scanInput.files[0]; if(!f) return;
        errEl.classList.add("hidden");
        scanBtn.disabled = true; scanBtn.textContent = "📸 Reading…";
        try{
          const res = await App.scan.extract("online_inspection", f, { lot:null });
          applyInspExtraction(res);
          toast("Scanned — review highlighted cells", "ok");
          if(App.scan.autoCommit()) btn.click();
        }catch(e){
          errEl.textContent = "Scan failed: " + (e.message||e);
          errEl.classList.remove("hidden");
        }finally{
          scanBtn.disabled = false; scanBtn.textContent = "📸 Scan or upload sheet";
          scanInput.value = "";
        }
      });
    }

    headForm.appendChild(headGrid);
    headCard.appendChild(headForm);
    host.appendChild(headCard);

    // ---- samples: fixed 9 columns, horizontally scrollable (mirrors paper) ----
    const COLS = 9;
    const sampleCard = el("div",{class:"card",style:"margin-bottom:16px;padding:14px"});
    sampleCard.appendChild(el("div",{style:"font-weight:700;font-size:15px;margin-bottom:4px",text:"Samples (up to 9)"}));
    sampleCard.appendChild(el("div",{class:"hint",style:"text-transform:none;margin-bottom:12px",
      text:"Scroll sideways for samples 1–9. A column is saved only if its Lot is set."}));

    const scroll = el("div",{style:"overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid var(--line); border-radius:12px"});
    const tbl = el("table",{style:"border-collapse:separate; border-spacing:0; min-width:max-content; font-size:13px"});
    const cells = {}; // key -> [9 inputs]

    // header row
    const thead = el("tr");
    thead.appendChild(el("th",{style:"position:sticky;left:0;z-index:2;background:#f8fafc;text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);min-width:140px",text:"Field"}));
    for(let c=0;c<COLS;c++) thead.appendChild(el("th",{style:"padding:8px;border-bottom:1px solid var(--line);background:#f8fafc;font-weight:700;min-width:104px",text:"S"+(c+1)}));
    tbl.appendChild(thead);

    SAMPLE_ROWS.forEach(([key,label,kind])=>{
      const tr = el("tr");
      tr.appendChild(el("td",{style:"position:sticky;left:0;z-index:1;background:#fff;padding:6px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;color:var(--muted);min-width:140px",text:label}));
      cells[key] = [];
      for(let c=0;c<COLS;c++){
        const td = el("td",{style:"padding:4px 6px;border-bottom:1px solid #f1f5f9"});
        let inp;
        if(kind==="lot"){
          inp = el("select",{style:"width:100px;font-size:13px;padding:8px 6px;border:1px solid var(--line);border-radius:8px;-webkit-appearance:none"});
          inp.appendChild(el("option",{value:""},"—"));
          lots.forEach(l=> inp.appendChild(el("option",{value:l.lot_number}, l.lot_number)));
        } else {
          inp = el("input",{type:kind==="num"?"number":"text", style:"width:96px;font-size:13px;padding:8px;border:1px solid var(--line);border-radius:8px"});
          if(kind==="num") inp.setAttribute("inputmode","decimal");
        }
        td.appendChild(inp);
        cells[key].push(inp);
        tr.appendChild(td);
      }
      tbl.appendChild(tr);
    });
    scroll.appendChild(tbl);
    sampleCard.appendChild(scroll);
    host.appendChild(sampleCard);

    // ---- apply a scan extraction to header + every sample column ----
    function applyInspExtraction(res){
      const fields = res.fields || {};
      const conf   = res.confidence || {};
      const thr    = App.scan.threshold();
      Object.keys(headSetters).forEach(k=>{
        headNodes[k] && headNodes[k].classList.remove("lowconf");
        if(k in fields && fields[k]!=null && fields[k]!==""){
          headSetters[k](fields[k]);
          const c = conf[k];
          if(typeof c==="number" && c<thr && headNodes[k]) headNodes[k].classList.add("lowconf");
        }
      });
      const samples = Array.isArray(fields.samples) ? fields.samples : [];
      const sConf   = (conf && Array.isArray(conf.samples)) ? conf.samples : [];
      samples.forEach((s, i)=>{
        if(!s || typeof s!=="object") return;
        const col = (typeof s.sample_index==="number" ? s.sample_index : (i+1)) - 1;
        if(col<0 || col>=COLS) return;
        const cc = sConf[i] || {};
        SAMPLE_ROWS.forEach(([key])=>{
          const inp = cells[key] && cells[key][col];
          if(!inp) return;
          inp.classList.remove("lowconf");
          if(key in s && s[key]!=null && s[key]!==""){
            inp.value = s[key];
            const cv = cc[key];
            if(typeof cv==="number" && cv<thr) inp.classList.add("lowconf");
          }
        });
      });
      inspExtraction = {
        source_photo_url: res.photo_url || null,
        extraction_json:  { fields, confidence: conf, raw_text: res.raw_text||"" },
        extraction_confidence: conf,
      };
      inspScanned = true;
    }

    // ---- submit ----
    const errEl = el("div",{class:"err-msg hidden"});
    host.appendChild(errEl);
    const btn = el("button",{class:"btn btn-primary",text:"Save inspection report"});
    const cancel = el("button",{class:"btn btn-ghost",text:"Cancel", onclick:()=>App.home()});
    host.appendChild(el("div",{class:"form-actions"},[cancel, btn]));

    btn.addEventListener("click", async ()=>{
      errEl.classList.add("hidden");
      const header = {}; headCollect.forEach(c=> c(header));

      const samples = [];
      for(let c=0;c<COLS;c++){
        const lot = cells.lot_number[c].value;
        if(!lot) continue;
        const s = { sample_index:c+1, lot_number:lot };
        SAMPLE_ROWS.forEach(([key,,kind])=>{
          if(key==="lot_number") return;
          let val = cells[key][c].value;
          if(typeof val==="string") val = val.trim();
          s[key] = (val===""||val==null) ? null : (kind==="num" ? Number(val) : val);
        });
        samples.push(s);
      }
      if(!samples.length){ errEl.textContent="Set a Lot on at least one sample column."; errEl.classList.remove("hidden"); return; }

      // scan audit metadata on the report header (samples inherit via report_id)
      if(inspScanned){
        header.entry_mode = "scan";
        if(inspExtraction){
          header.source_photo_url      = inspExtraction.source_photo_url;
          header.extraction_json       = inspExtraction.extraction_json;
          header.extraction_confidence = inspExtraction.extraction_confidence;
        }
      }

      btn.disabled=true; btn.textContent="Saving…";
      try{
        const rep = await DB().insert("online_inspection_reports", header);
        if(!rep || !rep.id) throw new Error("report header not created");
        for(const s of samples){ await DB().insert("online_inspection_samples", { ...s, report_id:rep.id }); }
        toast("Inspection report saved ✓ ("+samples.length+" sample"+(samples.length>1?"s":"")+")", "ok");
        App.home();
      }catch(e){
        btn.disabled=false; btn.textContent="Save inspection report";
        errEl.textContent="Could not save: "+(e.message||e); errEl.classList.remove("hidden");
      }
    });
  };

  // Depanning / Repacking / Stuffing specs (qc_logs)
  App.views.stuffing = formView({
    title:"Depanning / Repacking / Stuffing", stage:"stuffing", table:"qc_logs",
    successMsg:"QC spec saved ✓",
    fields:[
      { k:"lot_number", label:"Lot", type:"lot", required:true },
      { k:"stage", label:"Stage", type:"select", options:[
          {v:"depanning",label:"Depanning"},{v:"repacking",label:"Repacking"},{v:"stuffing",label:"Stuffing"} ], required:true },
      { k:"block_setting", label:"Block setting", type:"text" },
      { k:"core_temp_before", label:"Core temp before (°C)", type:"number" },
      { k:"core_temp_after",  label:"Core temp after (°C)", type:"number" },
      { k:"buyer", label:"Buyer", type:"text" },
      { k:"glaze_pct", label:"Glaze %", type:"number", entered:true, hint:"Measured — not auto-calculated" },
      { k:"filling_weight_min", label:"Filling weight min (g)", type:"number" },
      { k:"filling_weight_max", label:"Filling weight max (g)", type:"number" },
      { type:"checks", label:"Rider", items:[ {k:"rider_inserted", label:"Rider inserted"} ] },
      { k:"stuffing_temp_c", label:"Stuffing temp (°C)", type:"number" },
      { k:"notes", label:"Notes", type:"textarea", full:true },
      { k:"photo_url", label:"Photo", type:"photo", full:true },
    ],
  });

  // ===================================================================
  //  OFFICE (5555) — inventory / dispatch / reglaze (one ledger table)
  // ===================================================================
  function invForm(txnType, title, successMsg){
    return formView({
      title, stage:"office", table:"inventory_transactions", successMsg,
      fields:[
        { k:"lot_number", label:"Lot", type:"lot", required:true },
        { k:"product", label:"Product", type:"select", options:PRODUCTS },
        { k:"buyer", label:"Buyer", type:"text" },
        { k:"qty_cases", label:"Qty (cases)", type:"number" },
        { k:"qty_kg", label:"Qty (kg)", type:"number" },
        txnType!=="reglaze" ? { k:"container_no", label:"Container no", type:"text" } : null,
        txnType==="dispatch" ? { k:"dispatch_date", label:"Dispatch date", type:"date", default:today() } : null,
        { k:"notes", label:"Notes", type:"textarea", full:true },
      ].filter(Boolean),
      prepare:(v)=>({ ...v, txn_type:txnType }),
    });
  }
  App.views.inventory = invForm("in",       "Inventory In",   "Inventory recorded ✓");
  App.views.dispatch  = invForm("dispatch", "Dispatch",       "Dispatch recorded ✓");
  // App.views.reglaze is a stock-drawdown loop — see stock.js (loaded after this file).

  // ===================================================================
  //  MANAGER (0000) — view-only summaries
  // ===================================================================
  function whenShort(t){
    if(!t) return "";
    const d = new Date(t);
    return isNaN(d) ? String(t) : d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
  }
  function srow(left, sub, right){
    return el("div",{class:"srow"},[
      el("div",{},[ el("div",{class:"l",text:left}), sub?el("div",{class:"s",text:sub}):null ]),
      el("div",{class:"r",text:right||""}),
    ]);
  }
  async function loadInto(host, label, fn){
    const db = DB(); if(!db || !db.isOnline()) return notConnected(host);
    const spin = loading(host, label);
    try{ const node = await fn(db); spin.remove(); host.appendChild(node); }
    catch(e){ spin.remove(); emptyState(host,"⚠️","Could not load", String(e.message||e)); }
  }

  App.views.temps = function(host){
    loadInto(host, "Loading temperatures…", async (db)=>{
      const rows = await db.list("temp_logs",{ order:"recorded_at", ascending:false, limit:80 });
      if(!rows.length) return el("div",{class:"card"}, el("div",{class:"stub"},[el("div",{class:"big",text:"🌡️"}),el("div",{text:"No temperature logs yet"})]));
      const card = el("div",{class:"card"});
      rows.forEach(r=>{
        const wrap = srow((r.point||"point")+" · "+(r.lot_number||"—"), whenShort(r.recorded_at), (r.temp_c!=null? r.temp_c+" °C":"—"));
        if(r.photo_url) wrap.querySelector(".l").appendChild(
          el("img",{class:"thumb", style:"width:40px;height:40px;margin-left:8px;vertical-align:middle", src:r.photo_url, onclick:()=>lightbox(r.photo_url)}));
        card.appendChild(wrap);
      });
      return card;
    });
  };

  App.views.yield = function(host){
    loadInto(host, "Loading yields…", async (db)=>{
      const [shed, out] = await Promise.all([
        db.list("peeling_shed_reports",{ order:"created_at", ascending:false, limit:60 }),
        db.list("peeling_output",{ order:"created_at", ascending:false, limit:60 }),
      ]);
      const rows = shed.map(r=>({lot:r.lot_number, src:"Shed report", y:r.yield_pct, t:r.created_at}))
        .concat(out.map(r=>({lot:r.lot_number, src:"Peeling output"+(r.source?" · "+r.source:""), y:r.yield_pct, t:r.created_at})))
        .sort((a,b)=> new Date(b.t)-new Date(a.t));
      if(!rows.length) return el("div",{class:"card"}, el("div",{class:"stub"},[el("div",{class:"big",text:"⚖️"}),el("div",{text:"No yield records yet"})]));
      const card = el("div",{class:"card"});
      rows.forEach(r=> card.appendChild(srow(r.lot||"—", r.src+" · "+whenShort(r.t), r.y!=null? r.y+" %":"—")));
      return card;
    });
  };

  App.views.qc = function(host){
    loadInto(host, "Loading inspection summary…", async (db)=>{
      const [reports, samples] = await Promise.all([
        db.list("online_inspection_reports",{ order:"created_at", ascending:false, limit:40 }),
        db.list("online_inspection_samples",{ order:"created_at", ascending:false, limit:400 }),
      ]);
      if(!reports.length) return el("div",{class:"card"}, el("div",{class:"stub"},[el("div",{class:"big",text:"🔬"}),el("div",{text:"No inspection reports yet"})]));
      const byRep = {}; samples.forEach(s=> (byRep[s.report_id]=byRep[s.report_id]||[]).push(s));
      const card = el("div",{class:"card"});
      reports.forEach(rep=>{
        const ss = byRep[rep.id]||[];
        const glazes = ss.map(s=>Number(s.glaze_pct)).filter(n=>!isNaN(n));
        const avg = glazes.length ? (glazes.reduce((a,b)=>a+b,0)/glazes.length).toFixed(1)+" %" : "—";
        card.appendChild(srow(
          (rep.market||"Inspection")+(rep.report_no?" · #"+rep.report_no:""),
          whenShort(rep.created_at)+" · "+ss.length+" sample"+(ss.length===1?"":"s")+(rep.target_glaze_pct!=null?" · target "+rep.target_glaze_pct+"%":""),
          "avg glaze "+avg));
      });
      return card;
    });
  };

  // Sheet types the floor captures. The photo IS the record; the tag just
  // says which paper it is so the gallery + (Phase 2) auto-read knows the layout.
  const SHEET_TYPES = [
    "Production Plan",
    "IQF Production (144)",
    "Plate / Block",
    "Spiral",
    "Load Report (72)",
    "Repacking (639)",
    "Other",
  ];
  const slug = (s)=> String(s||"doc").toLowerCase().replace(/[^\w]+/g,"_").replace(/^_+|_+$/g,"") || "doc";

  // Capture Document — Phase 1 of the document-keeping plan.
  // Snap or upload a sheet, tag lot + sheet type. The photo IS the record.
  // `preset` locks/relabels it for a specific use (e.g. Upload Plan):
  //   { title, hint, presetType, lockType, hideLot, datePlaceholder }
  async function buildCapture(host, preset){
    preset = preset || {};
    const db = DB();
    if(!db || !db.isOnline()) return notConnected(host);
    let lots = []; try{ lots = await db.listLots(); }catch(_){}

    host.innerHTML = "";
    const card = el("div",{class:"card"});
    const form = el("div",{class:"form"});
    form.appendChild(el("div",{class:"form-head"},[ el("h3",{text:preset.title || "Capture Document"}) ]));
    form.appendChild(el("div",{class:"hint",style:"margin:-6px 0 14px;text-transform:none",
      text:preset.hint || "Snap or upload the sheet, tag the lot and which sheet it is. The photo is kept as the record — no typing the numbers."}));

    const grid = el("div",{class:"fgrid"});

    // sheet type — hidden+locked when a preset fixes it
    const typeSel = el("select");
    SHEET_TYPES.forEach(t=> typeSel.appendChild(el("option",{value:t}, t)));
    if(preset.presetType){ typeSel.value = preset.presetType; }
    if(!preset.lockType){
      grid.appendChild(el("div",{class:"fld"},[ el("label",{text:"Sheet type"}), typeSel ]));
    }

    // lot (optional) — hidden when the document spans the whole day (e.g. plan)
    const lotSel = el("select");
    [{v:"",label:"Lot (optional)…"}].concat(lots.map(l=>({
      v:l.lot_number, label:l.lot_number + (l.product?" · "+l.product:(l.species?" · "+l.species:"")) })))
      .forEach(o=> lotSel.appendChild(el("option",{value:o.v}, o.label)));
    if(!preset.hideLot){
      grid.appendChild(el("div",{class:"fld"},[ el("label",{text:"Lot"}), lotSel ]));
    }

    // date on the sheet
    const dateIn = el("input",{type:"date", value:today()});
    grid.appendChild(el("div",{class:"fld"},[ el("label",{text:preset.dateLabel || "Date on sheet"}), dateIn ]));

    // remarks
    const remIn = el("input",{type:"text", placeholder:preset.remarksPlaceholder || "e.g. Load No. 1"});
    grid.appendChild(el("div",{class:"fld"},[ el("label",{text:"Remarks (optional)"}), remIn ]));

    // photo — camera OR gallery/file (no capture attr)
    const file = el("input",{type:"file", accept:"image/*", style:"display:none"});
    const prev = el("img",{class:"photo-prev hidden", alt:"preview"});
    const pick = el("button",{class:"photo-pick", type:"button", text:"📷 Take or upload sheet",
      onclick:()=> file.click()});
    file.addEventListener("change", ()=>{
      const f = file.files[0];
      if(f){ prev.src = URL.createObjectURL(f); prev.classList.remove("hidden"); pick.textContent="📷 Change photo"; }
    });
    grid.appendChild(el("div",{class:"fld full"},[ el("label",{text:"Document photo"}),
      el("div",{class:"photo-field"},[pick, prev, file]) ]));

    form.appendChild(grid);

    const errEl = el("div",{class:"err-msg hidden"});
    form.appendChild(errEl);

    // recently captured (this session) — quick reassurance the photo stuck
    const recentHead = el("div",{class:"hint",style:"text-transform:none;font-weight:700;margin:10px 0 6px;display:none",text:"Captured just now"});
    const recentWrap = el("div",{style:"display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:10px;margin-bottom:8px"});
    form.appendChild(recentHead); form.appendChild(recentWrap);

    const saveBtn = el("button",{class:"btn btn-primary", text:"Save document"});
    const doneBtn = el("button",{class:"btn btn-ghost", text:"Done", onclick:()=> App.home()});
    form.appendChild(el("div",{class:"form-actions"},[doneBtn, saveBtn]));
    card.appendChild(form);
    host.appendChild(card);

    saveBtn.addEventListener("click", async ()=>{
      errEl.classList.add("hidden");
      const f = file.files[0];
      if(!f){ errEl.textContent="Please take or upload the sheet photo first."; errEl.classList.remove("hidden"); return; }
      const sheet = typeSel.value;
      const lot = lotSel.value || null;
      saveBtn.disabled=true; const lbl=saveBtn.textContent; saveBtn.textContent="Saving…";
      try{
        const url = await db.uploadPhoto(f, lot || "unassigned", slug(sheet));
        const rec = {
          lot_number: lot,
          sheet_type: sheet,
          photo_url: url,
          doc_date: dateIn.value || null,
          remarks: remIn.value.trim() || null,
          entry_mode: "photo",
        };
        await DB().insert("documents", rec);
        // show in the "just now" strip
        recentHead.style.display="";
        recentWrap.insertBefore(el("div",{},[
          el("img",{class:"thumb", style:"width:100%;height:90px", src:url, onclick:()=>lightbox(url)}),
          el("div",{style:"font-size:10px;color:var(--muted);margin-top:4px;text-align:center",text:(lot||sheet||"—")}),
        ]), recentWrap.firstChild);
        toast((preset.savedToast || "Document saved")+" ✓","ok");
        // reset photo for the next sheet, keep type + lot for fast batch capture
        file.value=""; prev.src=""; prev.classList.add("hidden"); pick.textContent="📷 Take or upload sheet";
        remIn.value="";
      }catch(e){ errEl.textContent="Could not save: "+(e.message||e); errEl.classList.remove("hidden"); }
      finally{ saveBtn.disabled=false; saveBtn.textContent=lbl; }
    });
  }

  // General document capture (floor sheets).
  App.views.capturedoc = (host)=> buildCapture(host, {});

  // Upload Plan — manager snaps/uploads the day's production plan (the WhatsApp
  // message). Same engine, sheet type locked to "Production Plan", no lot
  // (a plan spans the whole day). This is the denominator Phase 3 reads targets from.
  App.views.uploadplan = (host)=> buildCapture(host, {
    title: "Upload Production Plan",
    hint: "Snap or upload today's plan — the same sheet you'd send on WhatsApp. It's kept as the day's plan; no typing the targets.",
    presetType: "Production Plan",
    lockType: true,
    hideLot: true,
    dateLabel: "Plan date",
    remarksPlaceholder: "e.g. Day shift",
    savedToast: "Plan uploaded",
  });

  App.views.docs = function(host){
    loadInto(host, "Loading documents…", async (db)=>{
      const [receipts, shedReps, captured] = await Promise.all([
        db.list("shed_receipts",{ order:"created_at", ascending:false, limit:60 }),
        db.list("peeling_shed_reports",{ order:"created_at", ascending:false, limit:60 }),
        db.list("documents",{ order:"created_at", ascending:false, limit:200 }),
      ]);
      const docs = captured.filter(r=>r.photo_url).map(r=>({lot:r.lot_number, t:r.sheet_type||"Document", u:r.photo_url, at:r.doc_date||r.created_at, type:r.sheet_type||"Other", rem:r.remarks}))
        .concat(receipts.filter(r=>r.photo_url).map(r=>({lot:r.lot_number, t:"Shed receipt"+(r.shed_name?" · "+r.shed_name:""), u:r.photo_url, at:r.created_at, type:"Shed receipt"})))
        .concat(shedReps.filter(r=>r.photo_url).map(r=>({lot:r.lot_number, t:"Peeling shed report", u:r.photo_url, at:r.created_at, type:"Peeling shed report"})))
        .sort((a,b)=> new Date(b.at)-new Date(a.at));
      if(!docs.length) return el("div",{class:"card"}, el("div",{class:"stub"},[el("div",{class:"big",text:"📎"}),el("div",{text:"No documents yet — capture one from the floor"})]));

      const card = el("div",{class:"card"});

      // ---- filter bar ----
      const types = Array.from(new Set(docs.map(d=>d.type))).sort();
      const lotsAvail = Array.from(new Set(docs.map(d=>d.lot).filter(Boolean))).sort();
      const filt = el("div",{class:"fgrid",style:"margin-bottom:14px"});
      const typeSel = el("select"); [{v:"",l:"All sheet types"}].concat(types.map(t=>({v:t,l:t}))).forEach(o=> typeSel.appendChild(el("option",{value:o.v}, o.l)));
      const lotSel  = el("select"); [{v:"",l:"All lots"}].concat(lotsAvail.map(t=>({v:t,l:t}))).forEach(o=> lotSel.appendChild(el("option",{value:o.v}, o.l)));
      const dateIn  = el("input",{type:"date"});
      filt.appendChild(el("div",{class:"fld"},[ el("label",{text:"Sheet type"}), typeSel ]));
      filt.appendChild(el("div",{class:"fld"},[ el("label",{text:"Lot"}), lotSel ]));
      filt.appendChild(el("div",{class:"fld"},[ el("label",{text:"Date"}), dateIn ]));
      card.appendChild(filt);

      const countLine = el("div",{class:"hint",style:"text-transform:none;margin-bottom:10px"});
      card.appendChild(countLine);
      const grid = el("div",{style:"display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px"});
      card.appendChild(grid);

      const sameDay = (at, d)=>{ if(!d) return true; try{ return new Date(at).toISOString().slice(0,10)===d; }catch(_){ return false; } };
      const render = ()=>{
        grid.innerHTML="";
        const shown = docs.filter(d=>
          (!typeSel.value || d.type===typeSel.value) &&
          (!lotSel.value  || d.lot===lotSel.value) &&
          sameDay(d.at, dateIn.value));
        countLine.textContent = shown.length+" document"+(shown.length===1?"":"s");
        if(!shown.length){ grid.appendChild(el("div",{class:"hint",style:"text-transform:none",text:"None match these filters."})); return; }
        shown.forEach(d=>{
          grid.appendChild(el("div",{},[
            el("img",{class:"thumb", style:"width:100%;height:120px", src:d.u, onclick:()=>lightbox(d.u)}),
            el("div",{style:"font-size:12px;font-weight:600;margin-top:6px",text:d.lot||"—"}),
            el("div",{style:"font-size:11px;color:var(--muted)",text:d.t+(d.rem?" · "+d.rem:"")}),
            el("div",{style:"font-size:10px;color:var(--muted)",text:whenShort(d.at)}),
          ]));
        });
      };
      typeSel.addEventListener("change",render);
      lotSel.addEventListener("change",render);
      dateIn.addEventListener("change",render);
      render();
      return card;
    });
  };

})();
