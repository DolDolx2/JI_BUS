// JI BUS V1.2 Build 07 — splash entry and animation smoke test.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,2);
assert.match(html,/id="introSplash"/);
assert.match(html,/id="introEnter"/);
assert.match(html,/청주시 시내버스 실시간 안내/);
assert.match(html,/src="assets\/cheongju-splash-city\.webp"/);
assert.match(html,/alt="청주시 시내버스와 도시 풍경"/);
assert.doesNotMatch(html,/<animateMotion\b/);
assert.match(html,/5초 후 자동으로 이동합니다/);
assert.match(html,/V1\.4 · 청주 실시간 버스 · Build 01/);
assert.match(scripts[1],/const current='20261122\.1401'/);
const init=new Function('document','window','setTimeout','clearTimeout',scripts[0]);
function fixture(reduced=false){
 const button={handlers:{},addEventListener(kind,fn){this.handlers[kind]=fn}};
 const splash={hidden:false,removed:false,attributes:{},
  setAttribute(key,value){this.attributes[key]=value},
  remove(){this.removed=true},
  querySelector(){return null}};
 const timers=[],cancelled=[];
 const document={getElementById:id=>id==='introSplash'?splash:button};
 init(document,{matchMedia:()=>({matches:reduced})},
  (fn,delay)=>{timers.push({fn,delay});return timers.length},
  id=>cancelled.push(id));
 return {button,splash,timers,cancelled}
}
const tapped=fixture();
assert.equal(tapped.timers[0].delay,5000);
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
assert.equal(accessible.timers[0].delay,5000);
assert.equal(accessible.splash.removed,false);
console.log('JI BUS V1.2 Build 07 approved artwork splash smoke tests PASS');
