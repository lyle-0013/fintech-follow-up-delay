import { randomUUID } from "node:crypto";
import { createFollowUpCron } from "./infrai_cron.ts";

const hours = Number(process.env.FOLLOW_UP_HOURS ?? "6");
const webhookUrl = process.env.FOLLOW_UP_WEBHOOK_URL;

if (!Number.isInteger(hours) || hours < 1) {
  throw new Error("FOLLOW_UP_HOURS must be a whole number of at least 1.");
}
if (!webhookUrl) {
  throw new Error("Set FOLLOW_UP_WEBHOOK_URL to the follow-up handler URL.");
}

const scheduledFor = new Date(Date.now() + hours * 60 * 60 * 1000);
const cronExpr = `${scheduledFor.getUTCMinutes()} ${scheduledFor.getUTCHours()} ${scheduledFor.getUTCDate()} ${scheduledFor.getUTCMonth() + 1} *`;
const schedule = await createFollowUpCron(cronExpr, webhookUrl, randomUUID());

console.log("Follow-up scheduled", {
  job_id: schedule.job_id,
  scheduled_for_utc: scheduledFor.toISOString(),
});
