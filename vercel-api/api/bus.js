// Only explicitly approved TAGO methods and parameters are proxied.
// No arbitrary upstream URLs or user-selected service keys are accepted.
const SERVICES={
 stop:'BusSttnInfoInqireService',
 route:'BusRouteInfoInqireService',
 arrival:'ArvlInfoInqireService',
 location:'BusLcInfoInqireService'
};
const METHODS={
 stop:new Set(['getSttnNoList','getCrdntPrxmtSttnList','getSttnThrghRouteList']),
 route:new Set(['getRouteInfoIem','getRouteAcctoThrghSttnList']),
 arrival:new Set(['getSttnAcctoArvlPrearngeInfoList','getCtyCodeList']),
 location:new Set(['getRouteAcctoBusLcList'])
};
const PARAMS=new Set(['nodeNm','nodeid','routeId','gpsLati','gpsLong','numOfRows','pageNo']);
function cors(req,res){
 res.setHeader('Access-Control-Allow-Origin','https://doldolx2.github.io');
 res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Content-Type');
 res.setHeader('Vary','Origin');
 if(req.method==='OPTIONS'){res.status(204).end();return true}
 return false
}
export default async function handler(req,res){
 if(cors(req,res))return;
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 const key=process.env.TAGO_API_KEY;
 if(!key)return res.status(503).json({error:'tago_not_configured'});
 const {service,method,...rest}=req.query;
 if(typeof service!=='string'||typeof method!=='string'||!METHODS[service]?.has(method))
  return res.status(400).json({error:'invalid_service_or_method'});
 const params=new URLSearchParams({serviceKey:key,cityCode:'33010',_type:'json',numOfRows:'1000',pageNo:'1'});
 for(const [name,value] of Object.entries(rest)){
  if(!PARAMS.has(name)||typeof value!=='string'||value.length>100)
   return res.status(400).json({error:'invalid_parameter',parameter:name.slice(0,40)});
  params.set(name,value)
 }
 if(!/^\d{1,4}$/.test(params.get('numOfRows'))||Number(params.get('numOfRows'))>1000
   ||!/^\d{1,3}$/.test(params.get('pageNo')))
  return res.status(400).json({error:'invalid_pagination'});
 for(const n of ['gpsLati','gpsLong']){
  if(params.has(n)&&(!Number.isFinite(Number(params.get(n)))||Math.abs(Number(params.get(n)))>(n==='gpsLati'?90:180)))
   return res.status(400).json({error:'invalid_coordinates'})
 }
 const url='https://apis.data.go.kr/1613000/'+SERVICES[service]+'/'+method+'?'+params;
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
 try{
  const upstream=await fetch(url,{signal:ctl.signal,headers:{Accept:'application/json'}});
  if(!upstream.ok)return res.status(502).json({error:'tago_unavailable',status:upstream.status});
  const body=await upstream.json();
  const resultCode=String(body?.response?.header?.resultCode??'');
  if(!['00','0','0000'].includes(resultCode))
   return res.status(502).json({error:'tago_api_error',code:resultCode});
  res.setHeader('Cache-Control','public, s-maxage=15, stale-while-revalidate=30');
  return res.status(200).json(body)
 }catch{return res.status(502).json({error:'tago_request_failed'})}
 finally{clearTimeout(timer)}
}
