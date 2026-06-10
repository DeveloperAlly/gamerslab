export default {
  async fetch(request, env) {
    const region = request.headers.get("X-Monitor-Region") || "unknown";
    const targetUrl = env.TARGET_URL;

    if (!targetUrl) {
      return new Response("TARGET_URL not set", { status: 500 });
    }

    const acceptLanguage = getAcceptLanguage(region);
    const start = Date.now();

    let status, ttfb, contentLanguage, bodySnippet;

    try {
      const resp = await fetch(targetUrl, {
        headers: {
          "Accept-Language": acceptLanguage,
          "User-Agent": "GeoMonitor/1.0",
          "X-Forwarded-For": request.headers.get("CF-Connecting-IP") || "",
        },
        cf: {
          cacheEverything: false,
        },
      });

      ttfb = Date.now() - start;
      status = resp.status;
      contentLanguage = resp.headers.get("Content-Language") || "";
      const text = await resp.text();
      bodySnippet = text.slice(0, 200);
    } catch (err) {
      return new Response(
        JSON.stringify({
          region,
          status: 0,
          error: err.message,
          ttfb_ms: Date.now() - start,
          cf_colo: request.cf?.colo || "unknown",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        region,
        status,
        ttfb_ms: ttfb,
        content_language: contentLanguage,
        accept_language_sent: acceptLanguage,
        cf_colo: request.cf?.colo || "unknown", // which Cloudflare PoP served this
        body_snippet: bodySnippet,
        ok: status >= 200 && status < 400,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};

function getAcceptLanguage(region) {
  const map = {
    "us-east": "en-US,en;q=0.9",
    "eu-west": "fr-FR,fr;q=0.9,en;q=0.8",
    "ap-southeast": "zh-CN,zh;q=0.9,en;q=0.8",
    "sa-east": "pt-BR,pt;q=0.9,en;q=0.8",
    "me-south": "ar-SA,ar;q=0.9,en;q=0.8",
    "af-south": "sw-KE,sw;q=0.9,en;q=0.8",
  };
  return map[region] || "en-US";
}
