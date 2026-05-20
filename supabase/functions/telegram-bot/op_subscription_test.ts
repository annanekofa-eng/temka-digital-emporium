import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Replicates the membership-status check used by ensureSubscribed.
function isSubscribed(apiResp: any): boolean {
  const status = apiResp?.result?.status as string | undefined;
  return !!(apiResp?.ok && status && !["left", "kicked"].includes(status));
}

Deno.test("OP gate: creator counts as subscribed", () => {
  assertEquals(isSubscribed({ ok: true, result: { status: "creator" } }), true);
});

Deno.test("OP gate: administrator counts as subscribed", () => {
  assertEquals(isSubscribed({ ok: true, result: { status: "administrator" } }), true);
});

Deno.test("OP gate: member counts as subscribed", () => {
  assertEquals(isSubscribed({ ok: true, result: { status: "member" } }), true);
});

Deno.test("OP gate: restricted counts as subscribed", () => {
  // restricted users are still in the channel
  assertEquals(isSubscribed({ ok: true, result: { status: "restricted" } }), true);
});

Deno.test("OP gate: left is blocked", () => {
  assertEquals(isSubscribed({ ok: true, result: { status: "left" } }), false);
});

Deno.test("OP gate: kicked is blocked", () => {
  assertEquals(isSubscribed({ ok: true, result: { status: "kicked" } }), false);
});

Deno.test("OP gate: API error (bot not admin) is blocked", () => {
  assertEquals(
    isSubscribed({ ok: false, description: "Bad Request: PARTICIPANT_ID_INVALID" }),
    false,
  );
});

Deno.test("OP gate: missing result is blocked", () => {
  assertEquals(isSubscribed({ ok: true }), false);
});

Deno.test("OP gate: null response is blocked", () => {
  assertEquals(isSubscribed(null), false);
});

// Subscribe keyboard composition: should always include the recheck button,
// and only include the URL button when a valid https link is provided.
function buildKeyboard(url: string) {
  const kb: any[][] = [];
  if (url?.startsWith("http")) kb.push([{ text: "📢 Подписаться", url }]);
  kb.push([{ text: "✅ Я подписался", callback_data: "sub:check" }]);
  return kb;
}

Deno.test("OP keyboard: includes Subscribe + Check when URL provided", () => {
  const kb = buildKeyboard("https://t.me/test_channel");
  assertEquals(kb.length, 2);
  assertEquals(kb[0][0].url, "https://t.me/test_channel");
  assertEquals(kb[1][0].callback_data, "sub:check");
});

Deno.test("OP keyboard: falls back to Check only when URL missing", () => {
  const kb = buildKeyboard("");
  assertEquals(kb.length, 1);
  assertEquals(kb[0][0].callback_data, "sub:check");
});

Deno.test("OP keyboard: ignores non-http URL (e.g. typo)", () => {
  const kb = buildKeyboard("t.me/test");
  assertEquals(kb.length, 1);
  assertEquals(kb[0][0].callback_data, "sub:check");
});
