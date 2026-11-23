---
name: crm
description: Operate customer records, notes, segments, campaign drafts, and owner-scoped send status using app_call, app_describe, and canvas_open.
---

# CRM Operating Guide

Use `app_describe` with `app: "crm"` first to inspect the live schema, declared tables, views, and callable operations on the current board.

## 1. Customer Records & Aggregations
- **Default table (`customers`)**: `display_name`, `email`, `phone`, `source`, `customer_type` (`person` or `organization`), `website`, `tags`, `consent` (`{email, sms}`), `contacts`, and `custom_fields`.
- **Query cleanly**: prefer `records.list` with `filters` (such as `{field: "tags", op: "contains", value: "vip"}`), `sort`, and `fields` to keep responses compact.
- **Counts & rollups**: use `records.aggregate` (`group_by`, `filters`, `query`) instead of paging through every record just to count segments or tags.
- **Inspect before updating**: call `records.show` first to read the current `revision`, then stage `records.update` with `expected_revision` and only the changed fields inside `profile`.
- **CSV preview + batch import (owner only)**: call `records.csv.preview` with `{csv_text}` (up to 120 KiB and 200 rows) to validate customer columns (`display_name`, `email`, `phone`, `tags`, `source`, `customer_type`, `website`), check live duplicate emails (`duplicate_existing` / `duplicate_in_csv`), keep consent defaulted to `{email: "unknown", sms: "unknown"}`, and emit `batch_items` to stage cleanly in one `records.batch` call.
- **Batch writes**: stage up to 200 creates in one owner approval using `records.batch` (`items: [{record_id, profile, table?}]`).
- **Consent changes**: changing `consent.email` or `consent.sms` to `"granted"` requires `consent_provenance` (`{method: "in_person" | "web_form" | "written" | "imported" | "other", note?}`). Never infer consent without a recorded user action.

## 2. Customer Notes (`table: "notes"`)
- Store persistent interaction logs and internal notes in `table: "notes"` (`customer_id`, `body`, optional `archived_at`).
- Read notes for a customer via `records.list` with `table: "notes"` and `filters: [{field: "customer_id", op: "eq", value: "<customer_id>"}]`.
- Add a note via `records.create` with `table: "notes"` and `profile: {customer_id: "<id>", body: "<text>"}`.
- Archive an obsolete note via `records.update` with `table: "notes"`, `expected_revision`, and `profile: {archived_at: "<ISO-8601-timestamp>"}` (`customer_id` is immutable).

## 3. Segments & Audience Previews
- Read rules via `segments.list` and `segments.show`.
- Preview counts and samples before saving using `audience.preview`.
- Stage segment creation or updates via `segments.save` (`segment_id`, `name`, `predicates`, optional `expected_revision`). Every staged write awaits owner approval in Home.

## 4. Campaigns & Owner-Scoped Sends
- Read drafts via `content.list`, `content.show`, and `content.render`.
- Stage campaign edits with `content.save` (blocks mode only; HTML pasting is refused) or clone an approved revision with `content.clone` (`campaign_id`, `expected_revision`, `name`).
- Inspect frozen audiences (`audience.show`) and campaign send progress (`sends.list`, `sends.show`) when acting in an owner-authorized context. Sending test or live email remains an operator UI action and cannot be triggered from chat.
- Use `canvas_open` with declared view IDs (such as `customers`, `segments`, or `campaigns`) when the user asks to view a list or customer page in the canvas.

## 5. Hosted Autonomy & Read-Only Kill Switch
- **`tier0_read`**: reads and previews (including owner-scoped `records.csv.preview`) run directly within session role bounds.
- **`tier1_hygiene` (opt-in triple-lock)**: bounded CRM hygiene only — `records.create` and `records.update` on `table: "notes"`, `records.update` on `customers` without touching `consent` or `consent_provenance`, and `segments.save`. Auto-applies only when workspace `crm` autonomy sets `tier1_auto_apply: true`, the agent profile opts into `crm_hygiene_write`, and neither `crm` nor global `*` is read-only.
- **`tier2_hitl` (non-overridable)**: `records.create` on `customers`, any update touching `consent` or `consent_provenance`, bulk `records.batch`, `content.save`, `content.clone`, and sending actions always require owner approval or UI action.
- **Read-Only Kill Switch**: when `read_only` is active for `crm` (or globally `*`), every agent mutation through `app_call` is refused immediately with `403 app_read_only`, while reads remain available.
