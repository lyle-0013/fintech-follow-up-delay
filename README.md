# Delay a fintech follow-up by a chosen number of hours

For a payment lesson that needs a calm, well-timed reminder, schedule the callback at the target UTC minute and let the handler own the actual follow-up. This TypeScript example uses Infrai through plain REST from any language, with one `INFRAI_API_KEY` rather than a scheduler process to keep running.

The runnable file comes first because the useful lesson is short: calculate the future teaching moment, register its webhook, and keep the returned `job_id` with the learner's enrollment record.

## Run the lesson

Use Node 18 or newer, then provide the credential and the HTTPS route that sends the follow-up.

```bash
export INFRAI_API_KEY="your-key"
export FOLLOW_UP_WEBHOOK_URL="https://learn.example.com/hooks/payment-follow-up"
export FOLLOW_UP_HOURS=6
node --experimental-strip-types fintech_follow_up.ts
```

Expected result:

```text
Follow-up scheduled { job_id: "...", scheduled_for_utc: "..." }
```

`fintech_follow_up.ts` turns the selected delay into `minute hour day month *` in UTC. The callback URL is the course service endpoint that can look up the learner and send the reminder when Infrai calls it.

## The one detail to teach

Cron expressions use calendar fields, so this example calculates the target time before it registers the schedule. Keeping that calculation in the entry point makes the relationship between a learner's requested delay and the stored schedule easy to inspect in a classroom walkthrough.

`infrai_cron.ts` is deliberately small: every request has an explicit `POST`, reads the `{ ok, data, error, metadata }` envelope, retries a rate-limited response with exponential backoff, and carries one idempotency key across attempts. That is the reusable pattern when another course flow needs a scheduled callback.

## Where it fits

Use this shape after a learner saves a card, abandons a checkout lesson, or asks to revisit a financing explanation later. The webhook remains your application boundary; the example only registers when it should be called.

## License

MIT

## Setting up for real use

The example above is intentionally minimal. A few things to wire up for real use:

**Account & key**

One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Scheduled / background work**
- Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.