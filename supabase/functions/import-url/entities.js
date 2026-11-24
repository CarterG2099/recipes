// Recipe sites often leave HTML entities (&nbsp;, &amp;, &#39;) in their JSON-LD
// text, sometimes double-encoded (&amp;nbsp;). The site shows recipe text as
// plain text, so they must be turned back into real characters at import.
const NAMED = new Map(Object.entries({
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ndash: "–", mdash: "—", hellip: "…", deg: "°", frac12: "½", frac14: "¼",
  frac34: "¾", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", times: "×",
  eacute: "é", egrave: "è", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä",
  ccedil: "ç", reg: "®", trade: "™", copy: "©", bull: "•", middot: "·",
}));

function decodeOnce(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (code === 0xa0) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED.get(body) ?? whole;
  });
}

export function decodeEntities(s) {
  let prev = s;
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(prev);
    if (next === prev) break;
    prev = next;
  }
  return prev.replace(/ /g, " ").replace(/ {2,}/g, " ").trim();
}
