'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','vercel-api','api','bus.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
assert.match(source,/new Set\(\['nodeNm','nodeid','nodeId','routeId'/);
assert.match(app,/getSttnAcctoArvlPrearngeInfoList'\s*,\s*\{nodeId:/);
let requested='';
const handler=new Function('fetch','process','AbortController','setTimeout','clearTimeout',
 source.replace('export default async function handler','async function handler')+';return handler')(
 async u=>{requested=String(u);return{ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{items:{item:[]},totalCount:0}}})}},
 {env:{TAGO_API_KEY:'MOCK_ONLY'}},class{constructor(){this.signal={}}abort(){}},()=>1,()=>{}
);
function res(){
 return{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this},end(){}};
}
(async()=>{
 const a=res();
 await handler({method:'GET',query:{service:'arrival',method:'getSttnAcctoArvlPrearngeInfoList',nodeId:'CJB274000312'}},a);
 assert.equal(a.statusCode,200);
 const u=new URL(requested);
 assert.equal(u.searchParams.get('nodeId'),'CJB274000312');
 assert.equal(u.searchParams.get('serviceKey'),'MOCK_ONLY');
 const b=res();
 await handler({method:'GET',query:{service:'stop',method:'getSttnThrghRouteList',nodeid:'CJB274000312'}},b);
 assert.equal(b.statusCode,200);
 const c=res();
 await handler({method:'GET',query:{service:'arrival',method:'getSttnAcctoArvlPrearngeInfoList',unrecognized:'x'}},c);
 assert.equal(c.statusCode,400);
 console.log('TAGO arrival nodeId allowlist regression PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
