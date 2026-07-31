# Session Timeout Cloud Tasks

This document describes the delayed timeout flow used by `builder_api` for
disconnected experiment sessions.

## Why This Exists

The previous implementation used `setTimeout(..., 30 minutes)` inside the
Realtime Database trigger `finalizeDisconnectedSessions`. That is not reliable
in Cloud Functions: the trigger handler returns immediately, and the timer then
lives only in the memory of one function instance.

The current implementation uses Firebase task queue functions, backed by Google
Cloud Tasks, to schedule the delayed work durably.

Official references:

- Firebase task queue functions: https://firebase.google.com/docs/functions/task-functions
- Cloud Tasks pricing: https://cloud.google.com/tasks/pricing
- Cloud Tasks quotas and limits: https://cloud.google.com/tasks/docs/quotas

## Deployed Functions

- `finalizeDisconnectedSessions`: Realtime Database trigger on
  `sessions/{experimentID}/{sessionId}`. It detects disconnects and schedules
  durable timeout work when the session is resumable.
- `processSessionTimeout`: task queue worker. Cloud Tasks dispatches this
  function at `resumeExpiresAt`.

The queue target used by the Admin SDK is:

```text
locations/us-central1/functions/processSessionTimeout
```

No new npm dependency is required. The existing `firebase-functions` and
`firebase-admin` versions already support task queue functions.

## Runtime Flow

When a participant disconnects and resume is enabled:

1. `finalizeDisconnectedSessions` writes `resumeExpiresAt`,
   `resumeTimeoutStarted`, and `resumeTimeoutTaskStatus: "pending"` to RTDB.
2. It enqueues a Cloud Task for `processSessionTimeout` using `scheduleTime`.
3. After enqueue succeeds, it writes `resumeTimeoutTaskStatus: "queued"`.
4. If the participant reconnects before the task fires, RTDB is marked as
   `state: "resumed"` and `resumeTimeoutTaskStatus: "cancelled"`.
5. The task may still dispatch, but it is idempotent: it re-reads RTDB and
   no-ops unless the session is still disconnected and `resumeExpiresAt`
   matches the task payload.

Provider behavior:

- `useIndexedDB=true`: the browser is the source of truth for recovery. If the
  session remains disconnected until timeout, the worker deletes temporary
  Firestore data under `experiments/{experimentID}/sessions/{sessionId}`,
  including `trials` in batches of 500, writes `session_metadata` with
  `state: "expired"`, and marks RTDB as processed.
- `useIndexedDB=false` and `storageProvider="osf"`: OSF cannot use the immediate
  PATCH path. The worker calls `finalizeSession`, writes expired metadata, and
  marks RTDB as processed. `SESSION_NOT_FOUND` and `NO_RESULTS` are treated as
  terminal no-data expirations; other errors are rethrown so Cloud Tasks can
  retry.
- `useIndexedDB=false` with Google Drive or Dropbox: no delayed task is needed.
  The trigger still sends the immediate PATCH on disconnect.

## Retry And Rate Limits

`processSessionTimeout` is configured with:

- Region: `us-central1`
- Timeout: 300 seconds
- Max attempts: 5
- Backoff: 30 to 300 seconds
- Max concurrent dispatches: 20
- Max dispatches per second: 20
- Per-task dispatch deadline: 120 seconds

## Deployment Requirements

Deploy the task worker and the RTDB trigger together:

```bash
firebase deploy --only functions:processSessionTimeout,functions:finalizeDisconnectedSessions
```

Deploying all functions is also fine:

```bash
firebase deploy --only functions
```

On first deploy, Firebase CLI creates the Cloud Tasks queue for the task queue
function using the retry and rate-limit options in source code.

If enqueueing fails with permission errors, check IAM for the service account
used by the function. It needs permission to create Cloud Tasks tasks
(`cloudtasks.tasks.create`, commonly via `roles/cloudtasks.enqueuer`) and to
invoke the task queue function.

No new environment variable is required.

## Cost Model

The task payload is far below 32 KB, so one disconnected resumable session
normally adds two Cloud Tasks billable operations:

1. One enqueue API call.
2. One push delivery attempt.

Ignoring free tiers, Google lists Cloud Tasks at USD 0.40 per million operations
up to 5 billion operations/month. Under that model:

- 500 disconnected sessions: 1,000 operations = USD 0.0004.
- 1,000 disconnected sessions: 2,000 operations = USD 0.0008.
- Retries add one delivery operation per retry.

This is only the Cloud Tasks increment. The worker still incurs the normal
Firebase costs for Cloud Functions execution, RTDB reads/writes, Firestore
reads/writes/deletes, and any provider API work.

## Relevant Limits

Current Cloud Tasks limits that matter for this implementation:

- Maximum schedule time: 30 days in the future. Builder uses minutes, normally
  30 minutes, so it is well below the limit.
- Maximum task size: 1 MiB. Builder sends only `experimentID`, `sessionId`, and
  `expiresAt`.
- Queue dispatch rate: 500 tasks/second per queue. Builder caps this worker at
  20 dispatches/second in source.
- Queues per region: 1,000. Builder uses one task queue function for session
  timeouts.
- Task retention: 31 days.

## Tests

Targeted tests:

```bash
cd functions
npm test -- sessions-timeout-tasks.test.js sessions-finalizeDisconnected-trigger.test.js
```
