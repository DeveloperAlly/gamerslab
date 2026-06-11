const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Monitor-Region,X-Monitor-Mode",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    // Dashboard trigger API — only endpoint that needs server-side secrets
    if (url.pathname === "/api/trigger" && request.method === "POST") {
      return handleTrigger(request, env);
    }

    // Discord test — needs webhook URL server-side
    if (url.pathname === "/api/discord-test" && request.method === "POST") {
      return handleDiscordTest(env);
    }

    // Geo proxy — called by GitHub Actions runners
    return handleGeoProxy(request, env);
  },
};

// ── Trigger GitHub Actions dispatch ──────────────────────────────────────────
async function handleTrigger(request, env) {
  const body = await request.json().catch(() => ({}));
  const mode = body.mode || "standard";
  const regions = body.regions || "us-east,eu-west,ap-southeast,sa-east,me-south,af-south";

  const ghRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}/actions/workflows/monitor.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { mode, regions } }),
    }
  );

  if (ghRes.status === 204) {
    return json({ triggered: true, mode });
  }
  return err(`GitHub dispatch failed: ${await ghRes.text()}`, ghRes.status);
}

// ── Discord test ──────────────────────────────────────────────────────────────
async function handleDiscordTest(env) {
  if (!env.DISCORD_WEBHOOK_URL) return err("DISCORD_WEBHOOK_URL not configured");
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "✅ GamersLab Monitor — Discord webhook connected successfully." }),
  });
  return json({ sent: res.ok });
}

// ── Geo proxy — called by GitHub Actions runners ──────────────────────────────
async function handleGeoProxy(request, env) {
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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
      cf: { cacheEverything: false },
    });

    const ttfb = Date.now() - start;
    const status = resp.status;
    const contentLanguage = resp.headers.get("Content-Language") || "";
    const text = await resp.text();
    const bodyOk = text.includes("bug-seek") || text.includes("Bug Seek") || text.includes("itch.io") || text.length > 1000;
    const blocked = status === 403 || text.includes("cf-browser-verification");

    return json({
      region, status, ttfb_ms: ttfb,
      content_language: contentLanguage,
      accept_language_sent: acceptLanguage,
      cf_colo: request.cf?.colo || "unknown",
      body_ok: bodyOk, blocked,
      ok: status >= 200 && status < 400 && bodyOk && !blocked,
    });
  } catch (e) {
    return json({
      region, status: 0, error: e.message,
      ttfb_ms: Date.now() - start,
      cf_colo: request.cf?.colo || "unknown",
      ok: false,
    });
  }
}

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
