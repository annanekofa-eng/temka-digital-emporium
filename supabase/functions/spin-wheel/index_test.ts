// E2E tests for the spin-wheel edge function.
// Verifies:
//  1. Parallel spin requests cannot double-claim within the 24h window
//     (exactly one ok, the rest return cooldown).
//  2. Cooldown responses include a valid nextSpinAt ~24h in the future.
//
// Requires: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
// TELEGRAM_BOT_TOKEN in the root .env (already provisioned).
// Note: not using std/dotenv/load.ts because .env.example contains VITE_APP_URL
// which the strict loader rejects. Env vars are injected by the test runner.
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
try { await load({ export: true, examplePath: null, allowEmptyValues: true }); } catch { /* ok */ }
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/spin-wheel`;

// Stable but isolated test user id (negative to avoid colliding with real Telegram ids)
const TEST_TG_ID = -987654321;

function buildInitData(tgId: number): string {
  const user = JSON.stringify({ id: tgId, first_name: "Test", username: "wheel_e2e" });
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params = new URLSearchParams({ auth_date: authDate, user });
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dcs).digest("hex");
  params.append("hash", hash);
  return params.toString();
}

async function callSpin(action: "spin" | "status", initData: string) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify({ initData, action }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function cleanup() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  await admin.from("wheel_spins").delete().eq("telegram_id", TEST_TG_ID);
  await admin.from("promocodes").delete().eq("owner_telegram_id", TEST_TG_ID);
}

Deno.test({
  name: "spin-wheel: parallel spins claim at most once",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await cleanup();
    const initData = buildInitData(TEST_TG_ID);

    const CONCURRENCY = 8;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => callSpin("spin", initData)),
    );

    const successes = results.filter((r) => r.status === 200 && r.body?.ok === true);
    const cooldowns = results.filter((r) => r.status === 200 && r.body?.cooldown === true);

    console.log(
      `[parallel-test] ok=${successes.length} cooldown=${cooldowns.length} other=${
        results.length - successes.length - cooldowns.length
      }`,
    );

    assertEquals(successes.length, 1, "exactly one spin must succeed");
    assertEquals(successes.length + cooldowns.length, CONCURRENCY, "every other response must be a cooldown");

    // DB cross-check: only one row exists for this user
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { count } = await admin
      .from("wheel_spins")
      .select("id", { count: "exact", head: true })
      .eq("telegram_id", TEST_TG_ID);
    assertEquals(count, 1, "wheel_spins must contain exactly one row");

    await cleanup();
  },
});

Deno.test({
  name: "spin-wheel: cooldown response carries valid nextSpinAt ~24h ahead",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await cleanup();
    const initData = buildInitData(TEST_TG_ID);

    const first = await callSpin("spin", initData);
    assertEquals(first.status, 200);
    assert(first.body?.ok === true, `first spin should succeed, got ${JSON.stringify(first.body)}`);

    const second = await callSpin("spin", initData);
    assertEquals(second.status, 200);
    assertEquals(second.body?.cooldown, true, "second spin must report cooldown");
    assert(typeof second.body?.nextSpinAt === "string", "nextSpinAt must be present");

    const nextAt = new Date(second.body.nextSpinAt).getTime();
    assert(!Number.isNaN(nextAt), "nextSpinAt must parse as a date");
    const deltaHours = (nextAt - Date.now()) / 3_600_000;
    assert(
      deltaHours > 23.5 && deltaHours <= 24.05,
      `nextSpinAt should be ~24h in the future, got ${deltaHours.toFixed(3)}h`,
    );

    // status endpoint must agree
    const status = await callSpin("status", initData);
    assertEquals(status.status, 200);
    assertEquals(status.body?.canSpin, false, "status.canSpin must be false during cooldown");
    assertEquals(
      new Date(status.body.nextSpinAt).getTime(),
      nextAt,
      "status.nextSpinAt must match spin.nextSpinAt",
    );

    await cleanup();
  },
});

Deno.test({
  name: "spin-wheel: rejects requests without initData",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const res = await fetch(FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ANON_KEY}`,
        "apikey": ANON_KEY,
      },
      body: JSON.stringify({ action: "spin" }),
    });
    const body = await res.json();
    assertEquals(res.status, 401);
    assert(body?.error, "must return an error message");
  },
});

Deno.test({
  name: "spin-wheel: rejects forged initData with invalid HMAC",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const forged = new URLSearchParams({
      auth_date: Math.floor(Date.now() / 1000).toString(),
      user: JSON.stringify({ id: TEST_TG_ID }),
      hash: "deadbeef".repeat(8),
    }).toString();
    const res = await callSpin("spin", forged);
    assertEquals(res.status, 401);
  },
});
