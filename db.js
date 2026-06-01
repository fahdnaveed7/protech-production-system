/* =====================================================================
   Protech PWA — data layer (Step 2)
   - Loads supabase-js from CDN ONLY after a successful login.
   - Never blocks the UI: login + navigation work even if this fails.
   - Exposes window.PROTECH_DB with a status the shell can display.
   - All stage reads/writes are keyed by lot_number.
   ===================================================================== */
(function(){
  "use strict";
  const cfg = window.PROTECH_CONFIG || {};
  const DB = window.PROTECH_DB = {
    status: "idle",            // idle | loading | online | offline | no-key
    client: null,
    error: null,
    _ready: null,
    onStatus: null,            // shell sets this to a callback(status)
  };

  function setStatus(s, err){
    DB.status = s; DB.error = err || null;
    if(typeof DB.onStatus === "function"){ try{ DB.onStatus(s, err); }catch(_){} }
  }

  function hasKey(){
    const k = cfg.SUPABASE_ANON_KEY;
    return !!k && k !== "PASTE_ANON_KEY_HERE";
  }

  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = ()=> reject(new Error("CDN load failed: " + src));
      document.head.appendChild(s);
      // hard timeout so a blocked CDN doesn't hang forever
      setTimeout(()=> reject(new Error("CDN load timeout")), 12000);
    });
  }

  // Idempotent init — safe to call on every login.
  DB.init = function(){
    if(DB._ready) return DB._ready;
    DB._ready = (async ()=>{
      if(!hasKey()){ setStatus("no-key"); return DB; }
      setStatus("loading");
      try{
        if(!window.supabase || !window.supabase.createClient){
          await loadScript(cfg.SUPABASE_CDN);
        }
        DB.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
          auth:{ persistSession:false },
        });
        setStatus("online");
      }catch(err){
        DB.client = null;
        setStatus("offline", err.message);
      }
      return DB;
    })();
    return DB._ready;
  };

  // ---- Guard: every data call needs an online client ----
  function need(){
    if(DB.status !== "online" || !DB.client){
      throw new Error("Data layer not connected (" + DB.status + ")");
    }
    return DB.client;
  }
  DB.isOnline = ()=> DB.status === "online" && !!DB.client;

  // ---------- Generic helpers ----------
  DB.list = async function(table, { filters, order, ascending=false, limit } = {}){
    let q = need().from(table).select("*");
    if(filters) for(const [col,val] of Object.entries(filters)) q = q.eq(col, val);
    if(order) q = q.order(order, { ascending });
    if(limit) q = q.limit(limit);
    const { data, error } = await q;
    if(error) throw error;
    return data || [];
  };

  DB.insert = async function(table, row){
    const payload = { ...row, created_by_role: (window.App && App.role) ? App.role.id : null };
    const { data, error } = await need().from(table).insert(payload).select();
    if(error) throw error;
    return (data && data[0]) || null;
  };

  // ---------- Lot-centric helpers (spine = lot_number) ----------
  DB.listLots = ()=> DB.list("lots", { order:"created_at", ascending:false, limit:200 });

  DB.getLot = async function(lotNumber){
    const rows = await DB.list("lots", { filters:{ lot_number: lotNumber }, limit:1 });
    return rows[0] || null;
  };

  // Pull every stage row tied to a lot, for the timeline.
  DB.STAGE_TABLES = [
    "lot_grades","peeling_shed_reports","shed_receipts","peeling_output",
    "treatment_logs","production_plans","machine_events","temp_logs",
    "online_inspection_reports","qc_logs","packing_status","inventory_transactions",
  ];
  DB.listByLot = (table, lotNumber)=> DB.list(table, { filters:{ lot_number: lotNumber }, order:"created_at", ascending:true });

  // ---------- Photo upload, keyed to lot + stage ----------
  DB.uploadPhoto = async function(file, lotNumber, stage){
    const c = need();
    const safeLot = String(lotNumber).replace(/[^\w-]+/g,"_");
    const ext = (file.name && file.name.split(".").pop()) || "jpg";
    const path = `${safeLot}/${stage}/${Date.now()}.${ext}`;
    const { error } = await c.storage.from(cfg.PHOTO_BUCKET).upload(path, file, { upsert:false });
    if(error) throw error;
    const { data } = c.storage.from(cfg.PHOTO_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };
})();
