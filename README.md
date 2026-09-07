# Mathocrat Lectures Bot — serverless Telegram bot on Netlify

A Telegram bot that runs **without any always-on process**. Telegram pushes each
update to a Netlify Function over HTTPS; the function replies and exits. Your
laptop can be off.

```
Telegram  ──POST──▶  https://<site>.netlify.app/.netlify/functions/webhook
                              │  verifies X-Telegram-Bot-Api-Secret-Token
                              │  lib/bot.mjs decides what to say
                              └──▶ api.telegram.org/bot<token>/sendMessage
```

No polling. No `run_polling()`. No background worker. One HTTP invocation per message.

## Why the function is JavaScript, not Python

Netlify Functions support **JavaScript/TypeScript and Go only** — there is no
Python function runtime on Netlify. A `webhook.py` would deploy as a dead file
that Telegram could never reach. The handler is therefore zero-dependency Node
ESM (global `fetch`, no npm packages at all).

The original Python polling bot is preserved unchanged at
[`legacy/bot_polling.py`](legacy/bot_polling.py) for local experimentation. It is
**not** used in production.

## Layout

| Path | Role |
| --- | --- |
| `netlify/functions/webhook.mjs` | HTTP entry point: secret verification, parsing, dispatch |
| `lib/bot.mjs` | Business logic. Pure — takes an Update, returns actions. No I/O |
| `lib/telegram.mjs` | Telegram API transport. Knows HTTP, knows no bot rules |
| `scripts/setup-telegram.mjs` | Secure token prompt → Netlify env vars → `setWebhook` |
| `scripts/test-logic.mjs` | Offline tests for `lib/bot.mjs`. No token needed |
| `netlify.toml` | Functions dir, esbuild bundler, publish dir |
| `public/index.html` | Static placeholder page |
| `legacy/` | Previous polling implementation (reference only) |

The split between `lib/bot.mjs` and `lib/telegram.mjs` is deliberate: adding an AI
API or MongoDB means editing `lib/bot.mjs` only — the webhook and transport
layers stay untouched.

## Commands

| Input | Reply |
| --- | --- |
| `/start` | Friendly welcome |
| `/help` | List of commands |
| any other text | Echo: `You said: …` |
| non-text message | Polite "text only" notice |

## Secrets

Two environment variables, stored **only** in Netlify — never in the repo, never
in Git, never on a command line:

| Variable | Purpose |
| --- | --- |
| `BOT_TOKEN` | BotFather token, used to call the Telegram API |
| `TELEGRAM_WEBHOOK_SECRET` | 256-bit random value; Telegram echoes it in `X-Telegram-Bot-Api-Secret-Token` on every request |

Requests with a missing or wrong secret get `403` and are never processed. The
comparison is constant-time (`crypto.timingSafeEqual`).

## Deploy from scratch

```bash
npm run check                    # syntax + offline logic tests

netlify login                    # if not already authenticated
netlify sites:create --name <unique-site-name>
netlify link --name <unique-site-name>
netlify deploy --prod            # first deploy; note the printed URL
```

Then configure secrets and the webhook in one step — run this **in your own
terminal** (it needs a real TTY so the token can be typed without echo):

```bash
node scripts/setup-telegram.mjs https://<your-site>.netlify.app
```

It will:

1. Prompt for the token with echo disabled (nothing appears as you type).
2. Verify it with `getMe`, printing only a masked form.
3. Generate a 256-bit webhook secret.
4. Write both to Netlify env vars via a `0600` temp file that is shredded after.
5. Redeploy so the function sees them.
6. Call `setWebhook` with `secret_token`, then print `getWebhookInfo`.

## Everyday redeploys

```bash
git add -A && git commit -m "…" && git push
netlify deploy --prod
```

Environment variables persist across deploys — you only run the setup script
again if you rotate the token or the secret.

## Local development

```bash
cp .env.example .env             # .env is gitignored
# fill in BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET
netlify dev                      # serves the function on http://localhost:8888
```

`netlify dev` gives you a local URL, but Telegram needs a public HTTPS endpoint,
so point the webhook at the deployed site for real testing. To exercise the
handler locally without Telegram:

```bash
curl -X POST http://localhost:8888/.netlify/functions/webhook \
  -H 'content-type: application/json' \
  -H "x-telegram-bot-api-secret-token: $TELEGRAM_WEBHOOK_SECRET" \
  -d '{"message":{"chat":{"id":<your-chat-id>},"text":"/start"}}'
```

## Testing the live bot

1. Open Telegram, find your bot, send `/start` → welcome message.
2. Send `/help` → command list.
3. Send `hello` → `You said: hello`.

## Troubleshooting

**No reply at all.** Check the webhook is registered and error-free:

```bash
read -rs TOKEN                   # paste token, hidden, not saved to history
curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo" | python3 -m json.tool
unset TOKEN
```

`last_error_message` is the fastest diagnosis. Common values:

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Wrong response from the webhook: 403 Forbidden` | `TELEGRAM_WEBHOOK_SECRET` in Netlify ≠ the secret given to `setWebhook` | Re-run `scripts/setup-telegram.mjs` |
| `Wrong response from the webhook: 500` | `TELEGRAM_WEBHOOK_SECRET` missing in Netlify | `netlify env:list` to confirm, then re-run setup |
| `url` empty | webhook never registered | Run `scripts/setup-telegram.mjs` |
| Webhook fine, bot silent | `BOT_TOKEN` missing/invalid | `netlify logs:function webhook` |
| `pending_update_count` climbing | function erroring | check function logs |

**Function logs** (never contain secrets — the code scrubs the token from error
messages):

```bash
netlify logs:function webhook
```

**Reset the webhook:**

```bash
curl -s "https://api.telegram.org/bot$TOKEN/deleteWebhook?drop_pending_updates=true"
```

**Free-tier limits.** Netlify's free plan allows 125k function invocations and
100 hours of runtime per month. Each Telegram message is one invocation lasting
well under a second, so a personal bot stays comfortably inside it.

## Extending later

- **AI replies** — replace the echo branch in `lib/bot.mjs`. Keep the call under
  ~10s; Telegram retries slow webhooks. For longer work, ack immediately and
  send the reply from a [background function](https://docs.netlify.com/functions/background-functions/).
- **MongoDB** — add `lib/db.mjs`. Use MongoDB Atlas with a pooled client cached
  in module scope so warm invocations reuse the connection; put the URI in a
  Netlify env var.
- **New commands** — add an entry to the `commands` map in `lib/bot.mjs` and a
  line to the help text. Add a case to `scripts/test-logic.mjs`.
