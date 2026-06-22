// import-url — fetches a recipe page server-side (browsers can't, due to CORS)
// and extracts a draft from its schema.org/Recipe JSON-LD. Returns the draft for
// the edit form to pre-fill; it never writes to the database.
//
// Restricted to allowlisted editors: we call is_editor() with the caller's JWT
// so this can't be abused as an open URL-fetch proxy.
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// ISO-8601 duration (e.g. "PT1H30M") -> minutes
function isoToMinutes(d: unknown): number | null {
  if (typeof d !== "string") return null;
  const m = d.match(/P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  const total = parseInt(m[1] || "0", 10) * 60 + parseInt(m[2] || "0", 10);
  return total || null;
}

function instructionText(step: unknown): string {
  if (typeof step === "string") return step.trim();
  if (step && typeof step === "object") {
    const o = step as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.name === "string") return o.name.trim();
  }
  return "";
}

// Recursively locate a node whose @type includes "Recipe" (handles @graph).
function findRecipe(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  const types = asArray(o["@type"]).map((t) => String(t).toLowerCase());
  if (types.includes("recipe")) return o;
  if (o["@graph"]) return findRecipe(o["@graph"]);
  return null;
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

  let url = "";
  try {
    url = (await req.json()).url ?? "";
  } catch (_) { /* invalid body falls through to the scheme check */ }
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
  } catch {
    return json({ error: "URL must be an http(s) link" }, 400);
  }

  let html = "";
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (recipes.cartergividen.com importer)" },
      redirect: "follow",
    });
    if (!resp.ok) throw new Error();
    html = await resp.text();
  } catch {
    return json({ error: "Could not fetch that URL" }, 502);
  }

  const blocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  let recipe: Record<string, unknown> | null = null;
  for (const b of blocks) {
    try {
      recipe = findRecipe(JSON.parse(b[1].trim()));
      if (recipe) break;
    } catch (_) { /* skip malformed JSON-LD */ }
  }

  const draft: Record<string, unknown> = {
    title: "",
    ingredients: [],
    instructions: [],
    tags: [],
    source_url: url,
  };

  if (recipe) {
    draft.title = String(recipe.name ?? "").trim();
    draft.ingredients = asArray(recipe.recipeIngredient)
      .map((s) => String(s).trim())
      .filter(Boolean);

    const steps: string[] = [];
    const ri = recipe.recipeInstructions;
    if (typeof ri === "string") {
      steps.push(...ri.split("\n").map((s) => s.trim()).filter(Boolean));
    } else {
      for (const item of asArray(ri)) {
        const t = item && typeof item === "object"
          ? String((item as Record<string, unknown>)["@type"] ?? "").toLowerCase()
          : "";
        if (t === "howtosection") {
          for (const sub of asArray((item as Record<string, unknown>).itemListElement)) {
            const txt = instructionText(sub);
            if (txt) steps.push(txt);
          }
        } else {
          const txt = instructionText(item);
          if (txt) steps.push(txt);
        }
      }
    }
    draft.instructions = steps;
    draft.prep_time_minutes = isoToMinutes(recipe.prepTime);
    draft.cook_time_minutes = isoToMinutes(recipe.cookTime);
    const y = recipe.recipeYield;
    draft.servings = y != null ? String(asArray(y)[0]).trim() : null;
  }

  if (
    !(draft.ingredients as string[]).length &&
    !(draft.instructions as string[]).length
  ) {
    draft.warning =
      "Couldn't find a structured recipe on that page. You may need to enter the details manually.";
  }
  return json(draft);
});
