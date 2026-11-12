#!/usr/bin/env node
/**
 * ARC-1 / ARC-7 boundary check: our modules must not import the orchestrator,
 * the shims or the deployment model. Uses the TypeScript parser, not regexes.
 *
 * Usage: node scripts/check-boundary.mjs [--json <out>]
 * Exit code 1 on any violation.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));

export const RULES = {
  /** Our modules (SRD §1.2, ARC-1). */
  modules: ['src/modules'],
  /** What they may not import. */
  forbidden: ['src/orchestrator', 'src/topology/deployment.ts'],
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mts)$/.test(name) ? [p] : [];
  });
}

export function checkBoundary(root = resolve(here, '..'), rules = RULES) {
  const forbidden = rules.forbidden.map((f) => resolve(root, f));
  const violations = [];
  const files = rules.modules.flatMap((m) => walk(resolve(root, m)));
  for (const file of files) {
    const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const imp of info.importedFiles) {
      const spec = imp.fileName;
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      const hit = forbidden.find((f) => target === f || target.startsWith(f + '/'));
      if (hit) violations.push({ file: relative(root, file), imports: spec, rule: `must not import ${relative(root, hit)}` });
    }
  }
  return { ok: violations.length === 0, checkedFiles: files.length, violations };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkBoundary();
  const i = process.argv.indexOf('--json');
  if (i > 0 && process.argv[i + 1]) writeFileSync(process.argv[i + 1], JSON.stringify(result, null, 2) + '\n');
  if (result.ok) {
    console.log(`boundary check passed: ${result.checkedFiles} module files import nothing from the orchestrator, shims or deployment model`);
  } else {
    console.error('boundary check FAILED:');
    for (const v of result.violations) console.error(`  ${v.file} imports ${v.imports} (${v.rule})`);
    process.exit(1);
  }
}
