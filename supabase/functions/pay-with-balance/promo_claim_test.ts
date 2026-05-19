// E2E test for try_claim_promo / release_promo atomicity.
// Verifies that under concurrent claims a promo with max_uses=1 is granted
// to exactly one caller, and that release_promo correctly decrements.
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
try { await load({ export: true, examplePath: null, allowEmptyValues: true }); } catch { /* ok */ }
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const TEST_CODE = `E2E_CLAIM_${Date.now()}`;
const TEST_TG_ID = -123456789;

async function setupPromo(maxUses: number) {
  await supabase.from("promocodes").delete().eq("code", TEST_CODE);
  const { data, error } = await supabase.from("promocodes").insert({
    code: TEST_CODE,
    discount_type: "percent",
    discount_value: 10,
    is_active: true,
    max_uses: maxUses,
    used_count: 0,
  }).select().single();
  assert(!error, `setup: ${error?.message}`);
  return data;
}

async function cleanup() {
  await supabase.from("promocodes").delete().eq("code", TEST_CODE);
}

Deno.test("try_claim_promo: concurrent claims respect max_uses=1", async () => {
  await setupPromo(1);
  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        supabase.rpc("try_claim_promo", {
          p_code: TEST_CODE,
          p_telegram_id: TEST_TG_ID,
        }),
      ),
    );
    const oks = results.filter((r) => r.data?.ok === true);
    const fails = results.filter((r) => r.data?.ok === false);
    assertEquals(oks.length, 1, "exactly one claim must succeed");
    assertEquals(fails.length, 9, "the rest must be rejected");
    assert(
      fails.every((r) => r.data?.reason === "exhausted"),
      "rejection reason must be 'exhausted'",
    );

    const { data: promo } = await supabase.from("promocodes")
      .select("used_count").eq("code", TEST_CODE).single();
    assertEquals(promo?.used_count, 1, "used_count must be exactly 1");
  } finally {
    await cleanup();
  }
});

Deno.test("release_promo: decrements used_count, floors at 0", async () => {
  await setupPromo(5);
  try {
    await supabase.rpc("try_claim_promo", { p_code: TEST_CODE, p_telegram_id: TEST_TG_ID });
    await supabase.rpc("try_claim_promo", { p_code: TEST_CODE, p_telegram_id: TEST_TG_ID });
    let { data } = await supabase.from("promocodes").select("used_count").eq("code", TEST_CODE).single();
    assertEquals(data?.used_count, 2);

    await supabase.rpc("release_promo", { p_code: TEST_CODE });
    ({ data } = await supabase.from("promocodes").select("used_count").eq("code", TEST_CODE).single());
    assertEquals(data?.used_count, 1);

    // Try to over-release: floor at 0
    await supabase.rpc("release_promo", { p_code: TEST_CODE });
    await supabase.rpc("release_promo", { p_code: TEST_CODE });
    await supabase.rpc("release_promo", { p_code: TEST_CODE });
    ({ data } = await supabase.from("promocodes").select("used_count").eq("code", TEST_CODE).single());
    assertEquals(data?.used_count, 0, "used_count never goes negative");
  } finally {
    await cleanup();
  }
});

Deno.test("try_claim_promo: inactive promo returns not_found", async () => {
  await setupPromo(10);
  await supabase.from("promocodes").update({ is_active: false }).eq("code", TEST_CODE);
  try {
    const { data } = await supabase.rpc("try_claim_promo", {
      p_code: TEST_CODE, p_telegram_id: TEST_TG_ID,
    });
    assertEquals(data?.ok, false);
    assertEquals(data?.reason, "not_found");
  } finally {
    await cleanup();
  }
});

Deno.test("try_claim_promo: expired promo returns expired", async () => {
  await supabase.from("promocodes").delete().eq("code", TEST_CODE);
  await supabase.from("promocodes").insert({
    code: TEST_CODE, discount_type: "percent", discount_value: 5,
    is_active: true, max_uses: 10, used_count: 0,
    valid_until: new Date(Date.now() - 60_000).toISOString(),
  });
  try {
    const { data } = await supabase.rpc("try_claim_promo", {
      p_code: TEST_CODE, p_telegram_id: TEST_TG_ID,
    });
    assertEquals(data?.ok, false);
    assertEquals(data?.reason, "expired");
  } finally {
    await cleanup();
  }
});
