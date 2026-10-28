import { slug, buildForgePrompt } from "./forge-prompt.js";

function textNode(document, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  node.dir = "auto";
  return node;
}

export function renderPluginStatus(document, status) {
  const valid = document.querySelector("#plugins-valid");
  const invalid = document.querySelector("#plugins-invalid");
  valid.replaceChildren();
  invalid.replaceChildren();
  const occupied = new Set();
  for (const plugin of status.valid) {
    const item = textNode(document, "li", `${plugin.name} — ${plugin.position}`);
    const warnings = [...(plugin.warnings ?? [])];
    if (occupied.has(plugin.position)) warnings.push("Slot already occupied; this plugin will not appear on the overlay.");
    occupied.add(plugin.position);
    if (warnings.length) {
      const list = document.createElement("ul");
      for (const warning of warnings) list.append(textNode(document, "li", warning));
      item.append(list);
    }
    valid.append(item);
  }
  for (const plugin of status.invalid) {
    invalid.append(textNode(document, "li", `${plugin.folder} — ${plugin.reason}`));
  }
  if (!status.valid.length) valid.append(textNode(document, "li", "No valid plugins found."));
  if (!status.invalid.length) invalid.append(textNode(document, "li", "No invalid plugins found."));
}

export function renderForgeContract(document, contract) {
  document.querySelector("#forge-contract").textContent = contract.contract;
  document.querySelector("#forge-rules").textContent = contract.rules;
  document.querySelector("#forge-positions").textContent = contract.positions.join(", ");
  const events = document.querySelector("#forge-events");
  events.replaceChildren();
  for (const [type, fields] of Object.entries(contract.events)) {
    events.append(textNode(document, "li", `${type}: ${fields.join(", ")}`));
  }
}

export function initForgePanel(document, fetchImpl = globalThis.fetch, clipboard = globalThis.navigator?.clipboard) {
  const refreshButton = document.querySelector("#forge-refresh");
  const testButton = document.querySelector("#forge-test");
  const status = document.querySelector("#forge-status");
  const feedback = document.querySelector("#forge-test-status");

  async function refresh() {
    if (refreshButton.disabled) return;
    refreshButton.disabled = true;
    status.textContent = "Loading plugins and contract…";
    const results = await Promise.allSettled([
      ["/api/plugins/status", renderPluginStatus], ["/api/forge/contract", renderForgeContract],
    ].map(async ([url, render]) => {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(response.status === 404 ? `${url}: Forge API unavailable. Restart StreamForge with npm start and refresh.` : `${url}: request failed (${response.status}).`);
      render(document, await response.json());
    }));
    const errors = results.filter(result => result.status === "rejected").map(result => result.reason.message);
    status.textContent = errors.length ? errors.join(" ") : "Plugin status and contract are up to date.";
    refreshButton.disabled = false;
  }

  async function sendTest() {
    if (testButton.disabled) return;
    testButton.disabled = true;
    feedback.textContent = "Starting test events…";
    try {
      const response = await fetchImpl("/api/forge/test", { method: "POST" });
      const result = await response.json();
      if (response.status === 429) {
        feedback.textContent = `Rate limit: try again in ${result.retryAfterSeconds ?? 5} seconds.`;
      } else if (!response.ok) {
        throw new Error(result.error || `Test request failed (${response.status}).`);
      } else {
        feedback.textContent = "Test started: 12 chat messages, a raid, and a vote result over about 8 seconds. View them in the overlay.";
      }
    } catch (error) {
      feedback.textContent = `Could not start test: ${error.message}`;
    } finally {
      testButton.disabled = false;
    }
  }

  const nameInput = document.querySelector("#forge-name");
  const description = document.querySelector("#forge-description");
  const copyButton = document.querySelector("#forge-copy");
  const output = document.querySelector("#forge-prompt");
  const promptStatus = document.querySelector("#forge-prompt-status");
  nameInput.addEventListener("input", () => {
    const value = nameInput.value;
    const normalized = slug(value);
    nameInput.value = normalized + (normalized && /[\s_-]$/.test(value) ? "-" : "");
  });
  const examples = [
    "Show the latest chat message in a compact themed card in the top-right slot.",
    "Celebrate raids with a brief animated welcome showing the raider name and viewer count in the top-left slot.",
    "Display a clean recap card for 12 seconds in the recap slot when a recap.card event arrives.",
  ];
  examples.forEach((example, index) => document.querySelector("#forge-example-" + index).addEventListener("click", () => {
    description.value = example;
    description.focus();
  }));
  async function copyPrompt() {
    if (copyButton.disabled) return;
    copyButton.disabled = true;
    promptStatus.textContent = "Building prompt...";
    output.value = "";
    try {
      const response = await fetchImpl("/api/forge/contract", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404
        ? "Forge API unavailable. Restart StreamForge with npm start, then refresh this page."
        : "Could not load the Forge contract (" + response.status + ").");
      nameInput.value = slug(nameInput.value);
      output.value = buildForgePrompt({ name: nameInput.value, description: description.value, contract: await response.json() });
      try {
        if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
        await clipboard.writeText(output.value);
        promptStatus.textContent = "Forge prompt copied to clipboard.";
      } catch {
        output.focus();
        output.select();
        promptStatus.textContent = "Prompt ready. Clipboard unavailable; press Ctrl+C or Command+C to copy the selected text.";
      }
    } catch (error) { promptStatus.textContent = error.message; }
    finally { copyButton.disabled = false; }
  }
  copyButton.addEventListener("click", copyPrompt);
  refreshButton.addEventListener("click", refresh);
  testButton.addEventListener("click", sendTest);
  return { ready: refresh(), refresh, sendTest, copyPrompt };
}
