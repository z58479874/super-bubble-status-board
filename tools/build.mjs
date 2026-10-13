import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('site','dist',{recursive:true});
console.log('Production build: dist (relative assets, /super-bubble-status-board/ compatible)');
