function oneLine(value){
  return String(value ?? '').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim();
}

function contactLabel(contactBy){
  const type=oneLine(contactBy);
  if(type==='เบอร์')return 'เบอร์';
  if(type==='ไลน์')return 'ไลน์';
  if(type==='QR Code')return 'QR Code';
  if(type==='เบอร์&ไลน์')return 'เบอร์/ไลน์';
  return 'ข้อมูลติดต่อ';
}

module.exports = async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({success:false,error:'Method not allowed'});
  }

  const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();
  const groupId=String(process.env.LINE_GROUP_ID||'').trim();
  const allowedOrigin=String(process.env.CASEMYP_ALLOWED_ORIGIN||'').trim().replace(/\/$/,'');
  const requestOrigin=String(req.headers.origin||'').trim().replace(/\/$/,'');

  if(allowedOrigin&&requestOrigin&&requestOrigin!==allowedOrigin){
    return res.status(403).json({success:false,error:'Origin not allowed'});
  }
  if(!token||!groupId){
    return res.status(503).json({success:false,error:'LINE notification is not configured'});
  }

  const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  const caseId=oneLine(body.caseId||body.caseid);
  const customername=oneLine(body.customername);
  const contact=oneLine(body.contact);
  const contactBy=oneLine(body.contact_by);
  const status=oneLine(body.status)||'รอข้อมูล';
  const sales=oneLine(body.sales)||'รอมอบหมาย';

  if(!caseId||!customername){
    return res.status(400).json({success:false,error:'Missing caseId or customername'});
  }

  const lines=[
    'รหัสเคส: '+caseId,
    'ชื่อลูกค้า: '+customername,
    contactLabel(contactBy)+': '+(contact||'-'),
    'สถานะ: '+status,
    'เซลส์: '+sales
  ];
  const text=lines.join('\n');

  try{
    const lineRes=await fetch('https://api.line.me/v2/bot/message/push',{
      method:'POST',
      headers:{
        'Authorization':'Bearer '+token,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        to:groupId,
        messages:[{type:'text',text}]
      })
    });

    if(!lineRes.ok){
      const detail=await lineRes.text().catch(()=>'');
      console.error('LINE push failed',lineRes.status,detail);
      return res.status(502).json({success:false,error:'LINE push failed',status:lineRes.status});
    }
    return res.status(200).json({success:true});
  }catch(error){
    console.error('LINE push error',error?.message||error);
    return res.status(502).json({success:false,error:'LINE push request failed'});
  }
};
