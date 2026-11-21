// V1.2 smart recommendation UI/API smoke test. Run: node tests/smart-ui.test.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function element(id){
 return {id,hidden:false,disabled:false,dataset:{},style:{},className:'',textContent:'',value:'',
 children:[],classList:{toggle(){},add(){},remove(){}},
 append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},
 after(){},before(){},remove(){},setAttribute(){},removeAttribute(){},
 addEventListener(name,fn){this['on_'+name]=fn}}
}
const elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id)};
const document={
 hidden:false,getElementById:get,createElement:element,addEventListener(){},
 querySelectorAll(selector){
  if(selector==='[data-tab]')return ['search','favorites','settings'].map(tab=>({dataset:{tab},classList:{toggle(){}}}));
  if(selector==='[data-search-mode]')return ['smart','manual'].map(searchMode=>({dataset:{searchMode},classList:{toggle(){}},setAttribute(){}}));
  return []
 }
};
const persisted=new Map([['ji-bus-v1',JSON.stringify({
 key:'TEST_ONLY_KEY',stops:{},favorites:[],routes:[],last:'',tripFavorites:[],tripMigrationV11:true
})]]);
const localStorage={getItem:key=>persisted.get(key)||null,setItem:(key,value)=>persisted.set(key,value)};
const calls=[];
const routes=[
 {nodeid:'a',nodenm:'앞 정류장',nodeord:1,updowncd:0},
 {nodeid:'b',nodenm:'다음 정류장',nodeord:2,updowncd:0},
 {nodeid:'z',nodenm:'목적지',nodeord:3,updowncd:0}
];
async function fetch(url){
 const method=url.pathname.split('/').pop(),nodeId=url.searchParams.get('nodeId');
 calls.push(method);
 let rows=[];
 if(method==='getCrdntPrxmtSttnList')rows=[
  {nodeid:'a',nodenm:'앞 정류장',gpslati:36.6401,gpslong:127.4901},
  {nodeid:'b',nodenm:'다음 정류장',gpslati:36.641,gpslong:127.491}];
 if(method==='getSttnThrghRouteList')rows=[{routeid:'R1',routeno:'717'}];
 if(method==='getRouteAcctoThrghSttnList')rows=routes;
 if(method==='getSttnAcctoArvlPrearngeInfoList')rows=[{routeid:'R1',arrtime:420}];
 return {ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:rows.length}}})}
}
const navigator={geolocation:{getCurrentPosition:success=>success({coords:{latitude:36.64,longitude:127.49}})}};
(async()=>{
 const app=new Function('document','localStorage','setInterval','fetch','navigator','prompt','alert','confirm',
 source+';return {smartToControl,otherTrip}')(
  document,localStorage,()=>1,fetch,navigator,()=>null,()=>{},()=>true
 );
 assert.equal(get('smartPanel').hidden,false);
 assert.equal(get('manualPanel').hidden,true);
 app.smartToControl.select([{id:'z',name:'목적지',lat:36.65,lon:127.5}]);
 get('smartRecommend').onclick();
 for(let i=0;i<100;i++)await Promise.resolve();
 const cards=get('smartResults').children.filter(x=>x.className==='smartCard');
 assert.equal(cards.length,2);
 assert.match(get('smartStatus').textContent,/추천 경로 2개 분석/);
 assert(calls.includes('getCrdntPrxmtSttnList'));
 assert(calls.includes('getSttnThrghRouteList'));
 assert(calls.includes('getRouteAcctoThrghSttnList'));
 assert.equal(calls.filter(x=>x==='getSttnAcctoArvlPrearngeInfoList').length,2);
 assert.equal(JSON.parse(persisted.get('ji-bus-v1')).key,'TEST_ONLY_KEY');
 document.hidden=true; // test selection without starting a live refresh
 cards[0].children.at(-1).onclick();
 assert.equal(get('manualPanel').hidden,false);
 assert.equal(get('smartPanel').hidden,true);
 assert.equal(app.otherTrip.ready,true);
 assert.equal(app.otherTrip.routes.length,1);
 assert.equal(app.otherTrip.from.id,'b');
 assert.equal(app.otherTrip.to.id,'z');
 console.log('JI BUS V1.2 smart UI smoke tests PASS (14 assertions)');
})().catch(e=>{console.error(e);process.exitCode=1});
