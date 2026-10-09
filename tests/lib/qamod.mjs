// The one non-test file QA creates: a dormant creation that only exposes its ctx on window.__qaCtx so scenarios can call
// world.library.spawn(ctx, ...), world.weapons.create(ctx, ...) etc. like a real creation. Removed again when the run ends.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './server.mjs';

import { SANDBOX } from './sandbox.mjs';
export const QA_MODULE = path.join(SANDBOX, 'public', 'game', 'creations', 'zz-qa-hook.js');
const SRC = `// QA hook (temporary; created by tests/lib/qamod.mjs, deleted when the QA run ends). Exposes this module's ctx as window.__qaCtx.
export const meta = { name: 'QA hook', description: 'test harness hook' };
export default function (ctx) {
  window.__qaCtx = ctx;
  return { dispose() { if (window.__qaCtx === ctx) delete window.__qaCtx; } };
}
`;
export function installQaModule() {
  const tmp = QA_MODULE + '.tmp';
  fs.writeFileSync(tmp, SRC);
  fs.renameSync(tmp, QA_MODULE);
}
export function removeQaModule() {
  try { fs.unlinkSync(QA_MODULE); } catch { /* not there */ }
  try { fs.unlinkSync(QA_MODULE + '.tmp'); } catch { /* not there */ }
}

