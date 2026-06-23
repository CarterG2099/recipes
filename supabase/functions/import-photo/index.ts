// import-photo — reads a photo of a recipe (often a handwritten card) with the
// Google Gemini API (free tier) and returns a structured draft for the edit form
// to pre-fill. It never writes to the database; the human reviews and saves.
//
// Editor-only: we check is_editor() with the caller's JWT. The Gemini key is read
// from the GEMINI_API_KEY function secret and never exposed to the browser.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "gemini-2.0-flash";

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
  "sometimes a printout or web export. Transcribe it faithfully into structured " +
  "fields. Keep ingredient and step wording close to the original; expand only " +
  "obvious abbreviations (PB -> peanut butter, tsp, tbsp, etc.). Do not invent " +
  "steps, times, or servings. If prep time, cook time, or servings are not " +
  "written, leave them null.";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    ingredients: { type: "array", items: { type: "string" } },
    instructions: { type: "array", items: { type: "string" } },
    prep_time_minutes: { type: "integer", nullable: true },
    cook_time_minutes: { type: "integer", nullable: true },
    servings: { type: "string", nullable: true },
  },
  required: ["title", "ingredients", "instructions"],
};

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
  if (!imageBase64) return json({ error: "No image provided" }, 400);

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
  };

  let extracted: Record<string, unknown> | null = null;
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.error("Gemini error", resp.status, detail.slice(0, 500));
      return json({ error: "The image reader had a problem. Try again." }, 502);
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    extracted = JSON.parse(text);
  } catch (e) {
    console.error("Gemini parse error", String(e));
    return json({ error: "Couldn't read a recipe from that photo." }, 502);
  }

  const draft: Record<string, unknown> = {
    title: String(extracted?.title ?? "").trim(),
    ingredients: Array.isArray(extracted?.ingredients)
      ? (extracted!.ingredients as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : [],
    instructions: Array.isArray(extracted?.instructions)
      ? (extracted!.instructions as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : [],
    prep_time_minutes: typeof extracted?.prep_time_minutes === "number" ? extracted!.prep_time_minutes : null,
    cook_time_minutes: typeof extracted?.cook_time_minutes === "number" ? extracted!.cook_time_minutes : null,
    servings: extracted?.servings != null ? String(extracted!.servings).trim() : null,
    tags: [],
  };
  if (!(draft.ingredients as string[]).length && !(draft.instructions as string[]).length) {
    draft.warning = "Couldn't read a clear recipe from that photo — try a sharper, well-lit shot, or enter it by hand.";
  }
  return json(draft);
});
