// import-photo — reads a photo or PDF of a recipe (often a handwritten card)
// with the Google Gemini API (free tier) and returns a structured draft for the
// edit form to pre-fill. It never writes to the database; the human reviews/saves.
//
// Editor-only: we check is_editor() with the caller's JWT. The Gemini key is read
// from the GEMINI_API_KEY function secret and never exposed to the browser.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Override via the GEMINI_MODEL secret if Google renames the free-tier model.
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash";

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
  '{"title": string, "ingredients": [string], "instructions": [string], ' +
  '"prep_time_minutes": number|null, "cook_time_minutes": number|null, ' +
  '"servings": string|null}\n' +
  "Use null or [] for anything not present in the recipe.";

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

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "Couldn't reach the image reader. Try again." }, 502);
  }

  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    console.error("Gemini HTTP", resp.status, detail);
    return json({ error: `Image reader error (${resp.status}): ${detail}` }, 502);
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
    draft.warning = "Couldn't read a clear recipe from that file — try a sharper, well-lit photo, or enter it by hand.";
  }
  return json(draft);
});
