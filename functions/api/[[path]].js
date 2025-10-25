export async function onRequest(context) {
  const { request, env, params } = context;
  const incomingUrl = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(incomingUrl.origin),
    });
  }

  const pathParam = params.path ? `/${params.path}` : "";
  const allowedPrefix = "/accounts";
  if (!pathParam.startsWith(allowedPrefix)) {
    return new Response("Not Found", { status: 404 });
  }

  const targetUrl = new URL(`https://timerapp-1f65.restdb.io/rest${pathParam}`);
  targetUrl.search = incomingUrl.search;

  const init = await buildRequestInit(request, env.API_KEY);
  const response = await fetch(targetUrl.toString(), init);

  return buildResponse(response, incomingUrl.origin);
}

function buildCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
  headers.set("x-apikey", apiKey);

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
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
