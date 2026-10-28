import assert from "node:assert/strict";
import test from "node:test";
import { slug, buildForgePrompt } from "./forge-prompt.js";

const contract = { contract: "Full contract text", rules: "Full authoring rules", events: { raid: ["type", "user", "viewers", "ts"] }, positions: ["top-left", "recap"] };

test("slug produces safe kebab-case names without paths", () => {
  for (const [input, expected] of [["  Raid Welcome! ", "raid-welcome"], ["Café Card", "cafe-card"], ["../../Evil_Name", "evil-name"], ["a---b", "a-b"], [null, ""], ["\u0645\u0631\u062d\u0628\u0627", ""], ["123 plugin", "123-plugin"]]) {
    assert.equal(slug(input), expected);
    assert.equal(slug(slug(input)), expected);
  }
});

test("prompt includes the task, complete contract, rules, event fields, slots, exact files and checklist", () => {
  const prompt = buildForgePrompt({ name: "Raid Welcome", description: "Celebrate a raid.", contract });
  for (const text of ["Celebrate a raid.", contract.contract, contract.rules, "plugins/raid-welcome/manifest.json", "plugins/raid-welcome/plugin.html", 'exactly "raid-welcome"', '"viewers"', "top-left, recap", "Acceptance checklist", 'sandbox="allow-scripts"', "name collision"]) assert.ok(prompt.includes(text), text);
  assert.throws(() => buildForgePrompt({ name: "../", description: "Hi", contract }), /plugin name/);
  assert.throws(() => buildForgePrompt({ name: "card", description: " ", contract }), /Describe/);
  assert.throws(() => buildForgePrompt({ name: "card", description: "Hi", contract: {} }), /incomplete/);
});
