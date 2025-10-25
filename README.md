# Hyper Timer Deployment Guide

This project expects to run on [Cloudflare Pages](https://developers.cloudflare.com/pages/) so it can use the bundled Pages Function in `functions/api/[[path]].js` as a proxy to the RestDB `accounts` API. If the site is hosted on a different platform (for example GitHub Pages), requests to `/api/accounts` will respond with `404 Not Found` because the Cloudflare runtime is not available. Follow the steps below to connect your deployment to your Cloudflare account and enable the sync features.

## 1. Prepare your Cloudflare account

1. Sign in to the Cloudflare dashboard and ensure you have the **Pages** product available on the account you plan to use.
2. If you have not already, create a Cloudflare **API Token** with *Edit Cloudflare Workers* and *Edit Cloudflare Pages* permissions so you can deploy from GitHub (optional but recommended).

## 2. Create a Pages project for Hyper Timer

1. In the Cloudflare dashboard go to **Workers & Pages → Pages** and click **Create a project**.
2. Choose **Connect to Git** and authorize Cloudflare to access the GitHub repository that contains this codebase.
3. Select the repository (e.g. `egga22/Hyper-Timer`) and accept the default build settings:
   - **Framework preset:** `None`
   - **Build command:** leave empty (this is a static site)
   - **Build output directory:** `.`
4. Toggle **Functions** on when prompted so that Cloudflare deploys the `functions/api/[[path]].js` handler.

After the project is created, Cloudflare will deploy the site to a `*.pages.dev` URL. You can later add your custom domain in the Pages project settings.

## 3. Configure the RestDB API key

The proxy function forwards requests to `https://timerapp-1f65.restdb.io/rest/accounts` using an API key stored in the `API_KEY` environment variable.

1. In the Pages project, open **Settings → Functions → Environment variables**.
2. Add a variable named `API_KEY` and set its value to your RestDB API key.
3. Re-deploy the project (trigger **Save and deploy** in the UI or push a new commit) so the function picks up the environment variable.

## 4. Verify the proxy

Once the deployment finishes:

1. Visit `https://<your-pages-project>.pages.dev/api/accounts` in the browser (you should see JSON instead of a 404 page).
2. Load the main application (`/Hyper-Timer/`) and open the developer tools network tab to confirm the calls to `/api/accounts` return `200` responses.

If you see authentication errors (HTTP 401/403), double-check that the RestDB API key has read/write permissions for the `accounts` collection. If you still receive a `404`, make sure the request is being sent to your Cloudflare Pages domain and not to GitHub Pages.

## 5. Optional: Using Wrangler for local testing

If you want to test locally with the Cloudflare runtime:

1. Install the [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and run `wrangler pages dev --compatibility-flag nodejs_compat` from the project root.
2. Set the `API_KEY` variable for the dev session with `wrangler pages dev --var API_KEY=<your-key>` or by adding it to a `.dev.vars` file.
3. Access the local URL provided by Wrangler; it will emulate the Pages Function so `/api/accounts` works during development.

By completing these steps, the application will be connected to your Cloudflare account and the sync features will function correctly.
