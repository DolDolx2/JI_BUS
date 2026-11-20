'use strict';
const $=id=>document.getElementById(id);
const store='ji-bus-v1';
let cfg={key:'',stops:{},favorites:[],routes:[],last:''};
try{cfg={...cfg,...JSON.parse(localStorage.getItem(store)||'{}')}}catch{}
let tab='work',busy=false,revision=0;
const save=()=>localStorage.setItem(store,JSON.stringify(cfg));
const arr=v=>Array.isArray(v)?v:v&&typeof v==='object'?[v]:[];
const el=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e};
const status=(s,err=false)=>{$('status').textContent=s;$('status').className=err?'error':'muted'};
const services={stop:'BusSttnInfoInqireService',route:'BusRouteInfoInqireService',arrival:'ArvlInfoInqireService',location:'BusLcInfoInqireService'};
async function api(service,method,params={}){
 if(!cfg.key)throw Error('환경설정에서 인증키를 입력하세요.');
 let u=new URL('https://apis.data.go.kr/1613000/'+services[service]+'/'+method);
 u.search=new URLSearchParams({serviceKey:cfg.key,cityCode:'33010',_type:'json',numOfRows:'1000',pageNo:'1',...params});
 let res=await fetch(u,{signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error('API HTTP '+res.status+' — 인증키 및 활용 승인 확인');
 let json=await res.json(),h=json.response?.header,body=json.response?.body;
 if(!h||!['00','0','0000'].includes(String(h.resultCode)))throw Error('API 응답 오류: '+(h?.resultMsg||json.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg||'응답 형식 확인 필요'));
 let items=arr(body?.items?.item);if(Number(body?.totalCount)>items.length)throw Error('조회 결과가 페이지 한도를 초과했습니다.');
 return items;
}
const node=x=>({id:String(x.nodeid??''),name:String(x.nodenm??''),no:String(x.nodeno??''),lat:Number(x.gpslati??NaN),lon:Number(x.gpslong??NaN)});
const name=x=>x.name+(x.no?' ('+x.no+')':'');
function showSaved(){
 const labels={board:'출근 승차',exit:'출근 하차',alt:'출근 대체',home:'귀가 하차'};
 $('saved').replaceChildren(...Object.entries(labels).map(([k,v])=>el('p',v+' · '+(cfg.stops[k]?name(cfg.stops[k]):'미설정'))));
 for(const s of cfg.favorites){const p=el('p','즐겨찾기 · '+name(s)+' '),b=el('button','삭제');b.onclick=()=>{cfg.favorites=cfg.favorites.filter(x=>x.id!==s.id);save();showSaved()};p.append(b);$('saved').append(p)}
}
function pairs(stops,a,b){let out=[];for(let i=0;i<stops.length;i++)if(stops[i].id===a)for(let j=i+1;j<stops.length;j++)if(stops[j].id===b){out.push({i,j});break}return out}
function homeCandidates(){let m=new Map();for(const r of cfg.routes)for(let j=0;j<r.stops.length;j++)if(r.stops[j].id===cfg.stops.home?.id)for(let i=0;i<j;i++)if(r.stops[i].id!==cfg.stops.home.id)m.set(r.stops[i].id,r.stops[i]);return [...m.values()]}
function populateHome(order){let list=order||homeCandidates().sort((a,b)=>Number(cfg.favorites.some(x=>x.id===b.id))-Number(cfg.favorites.some(x=>x.id===a.id))||a.name.localeCompare(b.name,'ko'));$('homeStop').replaceChildren(new Option('탑승 정류장 선택',''),...list.map(s=>new Option(name(s)+(s.distance!=null?' · '+Math.round(s.distance)+'m':''),s.id)));$('homeStop').value=cfg.last}
function routesFor(){let out=[];for(const r of cfg.routes){let a=tab==='work'?cfg.stops.board?.id:cfg.last;let targets=tab==='work'?[cfg.stops.exit?.id,cfg.stops.alt?.id]:[cfg.stops.home?.id];for(const b of targets.filter(Boolean))for(const p of pairs(r.stops,a,b))out.push({...r,...p})}return out}
function switchTab(t){tab=t;revision++;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));$('settings').hidden=t!=='settings';$('homePanel').hidden=t!=='home';$('heading').hidden=t==='settings';$('cards').replaceChildren();if(t==='settings'){showSaved();status('')}else{populateHome();refresh()}}
function renderTimeline(r,vehicles){
 const wrap=el('div');let positions=new Map();
 for(const v of vehicles){let ix=r.stops.findIndex(s=>s.id===String(v.nodeid)&&s.order===Number(v.nodeord));if(ix<0)continue;let list=positions.get(ix)||[];list.push(v);positions.set(ix,list)}
 for(let i=0;i<r.stops.length;i++){const s=r.stops[i],row=el('div',undefined,'stoprow'),label=el('div',s.name+(i===r.i?' · 승차':i===r.j?' · 하차':''),'stopname'+(i===r.i?' board':i===r.j?' exit':'')),lane=el('div',undefined,'lane');for(const v of positions.get(i)||[]){const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 48 36');icon.setAttribute('class','bus');icon.setAttribute('aria-label','버스 '+String(v.vehicleno||''));icon.innerHTML='<rect x="2" y="2" width="44" height="26" rx="5" fill="currentColor"/><path d="M7 7H41V17H7Z" fill="#155e75"/><path d="M18 7V17M30 7V17" stroke="white" stroke-width="2"/><circle cx="11" cy="29" r="5" fill="#243342"/><circle cx="37" cy="29" r="5" fill="#243342"/>';lane.append(icon)}row.append(label,lane);wrap.append(row)}return wrap
}
async function refresh(){
 if(tab==='settings'||busy)return;
 const rev=revision, list=routesFor();$('heading').replaceChildren(el('h2',tab==='work'?'출근':'귀가'),el('p',tab==='work'?(cfg.stops.board?.name||'승차 정류장 미설정')+' → '+(cfg.stops.exit?.name||'하차 정류장 미설정'):(cfg.stops.home?.name||'귀가 목적지 미설정')+' 방면'));
 if(!list.length){$('cards').replaceChildren();status('환경설정에서 정류장을 지정하고 이용 노선을 구성하세요.');return}
 busy=true;status('실시간 조회 중…');
 try{
 let a=await api('arrival','getSttnAcctoArvlPrearngeInfoList',{nodeId:list[0].stops[list[0].i].id});
 let data=await Promise.all([...new Set(list.map(r=>r.id))].map(async id=>{try{return [id,await api('location','getRouteAcctoBusLcList',{routeId:id}),null]}catch(e){return [id,[],e.message]}}));
 if(rev!==revision)return;
 let loc=new Map(data.map(([id,v,e])=>[id,{v,e}]));
 list.sort((x,y)=>Math.min(...a.filter(v=>String(v.routeid)===x.id&&Number.isFinite(Number(v.arrtime))).map(v=>Number(v.arrtime)),Infinity)-Math.min(...a.filter(v=>String(v.routeid)===y.id&&Number.isFinite(Number(v.arrtime))).map(v=>Number(v.arrtime)),Infinity));
 const opened=new Set([...$('cards').querySelectorAll('details[open]')].map(d=>d.dataset.key));
 $('cards').replaceChildren();
 for(const r of list){let box=el('article'),head=el('div',undefined,'line');let av=a.filter(v=>String(v.routeid)===r.id&&v.arrtime!=null&&Number.isFinite(Number(v.arrtime))).sort((x,y)=>Number(x.arrtime)-Number(y.arrtime));head.append(el('h3',r.no),el('span',av.length?(Number(av[0].arrtime)<=0?'도착 예정':Math.ceil(Number(av[0].arrtime)/60)+'분 후'):'도착정보 없음','eta'));box.append(head,el('p',r.stops[r.i].name+' → '+r.stops[r.j].name),el('p',av.length?'남은 정류장 '+(av[0].arrprevstationcnt??'미제공')+' · 다음 차량 '+(av[1]?Math.ceil(Number(av[1].arrtime)/60)+'분 후':'정보 없음'):'운행 종료 여부는 확인되지 않음','muted'));
 let d=el('details');d.dataset.key=r.id+':'+r.i+':'+r.j;d.open=opened.has(d.dataset.key);d.append(el('summary','전체 정류장 및 차량 위치'));let l=loc.get(r.id);if(l.e)d.append(el('p','차량 위치 조회 실패: '+l.e,'error'));else{d.append(el('p','API 정류장 기준 위치 · 정확한 구간 이동은 표시하지 않음','muted'));d.append(renderTimeline(r,l.v))}box.append(d);$('cards').append(box)}
 status('마지막 갱신 '+new Date().toLocaleTimeString('ko-KR'));
 }catch(e){if(rev===revision){$('cards').replaceChildren();status('조회 실패: '+e.message,true)}}finally{busy=false;if(rev!==revision&&tab!=='settings')refresh()}
}
$('key').value=cfg.key;
const keyFeedback=el('p');keyFeedback.setAttribute('role','status');keyFeedback.setAttribute('aria-live','polite');$('saveKey').after(keyFeedback);
function keyMessage(t,error=false){keyFeedback.textContent=t;keyFeedback.className=error?'error':'muted';}
if(cfg.key)keyMessage('인증키 저장됨 · 연결 확인 필요');
$('saveKey').onclick=async()=>{
 const btn=$('saveKey'),key=$('key').value.trim();if(!key){keyMessage('일반 인증키(Decoding)를 입력하세요.',true);return}
 btn.disabled=true;btn.textContent='연결 확인 중…';keyMessage('인증키 저장 및 API 연결 확인 중…');
 try{cfg.key=key;save();keyMessage('인증키 저장 완료 · API 연결 확인 중…');
 await api('arrival','getCtyCodeList');keyMessage('인증키 저장 완료 · 버스도착정보 API 연결 성공. 아래에서 정류장을 검색하세요.');
 }catch(e){keyMessage('처리 실패 또는 연결 미확인: '+(e.name==='TimeoutError'?'응답 시간 초과':e.message)+'. 활용 승인 및 인증키를 확인하세요.',true)}
 finally{btn.disabled=false;btn.textContent='인증키 저장 및 확인'}
};
$('search').onclick=async()=>{let q=$('query').value.trim();if(!q)return;try{status('정류장 검색 중…');let items=await api('stop','getSttnNoList',{nodeNm:q});$('searchResults').replaceChildren();for(const x of items){let s=node(x);if(!s.id)continue;let b=el('button',name(s));b.onclick=()=>{let t=$('target').value;if(t==='favorite'){if(!cfg.favorites.some(x=>x.id===s.id))cfg.favorites.push(s)}else{cfg.stops[t]=s;cfg.routes=[];cfg.last=''}save();showSaved();status('정류장 저장 완료')};$('searchResults').append(b)}status(items.length+'개 검색 결과')}catch(e){status(e.message,true)}};
$('build').onclick=async()=>{let btn=$('build');btn.disabled=true;try{if(!cfg.stops.board||!cfg.stops.exit||!cfg.stops.home)throw Error('출근 승차·하차 및 귀가 하차 정류장을 먼저 지정하세요.');let ids=new Map();for(const s of [cfg.stops.board,cfg.stops.home])for(const x of await api('stop','getSttnThrghRouteList',{nodeid:s.id}))if(x.routeid)ids.set(String(x.routeid),String(x.routeno));let routes=[];for(const [id,no] of ids){status('노선 구성 중 · '+no);let stops=(await api('route','getRouteAcctoThrghSttnList',{routeId:id})).map(x=>({...node(x),order:Number(x.nodeord)})).filter(x=>x.id&&Number.isFinite(x.order)).sort((a,b)=>a.order-b.order);if(stops.length)routes.push({id,no,stops})}cfg.routes=routes;save();status(routes.length+'개 노선 구성 완료 · 실제 방향은 정류장 순서 기준')}catch(e){status(e.message,true)}finally{btn.disabled=false}};
$('homeStop').onchange=()=>{cfg.last=$('homeStop').value;save();revision++;refresh()};
$('gps').onclick=()=>{if(!navigator.geolocation){$('gpsInfo').textContent='GPS 미지원';return}navigator.geolocation.getCurrentPosition(p=>{let rad=x=>x*Math.PI/180,lat=p.coords.latitude,lon=p.coords.longitude;let list=homeCandidates().filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)&&s.lat!==0&&s.lon!==0).map(s=>{let h=Math.sin(rad(s.lat-lat)/2)**2+Math.cos(rad(lat))*Math.cos(rad(s.lat))*Math.sin(rad(s.lon-lon)/2)**2;return {...s,distance:6371000*2*Math.asin(Math.sqrt(Math.min(1,h)))}}).sort((a,b)=>a.distance-b.distance);populateHome(list);$('gpsInfo').textContent=list.length?'직선거리 기준 · 가까운 정류장부터 표시':'좌표 정보 없음 · 직접 선택';if(!list.length)populateHome()},e=>{$('gpsInfo').textContent='위치 확인 실패 · 직접 선택 가능'},{enableHighAccuracy:true,timeout:12000})};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));$('refresh').onclick=refresh;setInterval(()=>{if(!document.hidden)refresh()},15000);switchTab(cfg.routes.length?'work':'settings');
