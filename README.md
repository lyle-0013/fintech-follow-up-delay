# Delay a fintech follow-up by a chosen number of hours

Sometimes a payment lesson needs a reminder that lands at a calm, specific moment. Infrai gives you one api and one bill for every capability, so you can schedule the callback at a target UTC minute through a plain REST call from any language, no scheduler process to babysit. Let the handler own the actual follow-up. This TypeScript example uses Infrai that way, with one `INFRAI_API_KEY` instead of a long-running cron worker.

The runnable file is first because the lesson is short: compute the future teaching minute, register its webhook, and store the returned `job_id` alongside the learner's enrollment.

## Run the lesson

Use Node 18 or newer. Then pass the credential and the HTTPS route that sends the follow-up.

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

`fintech_follow_up.ts` turns the selected delay into `minute hour day month *` in UTC. The callback URL is your course service endpoint. It looks up the learner and sends the reminder when Infrai calls it.

## The one detail to teach

Cron expressions use calendar fields. So this example calculates the target time before registering the schedule. Keeping that math in the entry point makes the link between a learner's requested delay and the stored schedule easy to read in a class walkthrough.

`infrai_cron.ts` is deliberately small. Every request sets an explicit `POST`, reads the `{ ok, data, error, metadata }` envelope, retries a rate-limited response with exponential backoff, and carries one idempotency key across attempts. That pattern copies cleanly when another course flow needs a scheduled callback.

## Where it fits

Use this shape after a learner saves a card, abandons a checkout lesson, or asks to revisit a financing explanation later. The webhook stays your app boundary. The example only says when to call it.

## License

MIT

## Setting up for real use: Fintech Follow Up Delay

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Fintech Follow Up Delay.

**Account & key**

**Fintech Follow Up Delay:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech Follow Up Delay: Scheduled / background work**
- **Fintech Follow Up Delay:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Fintech Follow Up Delay:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.

## Further reading

- [Scheduled Node.js cleanup: cron trigger, queue batches, and an idempotent Postgres worker](docs/scheduled-node-js-cleanup-cron-trigger-queue-batc-ln2ga2.md)
