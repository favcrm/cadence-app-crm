---
title: "Revenue watchdog & renewals"
goal: "Detect stale open pipeline deals and upcoming renewals lacking open tasks and open bounded follow-up tasks"
label: Revenue watchdog
inputs:
  stale_days: { ask: "Optional inactivity threshold in days (default 14)", optional: true }
---

Governed revenue watchdog routine (`CRM 1.0.0`).

1. Confirm `app_describe { app: "crm" }` reports `autonomy.capture_sources.watchdogs === true` and `read_only === false`.
2. Query active `deals` (`records.list`, `table: "deals"`) and open `tasks` (`records.list`, `table: "tasks"`).
3. Identify open deals (`lead`, `qualified`, `proposal`) with no open follow-up task and won renewal deals approaching `expected_close_date`.
4. Create concise Tier-1 `tasks` linking `customer_id` and `deal_id`, and optionally draft inert customer follow-up proposals (email/WhatsApp) that stay strictly gated behind owner HITL approval before sending.
5. Link related quotes, issues, or calendar events in `table: "links"` so operators can jump directly from Customer Profile -> Links.
