export default {
  async fetch(request, env) {
    const region = request.headers.get("X-Monitor-Region") || "unknown";
    const targetUrl = env.TARGET_URL;

    if (!targetUrl) {
      return new Response("TARGET_URL not set", { status: 500 });
    }

    const acceptLanguage = getAcceptLanguage(region);
    const start = Date.now();

    try {
      const resp = await fetch(targetUrl, {
        headers: {
          "Accept-Language": acceptLanguage,
          // Realistic browser UA — itch.io blocks obvious bot user agents
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        cf: {
          cacheEverything: false,
        },
      });

      const ttfb = Date.now() - start;
      const status = resp.status;
      const contentLanguage = resp.headers.get("Content-Language") || "";
      const text = await resp.text();

      // Check body confirms page loaded — not a bot block / Cloudflare challenge page
      const bodyOk =
        text.includes("bug-seek") ||
        text.includes("Bug Seek") ||
        text.includes("itch.io");
      const blocked = status === 403 || text.includes("cf-browser-verification");

      return new Response(
        JSON.stringify({
          region,
          status,
          ttfb_ms: ttfb,
          content_language: contentLanguage,
          accept_language_sent: acceptLanguage,
          cf_colo: request.cf?.colo || "unknown",
          body_ok: bodyOk,
          blocked,
          ok: status >= 200 && status < 400 && bodyOk && !blocked,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          region,
          status: 0,
          error: err.message,
          ttfb_ms: Date.now() - start,
          cf_colo: request.cf?.colo || "unknown",
          ok: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};

function getAcceptLanguage(region) {
  const map = {
    "us-east":      "en-US,en;q=0.9",
    "eu-west":      "fr-FR,fr;q=0.9,en;q=0.8",
    "ap-southeast": "zh-CN,zh;q=0.9,en;q=0.8",
    "sa-east":      "pt-BR,pt;q=0.9,en;q=0.8",
    "me-south":     "ar-SA,ar;q=0.9,en;q=0.8",
    "af-south":     "sw-KE,sw;q=0.9,en;q=0.8",
  };
  return map[region] || "en-US";
}
