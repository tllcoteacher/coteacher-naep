// functions/index.ts
// Edge function entry point (Cloudflare Pages Workers or Vercel Edge Functions).
// Logic is coming in STEP 3; for now we return a placeholder response.

export default {
    async fetch(_request: Request): Promise<Response> {
      return new Response(
        "Coming soon — NAEP 8th-grade math below-proficient proportions.",
        { headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    },
  };
  