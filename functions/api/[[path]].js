import { FIXTURE_ACCOUNTS } from "./fixtures/accounts.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const incomingUrl = new URL(request.url);
  const requestOrigin = request.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const corsOrigin = pickCorsOrigin(requestOrigin, incomingUrl.origin, allowedOrigins);

  if (request.method === "OPTIONS") {
    if (corsOrigin === null) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(corsOrigin),
    });
  }

  if (corsOrigin === null) {
    return new Response(
      JSON.stringify({ error: "Origin not allowed for this endpoint." }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          ...buildCorsHeaders(requestOrigin || incomingUrl.origin),
        },
      }
    );
  }

  const pathParam = params.path ? `/${params.path}` : "";
  const allowedPrefix = "/accounts";
  if (!pathParam.startsWith(allowedPrefix)) {
    return new Response("Not Found", { status: 404 });
  }

  if (!env.API_KEY) {
    const fixtureResponse = buildFixtureResponse(pathParam, request.method, corsOrigin);
    if (fixtureResponse) {
      return fixtureResponse;
    }
  }

  const targetUrl = new URL(`https://timerapp-1f65.restdb.io/rest${pathParam}`);
  targetUrl.search = incomingUrl.search;

  const init = await buildRequestInit(request, env.API_KEY);
  const response = await fetch(targetUrl.toString(), init);

  return buildResponse(response, corsOrigin);
}

function buildFixtureResponse(pathParam, method, origin) {
  if (pathParam === "/accounts") {
    if (method !== "GET") {
      return new Response(
        JSON.stringify({
          error: "Fixture data is read-only in local mode.",
          hint: "Set the API_KEY environment variable to enable write access.",
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            ...buildCorsHeaders(origin),
          },
        }
      );
    }
    return new Response(JSON.stringify(FIXTURE_ACCOUNTS), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...buildCorsHeaders(origin),
      },
    });
  }

  const idMatch = pathParam.match(/^\/accounts\/(.+)$/);
  if (idMatch) {
    if (method !== "GET") {
      return new Response(
        JSON.stringify({
          error: "Fixture data is read-only in local mode.",
          hint: "Set the API_KEY environment variable to enable write access.",
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            ...buildCorsHeaders(origin),
          },
        }
      );
    }
    const account = FIXTURE_ACCOUNTS.find((item) => item._id === idMatch[1]);
    if (!account) {
      return new Response(JSON.stringify({ error: "Account not found in fixture." }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...buildCorsHeaders(origin),
        },
      });
    }
    return new Response(JSON.stringify(account), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...buildCorsHeaders(origin),
      },
    });
  }

  return null;
}

function buildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

async function buildRequestInit(request, apiKey) {
  const headers = new Headers();
  const hopByHop = new Set(["host", "cf-ray", "cf-connecting-ip", "x-apikey", "connection"]);
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (!hopByHop.has(lowerKey)) {
      headers.set(key, value);
    }
  });
  if (apiKey) {
    headers.set("x-apikey", apiKey);
  }

  const init = {
    method: request.method,
    headers,
  };

  if (!isBodylessMethod(request.method)) {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      headers.set("content-type", "application/json");
      init.body = await request.text();
    } else if (contentType) {
      init.body = await request.arrayBuffer();
    }
  }

  return init;
}

function isBodylessMethod(method) {
  return method === "GET" || method === "HEAD";
}

async function buildResponse(response, origin) {
  const headers = new Headers(response.headers);
  ["transfer-encoding", "content-encoding", "connection"].forEach((header) =>
    headers.delete(header)
  );
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", appendVary(headers.get("Vary"), "Origin"));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parseAllowedOrigins(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickCorsOrigin(requestOrigin, fallbackOrigin, allowedOrigins) {
  const normalizedFallback = normalizeOrigin(fallbackOrigin);
  if (!requestOrigin) {
    return normalizedFallback;
  }

  const normalizedRequest = normalizeOrigin(requestOrigin);
  if (!normalizedRequest) {
    return null;
  }

  const normalizedAllowed = new Set(
    allowedOrigins.map((origin) => normalizeOrigin(origin)).filter(Boolean)
  );
  normalizedAllowed.add(normalizedFallback);

  if (normalizedAllowed.has("*")) {
    return normalizedRequest;
  }
  if (normalizedAllowed.has(normalizedRequest)) {
    return normalizedRequest;
  }

  return null;
}

function normalizeOrigin(origin) {
  if (!origin) return "";
  if (origin === "null") return "null";
  try {
    return new URL(origin).origin;
  } catch (err) {
    return "";
  }
}

function appendVary(existing, value) {
  if (!existing) return value;
  const parts = existing.split(",").map((part) => part.trim().toLowerCase());
  if (parts.includes(value.toLowerCase())) {
    return existing;
  }
  return `${existing}, ${value}`;
}
