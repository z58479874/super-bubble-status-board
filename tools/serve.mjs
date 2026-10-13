import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {WorkflowMock} from '../tests/workflow-mock.mjs';
export async function serve({port=0,mock=false,root='dist'}={}) {
 let workflow=new WorkflowMock();
 const dir=resolve(root),prefix='/super-bubble-status-board';
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');let path=url.pathname;
  if(path.startsWith(prefix+'/'))path=path.slice(prefix.length);
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(mock&&path==='/__scenario'){workflow=new WorkflowMock();return json({scenario:'workflow'});}
  if(mock&&path.startsWith('/rest/v1/rpc/')){
   try {let body='';for await(const part of req)body+=part;return json(workflow.rpc(path.split('/').pop(),JSON.parse(body||'{}')));}
   catch(e){return json({code:e.code||'P0001',message:e.message},e.code==='42501'?403:400);}
  }
  if(mock&&path==='/config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(`window.__SB_CONFIG__=${JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,publishableKey:'sb_publishable_mock'})};`);}
  const target=resolve(dir,'.'+(path==='/'?'/index.html':path));
  if(!target.startsWith(dir+sep)){res.writeHead(403);return res.end();}
  try{const data=await readFile(target);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(target)]||'application/octet-stream'),'Cache-Control':'no-store'});res.end(data);}
  catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));return server;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const s=await serve({port:Number(process.env.PORT||8782),mock:process.argv.includes('--mock'),root:'site'});
 console.log(`Local preview http://127.0.0.1:${s.address().port}/super-bubble-status-board/`);
}
