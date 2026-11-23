// Weather observation is fetched server-side to keep the KMA key private.
function toGrid(lat,lon){
 const RE=6371.00877,GRID=5,SLAT1=30,SLAT2=60,OLON=126,OLAT=38,XO=43,YO=136;
 const RAD=Math.PI/180;
 const re=RE/GRID;
 const sl1=SLAT1*RAD,sl2=SLAT2*RAD,olon=OLON*RAD,olat=OLAT*RAD;
 let sn=Math.tan(Math.PI*.25+sl2*.5)/Math.tan(Math.PI*.25+sl1*.5);
 sn=Math.log(Math.cos(sl1)/Math.cos(sl2))/Math.log(sn);
 let sf=Math.tan(Math.PI*.25+sl1*.5);
 sf=Math.pow(sf,sn)*Math.cos(sl1)/sn;
 let ro=Math.tan(Math.PI*.25+olat*.5);
 ro=re*sf/Math.pow(ro,sn);
 let ra=Math.tan(Math.PI*.25+lat*RAD*.5);
 ra=re*sf/Math.pow(ra,sn);
 let theta=lon*RAD-olon;
 if(theta>Math.PI)theta-=2*Math.PI;
 if(theta< -Math.PI)theta+=2*Math.PI;
 theta*=sn;
 return {nx:Math.floor(ra*Math.sin(theta)+XO+.5),ny:Math.floor(ro-ra*Math.cos(theta)+YO+.5)}
}
function baseTimes(now=new Date()){
 // Ultra-short-term observations are published after the observation hour;
 // request the previous full hour to avoid missing releases.
 const utcMs=now.getTime()+9*3600000-40*60000;
 const d=new Date(utcMs);
 const baseDate=d.toISOString().slice(0,10).replaceAll('-','');
 return {baseDate,baseTime:String(d.getUTCHours()).padStart(2,'0')+'00'}
}
export default async function handler(req,res){
 res.setHeader('Access-Control-Allow-Origin','https://doldolx2.github.io');
 res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
 res.setHeader('Vary','Origin');
 if(req.method==='OPTIONS')return res.status(204).end();
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const key=process.env.KMA_API_KEY;
 if(!key)return res.status(503).json({error:'kma_not_configured'});
 if(typeof req.query.lat!=='string'||typeof req.query.lon!=='string')
  return res.status(400).json({error:'invalid_coordinates'});
 const lat=Number(req.query.lat),lon=Number(req.query.lon);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<33||lat>39||lon<124||lon>132)
  return res.status(400).json({error:'out_of_service_area'});
 const {nx,ny}=toGrid(lat,lon);
 const {baseDate,baseTime}=baseTimes();
 const params=new URLSearchParams({serviceKey:key,pageNo:'1',numOfRows:'100',dataType:'JSON',
  base_date:baseDate,base_time:baseTime,nx:String(nx),ny:String(ny)});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const upstream=await fetch('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?'+params,{
   signal:controller.signal
  });
  if(!upstream.ok)return res.status(502).json({error:'kma_unavailable',status:upstream.status});
  const data=await upstream.json();
  if(String(data?.response?.header?.resultCode)!=='00')
   return res.status(502).json({error:'kma_api_error'});
  const items=data?.response?.body?.items?.item;
  const temperature=Array.isArray(items)?items.find(x=>x.category==='T1H'):null;
  const value=Number(temperature?.obsrValue);
  if(!temperature||!Number.isFinite(value))return res.status(502).json({error:'temperature_unavailable'});
  res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=120');
  return res.status(200).json({temperature:value,unit:'°C',source:'KMA',baseDate,baseTime,nx,ny})
 }catch{return res.status(502).json({error:'kma_request_failed'})}
 finally{clearTimeout(timer)}
}
