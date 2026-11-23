// JI BUS V1.4 Build 07 — stabilization, modular CSS and PIN-gated diagnostics.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const html=load('index.html'),app=load('app.js'),diag=load('diagnostics.js');
const css=load('styles.css'),ui=load('ui-stabilization.css'),v=JSON.parse(load('version.json'));
assert.equal(v.build,'20261123.1407');
assert.equal(v.label,'Build 07');
assert.match(html,/href="styles\.css\?v=20261123\.1407"/);
assert.match(html,/href="ui-stabilization\.css\?v=20261123\.1407"/);
assert.match(html,/src="diagnostics\.js\?v=20261123\.1407"/);
assert.doesNotMatch(html,/<style>/);
assert.match(css,/:root\{color-scheme:light/);
assert.match(ui,/.smartCompactHead/);
assert.match(html,/id="weatherRegion"/);
assert.match(html,/bigdatacloud\.com/);
assert.match(html,/id="developerOpen"/);
assert.match(html,/id="developerPin" type="password"/);
assert.match(html,/id="developerHistory"/);
assert.doesNotMatch(html,/버스 이용 안내/);
assert.doesNotMatch(html,/목적지를 선택하고 현재 위치를 기준으로 이용할 버스를 추천받습니다/);
assert.doesNotMatch(html,/<h2>버스 검색<\/h2>/);
assert.match(app,/function switchTab\(next\)\{\s*if\(activeSearchProgress\)cancelSearchProgress\(\)/);
assert.match(app,/if\(activeSearchProgress&&previous!==mode\)cancelSearchProgress\(\)/);
assert.doesNotMatch(app,/if\(validStop\(cfg\.lastTrip\?\.from\)&&validStop\(cfg\.lastTrip\?\.to\)\)/);
assert.match(app,/const candidates=\[\];let chosen=null,attempted=0/);
assert.match(app,/shortlist\.sort\(\(a,b\)=>\{/);
assert.match(app,/chosen=shortlist\[0\]\.route/);
assert.match(app,/compactSmartCard/);
assert.match(app,/smartDetails/);
assert.match(app,/markFirstResult\(\)/);
assert.match(diag,/input\.value==='6554'/);
assert.doesNotMatch(diag,/localStorage|sessionStorage|fetch\(/);
new Function(app);new Function(diag);
const elements=new Map();
function node(id){
 if(!elements.has(id)){
  elements.set(id,{id,hidden:true,value:'',textContent:'',handlers:{},children:[],
   addEventListener(event,cb){this.handlers[event]=cb},focus(){this.focused=true},
   replaceChildren(...children){this.children=children},append(child){this.children.push(child)}});
 }
 return elements.get(id)
}
const document={getElementById:node,createElement:()=>({
 textContent:'',append(){},replaceChildren(){}
})};
const window={};
new Function('document','window',diag)(document,window);
assert.equal(typeof window.JIBusDiagnostics.start,'function');
node('developerOpen').handlers.click();
assert.equal(node('developerGate').hidden,false);
assert.equal(node('developerPanel').hidden,true);
node('developerPin').value='1111';
node('developerUnlock').handlers.click();
assert.equal(node('developerGate').hidden,false);
assert.equal(node('developerPanel').hidden,true);
assert.match(node('developerGateStatus').textContent,/올바르지/);
node('developerPin').value='6554';
node('developerUnlock').handlers.click();
assert.equal(node('developerGate').hidden,true);
assert.equal(node('developerPanel').hidden,false);
assert.equal(node('developerPin').value,'');
const d=window.JIBusDiagnostics;
d.start('직행 검색');d.recordApi('route','test');d.recordApi('arrival','test');
d.setCandidates(6,3);d.markFirstResult();d.finish();
assert.equal(node('developerApiTotal').textContent,'2');
assert.equal(node('developerApiCount').textContent,'2회');
assert.equal(node('developerCandidateCount').textContent,'6개 중 3개');
assert.equal(node('developerHistory').children.length,1);
node('developerClose').handlers.click();
assert.equal(node('developerPanel').hidden,true);
console.log('JI BUS V1.4 Build 07 stabilization and developer diagnostics PASS');
