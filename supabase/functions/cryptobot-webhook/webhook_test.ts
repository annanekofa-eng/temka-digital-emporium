// E2E tests for cryptobot-webhook:
//  1. Rejects requests without/with bad signature (401).
//  2. Top-up flow: credits balance and is idempotent on retry.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, CRYPTOBOT_API_TOKEN in env.

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
try { await load({ export: true, examplePath: null, allowEmptyValues: true }); } catch { /* ok */ }
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash, createHmac } from "node:crypto";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRYPTOBOT_TOKEN = Deno.env.get("CRYPTOBOT_API_TOKEN")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/cryptobot-webhook`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function sign(body: string): string {
  const secret = createHash("sha256").update(CRYPTOBOT_TOKEN).digest();
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function post(body: string, signature: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${ANON_KEY}`,
    "apikey": ANON_KEY,
  };
  if (signature) headers["crypto-pay-api-signature"] = signature;
  const res = await fetch(FN_URL, { method: "POST", headers, body });
  const text = await res.text();
  return { status: res.status, body: text };
}

Deno.test("cryptobot-webhook: rejects request with no signature", async () => {
  const body = JSON.stringify({ update_type: "invoice_paid", payload: {} });
  const { status } = await post(body, null);
  assertEquals(status, 401);
});

Deno.test("cryptobot-webhook: rejects request with bad signature", async () => {
  const body = JSON.stringify({ update_type: "invoice_paid", payload: {} });
  const { status } = await post(body, "deadbeef".repeat(8));
  assertEquals(status, 401);
});

Deno.test("cryptobot-webhook: top-up credits balance + idempotent on retry", async () => {
  const tgId = -777000111;
  const invoiceId = `e2e-${Date.now()}`;
  const amount = 1.5;

  // Setup: ensure user profile exists with known balance
  await supabase.from("user_profiles").upsert({
    telegram_id: tgId, balance: 0, first_name: "E2E",
  }, { onConflict: "telegram_id" });
  await supabase.from("processed_invoices").delete().eq("invoice_id", invoiceId);

  const payload = JSON.stringify({ type: "topup", telegramUserId: tgId, amount });
  const body = JSON.stringify({
    update_type: "invoice_paid",
    payload: { invoice_id: invoiceId, amount, payload },
  });

  try {
    const r1 = await post(body, sign(body));
    assertEquals(r1.status, 200, `first call: ${r1.body}`);

    const { data: after1 } = await supabase.from("user_profiles")
      .select("balance").eq("telegram_id", tgId).single();
    assertEquals(Number(after1?.balance), amount, "balance must be credited once");

    // Retry — must be idempotent
    const r2 = await post(body, sign(body));
    assertEquals(r2.status, 200, `retry: ${r2.body}`);
    const { data: after2 } = await supabase.from("user_profiles")
      .select("balance").eq("telegram_id", tgId).single();
    assertEquals(Number(after2?.balance), amount, "balance must NOT double-credit on retry");
  } finally {
    await supabase.from("processed_invoices").delete().eq("invoice_id", invoiceId);
    await supabase.from("balance_history").delete().eq("telegram_id", tgId);
    await supabase.from("user_profiles").delete().eq("telegram_id", tgId);
  }
});
