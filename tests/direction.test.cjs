// Build 11: travel-direction separation and marker safety.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function section(start,end){
 const i=src.indexOf(start),j=src.indexOf(end,i);
 assert(i>=0&&j>i,'Missing source section: '+start);
 return src.slice(i,j);
}
const logic=[
 section('const node=','const name='),
 section('function routeVariants','function selectedMatches'),
 section('function vehicleIndex','function etaLabel')
].join('\n');
const {routeVariants,vehicleIndex,directionLabel}=new Function(logic+';return {routeVariants,vehicleIndex,directionLabel}')();
const stop=(name,order,direction,id=name)=>({nodeid:id,nodenm:name,nodeord:order,updowncd:direction});
const raw=[
 stop('A',1,0),stop('B',2,0),stop('C',3,0),
 stop('C',1,1),stop('B',2,1),stop('A',3,1)
];
const routes=routeVariants('R717','717',raw);
assert.equal(routes.length,2);
assert.deepEqual(routes.map(r=>r.stops.map(s=>s.name)),[['A','B','C'],['C','B','A']]);
assert.equal(directionLabel(routes[0]),'상행');
assert.equal(directionLabel(routes[1]),'하행');
assert.equal(vehicleIndex(routes[0],{nodeid:'B',nodeord:2,updowncd:0}),1);
assert.equal(vehicleIndex(routes[1],{nodeid:'B',nodeord:2,updowncd:1}),1);
assert.equal(vehicleIndex(routes[0],{nodeid:'B',nodeord:2,updowncd:1}),-1);
assert.equal(vehicleIndex(routes[1],{nodeid:'B',nodeord:2,updowncd:0}),-1);
assert.equal(vehicleIndex(routes[0],{nodeid:'B',nodeord:2}),-1);
assert.equal(vehicleIndex(routes[0],{nodeid:'X',nodeord:2,updowncd:0}),-1);
assert.equal(vehicleIndex(routes[0],{nodeid:'B',nodeord:99,updowncd:0}),-1);
assert.equal(routeVariants('R','7',[stop('A',1,null),stop('B',2,null)])[0].stops.length,2);
assert.deepEqual(routeVariants('R','7',[stop('A',1,null),stop('B',2,null),stop('C',1,null),stop('D',2,null)]).map(r=>r.stops.length),[2,2]);
console.log('JI BUS Build 11 direction tests PASS (13 assertions)');
