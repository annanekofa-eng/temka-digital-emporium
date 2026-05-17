import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { safeSlice, maskToken } from "./_shared/tg.ts";

Deno.test("safeSlice: returns input when under limit", () => {
  assertEquals(safeSlice("hello", 64), "hello");
});

Deno.test("safeSlice: trims to byte boundary for ASCII", () => {
  const out = safeSlice("abcdefghij", 5);
  assertEquals(out, "abcde");
  assertEquals(new TextEncoder().encode(out).length <= 5, true);
});

Deno.test("safeSlice: never returns broken UTF-8 surrogate pair", () => {
  // "📦" is 4 bytes UTF-8. With maxBytes=3 we must drop it entirely.
  const out = safeSlice("📦📦", 3);
  assertEquals(out, "");
});

Deno.test("safeSlice: keeps full codepoints under limit", () => {
  // "📦" = 4 bytes; budget of 4 fits exactly one box.
  const out = safeSlice("📦📦", 4);
  assertEquals(out, "📦");
});

Deno.test("safeSlice: handles empty and undefined-ish input", () => {
  assertEquals(safeSlice("", 10), "");
  // @ts-expect-error testing runtime guard
  assertEquals(safeSlice(undefined, 10), "");
});

Deno.test("maskToken: redacts bot token-shaped strings", () => {
  const s = "Bad request: bot7654321:ABCdefGHIjklMNOpqrSTUvwxYZ-1234567 failed";
  const masked = maskToken(s);
  assertEquals(masked.includes("ABCdef"), false);
  assertEquals(masked.includes("<bot_token>"), true);
});

Deno.test("maskToken: leaves clean strings alone", () => {
  assertEquals(maskToken("nothing to hide"), "nothing to hide");
  assertEquals(maskToken(""), "");
});
