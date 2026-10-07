import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'site');
const files = ['index.html', 'mvp.js', 'mvp.css', 'mvp-actions.js', 'mvp-actions.css', 'config.js', 'icon.svg', '.nojekyll'];
for (const name of files) {
  if (!existsSync(resolve(root, name))) throw new Error(`Missing site asset: ${name}`);
}
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const app = readFileSync(resolve(root, 'mvp.js'), 'utf8');
const config = readFileSync(resolve(root, 'config.js'), 'utf8');
for (const name of ['mvp.js', 'mvp.css', 'mvp-actions.css', 'config.js', 'icon.svg']) {
  if (!html.includes(`./${name}`)) throw new Error(`Asset is not relative to Pages subpath: ${name}`);
}
if (!app.includes('import { createActions } from "./mvp-actions.js"')) {
  throw new Error('013 action module is not loaded.');
}
if (!config.includes('https://hlgrxhuqflyoulwoyrrr.supabase.co') || !config.includes('sb_publishable_')) {
  throw new Error('Expected Supabase project or browser publishable key is missing.');
}
const all = files.map((name) => readFileSync(resolve(root, name), 'utf8')).join('\n');
if (/sb_secret_|service_role|postgres(?:ql)?:\/\/|SUPABASE_DB_PASSWORD/.test(all)) {
  throw new Error('Server secret detected in release.');
}
if (/\b(?:PIN|pin|token|session_token)\s*[:=]\s*['\"][^'\"]+['\"]/.test(all)) {
  throw new Error('Possible hardcoded PIN or session token detected.');
}
console.log('013 static site verified for Pages subpath.');
