const crypto=require('node:crypto');

function qrSignature(caseId,token){
  return crypto.createHmac('sha256',token)
    .update('case-myp-line-qr:'+caseId)
    .digest('hex')
    .slice(0,32);
}

function safeEqual(a,b){
  const aa=Buffer.from(String(a||''),'utf8');
  const bb=Buffer.from(String(b||''),'utf8');
  return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}

async function loadCaseContact(caseId){
  const supaUrl=String(process.env.CASEMYP_SUPABASE_URL||'').trim().replace(/\/$/,'');
  const supaKey=String(process.env.CASEMYP_SUPABASE_ANON_KEY||'').trim();
  if(!supaUrl||!supaKey)throw new Error('Supabase is not configured');

  const url=new URL(supaUrl+'/rest/v1/cases');
  url.searchParams.set('select','contact');
  url.searchParams.set('caseid','eq.'+caseId);
  url.searchParams.set('deleted_at','is.null');
  url.searchParams.set('limit','1');

  const response=await fetch(url,{
    headers:{
      apikey:supaKey,
      Authorization:'Bearer '+supaKey,
      Accept:'application/json'
    }
  });
  const text=await response.text();
  if(!response.ok)throw new Error('Supabase read failed: '+response.status);
  const rows=text?JSON.parse(text):[];
  return Array.isArray(rows)&&rows[0]?String(rows[0].contact||'').trim():'';
}

async function resolveImage(contact){
  const data=String(contact||'').match(/^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if(data){
    const type=data[1].toLowerCase()==='image/jpg'?'image/jpeg':data[1].toLowerCase();
    const buffer=Buffer.from(data[2].replace(/\s/g,''),'base64');
    if(!buffer.length)throw new Error('QR image is empty');
    if(buffer.length>10*1024*1024)throw new Error('QR image is too large');
    return{type,buffer};
  }

  if(/^https:\/\//i.test(contact)){
    const response=await fetch(contact,{redirect:'follow'});
    if(!response.ok)throw new Error('QR image fetch failed: '+response.status);
    const type=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!['image/jpeg','image/png'].includes(type))throw new Error('QR URL is not a JPEG or PNG image');
    const buffer=Buffer.from(await response.arrayBuffer());
    if(!buffer.length)throw new Error('QR image is empty');
    if(buffer.length>10*1024*1024)throw new Error('QR image is too large');
    return{type,buffer};
  }

  throw new Error('QR image format is unsupported');
}

module.exports=async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).end('Method not allowed');
  }

  const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();
  const caseId=String(req.query?.caseId||'').trim();
  const sig=String(req.query?.sig||'').trim();

  if(!token||!caseId||!sig)return res.status(400).end('Bad request');
  if(!safeEqual(sig,qrSignature(caseId,token)))return res.status(403).end('Forbidden');

  try{
    const contact=await loadCaseContact(caseId);
    if(!contact)return res.status(404).end('QR image not found');
    const image=await resolveImage(contact);

    res.setHeader('Content-Type',image.type);
    res.setHeader('Content-Length',String(image.buffer.length));
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(200).end(image.buffer);
  }catch(error){
    console.error('LINE QR image error',error?.message||error);
    return res.status(404).end('QR image unavailable');
  }
};
