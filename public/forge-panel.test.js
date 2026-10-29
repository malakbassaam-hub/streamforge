import assert from "node:assert/strict";
import test from "node:test";
import { renderPluginStatus, renderForgeContract, initForgePanel } from "./forge-panel.js";

function fakeDocument() {
  const nodes = new Map();
  function element(tag) {
    let text = "";
    return {
      tag, children: [], disabled: false, listeners: {}, value: "",
      focus() {}, select() {},
      set textContent(value) { text = String(value); this.children = []; },
      get textContent() { return text + this.children.map(child => child.textContent).join(""); },
      append(child) { this.children.push(child); },
      replaceChildren() { text = ""; this.children = []; },
      addEventListener(type, listener) { this.listeners[type] = listener; },
    };
  }
  return {
    createElement: element,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element("div"));
      return nodes.get(selector);
    },
  };
}

const contract = {
  contract: "# Plugin contract\n<script>untrusted text</script>", rules: "## Plugin authoring rules\nInline CSS/JS only.",
  positions: ["top-right", "recap"], events: { "chat.message": ["type", "user", "text", "ts"] },
};
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const initialFetch = async url => response(url === "/api/plugins/status" ? { valid: [], invalid: [] } : contract);

test("demo hype button posts the burst and reports success, cooldown and disabled-demo errors", async () => {
  const doc = fakeDocument();
  const replies = [response({ started: true }, 201), response({ retryAfterSeconds: 3 }, 429), response({ error: "Enable DEMO=1 to test hype bursts." }, 404)];
  const panel = initForgePanel(doc, async (url, options) => {
    if (url !== "/api/demo/burst") return initialFetch(url);
    assert.deepEqual(options, { method: "POST" });
    return replies.shift();
  });
  await panel.ready;
  await doc.querySelector("#demo-hype-burst").listeners.click();
  assert.match(doc.querySelector("#demo-hype-status").textContent, /42 viewers, 5 seconds/);
  await panel.sendBurst();
  assert.match(doc.querySelector("#demo-hype-status").textContent, /try again in 3 seconds/);
  await panel.sendBurst();
  assert.match(doc.querySelector("#demo-hype-status").textContent, /Enable DEMO=1/);
  assert.equal(doc.querySelector("#demo-hype-burst").disabled, false);
});

test("status rendering includes names, positions, warnings, invalid folders and readable reasons as text", () => {
  const doc = fakeDocument();
  renderPluginStatus(doc, {
    valid: [
      { name: "hello", position: "top-right", warnings: ["fetch() may make network requests"] },
      { name: "another", position: "top-right", warnings: [] },
    ],
    invalid: [{ folder: "<img src=x>", reason: "Bad JSON" }],
  });
  const valid = doc.querySelector("#plugins-valid");
  assert.equal(valid.children.length, 2);
  assert.match(valid.textContent, /hello — top-right/);
  assert.match(valid.textContent, /fetch\(\)/);
  assert.match(valid.textContent, /Slot already occupied/);
  const invalid = doc.querySelector("#plugins-invalid");
  assert.equal(invalid.children[0].tag, "li");
  assert.equal(invalid.children[0].textContent, "<img src=x> — Bad JSON");
  assert.equal(invalid.children[0].children.length, 0);
  renderPluginStatus(doc, { valid: [], invalid: [] });
  assert.equal(valid.textContent, "No valid plugins found.");
  assert.equal(invalid.textContent, "No invalid plugins found.");
});

test("contract rendering shows docs, rules, allowed positions and event fields without interpreting HTML", () => {
  const doc = fakeDocument();
  renderForgeContract(doc, contract);
  assert.equal(doc.querySelector("#forge-contract").textContent, contract.contract);
  assert.equal(doc.querySelector("#forge-contract").children.length, 0);
  assert.equal(doc.querySelector("#forge-rules").textContent, contract.rules);
  assert.equal(doc.querySelector("#forge-positions").textContent, "top-right, recap");
  assert.equal(doc.querySelector("#forge-events").textContent, "chat.message: type, user, text, ts");
  renderForgeContract(doc, { ...contract, events: {} });
  assert.equal(doc.querySelector("#forge-events").children.length, 0);
});

test("management view fetches and renders both endpoints initially and on refresh", async () => {
  const doc = fakeDocument();
  const calls = [];
  const panel = initForgePanel(doc, async url => { calls.push(url); return initialFetch(url); });
  await panel.ready;
  assert.deepEqual(calls, ["/api/plugins/status", "/api/forge/contract"]);
  assert.match(doc.querySelector("#forge-status").textContent, /up to date/);
  assert.equal(doc.querySelector("#forge-refresh").disabled, false);
  await doc.querySelector("#forge-refresh").listeners.click();
  assert.equal(calls.length, 4);
});

test("a failed status fetch does not prevent contract display or retry", async () => {
  const doc = fakeDocument();
  const panel = initForgePanel(doc, async url => url === "/api/plugins/status" ? response({}, 503) : response(contract));
  await panel.ready;
  assert.match(doc.querySelector("#forge-status").textContent, /503/);
  assert.equal(doc.querySelector("#forge-contract").textContent, contract.contract);
  assert.equal(doc.querySelector("#forge-refresh").disabled, false);
});

test("test button posts once while pending and displays success and rate-limit feedback", async () => {
  const doc = fakeDocument();
  const calls = [];
  let resolveTest;
  const panel = initForgePanel(doc, async (url, options) => {
    if (url !== "/api/forge/test") return initialFetch(url);
    calls.push({ url, options });
    return new Promise(resolve => { resolveTest = resolve; });
  });
  await panel.ready;
  const pending = doc.querySelector("#forge-test").listeners.click();
  assert.equal(doc.querySelector("#forge-test").disabled, true);
  await panel.sendTest();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { url: "/api/forge/test", options: { method: "POST" } });
  resolveTest(response({ started: true }, 202));
  await pending;
  assert.match(doc.querySelector("#forge-test-status").textContent, /Test started: 12 chat messages/);
  assert.equal(doc.querySelector("#forge-test").disabled, false);
  const limited = panel.sendTest();
  resolveTest(response({ retryAfterSeconds: 4 }, 429));
  await limited;
  assert.match(doc.querySelector("#forge-test-status").textContent, /try again in 4 seconds/);
});

test("test button reports network failures and becomes usable again", async () => {
  const doc = fakeDocument();
  const panel = initForgePanel(doc, async url => {
    if (url === "/api/forge/test") throw new Error("Server unavailable");
    return initialFetch(url);
  });
  await panel.ready;
  await panel.sendTest();
  assert.match(doc.querySelector("#forge-test-status").textContent, /Server unavailable/);
  assert.equal(doc.querySelector("#forge-test").disabled, false);
});

test("builder examples populate the description and copying uses a fresh contract and a safe slug", async () => {
  const doc = fakeDocument();
  let copied;
  const calls = [];
  const panel = initForgePanel(doc, async (url, options) => { calls.push({ url, options }); return initialFetch(url); },
    { writeText: async text => { copied = text; } });
  await panel.ready;
  doc.querySelector("#forge-name").value = "Raid Welcome";
  doc.querySelector("#forge-name").listeners.input();
  assert.equal(doc.querySelector("#forge-name").value, "raid-welcome");
  doc.querySelector("#forge-example-1").listeners.click();
  assert.match(doc.querySelector("#forge-description").value, /Celebrate raids/);
  await panel.copyPrompt();
  assert.match(copied, /plugins\/raid-welcome\/plugin.html/);
  assert.equal(doc.querySelector("#forge-prompt").value, copied);
  assert.match(doc.querySelector("#forge-prompt-status").textContent, /copied to clipboard/);
  assert.deepEqual(calls.at(-1), { url: "/api/forge/contract", options: { cache: "no-store" } });
});

test("builder preserves generated text when clipboard access is denied", async () => {
  const doc = fakeDocument();
  const panel = initForgePanel(doc, initialFetch, { writeText: async () => { throw new Error("Denied"); } });
  await panel.ready;
  doc.querySelector("#forge-name").value = "card";
  doc.querySelector("#forge-description").value = "Show chat";
  await panel.copyPrompt();
  assert.match(doc.querySelector("#forge-prompt").value, /plugins\/card\/manifest.json/);
  assert.match(doc.querySelector("#forge-prompt-status").textContent, /press Ctrl\+C/);
  assert.equal(doc.querySelector("#forge-copy").disabled, false);
});

test("builder explains API 404s and never copies an incomplete prompt", async () => {
  const doc = fakeDocument();
  const panel = initForgePanel(doc, async url => url === "/api/forge/contract" ? response({}, 404) : initialFetch(url),
    { writeText: () => assert.fail("Must not copy") });
  await panel.ready;
  await panel.copyPrompt();
  assert.match(doc.querySelector("#forge-prompt-status").textContent, /Restart StreamForge/);
  assert.equal(doc.querySelector("#forge-prompt").value, "");
});
