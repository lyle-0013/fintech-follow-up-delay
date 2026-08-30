# Scheduled Node.js cleanup: cron trigger, queue batches, and an idempotent Postgres worker

If a lease renewal reminder has to land after a business deadline and never before it, pick at-least-once delivery with an idempotent worker, and keep the schedule in Postgres instead of inside the cron trigger. Cron fires a tick. The database decides what is due. The same rule covers the unglamorous half of a property management system — the scheduled data cleanup that has to delete old logs in queue-sized batches without freezing the table your app is still writing to.

Both jobs look like "run something on a timer". They fail in completely different ways, and the failure mode is what should drive the design.

## Three ways to run a due-date job: a quick comparison

| Approach | Delivery guarantee | What it costs | Where it breaks |
|---|---|---|---|
| Trigger runs the work inline | At most once per tick | Nothing beyond the scheduler you already have | A missed tick is lost work; a slow run overlaps the next one |
| Trigger + due-work table in Postgres + worker | At least once, exactly-once effect via a dedup key | One worker loop, one index, one unique constraint | High fan-out puts queue write traffic on the primary |
| Managed durable scheduler or queue product | At least once, with retries and dead-lettering built in | A bill, plus a second source of truth for time | Your schedule now lives outside the database that owns the lease data |

Row two is the default I'd reach for in a property management app that already runs Postgres. The trigger becomes disposable: if the 09:00 tick arrives seven minutes late, the reminder goes out seven minutes late instead of never going out at all. Row one is fine for a cache warm-up nobody would notice missing. Row three earns its bill at a scale where per-item timers on your primary would be reckless — more on that at the end.

## Delivery guarantees and their failure modes

Name the two guarantees precisely, because most scheduling arguments are really arguments about them.

At most once means the consumer treats a message as handled the moment it arrives. RabbitMQ's automatic acknowledgement mode works this way, and its documentation is blunt about the consequence: deliveries are considered successful as soon as they're written to the socket, so anything in flight when a consumer dies is gone. Fast, and wrong for anything with money or a legal date attached.

At least once means the broker — or your own table — holds the work until someone explicitly confirms it, and hands it back if that confirmation never comes. Duplicates become normal traffic. RabbitMQ even ships a `redelivered` flag so the consumer knows a message may have been processed before.

There is no exactly-once transport. What you can build is an exactly-once *effect*: at-least-once delivery plus a deduplication point where the side effect happens.

The trigger side has its own honesty problem. GitHub Actions schedules run at a five-minute floor, and GitHub's own docs warn that the `schedule` event can be delayed during periods of high load, with the top of every hour called out as the worst window. A hosted cron is a heartbeat, not a promise about wall-clock time.

That is the decision rule for a renewal notice: a reminder sent twice is an apologetic email; a reminder never sent is a renewal window your customer missed while trusting your product. Take duplicates, then engineer them away.

## Idempotency keys and claim leases in worker code

The key has to come from the data, not from the run. `renewal:<reminder_id>:<due_at>` is stable across every retry; `crypto.randomUUID()` generated inside the worker is worthless, because the retry generates a different one.

Put a unique index on that key in a deliveries table and insert the row before performing the side effect. If the insert conflicts, another attempt already owns this send and this worker returns early. Most email and messaging APIs also accept an idempotency key on the request itself, which closes the remaining gap where a process dies between the provider accepting the send and your commit landing.

Claiming needs the same discipline. A worker marks its rows with a lease — `claimed_until = now() + interval '5 minutes'` — instead of a plain boolean, so a worker that gets OOM-killed mid-batch doesn't strand its rows forever. When the lease expires, the rows are due again.

## How do you delete old Postgres logs on a cron tick once retention is up?

In bounded batches, from the same worker loop, and never inline in the tick itself. A `delete from job_logs where created_at < now() - interval '30 days'` running inline in the tick is fine at ten thousand rows and hostile at fifty million: one long transaction, a pile of dead tuples for autovacuum to chase, and replication lag while it runs. Bound the work instead, and let the same worker loop own both jobs.

The trigger stays this dumb:

```yaml
on:
  schedule:
    - cron: "*/5 * * * *"
```

And the worker does the thinking:

```ts
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const CLAIM_BATCH = 200;

type DueReminder = { id: string; lease_id: string; due_at: Date; attempts: number };

// Claim in one short transaction, then send outside it. SKIP LOCKED lets several
// workers share the table without blocking each other on the same rows.
async function claimDue(now: Date): Promise<DueReminder[]> {
  const { rows } = await pool.query<DueReminder>(
    `update renewal_reminders r
        set status = 'claimed',
            attempts = r.attempts + 1,
            claimed_until = $1::timestamptz + interval '5 minutes'
      where r.id in (
        select id from renewal_reminders
         where due_at <= $1
           and (status = 'pending'
                or (status = 'claimed' and claimed_until < $1))
         order by due_at
         limit $2
         for update skip locked
      )
      returning r.id, r.lease_id, r.due_at, r.attempts`,
    [now, CLAIM_BATCH],
  );
  return rows;
}

export async function tick(now = new Date()): Promise<void> {
  for (const r of await claimDue(now)) {
    const key = `renewal:${r.id}:${r.due_at.toISOString()}`;
    const claimed = await pool.query(
      `insert into reminder_deliveries (idempotency_key, reminder_id)
       values ($1, $2) on conflict (idempotency_key) do nothing`,
      [key, r.id],
    );
    if (claimed.rowCount === 1) {
      await sendRenewalNotice({ leaseId: r.lease_id, idempotencyKey: key });
    }
    await pool.query(
      `update renewal_reminders set status = 'sent', sent_at = now() where id = $1`,
      [r.id],
    );
  }
  await purgeJobLogs(30, 5_000);
}
```

The cleanup runs on the same tick, in bounded batches, with a pause between them so autovacuum and any read replicas get room to breathe:

```ts
export async function purgeJobLogs(olderThanDays: number, batch: number): Promise<number> {
  let removed = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      `delete from job_logs
        where ctid in (
          select ctid from job_logs
           where created_at < now() - ($1 || ' days')::interval
           limit $2
        )`,
      [olderThanDays, batch],
    );
    removed += rowCount ?? 0;
    if ((rowCount ?? 0) < batch) return removed;
    await new Promise((r) => setTimeout(r, 200));
  }
}
```

Two things I'd flag before anyone copies this. If `job_logs` is pure append-only time-series data, declarative partitioning by month and a `drop table job_logs_2026_04` beats every batched delete ever written: no dead tuples, no vacuum debt, constant-time reclaim. How much that saves on your instance depends on write volume and index count, and I wouldn't guess at a number without measuring yours. The batched delete above is the right tool when the table isn't partitioned yet and you don't want a migration this week.

Testing this is mercifully boring. Inject the clock, seed one reminder due in the past, run `tick()` twice, and assert exactly one send. Then run it with the sender throwing after the delivery row is inserted, and assert the retry does not send again. Those two tests cover the guarantee you actually promised the customer.

For observability, the metric that matters is not "job succeeded". It's the age of the oldest pending row: `max(now() - due_at) where status = 'pending'`. Alert when it exceeds three tick intervals. A green cron run with a silently stuck queue is the failure that reaches customers first, and job-level success monitoring will not catch it. Log rows purged per run too, so a cleanup that quietly stops matching anything shows up as a flat line instead of a surprise disk alert six months later.

## Signals it's time to replace a database-backed queue

A queue table inside your production database is not free. Every claim is a write, every write makes dead tuples, and at high enough churn you're paying vacuum costs on your most contended instance. If you're scheduling millions of individually timed items, need sub-second precision, or your primary is already near its IOPS ceiling, stick with a purpose-built durable scheduler and let it own the timers.

The trade-off runs the other way for a small team. Time-based business rules — what "60 days before lease end, in the property's timezone" means — are the part of the product nobody else can write for you, and I'd rather that logic live in the same transaction as the data it reads. The polling loop around it is undifferentiated plumbing; adopting a managed queue for that piece is a reasonable hour-for-hour trade once your own worker starts needing a paging rotation.

One more boundary worth stating plainly: if you have no always-on process at all, a due-work table still needs something to poll it, and your effective floor is whatever your platform's scheduler grants you. At a five-minute floor, promising a reminder within thirty seconds of a deadline isn't a good fit for that architecture, and no amount of worker code fixes it.

## References

- RabbitMQ, Consumer Acknowledgements and Publisher Confirms — https://www.rabbitmq.com/docs/confirms
- GitHub Docs, Events that trigger workflows (`schedule`) — https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows
- PostgreSQL Documentation, SELECT — locking clauses and SKIP LOCKED — https://www.postgresql.org/docs/current/sql-select.html
- PostgreSQL Documentation, Table Partitioning — https://www.postgresql.org/docs/current/ddl-partitioning.html
- PostgreSQL Documentation, Routine Vacuuming — https://www.postgresql.org/docs/current/routine-vacuuming.html
