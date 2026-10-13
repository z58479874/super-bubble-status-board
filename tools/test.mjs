import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {serve} from './serve.mjs';
await mkdir('artifacts',{recursive:true});
const server=await serve({mock:true});
try {
 for(const name of (process.env.SB_TEST_SUITES?.split(',') || ['acceptance-test','verify-0141-ui','verify-014-ui','verify-0133-staff-actions','verify-0134-safety-return','verify-0141-write-responses','meal-plans-test','release-smoke'])) {
  const code=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[`tests/${name}.mjs`],{stdio:'inherit',env:{...process.env,SB_TEST_BASE:`http://127.0.0.1:${server.address().port}/super-bubble-status-board/`}});
   child.on('error',reject);child.on('exit',resolve);
  });
  if(code!==0)throw Error(`${name} failed (${code})`);
 }
} finally {await new Promise(r=>server.close(r));}
