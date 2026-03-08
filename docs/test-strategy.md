# ReleaseFlow Lifecycle Hardening Test Strategy

## 1) Contract + Migration Tests
- Assert `artists.user_id` exists and `artists.created_by` does not.
- Assert `release_status` enum is exactly: `draft`, `planned`, `active`, `completed`.
- Assert `agent_runs.error` exists and can be selected.
- Assert `increment_referral_count(text)` function exists and increments only valid `referral_codes`.
- Assert TypeScript event payloads include required envelope fields:
  `userId`, `actorId`, `tenantId`, `resourceId`, `idempotencyKey`, `traceId`.

## 2) Router/API Tests
- `artists.create` writes with authenticated `user_id`.
- `releases.create` succeeds with canonical statuses.
- `releases.updateStatus` allows only:
  `draft -> planned -> active -> completed`.
- Illegal transitions return `BAD_REQUEST` with explicit transition message.

## 3) Event Flow Integration Tests
- Creating a release emits `release/created` once per idempotency key.
- Approving campaign emits `campaign/approved` and `pitch/requested`.
- Publishing release emits `release/published` and fans out `analytics/report.requested`.
- Event fanout failures do not roll back business writes and are surfaced via `event_emit_failed`.

## 4) End-to-End Journey Tests
- Signup callback emits `user/signed-up` once for first-time users.
- User journey:
  create artist -> create release -> build plan -> approve campaign -> content/pitches generated.
- Publishing release transitions to `active` and analytics report request is enqueued.

## 5) Admin Monitoring Tests
- Insert synthetic `agent_runs` failures and assert `admin.errorLog` returns `error`.
- Insert stale releases and assert `admin.staleReleases` returns:
  `staleReason`, `minutesSinceUpdate`, `hasCampaign`, `hasContent`, `pitchCount`.
- Monitoring dashboard renders both failure rows and stale release rows.

## 6) Negative/Failure Tests
- Missing API keys in agent functions produce explicit failure reason in `agent_runs.error`.
- DB failure during lifecycle event emit returns success with `event_emit_failed` metadata.
- Missing referral RPC returns explicit `Referral contract missing` error path.

## 7) Reliability Checks
- Repeat same idempotent action and assert no duplicate campaign/content/pitch side effects.
- Validate pipeline stall alert function writes `agent_alerts` for planned releases stalled beyond threshold.
