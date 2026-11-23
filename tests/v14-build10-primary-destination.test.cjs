// V1.4 Build 10 — verify saved alternate destination cannot displace a real direct bus.
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
const stops=route=>(route==='R731'?['O','X','D']:['O','A']).map((id,i)=>({nodeid:id,nodenm:id,nodeord:i+1,updowncd:'1'}));
async function fetch(url){
 const method=url.searchParams.get('method'),id=url.searchParams.get('routeId'),nodeId=url.searchParams.get('nodeid');
 calls.push(method+(id?':'+id:nodeId?':'+nodeId:''));
 let rows=[];
 if(method==='getSttnThrghRouteList'){
  const many=Array.from({length:12},(_,i)=>({routeid:'R'+i,routeno:String(100+i)}));
  rows=nodeId==='D'?[...many,{routeid:'R731',routeno:'731'}]:
   nodeId==='O'?[{routeid:'R53',routeno:'53'},{routeid:'R731',routeno:'731'}]:
   nodeId==='A'?[{routeid:'R53',routeno:'53'}]:[];
 }
 if(method==='getRouteAcctoThrghSttnList')rows=stops(id);
 if(method==='getSttnAcctoArvlPrearngeInfoList')rows=[{routeid:'R731',arrtime:240,updowncd:'1'}];
 return {ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:rows.length}}})}
}
(async()=>{
 const factory=new Function('document','localStorage','setInterval','fetch','navigator','prompt','alert','confirm',
  'URL','URLSearchParams','AbortController','setTimeout','clearTimeout',
  source+';return {setSearchMode,switchTab,fromControl,toControl,otherTrip,searchTrip,setTrip}');
 const app=factory(document,localStorage,()=>1,fetch,{},()=>null,()=>{},()=>true,
  URL,URLSearchParams,AbortController,()=>1,()=>{});
 const a={id:'O',name:'코오롱하늘채'},b={id:'D',name:'삼성SDI'},alt={id:'A',name:'까치말'};
 app.setTrip(a,b,alt);
 assert.deepEqual(app.otherTrip.toCandidates.map(x=>x.id),['D'],'legacy alt must not enter destination candidates');
 app.setSearchMode('manual');app.switchTab('search');
 await app.searchTrip();
 assert.equal(app.otherTrip.ready,true);
 assert.equal(app.otherTrip.routes.length,1);
 assert.equal(app.otherTrip.routes[0].id,'R731','731 should be recommended even after 12 irrelevant destination routes');
 assert.equal(calls.some(x=>x==='getSttnThrghRouteList:A'),false,'no stale alt destination lookup');
 const stopQueries=calls.filter(x=>x.startsWith('getSttnThrghRouteList:'));
 assert.deepEqual(stopQueries.slice(0,2),['getSttnThrghRouteList:D','getSttnThrghRouteList:O']);
 assert.equal(calls.includes('getRouteAcctoThrghSttnList:R731'),true);
 assert.match(get('otherSelection').textContent,/731번 우선 추천/);
 console.log('V1.4 Build 10 saved alternate destination does not defeat 731 direct route PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
