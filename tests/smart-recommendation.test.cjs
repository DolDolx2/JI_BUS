// V1.2: smart-route matching and ranking; run: node tests/smart-recommendation.test.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const part=(a,b)=>{
 const i=src.indexOf(a),j=src.indexOf(b,i);
 assert(i>=0&&j>i,'Missing source region '+a);
 return src.slice(i,j);
};
const code=[
 part('const normStop=','function localStops'),
 part('function selectedMatches','function routesFor'),
 part('const arrivalsFor=','function etaText'),
 part('function smartScore','function smartStatus')
].join('\n');
const {smartScore,smartCandidates,rankSmartCandidates}=
 new Function(code+';return {smartScore,smartCandidates,rankSmartCandidates}')();
const stop=(id,name)=>({id,name,lat:NaN,lon:NaN});
const r1={id:'R1',no:'717',segment:'0',stops:[
 stop('a','출발 A'),stop('b','중간 B'),stop('z','목적지')]};
const r2={id:'R2',no:'731',segment:'0',stops:[
 stop('c','출발 C'),stop('d','중간 D'),stop('e','중간 E'),stop('z','목적지')]};
const near=[
 {...stop('a','출발 A'),distance:260},
 {...stop('c','출발 C'),distance:70}
];
const found=smartCandidates([r1,r2],near,[stop('z','목적지')]);
assert.equal(found.length,2);
assert.equal(found[0].route.id,'R2');
assert.equal(found[0].walkMinutes,2);
assert.equal(found[1].walkMinutes,4);
assert.equal(smartCandidates([r1],near,[stop('wrong','다른 목적지')]).length,0);
assert.equal(smartCandidates([{...r1,stops:[stop('z','목적지'),stop('a','출발 A')]}],near,[stop('z','목적지')]).length,0);
assert.equal(smartScore(5,120,3),null); // cannot walk 5m to catch bus in 2m
assert.equal(smartScore(5,360,3),12);
assert.equal(smartScore(5,-1,3),null);
assert.equal(smartScore(5,NaN,3),null);
const arrivals=new Map([
 ['a',[{routeid:'R1',arrtime:180},{routeid:'R1',arrtime:780}]],
 ['c',[{routeid:'R2',arrtime:480}]]
]);
const ranked=rankSmartCandidates(found,arrivals);
assert.equal(ranked[0].route.id,'R2');
assert.equal(ranked[0].estimate,14);
assert.equal(ranked[1].arrivalSeconds,780); // earliest catchable, not the missed 180s bus
assert.equal(ranked[1].estimate,17);
const noLive=rankSmartCandidates(found,new Map());
assert.equal(noLive[0].estimate,null);
assert.equal(noLive[0].route.id,'R2'); // nearest stop first if no live data
console.log('JI BUS V1.2 smart recommendation tests PASS (16 assertions)');
