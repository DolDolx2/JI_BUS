// V1.4 Build 09 — verify first-pass direct recommendation compares live ETAs.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function element(tag){
 return {tag,hidden:false,disabled:false,dataset:{},style:{},className:'',textContent:'',
 value:'',children:[],classList:{toggle(){},add(){},remove(){}},
 append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this.children=nodes},
 remove(){},after(){},before(){},setAttribute(){},removeAttribute(){},
 addEventListener(event,fn){this['on_'+event]=fn},
 focus(){}}
}
const nodes=new Map();
const get=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id)};
const document={hidden:true,getElementById:get,createElement:element,addEventListener(){},
 querySelectorAll(selector){
  if(selector==='[data-tab]')return ['home','search','favorites','settings'].map(tab=>({dataset:{tab},classList:{toggle(){}}}));
  if(selector==='[data-search-mode]')return ['smart','manual'].map(searchMode=>({dataset:{searchMode},classList:{toggle(){}},setAttribute(){}}));
  return []
 }};
const config={key:'UNIT_TEST',stops:{},favorites:[],routes:[],last:'',tripFavorites:[],tripMigrationV11:true};
const localStorage={getItem:()=>JSON.stringify(config),setItem(){}};
const calls=[];
const stops=(route)=>{
 const middle=route==='R1'?['A','B','C']:route==='R2'?['A']:['B','C'];
 return ['O',...middle,'D'].map((id,i)=>({nodeid:id,nodenm:id,nodeord:i+1,updowncd:'0'}))
};
async function fetch(url){
 const method=url.searchParams.get('method'),id=url.searchParams.get('routeId');
 calls.push(method+(id?':'+id:''));
 let rows=[];
 if(method==='getSttnThrghRouteList')rows=[{routeid:'R1',routeno:'101'},{routeid:'R2',routeno:'202'},{routeid:'R3',routeno:'303'}];
 if(method==='getRouteAcctoThrghSttnList')rows=stops(id);
 if(method==='getSttnAcctoArvlPrearngeInfoList')rows=[
  {routeid:'R1',arrtime:600,updowncd:'0'},
  {routeid:'R2',arrtime:180,updowncd:'0'},
  {routeid:'R3',arrtime:900,updowncd:'0'}];
 return {ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:rows.length}}})}
}
(async()=>{
 const factory=new Function('document','localStorage','setInterval','fetch','navigator','prompt','alert','confirm',
  'URL','URLSearchParams','AbortController','setTimeout','clearTimeout',
  source+';return {setSearchMode,switchTab,fromControl,toControl,otherTrip,searchTrip}');
 const app=factory(document,localStorage,()=>1,fetch,{},()=>null,()=>{},()=>true,
  URL,URLSearchParams,AbortController,()=>1,()=>{});
 const a={id:'O',name:'출발지'},b={id:'D',name:'도착지'};
 app.fromControl.select([a]);app.toControl.select([b]);
 app.setSearchMode('manual');app.switchTab('search');
 await app.searchTrip();
 assert.equal(app.otherTrip.ready,true);
 assert.equal(app.otherTrip.routes.length,1);
 assert.equal(app.otherTrip.routes[0].id,'R2','earliest ETA must beat first route in source list');
 assert.equal(calls.filter(x=>x.startsWith('getRouteAcctoThrghSttnList')).length,3);
 assert.equal(calls.filter(x=>x==='getSttnAcctoArvlPrearngeInfoList').length,1);
 assert.match(get('otherSelection').textContent,/202번 우선 추천/);
 console.log('V1.4 Build 09 candidate ETA comparison PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
