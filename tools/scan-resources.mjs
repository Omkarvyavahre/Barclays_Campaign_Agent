import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, basename, extname } from 'node:path';

const name = 'Barclays Brand Guidelines, Content & GS4PM Demo Support';
const candidates = [
  resolve(process.cwd(), '..', name),
  resolve(process.cwd(), name)
];
const root = candidates.find((c) => existsSync(c));
if (!root) {
  console.log(JSON.stringify({ error: 'not found', candidates }));
  process.exit(1);
}

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(full);
  }
}
walk(root);
files.sort();
console.log(
  JSON.stringify(
    {
      root,
      count: files.length,
      files: files.map((f) => ({
        filename: basename(f),
        relativePath: relative(root, f).split('\\').join('/'),
        ext: extname(f).toLowerCase(),
        bytes: statSync(f).size
      }))
    },
    null,
    2
  )
);
