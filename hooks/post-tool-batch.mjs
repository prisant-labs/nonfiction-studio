// what-it-is:   Phase 1 stub for the PostToolBatch hook event; replaced by TSK-033 (post-tool-batch hook)
// what-it-does: reads stdin to completion, writes nothing to stdout, exits 0;
//               when NS_HOOK_TRACE is set, appends one trace line to the file at that path
//               (event name, own resolved path from import.meta.url, raw stdin JSON) for firing proof

import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Drain stdin; the platform delivers event JSON here on every hook invocation.
const raw = readFileSync(0, 'utf8');

if (process.env.NS_HOOK_TRACE) {
  const ownPath = fileURLToPath(import.meta.url);
  const record = JSON.stringify({ event: 'PostToolBatch', script: ownPath, stdinRaw: raw.trim() });
  appendFileSync(process.env.NS_HOOK_TRACE, record + '\n', 'utf8');
}

// Empty stdout is the platform no-op for hook command entries.
process.exit(0);
