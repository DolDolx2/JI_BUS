'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const v=JSON.parse(fs.readFileSync(path.join(__dirname,'..','version.json'),'utf8'));
assert.equal(v.build,'20261123.1409');
assert.match(app,/BUS_API_BASE='https:\/\/ji-bus-api-siga0411-6093\.vercel\.app'/);
assert.match(app,/new URL\(BUS_API_BASE\+'\/api\/bus'\)/);
assert.match(app,/new URL\(BUS_API_BASE\+'\/api\/temperature'\)/);
assert.doesNotMatch(app,/if\(!cfg\.key\)|serviceKey:cfg\.key/);
assert.doesNotMatch(app,/serviceKey:/);
assert.doesNotMatch(html,/id="saveKey"|id="key"/);
assert.match(html,/id="connectionCheck"/);
assert.match(html,/id="weatherObservation"/);
assert.match(app,/if\(weatherCache\.detail\)showWeatherSource/);
const beg=app.indexOf('async function fetchWeatherAt(location){');
const end=app.indexOf('function showWeatherSource(',beg);
assert(beg>0&&end>beg);
const code=app.slice(beg,end);
const fixed=new Date('2026-11-23T12:20:00+09:00').getTime();
class FakeDate extends Date{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}}
const weather=(kmaStatus,kmaData,openStatus,openData)=>new Function(
 'BUS_API_BASE','URL','URLSearchParams','weatherRequestUrl','weatherDescription','fetch','recordError','Date',
 code+';return fetchWeatherAt')(
 'https://ji-bus-api-siga0411-6093.vercel.app',URL,URLSearchParams,
 ()=>new URL('https://api.open-meteo.com/v1/forecast'),
 x=>x===2?'대체로 맑음':'기타',
 async url=>{
  const kma=String(url).includes('/api/temperature');
  return {ok:kma?kmaStatus:openStatus,status:kma?503:502,json:async()=>kma?kmaData:openData}
 },
 ()=>{},FakeDate
 )({lat:36.7,lon:127.43});
(async()=>{
 const kma={source:'KMA',temperature:5.1,baseDate:'20261123',baseTime:'1100'};
 const om={current:{temperature_2m:10.6,weather_code:2}};
 const a=await weather(true,kma,true,om);
 assert.equal(a.label,'5°C · 대체로 맑음');
 assert.equal(a.source,'기상청');
 assert.match(a.detail,/11:00 관측/);
 const b=await weather(false,null,true,om);
 assert.equal(b.label,'11°C · 대체로 맑음');
 assert.equal(b.source,'Open-Meteo 대체');
 const c=await weather(true,kma,false,null);
 assert.equal(c.label,'5°C · 날씨 상태 확인 중');
 const stale=await weather(true,{...kma,baseDate:'20261122'},true,om);
 assert.equal(stale.source,'Open-Meteo 대체');
 await assert.rejects(weather(false,null,false,null));
 console.log('Build 09 proxy + KMA weather regression PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
