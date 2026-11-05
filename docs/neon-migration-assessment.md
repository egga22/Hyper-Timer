# Neon migration assessment

Assessed 2026-11-05. Decision: retain RestDB for this change set.

Consolidation in Neon would be convenient, but migration here is an application/backend and authentication project, rather than a connection-string change. That exceeds the requested tolerance for migration hassle. No production data was modified or copied during this assessment.

## Current architecture

The app is static HTML/CSS/JavaScript with a service worker. `script.js` calls RestDB's accounts REST collection directly for signup, login, account lookup and whole-account timer/preferences updates. There is no server runtime, migration tooling, or Postgres schema in this repository.

Accounts contain email, password, role, timer JSON, settings/preferences, and modification timestamps. Login currently compares the password in the browser. Moving this design unchanged to Postgres would carry its weaknesses forward; a proper migration needs server-side authorization and password/session handling. A privileged Postgres connection string must never be shipped in the static client.

Timer IDs and timestamps are significant: sync identifies accounts by RestDB record ID and reconciles local/cloud timer snapshots by modification time. Timer payloads include paused state, start/end times, loop definitions, trigger histories, animation settings, and embedded sound data URLs. Templates are currently browser-local (`hyperTimer_templates_v1`), so a database export alone is not a complete user backup.

## Published limits

These are public plan limits, not verified limits or consumption for the owner's actual account.

| Resource | RestDB Development Free | Neon Free |
| --- | --- | --- |
| Data limit | 2,500 records; 100 MB media | 1 GB Postgres per project; 20 GB Postgres account total |
| Request/compute limit | 1 API call/second; 500/day | 100 CU-hours/project/month; up to 2 CU |
| Network transfer | Not specified on the referenced pricing page | 5 GB/project/month |
| Idle behavior | Not specified on the referenced pricing page | Compute scales to zero after 5 minutes |
| Recovery | Manual snapshots; no automatic backup | Up to 6 hours or 1 GB of data changes; 1 snapshot |

Neon's compute and egress limits can suspend compute until the next billing period; storage exhaustion rejects growth. They are different constraints from RestDB's record/request caps, so there is no evidence that Neon is unconditionally less restrictive for this workload. The app stores many timers inside account records, meaning record counts are not timer counts. Embedded audio affects JSON storage and full-account sync traffic.

Neon Launch lists $0.106/CU-hour and $0.35/GB-month for database storage, with separate history/backend costs and no monthly minimum. RestDB Standard lists $29/month monthly or $19/month on the annual price shown, 100,000 records and 10 calls/second. An always-active minimum 0.25-CU Neon database uses about 180 CU-hours over 30 days, exceeding the Free allowance. No account usage measurements were collected, so this is not an actual bill estimate.

Sources checked:

- [Neon pricing and Free limit behavior](https://neon.com/pricing), updated October 31, 2026.
- [RestDB pricing and plans](https://restdb.io/pricing/).
- [Neon authentication overview](https://neon.com/docs/auth/overview).

## Data preservation and migration cost

Postgres JSONB can retain the timer/settings structure alongside stable legacy account IDs; there is no inherent requirement to lose timer data. However, a safe cutover would require:

1. Inventory the actual RestDB plan, full account payload sizes, traffic and all field variants; obtain a complete private export plus a tested restore.
2. Add authenticated server endpoints and owner-scoped authorization. Keep existing logins working through an audited password migration or an explicit password-reset flow; preserve roles independently of client input.
3. Import all accounts and raw timer/settings payloads with stable legacy IDs and original timestamps. Compare account counts, IDs, field presence and canonical payload hashes. Do not put exports or credentials in git.
4. Replace account API calls, test stale local clients, offline reconnect, concurrent edits, timer imports, reminders, paused timers, smart timers and every loop format against the new backend.
5. Reconcile final writes at cutover, retain a rollback source and tested rollback path, and verify writes/readback before retiring RestDB. Browser-local templates need their own preservation path.

The existing app keeps working without a migration. Revisit Neon when a secure backend/authentication overhaul is otherwise planned, or measured RestDB costs/limits justify the additional work. This assessment deliberately does not claim lossless production migration or lower costs without those measurements.
