# Hyper-Timer security migration and RestDB handoff

Prepared November 16, 2026. **Not cut over.** The public website still uses RestDB. The replacement frontend must not merge/deploy before final data reconciliation. Both real-data Neon targets are intentionally closed (`migration_state.ready = false`); synthetic integration alone is open for testing.

## What is preserved

- Existing roles: imported verbatim from `Role` (or `role`), stored separately from writable settings. No account role is reassigned. Missing roles retain the app's existing Standard fallback.
- Existing passwords: the same password is accepted, including existing short passwords. Only storage changes to salted scrypt hashes. No reset emails, reset prompts, or forced password changes. New passwords have an 8-character minimum. Optional Settings → Change password requires the current password and revokes other sessions.
- Existing RestDB IDs, original email strings, and every non-password source field: full JSON payloads are retained and compared, including timers, paused state, schedules, audio data URLs, settings, timestamps, and unknown fields. Authentication uses normalized email addresses and refuses duplicate identities rather than merging people.
- Browser-local timers, templates, and preference stores are not cleared. Existing accounts retain their old ID so account-specific preferences still match. Existing browser identity records are not valid sessions: users will need to log in normally once after the switch, using their unchanged password. No automatic password-change dialog appears.

Seven accounts were backed up privately, imported to staging and the closed production target, and verified against the initial snapshot. All seven original passwords were also accepted by the actual authentication service. This is an initial snapshot, **not evidence that later RestDB writes have been copied**.

## Deployment inventory (public identifiers, no secrets)

- Neon project: `old-meadow-01289770` (Hyper Timer), AWS us-east-2.
- Production branch: `br-square-lake-befybru9`.
- Staging branch: `br-tiny-block-becn682b`.
- Synthetic integration branch: `br-patient-flower-beelt2x8`; never point the public website here.
- Production API: `https://br-square-lake-befybru9-hypertimer.compute.c-9.us-east-2.aws.neon.tech`.
- Website: `https://egga22.github.io/Hyper-Timer/`, GitHub Pages `main` branch.
- Production signup is disabled until final activation; this prevents accounts being created in two independent systems during migration.
- Private backups and environment files are in the checkout's ignored `.private/` directory (directory 0700, files 0600). They contain sensitive data. Keep them off GitHub, Pages, chat, screenshots and shared storage. Preserve a separately encrypted backup before retiring this checkout.

## Your RestDB steps

Do **not** perform the access-revocation step until the replacement release is ready for immediate deployment and we are doing the final cutover together. Revocation starts the brief cloud-login/sync pause; local timers keep running. There is no honest zero-downtime guarantee while independent legacy clients can still write directly to RestDB.

1. Open the `timerapp-1f65` database in your RestDB dashboard. Make a full private backup/export of the `accounts` collection, including all records and fields. Do not export only the currently visible page. Do not change any role, email, password, timer, or settings value.
2. Open **Manage → API** and inventory every key granting access to `/rest/accounts` and `/rest/accounts/*`. Identify the browser key from the old deployed `script.js`; the audited key ends in `6cab`. Check for other public/browser keys too. Also check public endpoints, scripts, or integrations that could keep writing to accounts.
3. At the coordinated cutover, revoke/remove **all browser/public access** to accounts, including GET, POST, PUT, PATCH and DELETE. Restrict any other writers for the final export interval. CORS restrictions alone are insufficient. Do not reset unrelated service keys or change unrelated collections. If the dashboard offers only whole-key deletion, record its scopes privately first so unrelated consumers can be reviewed. Leave private administrator access available.
4. Use private administrator access to take the **final complete export after the freeze**. The initial backup alone is insufficient. If I need a private migration credential to read the frozen source, provide it through the secure secret-entry card when requested, never in chat. Do not temporarily re-enable the exposed browser key. No passwords or export contents should be pasted into chat.
5. I run final import, exact data/role/password verification, activation, release merge/deployment and hosted checks. This is the only period where cloud sync/login may be paused. New local timer edits can still be made and synced after signing in to the new service. Keep RestDB frozen through validation; do not let old clients resume writing to it.
6. After successful hosted login, reload, sync, password-change and data checks, keep every old public key revoked. Check for any server/admin key that was previously made public and rotate it as well. Old cached clients may need a reload; they must never regain database access.
7. Once the new system and an encrypted backup are confirmed, remove legacy plaintext password storage and retire the old collection/database when its retention needs are resolved. No user-facing password changes are needed for this cleanup. Do not delete the source data before the final verification and rollback review.

RestDB reference: https://restdb.io/docs/apikeys-and-cors (key management requires database admin access; Manage → API).

## Operator sequence for the final cutover

Use a trusted machine in this checkout with private environment files. Never put secrets on command lines, in Git, or in the frontend config. The auth secret must remain stable across redeployments. The deployed API already has its production secret; preserve it.

1. Confirm a private source backup exists, release checks pass, the production API `/health` returns 200, and `/account` remains 503. Confirm the allowed production origin is `https://egga22.github.io`.
2. Coordinate the RestDB revocation/freeze above. Export the frozen source to a new private filename:

   ```sh
   node --env-file=.private/restdb.env backend/migrate.mjs export .private/restdb-final.json
   ```

   The source credential must still have private GET access after revocation. Replace it securely with an administrator/read-only migration credential if needed. The script refuses to replace any existing backup file.

3. Reconcile every account on the still-closed production target:

   ```sh
   node --env-file=.private/production.env backend/migrate.mjs import .private/restdb-final.json
   node --env-file=.private/production.env backend/migrate.mjs verify .private/restdb-final.json
   ```

   Import refuses a live target or one containing application writes. Verification requires matching account counts, IDs, original emails, exact roles, every non-password JSON field and successful password verification for every account. Duplicate normalized emails or missing credentials stop the migration. Resolve discrepancies without inventing passwords or roles.

4. Activate only after verification and the source write freeze:

   ```sh
   SOURCE_WRITES_FROZEN=yes node --env-file=.private/production.env backend/migrate.mjs activate .private/restdb-final.json
   ```

   Enable `SIGNUPS_ENABLED=true` in the production Function using an environment-only update that retains the existing auth secret and other settings. Recheck that private files still reference the correct production API URL if running local tooling. No database URI belongs in `cloud-config.js`.

5. Merge/deploy the reviewed frontend release immediately. `cloud-config.js` already points at the production API. Publish only tracked static assets; never `.private`, `node_modules`, backend bundles, or environment files. GitHub Pages' normal tracked-file deployment keeps the ignored private directory out of the site.
6. Verify actual hosted bytes, the new service-worker shell, original-password login, role display, timer/settings readback, reload/session restoration, sync read/write and logout. Verify optional password changes only with a dedicated synthetic production test account, never by changing another person's password. Check at least two accounts for isolation. Use protected requests to confirm role and identity patches fail. Clear any temporary production test accounts only after review.
7. Keep the source frozen. After real writes begin in Neon, do not blindly restore the old snapshot or re-enable the old site: that would lose new changes and restore the security hole. A rollback needs reconciliation of new Neon data into a secure service, not restoring public plaintext access.

## Validation and limits

- Unit/security tests: `npm test` (database integration test deliberately skips without explicit opt-in).
- Build: `npm run backend:build`; dependency audit: `npm audit`.
- Synthetic integration only: `SECURITY_INTEGRATION=yes node --env-file=.private/integration.env --test tests/security-integration.test.mjs`. Never run this test against real accounts; it resets synthetic rate-limit counters and synthetic credentials.
- Browser tests: `node tests/password-ui.browser.cjs`, `node tests/fullscreen-exit.browser.cjs`; `BROWSER_EXECUTABLE` can select an installed Chromium. `REAL_API_URL` targets the synthetic integration deployment for a real UI/backend password-change check.
- Server-side role records are protected. A person can still modify the appearance/behavior of JavaScript running in their own browser; client-only experimental visuals cannot be made a security boundary. That does not change their stored role or authorize another account's data.
- Bearer sessions expire in seven days and are stored in browser storage for the existing static/separate-origin architecture. The backend validates them on every protected request. Keep script injection prevention and dependency maintenance in scope; custom first-party API hosting could later support HttpOnly cookie sessions.
- Passwords already exposed by the legacy system cannot be made secret retroactively. Preserving existing passwords honors the requested migration behavior; the optional change-password control is available without prompting users.
- No source records, role values, or user passwords were changed. No source write freeze or key revocation has occurred yet. Production safety depends on completing the manual RestDB access changes, final reconciliation and hosted checks.
