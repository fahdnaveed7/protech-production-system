/* =====================================================================
   Protech PWA — runtime config
   The anon (publishable) key is a CLIENT-SIDE key, safe to ship in a
   static site. RLS is open for this single-org internal tool.
   Paste the anon key from Supabase → Project Settings → API.
   ===================================================================== */
window.PROTECH_CONFIG = {
  SUPABASE_URL: "https://ymoewukjsrbggchqzfbc.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_ziyCxVbFtRqjUaGmBocFOA_FkmxYmIz",
  PHOTO_BUCKET: "protech-photos",
  // supabase-js UMD build, loaded lazily only after a successful login
  SUPABASE_CDN: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",

  // ---- Scan-to-fill (photograph the paper form → AI extraction) ----
  // ONE shared pipeline (see scan.js + the extract-form Edge Function).
  // The OpenAI key lives ONLY as the OPENAI_API_KEY Edge secret — never here.
  SCAN: {
    ENABLED: true,             // master switch for the Scan / Edit buttons
    AUTO_COMMIT: true,         // TRIAL MODE: true = save the extracted row
                               // immediately; flip to false to make the user
                               // review + tap Save first. No other code changes.
    CONFIDENCE_THRESHOLD: 0.7, // fields read below this are flagged "needs review"
    FUNCTION: "extract-form",  // the Supabase Edge Function slug
  },
};
