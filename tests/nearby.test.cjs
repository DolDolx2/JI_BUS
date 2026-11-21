// JI BUS V1.1 Build 03 - nearby stops ordering and safety checks.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const begin=src.indexOf('const node='),end=src.indexOf('const name=',begin);
const first=src.indexOf('function distanceMetres'),last=src.indexOf('const nearbyButton=',first);
assert(begin>=0&&end>begin&&first>=0&&last>first);
const {distanceMetres,nearbyStops}=new Function(src.slice(begin,end)+src.slice(first,last)+';return {distanceMetres,nearbyStops}')();
const data=[
 {nodeid:'far',nodenm:'먼 정류장',nodeno:'100',gpslati:'36.65',gpslong:'127.49'},
 {nodeid:'near',nodenm:'가까운 정류장',nodeno:'101',gpslati:'36.64001',gpslong:'127.48999'},
 {nodeid:'near',nodenm:'중복 정류장',nodeno:'101',gpslati:'36.64001',gpslong:'127.48999'},
 {nodeid:'missing',nodenm:'좌표 없는 정류장'}
];
const stops=nearbyStops(data,36.64,127.49);
assert.equal(distanceMetres(36.64,127.49,36.64,127.49),0);
assert.equal(stops.length,2);
assert.equal(stops[0].id,'near');
assert.equal(stops[0].name,'가까운 정류장');
assert.equal(stops[1].id,'far');
assert.ok(stops[0].distance<stops[1].distance);
assert.equal(nearbyStops([],36.64,127.49).length,0);
console.log('JI BUS Build 03 GPS nearby tests PASS (7 assertions)');
