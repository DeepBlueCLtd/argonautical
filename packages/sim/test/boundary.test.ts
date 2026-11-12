import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { checkBoundary } from '../scripts/check-boundary.mjs';

describe('module boundary (ARC-1)', () => {
  it('our modules import nothing from the orchestrator, shims or deployment model', () => {
    const r = checkBoundary();
    expect(r.violations).toEqual([]);
    expect(r.checkedFiles).toBe(4);
  });

  it('the check catches a violation', () => {
    const root = mkdtempSync(join(tmpdir(), 'boundary-'));
    mkdirSync(join(root, 'src/modules'), { recursive: true });
    mkdirSync(join(root, 'src/orchestrator'), { recursive: true });
    writeFileSync(join(root, 'src/orchestrator/shims.ts'), 'export const x = 1;\n');
    writeFileSync(join(root, 'src/modules/bad.ts'), "import { x } from '../orchestrator/shims.ts';\nexport const y = x;\n");
    const r = checkBoundary(root);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ file: 'src/modules/bad.ts', imports: '../orchestrator/shims.ts' });
  });
});
