// functions/index.ts
// Cloudflare Pages Functions (also works on Vercel Edge).
// Reads geo from request.cf, loads our JSON (robust path detection), and returns minimal HTML.

type Entry = {
  text: string;          // e.g., "7 out of 10"
  ratio?: number;
  numerator?: number;
  denominator?: number;
};

type DataFile = {
  national: { US: Entry };
  states: Record<string, Entry>;
};

// USPS code -> full state name (50 states + DC)
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
};

// Try both common static paths so this works on Cloudflare Pages and Vercel without changes.
const DATA_PATHS = ["/below_proficient_latest.json", "/public/below_proficient_latest.json"];

async function loadData(request: Request): Promise<DataFile> {
  for (const p of DATA_PATHS) {
    const url = new URL(p, request.url);
    const res = await fetch(url.toString(), {
      // Cache static file at the edge for 5 min (OK to keep during dev too)
      cf: { cacheTtlByStatus: { "200-299": 300 } } as any
    }).catch(() => null as any);
    if (res && res.ok) return res.json();
  }
  throw new Error("Failed to load data file from known paths");
}

function pickPlace(cf: any, url: URL, data: DataFile) {
  // Cloudflare puts geo on request.cf
  let country = (cf?.country || "").toUpperCase();
  let region = (cf?.regionCode || "").toUpperCase();

  // Dev-only override so you can test different locations:
  // e.g., ?debug=1&country=US&region=SC
  if (url.searchParams.get("debug") === "1") {
    country = (url.searchParams.get("country") || country).toUpperCase();
    region = (url.searchParams.get("region") || region).toUpperCase();
  }

  // If U.S. + a known state code in our JSON, use state.
  if (country === "US" && region && data.states[region]) {
    const stateName = STATE_NAMES[region] || region;
    return { label: stateName, entry: data.states[region], scope: "state" as const };
  }

  // Otherwise use national.
  return { label: "United States", entry: data.national.US, scope: "national" as const };
}

function renderHTML(sentence: string, debugNote = ""): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sentence}</title>
<style>
  :root { --fg:#0b0b0b; --muted:#6b7280; --bg:#ffffff; }
  html,body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--fg); font: 500 18px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
  main { display:grid; place-items:center; min-height:100dvh; padding:24px; }
  .card { max-width: 42rem; text-align:center; }
  .lede { font-size: clamp(28px, 6vw, 44px); font-weight: 700; margin: 0 0 12px; letter-spacing: -0.015em; }
  .note { font-size: 14px; color: var(--muted); margin: 0; }
</style>
<body>
  <main role="main">
    <div class="card" aria-live="polite">
      <p class="lede">${sentence}</p>
      <p class="note">Detected via IP${debugNote}</p>
    </div>
  </main>
</body>
</html>`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const data = await loadData(request);
      const url = new URL(request.url);
      const place = pickPlace((request as any).cf, url, data);

      const frag = place.entry?.text?.trim();
      const valid = typeof frag === "string" && /^\d+ out of \d+$/.test(frag);
      const text = valid ? frag : data.national.US.text;

      const sentence = `${text} ${place.label} 8th graders are below proficient in math.`;
      const debugNote = url.searchParams.get("debug") === "1" ? " (debug override on)" : "";

      // We'll switch this to 'public, max-age=300' in STEP 5.
      return new Response(renderHTML(sentence, debugNote), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      const html = renderHTML("Sorry — the data is unavailable right now.", "");
      return new Response(html, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
  },
};
