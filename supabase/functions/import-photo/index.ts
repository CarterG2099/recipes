// import-photo — reads a photo or PDF of a recipe (often a handwritten card)
// with the Google Gemini API (free tier) and returns a structured draft for the
// edit form to pre-fill. It never writes to the database; the human reviews/saves.
//
// Editor-only: we check is_editor() with the caller's JWT. The Gemini key is read
// from the GEMINI_API_KEY function secret and never exposed to the browser.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Primary model (best quality when it has capacity); override via GEMINI_MODEL.
// If it's overloaded (503), we fall back through the MODELS list below.
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const PROMPT =
  "You are reading a photo or PDF of a recipe — sometimes a handwritten card, " +
  "sometimes a printout or web export. Transcribe it faithfully. Expand only " +
  "obvious abbreviations (PB -> peanut butter, tsp, tbsp). Do not invent steps, " +
  "times, or servings.\n\n" +
  "Return ONLY a JSON object with exactly these keys:\n" +
  '{"title": string, ' +
  '"ingredients": [ {"qty": number|null, "unit": string|null, "item": string} ], ' +
  '"instructions": [string], ' +
  '"prep_time_minutes": number|null, "cook_time_minutes": number|null, ' +
  '"servings": string|null}\n' +
  "For each ingredient: qty is a decimal (0.5 for ½, 1.5 for 1½) or null; unit is " +
  "one of cup, tbsp, tsp, oz, lb, ml, l, g, kg, clove, can, pinch — or null; item is " +
  "the food itself (no amount/unit). Use null or [] for anything not present.";

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: isEditor } = await supabase.rpc("is_editor");
  if (!isEditor) return json({ error: "Not authorized to import" }, 403);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "Image import isn't configured yet (missing GEMINI_API_KEY)." }, 503);

  let imageBase64 = "";
  let mimeType = "image/jpeg";
  try {
    const body = await req.json();
    imageBase64 = body.imageBase64 ?? "";
    mimeType = body.mimeType ?? "image/jpeg";
  } catch (_) { /* falls through to the empty check */ }
  if (!imageBase64) return json({ error: "No file provided" }, 400);

  const payload = {
    contents: [{
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  // Free-tier flash capacity is shared and gets deprioritized (503) under load.
  // Retry each model a couple of times, then fall back to lighter models that
  // usually have spare capacity. 404 (model unavailable) / 429 (quota) also fall
  // through to the next model; a hard 4xx stops everything.
  const MODELS = [...new Set([
    MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite",
    "gemini-3.5-flash", "gemini-3.5-flash-lite",
  ])];
  let resp: Response | null = null;
  let lastStatus = 0;
  let lastDetail = "";

  for (const model of MODELS) {
    let hardError = false;
    for (let attempt = 0; attempt < 2 && !resp; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
      let r: Response;
      try {
        r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
        );
      } catch (_) {
        lastStatus = 0; lastDetail = "network error"; continue;
      }
      if (r.ok) { resp = r; break; }
      lastStatus = r.status;
      lastDetail = (await r.text()).slice(0, 300);
      if (r.status === 503) continue;                 // overloaded — retry this model
      if (r.status === 404 || r.status === 429) break; // try the next model
      hardError = true; break;                         // bad request etc. — stop
    }
    if (resp || hardError) break;
  }

  if (!resp) {
    console.error("Gemini HTTP", lastStatus, lastDetail);
    const friendly = lastStatus === 503
      ? "The reader is busy right now — please try again in a moment."
      : `Image reader error (${lastStatus}): ${lastDetail}`;
    return json({ error: friendly }, 502);
  }

  let extracted: Record<string, unknown>;
  try {
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "empty response";
      return json({ error: `The reader returned nothing (${reason}).` }, 502);
    }
    extracted = JSON.parse(stripFences(text));
  } catch (e) {
    console.error("Gemini parse error", String(e));
    return json({ error: "Couldn't read a recipe from that file." }, 502);
  }

  // Normalize ingredients into structured rows, tolerating either the new object
  // shape {qty,unit,item} or a plain string (older prompt / model drift).
  const fmtNum = (n: number) => {
    const map: Record<string, string> = { "0.5": "1/2", "0.25": "1/4", "0.75": "3/4", "0.33": "1/3", "0.67": "2/3" };
    if (Number.isInteger(n)) return String(n);
    const w = Math.floor(n), f = +(n - w).toFixed(2);
    const fr = map[String(f)];
    return fr ? (w ? `${w} ${fr}` : fr) : String(Math.round(n * 100) / 100);
  };
  const structToText = (o: { qty: number | null; unit: string | null; item: string }) => {
    if (o.qty == null) return o.item;
    return `${fmtNum(o.qty)}${o.unit ? " " + o.unit : ""} ${o.item}`.trim();
  };
  const struct = (Array.isArray(extracted?.ingredients) ? extracted!.ingredients as unknown[] : [])
    .map((o) => {
      if (typeof o === "string") return { qty: null, unit: null, item: o.trim() };
      const r = o as Record<string, unknown>;
      return {
        qty: typeof r.qty === "number" ? r.qty : null,
        unit: r.unit ? String(r.unit).toLowerCase() : null,
        item: String(r.item ?? "").trim(),
      };
    })
    .filter((o) => o.item || o.qty != null);

  const instructions = Array.isArray(extracted?.instructions)
    ? (extracted!.instructions as unknown[]).map((s) => String(s).trim()).filter(Boolean)
    : [];

  const draft: Record<string, unknown> = {
    title: String(extracted?.title ?? "").trim(),
    ingredients_struct: struct,
    ingredients: struct.map(structToText), // derived text for the live/text path
    instructions,
    prep_time_minutes: typeof extracted?.prep_time_minutes === "number" ? extracted!.prep_time_minutes : null,
    cook_time_minutes: typeof extracted?.cook_time_minutes === "number" ? extracted!.cook_time_minutes : null,
    servings: extracted?.servings != null ? String(extracted!.servings).trim() : null,
    tags: [],
  };
  if (!struct.length && !instructions.length) {
    draft.warning = "Couldn't read a clear recipe from that file — try a sharper, well-lit photo, or enter it by hand.";
  }
  return json(draft);
});
