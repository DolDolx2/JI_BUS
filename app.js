'use strict';
const $=id=>document.getElementById(id);
const store='ji-bus-v1';
let cfg={stops:{},favorites:[],routes:[],last:'',tripFavorites:[],lastTrip:null};
try{cfg={...cfg,...JSON.parse(localStorage.getItem(store)||'{}')}}catch{}
if(!cfg.stops||typeof cfg.stops!=='object')cfg.stops={};
if(!Array.isArray(cfg.routes))cfg.routes=[];
if(!Array.isArray(cfg.favorites))cfg.favorites=[];
if(!Array.isArray(cfg.tripFavorites))cfg.tripFavorites=[];
let tab='search',busy=false,revision=0;
if(!Array.isArray(cfg.recentTrips))cfg.recentTrips=[];
let retryCount=0,retryTimer=null,authBlocked=false;
const logErrors=[];
const save=()=>localStorage.setItem(store,JSON.stringify(cfg));
// Remove the superseded browser-stored TAGO key while preserving all trips and favorites.
if(Object.prototype.hasOwnProperty.call(cfg,'key')){delete cfg.key;save()}
const arr=v=>Array.isArray(v)?v:v&&typeof v==='object'?[v]:[];
const el=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e};
const status=(s,err=false)=>{const e=$(tab==='settings'?'settingsStatus':'status')||$('status');e.textContent=s;e.className=err?'error':'muted'};
const recordError=(e,context)=>{logErrors.push({at:Date.now(),context,reason:String(e.message||e).slice(0,160)});if(logErrors.length>20)logErrors.shift();globalThis.JIBusDiagnostics?.recordError(context)};
const clearRetry=()=>{if(retryTimer!==null)clearTimeout(retryTimer);retryTimer=null};
function failureClass(e){const code=Number(e?.status);if([401,403].includes(code)||String(e?.message).includes('인증키')||String(e?.message).includes('SERVICE_KEY'))return 'auth';if(code===429)return 'limit';return 'transient'}
function planRetry(e){recordError(e,'실시간 조회');const type=failureClass(e);if(type==='auth'){authBlocked=true;clearRetry();return '버스정보 서비스 인증 오류 · 잠시 후 다시 시도하세요'}
 retryCount++;const delay=type==='limit'?Math.max(60000,Number(e.retryAfterMs)||0):retryCount===1?5000:retryCount===2?15000:Math.min(60000,30000*Math.pow(2,Math.max(0,retryCount-3)));clearRetry();
 retryTimer=setTimeout(()=>{retryTimer=null;if(!document.hidden&&tab!=='settings')refresh()},delay);return '자동 재시도 '+Math.round(delay/1000)+'초 후';
}
function resetFailures(){retryCount=0;authBlocked=false;clearRetry()}

/* Build 07: only user-initiated route discovery uses a modal.
   Live 15-second refresh and fuzzy typing NEVER show a modal. */
let activeSearchProgress=null;
let searchProgressSequence=0;
function beginSearchProgress(title,onCancel){
 if(activeSearchProgress)cancelSearchProgress();
 const work={id:++searchProgressSequence,controllers:new Set(),onCancel,timer:null,visible:false};
 activeSearchProgress=work;
 globalThis.JIBusDiagnostics?.start(title);
 const overlay=$('searchProgressOverlay');
 $('searchProgressTitle').textContent=title;
 $('searchProgressMessage').textContent='검색을 준비하고 있습니다…';
 overlay.hidden=true;
 work.timer=setTimeout(()=>{
  if(activeSearchProgress===work){
   overlay.hidden=false;work.visible=true;$('searchProgressCancel').focus()
  }
 },300);
 return work
}
function searchProgressStep(work,message){
 if(activeSearchProgress===work){$('searchProgressMessage').textContent=message;globalThis.JIBusDiagnostics?.step(message)}
}
function endSearchProgress(work,cancelled=false){
 if(activeSearchProgress!==work)return;
 clearTimeout(work.timer);
 $('searchProgressOverlay').hidden=true;
 activeSearchProgress=null;
 globalThis.JIBusDiagnostics?.finish(cancelled)
}
function cancelSearchProgress(){
 const work=activeSearchProgress;
 if(!work)return;
 endSearchProgress(work,true);
 for(const controller of work.controllers)controller.abort();
 work.controllers.clear();
 if(typeof work.onCancel==='function')work.onCancel();
}
$('searchProgressCancel').onclick=cancelSearchProgress;

const BUS_API_BASE='https://ji-bus-api-siga0411-6093.vercel.app';
async function api(service,method,params={}){
 const u=new URL(BUS_API_BASE+'/api/bus');
 u.search=new URLSearchParams({service,method,...params});
 globalThis.JIBusDiagnostics?.recordApi(service,method);
 const controller=new AbortController(),progress=activeSearchProgress;
 if(progress)progress.controllers.add(controller);
 const timer=setTimeout(()=>controller.abort(),15000);
 let res;try{res=await fetch(u,{signal:controller.signal,cache:'no-store'})}
 finally{clearTimeout(timer);if(progress)progress.controllers.delete(controller)}
 if(progress&&activeSearchProgress!==progress)throw new DOMException('검색이 취소되었습니다.','AbortError');if(!res.ok){const e=Error('버스정보 서비스 응답 오류 (HTTP '+res.status+')');e.status=res.status;
 if(res.status===429){const retry=res.headers.get('Retry-After');if(retry){const n=Number(retry);e.retryAfterMs=Number.isFinite(n)?Math.max(0,n*1000):Math.max(0,Date.parse(retry)-Date.now())}}
 throw e}
 let json=await res.json(),h=json.response?.header,body=json.response?.body;
 if(!h||!['00','0','0000'].includes(String(h.resultCode))){const e=Error('API 응답 오류: '+(h?.resultMsg||json.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg||'응답 형식 확인 필요'));if(/SERVICE_KEY|인증|권한|승인|AUTH/i.test(e.message))e.status=403;throw e}
 let items=arr(body?.items?.item);if(Number(body?.totalCount)>items.length)throw Error('조회 결과가 페이지 한도를 초과했습니다.');
 return items;
}
const node=x=>({id:String(x.nodeid??''),name:String(x.nodenm??''),no:String(x.nodeno??''),lat:Number(x.gpslati??NaN),lon:Number(x.gpslong??NaN)});
const name=x=>x.name+(x.no?' ('+x.no+')':'');

/* P6: unified stop lookup. Existing route stops are used as local fuzzy index. */
const normStop=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('ko').replace(/[\s·.,()\-_/]/g,'');
function editDistance(a,b,limit=2){if(Math.abs(a.length-b.length)>limit)return limit+1;let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(prev[j]+1,next[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;if(Math.min(...prev)>limit)return limit+1}return prev[b.length]}
function searchRank(s,q){
 const n=normStop(s.name),x=normStop(q);if(!x)return 999;
 if(n===x)return 0;if(n.startsWith(x))return 1;if(n.includes(x))return 2;
 if(x.length>=3&&editDistance(n,x,2)<=2)return 3;
 return 999;
}
function localStops(){let m=new Map();for(const r of cfg.routes)for(const s of r.stops)m.set(s.id,s);for(const s of Object.values(cfg.stops))if(s?.id)m.set(s.id,s);for(const s of cfg.favorites)if(s?.id)m.set(s.id,s);return [...m.values()]}
async function findStops(query){
 const q=query.trim();if(!q)return [];
 const m=new Map();for(const s of localStops())if(searchRank(s,q)<999)m.set(s.id,s);
 try{for(const x of await api('stop','getSttnNoList',{nodeNm:q})){let s=node(x);if(s.id)m.set(s.id,s)}}catch(e){if(!m.size)throw e;recordError(e,'정류장 검색')}
 return [...m.values()].filter(s=>searchRank(s,q)<999).sort((a,b)=>searchRank(a,q)-searchRank(b,q)||a.name.localeCompare(b.name,'ko')||a.no.localeCompare(b.no)).slice(0,50)
}
async function expandDirectionalStops(s){
 const map=new Map([[s.id,s]]);
 try{for(const x of await findStops(s.name))if(selectedMatches(x,s))map.set(x.id,x)}catch(e){recordError(e,'방향 후보')}
 if(Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&s.lat!==0&&s.lon!==0){
 try{const nearby=await api('stop','getCrdntPrxmtSttnList',{gpsLati:String(s.lat),gpsLong:String(s.lon)});
 for(const x of nearby){const stop=node(x);if(stop.id&&selectedMatches(stop,s))map.set(stop.id,stop)}
 }catch(e){recordError(e,'주변 정류소 후보')}
 }
 return [...map.values()]
}
function groupStops(items){
 const groups=new Map();for(const s of items){const k=normStop(s.name);if(!groups.has(k))groups.set(k,{name:s.name,stops:[]});groups.get(k).stops.push(s)}
 return [...groups.values()]
}
function showStopSearchState(host,message,failed=false){
 host.replaceChildren();
 const line=el('p',message,failed?'error':'muted');
 line.setAttribute('role','status');
 line.setAttribute('aria-live','polite');
 host.append(line);
}
function stopSearchControl(container,onChoose){
 const input=el('input'),results=el('div',undefined,'results');
 input.id=container.id==='otherFromResults'?'otherFromInput':container.id==='smartToResults'?'smartToInput':'otherToInput';
 input.placeholder='정류장 이름 또는 일부 입력';
 input.setAttribute('aria-label','정류장 이름 검색');
 container.append(input,results);
 let timer=0,serial=0;
 input.addEventListener('input',()=>{
  clearTimeout(timer);
  const token=++serial,q=input.value.trim();
  results.replaceChildren();
  if(!q)return;
  showStopSearchState(results,'정류장 검색 중… 잠시만 기다려 주세요.');
  timer=setTimeout(async()=>{
   try{
    const groups=groupStops(await findStops(q));
    if(token!==serial)return;
    results.replaceChildren();
    for(const g of groups){
     const b=el('button',g.name+(g.stops.length>1?' · '+g.stops.length+'개 위치':''));
     b.type='button';
     b.onclick=()=>{
      ++serial;
      clearTimeout(timer);
      onChoose(g.stops);
      input.value=g.name;
      results.replaceChildren()
     };
     results.append(b)
    }
    if(!groups.length)showStopSearchState(results,'검색 결과가 없습니다. 다른 정류장 이름으로 검색해 주세요.');
   }catch(e){
    if(token===serial)showStopSearchState(results,'정류장 검색 실패 · '+e.message,true)
   }
  },300)
 });
 return {input,results,select(stops){
  if(!stops?.length)return;
  ++serial;clearTimeout(timer);input.value=stops[0].name;
  results.replaceChildren();onChoose(stops)
 }}
}

// Build 11: keep the physical travel order of each direction separate.
function routeVariants(id,no,raw){
 const rows=raw.map((x,index)=>({...node(x),order:Number(x.nodeord),direction:x.updowncd==null&&x.updowncode==null?'':String(x.updowncd??x.updowncode),sourceIndex:index})).filter(x=>x.id&&Number.isFinite(x.order));
 const directions=[...new Set(rows.map(x=>x.direction).filter(x=>x!==''))];
 let groups=[];
 if(directions.length>1&&rows.every(x=>x.direction!=='')){
  groups=directions.map(direction=>rows.filter(x=>x.direction===direction));
 }else{
  // Some cities omit updowncd and restart nodeord at the turn-around.
  // Only split at a clearly decreasing sequence; never guess a direction from names.
  let current=[];
  for(const x of rows){
   if(current.length&&x.order<current[current.length-1].order){groups.push(current);current=[]}
   current.push(x);
  }
  if(current.length)groups.push(current);
 }
 const knownDirections=groups.length>1&&directions.length>1;
 const appearances=new Map();
 if(groups.length>1)for(const group of groups)for(const x of group){
  const key=x.id+'|'+x.order;
  appearances.set(key,(appearances.get(key)||0)+1);
 }
 return groups.filter(g=>g.length).map((group,index)=>({
  id:String(id),no:String(no),direction:knownDirections?group[0].direction:'',
  segment:groups.length>1?String(index):'',
  stops:[...group].sort((a,b)=>a.order-b.order||a.sourceIndex-b.sourceIndex).map(x=>({
   id:x.id,name:x.name,no:x.no,lat:x.lat,lon:x.lon,order:x.order,
   ambiguousDirection:groups.length>1&&(appearances.get(x.id+'|'+x.order)||0)>1
  }))
 }));
}
function directionLabel(r){return r.direction==='0'?'상행':r.direction==='1'?'하행':r.segment!==''&&r.segment!=null?'운행 구간 '+(Number(r.segment)+1):''}
function selectedMatches(s,target){
 if(!s||!target)return false;if(s.id===target.id)return true;if(normStop(s.name)!==normStop(target.name))return false;
 const ll=[s.lat,s.lon,target.lat,target.lon];if(ll.every(x=>Number.isFinite(x)&&x!==0)){
 const rad=n=>n*Math.PI/180,dlat=rad(s.lat-target.lat),dlon=rad(s.lon-target.lon);
 const h=Math.sin(dlat/2)**2+Math.cos(rad(s.lat))*Math.cos(rad(target.lat))*Math.sin(dlon/2)**2;
 return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)))<600;
 }
 return true
}
function stopPairs(stops,from,to){const out=[];for(let i=0;i<stops.length;i++)if(selectedMatches(stops[i],from))for(let j=i+1;j<stops.length;j++)if(selectedMatches(stops[j],to)){out.push({i,j});break}return out}
function routesFor(){
 const out=[],seen=new Set();
 for(const r of otherTrip.routes){
  const sources=otherTrip.fromCandidates?.length?otherTrip.fromCandidates:[otherTrip.from];
  const targets=otherTrip.toCandidates?.length?otherTrip.toCandidates:[otherTrip.to];
  for(const from of sources.filter(Boolean))for(const to of targets.filter(Boolean))
   for(const p of stopPairs(r.stops,from,to)){
    const k=r.id+':'+(r.segment??'')+':'+p.i+':'+p.j;
    if(!seen.has(k)){seen.add(k);out.push({...r,...p})}
   }
 }
 return out
}
function switchTab(next){
 if(activeSearchProgress)cancelSearchProgress();
 if(next!=='settings')globalThis.JIBusDiagnostics?.lock();
 clearRetry();retryCount=0;tab=next;revision++;
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===next));
 $('settings').hidden=next!=='settings';
 $('dashboardPanel').hidden=next!=='home';
 $('searchPanel').hidden=next!=='search';
 $('favoritesPanel').hidden=next!=='favorites';
 // Recent history belongs to the dashboard and remains part of that panel.
 const showManual=next==='search'&&searchMode==='manual';
 $('heading').hidden=!showManual;
 $('status').hidden=!showManual;
 $('cards').hidden=!showManual;
 // Header refresh remains available on every tab; only the result panels are mode-specific.
 resetView();
 if(next==='favorites')renderFavorites();
 if(next==='search'&&showManual&&otherTrip.ready)refresh();
}
let lastGood=0, viewRevision=-1, autoOpened=false;
const routeKey=r=>r.id+':'+(r.segment??'')+':'+(r.direction??'')+':'+r.i+':'+r.j;
const liveCards=new Map();
const locationCache=new Map();
const routeInfoCache=new Map();
function resetView(){liveCards.clear();locationCache.clear();lastGood=0;autoOpened=false;viewRevision=revision;$('cards').replaceChildren()}
function vehicleIndex(r,v){
 const direction=v.updowncd??v.updowncode;
 if(r.direction!==''&&r.direction!=null&&direction!=null&&String(direction)!==r.direction)return -1;
 const id=String(v.nodeid??v.nodeId??''),order=v.nodeord==null?NaN:Number(v.nodeord);
 const matches=r.stops.map((stop,i)=>stop.id===id?i:-1).filter(i=>i>=0);
 if(!matches.length)return -1;
 const exact=Number.isFinite(order)?matches.filter(i=>r.stops[i].order===order):matches;
 if(exact.length!==1)return -1;
 // If two direction segments have the same nodeid/nodeord, the vehicle
 // must also supply a direction code. Otherwise its direction is unknown.
 if(r.stops[exact[0]].ambiguousDirection&&direction==null)return -1;
 return exact[0]
}
function etaLabel(s){s=Math.max(0,Math.ceil(s));return s===0?'도착 예정':s<=120?Math.floor(s/60)+'분 '+String(s%60).padStart(2,'0')+'초':Math.ceil(s/60)+'분 후'}
function setEta(e,seconds,at=Date.now()){
 if(seconds==null||!Number.isFinite(Number(seconds))||Number(seconds)<0){delete e.dataset.eta;e.textContent='도착정보 없음';e.classList.remove('urgent');return}
 e.dataset.eta=String(at+Number(seconds)*1000);e.dataset.sampled=String(at);tickEta(e,Date.now())
}
function tickEta(e,now){let s=(Number(e.dataset.eta)-now)/1000;e.textContent=now-Number(e.dataset.sampled)>45000?'정보 지연':s<=0?'도착 확인 중':etaLabel(s);e.classList.toggle('urgent',s<=120)}
function busIcon(no){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 52 43');svg.setAttribute('class','vehicleIcon');svg.setAttribute('aria-hidden','true');
 svg.innerHTML='<rect x="2" y="3" width="48" height="34" rx="6" fill="#f8fafc" stroke="#64748b"/><rect x="13" y="6" width="26" height="8" rx="2" fill="#172c39"/><text x="26" y="12.5" text-anchor="middle" font-size="7" font-weight="bold" fill="#fde047"></text><rect x="6" y="16" width="40" height="12" rx="2" fill="#83b5d0"/><path d="M26 16V28" stroke="#f8fafc" stroke-width="1.5"/><path d="M9 18L20 18L9 25Z" fill="white" opacity=".25"/><rect x="3" y="30" width="46" height="5" fill="#155e75"/><circle cx="9" cy="32" r="2" fill="#fef3c7"/><circle cx="43" cy="32" r="2" fill="#fef3c7"/><rect x="7" y="36" width="8" height="4" rx="1" fill="#111827"/><rect x="37" y="36" width="8" height="4" rx="1" fill="#111827"/><path d="M23 40L26 43L29 40" fill="#e2e8f0"/>';
 svg.querySelector('text').textContent=no;return svg
}
function makeTimeline(r){
 const wrap=el('div',undefined,'timeline'), rows=el('div',undefined,'timelineRows'), road=el('div',undefined,'road'), markers=el('div',undefined,'markers'), info=el('p',undefined,'muted'), toggle=el('button','전체 노선 보기','routeToggle');
 const state={wrap,rows,road,markers,info,toggle,r,vehicles:[],full:false,cells:new Map(),icons:new Map(),role:'',error:'',stamp:0};
 wrap.append(info,rows,toggle);rows.append(road,markers);toggle.onclick=()=>{state.full=!state.full;layoutTimeline(state,true)};
 return state
}
function layoutTimeline(t,rebuild=false){
 const r=t.r,start=t.full?0:Math.max(0,r.i-5),end=t.full?r.stops.length-1:Math.min(r.stops.length-1,r.i+2);
 if(rebuild||t.start!==start||t.end!==end||!t.cells.size){
  t.start=start;t.end=end;for(const cell of t.cells.values())cell.row.remove();t.cells.clear();
  for(let i=start;i<=end;i++){let row=el('div',undefined,'stoprow'),label=el('div',undefined,'stopname'),dot=el('span',undefined,'stopDot');row.append(dot,label);t.rows.insertBefore(row,t.road);t.cells.set(i,{row,label})}
 }
 t.toggle.textContent=t.full?'주변 정류장만 보기':'전체 노선 보기 · '+r.stops.length+'개';
 const vehicles=t.vehicles.map((v,idx)=>({v,idx,i:vehicleIndex(r,v)})).filter(x=>x.i>=0);
 const approaching=vehicles.filter(x=>x.i<=r.i).sort((a,b)=>b.i-a.i),primary=approaching[0];
 for(const [i,cell] of t.cells){
  let role=i===r.i?'board':i===r.j?'exit':primary&&i===primary.i?'current':primary&&i<primary.i?'passed':'future';
  if((t.role==='first'&&i===r.j)||(t.role==='second'&&i===r.i))role='transfer';
  cell.row.dataset.state=role;cell.label.className='stopname '+role;
  renderTimelineStopLabel(cell.label,r.stops[i].name,role)
 }
 let info=primary?'최근 확인 위치 · '+r.stops[primary.i].name+' · '+(r.i-primary.i)+'정류장 전':'탑승 방향 차량 위치 미확인 · 다른 방향 차량은 제외';
 if(primary&&primary.i<start)info+=' (표시 범위 밖)';
 if(t.error)info+=' · 위치 지연';
 if(t.info.textContent!==info)t.info.textContent=info;
 t.info.className=t.error?'error':'muted';
 const keep=new Set(),counts=new Map();
 for(const x of vehicles){if(x.i<start||x.i>end)continue;const raw=String(x.v.vehicleno??x.v.vehicleid??'').trim();const key=raw?'vehicle:'+raw:'anonymous:'+x.i+':'+x.idx;
  if(keep.has(key))continue;keep.add(key);let m=t.icons.get(key);const n=counts.get(x.i)||0;counts.set(x.i,n+1);
  if(!m){m=el('div',undefined,'vehicleMarker');m.append(busIcon(r.no));m.title=raw?'차량 '+raw:'차량 식별번호 미제공';t.markers.append(m);t.icons.set(key,m)}
  const y=(x.i-start)*44+22;const xOffset=n===0?0:n===1?9:-9;
  m.style.zIndex=String(10+n);m.classList.toggle('noMotion',rebuild||!raw||m.dataset.ready!=='1');
  m.style.transform='translate('+xOffset+'px,'+y+'px) translate(-50%,-50%)';
  if(n>2){m.hidden=true}else m.hidden=false;
  m.dataset.ready='1';
  if(m.classList.contains('noMotion'))requestAnimationFrame(()=>requestAnimationFrame(()=>m.classList.remove('noMotion')))
 }
 for(const [key,m] of t.icons)if(!keep.has(key)){m.remove();t.icons.delete(key)}
 // Explicitly report overlapping vehicles rather than imply all can fit in the lane.
 let extra=[...counts.values()].reduce((n,x)=>n+Math.max(0,x-3),0);if(extra)t.info.textContent+=' · 중복 위치 차량 '+extra+'대 추가';
}
function updateTimeline(t,r,v,error='',role=''){
 t.r=r;t.role=role;t.error=error;if(!error){t.vehicles=v;t.stamp=Date.now()}else if(!t.stamp&&v.length){t.vehicles=v}layoutTimeline(t)
}
/* V1.3 Build 03: semantic, text-based boarding/alighting badges. */
function makeStopBadge(kind){
 const labels={board:'탑승',exit:'하차',transfer:'환승'};
 if(!Object.prototype.hasOwnProperty.call(labels,kind))throw Error('Unknown stop role');
 const badge=el('span',labels[kind],'stopBadge stopBadge-'+kind);
 return badge
}
function makeStopPoint(kind,name){
 const item=el('span',undefined,'stopFlowPoint');
 item.append(makeStopBadge(kind),el('strong',name,'stopFlowName'));
 return item
}
function renderStopFlow(host,board,exit,via){
 const flow=el('div',undefined,'stopFlow');
 flow.append(makeStopPoint('board',board));
 if(via){flow.append(el('span','›','stopFlowArrow'),makeStopPoint('transfer',via))}
 flow.append(el('span','›','stopFlowArrow'),makeStopPoint('exit',exit));
 host.replaceChildren(flow)
}
function renderTimelineStopLabel(label,name,role){
 const key=role+'|'+name;
 if(label.dataset.stopLabelKey===key)return;
 label.dataset.stopLabelKey=key;
 label.replaceChildren();
 if(role==='board'||role==='exit'||role==='transfer'){
  label.append(makeStopBadge(role),el('span',name,'timelineStopName'))
 }else{
  label.textContent=name+(role==='current'?' · 현재':'')
 }
}
function ensureCard(key,title,transfer=false){
 let o=liveCards.get(key);if(o)return o;
 const box=el('article',undefined,transfer?'transferCard':'routeCard');box.dataset.cardKey=key;
 const head=el('div',undefined,'line'),h=el('h3',title),eta=el('span',undefined,'eta'),path=el('p',undefined,'routePath'),meta=el('p',undefined,'muted'),flag=el('p',undefined,'routeFlag'),details=el('details'),summary=el('summary','정류장 및 차량 위치');
 head.append(h,eta);details.append(summary);const schedule=el('p',undefined,'muted');box.append(head,path,meta,schedule,flag,details);
 o={box,head,h,eta,path,meta,schedule,flag,details,summary,timeline:null,legs:[]};liveCards.set(key,o);return o
}
function textTo(e,s){if(e.textContent!==s)e.textContent=s}
function arrangeCards(keys){
 const parent=$('cards');const keep=new Set(keys);let cursor=parent.firstChild;
 for(const key of keys){const o=liveCards.get(key);if(!o)continue;if(o.box!==cursor)parent.insertBefore(o.box,cursor);cursor=o.box.nextSibling}
 for(const [k,o] of liveCards)if(!keep.has(k)){o.box.remove();liveCards.delete(k)}
}
function timeLabel(raw){let x=String(raw??'').trim();if(/^\d{3,4}$/.test(x)){x=x.padStart(4,'0');return x.slice(0,2)+':'+x.slice(2)}if(/^\d{1,2}:\d{2}$/.test(x))return x;return ''}
function dailyInterval(info){
 const day=new Date().getDay(),value=day===0?info.intervalsuntime:day===6?info.intervalsattime:info.intervaltime;
 return Number(value)>0?String(value)+'분':''
}
function operatingText(info){
 if(!info)return '운행 기본정보를 확인할 수 없습니다. 다음 출발 예정시각 미확인';
 const first=timeLabel(info.startvehicletime),last=timeLabel(info.endvehicletime),interval=dailyInterval(info);
 const parts=[];if(first)parts.push('첫차 '+first);if(last)parts.push('막차 '+last);if(interval)parts.push('배차 약 '+interval);
 const now=new Date(),minutes=now.getHours()*60+now.getMinutes(),toM=s=>{let a=s.split(':').map(Number);return a[0]*60+a[1]};
 let state='현재 정류장 도착 차량 미확인';
 if(first&&last&&toM(first)<=toM(last)){if(minutes<toM(first))state='첫차 운행시간 전';else if(minutes>toM(last))state='막차시간 경과 · 운행 종료 여부 미확인'}
 return state+(parts.length?' · '+parts.join(' / ')+' (노선 기준)':'')+' · 다음 회차 출발시간 미확인'
}
async function getRouteInfo(id){
 const cached=routeInfoCache.get(id);if(cached&&Date.now()-cached.at<21600000)return cached.info;
 try{const rows=await api('route','getRouteInfoIem',{routeId:id});const info=rows[0]||null;routeInfoCache.set(id,{info,at:Date.now()});return info}
 catch(e){recordError(e,'노선 기본정보');routeInfoCache.set(id,{info:cached?.info||null,at:Date.now()-21000000});return cached?.info||null}
}
// A moving bus on the route does not imply that TAGO publishes an ETA
// for this boarding stop. Report the two facts independently.
function noArrivalVehicleStatus(r,location){
 const positions=Array.isArray(location?.v)?location.v:[];
 if(!positions.length)return location?.e?
  '차량 위치 조회 실패 · 탑승 정류장 도착예정시간 미제공':
  '탑승 정류장 도착예정시간 미제공 · 운행 차량 위치 미확인';
 const matched=positions.map(v=>vehicleIndex(r,v)).filter(i=>i>=0);
 const approaching=matched.filter(i=>i<=r.i);
 if(approaching.length)return '탑승 방향 차량 '+matched.length+'대 위치 확인 · 정류장 접근 후보 '+approaching.length+'대 · 도착예정시간 미제공';
 if(matched.length)return '탑승 방향 차량 '+matched.length+'대 위치 확인 · 현재 정류장 접근 차량 미확인 · 도착예정시간 미제공';
 return '노선 차량 '+positions.length+'대 위치 확인 · 탑승 방향 미확인 · 도착예정시간 미제공'
}
function directCard(r,a,location,first,at,info){
 const key='direct:'+routeKey(r),o=ensureCard(key,r.no),av=arrivalsFor(a,r.id),v=av[0];
 renderStopFlow(o.path,r.stops[r.i].name,r.stops[r.j].name);
 textTo(o.meta,v?'남은 정류장 '+(v.arrprevstationcnt??'미제공')+' · 다음 차량 '+(av[1]?Math.ceil(Number(av[1].arrtime)/60)+'분 후':'정보 없음'):noArrivalVehicleStatus(r,location));textTo(o.schedule,v?'':operatingText(info));
 textTo(o.flag,(directionLabel(r)?directionLabel(r)+' · ':'')+(first&&v?'가장 먼저 도착 · ':'')+'직행 노선');
 setEta(o.eta,v?.arrtime,at);
 if(!v)o.eta.textContent='예정시간 미제공';
 if(!o.timeline){o.timeline=makeTimeline(r);o.details.append(o.timeline.wrap)}
 updateTimeline(o.timeline,r,location.v,location.e||'');
 if(!o.naverMapLinks){o.naverMapLinks=el('div',undefined,'externalMaps');o.box.append(o.naverMapLinks)}
 attachWalkingMapLinks(o.naverMapLinks,r.stops[r.i]);
 return key
}

/* One transfer at the identical physical stop ID, in forward route order. */
function transferPaths(firstRoutes,lastRoutes,origin,dest){
 const first={id:origin,name:typeof origin==='string'?'':origin?.name},last={id:dest,name:typeof dest==='string'?'':dest?.name};
 const isSource=s=>typeof origin==='string'?s.id===origin:selectedMatches(s,origin);
 const isDest=s=>typeof dest==='string'?s.id===dest:selectedMatches(s,dest);
 const byStop=new Map();
 for(const r of lastRoutes)for(let j=0;j<r.stops.length;j++)if(isDest(r.stops[j]))for(let i=0;i<j;i++){
  let id=r.stops[i].id;if(isSource(r.stops[i])||isDest(r.stops[i]))continue;
  let arr=byStop.get(id)||[];arr.push({...r,i,j});byStop.set(id,arr)
 }
 const found=new Map();
 for(const r of firstRoutes)for(let i=0;i<r.stops.length;i++)if(isSource(r.stops[i]))for(let j=i+1;j<r.stops.length;j++){
  let id=r.stops[j].id;if(isDest(r.stops[j]))break;
  for(const second of byStop.get(id)||[]){if(second.id===r.id)continue;let first={...r,i,j},count=j-i+second.j-second.i,key=r.id+'|'+(r.segment??'')+'|'+second.id+'|'+(second.segment??'')+'|'+id;
   if(!found.has(key)||found.get(key).count>count)found.set(key,{first,second,count,stop:r.stops[j],key})
  }
 }
 return [...found.values()].sort((a,b)=>a.count-b.count||a.key.localeCompare(b.key))
}
const arrivalsFor=(rows,id)=>rows.filter(x=>String(x.routeid)===id&&x.arrtime!=null&&Number.isFinite(Number(x.arrtime))&&Number(x.arrtime)>=0).sort((a,b)=>Number(a.arrtime)-Number(b.arrtime));
function etaText(rows,id){let a=arrivalsFor(rows,id)[0];return a?(Number(a.arrtime)===0?'도착 예정':Math.ceil(Number(a.arrtime)/60)+'분 후'):'도착정보 없음'}
async function showTransfers(origin,arrivalRows,rev,at){
 const firstRoutes=otherTrip.routes;
 if(rev!==revision)return [];
 const paths=transferPaths(firstRoutes,otherTrip.routes,otherTrip.from,otherTrip.to);
 const score=p=>Number(arrivalsFor(arrivalRows,p.first.id)[0]?.arrtime??Infinity);
 paths.sort((a,b)=>Number.isFinite(score(a))!==Number.isFinite(score(b))?(Number.isFinite(score(a))?-1:1):(score(a)-score(b)||a.count-b.count));
 const seen=new Set(),top=[];for(const p of paths){let k=p.first.id+'|'+(p.first.segment??'')+'|'+p.second.id+'|'+(p.second.segment??'');if(seen.has(k))continue;seen.add(k);top.push(p);if(top.length===3)break}
 const ats=new Map(),firstAts=new Map(),loc=new Map();
 for(const p of top){
  const boardId=p.first.stops[p.first.i].id;
  if(!firstAts.has(boardId)){if(boardId===origin)firstAts.set(boardId,{rows:arrivalRows,at});else try{firstAts.set(boardId,{rows:await api('arrival','getSttnAcctoArvlPrearngeInfoList',{nodeId:boardId}),at:Date.now()})}catch(e){firstAts.set(boardId,{rows:[],error:e.message})}}
  if(!ats.has(p.stop.id)){try{const rows=await api('arrival','getSttnAcctoArvlPrearngeInfoList',{nodeId:p.stop.id});ats.set(p.stop.id,{rows,at:Date.now()})}catch(e){ats.set(p.stop.id,{rows:[],error:e.message})}}
  for(const r of [p.first,p.second])if(!loc.has(r.id))loc.set(r.id,await fetchLocation(r.id))
 }
 if(rev!==revision)return [];
 const keys=[];
 for(const p of top){
  const key='transfer:'+p.key,o=ensureCard(key,p.first.no+' → '+p.second.no,true),second=ats.get(p.stop.id),first=firstAts.get(p.first.stops[p.first.i].id);
  keys.push(key);renderStopFlow(o.path,p.first.stops[p.first.i].name,p.second.stops[p.second.j].name,p.stop.name);
  textTo(o.meta,'환승 1회 · '+p.count+'개 구간 · 동일 정류장 환승');
  textTo(o.flag,'환승 성립 및 최종 도착시간 미확정');
  setEta(o.eta,arrivalsFor(first.rows,p.first.id)[0]?.arrtime,first.at);
  textTo(o.summary,'두 차량 위치 · 현재 기준');
  if(!o.naverMapLinks){o.naverMapLinks=el('div',undefined,'externalMaps');o.box.append(o.naverMapLinks)}
  attachWalkingMapLinks(o.naverMapLinks,p.first.stops[p.first.i]);
  if(!o.legs.length){for(let i=0;i<2;i++){const d=el('details'),s=el('summary'),v=el('span',undefined,'legEta'),t=makeTimeline(i?p.second:p.first);d.append(s,v,t.wrap);o.details.append(d);o.legs.push({d,s,v,t})}}
  for(const [i,r] of [p.first,p.second].entries()){const leg=o.legs[i],l=loc.get(r.id);textTo(leg.s,(i+1)+'구간 · '+r.no+'번'+(directionLabel(r)?' · '+directionLabel(r):'')+' · '+r.stops[r.i].name+' 탑승');
   setEta(leg.v,i?arrivalsFor(second.rows,r.id)[0]?.arrtime:arrivalsFor(first.rows,r.id)[0]?.arrtime,i?second.at:first.at);
   if(i&&second.error){leg.v.textContent='환승 도착정보 조회 실패';delete leg.v.dataset.eta}
   updateTimeline(leg.t,r,l.v,l.e||'',i?'second':'first')
  }
 }
 return keys
}
async function fetchLocation(id){
 try{let v=await api('location','getRouteAcctoBusLcList',{routeId:id});locationCache.set(id,{v,at:Date.now()});return {v}}
 catch(e){return {v:locationCache.get(id)?.v||[],e:e.message}}
}
async function refresh(){
 if(tab!=='search'||searchMode!=='manual'||busy||document.hidden||authBlocked||!otherTrip.ready)return;
 if(viewRevision!==revision)resetView();
 const rev=revision,list=routesFor();
 const heading=(otherTrip.from?.name||'출발 미선택')+' → '+(otherTrip.to?.name||'도착 미선택');
 if($('heading').dataset.heading!==heading){
  $('heading').replaceChildren(el('strong',heading));
  $('heading').dataset.heading=heading
 }
 if(!list.length&&!otherTrip.transferRequested){
  arrangeCards([]);
  status('초기 검색 범위에서 직행 후보가 없습니다. 추가 직행 또는 환승 검색을 선택하세요.');
  return;
 }
 busy=true;$('refresh').classList.add('refreshing');$('refresh').setAttribute('aria-busy','true');
 if(!lastGood)status('실시간 조회 중…');
 try{
  const at=Date.now(),arrivalsByStop=new Map(),arrivalErrors=[];
  const stopIds=[...new Set(list.map(r=>r.stops[r.i].id))];
  if(!stopIds.length&&otherTrip.from?.id)stopIds.push(otherTrip.from.id);
  for(const id of stopIds)try{
   arrivalsByStop.set(id,await api('arrival','getSttnAcctoArvlPrearngeInfoList',{nodeId:id}))
  }catch(e){arrivalErrors.push(e);recordError(e,'정류장 조회')}
  if(!arrivalsByStop.size&&arrivalErrors.length)throw arrivalErrors[0];
  const rowsFor=r=>arrivalsByStop.get(r.stops[r.i].id)||[];
  if(rev!==revision)return;
  const loc=new Map();
  for(const id of new Set(list.map(r=>r.id))){if(rev!==revision)return;loc.set(id,await fetchLocation(id))}
  if(rev!==revision)return;
  const score=r=>Number(arrivalsFor(rowsFor(r),r.id)[0]?.arrtime??Infinity);
  list.sort((a,b)=>score(a)-score(b)||a.no.localeCompare(b.no,'ko',{numeric:true}));
  const metas=new Map();
  for(const r of list)if(!arrivalsFor(rowsFor(r),r.id).length&&!metas.has(r.id))metas.set(r.id,await getRouteInfo(r.id));
  if(rev!==revision)return;
  const keys=list.map((r,i)=>directCard(r,rowsFor(r),loc.get(r.id),i===0,at,metas.get(r.id)));
  let transferError='';
  if(otherTrip.transferRequested){
   try{keys.push(...await showTransfers(otherTrip.from.id,arrivalsByStop.get(otherTrip.from.id)||[],rev,at))}
   catch(e){transferError='환승 조회 지연 · '+e.message;keys.push(...[...liveCards.keys()].filter(k=>k.startsWith('transfer:')))}
  }
  if(rev!==revision)return;
  arrangeCards(keys);
  if(!autoOpened&&keys.length){
   const preferred=keys.find(k=>k.startsWith('direct:')&&liveCards.get(k).eta.dataset.eta)||keys.find(k=>k.startsWith('transfer:'))||keys[0];
   liveCards.get(preferred).details.open=true;autoOpened=true
  }
  lastGood=at;resetFailures();
  const partial=[...loc.values()].some(l=>l.e)||arrivalErrors.length>0;
  status('갱신 '+new Date(lastGood).toLocaleTimeString('ko-KR')+(partial?' · 일부 위치 지연':'')+(transferError?' · '+transferError:!keys.length?' · 연결 경로 없음':''),!!transferError||partial);
 }catch(e){
  if(rev===revision){const retry=planRetry(e);status((lastGood?'조회 지연 · 마지막 정상 수신 '+new Date(lastGood).toLocaleTimeString('ko-KR'):'조회 실패')+' · '+retry,true)}
 }finally{
  busy=false;$('refresh').classList.remove('refreshing');$('refresh').removeAttribute('aria-busy');
  if(rev!==revision&&tab==='search')refresh()
 }
}

/* V1.1: route-based favorites, never overwrite legacy saved settings. */
function validStop(s){return !!s&&typeof s.id==='string'&&!!s.id&&typeof s.name==='string'}
function sameTrip(a,b){return a&&b&&a.from.id===b.from.id&&a.to.id===b.to.id}
function makeTrip(title,from,to){
 return {id:'trip-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),title,from,to}
}
function migrateTrips(){
 if(cfg.tripMigrationV11)return;
 const list=cfg.tripFavorites.filter(t=>validStop(t?.from)&&validStop(t?.to));
 const add=(title,from,to)=>{
  if(!validStop(from)||!validStop(to))return;
  const trip=makeTrip(title,from,to);
  if(!list.some(t=>sameTrip(t,trip)))list.push(trip)
 };
 add('회사 출근',cfg.stops.board,cfg.stops.exit);
 const source=[...cfg.favorites,...cfg.routes.flatMap(r=>r.stops)].find(s=>s.id===cfg.last);
 add('집으로 귀가',source,cfg.stops.home);
 cfg.tripFavorites=list;cfg.tripMigrationV11=true;
 save()
}
migrateTrips();
// Retire obsolete alternate-alighting fields; keep trip name and true endpoints.
let cleanedLegacyAlternates=false;
for(const trip of cfg.tripFavorites){
 if(trip&&Object.prototype.hasOwnProperty.call(trip,'alt')){
  delete trip.alt;cleanedLegacyAlternates=true
 }
}
if(cfg.stops&&Object.prototype.hasOwnProperty.call(cfg.stops,'alt')){
 delete cfg.stops.alt;cleanedLegacyAlternates=true
}
if(cleanedLegacyAlternates)save();
const otherTrip={from:null,to:null,fromCandidates:[],toCandidates:[],routes:[],ready:false,transferRequested:false};
function tripSummary(){
 return otherTrip.from&&otherTrip.to?otherTrip.from.name+' → '+otherTrip.to.name:'출발·도착 정류장을 선택하세요.'
}
function setTrip(from,to){
 otherTrip.from=from;otherTrip.to=to;
 // Legacy alternate alighting stops must never alter the selected destination.
 otherTrip.fromCandidates=[from];otherTrip.toCandidates=[to];
 otherTrip.ready=false;otherTrip.routes=[];directSearchSession=null;progressiveActions.hidden=true;otherTrip.transferRequested=false;
 $('otherSelection').textContent=tripSummary();
 $('saveTrip').disabled=!(validStop(from)&&validStop(to));
 revision++;resetView();arrangeCards([]);
}

/* V1.3: recent-trip history; never store precise location or API responses. */
function rememberTrip(from,to){
 if(!validStop(from)||!validStop(to))return;
 const cleaned=(cfg.recentTrips||[]).filter(x=>validStop(x?.from)&&validStop(x?.to)&&!(x.from.id===from.id&&x.to.id===to.id));
 cfg.recentTrips=[{from:{id:from.id,name:from.name,no:from.no||'',lat:from.lat,lon:from.lon},to:{id:to.id,name:to.name,no:to.no||'',lat:to.lat,lon:to.lon},at:Date.now()},...cleaned].slice(0,5);
 cfg.lastTrip={from,to};save();
 renderRecentTrips()
}
function renderRecentTrips(){
 const host=$('recentTrips');if(!host)return;
 host.replaceChildren();
 const entries=cfg.recentTrips.filter(x=>validStop(x?.from)&&validStop(x?.to)).slice(0,5);
 if(!entries.length){host.append(el('p','최근 검색 기록이 없습니다.','muted'));return}
 for(const trip of entries){
  const row=el('div',undefined,'recentTripRow');
  const open=el('button',trip.from.name+' → '+trip.to.name);
  open.type='button';open.onclick=()=>{
   setTrip(trip.from,trip.to);
   fromControl.input.value=trip.from.name;toControl.input.value=trip.to.name;
   setSearchMode('manual');switchTab('search');searchTrip()
  };
  const remove=el('button','삭제');remove.type='button';remove.setAttribute('aria-label',trip.from.name+' → '+trip.to.name+' 기록 삭제');
  remove.onclick=()=>{
   cfg.recentTrips=cfg.recentTrips.filter(x=>!(x.from.id===trip.from.id&&x.to.id===trip.to.id));save();renderRecentTrips()
  };
  row.append(open,remove);host.append(row)
 }
}
function renderFavorites(){
 const host=$('favoriteList');host.replaceChildren();
 if(!cfg.tripFavorites.length){host.append(el('p','저장된 구간이 없습니다. 버스 검색에서 자주 이용하는 구간을 저장하세요.','muted'));return}
 cfg.tripFavorites.forEach((trip,index)=>{
  const card=el('article',undefined,'favoriteCard');
  const header=el('div',undefined,'line'),title=el('strong',trip.title||'저장된 구간');
  header.append(title);
  card.append(header,el('p',trip.from.name+' → '+trip.to.name,'muted'));
  const actions=el('div',undefined,'favoriteActions');
  const open=el('button','검색','primary');
  open.onclick=()=>{setTrip(trip.from,trip.to);fromControl.input.value=trip.from.name;toControl.input.value=trip.to.name;setSearchMode('manual');switchTab('search');searchTrip()};
  const rename=el('button','이름 변경');rename.onclick=()=>{
   const next=prompt('즐겨찾기 이름',trip.title||'저장된 구간');
   if(next===null)return;
   if(!next.trim()){alert('이름을 입력하세요.');return}
   trip.title=next.trim().slice(0,40);save();renderFavorites()
  };
  const up=el('button','↑');up.title='위로';up.disabled=index===0;
  up.onclick=()=>{[cfg.tripFavorites[index-1],cfg.tripFavorites[index]]=[cfg.tripFavorites[index],cfg.tripFavorites[index-1]];save();renderFavorites()};
  const down=el('button','↓');down.title='아래로';down.disabled=index===cfg.tripFavorites.length-1;
  down.onclick=()=>{[cfg.tripFavorites[index+1],cfg.tripFavorites[index]]=[cfg.tripFavorites[index],cfg.tripFavorites[index+1]];save();renderFavorites()};
  const remove=el('button','삭제');remove.onclick=()=>{if(!confirm('이 즐겨찾기를 삭제할까요?'))return;cfg.tripFavorites.splice(index,1);save();renderFavorites()};
  actions.append(open,rename,up,down,remove);card.append(actions);host.append(card)
 })
}
$('connectionCheck').onclick=async()=>{
 const button=$('connectionCheck'),label=$('settingsStatus');
 button.disabled=true;label.textContent='버스정보 서비스 연결 확인 중…';
 try{
  const codes=await api('arrival','getCtyCodeList');
  label.textContent=codes.some(x=>String(x.citycode)==='33010')?'버스정보 서비스 정상 연결 · 청주시 조회 가능':'연결 성공 · 청주시 정보 확인 필요';
  label.className='muted'
 }catch(error){label.textContent='연결 확인 실패: '+error.message;label.className='error';recordError(error,'서비스 연결')}
 finally{button.disabled=false}
};
const fromControl=stopSearchControl($('otherFromResults'),stops=>{
 otherTrip.from=stops[0];otherTrip.fromCandidates=stops;otherTrip.ready=false;otherTrip.routes=[];directSearchSession=null;progressiveActions.hidden=true;otherTrip.transferRequested=false;
 $('otherSelection').textContent=tripSummary();$('saveTrip').disabled=!(otherTrip.from&&otherTrip.to);
 revision++;resetView()
});

function distanceMetres(lat1,lon1,lat2,lon2){
 const toRad=x=>x*Math.PI/180,dlat=toRad(lat2-lat1),dlon=toRad(lon2-lon1);
 const a=Math.sin(dlat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dlon/2)**2;
 return 6371000*2*Math.asin(Math.sqrt(Math.min(1,a)))
}
function nearbyStops(rows,lat,lon){
 const found=new Map();
 for(const raw of rows){
  const stop=node(raw);
  if(!stop.id||!stop.name||!Number.isFinite(stop.lat)||!Number.isFinite(stop.lon)||!stop.lat||!stop.lon)continue;
  const distance=distanceMetres(lat,lon,stop.lat,stop.lon);
  if(!Number.isFinite(distance))continue;
  if(!found.has(stop.id)||found.get(stop.id).distance>distance)found.set(stop.id,{...stop,distance})
 }
 return [...found.values()].sort((a,b)=>a.distance-b.distance).slice(0,15)
}
// Build 04: retain route-specific next stops and terminal stations together.
// These are short-lived in-memory caches; no API key or fetched data is persisted.
const nearbyRouteCache=new Map();
const nearbyRouteCacheMs=6*60*60*1000;
async function nearbyRouteDetails(id,no){
 const current=nearbyRouteCache.get(id);
 if(current&&Date.now()-current.at<nearbyRouteCacheMs)return current.promise;
 const promise=(async()=>{
  const variants=routeVariants(id,no,await api('route','getRouteAcctoThrghSttnList',{routeId:id}));
  // A single undirected loop may pass its terminus and continue back.
  // Request named endpoints only for this ambiguous shape.
  const info=variants.length===1&&!variants[0].direction
   ?await getRouteInfo(id):null;
  return {variants,info}
 })();
 nearbyRouteCache.set(id,{at:Date.now(),promise});
 try{return await promise}catch(error){nearbyRouteCache.delete(id);throw error}
}
function nextAndTerminal(variant,index,info){
 const stops=variant.stops;
 if(index>=stops.length-1)return null;
 const next=stops[index+1];
 const endpoints=[info?.endnodenm,info?.startnodenm]
  .map(x=>normStop(x)).filter(Boolean);
 let terminal=null;
 // In a continuous outbound/return loop, the first future endpoint is the
 // correct endpoint for that direction (not necessarily the last route stop).
 if(endpoints.length){
  for(let j=index+1;j<stops.length;j++){
   if(endpoints.includes(normStop(stops[j].name))){terminal=stops[j];break}
  }
 }
 // Explicit up/down segments or independently split legs have a known end.
 if(!terminal&&(variant.direction!==''||variant.segment!==''))terminal=stops[stops.length-1];
 // Do not guess a terminal for an undivided route lacking endpoint data.
 return {next:next.name,terminal:terminal?.name||null}
}
function directionSummaries(stop,routeDetails){
 const candidates=new Map();
 for(const {id,no,variants,info} of routeDetails){
  for(const variant of variants){
   for(let i=0;i<variant.stops.length-1;i++){
    if(variant.stops[i].id!==stop.id)continue;
    const pair=nextAndTerminal(variant,i,info);
    if(!pair)continue;
    const key=normStop(pair.next)+'|'+normStop(pair.terminal||'');
    if(!candidates.has(key))candidates.set(key,{next:pair.next,terminal:pair.terminal,routes:[]});
    const entry=candidates.get(key);
    if(!entry.routes.includes(no))entry.routes.push(no)
   }
  }
 }
 return [...candidates.values()]
}
async function fetchStopDirections(stop){
 const passing=await api('stop','getSttnThrghRouteList',{nodeid:stop.id});
 const routes=new Map();
 for(const item of passing){
  if(item.routeid)routes.set(String(item.routeid),String(item.routeno??'노선번호 없음'))
 }
 // Limit API requests for a single stop: representative route-bound pairs
 // are shown, never mislabeled as a complete list when there are more.
 const limited=[...routes].slice(0,4);
 const details=[],errors=[];
 for(const [id,no] of limited){
  try{details.push({id,no,...await nearbyRouteDetails(id,no)})}
  catch(error){errors.push(error)}
 }
 return {directions:directionSummaries(stop,details),totalRoutes:routes.size,checkedRoutes:details.length,errors:errors.length}
}
function showNearbyDirections(host,data){
 host.replaceChildren();
 const {directions,totalRoutes,checkedRoutes,errors}=data;
 if(!directions.length){
  host.append(el('span',errors?'방향 정보 확인 실패':'방향 정보 없음','muted'));
  return
 }
 for(const d of directions.slice(0,3)){
  const row=el('span',undefined,'nearbyDirectionLine');
  row.append(el('span','다음: '+d.next,'nearbyNext'));
  row.append(el('span','종점: '+(d.terminal||'확인 필요'),'nearbyTerminal'));
  row.append(el('span',d.routes.join(', ')+'번','nearbyRouteNo'));
  host.append(row)
 }
 if(directions.length>3||totalRoutes>checkedRoutes){
  host.append(el('span','그 외 노선/방향 있음 · 대표 정보 표시','nearbyMore'))
 }
}
const nearbyButton=$('nearbyFrom'),nearbyResults=$('nearbyResults');
let nearbySerial=0;
nearbyButton.onclick=()=>{
 const serial=++nearbySerial;
 nearbyResults.replaceChildren();
 if(!navigator.geolocation){
  showStopSearchState(nearbyResults,'위치 검색을 지원하지 않습니다. 정류장 이름으로 검색해 주세요.',true);return
 }
 const work=beginSearchProgress('주변 정류장을 찾고 있습니다',()=>{
  ++nearbySerial;nearbyButton.disabled=false;nearbyResults.replaceChildren();
  showStopSearchState(nearbyResults,'주변 정류장 검색을 취소했습니다.')
 });
 nearbyButton.disabled=true;
 searchProgressStep(work,'현재 GPS 위치를 확인하고 있습니다. 위치 접근을 허용해 주세요.');
 showStopSearchState(nearbyResults,'현재 위치 확인 중… 위치 접근을 허용해 주세요.');
 navigator.geolocation.getCurrentPosition(async position=>{
  if(serial!==nearbySerial){endSearchProgress(work);return}
  searchProgressStep(work,'주변 정류장을 조회하고 있습니다…');
  showStopSearchState(nearbyResults,'주변 정류장 검색 중… 잠시만 기다려 주세요.');
  try{
   const lat=position.coords.latitude,lon=position.coords.longitude;
   const rows=await api('stop','getCrdntPrxmtSttnList',{gpsLati:String(lat),gpsLong:String(lon)});
   if(serial!==nearbySerial)return;
   const stops=nearbyStops(rows,lat,lon);
   nearbyResults.replaceChildren();
   if(!stops.length){
    showStopSearchState(nearbyResults,'주변에서 정류장을 찾지 못했습니다. 이름으로 검색해 주세요.');return
   }
   nearbyResults.append(el('p','가까운 정류장 '+stops.length+'개 · 출발지를 선택하세요.','muted'));
   globalThis.JIBusDiagnostics?.setCandidates(stops.length,stops.length);
   globalThis.JIBusDiagnostics?.markFirstResult();
   searchProgressStep(work,'정류장별 운행 방향을 확인하고 있습니다…');
   const jobs=[];
   for(const stop of stops){
    const button=el('button',undefined,'nearbyStopCard');
    button.type='button';
    const head=el('span',undefined,'nearbyStopHead');
    head.append(el('strong',stop.name,'nearbyStopTitle'),el('span','약 '+Math.round(stop.distance)+'m','nearbyDistance'));
    const directions=el('span','다음 정류장·종점 조회 중…','nearbyDirectionList muted');
    button.append(head,directions);
    button.onclick=()=>{
     ++nearbySerial;
     fromControl.select([stop]);
     nearbyResults.replaceChildren();
     showStopSearchState(nearbyResults,'출발지 선택 완료 · '+stop.name)
    };
    nearbyResults.append(button);
    jobs.push({stop,directions})
   }
   // Progressively enrich visible cards, while bounding concurrent requests.
   let nextJob=0;
   const worker=async()=>{
    while(nextJob<jobs.length&&serial===nearbySerial){
     const job=jobs[nextJob++];
     try{
      const data=await fetchStopDirections(job.stop);
      if(serial===nearbySerial)showNearbyDirections(job.directions,data)
     }catch(error){
      if(serial===nearbySerial)showStopSearchState(job.directions,'방향 정보 확인 실패',true)
     }
    }
   };
   await Promise.all([worker(),worker(),worker()]);
  }catch(e){
   if(serial===nearbySerial)showStopSearchState(nearbyResults,'주변 정류장 검색 실패 · '+e.message,true)
  }finally{endSearchProgress(work);if(serial===nearbySerial)nearbyButton.disabled=false}
 },error=>{
  if(serial!==nearbySerial)return;
  const message=error.code===1?'위치 접근이 거부되었습니다. 권한을 허용하거나 직접 검색해 주세요.':
   error.code===2?'현재 위치를 확인할 수 없습니다. 정류장 이름으로 검색해 주세요.':
   '위치 확인 시간이 초과되었습니다. 다시 시도하거나 직접 검색해 주세요.';
  showStopSearchState(nearbyResults,message,true);nearbyButton.disabled=false;
  endSearchProgress(work)
 },{enableHighAccuracy:true,timeout:12000,maximumAge:60000})
}
const toControl=stopSearchControl($('otherToResults'),stops=>{
 otherTrip.to=stops[0];otherTrip.toCandidates=stops;otherTrip.ready=false;otherTrip.routes=[];directSearchSession=null;progressiveActions.hidden=true;otherTrip.transferRequested=false;
 $('otherSelection').textContent=tripSummary();$('saveTrip').disabled=!(otherTrip.from&&otherTrip.to);
 revision++;resetView()
});
for(const [name,control] of [['from',fromControl],['to',toControl]])control.input.addEventListener('input',()=>{
 if(name==='from'){++nearbySerial;nearbyButton.disabled=false;nearbyResults.replaceChildren()}
 if(otherTrip[name]?.name===control.input.value.trim())return;
 otherTrip[name]=null;otherTrip[name+'Candidates']=[];otherTrip.ready=false;otherTrip.routes=[];directSearchSession=null;progressiveActions.hidden=true;otherTrip.transferRequested=false;
 $('otherSelection').textContent='입력한 정류장을 검색 결과에서 선택하세요';
 $('saveTrip').disabled=true;revision++;resetView()
});
$('swapOther').onclick=()=>{
 const from=otherTrip.from,fromCandidates=otherTrip.fromCandidates;
 otherTrip.from=otherTrip.to;otherTrip.fromCandidates=otherTrip.toCandidates;
 otherTrip.to=from;otherTrip.toCandidates=fromCandidates;
 otherTrip.ready=false;otherTrip.routes=[];directSearchSession=null;progressiveActions.hidden=true;otherTrip.transferRequested=false;revision++;resetView();
 fromControl.input.value=otherTrip.from?.name||'';toControl.input.value=otherTrip.to?.name||'';
 $('otherSelection').textContent=tripSummary();$('saveTrip').disabled=!(otherTrip.from&&otherTrip.to)
};
$('saveTrip').onclick=()=>{
 if(!validStop(otherTrip.from)||!validStop(otherTrip.to))return;
 const candidate=makeTrip('',otherTrip.from,otherTrip.to);
 if(cfg.tripFavorites.some(x=>sameTrip(x,candidate))){$('otherSelection').textContent='이미 즐겨찾기에 등록된 구간입니다.';return}
 const title=prompt('즐겨찾기 이름',otherTrip.from.name+' → '+otherTrip.to.name);
 if(title===null)return;
 if(!title.trim()){alert('이름을 입력하세요.');return}
 candidate.title=title.trim().slice(0,40);cfg.tripFavorites.push(candidate);save();
 $('otherSelection').textContent='즐겨찾기 저장 완료 · '+candidate.title
};
/* V1.4 Build 01: perform one small direct search first. Extra routes and
   transfers are never searched until the traveller explicitly requests them. */
const progressiveActions=el('div',undefined,'progressiveActions');
const moreDirectButton=el('button','다른 직행 노선 검색');
const transferButton=el('button','환승 경로 검색');
moreDirectButton.type=transferButton.type='button';
progressiveActions.hidden=true;
progressiveActions.append(moreDirectButton,transferButton);
$('manualPanel').append(progressiveActions);
const directRouteCache=new Map();
let directSearchSession=null;
async function cachedDirectVariants(id,no){
 const value=directRouteCache.get(id);
 if(value&&Date.now()-value.at<6*60*60*1000)return value.promise;
 const promise=api('route','getRouteAcctoThrghSttnList',{routeId:id})
  .then(rows=>routeVariants(id,no,rows));
 directRouteCache.set(id,{at:Date.now(),promise});
 try{return await promise}catch(e){directRouteCache.delete(id);throw e}
}
function matchingDirect(routes){
 const from=otherTrip.fromCandidates.length?otherTrip.fromCandidates:[otherTrip.from];
 const to=otherTrip.toCandidates.length?otherTrip.toCandidates:[otherTrip.to];
 return routes.filter(r=>from.some(a=>to.some(b=>stopPairs(r.stops,a,b).length)));
}
async function searchTrip(){
 if(!validStop(otherTrip.from)||!validStop(otherTrip.to)){
  $('otherSelection').textContent='출발·도착 정류장을 모두 선택하세요';return
 }
 const button=$('findOther'),token=++revision;
 const work=beginSearchProgress('우선 추천 직행 노선을 찾고 있습니다',()=>{
  revision++;otherTrip.ready=false;otherTrip.routes=[];directSearchSession=null;button.disabled=false;
  progressiveActions.hidden=true;
  $('otherSelection').textContent='경로 검색을 취소했습니다.';resetView()
 });
 button.disabled=true;progressiveActions.hidden=true;
 otherTrip.ready=false;otherTrip.routes=[];otherTrip.transferRequested=false;
 directSearchSession=null;resetView();
 $('otherSelection').textContent='우선 이용할 수 있는 직행 노선을 찾는 중…';
 try{
  const ids=new Map();
  searchProgressStep(work,'목적지 경유 노선을 확인하고 있습니다…');
  for(const dest of (otherTrip.toCandidates.length?otherTrip.toCandidates:[otherTrip.to]).slice(0,3)){
   const items=await api('stop','getSttnThrghRouteList',{nodeid:dest.id});
   if(token!==revision)return;
   for(const item of items)if(item.routeid)ids.set(String(item.routeid),String(item.routeno||'노선번호 없음'))
  }
  // Prioritize routes that serve both the boarding and requested alighting
  // stop. The saved legacy alternate stop must never influence route lookup.
  const boardingRoutes=new Set();
  try{
   searchProgressStep(work,'출발 정류장 경유 노선을 대조하고 있습니다…');
   for(const origin of (otherTrip.fromCandidates.length?otherTrip.fromCandidates:[otherTrip.from]).slice(0,3)){
    const rows=await api('stop','getSttnThrghRouteList',{nodeid:origin.id});
    if(token!==revision)return;
    for(const item of rows)if(item.routeid)boardingRoutes.add(String(item.routeid))
   }
  }catch(e){recordError(e,'출발 정류장 노선 대조')}
  // The directional stop sequence is independently validated by stopPairs.
  const entries=[...ids].sort((a,b)=>Number(boardingRoutes.has(b[0]))-Number(boardingRoutes.has(a[0])));
  const checked=new Map(),firstPassLimit=Math.min(24,entries.length);
  const candidates=[];let chosen=null,attempted=0;
  searchProgressStep(work,'실제 목적지까지 운행하는 직행 노선을 확인하고 있습니다…');
  for(let offset=0;offset<firstPassLimit&&new Set(candidates.map(x=>x.route.id)).size<3;offset+=3){
   const batch=entries.slice(offset,Math.min(offset+3,firstPassLimit));
   const outcomes=await Promise.allSettled(batch.map(async([id,no])=>({id,variants:await cachedDirectVariants(id,no)})));
   if(token!==revision)return;
   outcomes.forEach((result,index)=>{
    attempted++;
    if(result.status!=='fulfilled'){recordError(result.reason,'우선 직행 노선');return}
    const {id,variants}=result.value;
    checked.set(id,variants);
    for(const route of matchingDirect(variants)){
     const from=otherTrip.fromCandidates.length?otherTrip.fromCandidates:[otherTrip.from];
     const to=otherTrip.toCandidates.length?otherTrip.toCandidates:[otherTrip.to];
     let pair=null;
     for(const origin of from)for(const dest of to)
      if(!pair)pair=stopPairs(route.stops,origin,dest)[0]||null;
     if(pair)candidates.push({route,boardId:route.stops[pair.i].id,rideStops:pair.j-pair.i});
    }
   });
  }
  if(token!==revision)return;
  const shortlist=[];const used=new Set();
  for(const candidate of candidates){
   if(used.has(candidate.route.id))continue;
   used.add(candidate.route.id);shortlist.push(candidate);
   if(shortlist.length===3)break
  }
  const arrivals=new Map();
  if(shortlist.length){
   searchProgressStep(work,'직행 후보의 실시간 도착시간을 비교하고 있습니다…');
   const boardIds=[...new Set(shortlist.map(x=>x.boardId))];
   const results=await Promise.allSettled(boardIds.map(id=>
    api('arrival','getSttnAcctoArvlPrearngeInfoList',{nodeId:id})));
   if(token!==revision)return;
   results.forEach((result,i)=>{
    if(result.status==='fulfilled')arrivals.set(boardIds[i],result.value);
    else recordError(result.reason,'추천 도착시간')
   });
   const score=c=>{
    const rows=arrivals.get(c.boardId)||[];
    const matched=arrivalsFor(rows,c.route.id).filter(x=>{
     const dir=x.updowncd??x.updowncode;
     return !c.route.direction||dir==null||String(dir)===c.route.direction
    });
    return Number(matched[0]?.arrtime??Infinity)
   };
   shortlist.sort((a,b)=>{
    const ae=score(a),be=score(b);
    return (Number.isFinite(ae)?0:1)-(Number.isFinite(be)?0:1)||
     ae-be||a.rideStops-b.rideStops||a.route.no.localeCompare(b.route.no,'ko',{numeric:true})
   });
   chosen=shortlist[0].route
  }
  globalThis.JIBusDiagnostics?.setCandidates(attempted,shortlist.length);
  if(chosen)globalThis.JIBusDiagnostics?.markFirstResult();
  if(token!==revision)return;
  directSearchSession={entries,checked,attempted,origin:otherTrip.from.id,destination:otherTrip.to.id};
  otherTrip.routes=chosen?[chosen]:[];
  otherTrip.ready=true;
  rememberTrip(otherTrip.from,otherTrip.to);
  progressiveActions.hidden=false;
  $('otherSelection').textContent=chosen?
   '비교된 직행 후보 '+shortlist.length+'개 중 '+chosen.no+'번 우선 추천 · 다른 노선 및 환승은 선택 시 조회':
   '초기 '+attempted+'개 노선에서 목적지 직행을 찾지 못했습니다. 다른 직행 노선 검색으로 계속 확인할 수 있습니다.';
  if(chosen){
   searchProgressStep(work,'추천 노선의 실시간 도착정보를 확인하고 있습니다…');
   resetView();await refresh()
  }else{
   resetView();arrangeCards([]);
   status('현재 초기 검색 범위에서 직행 후보가 없습니다. 추가 검색을 선택해 주세요.')
  }
 }catch(e){if(token===revision){$('otherSelection').textContent='경로 검색 실패: '+e.message;recordError(e,'버스 검색')}}
 finally{endSearchProgress(work);button.disabled=false}
}
async function searchAdditionalRoutes(includeTransfer){
 if(!directSearchSession||!otherTrip.ready)return;
 const session=directSearchSession,token=++revision;
 const button=includeTransfer?transferButton:moreDirectButton;
 const work=beginSearchProgress(includeTransfer?'환승 경로를 찾고 있습니다':'다른 직행 노선을 찾고 있습니다',()=>{
  revision++;button.disabled=false;$('otherSelection').textContent='추가 검색을 취소했습니다.'
 });
 button.disabled=true;
 try{
  const ids=new Map(session.entries);
  // Broader searches restore the original directional-stop expansion.
  // This additional network work is NEVER part of the initial fast result.
  const queried=new Set();
  async function addRoutesFor(stops){
   for(const selected of stops.slice(0,3)){
    const expanded=await expandDirectionalStops(selected);
    if(token!==revision)return;
    for(const stop of expanded){
     if(queried.has(stop.id))continue;
     queried.add(stop.id);
     const rows=await api('stop','getSttnThrghRouteList',{nodeid:stop.id});
     if(token!==revision)return;
     for(const x of rows)if(x.routeid)ids.set(String(x.routeid),String(x.routeno||'노선번호 없음'))
    }
   }
  }
  searchProgressStep(work,'동일 명칭·방향별 정류장을 추가 확인하고 있습니다…');
  await addRoutesFor(otherTrip.toCandidates.length?otherTrip.toCandidates:[otherTrip.to]);
  if(token!==revision)return;
  if(includeTransfer){
   searchProgressStep(work,'출발지 경유 노선을 확인하고 있습니다…');
   await addRoutesFor(otherTrip.fromCandidates.length?otherTrip.fromCandidates:[otherTrip.from]);
   if(token!==revision)return;
  }
  searchProgressStep(work,includeTransfer?'환승 가능한 노선들을 분석하고 있습니다…':'남은 직행 노선들을 분석하고 있습니다…');
  const all=[];
  for(const [id,no] of ids){
   if(token!==revision)return;
   let variants=session.checked.get(id);
   if(!variants){
    try{variants=await cachedDirectVariants(id,no);session.checked.set(id,variants)}
    catch(e){recordError(e,'추가 노선 검색');continue}
   }
   all.push(...variants.filter(r=>r.stops.length));
  }
  if(token!==revision)return;
  // Keep only direct routes in the fast/extra-direct mode. Transfer search
  // needs both origin and destination route families for one-stop transfers.
  otherTrip.routes=includeTransfer?all:matchingDirect(all);
  otherTrip.transferRequested=includeTransfer;
  session.entries=[...ids];
  $('otherSelection').textContent=includeTransfer?'환승 노선 분석 완료 · 실시간 정보 확인 중':'다른 직행 노선 분석 완료 · 실시간 정보 확인 중';
  searchProgressStep(work,'실시간 버스 도착정보를 확인하고 있습니다…');
  resetView();await refresh();
  if(token===revision&&includeTransfer)transferButton.disabled=true;
  if(token===revision&&!includeTransfer)moreDirectButton.disabled=true;
 }catch(e){if(token===revision){$('otherSelection').textContent='추가 검색 실패: '+e.message;recordError(e,'추가 검색')}}
 finally{endSearchProgress(work);if(token!==revision||includeTransfer&&!otherTrip.transferRequested)button.disabled=false}
}
moreDirectButton.onclick=()=>searchAdditionalRoutes(false);
transferButton.onclick=()=>searchAdditionalRoutes(true);
$('findOther').onclick=searchTrip;
// New manual searches start with empty inputs. Previous routes remain in Recent Search.

/* V1.2 smart recommendation: GPS + destination based direct-route candidates.
   Estimates are explicitly heuristic, not a pedestrian route or travel ETA. */
const smartState={to:null,toCandidates:[],results:[],request:0,showAll:false};
const smartRouteCache=new Map();
async function smartRouteVariants(id,no){
 const cache=smartRouteCache.get(id);
 if(cache&&Date.now()-cache.time<6*60*60*1000)return cache.promise;
 const promise=api('route','getRouteAcctoThrghSttnList',{routeId:id})
  .then(raw=>routeVariants(id,no,raw));
 smartRouteCache.set(id,{time:Date.now(),promise});
 try{return await promise}catch(error){smartRouteCache.delete(id);throw error}
}
function smartScore(walkMinutes,arrivalSeconds,stopsCount){
 if(!Number.isFinite(arrivalSeconds)||arrivalSeconds<0)return null;
 const arrivalMinutes=Math.ceil(arrivalSeconds/60);
 // A bus arriving before the traveller can walk to the stop is not catchable.
 if(arrivalMinutes<walkMinutes+2)return null;
 return Math.max(walkMinutes,arrivalMinutes)+stopsCount*2
}
function smartCandidates(routes,nearby,destinations){
 const map=new Map();
 const near=new Map(nearby.map(x=>[x.id,x]));
 for(const r of routes){
  for(let j=1;j<r.stops.length;j++){
   if(!destinations.some(d=>selectedMatches(r.stops[j],d)))continue;
   for(let i=0;i<j;i++){
    const board=near.get(r.stops[i].id);
    if(!board)continue;
    const key=r.id+'|'+(r.segment??'')+'|'+i+'|'+j;
    if(!map.has(key))map.set(key,{route:r,board,exit:r.stops[j],i,j,stopsCount:j-i,walkMinutes:Math.max(1,Math.ceil(board.distance/65))});
   }
  }
 }
 return [...map.values()].sort((a,b)=>a.walkMinutes-b.walkMinutes||a.stopsCount-b.stopsCount).slice(0,30)
}
function smartArrivalsFor(rows,route){
 const arrivals=arrivalsFor(rows,route.id);
 if(!route.direction)return arrivals;
 // If route and arrival specify directions, never attribute the opposite
 // direction's ETA to a recommended boarding stop.
 return arrivals.filter(x=>{
  const direction=x.updowncd??x.updowncode;
  return direction!=null&&String(direction)===route.direction
 })
}
function rankSmartCandidates(candidates,arrivalMap){
 const evaluated=candidates.map(c=>{
  const rows=arrivalMap.get(c.board.id)||[];
  const allArrivals=arrivalsFor(rows,c.route.id);
  const times=smartArrivalsFor(rows,c.route).map(x=>Number(x.arrtime)).filter(Number.isFinite);
  const usable=times.map(seconds=>({seconds,score:smartScore(c.walkMinutes,seconds,c.stopsCount)}))
   .find(x=>x.score!==null);
  return {...c,arrivalSeconds:usable?.seconds??null,estimate:usable?.score??null,arrivalKnown:allArrivals.length>0};
 });
 return evaluated.sort((a,b)=>{
  const va=a.estimate??Infinity,vb=b.estimate??Infinity;
  return va-vb||a.walkMinutes-b.walkMinutes||a.stopsCount-b.stopsCount||a.route.no.localeCompare(b.route.no,'ko',{numeric:true})
 })
}

/* V1.3: advisory leave time. Arrival time and walk time are estimates. */
function departureAdvice(etaSeconds,walkMinutes,bufferMinutes=2){
 if(!Number.isFinite(etaSeconds)||etaSeconds<0||!Number.isFinite(walkMinutes)||walkMinutes<0)return null;
 const etaMinutes=Math.ceil(etaSeconds/60),remaining=etaMinutes-walkMinutes-bufferMinutes;
 return {remaining,etaMinutes,walkMinutes,bufferMinutes,
  label:remaining>0?'약 '+remaining+'분 이내 출발 권장':remaining===0?'지금 출발 권장':'이 차량은 승차가 어려울 수 있음'};
}
function stopHasMapCoordinates(stop){
 return Number.isFinite(Number(stop?.lat))&&Number.isFinite(Number(stop?.lon))&&
  Number(stop.lat)>=33&&Number(stop.lat)<=39&&Number(stop.lon)>=124&&Number(stop.lon)<=132
}
// A map link always means walking from the phone's present location to
// the boarding stop. Never pass the bus route's alighting stop to Maps.
function attachWalkingMapLinks(host,board){
 const key=String(board?.id||'')+'|'+String(board?.lat||'')+'|'+String(board?.lon||'');
 if(host.dataset.walkingMapStop===key)return;
 host.replaceChildren();host.dataset.walkingMapStop=key;
 const urls=nativeMapUrls(board);
 if(!urls){host.append(el('span','탑승 정류장 좌표를 확인할 수 없습니다.','muted'));return}
 const app=el('a','정류장까지 도보 길찾기','mapAppLink');
 app.href=urls.naver;app.rel='noopener';
 app.setAttribute('aria-label','현재 위치에서 '+board.name+' 정류장까지 네이버지도 도보 길찾기');
 const web=el('a','정류장 위치 웹 보기','mapAppLink');
 web.href='https://map.naver.com/p/search/'+encodeURIComponent('청주시 '+(board.name||'버스 정류장'));
 web.target='_blank';web.rel='noopener noreferrer';
 host.append(app,web)
}
function nativeMapUrls(stop){
 if(!stopHasMapCoordinates(stop))return null;
 const lat=Number(stop.lat),lon=Number(stop.lon),title=encodeURIComponent(stop.name||'버스 정류장');
 const naver='nmap://route/walk?dlat='+lat+'&dlng='+lon+'&dname='+title+'&appname='+encodeURIComponent('https://doldolx2.github.io/JI_BUS/');
 const apple='maps://?daddr='+lat+','+lon+'&dirflg=w';
 return {naver,apple}
}
function attachMapLinks(host,stop){
 const urls=nativeMapUrls(stop);
 if(!urls){host.append(el('span','정류장 좌표가 없어 지도 앱으로 연결할 수 없습니다.','muted'));return}
 const wrap=el('div',undefined,'externalMaps');
 for(const [title,href] of [['네이버지도 앱',urls.naver],['Apple 지도 앱',urls.apple]]){
  const a=el('a',title);a.href=href;a.className='mapAppLink';a.rel='noopener';
  wrap.append(a)
 }
 host.append(wrap,el('p','설치된 지도 앱만 실행할 수 있습니다. 브라우저별로 실행 확인 창이나 미지원 안내가 나타날 수 있습니다.','muted'))
}
function smartStatus(message,failed=false){
 const host=$('smartStatus');host.textContent=message;host.className=failed?'error':'muted'
}
function showSmartResults(ranked,partial){
 const host=$('smartResults');host.replaceChildren();
 if(!ranked.length){showStopSearchState(host,'현재 위치 주변에서 목적지까지 연결되는 직행 노선을 확인하지 못했습니다. 직접 검색을 이용해 주세요.');return}
 const promising=ranked.filter(x=>x.estimate!==null),others=ranked.filter(x=>x.estimate===null);
 const unique=[],keys=new Set();
 for(const item of [...promising,...others]){
  const key=item.route.id+'|'+item.board.id;
  if(keys.has(key))continue;keys.add(key);unique.push(item);
  if(unique.length>=(smartState.showAll?5:1))break
 }
 unique.forEach((item,index)=>{
  const card=el('article',undefined,'smartCard');card.classList.add('compactSmartCard');
  const head=el('div',undefined,'smartCompactHead');
  const id=el('div',undefined,'smartCompactIdentity');
  id.append(el('span',index===0?'우선 추천':'추천 '+(index+1),'smartRouteBadge'),
   el('strong',item.route.no+'번'));
  const eta=el('strong',item.arrivalSeconds==null?'도착정보 없음':
   Math.ceil(item.arrivalSeconds/60)+'분 후','smartCompactEta');
  head.append(id,eta);card.append(head);
  const path=el('div',undefined,'smartPath');
  renderStopFlow(path,item.board.name,item.exit.name);card.append(path);
  const compact=el('p','도보 약 '+item.walkMinutes+'분 · '+item.stopsCount+
   '개 정류장'+(item.estimate==null?'':' · 참고 '+item.estimate+'분'),'smartCompactMeta');
  card.append(compact);
  const button=el('button','이 경로 보기','primary');button.type='button';
  button.onclick=()=>{
   setTrip(item.board,item.exit);
   rememberTrip(item.board,item.exit);
   fromControl.input.value=item.board.name;
   toControl.input.value=item.exit.name;
   // Retain the matched direction and direct route rather than re-searching.
   otherTrip.routes=[item.route];otherTrip.ready=true;
   $('otherSelection').textContent=item.route.no+'번 · '+item.board.name+' → '+item.exit.name;
   setSearchMode('manual');switchTab('search')
  };
  const detail=el('details',undefined,'smartDetails');
  detail.append(el('summary','경로 상세 · 지도'));
  detail.append(el('p',(directionLabel(item.route)||'운행방향 미표시')+
   ' · 도보 약 '+Math.round(item.board.distance)+'m','muted'));
  const metrics=el('div',undefined,'smartMetricRow');
  const metric=(caption,value)=>{
   const box=el('div',undefined,'smartMetric');
   box.append(el('span',caption),el('strong',value));return box
  };
  metrics.append(metric('도보','약 '+item.walkMinutes+'분'),
   metric('버스 도착',item.arrivalSeconds==null?'정보 없음':
    Math.ceil(item.arrivalSeconds/60)+'분 후'),
   metric('예상 합계',item.estimate==null?'확인 불가':'약 '+item.estimate+'분'));
  detail.append(metrics);
  const advice=departureAdvice(item.arrivalSeconds,item.walkMinutes);
  if(advice)detail.append(el('p',advice.label,'leaveAdvice'));
  detail.append(el('p','도보 및 이동시간은 추정치이며 실제 경로·소요시간과 다를 수 있습니다.','muted'));
  attachMapLinks(detail,item.board);

  card.append(detail,button);host.append(card)
 });
 if(partial)host.append(el('p','일부 정류장 도착정보를 확인하지 못해 추천 순위가 달라질 수 있습니다.','muted'));
 moreSmartButton.hidden=smartState.showAll
}
let searchMode='manual';
function setSearchMode(mode){
 const previous=searchMode;
 if(activeSearchProgress&&previous!==mode)cancelSearchProgress();
 searchMode=mode==='smart'?'smart':'manual';
 $('smartPanel').hidden=searchMode!=='smart';
 $('manualPanel').hidden=searchMode!=='manual';
 for(const b of document.querySelectorAll('[data-search-mode]')){
  b.classList.toggle('active',b.dataset.searchMode===searchMode);
  b.setAttribute('aria-pressed',String(b.dataset.searchMode===searchMode))
 }
 const visible=tab==='search'&&searchMode==='manual';
 $('heading').hidden=!visible;$('status').hidden=!visible;
 $('cards').hidden=!visible;
 if(previous!==searchMode){revision++;resetView();if(visible&&otherTrip.ready)refresh()}
}
const smartToControl=stopSearchControl($('smartToResults'),stops=>{
 smartState.to=stops[0];smartState.toCandidates=stops;moreSmartButton.hidden=true;
 ++smartState.request;$('smartResults').replaceChildren();
 smartStatus('목적지: '+stops[0].name+' · 현재 위치 기준 추천을 실행하세요.')
});
smartToControl.input.addEventListener('input',()=>{
 if(smartToControl.input.value.trim()===smartState.to?.name)return;
 smartState.to=null;smartState.toCandidates=[];moreSmartButton.hidden=true;
 ++smartState.request;$('smartResults').replaceChildren();
 smartStatus('목적지를 검색 결과에서 선택하세요.')
});
document.querySelectorAll('[data-search-mode]').forEach(b=>b.onclick=()=>setSearchMode(b.dataset.searchMode));
setSearchMode('smart');
const moreSmartButton=el('button','다른 직행 추천 검색');
moreSmartButton.type='button';
moreSmartButton.hidden=true;
$('smartPanel').append(moreSmartButton);
moreSmartButton.onclick=()=>runSmartSearch(true);
$('smartRecommend').onclick=()=>runSmartSearch(false);
function runSmartSearch(showAll=false){
 if(!smartState.to){smartStatus('목적지 정류장을 먼저 선택하세요.',true);return}
 if(!navigator.geolocation){smartStatus('GPS를 사용할 수 없습니다. 직접 검색을 이용해 주세요.',true);return}
 const token=++smartState.request,button=showAll?moreSmartButton:$('smartRecommend');
 smartState.showAll=showAll;
 if(!showAll)moreSmartButton.hidden=true;
 const work=beginSearchProgress('최적의 버스 경로를 찾고 있습니다',()=>{
  ++smartState.request;button.disabled=false;
  $('smartResults').replaceChildren();moreSmartButton.hidden=true;smartStatus('스마트 추천 검색을 취소했습니다.')
 });
 button.disabled=true;
 $('smartResults').replaceChildren();
 smartStatus('현재 GPS 위치 확인 중… 위치 권한을 허용해 주세요.');
 searchProgressStep(work,'현재 GPS 위치를 확인하고 있습니다. 위치 접근을 허용해 주세요.');
 navigator.geolocation.getCurrentPosition(async position=>{
  if(token!==smartState.request){endSearchProgress(work);button.disabled=false;return}
  try{
   const lat=position.coords.latitude,lon=position.coords.longitude;
   searchProgressStep(work,'주변 정류장과 목적지 경유노선을 분석하고 있습니다…');
   smartStatus('주변 정류장과 목적지 경유노선 분석 중…');
   const raw=await api('stop','getCrdntPrxmtSttnList',{gpsLati:String(lat),gpsLong:String(lon)});
   if(token!==smartState.request)return;
   const nearby=nearbyStops(raw,lat,lon).filter(s=>s.distance<=800).slice(0,10);
   if(!nearby.length){smartStatus('800m 이내 정류장을 찾지 못했습니다. 직접 검색을 이용해 주세요.',true);return}
   const destinations=smartState.toCandidates.length?smartState.toCandidates:[smartState.to];
   const routeIds=new Map();
   for(const dest of destinations.slice(0,3)){
    const items=await api('stop','getSttnThrghRouteList',{nodeid:dest.id});
    if(token!==smartState.request)return;
    for(const x of items)if(x.routeid)routeIds.set(String(x.routeid),String(x.routeno||'노선번호 없음'))
   }
   // Partial results must be labelled: cap route downloads to avoid API exhaustion.
   searchProgressStep(work,'이용 가능한 버스 노선과 운행 방향을 확인하고 있습니다…');
   const limited=[...routeIds].slice(0,showAll?20:12),variants=[];
   let candidates=[];
   for(let i=0;i<limited.length;i+=3){
    const batch=await Promise.allSettled(limited.slice(i,i+3).map(async([id,no])=>smartRouteVariants(id,no)));
    if(token!==smartState.request)return;
    for(const result of batch)if(result.status==='fulfilled')variants.push(...result.value);
    candidates=smartCandidates(variants,nearby,destinations);
    // Stop querying route details as soon as the first usable direct-route
    // candidates appear; exhaustive search is explicitly opt-in.
    if(!showAll&&candidates.length)break;
   }
   if(!candidates.length){
    smartStatus('초기 검색 범위에서 직행 경로를 찾지 못했습니다. 다른 직행 추천 검색을 선택할 수 있습니다.',true);
    moreSmartButton.hidden=showAll;
    return
   }
   searchProgressStep(work,'실시간 버스 도착정보를 확인하고 있습니다…');
   smartStatus('실시간 도착정보 조회 중…');
   const shortlist=[...new Set(candidates.slice(0,showAll?20:5).map(c=>c.board.id))].slice(0,showAll?6:2);
   const arrivalMap=new Map();let arrivalFailed=0;
   for(let i=0;i<shortlist.length;i+=3){
    const ids=shortlist.slice(i,i+3);
    const fetched=await Promise.allSettled(ids.map(id=>api('arrival','getSttnAcctoArvlPrearngeInfoList',{nodeId:id})));
    if(token!==smartState.request)return;
    fetched.forEach((result,index)=>{if(result.status==='fulfilled')arrivalMap.set(ids[index],result.value);else arrivalFailed++})
   }
   smartState.results=rankSmartCandidates(candidates,arrivalMap);
   globalThis.JIBusDiagnostics?.setCandidates(limited.length,candidates.length);
   globalThis.JIBusDiagnostics?.markFirstResult();
   showSmartResults(smartState.results,routeIds.size>limited.length||arrivalFailed>0);
   smartStatus((showAll?'추가 직행 추천':'우선 직행 추천')+' · 확인된 노선 '+smartState.results.length+'개 · 실제 도착정보 기준');
  }catch(error){
   if(token===smartState.request){smartStatus('추천 조회 실패: '+error.message,true);recordError(error,'스마트 추천');moreSmartButton.hidden=true}
  }finally{endSearchProgress(work);button.disabled=false}
 },error=>{
  if(token!==smartState.request)return;
  smartStatus(error.code===1?'위치 권한이 거부되었습니다. 위치 접근을 허용해 주세요.':error.code===2?'현재 위치를 확인할 수 없습니다.':'GPS 응답 시간이 초과되었습니다.',true);
  button.disabled=false;endSearchProgress(work)
 },{enableHighAccuracy:true,timeout:12000,maximumAge:60000})
};


/* V1.3 Build 06 — current-location weather with safe Cheongju fallback.
   GPS coordinates are ephemeral and never persisted to localStorage. */
const weatherCache={at:0,text:'',lat:null,lon:null,source:''};
const regionCache={at:0,lat:null,lon:null,label:''};
const WEATHER_TTL=20*60*1000;
const CHEONGJU_WEATHER={lat:36.6424,lon:127.4890};
let weatherPending=null;
function weatherDescription(code){
 if(code===0)return '맑음';
 if([1,2].includes(code))return '대체로 맑음';
 if(code===3)return '흐림';
 if([45,48].includes(code))return '안개';
 if([51,53,55,56,57].includes(code))return '이슬비';
 if([61,63,65,66,67,80,81,82].includes(code))return '비';
 if([71,73,75,77,85,86].includes(code))return '눈';
 if([95,96,99].includes(code))return '뇌우';
 return '정보 확인 중'
}
function usableWeatherPosition(position){
 const lat=Number(position?.coords?.latitude),lon=Number(position?.coords?.longitude);
 return position?.coords?.latitude!=null&&position?.coords?.longitude!=null
  &&Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180
}
function weatherNearSamePlace(a,b){
 if(a.lat==null||a.lon==null)return false;
 // About one kilometer within Korea; coarse enough not to refresh on GPS drift.
 const dlat=(a.lat-b.lat)*111000;
 const dlon=(a.lon-b.lon)*111000*Math.cos(b.lat*Math.PI/180);
 return Math.hypot(dlat,dlon)<1000
}
function weatherGeolocation(){
 return new Promise(resolve=>{
  if(!navigator.geolocation){resolve(null);return}
  let finished=false;
  const done=pos=>{if(!finished){finished=true;resolve(pos)}};
  try{
   navigator.geolocation.getCurrentPosition(
    position=>done(usableWeatherPosition(position)?{
     lat:Number(position.coords.latitude),lon:Number(position.coords.longitude)
    }:null),
    ()=>done(null),
    {enableHighAccuracy:false,timeout:8000,maximumAge:600000}
   )
  }catch(error){done(null)}
 })
}
function weatherRequestUrl(location){
 const params=new URLSearchParams({
  latitude:String(location.lat),longitude:String(location.lon),
  current:'temperature_2m,weather_code',timezone:'auto'
 });
 return 'https://api.open-meteo.com/v1/forecast?'+params.toString()
}
async function fetchWeatherAt(location){
 const kmaUrl=new URL(BUS_API_BASE+'/api/temperature');
 kmaUrl.search=new URLSearchParams({lat:String(location.lat),lon:String(location.lon)});
 // KMA T1H is the temperature source. Open-Meteo supplies the sky state
 // and is only used for temperature when KMA is unavailable.
 const openMeteo=fetch(weatherRequestUrl(location),{cache:'no-store'}).then(async response=>{
  if(!response.ok)throw Error('Open-Meteo HTTP '+response.status);
  const data=await response.json();
  const temp=Number(data?.current?.temperature_2m);
  const code=Number(data?.current?.weather_code);
  if(data?.current?.temperature_2m==null||!Number.isFinite(temp))throw Error('Open-Meteo 기온 없음');
  return {temp,code}
 });
 const kma=fetch(kmaUrl,{cache:'no-store'}).then(async response=>{
  if(!response.ok)throw Error('기상청 HTTP '+response.status);
  const data=await response.json();
  const value=Number(data?.temperature);
  if(data?.source!=='KMA'||data.temperature==null||!Number.isFinite(value))throw Error('기상청 기온 없음');
  if(!/^\d{8}$/.test(data.baseDate)||!/^\d{4}$/.test(data.baseTime))throw Error('기상청 기준시각 없음');
  const base=data.baseDate,clock=data.baseTime;
  const observation=new Date(base.slice(0,4)+'-'+base.slice(4,6)+'-'+base.slice(6,8)+'T'+clock.slice(0,2)+':'+clock.slice(2,4)+':00+09:00');
  const age=Date.now()-observation.getTime();
  if(!Number.isFinite(age)||age< -10*60*1000||age>3*60*60*1000)throw Error('기상청 관측시각 경과');
  return {temp:value,baseDate:base,baseTime:clock}
 });
 const [kmaResult,skyResult]=await Promise.allSettled([kma,openMeteo]);
 if(kmaResult.status==='rejected')recordError(kmaResult.reason,'기상청 기온');
 if(skyResult.status==='rejected')recordError(skyResult.reason,'Open-Meteo 날씨');
 if(kmaResult.status==='rejected'&&skyResult.status==='rejected')
  throw Error('기상청과 대체 날씨 조회 모두 실패했습니다.');
 const primary=kmaResult.status==='fulfilled';
 const temp=primary?kmaResult.value.temp:skyResult.value.temp;
 const sky=skyResult.status==='fulfilled'?skyResult.value.code:NaN;
 const source=primary?'기상청':'Open-Meteo 대체';
 const skyLabel=Number.isFinite(sky)?weatherDescription(sky):'날씨 상태 확인 중';
 const label=Math.round(temp)+'°C · '+skyLabel;
 const detail=primary
  ?kmaResult.value.baseDate.slice(4,6)+'/'+kmaResult.value.baseDate.slice(6,8)+' '+kmaResult.value.baseTime.slice(0,2)+':'+kmaResult.value.baseTime.slice(2,4)+' 관측'
  :'기상청 조회 실패 · 대체 자료';
 return {label,source,detail}
}
function showWeatherSource(result){
 const element=$('weatherObservation');
 if(element)element.textContent=result.source+' 기온 · '+result.detail
}

/* Browser-side city/suburb lookup; the caller's GPS coordinates are sent
   to BigDataCloud only when GPS access was granted. Neither the returned
   address nor the coordinates are persisted. */
function regionNameFromGeocode(data){
 if(!data||typeof data!=='object')return '';
 const clean=value=>{
  if(typeof value!=='string')return '';
  // '오창대읍' describes the 4th-grade administrative office status,
  // whereas the legal locality name remains '오창읍'.
  return value.trim().replace(/\s+/g,' ').replace(/오창대읍/g,'오창읍')
 };
 const city=clean(data.city),locality=clean(data.locality);
 const subdivision=clean(data.principalSubdivision);
 const administrative=Array.isArray(data.localityInfo?.administrative)?
  data.localityInfo.administrative.map(x=>clean(x?.name)):[];
 const district=administrative.find(x=>/구$/.test(x)&&x!==city&&x!==subdivision)||'';
 const names=[];
 for(const part of [city||subdivision,district,locality]){
  if(!part)continue;
  if(names.some(x=>x===part||x.endsWith(part)||part.endsWith(x)))continue;
  names.push(part)
 }
 return names.join(' ')
}
async function resolveWeatherRegion(location){
 if(regionCache.label&&Date.now()-regionCache.at<WEATHER_TTL&&
    weatherNearSamePlace(regionCache,location))return regionCache.label;
 const params=new URLSearchParams({
  latitude:String(location.lat),
  longitude:String(location.lon),
  localityLanguage:'ko'
 });
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),7000);
 try{
  const response=await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?'+params.toString(),{
   signal:controller.signal,cache:'no-store'
  });
  if(!response.ok)throw Error('지역명 HTTP '+response.status);
  const data=await response.json();
  const label=regionNameFromGeocode(data);
  if(!label)throw Error('지역명을 확인할 수 없습니다.');
  regionCache.at=Date.now();
  regionCache.lat=location.lat;regionCache.lon=location.lon;
  regionCache.label=label;
  return label
 }finally{clearTimeout(timeout)}
}
function showWeatherRegion(label){
 const element=$('weatherRegion');
 if(element)element.textContent='⌖ '+label
}
async function loadCheongjuWeather(){
 const host=$('weatherNow');
 if(!host)return;
 // Weather and neighbourhood lookups are independent so a failed
 // geocoder never hides a valid GPS-based weather result.
 if(weatherPending)return weatherPending;
 weatherPending=(async()=>{
  const gps=await weatherGeolocation();
  const location=gps||CHEONGJU_WEATHER;
  const source=gps?'gps':'city';
  if(!gps)showWeatherRegion('청주시 기준');
  else{
   const prior=regionCache.label&&weatherNearSamePlace(regionCache,location)?regionCache.label:'';
   showWeatherRegion(prior||'지역 확인 중…')
  }
  let fallbackWeather=false;
  const regionTask=gps?resolveWeatherRegion(location).then(label=>{
   if(!fallbackWeather)showWeatherRegion(label)
  }).catch(error=>{
   recordError(error,'지역명 조회');
   if(!fallbackWeather)showWeatherRegion('위치 확인됨 · 지역명 미확인')
  }):Promise.resolve();
  if(weatherCache.text&&weatherCache.source===source&&Date.now()-weatherCache.at<WEATHER_TTL
   &&weatherNearSamePlace(weatherCache,location)){
   host.textContent=weatherCache.text;
   if(weatherCache.detail)showWeatherSource(weatherCache.detail);
   await regionTask;return
  }
  host.textContent='날씨 조회 중…';
  try{
   const result=await fetchWeatherAt(location);
   weatherCache.at=Date.now();weatherCache.text=result.label;
   weatherCache.lat=location.lat;weatherCache.lon=location.lon;
   weatherCache.source=source;weatherCache.detail=result;host.textContent=result.label;showWeatherSource(result)
  }catch(error){
   if(gps){
    try{
     const fallback=await fetchWeatherAt(CHEONGJU_WEATHER);
     weatherCache.at=Date.now();weatherCache.text=fallback.label;
     weatherCache.lat=CHEONGJU_WEATHER.lat;weatherCache.lon=CHEONGJU_WEATHER.lon;
     weatherCache.source='city';weatherCache.detail=fallback;host.textContent=fallback.label;showWeatherSource(fallback);
     fallbackWeather=true;showWeatherRegion('청주시 기준');
     await regionTask;return
    }catch(fallbackError){recordError(fallbackError,'날씨 정보')}
   }
   host.textContent='날씨 조회 불가';recordError(error,'날씨 정보')
  }
  await regionTask
 })();
 try{await weatherPending}finally{weatherPending=null}
}
renderRecentTrips();
loadCheongjuWeather();
setInterval(()=>{if(!document.hidden)loadCheongjuWeather()},WEATHER_TTL);
/* Dashboard fast actions use the existing route controllers, never a separate router. */
document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>{
 const target=b.dataset.quick;
 if(target==='favorites'){switchTab('favorites');return}
 if(target==='smart'||target==='manual'){
  setSearchMode(target);switchTab('search');return
 }
 if(target==='nearby'){
  setSearchMode('manual');switchTab('search');
  $('nearbyFrom').click()
 }
});
function updateDashboardClock(){
 const date=new Date();
 const clock=$('clockNow'),today=$('todayDate');
 if(clock)clock.textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
 if(today)today.textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'short'}).format(date);
}
updateDashboardClock();
setInterval(updateDashboardClock,30000);
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
// The header refresh is global. Only manual routes use the 15-second route refresh.
$('refresh').onclick=()=>{
 resetFailures();
 if(tab==='search'&&searchMode==='manual'){
  if(otherTrip.ready)refresh();
  else $('otherSelection').textContent='출발·도착 정류장을 선택하고 노선 찾기를 눌러주세요.';
 }else if(tab==='search'&&searchMode==='smart'){
  if(smartState.to)$('smartRecommend').click();
  else smartStatus('목적지 정류장을 선택한 후 추천받기를 눌러주세요.');
 }else if(tab==='home'){
  updateDashboardClock();
  weatherCache.at=0;
  loadCheongjuWeather();
  renderRecentTrips();
 }else if(tab==='favorites')renderFavorites();
 else $('settingsStatus').textContent='현재 설정 정보가 표시되어 있습니다.';
};
setInterval(()=>{if(!document.hidden&&retryTimer===null&&!authBlocked)refresh()},15000);
setInterval(()=>{if(!document.hidden){const now=Date.now();document.querySelectorAll('[data-eta]').forEach(e=>tickEta(e,now))}},1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearRetry();else{resetFailures();refresh()}});
switchTab('home');
