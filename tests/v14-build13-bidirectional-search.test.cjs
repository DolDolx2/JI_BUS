'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const stops={
 sdi4061:{nodeid:'CJB274000290',nodenm:'삼성SDI.에코앤드림',nodeno:'4061',gpslati:36.70525347,gpslong:127.40911021},
 sdi4062:{nodeid:'CJB274000291',nodenm:'에코앤드림.삼성SDI',nodeno:'4062',gpslati:36.70511222,gpslong:127.40891361},
 sky1151:{nodeid:'CJB270000619',nodenm:'코오롱하늘채아파트',nodeno:'1151',gpslati:36.67065519,gpslong:127.38187001},
 sky1894:{nodeid:'CJB270000924',nodenm:'코오롱하늘채아파트',nodeno:'1894',gpslati:36.67056335,gpslong:127.38170736},
 unrelated:{nodeid:'OTHER',nodenm:'근처 다른 정류장',nodeno:'9999',gpslati:36.70520,gpslong:127.40912}
};
function item(s){return{id:s.nodeid,name:s.nodenm,no:s.nodeno,lat:s.gpslati,lon:s.gpslong}}
function element(tag){
 return {tag,hidden:false,disabled:false,dataset:{},style:{},className:'',textContent:'',value:'',children:[],
 classList:{toggle(){},add(){},remove(){}},
 append(...xs){this.children.push(...xs)},replaceChildren(...xs){this.children=xs},
 remove(){},after(){},before(){},setAttribute(){},removeAttribute(){},addEventListener(){},focus(){}}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id)};
const document={hidden:true,getElementById:get,createElement:element,addEventListener(){},
 querySelectorAll(selector){
  if(selector==='[data-tab]')return ['home','search','favorites','settings'].map(tab=>({dataset:{tab},classList:{toggle(){}}}));
  if(selector==='[data-search-mode]')return ['smart','manual'].map(searchMode=>({dataset:{searchMode},classList:{toggle(){}},setAttribute(){}}));
  return []
 }};
const state={stops:{},favorites:[],routes:[],last:'',tripFavorites:[],tripMigrationV11:true};
const localStorage={getItem:()=>JSON.stringify(state),setItem(){}};
const calls=[];
async function fetch(url){
 const method=url.searchParams.get('method'),nodeid=url.searchParams.get('nodeid'),
  routeId=url.searchParams.get('routeId'),q=url.searchParams.get('nodeNm'),lat=url.searchParams.get('gpsLati');
 calls.push(method+(nodeid?':'+nodeid:routeId?':'+routeId:''));
 let rows=[];
 if(method==='getSttnNoList'){
  rows=q?.includes('코오롱')?[stops.sky1151,stops.sky1894]:
   q?.includes('삼성SDI')?[stops.sdi4061]:[];
 }
 if(method==='getCrdntPrxmtSttnList')rows=Number(lat)>36.69?
  [stops.sdi4061,stops.sdi4062,stops.unrelated]:[stops.sky1151,stops.sky1894];
 if(method==='getSttnThrghRouteList')rows=[{routeid:'R731',routeno:'731'}];
 if(method==='getRouteAcctoThrghSttnList'){
  rows=[
   {...stops.sdi4062,nodeord:23,updowncd:0},
   {...stops.sky1894,nodeord:36,updowncd:0},
   {...stops.sky1151,nodeord:67,updowncd:1},
   {...stops.sdi4061,nodeord:78,updowncd:1}
  ];
 }
 if(method==='getSttnAcctoArvlPrearngeInfoList')rows=[{routeid:'R731',arrtime:240,updowncd:'0'}];
 return {ok:true,json:async()=>({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:rows.length}}})}
}
(async()=>{
 const factory=new Function('document','localStorage','setInterval','fetch','navigator','prompt','alert','confirm',
  'URL','URLSearchParams','AbortController','setTimeout','clearTimeout',
  source+';return {setTrip,otherTrip,searchTrip,setSearchMode,switchTab,stopPlaceKey,samePhysicalStopPlace}');
 const app=factory(document,localStorage,()=>1,fetch,{},()=>null,()=>{},()=>true,
  URL,URLSearchParams,AbortController,()=>1,()=>{});
 assert.equal(app.stopPlaceKey(stops.sdi4061.nodenm),app.stopPlaceKey(stops.sdi4062.nodenm));
 assert.equal(app.samePhysicalStopPlace(item(stops.sdi4061),item(stops.sdi4062)),true);
 assert.equal(app.samePhysicalStopPlace(item(stops.sdi4061),item(stops.unrelated)),false);
 app.setTrip(item(stops.sdi4061),item(stops.sky1151));
 app.setSearchMode('manual');app.switchTab('search');
 await app.searchTrip();
 assert.equal(app.otherTrip.ready,true);
 assert.equal(app.otherTrip.routes.length,1,'reverse direct route must be found');
 assert.equal(app.otherTrip.routes[0].direction,'0','reverse 731 direction must be used');
 assert.equal(app.otherTrip.routes[0].id,'R731');
 assert.equal(app.otherTrip.fromCandidates.some(s=>s.id===stops.sdi4062.nodeid),true);
 assert.equal(app.otherTrip.toCandidates.some(s=>s.id===stops.sky1894.nodeid),true);
 assert.equal(app.otherTrip.fromCandidates.some(s=>s.id===stops.unrelated.nodeid),false);
 assert.match(get('otherSelection').textContent,/731번 우선 추천/);
 assert.equal(calls.includes('getSttnThrghRouteList:'+stops.sdi4062.nodeid),true);
 assert.equal(calls.includes('getSttnThrghRouteList:'+stops.sky1894.nodeid),true);
 app.setTrip(item(stops.sky1151),item(stops.sdi4061));
 await app.searchTrip();
 assert.equal(app.otherTrip.routes.length,1,'forward direct route must still be found');
 assert.equal(app.otherTrip.routes[0].direction,'1','forward 731 direction must be used');
 console.log('Build13 bidirectional 731 direct route and strict nearby platform filtering PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
