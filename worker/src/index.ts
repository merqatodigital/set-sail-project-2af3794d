// Cloudflare Worker — Talla Agent + Resort API
//
// Architecture:
//   Browser → Worker fetch → Auth bridge → Tenant guard → D1 → Response
//   Browser → WebSocket → TallaAgent Durable Object → OpenRouter + D1
//
// Phase 5: TallaAgent is now the real resort agent with LLM reasoning,
// D1-backed tools, and proper authorization.

import { routeAgentRequest } from "agents";
import { routeAgentEmail } from "agents";
import { createCatchAllEmailResolver } from "agents/email";
import { proxyToSandbox } from "@cloudflare/sandbox";
import { resolveAuth } from "./auth/middleware.js";
import { handleTours } from "./routes/tours.js";
import { handleGuestRequests } from "./routes/requests.js";
import { handlePropertySettings } from "./routes/settings.js";
import { handleHousekeeping } from "./routes/housekeeping.js";
import { handleMaintenance } from "./routes/maintenance.js";
import { handleMenu } from "./routes/menu.js";
import { handleInventory } from "./routes/inventory.js";
import { handleTallaOps } from "./routes/tallaOps.js";
import { handleTallaChat } from "./routes/chat.js";
import { handleWorkflows } from "./routes/workflows.js";
import { handleComputer } from "./routes/computer.js";
import { handleApprovals } from "./routes/approvals.js";
import { handleEvents } from "./routes/events.js";
import { handleOps } from "./routes/ops.js";
import type { Env } from "./env.js";

// Re-export TallaAgent for wrangler discovery
export { TallaAgent } from "./agents/TallaAgent.js";

// Re-export Sandbox (Cloudflare Containers-backed Durable Object) for wrangler discovery
export { Sandbox } from "@cloudflare/sandbox";

// Re-export Workflow for wrangler discovery
export { DailyResortBriefingWorkflow } from "./workflows/DailyResortBriefingWorkflow.js";
export { TallaApprovalWorkflow } from "./workflows/TallaApprovalWorkflow.js";

// ---- Worker fetch handler ----

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route agent requests (WebSocket + HTTP) to the Durable Object
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      console.log(`[index] routeAgentRequest intercepted: ${path}`);
      return agentResponse;
    }
    console.log(`[index] routeAgentRequest passed through: ${path}`);

    // Sandbox container proxy (preview URLs / container control). Returns a
    // Response only when the request targets a Sandbox container; otherwise null.
    const sandboxProxy = await proxyToSandbox(request, env as never);
    if (sandboxProxy) return sandboxProxy;

    // CORS headers for all API responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dev-Tenant",
      "Access-Control-Max-Age": "86400",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check (no auth needed)
    if (path === "/" || path === "/api/health") {
      return Response.json(
        {
          service: "talla-worker",
          status: "running",
          timestamp: new Date().toISOString(),
          capabilities: {
            agent: true,
            d1: true,
            computer: env.TALLA_COMPUTER_ENABLED === "true" ? "enabled" : "disabled",
            workflows: true,
            ops: true,
            staffPayroll: true,
            bookings: true,
            rentals: true,
            tours: true,
          },
          debug: {
            tallaComputerEnabled: env.TALLA_COMPUTER_ENABLED,
            supabaseUrl: env.SUPABASE_URL ? "set" : "not set",
          },
        },
        { headers: corsHeaders },
      );
    }

    // Debug: test if requests reach the fetch handler
    if (path === "/api/debug/routes") {
      return Response.json(
        {
          path,
          method: request.method,
          hasAuth: !!request.headers.get("Authorization"),
          hasDevTenant: !!request.headers.get("X-Dev-Tenant"),
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders },
      );
    }

    // Resolve authentication (applied to all API routes)
    const auth = await resolveAuth(request, env);

    // Route API requests
    let response: Response;

    if (path.startsWith("/api/tours")) {
      response = await handleTours(request, env, auth, path);
    } else if (path.startsWith("/api/ops")) {
      response = await handleOps(request, env, auth, path);
    } else if (path.startsWith("/api/requests")) {
      response = await handleGuestRequests(request, env, auth, path);
    } else if (path.startsWith("/api/settings")) {
      response = await handlePropertySettings(request, env, auth, path);
    } else if (path.startsWith("/api/housekeeping")) {
      response = await handleHousekeeping(request, env, auth, path);
    } else if (path.startsWith("/api/maintenance")) {
      response = await handleMaintenance(request, env, auth, path);
    } else if (path.startsWith("/api/menu") || path.startsWith("/api/orders")) {
      response = await handleMenu(request, env, auth, path);
    } else if (path.startsWith("/api/inventory")) {
      response = await handleInventory(request, env, auth, path);
    } else if (path.startsWith("/api/workflows")) {
      response = await handleWorkflows(request, env, auth, path);
    } else if (path === "/api/debug/computer-test") {
      // Temporary staging-only Computer test endpoint
      try {
        let body: Record<string, unknown> = {};
        try { body = (await request.json()) as Record<string, unknown>; } catch { /* no body */ }
        const tenantId = (body.tenantId as string) || "marina_terrace";
        const action = (body.action as string) || "health";
        const doId = env.TALLA_AGENT.idFromName(tenantId);
        const stub = env.TALLA_AGENT.get(doId);
        const actionPaths: Record<string, string> = {
          health: "/health",
          status: "/computer/status",
          write: "/computer/write",
          read: "/computer/read",
          list: "/computer/list",
          stat: "/computer/stat",
          search: "/computer/search",
          proof: "/computer/proof",
        };
        const doPath = actionPaths[action] || `/computer/${action}`;
        const doBody: Record<string, unknown> = {};
        if (body.path) doBody.path = body.path;
        if (body.content) doBody.content = body.content;
        // GET = no-body reads (health/proof/status/read/stat/list/search).
        // POST = writes only (write).
        const isGet = action !== "write";
        // Forward path/pattern query params for GET reads.
        const qs = new URLSearchParams();
        if (body.path && isGet) qs.set("path", String(body.path));
        if (body.pattern && isGet) qs.set("pattern", String(body.pattern));
        const doUrl = `https://talla-agent${doPath}${qs.toString() ? `?${qs.toString()}` : ""}`;
        const doResponse = await stub.fetch(
          new Request(doUrl, {
            method: isGet ? "GET" : "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Tenant-Id": tenantId,
              "X-User-Role": "owner",
              "X-User-Id": "staging-test",
            },
            body: isGet ? undefined : JSON.stringify(doBody),
          }),
        );
        const respText = await doResponse.text();
        return new Response(respText, {
          status: doResponse.status,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (err) {
        return Response.json({ error: (err as Error).message, stack: (err as Error).stack?.substring(0, 500) }, { status: 500 });
      }
    } else if (path.startsWith("/api/approvals")) {
      response = await handleApprovals(request, env, auth, path);
    } else if (path.startsWith("/api/events")) {
      response = await handleEvents(request, env, path);
    } else if (path.startsWith("/api/computer")) {
      console.log(`[index] Routing to computer: ${path}, method: ${request.method}`);
      console.log(`[index] Auth: tenantId=${auth.tenantId}, role=${auth.role}`);
      response = await handleComputer(request, env, auth, path);
    } else if (path.startsWith("/api/talla")) {
      // Chat endpoint goes to DO, other talla ops to routes
      if (path === "/api/talla/chat" && request.method === "POST") {
        response = await handleTallaChat(request, env);
      } else {
        response = await handleTallaOps(request, env, auth, path);
      }
    } else {
      response = Response.json({ error: "Not found" }, { status: 404 });
    }

    // Add CORS headers to the response.
    // Use a Headers instance with set(): spreading Object.fromEntries(headers)
    // yields LOWERCASE keys, so merging the capitalised corsHeaders on top
    // produced two Access-Control-Allow-Origin entries ("*, *") whenever the
    // inner handler had already set CORS itself (the SSE chat stream). Browsers
    // reject a multi-valued ACAO header, which broke streaming chat entirely.
    const mergedHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders)) mergedHeaders.set(k, v);
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergedHeaders,
    });

    return newResponse;
  },

  /**
   * Inbound email handler — routes incoming mail to the correct TallaAgent
   * Durable Object instance via the Agents Email API (routeAgentEmail).
   *
   * Routing: ALL inbound mail on the configured domain routes to this tenant's
   * agent instance via createCatchAllEmailResolver. The tenant/agent id is
   * fixed (not derived from inbound headers), so a sender cannot impersonate
   * another tenant or gain owner privileges.
   */
  async email(
    message: ForwardableEmailMessage,
    env: Env,
  ): Promise<void> {
    const resolver = createCatchAllEmailResolver("talla-agent", "marina_terrace");
    await routeAgentEmail(message, env, {
      resolver,
      onNoRoute: (email) => {
        console.warn(`[email] No route for inbound email to ${email.to}`);
      },
    });
  },
};

