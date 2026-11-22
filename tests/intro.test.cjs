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
assert.match(html,/id="introCountdown" aria-hidden="true">5<\/span>초 후 자동으로 이동합니다/);
assert.match(html,/V1\.4 · 청주 실시간 버스 · Build 03/);
assert.match(scripts[1],/const current='20261122\.1403'/);
assert.match(html,/<span id="introCountdown" aria-hidden="true">5<\/span>/);
assert.match(html,/#introCountdown\{/);
const init=new Function('document','window','setTimeout','clearTimeout',scripts[0]);
function fixture(){
 const button={handlers:{},addEventListener(kind,fn){this.handlers[kind]=fn}};
 const countdown={textContent:'5'};
 const splash={hidden:false,removed:false,attributes:{},
  setAttribute(key,value){this.attributes[key]=value},
  remove(){this.removed=true}};
 const timers=[],cancelled=[];
 const document={getElementById:id=>id==='introSplash'?splash:id==='introCountdown'?countdown:button};
 init(document,{},(fn,delay)=>{timers.push({fn,delay});return timers.length},id=>cancelled.push(id));
 return {button,countdown,splash,timers,cancelled}
}
const tapped=fixture();
assert.deepEqual(tapped.timers.map(x=>x.delay),[1000,2000,3000,4000,5000]);
assert.equal(tapped.countdown.textContent,'5');
tapped.timers[0].fn();
assert.equal(tapped.countdown.textContent,'4');
tapped.timers[1].fn();
assert.equal(tapped.countdown.textContent,'3');
tapped.timers[2].fn();
assert.equal(tapped.countdown.textContent,'2');
tapped.timers[3].fn();
assert.equal(tapped.countdown.textContent,'1');
tapped.button.handlers.click();
assert.equal(tapped.splash.hidden,true);
assert.equal(tapped.splash.removed,true);
assert.equal(tapped.cancelled.length,5);
tapped.timers[4].fn();
assert.equal(tapped.cancelled.length,5,'double enter must do nothing');
const automatic=fixture();
automatic.timers[4].fn();
assert.equal(automatic.splash.removed,true);
assert.equal(automatic.countdown.textContent,'5');
automatic.timers[0].fn();
assert.equal(automatic.countdown.textContent,'5','closed intro must not update countdown');
const immediate=fixture();
immediate.button.handlers.click();
assert.equal(immediate.splash.removed,true);
assert.equal(immediate.cancelled.length,5);
console.log('JI BUS V1.4 Build 03 5-to-1 countdown and splash smoke tests PASS');
