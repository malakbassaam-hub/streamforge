export function slug(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildForgePrompt({ name, description, contract }) {
  const nameSlug = slug(name);
  if (!nameSlug) throw new Error("Enter a plugin name using Latin letters or digits.");
  if (typeof description !== "string" || !description.trim()) throw new Error("Describe your plugin first.");
  if (!contract || typeof contract.contract !== "string" || typeof contract.rules !== "string"
      || !contract.events || !Array.isArray(contract.positions)) throw new Error("The Forge contract is incomplete. Refresh and try again.");
  return `Create a StreamForge plugin named "${nameSlug}".

Task:
${description.trim()}

Create ONLY these exact files:
- plugins/${nameSlug}/manifest.json
- plugins/${nameSlug}/plugin.html
The manifest name must be exactly "${nameSlug}". Do not overwrite an existing plugin; report a name collision instead.

Plugin contract:
${contract.contract}

Authoring rules:
${contract.rules}

Allowed events and their forwarded fields:
${JSON.stringify(contract.events, null, 2)}

Allowed manifest positions:
${contract.positions.join(", ")}

Acceptance checklist:
- Only the two specified files are created; manifest name matches the folder and all manifest fields are valid.
- One self-contained HTML file with inline CSS/JS; no network, external files, imports, or storage.
- Receive events only via window.addEventListener("message"); verify event.source === parent.
- Use theme tokens, transparent html/body, dir="auto", textContent, empty-data handling, and reduced-motion support; keep animated DOM nodes under about 30.
- Select an available named slot, respect its clamped bounds, and never cover the vote card.
- Keep sandbox="allow-scripts" only; do not change plugin CSP, OAuth, EventSub, or server code.
- Validate the manifest with /api/plugins/status and exercise the plugin using Forge Kit's overlay test.
`;
}
