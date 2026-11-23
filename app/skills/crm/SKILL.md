---
name: crm
description: Operate customer records, revenue deals, follow-up tasks, touchpoints, notes, deduplication merges, segments, campaign drafts, and owner-scoped send status using app_call, app_describe, and canvas_open.
---

# CRM Operating Guide

Use `app_describe` with `app: "crm"` first to inspect the live schema, declared tables (`customers`, `notes`, `deals`, `tasks`, `touchpoints`), views, and callable operations on the current board.

## 1. Customer Records, Duplicate Hints & Aggregations
- **Default table (`customers`)**: `display_name`, `email`, `phone`, `source`, `customer_type` (`person` or `organization`), `website`, `tags`, `consent` (`{email, sms}`), `contacts`, and `custom_fields`.
- **Query cleanly**: prefer `records.list` with `filters` (such as `{field: "tags", op: "contains", value: "vip"}`), `sort`, and `fields` to keep responses compact.
- **Duplicate detection on create**: staging `records.create` on `customers` automatically returns `duplicate_hints` when an existing customer matches by normalized `email`, normalized `phone`, or non-free corporate email `domain`. Check `duplicate_hints` and prefer updating or merging rather than creating duplicate contacts.
- **Owner-approved customer merge (`records.merge`)**: stage `{source_id, target_id, expected_source_revision, expected_target_revision, overrides?}`. Approving atomically re-parents all linked `notes`, `deals`, `tasks`, and `touchpoints` onto `target_id`, merges profile fields and tags (target wins unless overridden), enforces **strictest-consent-wins** (`denied > unknown > granted` cannot be overridden), deletes `source_id`, and writes `merge_target` / `merge_source` journal entries.
- **Counts & rollups**: use `records.aggregate` (`table?`, `group_by`, `sum`, `filters`, `query`) instead of paging through every record just to count segments or sum pipeline revenue (`table: "deals", group_by: ["stage"], sum: ["amount_cents"]`).
- **Inspect before updating**: call `records.show` first to read the current `revision`, then stage `records.update` with `expected_revision` and only the changed fields inside `profile`.
- **CSV preview + batch import (owner only)**: call `records.csv.preview` with `{csv_text}` (up to 120 KiB and 200 rows) to validate customer columns (`display_name`, `email`, `phone`, `tags`, `source`, `customer_type`, `website`), check live duplicate emails (`duplicate_existing` / `duplicate_in_csv`), keep consent defaulted to `{email: "unknown", sms: "unknown"}`, and emit `batch_items` to stage cleanly in one `records.batch` call.
- **Batch writes**: stage up to 200 creates in one owner approval using `records.batch` (`items: [{record_id, profile, table?}]`).
- **Consent changes**: changing `consent.email` or `consent.sms` to `"granted"` requires `consent_provenance` (`{method: "in_person" | "web_form" | "written" | "imported" | "other", note?}`). Never infer consent without a recorded user action.

## 2. Revenue Pipeline, Tasks, Notes & Touchpoints
- **Deals (`table: "deals"`)**: `customer_id` (required), `title`, `stage` (`lead` | `qualified` | `proposal` | `won` | `lost`), `amount_cents` (integer), `currency` (default `"HKD"`), `expected_close_date`, `owner_label`, `notes`. All deal mutations require owner approval (`tier2_hitl`).
- **Tasks (`table: "tasks"`)**: `customer_id?`, `deal_id?`, `title`, `status` (`open` | `done` | `cancelled`), `due_at`, `assignee`, `notes`. Supports Tier-1 auto-apply when workspace autonomy enables `tier1_auto_apply` and agent opts into `crm_hygiene_write`.
- **Touchpoints (`table: "touchpoints"`)**: structured interaction log (`customer_id`, `channel`: `email` | `whatsapp` | `phone` | `meeting` | `note` | `other`, `direction`: `inbound` | `outbound` | `internal`, `summary`, `occurred_at`, `ref_id?`). Supports Tier-1 auto-apply under the same triple lock.
- **Notes (`table: "notes"`)**: internal notes (`customer_id`, `body`, `archived_at?`). Read with `filters: [{field: "customer_id", op: "eq", value: "<customer_id>"}]`. Note creates/updates support Tier-1 auto-apply; `customer_id` on `notes` is immutable for normal updates.

## 3. Segments, Campaigns & Canvas Views
- Read rules via `segments.list` and `segments.show`; preview counts with `audience.preview`; stage saves via `segments.save`.
- Read campaign drafts via `content.list`, `content.show`, `content.render`; stage edits via `content.save` / `content.clone`; inspect frozen audiences (`audience.show`) and send progress (`sends.list`, `sends.show`).
- Open CRM views directly via `canvas_open`: `customers`, `deals`, `tasks`, `segments`, `campaigns`, `customer?id=<customer_id>`, `segment?id=<segment_id>`, `campaign?id=<campaign_id>`.

## 4. Hosted Autonomy & Read-Only Kill Switch
- **`tier0_read`**: reads, `records.aggregate`, and owner-scoped `records.csv.preview` run directly within session role bounds.
- **`tier1_hygiene` (opt-in triple-lock)**: bounded CRM hygiene only — `records.create` and `records.update` on `table: "notes"`, `table: "tasks"`, and `table: "touchpoints"`, `records.update` on `customers` without touching `consent` or `consent_provenance`, and `segments.save`. Auto-applies only when workspace `crm` autonomy sets `tier1_auto_apply: true`, the agent profile opts into `crm_hygiene_write`, and neither `crm` nor global `*` is read-only.
- **`tier2_hitl` (non-overridable)**: `deals` creates/updates, `records.create` on `customers`, any update touching `consent` or `consent_provenance`, `records.merge`, bulk `records.batch`, `content.save`, `content.clone`, and sending actions always require owner approval or UI action.
- **Read-Only Kill Switch**: when `read_only` is active for `crm` (or globally `*`), every agent mutation through `app_call` is refused immediately with `403 app_read_only`, while reads remain available.
