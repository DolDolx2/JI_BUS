'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const version=JSON.parse(fs.readFileSync(path.join(__dirname,'..','version.json'),'utf8'));
assert.equal(version.build,'20261123.1412');
const a=source.indexOf('function vehicleIndex('),b=source.indexOf('function etaLabel(',a);
const c=source.indexOf('function noArrivalVehicleStatus('),d=source.indexOf('function directCard(',c);
assert(a>0&&b>a&&c>0&&d>c);
const status=new Function(source.slice(a,b)+source.slice(c,d)+';return noArrivalVehicleStatus')();
const r={id:'CJB270026700',direction:'1',i:1,stops:[
 {id:'CJB270000600',order:66},
 {id:'CJB270000619',order:67},
 {id:'CJB274000290',order:78}
]};
const vehicles=[
 {nodeid:'CJB270000600',nodeord:66,vehicleno:'one'},
 {nodeid:'CJB274000290',nodeord:78,vehicleno:'two'}
];
assert.match(status(r,{v:vehicles}),/탑승 방향 차량 2대 위치 확인/);
assert.match(status(r,{v:vehicles}),/접근 후보 1대/);
assert.match(status(r,{v:[vehicles[1]]}),/현재 정류장 접근 차량 미확인/);
assert.match(status(r,{v:[{nodeid:'OTHER',nodeord:40}]}),/노선 차량 1대 위치 확인 · 탑승 방향 미확인/);
assert.match(status(r,{v:[]}),/운행 차량 위치 미확인/);
assert.match(status(r,{v:[],e:'HTTP 502'}),/차량 위치 조회 실패/);
assert.match(source,/noArrivalVehicleStatus\(r,location\)/);
assert.match(source,/if\(!v\)o\.eta\.textContent='예정시간 미제공'/);
assert.doesNotMatch(source,/현재 도착 예정 차량 없음/);
assert.match(source,/attachWalkingMapLinks\(o\.naverMapLinks,r\.stops\[r\.i\]\)/);
assert.doesNotMatch(source,/attachWalkingMapLinks\(o\.naverMapLinks,r\.stops\[r\.j\]\)/);
console.log('Build 12 arrival ETA missing versus active vehicle positions PASS');
