import crypto from 'node:crypto';

const ALLOWED_NAMES=new Set(['เกมส์','อาท']);

function oneLine(value){
  return String(value ?? '').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim();
}

function json(data,status=200){
  return Response.json(data,{status,headers:{'cache-control':'no-store'}});
}

function verifyLineSignature(rawBody,signature,secret){
  if(!rawBody||!signature||!secret)return false;
  const expected=crypto.createHmac('sha256',secret).update(rawBody,'utf8').digest('base64');
  const actualBuffer=Buffer.from(String(signature),'utf8');
  const expectedBuffer=Buffer.from(expected,'utf8');
  return actualBuffer.length===expectedBuffer.length&&crypto.timingSafeEqual(actualBuffer,expectedBuffer);
}

function supabaseConfig(){
  const url=String(process.env.CASEMYP_SUPABASE_URL||'').trim().replace(/\/$/,'');
  const key=String(process.env.CASEMYP_SUPABASE_SERVICE_ROLE_KEY||process.env.CASEMYP_SUPABASE_ANON_KEY||'').trim();
  return{url,key};
}

function sbHeaders(key,extra={}){
  return{
    apikey:key,
    Authorization:'Bearer '+key,
    Accept:'application/json',
    'Content-Type':'application/json',
    ...extra
  };
}

async function fetchUserByName(name){
  const {url,key}=supabaseConfig();
  if(!url||!key)throw new Error('CASEMYP Supabase is not configured');
  const endpoint=new URL(url+'/rest/v1/users');
  endpoint.searchParams.set('select','userid,name,status,line_user_id');
  endpoint.searchParams.set('name','eq.'+name);
  endpoint.searchParams.set('limit','2');
  const response=await fetch(endpoint,{headers:sbHeaders(key)});
  if(!response.ok)throw new Error('Supabase user lookup failed: '+response.status);
  const rows=await response.json();
  return Array.isArray(rows)?rows:[];
}

async function fetchUserByLineId(lineUserId){
  const {url,key}=supabaseConfig();
  if(!url||!key)throw new Error('CASEMYP Supabase is not configured');
  const endpoint=new URL(url+'/rest/v1/users');
  endpoint.searchParams.set('select','userid,name,status,line_user_id');
  endpoint.searchParams.set('line_user_id','eq.'+lineUserId);
  endpoint.searchParams.set('limit','2');
  const response=await fetch(endpoint,{headers:sbHeaders(key)});
  if(!response.ok)throw new Error('Supabase LINE lookup failed: '+response.status);
  const rows=await response.json();
  return Array.isArray(rows)?rows:[];
}

async function bindLineUser(name,lineUserId){
  const {url,key}=supabaseConfig();
  if(!url||!key)throw new Error('CASEMYP Supabase is not configured');

  const targetRows=await fetchUserByName(name);
  const target=targetRows.find(row=>String(row?.status||'active')==='active')||targetRows[0];
  if(!target)return{ok:false,message:'ไม่พบผู้ใช้ '+name+' ใน CASE_MYP'};
  if(String(target.status||'active')!=='active')return{ok:false,message:'บัญชี '+name+' ถูกปิดใช้งานอยู่'};

  const existingRows=await fetchUserByLineId(lineUserId);
  const other=existingRows.find(row=>oneLine(row?.name)!==name);
  if(other)return{ok:false,message:'LINE นี้ถูกผูกกับ '+oneLine(other.name)+' อยู่แล้ว กรุณาแจ้งแอดมิน'};

  const endpoint=new URL(url+'/rest/v1/users');
  endpoint.searchParams.set('userid','eq.'+String(target.userid));
  const response=await fetch(endpoint,{
    method:'PATCH',
    headers:sbHeaders(key,{Prefer:'return=representation'}),
    body:JSON.stringify({line_user_id:lineUserId})
  });
  if(!response.ok){
    const detail=oneLine(await response.text().catch(()=>''));
    throw new Error('Supabase LINE registration failed: '+response.status+(detail?' '+detail:''));
  }
  const rows=await response.json().catch(()=>[]);
  if(!Array.isArray(rows)||!rows.length)throw new Error('Supabase LINE registration returned no row');
  return{ok:true,message:'✅ ลงทะเบียน '+name+' สำเร็จแล้ว\nต่อไป CASE_MYP สามารถส่งเคสเข้า LINE นี้โดยตรงได้'};
}

async function replyLine(replyToken,text){
  const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();
  if(!token||!replyToken||!text)return;
  const response=await fetch('https://api.line.me/v2/bot/message/reply',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({replyToken,messages:[{type:'text',text:String(text).slice(0,4900)}]})
  });
  if(!response.ok){
    const detail=oneLine(await response.text().catch(()=>''));
    console.error('LINE registration reply failed',response.status,detail);
  }
}

async function handleEvent(event){
  if(event?.type!=='message'||event?.message?.type!=='text')return;
  if(event?.source?.type!=='user'||!event?.source?.userId)return;

  const text=oneLine(event.message.text);
  const match=text.match(/^ลงทะเบียน\s*(เกมส์|อาท)\s*$/u);
  if(!match)return;

  const name=match[1];
  if(!ALLOWED_NAMES.has(name))return;

  try{
    const result=await bindLineUser(name,String(event.source.userId));
    await replyLine(event.replyToken,result.message);
  }catch(error){
    console.error('LINE registration failed',name,error?.message||error);
    await replyLine(event.replyToken,'❌ ลงทะเบียน '+name+' ไม่สำเร็จ กรุณาแจ้งแอดมิน');
    throw error;
  }
}

export async function POST(request){
  const secret=String(process.env.LINE_CHANNEL_SECRET||'').trim();
  if(!secret)return json({success:false,error:'LINE webhook secret is not configured'},503);

  const rawBody=await request.text();
  const signature=request.headers.get('x-line-signature')||'';
  if(!verifyLineSignature(rawBody,signature,secret)){
    return json({success:false,error:'Invalid LINE signature'},401);
  }

  let payload;
  try{payload=JSON.parse(rawBody||'{}');}
  catch{return json({success:false,error:'Invalid JSON body'},400);}

  const events=Array.isArray(payload?.events)?payload.events:[];
  try{
    for(const event of events)await handleEvent(event);
  }catch(error){
    return json({success:false,error:'LINE registration processing failed'},500);
  }

  return json({success:true,events:events.length});
}
