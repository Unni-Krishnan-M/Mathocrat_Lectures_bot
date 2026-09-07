/**
 * Bot business logic.
 *
 * Pure and transport-free: `handleUpdate` takes a Telegram Update object and
 * returns a list of *actions* to perform. It performs no I/O itself, so it can
 * be unit-tested, and an AI API or MongoDB call can be slotted in later without
 * touching the HTTP/webhook layer.
 *
 * Action shape: { type: "sendMessage", chatId, text }
 */

const WELCOME =
  "Hello! \u{1F44B}\n\n" +
  "I'm Mathocrat_Lectures_bot, now running serverless on Netlify.\n" +
  "Send me a message!";

const HELP = "/start - Start the bot\n/help - Show help";

/** Strip a leading /command, tolerating the /command@BotName form. */
function parseCommand(text) {
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

const commands = {
  start: () => WELCOME,
  help: () => HELP,
};

/**
 * @param {object} update - a raw Telegram Update
 * @returns {Array<{type: string, chatId: number, text: string}>}
 */
export async function handleUpdate(update) {
  // Telegram sends many update kinds; we only act on plain text messages.
  const message = update?.message ?? update?.edited_message;
  if (!message) return [];

  const chatId = message.chat?.id;
  if (chatId === undefined || chatId === null) return [];

  const text = typeof message.text === "string" ? message.text : null;
  if (!text) {
    return [
      {
        type: "sendMessage",
        chatId,
        text: "I can only handle text messages right now.",
      },
    ];
  }

  const command = text.startsWith("/") ? parseCommand(text) : null;

  if (command) {
    const run = commands[command.name];
    if (!run) {
      return [
        {
          type: "sendMessage",
          chatId,
          text: `Unknown command: /${command.name}\n\n${HELP}`,
        },
      ];
    }
    return [{ type: "sendMessage", chatId, text: await run(command.args) }];
  }

  // Default behaviour: echo. Swap this for an AI call later.
  return [{ type: "sendMessage", chatId, text: `You said: ${text}` }];
}
