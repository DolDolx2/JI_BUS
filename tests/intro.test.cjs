// JI BUS V1.2 Build 02 — splash entry and animation smoke test.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,2);
assert.match(html,/id="introSplash"/);
assert.match(html,/id="introEnter"/);
assert.match(html,/청주시 시내버스 정보 전용/);
assert.match(html,/<text[^>]+>청주시<\/text>/);
assert.match(html,/repeatCount="indefinite"/);
assert.match(html,/keyPoints="0;1;0"/);
assert.match(html,/keyTimes="0;0\.5;1"/);
assert.match(html,/V1\.3 · 청주 실시간 버스 · Build 02/);
assert.match(scripts[1],/const current='20261121\.1202'/);
const init=new Function('document','window','setTimeout','clearTimeout',scripts[0]);
function fixture(reduced=false){
 const button={handlers:{},addEventListener(kind,fn){this.handlers[kind]=fn}};
 const bus={setAttribute(name,value){this[name]=value}};
 const motion={removed:false,remove(){this.removed=true}};
 const splash={hidden:false,removed:false,attributes:{},
  setAttribute(key,value){this.attributes[key]=value},
  remove(){this.removed=true},
  querySelector(query){return query==='animateMotion'?motion:query==='.introAnimatedBus'?bus:null}};
 const timers=[],cancelled=[];
 const document={getElementById:id=>id==='introSplash'?splash:button};
 init(document,{matchMedia:()=>({matches:reduced})},
  (fn,delay)=>{timers.push({fn,delay});return timers.length},
  id=>cancelled.push(id));
 return {button,splash,timers,cancelled,motion,bus}
}
const tapped=fixture();
assert.equal(tapped.timers[0].delay,3000);
tapped.button.handlers.click();
assert.equal(tapped.splash.hidden,true);
assert.equal(tapped.splash.removed,true);
assert.equal(tapped.cancelled[0],1);
tapped.timers[0].fn();
assert.equal(tapped.cancelled.length,1);
const automatic=fixture();
automatic.timers[0].fn();
assert.equal(automatic.splash.removed,true);
const accessible=fixture(true);
assert.equal(accessible.motion.removed,true);
assert.equal(accessible.bus.transform,'translate(176 73)');
console.log('JI BUS V1.2 Build 02 splash smoke tests PASS (18 assertions)');
