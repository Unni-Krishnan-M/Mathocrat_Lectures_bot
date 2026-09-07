/**
 * Telegram Bot API transport layer.
 *
 * This module knows ONLY how to talk to the Telegram HTTP API.
 * It contains no bot business logic, so the logic in ./bot.mjs stays
 * testable and reusable (e.g. if an AI backend or MongoDB is added later).
 *
 * The bot token is read from the environment. It is never logged.
 */

const API_ROOT = "https://api.telegram.org";

function requireToken() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN environment variable is not set");
  }
  return token;
}

/**
 * Call an arbitrary Telegram Bot API method.
 * Errors are surfaced with the token stripped from any message.
 */
export async function callTelegram(method, payload, { timeoutMs = 8000 } = {}) {
  const token = requireToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok || body.ok === false) {
      // Telegram error descriptions never contain the token, but scrub anyway.
      const description = String(body.description ?? res.status).replaceAll(
        token,
        "***",
      );
      throw new Error(`Telegram API ${method} failed: ${description}`);
    }

    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export function sendMessage(chatId, text, extra = {}) {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...extra,
  });
}
