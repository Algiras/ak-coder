/**
 * Post-install patches applied after bun install:
 *
 * 1. signal-exit: ink@7 needs signal-exit@3's default-export API, while
 *    @claude-code-kit/ink-renderer needs signal-exit@4's named `onExit`.
 *    Fix: add `export default onExit` to signal-exit@4's ESM build.
 *
 * 2. @claude-code-kit/ui: hardcodes "Claude" as the assistant label.
 *    Replace with the configured assistantName (from ~/.ak-coder/config.json,
 *    falling back to "AKCoder").
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

// Read assistantName from global config if present
function readAssistantName() {
  try {
    const configPath = join(os.homedir(), '.ak-coder', 'config.json');
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (typeof cfg.assistantName === 'string' && cfg.assistantName.trim()) {
        return cfg.assistantName.trim();
      }
    }
  } catch {}
  return 'AKCoder';
}

const ASSISTANT_NAME = readAssistantName();

// ── 1. signal-exit ──────────────────────────────────────────────────────────

const esmPath = new URL(
  '../node_modules/.bun/signal-exit@4.1.0/node_modules/signal-exit/dist/mjs/index.js',
  import.meta.url
).pathname;

if (existsSync(esmPath)) {
  const content = readFileSync(esmPath, 'utf8');
  if (!content.includes('export default onExit')) {
    writeFileSync(esmPath, content + '\nexport default onExit;\n');
    console.log('[patch] signal-exit@4: added default export.');
  }
} else {
  console.warn('[patch] signal-exit@4 ESM build not found, skipping.');
}

// ── 2. @claude-code-kit/ui assistant label ─────────────────────────────────

function patchUiFile(filePath) {
  if (!existsSync(filePath)) {
    console.warn(`[patch] not found, skipping: ${filePath}`);
    return;
  }
  let ui = readFileSync(filePath, 'utf8');
  let changed = false;

  // ROLE_CONFIG assistant label — replace whatever name is currently there
  const rolePat = /assistant: \{ icon: "\\u25CF", label: "[^"]+", color: "#DA7756" \}/;
  const roleNew = `assistant: { icon: "\\u25CF", label: "${ASSISTANT_NAME}", color: "#DA7756" }`;
  if (rolePat.test(ui)) {
    ui = ui.replace(rolePat, roleNew);
    changed = true;
  }

  // Hardcoded streaming header — locate the exact multiline pattern and replace
  const streamSearch = `          " ",\n          "Claude"\n        ]`;
  const streamReplace = `          " ",\n          "${ASSISTANT_NAME}"\n        ]`;
  if (ui.includes(streamSearch)) {
    ui = ui.replaceAll(streamSearch, streamReplace);
    changed = true;
  }

  if (changed) {
    writeFileSync(filePath, ui);
    console.log(`[patch] ${filePath.split('/').pop()}: set assistant label to "${ASSISTANT_NAME}".`);
  }
}

const uiBase = new URL(
  '../node_modules/.bun/@claude-code-kit+ui@0.3.1+0a72fcd94f4e1344/node_modules/@claude-code-kit/ui/dist/',
  import.meta.url
).pathname;

patchUiFile(uiBase + 'index.js');
patchUiFile(uiBase + 'index.mjs');
