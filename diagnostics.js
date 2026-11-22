/* JI BUS — local-only developer search diagnostics.
   PIN 6554 is a convenience gate, not an authentication/security boundary.
   Never log the API key, device coordinates, stop names or request URLs. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const metrics={apiTotal:0,errors:0,history:[],active:null};
 let unlocked=false;
 const clock=()=>Date.now();
 const text=(id,value)=>{const node=$(id);if(node)node.textContent=String(value)};
 const render=()=>{
  if(!unlocked)return;
  const active=metrics.active;
  const latest=metrics.history[0]||null;
  const selected=active||latest;
  text('developerApiTotal',metrics.apiTotal);
  text('developerSearchDuration',selected?
   (selected.firstResultMs!=null?(selected.firstResultMs/1000).toFixed(1):
   ((selected.finishedAt||clock())-selected.startedAt)/1000).toFixed(1)+'초':'—');
  text('developerApiCount',selected?selected.apiCalls+'회':'—');
  text('developerCandidateCount',selected?
   selected.checked+'개 중 '+selected.candidates+'개':'—');
  text('developerErrorCount',metrics.errors+'건');
  text('developerCurrentStatus',active?'검색 진행 중 · '+active.step:latest?
   (latest.cancelled?'마지막 검색 취소됨':'마지막 검색 완료'):'검색 내역 없음');
  const list=$('developerHistory');
  if(!list)return;
  list.replaceChildren();
  for(const event of metrics.history.slice(0,8)){
   const row=document.createElement('li');
   row.textContent=new Date(event.startedAt).toLocaleTimeString('ko-KR')+
    ' · '+event.label+' · '+((event.finishedAt-event.startedAt)/1000).toFixed(1)+
    '초 · API '+event.apiCalls+'회'+(event.cancelled?' · 취소':'');
   list.append(row)
  }
 };
 const api={
  start(label){
   if(metrics.active)this.finish(true);
   metrics.active={label:String(label||'검색'),startedAt:clock(),apiCalls:0,
    firstResultMs:null,checked:0,candidates:0,step:'준비',cancelled:false};
   render()
  },
  step(message){if(metrics.active){metrics.active.step=String(message||'');render()}},
  recordApi(){metrics.apiTotal++;if(metrics.active)metrics.active.apiCalls++;render()},
  recordError(){metrics.errors++;render()},
  setCandidates(checked,candidates){
   if(metrics.active){metrics.active.checked=Number(checked)||0;metrics.active.candidates=Number(candidates)||0;render()}
  },
  markFirstResult(){
   if(metrics.active&&metrics.active.firstResultMs==null)
    metrics.active.firstResultMs=clock()-metrics.active.startedAt;
   render()
  },
  finish(cancelled=false){
   if(!metrics.active)return;
   const last=metrics.active;last.finishedAt=clock();last.cancelled=!!cancelled;
   metrics.history.unshift(last);metrics.history.length=Math.min(10,metrics.history.length);
   metrics.active=null;render()
  },
  lock(){unlocked=false;if($('developerGate'))$('developerGate').hidden=true;
   if($('developerPanel'))$('developerPanel').hidden=true;
   if($('developerPin'))$('developerPin').value='';
   text('developerGateStatus','')},
  clear(){metrics.history=[];metrics.apiTotal=0;metrics.errors=0;render()}
 };
 window.JIBusDiagnostics=api;
 const open=$('developerOpen'),gate=$('developerGate'),panel=$('developerPanel'),
  input=$('developerPin'),unlock=$('developerUnlock'),close=$('developerClose'),
  clear=$('developerClear');
 if(!open||!gate||!panel||!input||!unlock)return;
 open.addEventListener('click',()=>{
  if(unlocked){panel.hidden=false;gate.hidden=true;render();return}
  gate.hidden=false;panel.hidden=true;input.value='';text('developerGateStatus','');
  input.focus()
 });
 const attempt=()=>{
  if(input.value==='6554'){
   unlocked=true;input.value='';gate.hidden=true;panel.hidden=false;
   text('developerGateStatus','');render()
  }else{
   input.value='';text('developerGateStatus','비밀번호가 올바르지 않습니다.');
   input.focus()
  }
 };
 unlock.addEventListener('click',attempt);
 input.addEventListener('keydown',e=>{if(e.key==='Enter')attempt()});
 if(close)close.addEventListener('click',()=>api.lock());
 if(clear)clear.addEventListener('click',()=>api.clear());
})();
