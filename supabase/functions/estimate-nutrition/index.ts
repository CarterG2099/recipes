// estimate-nutrition — estimates a recipe's macros from its ingredient list with
// the Google Gemini API and returns an unsaved draft for the edit form to
// review. It never writes to the database; the human corrects and saves, which
// is also the override mechanism — editing any number marks the row `manual`.
//
// Mirrors import-photo: editor-only via is_editor() with the caller's JWT, the
// Gemini key from the GEMINI_API_KEY function secret, the same model fallback.
//
// The model is asked for a PER-INGREDIENT breakdown and nothing else. Totals
// and per-serving figures are summed and divided here, in code, so a wrong
// number can always be traced to the ingredient that caused it and the three
// levels can never disagree with each other.
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const MACROS = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg"] as const;
type Macro = typeof MACROS[number];
type Row = Record<Macro, number | null>;

const PROMPT =
  "You are a nutritionist estimating the nutrition of a home recipe from its " +
  "ingredient list. For EACH ingredient line, estimate the nutrition of the " +
  "WHOLE quantity stated on that line, as it goes into the recipe — not per " +
  "100 g and not per serving. Use standard reference values (USDA) and typical " +
  "densities for volume measures. If a line is not food (a heading, 'salt to " +
  "taste', water, a garnish with negligible nutrition) return zeros for it and " +
  "say so in the note. If a quantity is missing or vague, assume a typical " +
  "amount for a recipe of this kind and say what you assumed in the note. " +
  "Return exactly one entry per ingredient line, in the same order, and keep " +
  "the `ingredient` text identical to the input line.";

// Structured output. A schema means no fence-stripping and no missing keys,
// and it forces one row per ingredient rather than a prose summary.
const SCHEMA = {
  type: "OBJECT",
  properties: {
    ingredients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ingredient: { type: "STRING" },
          calories: { type: "NUMBER" },
          protein_g: { type: "NUMBER" },
          carbs_g: { type: "NUMBER" },
          fat_g: { type: "NUMBER" },
          fiber_g: { type: "NUMBER" },
          sodium_mg: { type: "NUMBER" },
          note: { type: "STRING" },
        },
        required: ["ingredient", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg"],
      },
    },
    servings_guess: {
      type: "NUMBER",
      description: "How many servings this recipe most likely makes, if the request did not say.",
    },
  },
  required: ["ingredients"],
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

function sum(rows: Row[]): Row {
  const out = {} as Row;
  for (const m of MACROS) {
    // A total is only known when every part is. One unknown ingredient makes
    // the total unknown rather than quietly smaller.
    const parts = rows.map((r) => r[m]);
    out[m] = parts.some((v) => v == null) ? null : round(parts.reduce((a, b) => a! + b!, 0)!, 1);
  }
  return out;
}

function divide(totals: Row, by: number): Row {
  const out = {} as Row;
  for (const m of MACROS) out[m] = totals[m] == null ? null : round(totals[m]! / by, 1);
  return out;
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
  if (!isEditor) return json({ error: "Not authorized to estimate nutrition" }, 403);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "Nutrition estimates aren't configured yet (missing GEMINI_API_KEY)." }, 503);

  let title = "";
  let ingredients: string[] = [];
  let servingsCount: number | null = null;
  try {
    const body = await req.json();
    title = String(body?.title ?? "").trim();
    ingredients = Array.isArray(body?.ingredients)
      ? body.ingredients.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [];
    servingsCount = num(body?.servings_count);
  } catch (_) { /* falls through to the empty check */ }
  if (!ingredients.length) return json({ error: "No ingredients to estimate from." }, 400);

  const request =
    `Recipe: ${title || "(untitled)"}\n` +
    (servingsCount ? `Makes ${servingsCount} servings.\n` : "The number of servings is not known; include your best guess as servings_guess.\n") +
    "Ingredients, one per line:\n" +
    ingredients.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const payload = {
    contents: [{ parts: [{ text: PROMPT }, { text: request }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
    },
  };

  // Same fallback ladder as import-photo: retry a 503, step past 404/429, stop
  // on anything else.
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
      if (r.status === 503) continue;
      if (r.status === 404 || r.status === 429) break;
      hardError = true; break;
    }
    if (resp || hardError) break;
  }

  if (!resp) {
    console.error("Gemini HTTP", lastStatus, lastDetail);
    const friendly = lastStatus === 503
      ? "The estimator is busy right now — please try again in a moment."
      : `Nutrition estimator error (${lastStatus}): ${lastDetail}`;
    return json({ error: friendly }, 502);
  }

  let parsed: { ingredients?: unknown[]; servings_guess?: unknown };
  try {
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "empty response";
      return json({ error: `The estimator returned nothing (${reason}).` }, 502);
    }
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("Gemini parse error", String(e));
    return json({ error: "Couldn't read an estimate back from the model." }, 502);
  }

  const rows = (Array.isArray(parsed.ingredients) ? parsed.ingredients : []).map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {
      ingredient: String(row.ingredient ?? "").trim(),
      note: row.note ? String(row.note).trim() : null,
    };
    for (const m of MACROS) out[m] = num(row[m]);
    return out as Row & { ingredient: string; note: string | null };
  });

  if (!rows.length) return json({ error: "The estimator returned no ingredients." }, 502);

  const totals = sum(rows);
  const servings = servingsCount ?? num(parsed.servings_guess) ?? null;
  const perServing = servings && servings > 0 ? divide(totals, servings) : null;

  const draft: Record<string, unknown> = {
    ingredients: rows,
    totals,
    servings_count: servings,
    servings_guessed: servingsCount == null && servings != null,
    per_serving: perServing,
  };

  if (rows.length !== ingredients.length) {
    draft.warning = `The estimate covers ${rows.length} of ${ingredients.length} ingredient lines — check the breakdown.`;
  } else if (!perServing) {
    draft.warning = "Enter how many servings this makes to get per-serving numbers.";
  }

  return json(draft);
});
