// src/worker.ts
// Entry point for Cloudflare Worker

export default {
  async fetch(request: Request): Promise<Response> {
    return new Response('Hello from NAEP Worker!', { status: 200 });
  }
};
