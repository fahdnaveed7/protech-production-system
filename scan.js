/* =====================================================================
   Protech PWA — scan-to-fill client pipeline (Step 6)
   ONE shared pipeline for every stage form. Loaded after forms.js.

   Three entry modes per form (all routed through buildForm in forms.js):
     • Manual  — type the values (unchanged behaviour).
     • Scan    — photograph the paper sheet → extract-form Edge Function
                 (OpenAI vision) fills the fields + per-cell confidence.
     • Edit    — reopen any saved row, correct it, save in place.

   The OpenAI key NEVER touches the browser — it lives only as the
   OPENAI_API_KEY Edge secret. We upload the photo, then ask the function
   to read it. Adding scan to a new form = add ONE CLIENT_REGISTRY entry
   here + one entry in the Edge Function's FORM_REGISTRY + set formType on
   the view. Nothing else changes.
   ===================================================================== */
(function(){
  "use strict";
  const App = window.App;
  if(!App){ console.error("scan.js loaded before App"); return; }
  const DB  = ()=> window.PROTECH_DB;
  const CFG = ()=> (window.PROTECH_CONFIG && window.PROTECH_CONFIG.SCAN) || {};
  const el  = App.ui.el;

  // form_type -> client metadata. table/label/viewKey/stage + a row summariser.
  // viewKey is the App.views key that renders this form (so Edit can reopen it).
  const CLIENT_REGISTRY = {
    shed_receipt: {
      table:"shed_receipts", label:"Shed Receipt", viewKey:"shedrcpt", stage:"intake",
      summary:(r)=>({
        title:(r.lot_number||"—") + (r.shed_name? " · "+r.shed_name : ""),
        sub:[r.date, r.species, r.total_kg!=null? r.total_kg+" kg":null]
              .filter(Boolean).join("  ·  "),
      }),
    },
    peeling_shed_report: {
      table:"peeling_shed_reports", label:"Peeling Shed Report", viewKey:"shedrep", stage:"peeling",
      summary:(r)=>({
        title:(r.lot_number||"—") + (r.report_no? " · #"+r.report_no : ""),
        sub:[r.date, r.species, r.yield_pct!=null? r.yield_pct+"% yield":null]
              .filter(Boolean).join("  ·  "),
      }),
    },
    treatment_log: {
      table:"treatment_logs", label:"Treatment Log", viewKey:"treatment", stage:"treatment",
      summary:(r)=>({
        title:(r.lot_number||"—") + (r.tub_no? " · tub "+r.tub_no : ""),
        sub:[r.date, r.product, r.grade, r.pct_gain!=null? r.pct_gain+"% gain":null]
              .filter(Boolean).join("  ·  "),
      }),
    },
  };

  const threshold = ()=> Number(CFG().CONFIDENCE_THRESHOLD) || 0.7;
  const enabled    = ()=> !!CFG().ENABLED;
  const autoCommit = ()=> !!CFG().AUTO_COMMIT;

  // which extracted cells fell below the confidence bar (and actually have a value)
  function lowConfFields(confidence, fields){
    if(!confidence || typeof confidence!=="object") return [];
    const thr = threshold();
    return Object.keys(confidence).filter(k=>{
      const c = confidence[k];
      const hasVal = !fields || (fields[k]!=null && fields[k]!=="");
      return hasVal && typeof c==="number" && c < thr;
    });
  }

  // A saved row "needs review" ONLY while it is still a raw scan with at least
  // one low-confidence cell. Manual rows and human-edited rows (scan_edited)
  // never need review — that is how editing "clears" the flag with no schema work.
  function needsReview(row){
    if(!row || row.entry_mode!=="scan") return false;
    const fields = row.extraction_json && row.extraction_json.fields;
    return lowConfFields(row.extraction_confidence, fields).length > 0;
  }

  // Upload the photo to storage, then call the Edge Function to read it.
  // ctx.lot (optional) only shapes the storage path; the function reads the lot
  // off the sheet itself. Returns {fields, confidence, raw_text, photo_url}.
  async function extract(formType, file, ctx){
    const reg = CLIENT_REGISTRY[formType];
    const stage = (reg && reg.stage) || "scan";
    const db = DB();
    if(!db || !db.isOnline()) throw new Error("Not connected");
    if(!db.client) throw new Error("Supabase client unavailable");

    const photo_url = await db.uploadPhoto(file, (ctx && ctx.lot) || "scan", stage);

    const fnName = CFG().FUNCTION || "extract-form";
    const { data, error } = await db.client.functions.invoke(fnName, {
      body: { form_type: formType, image_url: photo_url },
    });
    if(error){
      // FunctionsHttpError carries the response body; surface the real message.
      let msg = error.message || "Extraction failed";
      try{ const b = await error.context.json(); if(b && b.error) msg = b.error; }catch(_){}
      throw new Error(msg);
    }
    if(data && data.error) throw new Error(data.error);
    return {
      fields:     (data && data.fields)     || {},
      confidence: (data && data.confidence) || {},
      raw_text:   (data && data.raw_text)   || "",
      photo_url,
    };
  }

  // ------- Edit: reopen a saved row in its own form, save updates in place -----
  function openEdit(formType, row){
    const reg = CLIENT_REGISTRY[formType];
    if(!reg){ console.error("openEdit: unknown form_type", formType); return; }
    // formView (forms.js) consumes this on render, then clears it.
    App.scan.pendingEdit = { formType, row };
    App.openView(reg.viewKey, reg.label);
  }

  // ------- Edit list: pick a saved row to correct, or start a new one ----------
  function listView(formType){
    const reg = CLIENT_REGISTRY[formType];
    const main = document.getElementById("main");
    if(!reg || !main){ App.home && App.home(); return; }
    main.innerHTML = "";
    const back = el("button",{class:"back",
      html:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg> Back',
      onclick:()=> App.home && App.home() });
    main.appendChild(back);
    const host = el("div"); main.appendChild(host);
    renderList(formType, host, false);
  }

  async function renderList(formType, host, reviewOnly){
    const reg = CLIENT_REGISTRY[formType];
    const db = DB();
    host.innerHTML = "";
    if(!db || !db.isOnline()){ App.ui.notConnected(host); return; }

    const head = el("div",{class:"page-head"});
    head.appendChild(el("h2",{text:reg.label}));
    head.appendChild(el("p",{text:"Pick a record to edit, or start a new one."}));
    host.appendChild(head);

    const bar = el("div",{style:"display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap"});
    const newBtn = el("button",{class:"btn btn-primary", style:"flex:0 0 auto",
      text:"+ New "+reg.label, onclick:()=> App.openView(reg.viewKey, reg.label) });
    const toggle = el("label",{class:"chk"+(reviewOnly?" on":""),
      style:"margin-left:auto;display:inline-flex;align-items:center;gap:6px;cursor:pointer"});
    const tcb = el("input",{type:"checkbox"}); tcb.checked = reviewOnly;
    toggle.appendChild(tcb);
    toggle.appendChild(document.createTextNode(" Needs review only"));
    tcb.addEventListener("change", ()=> renderList(formType, host, tcb.checked));
    bar.appendChild(newBtn); bar.appendChild(toggle);
    host.appendChild(bar);

    let rows = [];
    try{
      rows = await db.list(reg.table, { order:"created_at", ascending:false, limit:60 });
    }catch(e){
      host.appendChild(el("div",{class:"err-msg", text:"Could not load: "+(e.message||e)}));
      return;
    }
    if(reviewOnly) rows = rows.filter(needsReview);
    if(!rows.length){
      App.ui.emptyState(host, reviewOnly ? "Nothing needs review 🎉" : "No records yet.");
      return;
    }

    const list = el("div",{style:"display:flex; flex-direction:column; gap:10px"});
    rows.forEach(r=>{
      const s = reg.summary ? reg.summary(r) : { title:(r.lot_number||r.id), sub:r.date||"" };
      const review = needsReview(r);
      const lhs = el("div",{style:"flex:1;min-width:0"});
      lhs.appendChild(el("div",{class:"ln", text:s.title}));
      if(s.sub) lhs.appendChild(el("div",{class:"meta", text:s.sub}));
      const tags = el("div",{style:"display:flex;flex-direction:column;gap:4px;align-items:flex-end"});
      tags.appendChild(modeChip(r.entry_mode));
      if(review) tags.appendChild(el("span",{class:"review-tag", text:"needs review"}));
      list.appendChild(el("button",{class:"lotrow", onclick:()=> openEdit(formType, r)},[lhs, tags]));
    });
    host.appendChild(list);
  }

  function modeChip(mode){
    const m = mode || "manual";
    const label = m==="scan" ? "📸 scan" : m==="scan_edited" ? "✏️ edited" : "manual";
    return el("span",{class:"mode-chip mode-"+m, text:label});
  }

  App.scan = {
    CLIENT_REGISTRY, extract, openEdit, listView,
    lowConfFields, needsReview, threshold, enabled, autoCommit,
    pendingEdit: null,
  };
})();
