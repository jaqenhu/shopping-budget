const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'index.html');
let html = fs.readFileSync(target, 'utf8');
for (const [id, file] of [['supabase-sdk', 'vendor/supabase-sdk.js'], ['cloud-sync-engine', 'src/sync-engine.js']]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  const tag = `<script id="${id}">\n${source}\n</script>`;
  const regex = new RegExp(`<script id="${id}">[\\s\\S]*?<\\/script>`);
  html = regex.test(html) ? html.replace(regex, () => tag) : html.replace(/<script>\s*"use strict";/, () => tag + '\n<script>\n"use strict";');
}
const bridge = fs.readFileSync(path.join(root, 'src/cloud-bridge.js'), 'utf8');
html = html.replace(/\/\* CLOUD_BRIDGE_START \*\/[\s\S]*?\/\* CLOUD_BRIDGE_END \*\//,
  () => '/* CLOUD_BRIDGE_START */\n' + bridge + '\n/* CLOUD_BRIDGE_END */');
fs.writeFileSync(target, html, 'utf8');
console.log('Cloud runtime embedded in standalone HTML.');
