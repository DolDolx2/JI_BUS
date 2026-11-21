// JI BUS V1.1 Build 04 - next stop/terminal must belong to the same route.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const take=(a,b)=>{
 const start=src.indexOf(a),end=src.indexOf(b,start);
 assert(start>=0&&end>start,'Missing segment '+a);
 return src.slice(start,end)
};
const source=[
 take('const normStop=','function localStops'),
 take('function nextAndTerminal','async function fetchStopDirections')
].join('\n');
const {nextAndTerminal,directionSummaries}=
 new Function(source+';return {nextAndTerminal,directionSummaries}')();
const stop=(id,name)=>({id,name});
const a=stop('a','출발'),b=stop('b','오창중'),c=stop('c','오창종점');
const x=stop('x','시청'),y=stop('y','청주터미널');
const outbound={direction:'0',segment:'0',stops:[a,b,c]};
const inbound={direction:'1',segment:'1',stops:[a,x,y]};
const one=nextAndTerminal(outbound,0,null);
assert.equal(one.next,'오창중');
assert.equal(one.terminal,'오창종점');
const other=nextAndTerminal(inbound,0,null);
assert.equal(other.next,'시청');
assert.equal(other.terminal,'청주터미널');
const summaries=directionSummaries(a,[
 {id:'route1',no:'717',variants:[outbound],info:null},
 {id:'route2',no:'731',variants:[inbound],info:null}
]);
assert.equal(summaries.length,2);
assert.equal(summaries[0].routes[0],'717');
assert.equal(summaries[1].routes[0],'731');
assert.equal(summaries[0].terminal,'오창종점');
assert.equal(summaries[1].terminal,'청주터미널');
const shared=directionSummaries(a,[
 {id:'route1',no:'717',variants:[outbound],info:null},
 {id:'route3',no:'718',variants:[outbound],info:null}
]);
assert.equal(shared.length,1);
assert.deepEqual(shared[0].routes,['717','718']);
const ambiguous={direction:'',segment:'',stops:[a,b,c,x,y]};
assert.equal(nextAndTerminal(ambiguous,0,null).terminal,null);
assert.equal(nextAndTerminal(ambiguous,0,{endnodenm:'오창종점',startnodenm:'청주터미널'}).terminal,'오창종점');
assert.equal(nextAndTerminal(ambiguous,2,{endnodenm:'오창종점',startnodenm:'청주터미널'}).terminal,'청주터미널');
assert.equal(directionSummaries({id:'unknown'},[{id:'route1',no:'717',variants:[outbound],info:null}]).length,0);
assert.equal(nextAndTerminal(outbound,2,null),null);
console.log('JI BUS Build 04 direction pairing tests PASS (17 assertions)');
