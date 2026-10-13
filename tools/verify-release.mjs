import {execFileSync,spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';
for(const name of readdirSync('site').filter(f=>f.endsWith('.js')))execFileSync(process.execPath,['--check',`site/${name}`],{stdio:'inherit'});
for(const name of ['verify-site','build','test']){
 const code=await new Promise((resolve,reject)=>{const c=spawn(process.execPath,[`tools/${name}.mjs`],{stdio:'inherit'});c.on('error',reject);c.on('exit',resolve);});
 if(code!==0)throw Error(`Release gate failed: ${name}`);
}
console.log('verify:release PASS');
