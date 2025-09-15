/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ASSETS: Fetcher; // static assets binding (public/)
}

/** ===== Types for naep.json ===== */
type RatioText = `${number} out of ${number}`;
interface NaepValue {
  text: RatioText;
  ratio?: number;
  numerator?: number;
  denominator?: number;
}
interface NaepData {
  national: { US: NaepValue };
  states: Record<string, NaepValue>;
}

/** ===== In-memory cache for naep.json ===== */
let NAEP_DATA_PROMISE: Promise<NaepData> | null = null;

/** ===== USPS -> Full state name map ===== */
const STATE_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

/** ===== Utility: strict-validate the JSON we load ===== */
const TEXT_RE = /^\d+ out of \d+$/;
function isValidValue(v: any): v is NaepValue {
  return v && typeof v.text === "string" && TEXT_RE.test(v.text);
}
function validateData(d: any): d is NaepData {
  if (!d || typeof d !== "object") return false;
  if (!d.national || !d.national.US || !isValidValue(d.national.US)) return false;
  if (!d.states || typeof d.states !== "object") return false;
  for (const [k, v] of Object.entries(d.states)) {
    if (typeof k !== "string" || k.length !== 2) return false;
    if (!isValidValue(v)) return false;
  }
  return true;
}

/** ===== Load naep.json from the static Assets binding ===== */
async function loadNaep(env: Env): Promise<NaepData> {
  if (!NAEP_DATA_PROMISE) {
    NAEP_DATA_PROMISE = (async () => {
      const res = await env.ASSETS.fetch("https://assets.local/naep.json");
      if (!res.ok) throw new Error(`Failed to load naep.json: ${res.status}`);
      const json = await res.json();
      if (!validateData(json)) throw new Error("naep.json failed schema validation");
      return json as NaepData;
    })();
  }
  return NAEP_DATA_PROMISE;
}

/** ===== Resolve region from Cloudflare request.cf ===== */
function resolveRegion(req: Request): { country: string | null; stateCode: string | null } {
  const cf = (req as any).cf || {};
  const country = typeof cf.country === "string" ? (cf.country as string) : null;
  const stateCode = typeof cf.regionCode === "string" ? (cf.regionCode as string) : null;
  return { country, stateCode };
}

/** ===== Choose the NAEP record ===== */
function chooseNaepRecord(data: NaepData, country: string | null, stateCode: string | null) {
  if (country === "US" && stateCode && data.states[stateCode]) {
    const name = STATE_NAME[stateCode] ?? stateCode;
    return { scopeLabel: name, value: data.states[stateCode], isNational: false };
  }
  return { scopeLabel: "U.S.", value: data.national.US, isNational: true };
}

/** ===== Map ratio text to an image key =====
 *  Supported:
 *   - 3 out of 4   => "three"
 *   - 7 out of 10  => "seven"
 *   - 8 out of 10  => "eight"
 *   - 9 out of 10  => "nine"
 *  Anything else => null (no image)
 */
function ratioTextToImageKey(text: RatioText): "three" | "seven" | "eight" | "nine" | null {
  const m = text.match(/^(\d+)\s+out\s+of\s+(\d+)$/);
  if (!m) return null;
  const num = Number(m[1]), den = Number(m[2]);
  if (num === 3 && den === 4) return "three";
  if (num === 7 && den === 10) return "seven";
  if (num === 8 && den === 10) return "eight";
  if (num === 9 && den === 10) return "nine";
  return null;
}

/** ===== Try to confirm an image exists in /public/images ===== */
async function imageExists(env: Env, key: string): Promise<boolean> {
  const url = `https://assets.local/images/${key}.webp`;
  // HEAD should be supported for static assets; fallback to GET if a provider disallows HEAD
  const res = await env.ASSETS.fetch(url, { method: "HEAD" });
  if (res.ok) return true;
  if (res.status === 405) {
    const getRes = await env.ASSETS.fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    return getRes.ok;
  }
  return false;
}

/** ===== HTML templates (Deep Indigo, zero-JS) ===== */

function baseHeaders(extra?: Record<string, string>): Headers {
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    ...(extra || {})
  });
}

function layoutHTML(title: string, body: string, opts?: { noindex?: boolean }) {
  const metaRobots = opts?.noindex ? `<meta name="robots" content="noindex" />` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
${metaRobots}
<style>
  :root{
    --page-bg:#EEF2FF; --card-bg:#F9FAFF; --ink:#222739;
    --muted:#5A6B86; --accent:#3F5BD8;
    --maxw: 64rem;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --page-bg:#0F1424; --card-bg:#12192A; --ink:#E7ECF6;
      --muted:#9AA3AF; --accent:#6F86FF;
    }
  }
  html{scroll-behavior:smooth}
  body{
    margin:0; background:var(--page-bg);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
    -webkit-font-smoothing:antialiased;
    font-variant-numeric: lining-nums tabular-nums;
    color:var(--ink);
  }
  .wrap{max-width:var(--maxw); margin:0 auto; padding: clamp(1rem, 4vw, 2.5rem) clamp(1rem, 3.5vw, 1.5rem); display:grid; gap:clamp(1rem, 2vw, 1.5rem)}
  .card{
    background:var(--card-bg);
    border-radius:18px;
    padding:clamp(1.25rem, 3.2vw, 2rem);
    box-shadow: 0 12px 28px rgba(2,12,44,.08), 0 2px 8px rgba(2,12,44,.06);
  }
  .hero{display:block}
  h1.hero-line{
    margin:0; line-height:1.1; font-weight:800;
    font-size: clamp(1.75rem, 4.2vw + .5rem, 3.25rem);
    letter-spacing:.002em; text-wrap: balance; text-align:left;
  }
  .num{color:var(--accent); font-weight:900}
  .small{font-size:.9em; opacity:.9}
  .lede{margin:.5rem 0 0; font-size:clamp(1.05rem, 1.1vw + .7rem, 1.25rem); opacity:.9}
  .note{margin-top:.35rem; color:var(--muted); font-size:.98rem}

  /* Responsive, CLS-safe 3:2 image block */
  .img-wrap{width:min(100%,56.25rem); aspect-ratio:3/2; margin:0 auto}
  .img-wrap img{width:100%; height:100%; object-fit:contain; border-radius:16px; display:block}

  /* Info card headings */
  .h2{margin:0 0 .35rem; font-weight:800; font-size:clamp(1.1rem, 1.4vw + .7rem, 1.5rem)}
  .body{font-size:clamp(1rem, 1vw + .6rem, 1.1rem)}

  /* Utilities */
  .stack{display:grid; gap:clamp(.9rem, 1.6vw, 1.25rem)}
  a.btn{display:inline-block; margin-top:.9rem; padding:.7rem 1rem; border-radius:.75rem; border:1px solid rgba(34,39,57,.15); text-decoration:none; color:inherit; font-weight:700}
  a.btn:focus{outline:3px solid var(--accent); outline-offset:2px}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function homeHTML(fragment: RatioText, label: string, imageHTML: string) {
  const title = `${fragment} ${label} 8th graders are below proficient in math.`;
  const body = `<main class="wrap" role="main">
  <section class="card hero">
    <h1 class="hero-line"><span class="num">${escapeHtml(fragment.split(" out of ")[0])}</span> <span class="small">out of</span> <span class="num">${escapeHtml(fragment.split(" out of ")[1])}</span> ${escapeHtml(label)} 8th graders are below proficient in math.</h1>
    <p class="lede">They are deep down a road of a lifetime of lost potential.</p>
    <a class="btn" href="#how" aria-describedby="ip-note">See How</a>
    <p id="ip-note" class="note">Detected via IP.</p>
  </section>

  ${imageHTML}

  <section id="how" class="card stack">
    <div class="h2">How this number is chosen</div>
    <div class="body">We detect your location via IP at the moment of request and select the corresponding state’s share of 8th graders below proficient in mathematics from a bundled NAEP dataset. If a state cannot be determined, we show the U.S. national number.</div>
    <div class="body">This site is static, makes no external calls, and uses a single JSON file built into the deployment. No cookies or identifiers are stored.</div>
  </section>
</main>`;
  return layoutHTML(title, body, { noindex: false });
}

function investorHTML() {
  const title = "Math CoTeacher — Investor Notes";
  const body = `<main class="wrap" role="main">
  <section class="card hero">
    <h1 class="hero-line">Investor Overview</h1>
    <p class="lede">This page is intentionally not linked from the homepage.</p>
  </section>
  <section class="card stack">
    <div class="h2">Why this matters</div>
    <div class="body">Large-scale proficiency gaps persist across states; scalable interventions and teacher-augmentation unlock step-change outcomes.</div>
    <div class="h2" style="margin-top: .75rem;">Approach</div>
    <div class="body">Zero-friction awareness, clear framing of the problem, and a credible path to intervention across school systems.</div>
  </section>
</main>`;
  return layoutHTML(title, body, { noindex: true });
}

function notFoundHTML() {
  const body = `<main class="wrap" role="main">
  <section class="card hero"><h1 class="hero-line">Not Found</h1><p class="lede">The page you requested does not exist.</p></section>
</main>`;
  return layoutHTML("Not Found", body, { noindex: false });
}

/** Build the image block HTML if we have a known key and the asset exists */
function buildImageBlockHTML(key: string, alt: string): string {
  const src = `/images/${key}.webp`;
  return `<div class="img-wrap" role="figure">
    <img src="${src}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" />
  </div>`;
}

/** ===== Escape utility ===== */
function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** ===== Worker entry ===== */
export default {
  async fetch(request, env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: baseHeaders()
        });
      }

      if (url.pathname === "/investor") {
        return new Response(investorHTML(), {
          status: 200,
          headers: baseHeaders({ "X-Robots-Tag": "noindex" })
        });
      }

      if (url.pathname === "/") {
        const data = await loadNaep(env as Env);
        const { country, stateCode } = resolveRegion(request);
        const { scopeLabel, value } = chooseNaepRecord(data, country, stateCode);

        // Format safely: exact "X out of Y {Label} 8th graders..."
        const fragment = value.text as RatioText;
        let imageHTML = "";
        const key = ratioTextToImageKey(fragment);
        if (key && (await imageExists(env as Env, key))) {
          const alt = `${fragment} ${scopeLabel} 8th graders below proficient — visualization`;
          imageHTML = buildImageBlockHTML(key, alt);
        }

        const html = homeHTML(fragment, scopeLabel, imageHTML);
        return new Response(html, { status: 200, headers: baseHeaders() });
      }

      return new Response(notFoundHTML(), { status: 404, headers: baseHeaders() });
    } catch (err) {
      console.error(err);
      const body = `<main class="wrap" role="main">
        <section class="card hero">
          <h1 class="hero-line">Temporary Error</h1>
          <p class="lede">Falling back to the U.S. number.</p>
        </section>
      </main>`;
      return new Response(layoutHTML("Temporary Error", body), {
        status: 200,
        headers: baseHeaders()
      });
    }
  }
} satisfies ExportedHandler<Env>;
