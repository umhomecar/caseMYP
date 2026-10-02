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
  const key=String(process.env.CASEMYP_SUPABASE_SECRET_KEY||process.env.CASEMYP_SUPABASE_SERVICE_ROLE_KEY||'').trim();
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

function assertServerDbConfig(){
  const {url,key}=supabaseConfig();
  if(!url||!key){
    const error=new Error('CASEMYP server database secret is not configured');
    error.code='server_db_not_configured';
    throw error;
  }
  return{url,key};
}

async function fetchRecipientByName(name){
  const {url,key}=assertServerDbConfig();
  const endpoint=new URL(url+'/rest/v1/line_recipients');
  endpoint.searchParams.set('select','sender_name,line_user_id,active,registered_at,updated_at');
  endpoint.searchParams.set('sender_name','eq.'+name);
  endpoint.searchParams.set('limit','1');
  const response=await fetch(endpoint,{headers:sbHeaders(key)});
  if(!response.ok){
    const detail=oneLine(await response.text().catch(()=>''));
    const error=new Error('Supabase LINE recipient lookup failed: '+response.status+(detail?' '+detail:''));
    error.status=response.status;
    throw error;
  }
  const rows=await response.json();
  return Array.isArray(rows)?rows[0]||null:null;
}

async function fetchRecipientByLineId(lineUserId){
  const {url,key}=assertServerDbConfig();
  const endpoint=new URL(url+'/rest/v1/line_recipients');
  endpoint.searchParams.set('select','sender_name,line_user_id,active');
  endpoint.searchParams.set('line_user_id','eq.'+lineUserId);
  endpoint.searchParams.set('limit','1');
  const response=await fetch(endpoint,{headers:sbHeaders(key)});
  if(!response.ok){
    const detail=oneLine(await response.text().catch(()=>''));
    const error=new Error('Supabase LINE recipient reverse lookup failed: '+response.status+(detail?' '+detail:''));
    error.status=response.status;
    throw error;
  }
  const rows=await response.json();
  return Array.isArray(rows)?rows[0]||null:null;
}

async function bindLineRecipient(name,lineUserId){
  const {url,key}=assertServerDbConfig();

  const target=await fetchRecipientByName(name);
  if(!target){
    return{ok:false,message:'ยังไม่ได้ติดตั้งข้อมูลผู้ส่งเคส '+name+' ใน CASE_MYP'};
  }
  if(target.active===false){
    return{ok:false,message:'ผู้ส่งเคส '+name+' ถูกปิดใช้งานอยู่'};
  }

  const existingForName=oneLine(target.line_user_id);
  if(existingForName){
    if(existingForName===lineUserId){
      return{ok:true,message:'✅ '+name+' ลงทะเบียน LINE นี้ไว้แล้ว\nพร้อมรับเคสจาก CASE_MYP'};
    }
    return{
      ok:false,
      message:'🔒 '+name+' ลงทะเบียนกับ LINE อื่นไว้แล้ว\nหากต้องการเปลี่ยน LINE กรุณาให้แอดมินล้างการลงทะเบียนเดิมก่อน'
    };
  }

  const existingForLine=await fetchRecipientByLineId(lineUserId);
  if(existingForLine&&oneLine(existingForLine.sender_name)!==name){
    return{
      ok:false,
      message:'LINE นี้ถูกลงทะเบียนเป็น '+oneLine(existingForLine.sender_name)+' อยู่แล้ว กรุณาแจ้งแอดมิน'
    };
  }

  const endpoint=new URL(url+'/rest/v1/line_recipients');
  endpoint.searchParams.set('sender_name','eq.'+name);
  endpoint.searchParams.set('line_user_id','is.null');
  const now=new Date().toISOString();
  const response=await fetch(endpoint,{
    method:'PATCH',
    headers:sbHeaders(key,{Prefer:'return=representation'}),
    body:JSON.stringify({line_user_id:lineUserId,registered_at:now,updated_at:now})
  });
  if(!response.ok){
    const detail=oneLine(await response.text().catch(()=>''));
    throw new Error('Supabase LINE registration failed: '+response.status+(detail?' '+detail:''));
  }

  const rows=await response.json().catch(()=>[]);
  if(!Array.isArray(rows)||!rows.length){
    const latest=await fetchRecipientByName(name);
    if(oneLine(latest?.line_user_id)===lineUserId){
      return{ok:true,message:'✅ '+name+' ลงทะเบียน LINE นี้ไว้แล้ว\nพร้อมรับเคสจาก CASE_MYP'};
    }
    return{ok:false,message:'ลงทะเบียน '+name+' ไม่สำเร็จ เพราะมีการเปลี่ยนข้อมูลพร้อมกัน กรุณาลองใหม่'};
  }

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
    const result=await bindLineRecipient(name,String(event.source.userId));
    await replyLine(event.replyToken,result.message);
  }catch(error){
    console.error('LINE registration failed',name,error?.message||error);
    const message=error?.code==='server_db_not_configured'
      ?'❌ ระบบยังไม่ได้ตั้งค่า Supabase Secret key สำหรับ CASE_MYP กรุณาแจ้งแอดมิน'
      :'❌ ลงทะเบียน '+name+' ไม่สำเร็จ กรุณาแจ้งแอดมิน';
    await replyLine(event.replyToken,message);
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
