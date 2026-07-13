// import-photo — reads one or more photos (or a PDF) of a recipe — often a
// handwritten card, sometimes front and back — with the Google Gemini API (free
// tier) and returns one structured draft for the edit form to pre-fill. It never
// writes to the database; the human reviews/saves.
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
  "times, or servings. You may be given several photos of the SAME recipe (the " +
  "front and back of a card, or multiple pages) — combine them, in the order " +
  "given, into one complete recipe.\n\n" +
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

  // New callers send { images: [{ imageBase64, mimeType }] } (e.g. front and
  // back of a card); the old single { imageBase64, mimeType } shape still works.
  let images: { imageBase64: string; mimeType: string }[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body.images)) {
      images = body.images
        .filter((i: { imageBase64?: string }) => i?.imageBase64)
        .map((i: { imageBase64: string; mimeType?: string }) => ({
          imageBase64: i.imageBase64,
          mimeType: i.mimeType ?? "image/jpeg",
        }));
    } else if (body.imageBase64) {
      images = [{ imageBase64: body.imageBase64, mimeType: body.mimeType ?? "image/jpeg" }];
    }
  } catch (_) { /* falls through to the empty check */ }
  if (!images.length) return json({ error: "No file provided" }, 400);

  const payload = {
    contents: [{
      parts: [
        { text: PROMPT },
        ...images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.imageBase64 } })),
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
