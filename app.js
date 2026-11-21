'use strict';
const $=id=>document.getElementById(id);
const store='ji-bus-v1';
let cfg={key:'',stops:{},favorites:[],routes:[],last:''};
try{cfg={...cfg,...JSON.parse(localStorage.getItem(store)||'{}')}}catch{}
let tab='work',busy=false,revision=0;
let retryCount=0,retryTimer=null,requestEpoch=0,authBlocked=false;
const logErrors=[];
const save=()=>localStorage.setItem(store,JSON.stringify(cfg));
const arr=v=>Array.isArray(v)?v:v&&typeof v==='object'?[v]:[];
const el=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e};
const status=(s,err=false)=>{const e=$(tab==='settings'?'settingsStatus':'status')||$('status');e.textContent=s;e.className=err?'error':'muted'};
const recordError=(e,context)=>{logErrors.push({at:Date.now(),context,reason:String(e.message||e).slice(0,160)});if(logErrors.length>20)logErrors.shift()};
const clearRetry=()=>{if(retryTimer!==null)clearTimeout(retryTimer);retryTimer=null};
function failureClass(e){const code=Number(e?.status);if([401,403].includes(code)||String(e?.message).includes('인증키')||String(e?.message).includes('SERVICE_KEY'))return 'auth';if(code===429)return 'limit';return 'transient'}
function planRetry(e){recordError(e,'실시간 조회');const type=failureClass(e);if(type==='auth'){authBlocked=true;clearRetry();return '인증/승인 오류 · 환경설정을 확인하세요'}
 retryCount++;const delay=type==='limit'?60000:retryCount===1?5000:retryCount===2?15000:Math.min(60000,30000*Math.pow(2,Math.max(0,retryCount-3)));clearRetry();
 retryTimer=setTimeout(()=>{retryTimer=null;if(!document.hidden&&tab!=='settings')refresh()},delay);return '자동 재시도 '+Math.round(delay/1000)+'초 후';
}
function resetFailures(){retryCount=0;authBlocked=false;clearRetry()}

const services={stop:'BusSttnInfoInqireService',route:'BusRouteInfoInqireService',arrival:'ArvlInfoInqireService',location:'BusLcInfoInqireService'};
async function api(service,method,params={}){
 if(!cfg.key)throw Error('환경설정에서 인증키를 입력하세요.');
 let u=new URL('https://apis.data.go.kr/1613000/'+services[service]+'/'+method);
 u.search=new URLSearchParams({serviceKey:cfg.key,cityCode:'33010',_type:'json',numOfRows:'1000',pageNo:'1',...params});
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);let res;try{res=await fetch(u,{signal:controller.signal,cache:'no-store'})}finally{clearTimeout(timer)};if(!res.ok){const e=Error('API HTTP '+res.status+' — 인증키 및 활용 승인 확인');e.status=res.status;throw e}
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
function stopSearchControl(container,onChoose){
 const input=el('input'),results=el('div',undefined,'results');input.placeholder='정류장 이름 또는 일부 입력';input.setAttribute('aria-label','정류장 이름 검색');container.append(input,results);
 let timer=0,serial=0;
 input.addEventListener('input',()=>{clearTimeout(timer);const token=++serial;results.replaceChildren();const q=input.value.trim();if(!q)return;timer=setTimeout(async()=>{try{const groups=groupStops(await findStops(q));if(token!==serial)return;
 for(const g of groups){const b=el('button',g.name+(g.stops.length>1?' · '+g.stops.length+'개 위치':''));b.type='button';b.onclick=()=>{onChoose(g.stops);input.value=g.name;results.replaceChildren()};results.append(b)}if(!groups.length)results.append(el('p','일치하는 정류장 없음 · 일부 명칭으로 다시 검색하세요','muted'))
 }catch(e){if(token===serial)results.append(el('p','검색 실패: '+e.message,'error'))}},300)});
 return {input,results};
}

function showSaved(){
 const labels={board:'출근 승차',exit:'출근 하차',alt:'출근 대체',home:'귀가 하차'};
 $('saved').replaceChildren(...Object.entries(labels).map(([k,v])=>el('p',v+' · '+(cfg.stops[k]?name(cfg.stops[k]):'미설정'))));
 for(const s of cfg.favorites){const p=el('p','즐겨찾기 · '+name(s)+' '),b=el('button','삭제');b.onclick=()=>{cfg.favorites=cfg.favorites.filter(x=>x.id!==s.id);save();showSaved()};p.append(b);$('saved').append(p)}
}
function pairs(stops,a,b){let out=[];for(let i=0;i<stops.length;i++)if(stops[i].id===a)for(let j=i+1;j<stops.length;j++)if(stops[j].id===b){out.push({i,j});break}return out}
let extraHomeStops=[]; const transferCache=new Map();
const otherTrip={from:null,to:null,routes:[],ready:false};
function homeCandidates(){let m=new Map([...cfg.favorites,...extraHomeStops].filter(s=>s.id!==cfg.stops.home?.id).map(s=>[s.id,s]));for(const r of cfg.routes)for(let j=0;j<r.stops.length;j++)if(r.stops[j].id===cfg.stops.home?.id)for(let i=0;i<j;i++)if(r.stops[i].id!==cfg.stops.home.id)m.set(r.stops[i].id,r.stops[i]);return [...m.values()]}
function populateHome(order){let list=order||homeCandidates().sort((a,b)=>Number(cfg.favorites.some(x=>x.id===b.id))-Number(cfg.favorites.some(x=>x.id===a.id))||a.name.localeCompare(b.name,'ko'));$('homeStop').replaceChildren(new Option('탑승 정류장 선택',''),...list.map(s=>new Option(name(s)+(s.distance!=null?' · '+Math.round(s.distance)+'m':''),s.id)));$('homeStop').value=cfg.last}
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
function routesFor(){let out=[];for(const r of (tab==='other'?otherTrip.routes:cfg.routes)){
 const a=tab==='work'?cfg.stops.board:tab==='home'?homeCandidates().find(s=>s.id===cfg.last):otherTrip.from;
 const targets=tab==='work'?[cfg.stops.exit,cfg.stops.alt]:tab==='home'?[cfg.stops.home]:[otherTrip.to];
 for(const b of targets.filter(Boolean))for(const p of stopPairs(r.stops,a,b))out.push({...r,...p})
 }return out}
function switchTab(t){clearRetry();retryCount=0;tab=t;revision++;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));$('settings').hidden=t!=='settings';$('homePanel').hidden=t!=='home';$('otherPanel').hidden=t!=='other';$('heading').hidden=t==='settings';resetView();$('heading').dataset.heading='';if(t==='settings'){showSaved();status('')}else{if(t==='home')populateHome();if(t==='other'&&!otherTrip.ready){$('heading').replaceChildren(el('h2','기타 경로 검색'),el('p','출발·도착 정류장 선택 후 노선 찾기','muted'));status('');return}refresh()}}
// Build 08: persistent, keyed cards and vehicle markers.
let lastGood=0, viewRevision=-1, autoOpened=false;
const routeKey=r=>r.id+':'+r.i+':'+r.j;
const liveCards=new Map();
const locationCache=new Map();
const routeInfoCache=new Map();
function resetView(){liveCards.clear();locationCache.clear();lastGood=0;autoOpened=false;viewRevision=revision;$('cards').replaceChildren()}
function vehicleIndex(r,v){const matches=r.stops.map((s,i)=>s.id===String(v.nodeid)?i:-1).filter(i=>i>=0);const exact=matches.find(i=>r.stops[i].order===Number(v.nodeord));return exact!==undefined?exact:matches.length===1?matches[0]:-1}
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
  let suffix=role==='transfer'?' · 환승':i===r.i?' · 승차':i===r.j?' · 하차':role==='current'?' · 현재':'';
  const text=r.stops[i].name+suffix;if(cell.label.textContent!==text)cell.label.textContent=text
 }
 let info=primary?'최근 확인 위치 · '+r.stops[primary.i].name+' · '+(r.i-primary.i)+'정류장 전':'탑승 방향 차량 위치 미확인';
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
function timeLabel(raw){let x=String(raw??'').trim();if(/^\\d{3,4}$/.test(x)){x=x.padStart(4,'0');return x.slice(0,2)+':'+x.slice(2)}if(/^\\d{1,2}:\\d{2}$/.test(x))return x;return ''}
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
function directCard(r,a,location,first,at,info){
 const key='direct:'+routeKey(r),o=ensureCard(key,r.no),av=arrivalsFor(a,r.id),v=av[0];
 textTo(o.path,r.stops[r.i].name+' → '+r.stops[r.j].name);
 textTo(o.meta,v?'남은 정류장 '+(v.arrprevstationcnt??'미제공')+' · 다음 차량 '+(av[1]?Math.ceil(Number(av[1].arrtime)/60)+'분 후':'정보 없음'):'현재 도착 예정 차량 없음');textTo(o.schedule,v?'':operatingText(info));
 textTo(o.flag,(first&&v?'가장 먼저 도착 · ':'')+(tab==='work'&&selectedMatches(r.stops[r.j],cfg.stops.alt)?'대체 경로 · 도보':'기본 경로'));
 setEta(o.eta,v?.arrtime,at);
 if(!o.timeline){o.timeline=makeTimeline(r);o.details.append(o.timeline.wrap)}
 updateTimeline(o.timeline,r,location.v,location.e||'');
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
  for(const second of byStop.get(id)||[]){if(second.id===r.id)continue;let first={...r,i,j},count=j-i+second.j-second.i,key=r.id+'|'+second.id+'|'+id;
   if(!found.has(key)||found.get(key).count>count)found.set(key,{first,second,count,stop:r.stops[j],key})
  }
 }
 return [...found.values()].sort((a,b)=>a.count-b.count||a.key.localeCompare(b.key))
}
async function loadFirstRoutes(origin){
 let hit=transferCache.get(origin);if(hit&&Date.now()-hit.time<600000)return hit.routes;
 const rows=await api('stop','getSttnThrghRouteList',{nodeid:origin}), ids=new Map();
 for(const x of rows)if(x.routeid)ids.set(String(x.routeid),String(x.routeno));
 let routes=[];
 for(const [id,no] of ids){let r=cfg.routes.find(r=>r.id===id);if(!r){let stops=(await api('route','getRouteAcctoThrghSttnList',{routeId:id})).map(x=>({...node(x),order:Number(x.nodeord)})).filter(x=>x.id&&Number.isFinite(x.order)).sort((a,b)=>a.order-b.order);r={id,no,stops}}if(r.stops.length)routes.push(r)}
 transferCache.set(origin,{time:Date.now(),routes});return routes;
}
const arrivalsFor=(rows,id)=>rows.filter(x=>String(x.routeid)===id&&x.arrtime!=null&&Number.isFinite(Number(x.arrtime))&&Number(x.arrtime)>=0).sort((a,b)=>Number(a.arrtime)-Number(b.arrtime));
function etaText(rows,id){let a=arrivalsFor(rows,id)[0];return a?(Number(a.arrtime)===0?'도착 예정':Math.ceil(Number(a.arrtime)/60)+'분 후'):'도착정보 없음'}
async function showTransfers(origin,arrivalRows,rev,at){
 const firstRoutes=tab==='other'?otherTrip.routes:await loadFirstRoutes(origin);if(rev!==revision)return [];
 const paths=tab==='other'?transferPaths(otherTrip.routes,otherTrip.routes,otherTrip.from,otherTrip.to):transferPaths(firstRoutes,cfg.routes,origin,cfg.stops.home.id);
 const score=p=>Number(arrivalsFor(arrivalRows,p.first.id)[0]?.arrtime??Infinity);
 paths.sort((a,b)=>Number.isFinite(score(a))!==Number.isFinite(score(b))?(Number.isFinite(score(a))?-1:1):(score(a)-score(b)||a.count-b.count));
 const seen=new Set(),top=[];for(const p of paths){let k=p.first.id+'|'+p.second.id;if(seen.has(k))continue;seen.add(k);top.push(p);if(top.length===3)break}
 const ats=new Map(),loc=new Map();
 for(const p of top){if(!ats.has(p.stop.id)){try{const rows=await api('arrival','getSttnAcctoArvlPrearngeInfoList',{nodeId:p.stop.id});ats.set(p.stop.id,{rows,at:Date.now()})}catch(e){ats.set(p.stop.id,{rows:[],error:e.message})}}
  for(const r of [p.first,p.second])if(!loc.has(r.id))loc.set(r.id,await fetchLocation(r.id))
 }
 if(rev!==revision)return [];
 const keys=[];
 for(const p of top){
  const key='transfer:'+p.key,o=ensureCard(key,p.first.no+' → '+p.second.no,true),second=ats.get(p.stop.id);
  keys.push(key);textTo(o.path,p.first.stops[p.first.i].name+' → '+p.stop.name+' → '+p.second.stops[p.second.j].name);
  textTo(o.meta,'환승 1회 · '+p.count+'개 구간 · 동일 정류장 환승');
  textTo(o.flag,'환승 성립 및 최종 도착시간 미확정');
  setEta(o.eta,arrivalsFor(arrivalRows,p.first.id)[0]?.arrtime,at);
  textTo(o.summary,'두 차량 위치 · 현재 기준');
  if(!o.legs.length){for(let i=0;i<2;i++){const d=el('details'),s=el('summary'),v=el('span',undefined,'legEta'),t=makeTimeline(i?p.second:p.first);d.append(s,v,t.wrap);o.details.append(d);o.legs.push({d,s,v,t})}}
  for(const [i,r] of [p.first,p.second].entries()){const leg=o.legs[i],l=loc.get(r.id);textTo(leg.s,(i+1)+'구간 · '+r.no+'번 · '+r.stops[r.i].name+' 승차');
   setEta(leg.v,i?arrivalsFor(second.rows,r.id)[0]?.arrtime:arrivalsFor(arrivalRows,r.id)[0]?.arrtime,i?second.at:at);
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
 if(tab==='settings'||busy||document.hidden||authBlocked)return;
 if(viewRevision!==revision)resetView();
 const rev=revision,list=routesFor(), heading=tab==='work'?(cfg.stops.board?.name||'승차 정류장 미설정')+' → '+(cfg.stops.exit?.name||'하차 정류장 미설정'):tab==='home'?(cfg.stops.home?.name||'귀가 목적지 미설정')+' 방면':(otherTrip.from?.name||'출발 미선택')+' → '+(otherTrip.to?.name||'도착 미선택');
 if($('heading').dataset.heading!==heading){$('heading').replaceChildren(el('h2',tab==='work'?'출근':tab==='home'?'귀가':'기타'),el('p',heading));$('heading').dataset.heading=heading}
 if(!list.length&&!((tab==='home'&&cfg.last&&cfg.stops.home&&cfg.routes.length)||(tab==='other'&&otherTrip.ready))){arrangeCards([]);status(tab==='home'&&cfg.routes.length&&!cfg.last?'귀가 탑승 정류장을 선택하세요.':tab==='other'?'출발·도착 정류장을 선택하고 노선 찾기를 누르세요.':'이용 가능한 노선이 없습니다. 환경설정의 정류장 방향과 노선 구성을 확인하세요.');return}
 busy=true;$('refresh').classList.add('refreshing');$('refresh').setAttribute('aria-busy','true');
 if(!lastGood)status('실시간 조회 중…');
 try{
  const at=Date.now(), arrivalsByStop=new Map(), arrivalErrors=[];
  const stopIds=[...new Set(list.map(r=>r.stops[r.i].id))];
  if(!stopIds.length&&tab==='home'&&cfg.last)stopIds.push(cfg.last);
  if(!stopIds.length&&tab==='other'&&otherTrip.from)stopIds.push(otherTrip.from.id);
  for(const id of stopIds){try{arrivalsByStop.set(id,await api('arrival','getSttnAcctoArvlPrearngeInfoList',{nodeId:id}))}catch(e){arrivalErrors.push(e);recordError(e,'정류장 조회')}}
  if(!arrivalsByStop.size&&arrivalErrors.length)throw arrivalErrors[0];
  const rowsFor=r=>arrivalsByStop.get(r.stops[r.i].id)||[];
  if(rev!==revision)return;
  const loc=new Map();for(const id of new Set(list.map(r=>r.id))){if(rev!==revision)return;loc.set(id,await fetchLocation(id))}
  if(rev!==revision)return;
  const score=r=>Number(arrivalsFor(rowsFor(r),r.id)[0]?.arrtime??Infinity);
  list.sort((x,y)=>score(x)-score(y)||x.no.localeCompare(y.no,'ko',{numeric:true}));
  const metas=new Map();for(const r of list)if(!arrivalsFor(rowsFor(r),r.id).length&&!metas.has(r.id))metas.set(r.id,await getRouteInfo(r.id));
  if(rev!==revision)return;
  const keys=list.map((r,i)=>directCard(r,rowsFor(r),loc.get(r.id),i===0,at,metas.get(r.id)));
  let transferError='';
  if((tab==='home'||tab==='other')&&!list.some(r=>arrivalsFor(rowsFor(r),r.id).length)){
   try{const origin=tab==='home'?cfg.last:otherTrip.from.id;keys.push(...await showTransfers(origin,arrivalsByStop.get(origin)||[],rev,at))}catch(e){transferError='환승 조회 지연 · '+e.message;keys.push(...[...liveCards.keys()].filter(k=>k.startsWith('transfer:')))}
  }
  if(rev!==revision)return;
  arrangeCards(keys);
  if(!autoOpened&&keys.length){const preferred=keys.find(k=>k.startsWith('direct:')&&liveCards.get(k).eta.dataset.eta)||keys.find(k=>k.startsWith('transfer:'))||keys[0];liveCards.get(preferred).details.open=true;autoOpened=true}
  lastGood=at;resetFailures();const partial=[...loc.values()].some(l=>l.e)||arrivalErrors.length>0;
  status('갱신 '+new Date(lastGood).toLocaleTimeString('ko-KR')+(partial?' · 일부 위치 지연':'')+(transferError?' · '+transferError:!keys.length?' · 연결 경로 없음':''),!!transferError||partial);
 }catch(e){if(rev===revision){const retry=planRetry(e);status((lastGood?'조회 지연 · 마지막 정상 수신 '+new Date(lastGood).toLocaleTimeString('ko-KR'):'조회 실패')+' · '+retry,true)}}
 finally{busy=false;$('refresh').classList.remove('refreshing');$('refresh').removeAttribute('aria-busy');if(rev!==revision&&tab!=='settings')refresh()}
}
$('key').value=cfg.key;
const keyFeedback=el('p');keyFeedback.setAttribute('role','status');keyFeedback.setAttribute('aria-live','polite');$('saveKey').after(keyFeedback);
function keyMessage(t,error=false){keyFeedback.textContent=t;keyFeedback.className=error?'error':'muted';}
if(cfg.key)keyMessage('인증키 저장됨 · 다시 입력할 필요 없습니다');
const toggle=el('button','인증키 보기');toggle.type='button';$('saveKey').before(toggle);toggle.onclick=()=>{const k=$('key');k.type=k.type==='password'?'text':'password';toggle.textContent=k.type==='password'?'인증키 보기':'인증키 숨기기'};
const backup=el('button','설정 백업'),restore=el('button','설정 복원'),restoreInput=el('input');restoreInput.type='file';restoreInput.accept='.json,application/json';restoreInput.hidden=true;
const backupPanel=el('div');backupPanel.append(el('h2','설정 백업 및 복원'),el('p','백업에는 인증키와 개인 정류장 정보가 포함됩니다. 외부에 공유하지 마세요.','muted'),backup,restore,restoreInput);$('settings').append(backupPanel);
backup.onclick=()=>{try{const blob=new Blob([JSON.stringify({format:'JI_BUS_SETTINGS_V1',settings:cfg},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='JI_BUS_settings.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('백업 파일 다운로드 요청 완료')}catch(e){status('백업 실패: '+e.message,true)}};
restore.onclick=()=>restoreInput.click();
const validStop=s=>s&&typeof s.id==='string'&&s.id.length>0&&typeof s.name==='string';
function validateBackup(data){const s=data?.settings;if(data?.format!=='JI_BUS_SETTINGS_V1'||!s||typeof s.key!=='string'||!s.stops||typeof s.stops!=='object'||!Array.isArray(s.favorites)||!s.favorites.every(validStop)||!Array.isArray(s.routes)||!Object.values(s.stops).every(validStop)||!s.routes.every(r=>typeof r.id==='string'&&typeof r.no==='string'&&Array.isArray(r.stops)&&r.stops.every(n=>validStop(n)&&Number.isFinite(n.order)))||typeof s.last!=='string')throw Error('지원하지 않는 백업 형식');return {key:s.key,stops:s.stops,favorites:s.favorites,routes:s.routes,last:s.last,...(Number.isFinite(s.routesBuiltAt)?{routesBuiltAt:s.routesBuiltAt}:{})}}
restoreInput.onchange=async()=>{try{const file=restoreInput.files[0];if(!file)return;if(file.size>10000000)throw Error('백업 파일 크기 초과');const next=validateBackup(JSON.parse(await file.text()));if(!confirm('현재 설정을 백업 내용으로 교체할까요?'))return;localStorage.setItem(store,JSON.stringify(next));cfg=next;transferCache.clear();extraHomeStops=[];revision++;$('key').value=cfg.key;showSaved();if(cfg.routes.length)routeReport(cfg.routes);else $('routeReport').replaceChildren();populateHome();keyMessage(cfg.key?'인증키 복원 완료 · 연결 확인 필요':'인증키 미설정');status('설정 복원 완료')}catch(e){status('복원 실패: '+e.message,true)}finally{restoreInput.value=''}};

$('saveKey').onclick=async()=>{
 const btn=$('saveKey'),key=$('key').value.trim();if(!key){keyMessage('일반 인증키(Decoding)를 입력하세요.',true);return}
 btn.disabled=true;btn.textContent='연결 확인 중…';keyMessage('인증키 저장 및 API 연결 확인 중…');
 try{cfg.key=key;resetFailures();save();keyMessage('인증키 저장 완료 · API 연결 확인 중…');
 await api('arrival','getCtyCodeList');keyMessage('인증키 저장 완료 · 버스도착정보 API 연결 성공. 아래에서 정류장을 검색하세요.');
 }catch(e){keyMessage('처리 실패 또는 연결 미확인: '+(['TimeoutError','AbortError'].includes(e.name)?'응답 시간 초과':e.message)+'. 활용 승인 및 인증키를 확인하세요.',true)}
 finally{btn.disabled=false;btn.textContent='인증키 저장 및 확인'}
};
$('search').onclick=async()=>{let q=$('query').value.trim();if(!q){status('정류장 이름을 입력하세요.',true);return}try{status('정류장 검색 중…');let groups=groupStops(await findStops(q));$('searchResults').replaceChildren();
 for(const g of groups){const b=el('button',g.name+(g.stops.length>1?' · '+g.stops.length+'개 후보':''));b.onclick=()=>{let t=$('target').value;if(t==='favorite'){for(const s of g.stops)if(!cfg.favorites.some(x=>x.id===s.id))cfg.favorites.push(s)}else{cfg.stops[t]=g.stops[0];cfg.routes=[];delete cfg.routesBuiltAt;cfg.last='';$('routeReport').replaceChildren()}save();showSaved();status('정류장 저장 · '+g.name+(g.stops.length>1?' (방향은 노선 구성에서 자동 판단 예정)':''))};$('searchResults').append(b)}
 status(groups.length+'개 정류장 이름 검색 결과')}catch(e){status(e.message,true)}
};
function routeReport(routes,notes=[]){
 const out=el('div',undefined,'routeResult');
 const work=routes.filter(r=>[cfg.stops.exit,cfg.stops.alt].filter(Boolean).some(b=>stopPairs(r.stops,cfg.stops.board,b).length));
 const home=routes.filter(r=>r.stops.some((s,i)=>i>0&&selectedMatches(s,cfg.stops.home)));

 const failed=notes.length>0||!work.length||!home.length;
 out.append(el('p',notes.length?'노선 구성 실패 · 기존 노선 유지':failed?'일부 연결 노선 없음':'노선 구성 완료',failed?'routeWarning':'routeSuccess'));
 out.append(el('p','출근 '+work.length+'개 노선 · 귀가 '+home.length+'개 노선','muted'));
 if(cfg.routesBuiltAt&&Number.isFinite(cfg.routesBuiltAt))out.append(el('p','마지막 정상 구성 · '+new Date(cfg.routesBuiltAt).toLocaleString('ko-KR'),'muted'));
 if(failed){
  const d=el('details',undefined,'routeDiagnostics');d.append(el('summary','상세 진단 정보'));
  for(const note of notes)d.append(el('p',note,'error'));
  for(const [k,label] of [['board','출근 승차'],['exit','출근 하차'],['alt','출근 대체'],['home','귀가 하차']]){const s=cfg.stops[k];d.append(el('p',label+' · '+(s?name(s)+' / '+s.id:'미설정'),'muted'))}
  for(const r of routes){const detail=el('details');detail.append(el('summary',r.no+'번 · '+r.stops.length+'개 정류장'));for(const s of r.stops)detail.append(el('div',s.order+' · '+name(s)+' / '+s.id));d.append(detail)}
  out.append(d)
 }
 $('routeReport').replaceChildren(out);
}
const reportHost=el('div');reportHost.id='routeReport';$('build').after(reportHost);
if(cfg.routes.length)routeReport(cfg.routes);
$('build').onclick=async()=>{
 let btn=$('build');btn.disabled=true;let notes=[],routes=[];
 try{
 if(!cfg.stops.board||!cfg.stops.exit||!cfg.stops.home)throw Error('출근 승차·하차 및 귀가 하차 정류장을 먼저 지정하세요.');
 let ids=new Map();
 for(const selected of [cfg.stops.board,cfg.stops.home]){
 status('양방향 정류소 후보 조회 · '+selected.name);
 let candidates=[selected];try{candidates=await expandDirectionalStops(selected);if(!candidates.length)candidates=[selected]}catch(e){notes.push(selected.name+' 후보 조회 오류 · '+e.message)}
 for(const s of candidates){try{let items=await api('stop','getSttnThrghRouteList',{nodeid:s.id});for(const x of items)if(x.routeid)ids.set(String(x.routeid),String(x.routeno))}catch(e){notes.push(s.name+' · '+e.message)}}
 }
 for(const [id,no] of ids){status('노선 구성 중 · '+no);try{let stops=(await api('route','getRouteAcctoThrghSttnList',{routeId:id})).map(x=>({...node(x),order:Number(x.nodeord)})).filter(x=>x.id&&Number.isFinite(x.order)).sort((a,b)=>a.order-b.order);if(stops.length)routes.push({id,no,stops});else notes.push(no+' · 경유 정류장 0건')}catch(e){notes.push(no+' · '+e.message)}}
 if(notes.length){routeReport(routes,notes);status('',false);return}
 cfg.routes=routes;cfg.routesBuiltAt=Date.now();transferCache.clear();save();routeReport(routes);status('',false);
 }catch(e){status('',false);routeReport(routes,[...notes,e.message])}finally{btn.disabled=false}
};

/* P5: independent one-off route planner. No persistent commute setting changes. */
const otherFromHost=$('otherFromResults'),otherToHost=$('otherToResults');
const fromControl=stopSearchControl(otherFromHost,stops=>{otherTrip.from=stops[0];otherTrip.fromCandidates=stops;otherTrip.ready=false;$('otherSelection').textContent='출발: '+stops[0].name+(otherTrip.to?' · 도착: '+otherTrip.to.name:'')});
const toControl=stopSearchControl(otherToHost,stops=>{otherTrip.to=stops[0];otherTrip.toCandidates=stops;otherTrip.ready=false;$('otherSelection').textContent='출발: '+(otherTrip.from?.name||'미선택')+' · 도착: '+stops[0].name});
$('swapOther').onclick=()=>{const a=otherTrip.from,b=otherTrip.fromCandidates;otherTrip.from=otherTrip.to;otherTrip.fromCandidates=otherTrip.toCandidates;otherTrip.to=a;otherTrip.toCandidates=b;otherTrip.ready=false;fromControl.input.value=otherTrip.from?.name||'';toControl.input.value=otherTrip.to?.name||'';$('otherSelection').textContent='출발: '+(otherTrip.from?.name||'미선택')+' · 도착: '+(otherTrip.to?.name||'미선택')};
$('findOther').onclick=async()=>{
 if(!otherTrip.from||!otherTrip.to){$('otherSelection').textContent='출발·도착 정류장을 모두 선택하세요';return}
 const button=$('findOther');button.disabled=true;otherTrip.ready=false;revision++;resetView();$('otherSelection').textContent='노선 탐색 중…';
 try{
  const ids=new Map(),candidatesMap=new Map();
  for(const s of [otherTrip.from,otherTrip.to])for(const x of await expandDirectionalStops(s))candidatesMap.set(x.id,x);
  const candidates=[...candidatesMap.values()];
  for(const s of candidates){const items=await api('stop','getSttnThrghRouteList',{nodeid:s.id});for(const x of items)if(x.routeid)ids.set(String(x.routeid),String(x.routeno))}
  const results=[];
  for(const [id,no] of ids){let r=cfg.routes.find(x=>x.id===id);if(!r)r=otherTrip.routes.find(x=>x.id===id);
   if(!r){let stops=(await api('route','getRouteAcctoThrghSttnList',{routeId:id})).map(x=>({...node(x),order:Number(x.nodeord)})).filter(x=>x.id&&Number.isFinite(x.order)).sort((a,b)=>a.order-b.order);r={id,no,stops}}
   if(r.stops.length)results.push(r)
  }
  otherTrip.routes=results;otherTrip.ready=true;revision++;$('otherSelection').textContent='노선 '+results.length+'개 분석 · 실시간 도착 및 환승 검색';refresh();
 }catch(e){$('otherSelection').textContent='경로 검색 실패: '+e.message;recordError(e,'기타 검색')}
 finally{button.disabled=false}
};

const homeQuery=el('input'),homeSearch=el('button','정류장 검색'),homeSearchList=el('div',undefined,'results');
homeQuery.placeholder='직행·환승 탑승 정류장 검색';$('homeStop').after(homeQuery,homeSearch,homeSearchList);
homeSearch.onclick=async()=>{const q=homeQuery.value.trim();if(!q)return;homeSearch.disabled=true;try{const groups=groupStops((await findStops(q)).filter(s=>s.id&&s.id!==cfg.stops.home?.id));homeSearchList.replaceChildren();
 for(const g of groups){let b=el('button',g.name+(g.stops.length>1?' · 방향 자동 판별':''));b.onclick=()=>{for(const s of g.stops)if(!cfg.favorites.some(x=>x.id===s.id))cfg.favorites.push(s);cfg.last=g.stops[0].id;save();revision++;populateHome();homeSearchList.replaceChildren();refresh()};homeSearchList.append(b)}
 $('gpsInfo').textContent=groups.length+'개 검색 결과 · 선택 시 즐겨찾기 저장'}catch(e){$('gpsInfo').textContent='정류장 검색 실패: '+e.message}finally{homeSearch.disabled=false}};
$('homeStop').onchange=()=>{cfg.last=$('homeStop').value;save();revision++;refresh()};
$('gps').onclick=()=>{if(!navigator.geolocation){$('gpsInfo').textContent='GPS 미지원';return}navigator.geolocation.getCurrentPosition(p=>{let rad=x=>x*Math.PI/180,lat=p.coords.latitude,lon=p.coords.longitude;let list=homeCandidates().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&s.lat!==0&&s.lon!==0).map(s=>{let h=Math.sin(rad(s.lat-lat)/2)**2+Math.cos(rad(lat))*Math.cos(rad(s.lat))*Math.sin(rad(s.lon-lon)/2)**2;return {...s,distance:6371000*2*Math.asin(Math.sqrt(Math.min(1,h)))}}).sort((a,b)=>a.distance-b.distance);populateHome(list);$('gpsInfo').textContent=list.length?'직선거리 기준 · 가까운 정류장부터 표시':'좌표 정보 없음 · 직접 선택';if(!list.length)populateHome()},e=>{$('gpsInfo').textContent='위치 확인 실패 · 직접 선택 가능'},{enableHighAccuracy:true,timeout:12000})};
// Theme is independent of the existing settings schema and backup.
const themeKey='ji-bus-theme';let theme='system';try{theme=localStorage.getItem(themeKey)||'system'}catch{}
if(!['system','light','dark'].includes(theme))theme='system';
const media=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme;$('themeMode').value=theme}
$('themeMode').onchange=()=>{theme=$('themeMode').value;try{localStorage.setItem(themeKey,theme)}catch{}applyTheme()};
if(media.addEventListener)media.addEventListener('change',applyTheme);else if(media.addListener)media.addListener(applyTheme);applyTheme();
function groupSettings(){
 const sections=[['인증키 설정',$('key').closest('label'),$('query').closest('label')],['정류장 및 노선 설정',$('query').closest('label'),backupPanel],['백업 및 복원',backupPanel,null]];
 for(const [title,start,stop] of sections){const d=el('details',undefined,'settingsGroup');d.append(el('summary',title));start.before(d);let n=start;while(n&&n!==stop){let next=n.nextSibling;d.append(n);n=next}d.open=title==='정류장 및 노선 설정'||(title==='인증키 설정'&&!cfg.key)}
}
groupSettings();
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('refresh').onclick=()=>{resetFailures();refresh()};
setInterval(()=>{if(!document.hidden&&retryTimer===null&&!authBlocked)refresh()},15000);
setInterval(()=>{if(!document.hidden){const now=Date.now();document.querySelectorAll('[data-eta]').forEach(e=>tickEta(e,now));}},1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearRetry();else{resetFailures();refresh()}});
switchTab(cfg.routes.length?'work':'settings');
