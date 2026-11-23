export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Access-Control-Allow-Origin','https://doldolx2.github.io');
 res.setHeader('Vary','Origin');
 if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
 return res.status(200).json({
  status:'ok',
  service:'ji-bus-api',
  tagoConfigured:Boolean(process.env.TAGO_API_KEY),
  kmaConfigured:Boolean(process.env.KMA_API_KEY)
 });
}
