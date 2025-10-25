# Hyper Timer Deployment Guide

Hyper Timer can be hosted from any static platform (GitHub Pages, Netlify, etc.) as long as the RestDB traffic is proxied through the Cloudflare Function in `functions/api/[[path]].js`. Follow the steps below to deploy the proxy, secure it, and point your static build at it so account syncing works even when the app itself is served from GitHub Pages.

## 1. Prepare your Cloudflare account

1. Sign in to the Cloudflare dashboard and ensure you have the **Pages** product available on the account you plan to use.
2. If you have not already, create a Cloudflare **API Token** with *Edit Cloudflare Workers* and *Edit Cloudflare Pages* permissions so you can deploy from GitHub (optional but recommended).

## 2. Create a Pages project for the proxy

1. In the Cloudflare dashboard go to **Workers & Pages → Pages** and click **Create a project**.
2. Choose **Connect to Git** and authorize Cloudflare to access the GitHub repository that contains this codebase.
3. Select the repository (e.g. `egga22/Hyper-Timer`) and accept the default build settings:
   - **Framework preset:** `None`
   - **Build command:** leave empty (this is a static site)
   - **Build output directory:** `.`
4. Toggle **Functions** on when prompted so that Cloudflare deploys the `functions/api/[[path]].js` handler.

After the project is created, Cloudflare will deploy the proxy to a `*.pages.dev` URL. You can later add your custom domain in the Pages project settings if you prefer to mask the default domain.

## 3. Configure the RestDB API key and allowed origins

The proxy function forwards requests to `https://timerapp-1f65.restdb.io/rest/accounts` using an API key stored in the `API_KEY` environment variable.

1. In the Pages project, open **Settings → Functions → Environment variables**.
2. Add a variable named `API_KEY` and set its value to your RestDB API key.
3. (Recommended) Add another variable named `ALLOWED_ORIGINS` with a comma-separated list of domains that are allowed to call the proxy (for example `https://egga22.github.io`).
4. Re-deploy the project (trigger **Save and deploy** in the UI or push a new commit) so the function picks up the environment variables.

## 4. Verify the proxy

Once the deployment finishes:

1. Visit `https://<your-pages-project>.pages.dev/api/accounts` in the browser (you should see JSON instead of a 404 page). If you configured `ALLOWED_ORIGINS`, open DevTools → Network and repeat the request from one of the allowed origins to confirm you receive a `200` response.
2. If you receive a `403 Origin not allowed` response, double-check the value of `ALLOWED_ORIGINS` and redeploy after updating it.

If you see authentication errors (HTTP 401/403), double-check that the RestDB API key has read/write permissions for the `accounts` collection. If you still receive a `404`, make sure the request is being sent to your Cloudflare Pages domain and not to GitHub Pages.

## 5. Point your static site at the proxy

The front-end code now looks for an override when building the proxy URL. Add **one** of the following before `script.js` is loaded on your static site:

* **Meta tag (recommended for GitHub Pages):**

  ```html
  <meta name="hyper-timer-api-base" content="https://<your-pages-project>.pages.dev">
  ```

* **Global variable:**

  ```html
  <script>
    window.HYPER_TIMER_API_BASE = "https://<your-pages-project>.pages.dev";
  </script>
  ```

Once the meta tag or global is present, the app will send all `/api/accounts` requests to the Cloudflare proxy even though the main HTML is hosted from a static origin such as GitHub Pages.

## 6. Optional: Using Wrangler for local testing

If you want to test locally with the Cloudflare runtime:

1. Install the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and run `wrangler pages dev --compatibility-flag nodejs_compat` from the project root.
2. Set the `API_KEY` variable for the dev session with `wrangler pages dev --var API_KEY=<your-key>` or by adding it to a `.dev.vars` file.
3. Access the local URL provided by Wrangler; it will emulate the Pages Function so `/api/accounts` works during development.

By completing these steps, the application will be connected to your Cloudflare account and the sync features will function correctly.
