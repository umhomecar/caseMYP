const crypto=require('node:crypto');

const DIRECT_LINE_SENDERS=new Set(['เกมส์','อาท']);

function oneLine(value){
  return String(value ?? '').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim();
}

function contactLabel(contactBy){
  const type=oneLine(contactBy);
  if(type==='เบอร์')return 'เบอร์';
  if(type==='ไลน์')return 'ไลน์';
  if(type==='เบอร์&ไลน์')return 'เบอร์/ไลน์';
  return 'ข้อมูลติดต่อ';
}

function safeLineDetail(raw){
  const text=String(raw||'').trim();
  if(!text)return '';
  try{
    const parsed=JSON.parse(text);
    const parts=[];
    if(parsed?.message)parts.push(oneLine(parsed.message));
    if(Array.isArray(parsed?.details)){
      parsed.details.slice(0,3).forEach(d=>{
        const msg=oneLine(d?.message||'');
        const prop=oneLine(d?.property||'');
        if(msg)parts.push((prop?prop+': ':'')+msg);
      });
    }
    return parts.join(' · ').slice(0,400);
  }catch(e){
    return oneLine(text).slice(0,400);
  }
}

function getSupabaseUrl(){
  return String(process.env.CASEMYP_SUPABASE_URL||'').trim().replace(/\/$/,'');
}

function getPublicSupabaseKey(){
  return String(process.env.CASEMYP_SUPABASE_ANON_KEY||'').trim();
}

function getServerSupabaseKey(){
  return String(process.env.CASEMYP_SUPABASE_SERVICE_ROLE_KEY||'').trim();
}

async function supabaseRows(table,params,{serverOnly=false}={}){
  const url=getSupabaseUrl();
  const key=serverOnly?getServerSupabaseKey():(getServerSupabaseKey()||getPublicSupabaseKey());
  if(!url||!key){
    const error=new Error(serverOnly
      ?'CASEMYP_SUPABASE_SERVICE_ROLE_KEY is not configured'
      :'CASEMYP Supabase is not configured');
    error.code=serverOnly?'server_db_not_configured':'db_not_configured';
    throw error;
  }

  const endpoint=new URL(url+'/rest/v1/'+table);
  Object.entries(params||{}).forEach(([k,v])=>endpoint.searchParams.set(k,String(v)));
  const response=await fetch(endpoint,{
    headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}
  });
  if(!response.ok){
    const detail=oneLine(await response.text().catch(()=>''));
    const error=new Error('Supabase '+table+' lookup failed: '+response.status+(detail?' '+detail:''));
    error.status=response.status;
    throw error;
  }
  const rows=await response.json();
  return Array.isArray(rows)?rows:[];
}

async function getRegisteredLineUserId(senderName){
  const rows=await supabaseRows('line_recipients',{
    select:'sender_name,line_user_id,active',
    sender_name:'eq.'+senderName,
    active:'eq.true',
    limit:'1'
  },{serverOnly:true});
  const lineUserId=oneLine(rows[0]?.line_user_id);
  return /^U[0-9a-f]{32}$/i.test(lineUserId)?lineUserId:'';
}

async function inferLineSender(caseId){
  if(!caseId)return '';
  try{
    const rows=await supabaseRows('history',{
      select:'sales,detail,action,id',
      caseid:'eq.'+caseId,
      action:'eq.เพิ่มเคส',
      order:'id.asc',
      limit:'1'
    });
    const row=rows[0];
    if(!row)return '';
    const detail=oneLine(row.detail);
    const match=detail.match(/ผู้ส่ง LINE:\s*(เกมส์|อาท)/u);
    if(match&&DIRECT_LINE_SENDERS.has(match[1]))return match[1];
    const creator=oneLine(row.sales);
    return DIRECT_LINE_SENDERS.has(creator)?creator:'';
  }catch(error){
    console.error('LINE sender inference failed',caseId,error?.message||error);
    return '';
  }
}

async function resolveLineTarget(senderName,caseId,legacyGroupId){
  let sender=oneLine(senderName);
  if(!sender)sender=await inferLineSender(caseId);

  if(sender){
    if(!DIRECT_LINE_SENDERS.has(sender)){
      return{error:'ผู้ส่ง LINE ไม่ถูกต้อง',recipientMissing:true,recipientName:sender};
    }
    const userId=await getRegisteredLineUserId(sender);
    if(!userId){
      return{
        error:sender+' ยังไม่ได้ลงทะเบียน LINE กับ Um-Bot',
        recipientMissing:true,
        recipientName:sender
      };
    }
    return{targetId:userId,targetType:'user',recipientName:sender};
  }

  if(legacyGroupId){
    return{targetId:legacyGroupId,targetType:'group',recipientName:''};
  }

  return{error:'ยังไม่ได้ตั้งค่าปลายทาง LINE',recipientMissing:true,recipientName:''};
}

async function diagnoseGroupFailure(token,groupId){
  try{
    const response=await fetch('https://api.line.me/v2/bot/group/'+encodeURIComponent(groupId)+'/summary',{
      headers:{Authorization:'Bearer '+token}
    });
    if(response.ok)return{groupReachable:true};
    const raw=await response.text().catch(()=>'');
    return{groupReachable:false,groupStatus:response.status,groupDetail:safeLineDetail(raw)};
  }catch(error){
    return{groupReachable:null,groupError:oneLine(error?.message||error)};
  }
}

function friendlyLineError(status,detail,diagnostic={}){
  if(status===401)return 'LINE Channel Access Token ไม่ถูกต้องหรือหมดอายุ';
  if(status===429){
    const d=String(detail||'').toLowerCase();
    if(d.includes('monthly limit')||d.includes('target limit'))return 'โควตาการส่ง LINE เดือนนี้เต็ม กรุณาตรวจแพ็กเกจหรือโควตาใน LINE Official Account';
    return 'LINE จำกัดความถี่การส่งชั่วคราว กรุณารอสักครู่ก่อนส่งใหม่';
  }
  if(status>=500)return 'ระบบ LINE ขัดข้องชั่วคราว กรุณาลองส่งใหม่อีกครั้ง';
  if(diagnostic.groupReachable===false){
    if(diagnostic.groupStatus===401)return 'LINE Channel Access Token ไม่ถูกต้องหรือหมดอายุ';
    if(diagnostic.groupStatus===404)return 'ไม่พบกลุ่ม LINE หรือบอทไม่ได้อยู่ในกลุ่มที่ตั้งค่าไว้';
    if(diagnostic.groupStatus===403)return 'บอทไม่มีสิทธิ์เข้าถึงกลุ่ม LINE ที่ตั้งค่าไว้';
  }
  if(status===403)return 'LINE ไม่อนุญาตให้บอทส่งข้อความไปยังปลายทางนี้';
  if(status===404)return 'ไม่พบปลายทาง LINE ที่ตั้งค่าไว้';
  if(status===400)return detail?'LINE ปฏิเสธข้อมูลที่ส่ง: '+detail:'LINE ปฏิเสธข้อมูลที่ส่ง กรุณาตรวจข้อมูลปลายทางและข้อความ';
  return detail?'LINE ส่งข้อความไม่สำเร็จ: '+detail:'LINE ส่งข้อความไม่สำเร็จ (HTTP '+status+')';
}

function qrSignature(caseId,token){
  return crypto.createHmac('sha256',token)
    .update('case-myp-line-qr:'+caseId)
    .digest('hex')
    .slice(0,32);
}

async function lineNotificationEnabled(){
  const supaUrl=getSupabaseUrl();
  const supaKey=getPublicSupabaseKey()||getServerSupabaseKey();
  if(!supaUrl||!supaKey)return true;

  try{
    const url=new URL(supaUrl+'/rest/v1/targets');
    url.searchParams.set('select','target_value');
    url.searchParams.set('month_key','eq.__system__');
    url.searchParams.set('sales_name','eq.__line_notifications__');
    url.searchParams.set('limit','1');
    const response=await fetch(url,{
      headers:{
        apikey:supaKey,
        Authorization:'Bearer '+supaKey,
        Accept:'application/json'
      }
    });
    if(!response.ok)throw new Error('Supabase setting read failed: '+response.status);
    const rows=await response.json();
    return !Array.isArray(rows)||!rows.length?true:Number(rows[0].target_value)!==0;
  }catch(error){
    console.error('LINE setting check failed; defaulting to enabled',error?.message||error);
    return true;
  }
}

module.exports = async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({success:false,error:'Method not allowed'});
  }

  const token=String(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();
  const legacyGroupId=String(process.env.LINE_GROUP_ID||'').trim();
  const allowedOrigin=String(process.env.CASEMYP_ALLOWED_ORIGIN||'').trim().replace(/\/$/,'');
  const requestOrigin=String(req.headers.origin||'').trim().replace(/\/$/,'');

  if(allowedOrigin&&requestOrigin&&requestOrigin!==allowedOrigin){
    return res.status(403).json({success:false,error:'Origin not allowed'});
  }

  const enabled=await lineNotificationEnabled();
  if(!enabled){
    return res.status(200).json({success:true,skipped:true,reason:'disabled'});
  }

  if(!token){
    return res.status(503).json({success:false,error:'LINE notification is not configured'});
  }

  let body={};
  try{
    body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  }catch(e){
    return res.status(400).json({success:false,error:'Invalid JSON body'});
  }

  const caseId=oneLine(body.caseId||body.caseid);
  const customername=oneLine(body.customername);
  const contact=oneLine(body.contact);
  const contactBy=oneLine(body.contact_by);
  const hasContact=Boolean(body.hasContact||contact);
  const status=oneLine(body.status)||'รอข้อมูล';
  const sales=oneLine(body.sales)||'รอมอบหมาย';
  const note=oneLine(body.note);
  const requestedSender=oneLine(body.sender||body.lineSender);

  if(!caseId||!customername){
    return res.status(400).json({success:false,error:'Missing caseId or customername'});
  }

  let target;
  try{
    target=await resolveLineTarget(requestedSender,caseId,legacyGroupId);
  }catch(error){
    console.error('LINE target lookup failed',error?.message||error);
    const message=error?.code==='server_db_not_configured'
      ?'ยังไม่ได้ตั้งค่า CASEMYP_SUPABASE_SERVICE_ROLE_KEY สำหรับระบบ LINE 1:1'
      :'ค้นหาปลายทาง LINE ไม่สำเร็จ กรุณาลองใหม่';
    return res.status(503).json({success:false,error:message});
  }
  if(target.error){
    return res.status(409).json({
      success:false,
      error:target.error,
      recipientMissing:Boolean(target.recipientMissing),
      recipientName:target.recipientName||''
    });
  }

  const isQr=contactBy==='QR Code';
  const lines=[
    'รหัสเคส: '+caseId,
    'ชื่อลูกค้า: '+customername,
    isQr?'ติดต่อ: QR Code':contactLabel(contactBy)+': '+(contact||'-'),
    'สถานะ: '+status,
    'เซลส์: '+sales
  ];
  if(note)lines.push('หมายเหตุ: '+note);
  const text=lines.join('\n');
  const messages=[{type:'text',text}];

  if(isQr&&hasContact){
    const baseUrl=allowedOrigin||('https://'+String(req.headers.host||'').trim());
    if(baseUrl&&/^https:\/\//i.test(baseUrl)){
      const sig=qrSignature(caseId,token);
      const imageUrl=baseUrl.replace(/\/$/,'')+'/api/line-qr-image?caseId='+encodeURIComponent(caseId)+'&sig='+encodeURIComponent(sig);
      messages.push({
        type:'image',
        originalContentUrl:imageUrl,
        previewImageUrl:imageUrl
      });
    }
  }

  try{
    const lineRes=await fetch('https://api.line.me/v2/bot/message/push',{
      method:'POST',
      headers:{
        'Authorization':'Bearer '+token,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({to:target.targetId,messages})
    });

    if(!lineRes.ok){
      const rawDetail=await lineRes.text().catch(()=>'');
      const detail=safeLineDetail(rawDetail);
      const requestId=oneLine(lineRes.headers.get('x-line-request-id')||'');

      if(lineRes.status===429){
        const error=friendlyLineError(429,detail,{});
        console.error('LINE push rate limited',429,detail,requestId);
        return res.status(429).json({
          success:false,
          error,
          lineStatus:429,
          detail,
          retryable:false,
          cooldownSeconds:60,
          lineRequestId:requestId,
          recipientName:target.recipientName||''
        });
      }

      const diagnostic=target.targetType==='group'
        ?await diagnoseGroupFailure(token,target.targetId)
        :{};
      const error=friendlyLineError(lineRes.status,detail,diagnostic);
      console.error('LINE push failed',lineRes.status,detail,diagnostic,requestId);
      return res.status(502).json({
        success:false,
        error,
        lineStatus:lineRes.status,
        detail,
        groupReachable:diagnostic.groupReachable,
        groupStatus:diagnostic.groupStatus||null,
        lineRequestId:requestId,
        recipientName:target.recipientName||''
      });
    }
    return res.status(200).json({
      success:true,
      imageIncluded:messages.length>1,
      targetType:target.targetType,
      recipientName:target.recipientName||''
    });
  }catch(error){
    console.error('LINE push error',error?.message||error);
    return res.status(502).json({success:false,error:'เชื่อมต่อ LINE API ไม่สำเร็จ กรุณาลองใหม่',detail:oneLine(error?.message||error)});
  }
};
