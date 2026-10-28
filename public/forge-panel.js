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

export function initForgePanel(document, fetchImpl = globalThis.fetch) {
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
      if (!response.ok) throw new Error(`${url}: request failed (${response.status}).`);
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

  refreshButton.addEventListener("click", refresh);
  testButton.addEventListener("click", sendTest);
  return { ready: refresh(), refresh, sendTest };
}
