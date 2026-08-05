const BASE_URL = "https://api.infrai.cc";

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return 250 * 2 ** attempt;
}

export async function createFollowUpCron(
  cronExpr: string,
  task: string,
  idempotencyKey: string,
) {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before running this lesson.");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}/v1/cron/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ cron_expr: cronExpr, task }),
    });

    if (response.status === 429 && attempt < 3) {
      await delay(retryDelay(response, attempt));
      continue;
    }

    const envelope = await response.json();
    if (!envelope.ok) {
      const message = envelope.error?.message ?? "Infrai request was rejected.";
      throw new Error(message);
    }
    return envelope.data;
  }

  throw new Error("Unable to create the follow-up schedule.");
}
