const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Monitor-Region,X-Monitor-Mode",
};

const N8N_URL = "https://n8n-j39n.sliplane.app";
const N8N_WORKFLOW_ID = "pTkt5lTwDgTwUY1f";

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

    if (url.pathname === "/api/trigger" && request.method === "POST")
      return handleTrigger(request, env);

    if (url.pathname === "/api/discord-test" && request.method === "POST")
      return handleDiscordTest(env);

    if (url.pathname === "/api/schedule" && request.method === "POST")
      return handleSchedule(request, env);

    if (url.pathname === "/api/workflow/activate" && request.method === "POST")
      return handleWorkflowActivate(request, env, true);

    if (url.pathname === "/api/workflow/deactivate" && request.method === "POST")
      return handleWorkflowActivate(request, env, false);

    if (url.pathname === "/api/workflow/status" && request.method === "GET")
      return handleWorkflowStatus(env);

    return handleGeoProxy(request, env);
  },
};

// ── GitHub Actions trigger ────────────────────────────────────────────────────
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
        "User-Agent": "GamersLab-Monitor/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { mode, regions } }),
    }
  );

  if (ghRes.status === 204) return json({ triggered: true, mode });
  return err(`GitHub dispatch failed: ${await ghRes.text()}`, ghRes.status);
}

// ── Schedule update ───────────────────────────────────────────────────────────
async function handleSchedule(request, env) {
  if (!env.N8N_API_KEY) return err("N8N_API_KEY not configured");

  const body = await request.json().catch(() => ({}));
  const intervalMinutes = parseInt(body.intervalMinutes) || 5;

  const getRes = await fetch(`${N8N_URL}/api/v1/workflows/${N8N_WORKFLOW_ID}`, {
    headers: { "X-N8N-API-KEY": env.N8N_API_KEY },
  });
  if (!getRes.ok) return err(`Failed to fetch workflow: ${await getRes.text()}`, getRes.status);

  const wf = await getRes.json();

  // Patch the Schedule Trigger node only
  const nodes = wf.nodes.map(node => {
    if (node.type === "n8n-nodes-base.scheduleTrigger" && node.name === "Schedule Trigger") {
      return {
        ...node,
        parameters: {
          ...node.parameters,
          rule: { interval: [{ field: "minutes", minutesInterval: intervalMinutes }] },
        },
      };
    }
    return node;
  });

  // n8n PUT /api/v1/workflows/:id only accepts these top-level fields.
  // settings only accepts: executionOrder, timezone, saveManualExecutions,
  // callerPolicy, errorWorkflow, executionTimeout — strip everything else.
  const { executionOrder, timezone, saveManualExecutions, callerPolicy, errorWorkflow, executionTimeout } = wf.settings || {};
  const cleanSettings = {};
  if (executionOrder)        cleanSettings.executionOrder = executionOrder;
  if (timezone)              cleanSettings.timezone = timezone;
  if (saveManualExecutions !== undefined) cleanSettings.saveManualExecutions = saveManualExecutions;
  if (callerPolicy)          cleanSettings.callerPolicy = callerPolicy;
  if (errorWorkflow)         cleanSettings.errorWorkflow = errorWorkflow;
  if (executionTimeout)      cleanSettings.executionTimeout = executionTimeout;

  const putBody = {
    name: wf.name,
    nodes,
    connections: wf.connections,
    settings: cleanSettings,
    staticData: wf.staticData || null,
  };

  const putRes = await fetch(`${N8N_URL}/api/v1/workflows/${N8N_WORKFLOW_ID}`, {
    method: "PUT",
    headers: { "X-N8N-API-KEY": env.N8N_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(putBody),
  });

  if (!putRes.ok) return err(`Failed to update workflow: ${await putRes.text()}`, putRes.status);

  // Re-activate so the new schedule takes effect immediately
  await fetch(`${N8N_URL}/api/v1/workflows/${N8N_WORKFLOW_ID}/activate`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": env.N8N_API_KEY, "Content-Type": "application/json" },
  });

  return json({ updated: true, intervalMinutes });
}

// ── Activate / deactivate workflow ────────────────────────────────────────────
async function handleWorkflowActivate(request, env, activate) {
  if (!env.N8N_API_KEY) return err("N8N_API_KEY not configured");

  const endpoint = activate ? "activate" : "deactivate";
  const res = await fetch(`${N8N_URL}/api/v1/workflows/${N8N_WORKFLOW_ID}/${endpoint}`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": env.N8N_API_KEY, "Content-Type": "application/json" },
  });

  if (!res.ok) return err(`Failed to ${endpoint} workflow: ${await res.text()}`, res.status);
  return json({ active: activate });
}

// ── Workflow status ───────────────────────────────────────────────────────────
async function handleWorkflowStatus(env) {
  if (!env.N8N_API_KEY) return err("N8N_API_KEY not configured");

  const res = await fetch(`${N8N_URL}/api/v1/workflows/${N8N_WORKFLOW_ID}`, {
    headers: { "X-N8N-API-KEY": env.N8N_API_KEY },
  });
  if (!res.ok) return err(`Failed to fetch workflow: ${await res.text()}`, res.status);

  const wf = await res.json();
  const scheduleTrigger = wf.nodes?.find(n => n.name === "Schedule Trigger");
  const intervalMinutes = scheduleTrigger?.parameters?.rule?.interval?.[0]?.minutesInterval || 5;

  return json({ active: wf.active, intervalMinutes });
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

// ── Geo proxy — GitHub Actions runners ───────────────────────────────────────
async function handleGeoProxy(request, env) {
  const region = request.headers.get("X-Monitor-Region") || "unknown";
  const targetUrl = env.TARGET_URL;
  if (!targetUrl) return new Response("TARGET_URL not set", { status: 500 });

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
