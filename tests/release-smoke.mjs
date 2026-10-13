import assert from 'node:assert/strict';
import {chromium,launchOptions} from './browser.mjs';
import {serve} from '../tools/serve.mjs';
const server=await serve({mock:false});
const browser=await chromium.launch({headless:true,...launchOptions});
try {
 const p=await browser.newPage({viewport:{width:390,height:844}}),errors=[],failures=[],external=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 p.on('response',r=>{if(r.status()>=400)failures.push(r.url());});
 p.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))external.push(r.url());});
 const base=`http://127.0.0.1:${server.address().port}/super-bubble-status-board/`;
 await p.goto(base,{waitUntil:'networkidle'});await p.locator('#loginSubmit').waitFor();
 await p.reload({waitUntil:'networkidle'});await p.locator('#loginSubmit').waitFor();
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.deepEqual(external,[]);
 await p.screenshot({path:'artifacts/0142-release-login-390.png'});
 console.log('Release smoke PASS: production config, Pages subpath, refresh, 390px, zero console/page/asset errors, no external requests or PIN usage.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
