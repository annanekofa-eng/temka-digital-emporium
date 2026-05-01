// Regression test for the security fix in migration 20260501121605:
// shop_payment_methods (which holds encrypted CryptoBot/SBP tokens) and
// shop_payment_requests (which holds payment statuses) MUST NOT be
// readable by the anon role. Only the safe view
// public_shop_payment_methods may be queried publicly, and it must NOT
// expose the encrypted_config column.
//
// This test runs against the deployed Supabase project using the public
// anon key. It is intentionally a black-box test — if RLS is ever
// loosened back to `public`, this test will fail loudly.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;

function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

Deno.test("anon CANNOT read shop_payment_methods (encrypted tokens table)", async () => {
  const supabase = anonClient();
  const { data, error } = await supabase
    .from("shop_payment_methods")
    .select("config_encrypted")
    .limit(1);
  // Either RLS denies (error) or returns 0 rows. Any leaked encrypted
  // payload here is a critical regression.
  if (error) {
    // Expected path — RLS blocks the read.
    assert(error.message.length > 0);
    return;
  }
  assertEquals((data || []).length, 0, "anon must not see any encrypted tokens");
});

Deno.test("anon CANNOT read shop_payment_requests (payment status table)", async () => {
  const supabase = anonClient();
  const { data, error } = await supabase
    .from("shop_payment_requests")
    .select("id, status")
    .limit(1);
  if (error) {
    assert(error.message.length > 0);
    return;
  }
  assertEquals((data || []).length, 0, "anon must not see any payment requests");
});

Deno.test("public_shop_payment_methods view does NOT expose config_encrypted", async () => {
  const supabase = anonClient();
  // Selecting the encrypted column from the view must fail — the view
  // intentionally omits it. If this query ever succeeds, the view was
  // widened and is leaking secrets.
  const { error } = await supabase
    .from("public_shop_payment_methods" as any)
    .select("config_encrypted")
    .limit(1);
  assert(error, "config_encrypted must NOT be selectable via the public view");
});

Deno.test("public_shop_payment_methods exposes only safe columns to anon", async () => {
  const supabase = anonClient();
  // Safe columns we promise to expose. This shape is part of the public
  // contract — storefront pages depend on it.
  const { data, error } = await supabase
    .from("public_shop_payment_methods" as any)
    .select("shop_id, method, enabled, config_masked")
    .limit(1);
  // No error means anon can read the view at all (which we want).
  // Empty result is fine; we just need the schema to be valid.
  assertEquals(error, null);
  if (data && data.length > 0) {
    const row: any = data[0];
    assert(!("config_encrypted" in row), "view row leaked encrypted config");
    assert("enabled" in row);
    assert("method" in row);
  }
});