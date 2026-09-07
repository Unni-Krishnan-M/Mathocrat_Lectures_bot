#!/usr/bin/env node
/**
 * One-shot secure setup:
 *   1. Prompt for the BotFather token with terminal echo OFF.
 *   2. Generate a strong random webhook secret.
 *   3. Push both into Netlify environment variables (never into a tracked file).
 *   4. Register the Telegram webhook with secret_token.
 *   5. Verify with getWebhookInfo.
 *
 * The token is never printed, logged, written to the repo, or passed on a
 * command line (it goes to the Netlify CLI through a 0600 temp file that is
 * overwritten and deleted immediately afterwards).
 *
 * Run:  node scripts/setup-telegram.mjs
 */

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const MASK = (t) => `${t.slice(0, 4)}...${t.slice(-3)} (masked)`;

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "This script needs an interactive terminal. Run it directly:\n" +
            "  node scripts/setup-telegram.mjs",
        ),
      );
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Suppress echo: write the prompt once, then swallow keystroke output.
    let promptWritten = false;
    rl._writeToOutput = (chunk) => {
      if (!promptWritten) {
        rl.output.write(chunk);
        promptWritten = true;
      }
    };
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

function run(cmd, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${cmd} ${args[0]} exited with ${code}\n${out}`)),
    );
  });
}

async function telegram(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) {
    const desc = String(body.description ?? res.status).replaceAll(token, "***");
    throw new Error(`${method} failed: ${desc}`);
  }
  return body.result;
}

/** Set Netlify env vars without exposing values in argv/process list. */
async function setNetlifyEnv(vars) {
  const dir = mkdtempSync(join(tmpdir(), "tg-env-"));
  const file = join(dir, ".env");
  try {
    writeFileSync(file, "", { mode: 0o600 });
    chmodSync(file, 0o600);
    writeFileSync(
      file,
      Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    await run("netlify", ["env:import", file], { quiet: true });
  } finally {
    // Overwrite before unlinking so the bytes are not left on disk.
    try {
      writeFileSync(file, "\0".repeat(512), { mode: 0o600 });
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const siteUrl = (process.argv[2] ?? process.env.SITE_URL ?? "").replace(
    /\/+$/,
    "",
  );
  if (!/^https:\/\/.+/.test(siteUrl)) {
    console.error(
      "Usage: node scripts/setup-telegram.mjs https://<your-site>.netlify.app",
    );
    process.exit(1);
  }
  const webhookUrl = `${siteUrl}/.netlify/functions/webhook`;

  console.log(
    "\nPaste ONLY your Telegram BotFather token on the next line, then press Enter.",
  );
  console.log("(no BOT_TOKEN= prefix, no quotes, nothing else -- input is hidden)\n");
  const token = await promptHidden("Token: ");

  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    console.error(
      "That does not look like a BotFather token (expected <digits>:<letters>). Nothing was sent or saved.",
    );
    process.exit(1);
  }

  // Confirm the token works before storing it anywhere.
  const me = await telegram(token, "getMe");
  console.log(`Authenticated as @${me.username} (token ${MASK(token)})`);

  const secret = randomBytes(32).toString("base64url"); // 43 chars, Telegram-safe
  console.log("Generated a 256-bit webhook secret.");

  console.log("Setting Netlify environment variables...");
  await setNetlifyEnv({ BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret });
  console.log("  BOT_TOKEN                 set (value hidden)");
  console.log("  TELEGRAM_WEBHOOK_SECRET   set (value hidden)");

  console.log("\nRedeploying so the function picks up the new variables...");
  await run("netlify", ["deploy", "--prod"]);

  console.log(`\nRegistering webhook -> ${webhookUrl}`);
  await telegram(token, "setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    drop_pending_updates: true,
    allowed_updates: ["message", "edited_message"],
  });

  const info = await telegram(token, "getWebhookInfo");
  console.log("\ngetWebhookInfo:");
  console.log(`  url                    ${info.url}`);
  console.log(`  has_custom_certificate ${info.has_custom_certificate}`);
  console.log(`  pending_update_count   ${info.pending_update_count}`);
  console.log(`  max_connections        ${info.max_connections ?? "-"}`);
  if (info.last_error_message) {
    console.log(`  last_error_message     ${info.last_error_message}`);
  }

  console.log(
    `\nDone. Open Telegram, message @${me.username}, and send /start then /help.`,
  );
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`);
  process.exit(1);
});
