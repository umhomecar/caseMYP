function oneLine(value){
  return String(value ?? '').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim();
}

async function lineGet(path,token){
  const response=await fetch('https://api.line.me'+path,{
    headers:{Authorization:'Bearer '+token}
  });
  const raw=await response.text().catch(()=>'');
  let data={};
  try{data=raw?JSON.parse(raw):{};}catch{data={raw:oneLine(raw).slice(0,300)};}
  if(!response.ok){
    const err=new Error('LINE '+response.status);
    err.status=response.status;
    err.data=data;
    throw err;
  }
  return data;
}

module.exports=async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({success:false,error:'Method not allowed'});
  }

  const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();
  if(!token)return res.status(503).json({success:false,error:'LINE token is not configured'});

  try{
    const [quota,consumption]=await Promise.all([
      lineGet('/v2/bot/message/quota',token),
      lineGet('/v2/bot/message/quota/consumption',token)
    ]);
    const limit=quota?.type==='limited'&&Number.isFinite(Number(quota?.value))?Number(quota.value):null;
    const used=Number.isFinite(Number(consumption?.totalUsage))?Number(consumption.totalUsage):null;
    const remaining=limit!==null&&used!==null?Math.max(0,limit-used):null;
    res.setHeader('Cache-Control','no-store, max-age=0');
    return res.status(200).json({
      success:true,
      quotaType:quota?.type||null,
      limit,
      used,
      remaining
    });
  }catch(error){
    console.error('LINE quota check failed',error?.status||'',error?.data||'',error?.message||error);
    return res.status(502).json({
      success:false,
      error:'ตรวจโควตา LINE ไม่สำเร็จ',
      lineStatus:error?.status||null
    });
  }
};