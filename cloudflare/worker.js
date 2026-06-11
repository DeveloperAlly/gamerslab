const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
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

    if (url.pathname.startsWith("/api/")) {
      return handleAPI(request, url, env);
    }

    return handleGeoProxy(request, env);
  },
};

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

async function handleAPI(request, url, env) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/results" && method === "GET") {
    const hours = parseInt(url.searchParams.get("hours") || "24");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "2000"), 5000);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const res = await sbFetch(env,
      `/rest/v1/monitor_results?select=region,status,ttfb_ms,cf_colo,mode,checked_at&checked_at=gte.${since}&order=checked_at.desc&limit=${limit}`
    );
    return json(await res.json(), res.status);
  }

  if (path === "/api/status" && method === "GET") {
    const res = await sbFetch(env,
      `/rest/v1/monitor_results?select=region,status,ttfb_ms,cf_colo,checked_at&order=checked_at.desc&limit=60`
    );
    const rows = await res.json();
    const byRegion = {};
    for (const r of rows) {
      if (!byRegion[r.region]) byRegion[r.region] = r;
    }
    return json(Object.values(byRegion));
  }

  if (path === "/api/trigger" && method === "POST") {
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
      await sbFetch(env, "/rest/v1/trigger_log", {
        method: "POST",
        body: JSON.stringify({ mode, triggered_at: new Date().toISOString(), source: "dashboard" }),
        headers: { Prefer: "return=minimal" },
      });
      return json({ triggered: true, mode });
    }
    return err(`GitHub dispatch failed: ${await ghRes.text()}`, ghRes.status);
  }

  if (path === "/api/target" && method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const { url: targetUrl, name } = body;
    if (!targetUrl) return err("url is required");
    await sbFetch(env, `/rest/v1/targets?active=eq.true`, {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });
    await sbFetch(env, "/rest/v1/targets", {
      method: "POST",
      body: JSON.stringify({ url: targetUrl, name: name || targetUrl, set_at: new Date().toISOString(), active: true }),
      headers: { Prefer: "return=minimal" },
    });
    return json({ updated: true, url: targetUrl });
  }

  if (path === "/api/targets" && method === "GET") {
    const res = await sbFetch(env, "/rest/v1/targets?select=id,url,name,set_at,active&order=set_at.desc&limit=20");
    return json(await res.json(), res.status);
  }

  if (path === "/api/active-target" && method === "GET") {
    const res = await sbFetch(env, "/rest/v1/targets?active=eq.true&order=set_at.desc&limit=1");
    const data = await res.json();
    return json(data[0] || { url: env.TARGET_URL, name: "Default target" });
  }

  if (path === "/api/discord-test" && method === "POST") {
    if (!env.DISCORD_WEBHOOK_URL) return err("DISCORD_WEBHOOK_URL not configured");
    const res = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "✅ GamersLab Monitor — Discord webhook connected successfully." }),
    });
    return json({ sent: res.ok });
  }

  return err("Not found", 404);
}

function sbFetch(env, path, opts = {}) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    method: opts.method || "GET",
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    body: opts.body,
  });
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
