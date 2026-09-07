/**
 * Offline test of the bot's decision logic. No network, no token required.
 * Run: node scripts/test-logic.mjs
 */
import assert from "node:assert/strict";
import { handleUpdate } from "../lib/bot.mjs";

const msg = (text) => ({ message: { chat: { id: 42 }, text } });
const only = async (u) => (await handleUpdate(u))[0];

assert.equal((await only(msg("/start"))).text, "What lectures do you want?");
assert.equal((await only(msg("/start"))).chatId, 42);
assert.match((await only(msg("/help"))).text, /\/start.*\n.*\/help/s);
assert.match((await only(msg("/help@Mathocrat_Lectures_bot"))).text, /\/start/);
assert.equal((await only(msg("hello world"))).text, "You said: hello world");
assert.match((await only(msg("/nope"))).text, /Unknown command/);
assert.match((await only({ message: { chat: { id: 42 } } })).text, /only handle text/);

assert.deepEqual(await handleUpdate({}), []);
assert.deepEqual(await handleUpdate({ message: { text: "hi" } }), []); // no chat id
assert.deepEqual(await handleUpdate({ channel_post: { chat: { id: 1 }, text: "x" } }), []);
assert.deepEqual(await handleUpdate(null), []);

console.log("All bot-logic tests passed.");
