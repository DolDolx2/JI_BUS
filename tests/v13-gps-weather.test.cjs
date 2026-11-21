// JI BUS V1.3 Build 06 — GPS weather / denied permission / API fallback tests.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const begin=source.indexOf('const weatherCache='),end=source.indexOf('renderRecentTrips();',begin);
assert(begin>=0&&end>begin,'weather source missing');
const code=source.slice(begin,end);
function harness(position,failGPSWeather=false){
 const host={textContent:''},calls=[],errors=[];
 const navigator={geolocation:{getCurrentPosition(ok,bad,options){
  assert.equal(options.enableHighAccuracy,false);
  assert.equal(options.timeout,8000);
  if(position)ok({coords:{latitude:position.lat,longitude:position.lon}});
  else bad({code:1});
 }}};
 const fakeFetch=async url=>{
  calls.push(url);
  if(failGPSWeather&&url.includes('latitude=37.5'))throw Error('GPS endpoint blocked');
  return {ok:true,json:async()=>({current:{temperature_2m:18.6,weather_code:2}})}
 };
 const app=new Function('navigator','fetch','$','recordError','URLSearchParams',code+
  ';return {loadCheongjuWeather,weatherCache,usableWeatherPosition,weatherNearSamePlace,weatherRequestUrl}')(
 navigator,fakeFetch,id=>id==='weatherNow'?host:null,(error,scope)=>errors.push([error,scope]),URLSearchParams);
 return {...app,host,calls,errors}
}
(async()=>{
 const gps=harness({lat:37.5,lon:127.1});
 await gps.loadCheongjuWeather();
 assert.equal(gps.host.textContent,'현재 위치 19°C · 대체로 맑음');
 assert.match(gps.calls[0],/latitude=37\.5/);
 assert.match(gps.calls[0],/longitude=127\.1/);
 assert.equal(gps.calls.length,1);
 await gps.loadCheongjuWeather();
 assert.equal(gps.calls.length,1,'cache should suppress duplicate request');
 assert.equal(gps.weatherCache.source,'현재 위치');
 const denied=harness(null);
 await denied.loadCheongjuWeather();
 assert.equal(denied.host.textContent,'청주시 기준 19°C · 대체로 맑음');
 assert.match(denied.calls[0],/latitude=36\.6424/);
 const failed=harness({lat:37.5,lon:127.1},true);
 await failed.loadCheongjuWeather();
 assert.equal(failed.calls.length,2);
 assert.equal(failed.host.textContent,'청주시 기준 19°C · 대체로 맑음');
 assert.equal(failed.weatherCache.source,'청주시 기준');
 assert.equal(gps.usableWeatherPosition({coords:{latitude:null,longitude:127}}),false);
 assert.equal(gps.usableWeatherPosition({coords:{latitude:91,longitude:127}}),false);
 assert.equal(gps.usableWeatherPosition({coords:{latitude:36.5,longitude:127}}),true);
 assert.equal(gps.weatherNearSamePlace({lat:37.5,lon:127.1},{lat:37.5001,lon:127.1}),true);
 assert.equal(gps.weatherNearSamePlace({lat:37.5,lon:127.1},{lat:38,lon:127.1}),false);
 console.log('JI BUS V1.3 Build 06 GPS weather tests PASS (19 assertions)');
})().catch(error=>{console.error(error);process.exitCode=1});
