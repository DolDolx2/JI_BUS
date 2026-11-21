// JI BUS V1.1 - pure routing tests. Run: node tests/logic.test.cjs
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const section=(start,end)=>{
 const i=src.indexOf(start),j=src.indexOf(end,i);
 assert(i>=0&&j>i,'Missing source region: '+start);
 return src.slice(i,j)
};
const source=[
 section('const normStop','function localStops'),
 section('function selectedMatches','function routesFor'),
 section('function transferPaths','const arrivalsFor'),
 section('function timeLabel','function directCard'),
 section('function etaLabel','function busIcon')
].join('\n');
const {normStop,searchRank,stopPairs,transferPaths,timeLabel,operatingText,etaLabel}=
 new Function(source+';return {normStop,searchRank,stopPairs,transferPaths,timeLabel,operatingText,etaLabel}')();
const stop=(id,name,order)=>({id,name,order,lat:NaN,lon:NaN});
assert.equal(normStop('삼성 SDI · 에코앤드림'),normStop('삼성SDI에코앤드림'));
assert.equal(searchRank({name:'삼성SDI에코앤드림'},'삼성SDI에코안드림'),3);
const up=['A','B','C','D','E','F','G','H'].map((name,i)=>stop('up'+i,name,i+1));
const down=['H','G','F','E','D','C','B','A'].map((name,i)=>stop('dn'+i,name,i+1));
assert.deepEqual(stopPairs(up,stop('x','C'),stop('y','F')),[{i:2,j:5}]);
assert.deepEqual(stopPairs(down,stop('x','C'),stop('y','F')),[]);
assert.deepEqual(stopPairs(down,stop('x','F'),stop('y','C')),[{i:2,j:5}]);
const first={id:'R1',no:'1',stops:['A','B','C','X'].map((s,i)=>stop('a'+i,s,i))};
const second={id:'R2',no:'2',stops:['X','D','E'].map((s,i)=>stop(i?'b'+i:'a3',s,i))};
const paths=transferPaths([first],[second],stop('x','A'),stop('y','E'));
assert.equal(paths.length,1);
assert.equal(paths[0].stop.name,'X');
assert.equal(transferPaths([second],[first],stop('x','A'),stop('y','E')).length,0);
assert.equal(timeLabel('0535'),'05:35');
assert.equal(etaLabel(120),'2분 00초');
assert.equal(etaLabel(121),'3분 후');
assert.match(operatingText({startvehicletime:'0535',endvehicletime:'2230'}),/다음 회차 출발시간 미확인/);
console.log('JI BUS routing tests PASS (12 assertions)');
