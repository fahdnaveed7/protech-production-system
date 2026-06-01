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
};
