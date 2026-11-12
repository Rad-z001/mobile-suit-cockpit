// Builds the single-file page that gets published as the Artifact.
// Usage (from the game folder):  npm run build
import { execSync } from 'node:child_process';
import fs from 'node:fs';

fs.mkdirSync('dist', { recursive: true });
execSync('npx --yes esbuild@0.24.0 src/main.js --bundle --format=iife --minify --target=es2020 --outfile=dist/bundle.js', { stdio: 'inherit' });
const head = fs.readFileSync('artifact-template.html', 'utf8');
const js = fs.readFileSync('dist/bundle.js', 'utf8').replaceAll('</script', '<\/script');
fs.writeFileSync('dist/iron-coffin.html', `${head}<script>\n${js}\n</script>\n`);
console.log(`Built dist/iron-coffin.html (${Math.round((head.length + js.length) / 1024)} KB)`);
