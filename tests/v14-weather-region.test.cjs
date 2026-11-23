// V1.5 Build 01: city/neighbourhood formatting and GPS weather fallbacks.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const version=JSON.parse(fs.readFileSync(path.join(__dirname,'..','version.json'),'utf8'));
assert.equal(version.build,'20261123.1500');
assert.equal(version.label,'Build 01');
assert.match(html,/id="weatherRegion" aria-live="polite"/);
assert.match(html,/BigDataCloud/);
assert.match(app,/api\.bigdatacloud\.net\/data\/reverse-geocode-client/);
assert.match(app,/localityLanguage:'ko'/);
assert.match(app,/weatherCache\.source=source/);
assert.match(app,/regionCache\.label=label/);
assert.match(app,/if\(!fallbackWeather\)showWeatherRegion\(label\)/);
assert.match(app,/fallbackWeather=true;showWeatherRegion\('청주시 기준'\)/);
const regionFn=app.slice(app.indexOf('function regionNameFromGeocode('),app.indexOf('async function resolveWeatherRegion('));
assert(regionFn.length>80);
const regionName=new Function(regionFn+';return regionNameFromGeocode')();
assert.equal(regionName({city:'청주시',locality:'복대동'}),'청주시 복대동');
assert.equal(regionName({city:'청주시',locality:'오창대읍'}),'청주시 오창읍');
assert.equal(regionName({city:'청주시',locality:'오창대읍',localityInfo:{administrative:[{name:'청원구'}]}}),'청주시 청원구 오창읍');
assert.equal(regionName({city:'청주시',locality:'청주시'}),'청주시');
assert.equal(regionName({city:'',principalSubdivision:'충청북도',locality:'복대동'}),'충청북도 복대동');
assert.equal(regionName({city:'',locality:''}),'');
assert.equal(regionName(null),'');
const code=app.slice(app.indexOf('async function resolveWeatherRegion('),app.indexOf('function showWeatherRegion('));
async function geocode(response,initialCache={}){
 let url='';
 const cache=Object.assign({at:0,lat:null,lon:null,label:''},initialCache);
 const get=new Function('fetch','regionCache','weatherNearSamePlace','WEATHER_TTL','regionNameFromGeocode','AbortController','setTimeout','clearTimeout','URLSearchParams',
  code+';return resolveWeatherRegion')(
  async requested=>{url=requested;return {ok:true,json:async()=>response}},
  cache,()=>false,120000,regionName,
  class{constructor(){this.signal={}}abort(){}},
  ()=>1,()=>{},URLSearchParams);
 const label=await get({lat:36.64,lon:127.49});
 return {label,url,cache}
}
(async()=>{
 const result=await geocode({city:'청주시',locality:'사직동'});
 assert.equal(result.label,'청주시 사직동');
 assert.match(result.url,/latitude=36\.64/);
 assert.match(result.url,/longitude=127\.49/);
 assert.match(result.url,/localityLanguage=ko/);
 assert.equal(result.cache.label,'청주시 사직동');
 console.log('V1.5 Build 01 weather locality smoke PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
