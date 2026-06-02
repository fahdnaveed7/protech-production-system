// =====================================================================
// Protech PWA — extract-form Edge Function
// One shared OCR/extraction pipeline for every paper stage form.
//
//   POST { form_type, image_url }   (or { form_type, image } as a data URL)
//   -> { fields:{<column>:value}, confidence:{<column>:0..1}, raw_text:"…" }
//
// The OpenAI key lives ONLY here as the OPENAI_API_KEY Edge secret — it is
// never shipped to the browser or any static file. The browser calls this
// function; this function calls OpenAI (gpt-4o-mini, vision).
//
// Adding scan to a new form = add ONE entry to FORM_REGISTRY below.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
// Optional soft auth: if set, the caller must send this in the `apikey`
// header (the app already ships the publishable key, so this is parity,
// not a secret). If unset, calls are allowed (keeps the trial frictionless).
const EXPECTED_CLIENT_KEY = Deno.env.get("CLIENT_KEY") || "";
const MODEL = "gpt-4o-mini";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ---- shared output contract every prompt must follow ----
const CONTRACT = `
Return ONE JSON object with exactly these top-level keys:
  "fields": an object mapping each column listed below to the value you read,
  "confidence": an object mapping each SAME column to a number 0..1 (how sure
     you are of that specific cell), and
  "raw_text": a plain-text transcription of everything legible on the sheet.
Rules:
- Use EXACTLY the column keys given — no extra keys, no renaming.
- If a cell is blank or you cannot read it, set its value to null AND set its
  confidence to a LOW number (<= 0.3). Never guess a value to fill a blank.
- Dates -> "YYYY-MM-DD". Times -> 24h "HH:MM". Numbers -> plain numbers (no
  units, no commas). Counts like "41/50" or "26/30" stay as the literal string.
- Temperatures are usually negative Celsius (e.g. -19.0); keep the sign.
- Lot codes are series/seq/year, e.g. "5/89/26".
- Booleans -> true/false.
Output JSON only — no prose, no markdown fences.`;

type FormDef = { columns: string[]; prompt: string };

const FORM_REGISTRY: Record<string, FormDef> = {
  // -------------------------------------------------------- 5D Shed Receipt
  shed_receipt: {
    columns: [
      "shed_name", "shed_contact", "date", "lot_number", "species",
      "header_count", "total_boxes", "total_kg", "notes",
    ],
    prompt: `You are reading a peeling-shed RECEIPT / invoice for an Indian shrimp
processor (Protech Organo Foods). Extract these columns:
- shed_name: the peeling shed / supplier name (text).
- shed_contact: phone or contact, if printed (text).
- date: receipt date.
- lot_number: lot code series/seq/year, e.g. "5/89/26" (text).
- species: "V" means Vannamei — expand "V" to "Vannamei". Black Tiger -> "Black Tiger".
- header_count: the count/grade printed at the header, e.g. "26/30", "41/50" (literal string).
- total_boxes: total number of boxes (number).
- total_kg: total weight in kg (number).
- notes: any other handwritten remark (text).`,
  },

  // ------------------------------------------------- 5A Peeling Shed Report
  peeling_shed_report: {
    columns: [
      "report_no", "date", "lot_number", "species", "input_count",
      "input_qty_kg", "converted_count", "converted_qty_kg", "yield_pct",
      "time_start", "time_finish", "section_in_charge", "production_in_charge",
      "remarks",
    ],
    prompt: `You are reading FORM 5A "Peeling Shed Report" for a shrimp processor.
Extract these columns:
- report_no: report number (text).
- date: report date.
- lot_number: lot code series/seq/year, e.g. "5/89/26".
- species: "V" -> "Vannamei"; otherwise as written.
- input_count: input count/grade, e.g. "HO 30/40" or "30/40" (literal string).
- input_qty_kg: input quantity in kg (number).
- converted_count: converted count after peeling, e.g. "41/50" (literal string).
- converted_qty_kg: converted quantity in kg (number).
- yield_pct: the yield percentage WRITTEN on the form (number) — do not compute it.
- time_start, time_finish: 24h times.
- section_in_charge, production_in_charge: names (text).
- remarks: any remark (text).`,
  },

  // ------------------------------------------ 5B Treatment Log FMT POF/PC/004
  treatment_log: {
    columns: [
      "date", "shift", "tub_no", "lot_number", "product", "species", "grade",
      "chemical_id", "salt_id", "colour_id", "ph_solution", "weight_kg",
      "count_before_soak", "count_after_soak", "pct_gain", "soak_in_time",
      "soak_out_time", "soln_temp_hr1", "soln_temp_hr2", "soln_temp_hr3",
      "additive_stpp_np", "additive_paprika", "additive_salt",
      "checked_by", "verified_by",
    ],
    prompt: `You are reading the "Treatment / Soaking Log" (FMT POF/PC/004) for a
shrimp processor — one tub per row; read the row indicated, or the first row if
unclear. Extract these columns:
- date: log date. shift: "D" (day) or "N" (night).
- tub_no: tub number (text).
- lot_number: lot code series/seq/year, e.g. "5/89/26".
- product: product code. Common codes: "R PD" (raw peeled-deveined),
  "R PTO" (raw PD tail-on), "R PTO(V)", "HL" (headless), "HON" (head-on).
  Keep the exact code as written.
- species: "V" -> "Vannamei"; else as written.
- grade: count/grade, e.g. "26/30" (literal string).
- chemical_id, salt_id, colour_id: batch IDs (text).
- ph_solution: pH of the soak solution (number).
- weight_kg: weight in kg (number).
- count_before_soak, count_after_soak: counts (literal strings like "26/30").
- pct_gain: the % weight gain WRITTEN on the form (number) — do not compute it.
- soak_in_time, soak_out_time: 24h times.
- soln_temp_hr1, soln_temp_hr2, soln_temp_hr3: solution temperatures at hour 1/2/3
  in Celsius (numbers, may be negative).
- additive_stpp_np, additive_paprika, additive_salt: booleans — true ONLY if that
  additive is ticked/marked present, else false. (Presence only — ignore weights.)
- checked_by, verified_by: names (text).`,
  },

  // ----------------------------------------- 5C Online Inspection (9-sample grid)
  online_inspection: {
    columns: [
      // header columns live at fields.* ; per-sample columns live at fields.samples[]
      "report_no", "date", "time", "market", "target_glaze_pct", "shift",
      "raw_production", "checked_by", "verified_by",
    ],
    prompt: `You are reading FORM 5C "Online Inspection Report (IQF)" for a shrimp
processor. This sheet is a GRID: a few header fields at the top, then UP TO 9
SAMPLE COLUMNS (S1..S9) running left-to-right, each sample sharing the same fixed
list of rows down the left edge.

Put the header fields directly in "fields":
- report_no, date, time(24h), market (e.g. "Russia"/"China"),
  target_glaze_pct (number, e.g. 7), shift ("D"/"N"), raw_production (text),
  checked_by, verified_by.

Put the samples in "fields".samples — an ARRAY with ONE object PER SAMPLE COLUMN,
in left-to-right order. CRITICAL: read each sample column straight down; never
shift or borrow a value from a neighbouring column. Each sample object has:
  sample_index (1..9, matching the column position),
  lot_number (series/seq/year), variety (text), grade (e.g. "26/30"),
  frozen_count, frozen_weight, glaze_pct, deglazed_count, deglazed_weight,
  thawed_weight, thawed_count, uniformity,
  and this FIXED 16-point defect checklist (integer = number of pieces affected,
  null if blank):
    defect_freezer_burn, defect_deterioration, defect_discolouration,
    defect_dehydration, defect_black_spot, defect_black_ring, defect_broken,
    defect_damaged_bruised, defect_vein, defect_loose_shell, defect_soft_shell,
    defect_semi_peeled, defect_clumps, defect_foreign_matter,
    defect_foreign_veg_matter,
  plus core_temp and surface_temp (Celsius, may be negative) and no_of_cases (int).

Mirror the structure in "confidence": header-field confidences directly under
"confidence", and "confidence".samples as an array of objects with the SAME keys
as each sample, each value 0..1. Counts like "26/30" stay literal strings.
Only include a sample object for columns that actually have data; set a cell to
null + low confidence when blank or illegible.`,
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // optional soft auth (parity with the already-public publishable key)
  if (EXPECTED_CLIENT_KEY) {
    const sent = req.headers.get("apikey") || "";
    if (sent !== EXPECTED_CLIENT_KEY) return json({ error: "unauthorized" }, 401);
  }
  if (!OPENAI_API_KEY) {
    return json(
      { error: "OPENAI_API_KEY secret is not set on the Edge Function." },
      500,
    );
  }

  let body: { form_type?: string; image_url?: string; image?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const formType = (body.form_type || "").trim();
  const def = FORM_REGISTRY[formType];
  if (!def) {
    return json(
      { error: `Unknown form_type "${formType}". Known: ${Object.keys(FORM_REGISTRY).join(", ")}` },
      400,
    );
  }

  const imageUrl = body.image_url ||
    (body.image
      ? (body.image.startsWith("data:") ? body.image : `data:image/jpeg;base64,${body.image}`)
      : "");
  if (!imageUrl) return json({ error: "Provide image_url or image" }, 400);

  const system = `${def.prompt}\n\nColumns: ${def.columns.join(", ")}.\n${CONTRACT}`;

  let oaRes: Response;
  try {
    oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the fields from this photographed paper form. Return JSON only." },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    return json({ error: "OpenAI request failed: " + String((e as Error).message || e) }, 502);
  }

  if (!oaRes.ok) {
    const txt = await oaRes.text().catch(() => "");
    return json({ error: `OpenAI ${oaRes.status}: ${txt.slice(0, 500)}` }, 502);
  }

  let parsed: { fields?: unknown; confidence?: unknown; raw_text?: unknown };
  try {
    const data = await oaRes.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    parsed = JSON.parse(content);
  } catch (e) {
    return json({ error: "Could not parse model output: " + String((e as Error).message || e) }, 502);
  }

  return json({
    form_type: formType,
    fields: parsed.fields ?? {},
    confidence: parsed.confidence ?? {},
    raw_text: parsed.raw_text ?? "",
    model: MODEL,
  });
});
