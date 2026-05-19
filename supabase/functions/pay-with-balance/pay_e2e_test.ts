// E2E test for pay-with-balance:
//  1. Insufficient balance → 400, no order, no balance change.
//  2. Successful payment → paid order, balance deducted, history row, inventory delivered.
//  3. Promo claim is released when payment is rejected (insufficient balance after discount? — covered by claim/release contract).
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, TELEGRAM_BOT_TOKEN.

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
try { await load({ export: true, examplePath: null, allowEmptyValues: true }); } catch { /* ok */ }
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/pay-with-balance`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function buildInitData(tgId: number): string {
  const user = JSON.stringify({ id: tgId, first_name: "PayE2E", username: "pay_e2e" });
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params = new URLSearchParams({ auth_date: authDate, user });
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dcs).digest("hex");
  params.append("hash", hash);
  return params.toString();
}

async function callPay(body: object) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function setupProduct(price: number, stock: number) {
  const { data, error } = await supabase.from("products").insert({
    title: "E2E Test Product", price, stock,
    is_active: true, product_type: "simple",
  }).select().single();
  if (error) throw error;
  // Add inventory units
  if (stock > 0) {
    await supabase.from("inventory_items").insert(
      Array.from({ length: stock }, (_, i) => ({
        product_id: data.id, content: `secret-${Date.now()}-${i}`, status: "available",
      })),
    );
  }
  return data;
}

async function cleanup(tgId: number, productId: string) {
  // orders + items + history cascade through inventory
  const { data: orders } = await supabase.from("orders").select("id").eq("telegram_id", tgId);
  const ids = (orders ?? []).map((o) => o.id);
  if (ids.length) {
    await supabase.from("order_items").delete().in("order_id", ids);
    await supabase.from("orders").delete().in("id", ids);
  }
  await supabase.from("balance_history").delete().eq("telegram_id", tgId);
  await supabase.from("rate_limits").delete().eq("identifier", String(tgId));
  await supabase.from("inventory_items").delete().eq("product_id", productId);
  await supabase.from("products").delete().eq("id", productId);
  await supabase.from("user_profiles").delete().eq("telegram_id", tgId);
}

Deno.test("pay-with-balance: insufficient balance → 400, no order, no debit", async () => {
  const tgId = -888100001;
  const product = await setupProduct(5, 1);
  await supabase.from("user_profiles").upsert({ telegram_id: tgId, balance: 1 }, { onConflict: "telegram_id" });

  try {
    const r = await callPay({
      initData: buildInitData(tgId),
      orderNumber: `E2E-${Date.now()}-A`,
      items: [{ productId: product.id, productTitle: product.title, productPrice: 5, quantity: 1 }],
    });
    assertEquals(r.status, 400);
    assertEquals(r.body.error, "Insufficient balance");

    const { data: prof } = await supabase.from("user_profiles").select("balance").eq("telegram_id", tgId).single();
    assertEquals(Number(prof?.balance), 1, "balance must be unchanged");
    const { count } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("telegram_id", tgId);
    assertEquals(count, 0, "no order must exist");
  } finally {
    await cleanup(tgId, product.id);
  }
});

Deno.test("pay-with-balance: successful payment → paid order + balance debit + inventory", async () => {
  const tgId = -888100002;
  const product = await setupProduct(3, 1);
  await supabase.from("user_profiles").upsert({ telegram_id: tgId, balance: 10 }, { onConflict: "telegram_id" });

  try {
    const r = await callPay({
      initData: buildInitData(tgId),
      orderNumber: `E2E-${Date.now()}-B`,
      items: [{ productId: product.id, productTitle: product.title, productPrice: 3, quantity: 1 }],
    });
    assertEquals(r.status, 200, JSON.stringify(r.body));

    const { data: prof } = await supabase.from("user_profiles").select("balance").eq("telegram_id", tgId).single();
    assertEquals(Number(prof?.balance), 7, "balance debited by 3");

    const { data: order } = await supabase.from("orders").select("*").eq("telegram_id", tgId).single();
    assertEquals(order?.payment_status, "paid");
    assertEquals(Number(order?.total_amount), 3);

    const { data: hist } = await supabase.from("balance_history").select("*").eq("telegram_id", tgId).single();
    assertEquals(Number(hist?.amount), -3);
    assertEquals(hist?.type, "debit");

    // Inventory was sold to this order
    const { count: soldCount } = await supabase.from("inventory_items").select("id", { count: "exact", head: true })
      .eq("product_id", product.id).eq("status", "sold");
    assertEquals(soldCount, 1, "1 inventory unit must be sold");
  } finally {
    await cleanup(tgId, product.id);
  }
});

Deno.test("pay-with-balance: invalid initData → 401", async () => {
  const r = await callPay({
    initData: "auth_date=1&user=%7B%22id%22%3A1%7D&hash=bad",
    orderNumber: "E2E-bad",
    items: [{ productId: "00000000-0000-0000-0000-000000000000", productTitle: "x", productPrice: 1, quantity: 1 }],
  });
  assertEquals(r.status, 401);
});
