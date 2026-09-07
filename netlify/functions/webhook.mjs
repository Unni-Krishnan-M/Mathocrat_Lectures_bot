/**
 * Telegram webhook receiver (Netlify Function, v2 API).
 *
 * Endpoint: /.netlify/functions/webhook
 *
 * Responsibilities, and nothing else:
 *   1. Verify the X-Telegram-Bot-Api-Secret-Token header.
 *   2. Parse the update.
 *   3. Delegate to lib/bot.mjs for the decision, lib/telegram.mjs for the call.
 *
 * No polling, no event loop, no background process: one HTTP invocation per
 * Telegram update.
 */

import { timingSafeEqual } from "node:crypto";
import { handleUpdate } from "../../lib/bot.mjs";
import { sendMessage } from "../../lib/telegram.mjs";

/** Constant-time string comparison that does not leak length via early exit. */
function secretMatches(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not configured");
    return new Response("Server not configured", { status: 500 });
  }

  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secretMatches(provided, expectedSecret)) {
    // Do not reveal whether the header was missing or merely wrong.
    console.warn("Rejected webhook request: invalid secret token");
    return new Response("Forbidden", { status: 403 });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    console.warn("Rejected webhook request: malformed JSON body");
    return new Response("Bad Request", { status: 400 });
  }

  try {
    const actions = await handleUpdate(update);
    for (const action of actions) {
      if (action.type === "sendMessage") {
        await sendMessage(action.chatId, action.text);
      }
    }
  } catch (err) {
    // Telegram retries on non-2xx, which would loop on a persistent bug.
    // Log the reason (never the token) and acknowledge the update.
    console.error("Failed to handle update:", err?.message ?? err);
  }

  return new Response("ok", { status: 200 });
};
