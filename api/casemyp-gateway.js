'use strict';
// CaseMYP-New preview-only secure gateway. Do not enable for the old production DB.
// Server-side secrets never appear in public/runtime-config.js.
const crypto=require('node:crypto');
const PROJECT='vujcmmnnakqqjiejavfs';
const COOKIE='casemyp_new_session';
const TTL_MS=8*60*60*1000;
const TABLES=new Set(['users','cases','standalone_cases','case_notes','case_followups','history','notifications','bookings','page_queue_state','targets','bank_logos','line_recipients','profile_images','fcm_tokens','audit_log']);
const ADMIN_ONLY=new Set(['users','page_queue_state','targets','bank_logos','line_recipients','profile_images','fcm_tokens','audit_log']);
const SALES_WRITE=new Set(['cases','standalone_cases','case_notes','case_followups','history','notifications','bookings']);
const PUBLIC_USER_FIELDS='userid,username,name,role,status,avatar,startdate';

function settings(){
  const url=String(process.env.CASEMYP_SUPABASE_URL||'').replace(/\/+$/,'');
  const secret=String(process.env.CASEMYP_SUPABASE_SECRET_KEY||process.env.CASEMYP_SUPABASE_SERVICE_ROLE_KEY||'');
  const signing=String(process.env.CASEMYP_SESSION_SECRET||'') || crypto.createHmac('sha256',secret).update('casemyp-new-session-signing-v1').digest('hex');
  if(url!==`https://${PROJECT}.supabase.co`||secret.length<24||signing.length<32||signing==='replace-with-a-random-strong-session-secret-at-least-32-characters')
    throw new Error('CaseMYP-New gateway not configured');
  return {url,secret,signing};
}
function serverHeaders(secret){
  // sb_secret_* is an opaque API key, not a JWT. Never send it as Bearer.
  const headers={apikey:secret,Accept:'application/json'};
  if(!secret.startsWith('sb_secret_'))headers.Authorization='Bearer '+secret;
  return headers;
}
function json(res,status,body){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  return res.status(status).json(body);
}
function sameOrigin(req){
  const origin=String(req.headers.origin||'');
  const host=String(req.headers.host||'');
  if(!origin||!host)return false;
  try{const u=new URL(origin);return u.protocol==='https:'&&u.host===host;}catch{return false;}
}
function requestBody(req){
  if(typeof req.body==='object'&&req.body!==null)return req.body;
  try{return JSON.parse(req.body||'{}');}catch{return {};}
}
function parseCookies(req){
  const out={};
  for(const p of String(req.headers.cookie||'').split(';')){
    const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=p.slice(i+1).trim();
  }
  return out;
}
function sign(value,secret){
  return crypto.createHmac('sha256',secret).update(value).digest('base64url');
}
function safeEqual(a,b){
  const aa=crypto.createHash('sha256').update(String(a)).digest();
  const bb=crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(aa,bb);
}
function setSession(res,settings,user){
  const payload=Buffer.from(JSON.stringify({uid:String(user.userid),exp:Date.now()+TTL_MS,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');
  const token=payload+'.'+sign(payload,settings.signing);
  res.setHeader('Set-Cookie',`${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/casemyp-gateway; Max-Age=${TTL_MS/1000}`);
}
function clearSession(res){
  res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/casemyp-gateway; Max-Age=0`);
}
function readSession(req,settings){
  const token=parseCookies(req)[COOKIE]||'';
  const [payload,mac,extra]=token.split('.');
  if(!payload||!mac||extra||!safeEqual(mac,sign(payload,settings.signing)))return null;
  try{
    const d=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(!d.uid||!Number.isFinite(d.exp)||d.exp<Date.now()||d.exp>Date.now()+TTL_MS)return null;
    return d;
  }catch{return null;}
}
async function db(settings,table,params={},options={}){
  if(!TABLES.has(table))throw new Error('Table not permitted');
  const url=new URL(settings.url+'/rest/v1/'+table);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const headers=serverHeaders(settings.secret);
  if(options.write){headers['Content-Type']='application/json';headers['Prefer']='return=representation';}
  if(options.range)headers['Range']=options.range;
  const response=await fetch(url,{method:options.method||'GET',headers,body:options.write?JSON.stringify(options.body):undefined});
  const text=await response.text();
  let data;
  try{data=text?JSON.parse(text):[];}catch{data={message:'Invalid database response'};}
  return {status:response.status,data};
}
function userPublic(u){
  return {userId:u.userid,username:u.username,name:u.name,role:u.role,avatar:u.avatar||'',startdate:u.startdate||''};
}
async function currentUser(req,settings){
  const session=readSession(req,settings);if(!session)return null;
  const r=await db(settings,'users',{select:PUBLIC_USER_FIELDS,userid:'eq.'+session.uid,status:'eq.active',limit:1});
  return r.status===200&&Array.isArray(r.data)?r.data[0]||null:null;
}
function validParams(raw){
  if(typeof raw!=='string'||raw.length>4500)throw new Error('Invalid query');
  const p=new URLSearchParams(raw.startsWith('?')?raw.slice(1):raw);
  if([...p.keys()].some(k=>!/^[-_a-zA-Z0-9.]+$/.test(k)))throw new Error('Invalid query');
  const result={};for(const [k,v] of p.entries())result[k]=v;
  return result;
}
async function loginAllowed(config,req,username){
  // Persistent Postgres counter shared by all Vercel serverless instances.
  // Hash identifier before storage; the database never receives raw IP/username.
  const remote=String(req.headers['x-real-ip']||req.headers['x-forwarded-for']||'unknown').split(',')[0].trim().slice(0,120);
  const normalizedUser=String(username).toLowerCase();
  const keys=[
    {v:'account:'+normalizedUser,max:8,window:900},
    {v:'ip:'+remote,max:40,window:900}
  ];
  for(const item of keys){
    const bucket=crypto.createHmac('sha256',config.signing).update(item.v).digest('hex');
    const response=await fetch(config.url+'/rest/v1/rpc/casemyp_check_login_limit',{
      method:'POST',
      headers:{...serverHeaders(config.secret),'Content-Type':'application/json'},
      body:JSON.stringify({p_bucket:bucket,p_max_attempts:item.max,p_window_seconds:item.window})
    });
    if(!response.ok||await response.json()!==true)return false;
  }
  return true;
}

// Confirm ownership using the server credential, never a caller-supplied identity.
async function caseOwned(config,caseid,sales){
  if(!caseid||typeof caseid!=='string')return false;
  const r=await db(config,'cases',{select:'caseid',caseid:'eq.'+caseid,sales:'eq.'+sales,deleted_at:'is.null',limit:1});
  return r.status===200&&Array.isArray(r.data)&&r.data.length===1;
}
async function relatedCaseOwned(config,table,id,sales){
  if(!id||!['bookings','case_notes','case_followups','notifications','standalone_cases'].includes(table))return false;
  const column=table==='standalone_cases'?'id':'id';
  const r=await db(config,table,{select:table==='standalone_cases'?'id,sales':'id,caseid,sales',[column]:'eq.'+String(id),limit:1});
  if(r.status!==200||!Array.isArray(r.data)||r.data.length!==1)return false;
  const row=r.data[0];
  if(table==='notifications')return row.sales===sales;
  if(table==='standalone_cases')return row.sales===sales;
  return row.sales===sales||(typeof row.caseid==='string'&&await caseOwned(config,row.caseid,sales));
}
async function salesCaseIds(config,sales){
  const r=await db(config,'cases',{select:'caseid',sales:'eq.'+sales,deleted_at:'is.null',limit:1000});
  if(r.status!==200||!Array.isArray(r.data))return null;
  return r.data.map(row=>row.caseid).filter(x=>typeof x==='string'&&/^[0-9a-zA-Z-]+$/.test(x));
}
async function salesScope(config,user,table,method,query,body){
  const sales=String(user.name||'');
  if(!sales||sales.length>100)return {allow:false};
  if(method==='GET'){
    if(table==='users'||table==='bank_logos')return {allow:true,query};
    if(table==='cases'&&query.select==='caseid'){
      // Case ID generation must see the global maximum to prevent duplicates.
      return {allow:true,query:{...query,select:'caseid'}};
    }
    if(['cases','bookings','standalone_cases','notifications','targets'].includes(table)){
      query[table==='targets'?'sales_name':'sales']='eq.'+sales;
      query.select='*';return {allow:true,query};
    }
    if(['history','case_notes','case_followups'].includes(table)){
      const ids=await salesCaseIds(config,sales);
      if(!ids)return {allow:false};
      if(!ids.length)return {allow:true,empty:true};
      if(query.caseid?.startsWith('eq.')&&!ids.includes(query.caseid.slice(3)))return {allow:true,empty:true};
      if(!query.caseid||!query.caseid.startsWith('eq.'))query.caseid='in.('+ids.join(',')+')';
      query.select='*';return {allow:true,query};
    }
    return {allow:false};
  }
  if(method==='DELETE'||!SALES_WRITE.has(table)||!body||Array.isArray(body)||typeof body!=='object')return {allow:false};
  if(method==='POST'){
    if(table==='cases'){
      if(!['',sales,'รอมอบหมาย'].includes(String(body.sales||'')))return {allow:false};
      if(!/^[0-9]{7}$/.test(String(body.caseid||'')))return {allow:false};
      return {allow:true,query,body:{...body,sales:String(body.sales||sales)}};
    }
    if(table==='standalone_cases'){
      if(String(body.sales||'')!==sales)return {allow:false};
      return {allow:true,query,body:{...body,created_by:sales}};
    }
    if(table==='notifications')return {allow:String(body.sales||'')===sales,query,body};
    if(!['history','case_notes','case_followups','bookings'].includes(table))return {allow:false};
    if(!await caseOwned(config,String(body.caseid||''),sales))return {allow:false};
    if(table==='bookings'&&body.sales!==sales)return {allow:false};
    if(['case_notes','case_followups'].includes(table)&&body.sales!==sales)return {allow:false};
    return {allow:true,query,body};
  }
  if(method==='PATCH'){
    const rowId=String(query.id||'').startsWith('eq.')?String(query.id).slice(3):'';
    const caseid=String(query.caseid||'').startsWith('eq.')?String(query.caseid).slice(3):'';
    if(table==='cases'){
      if(!caseid||!await caseOwned(config,caseid,sales))return {allow:false};
      if('sales' in body&&body.sales!==sales)return {allow:false};
      query.sales='eq.'+sales;return {allow:true,query,body};
    }
    if(table==='standalone_cases'){
      if(!rowId||!await relatedCaseOwned(config,table,rowId,sales)||('sales' in body&&body.sales!==sales))return {allow:false};
      query.sales='eq.'+sales;return {allow:true,query,body};
    }
    if(table==='bookings'||table==='case_notes'||table==='case_followups'||table==='notifications'){
      if(!rowId||!await relatedCaseOwned(config,table,rowId,sales))return {allow:false};
      if('sales' in body&&body.sales!==sales)return {allow:false};
      return {allow:true,query,body};
    }
    return {allow:false};
  }
  return {allow:false};
}

/* One authenticated server call instead of multiple browser->gateway->database
   round trips for the two CaseMYP operations accounts. This deliberately reuses
   existing cases trigger, optimistic version checks, and history/notification rows. */
function caseNowTH(){
  const d=new Date(Date.now()+7*3600000),pad=n=>String(n).padStart(2,'0');
  return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1)+'/'+d.getUTCFullYear()+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds());
}
function caseResultOk(r){return r.status>=200&&r.status<300&&Array.isArray(r.data);}
function caseFail(status,message,extra={}){return {status,result:{success:false,error:message,...extra}};}
function caseDbError(r){return String(r?.data?.message||r?.data?.details||'ไม่สามารถบันทึกข้อมูลได้').slice(0,250);}
function isCaseUnassigned(s){return !String(s||'').trim()||String(s).trim()==='รอมอบหมาย';}
function caseInputString(value,max=5000){return typeof value==='string'&&value.length<=max?value:null;}
const MAX_QR_DATA_URL_LENGTH=2000000; // < 1.5 MB encoded image, below Vercel's request body limit
function validCaseContact(value){
  if(typeof value!=='string')return false;
  if(value.length<=5000)return true; // existing phone, LINE ID or image URL behavior
  // QR images from ImageUploader are encoded as base64 in the contact field.
  // Validate the entire MIME/data URI and enforce a strict upper bound.
  if(value.length>MAX_QR_DATA_URL_LENGTH)return false;
  return /^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
}
function validCasePayload(p){
  if(!p||Array.isArray(p)||typeof p!=='object')return false;
  const fields=['customername','contact','report','status','sales','createdat','updatedat','sent','attachment','caseid','casePrefix','note','lineSender','detail','changedBy','newSales','createdBy'];
  return fields.every(k=>p[k]===undefined||(k==='contact'?validCaseContact(p[k]):caseInputString(p[k],k==='attachment'?100000:k==='report'?30000:5000)!==null));
}
async function caseCreate(config,user,p){
  if(!validCasePayload(p))return caseFail(400,'ข้อมูลเคสไม่ถูกต้อง');
  if(!String(p.customername||'').trim())return caseFail(400,'กรุณากรอกชื่อลูกค้า');
  const ts=p.createdat||caseNowTH(),prefix=p.casePrefix||String(new Date(Date.now()+7*3600000).getUTCFullYear()).slice(-2)+String(new Date(Date.now()+7*3600000).getUTCMonth()+1).padStart(2,'0');
  if(!/^\d{4}$/.test(prefix)||p.caseid&&!/^\d{7}$/.test(p.caseid))return caseFail(400,'รหัสเคสไม่ถูกต้อง');
  const assigned=String(p.sales||'').trim()||'รอมอบหมาย';
  const row={customername:p.customername,contact:p.contact||'',report:p.report||'',status:p.status||'รอข้อมูล',sales:assigned,createdat:ts,updatedat:p.updatedat||ts,sent:p.sent||'ปกติ',attachment:p.attachment||'',version:1};
  const max=await db(config,'cases',{select:'caseid',caseid:'like.'+prefix+'*',order:'caseid.desc',limit:1});
  if(!caseResultOk(max))return caseFail(502,caseDbError(max));
  const top=String(max.data[0]?.caseid||'');
  const seq=top.startsWith(prefix)?Number.parseInt(top.slice(4),10)||0:0;
  let inserted=null,caseid='';
  for(let attempt=0;attempt<(p.caseid?1:8);attempt++){
    caseid=p.caseid||prefix+String(seq+attempt+1).padStart(3,'0');
    const response=await db(config,'cases',{}, {method:'POST',write:true,body:{...row,caseid}});
    if(caseResultOk(response)&&response.data.length){inserted=response.data[0];break;}
    if(response.status===409&&response.data?.code==='23505'&&!p.caseid)continue;
    return caseFail(response.status>=400&&response.status<600?response.status:502,caseDbError(response));
  }
  if(!inserted)return caseFail(409,'รหัสเคสซ้ำหลายครั้ง กรุณาลองใหม่');
  const sales=String(inserted.sales||assigned);
  const actor=user.name||'แอดมิน';
  const note=String(p.note||'').trim();
  const sender=['เกมส์','อาท'].includes(p.lineSender)?p.lineSender:'';
  const actorNote=sender?' | ผู้ส่ง LINE: '+sender:'';
  async function writeRow(table,body){
    try{const r=await db(config,table,{}, {method:'POST',write:true,body});return caseResultOk(r);}catch{return false;}
  }
  const [historySaved,noteOutcome,notificationSaved]=await Promise.all([
    writeRow('history',{caseid,sales:actor,action:'เพิ่มเคส',detail:'เพิ่มเคสใหม่: '+p.customername+(isCaseUnassigned(sales)?' — รอมอบหมายเซลส์':' — มอบหมายให้ '+sales)+actorNote,createdat:caseNowTH()}),
    (async()=>{
      if(!note)return {noteSaved:true,noteHistorySaved:true};
      const noteSaved=await writeRow('case_notes',{caseid,sales:actor,note,createdat:ts,deletedat:null});
      const noteHistorySaved=noteSaved?await writeRow('history',{caseid,sales:actor,action:'📝 Note',detail:'📝 Note: '+note,createdat:caseNowTH()}):true;
      return {noteSaved,noteHistorySaved};
    })(),
    isCaseUnassigned(sales)?Promise.resolve(true):writeRow('notifications',{sales,caseid,message:'📋 ได้รับมอบหมายเคสใหม่ '+caseid+' ('+p.customername+')',createdat:caseNowTH(),status:'unread'})
  ]);
  return {status:200,result:{success:true,caseId:caseid,sales,unassigned:isCaseUnassigned(sales),historySaved:historySaved&&noteOutcome.noteHistorySaved,noteSaved:noteOutcome.noteSaved,notificationSaved}};
}
async function caseUpdate(config,user,p){
  if(!validCasePayload(p)||!p.caseid||p.caseid.length>64)return caseFail(400,'ข้อมูลเคสไม่ถูกต้อง');
  const old=await db(config,'cases',{caseid:'eq.'+p.caseid,deleted_at:'is.null',limit:1});
  if(!caseResultOk(old))return caseFail(502,caseDbError(old));
  const before=old.data[0];
  if(!before)return caseFail(404,'ไม่พบเคส หรือเคสอยู่ในถังขยะแล้ว');
  const version=Number(before.version)||1;
  if(p.expectedVersion!==undefined&&Number(p.expectedVersion)!==version)return caseFail(409,'เคสนี้ถูกแก้จากอุปกรณ์อื่น กรุณารีเฟรชก่อนบันทึก',{conflict:true});
  const upd={updatedat:caseNowTH(),version:version+1};
  for(const field of ['status','report','sales','customername','contact','sent','attachment'])if(p[field]!==undefined)upd[field]=p[field];
  const changingSales=user.role==='Admin'&&typeof p.newSales==='string'&&p.newSales.trim()&&p.newSales!==before.sales;
  if(changingSales){
    upd.sales=p.newSales;
    upd.assigned_at=new Date().toISOString();
    upd.assigned_by=user.name||'แอดมิน';
  }
  const updated=await db(config,'cases',{caseid:'eq.'+p.caseid,deleted_at:'is.null',version:'eq.'+version},{method:'PATCH',write:true,body:upd});
  if(!caseResultOk(updated))return caseFail(502,caseDbError(updated));
  if(!updated.data.length)return caseFail(409,'เคสนี้ถูกแก้จากอุปกรณ์อื่น กรุณารีเฟรชก่อนบันทึก',{conflict:true});
  const actor=user.name||'ระบบ',changed=[];
  for(const field of ['status','sales','customername','contact','report','attachment'])
    if(upd[field]!==undefined&&String(upd[field]??'')!==String(before[field]??''))changed.push(field+': '+String(before[field]??'-')+' → '+String(upd[field]??'-'));
  async function writeRow(table,body){
    try{const r=await db(config,table,{}, {method:'POST',write:true,body});return caseResultOk(r);}catch{return false;}
  }
  const tasks=[
    writeRow('history',{caseid:p.caseid,sales:actor,action:'แก้ไข',detail:p.detail||changed.join(' | ')||'บันทึกข้อมูล',createdat:caseNowTH()})
  ];
  if(changingSales)tasks.push(writeRow('history',{caseid:p.caseid,sales:actor,action:'มอบหมายเคส',detail:'มอบหมาย '+(before.sales||'รอมอบหมาย')+' → '+p.newSales,createdat:caseNowTH()}));
  const notify=changingSales&&!isCaseUnassigned(p.newSales)
    ?writeRow('notifications',{sales:p.newSales,caseid:p.caseid,message:'📋 ได้รับมอบหมายเคส '+p.caseid+' ('+(p.customername||before.customername||'')+')',createdat:caseNowTH(),status:'unread'})
    :Promise.resolve(true);
  const [historyResults,notificationSaved]=await Promise.all([Promise.all(tasks),notify]);
  return {status:200,result:{success:true,data:updated.data[0],historySaved:historyResults.every(Boolean),notificationSaved}};
}

function workflowThaiDigits(text){
  return String(text||'').replace(/[๐-๙]/g,d=>'0123456789'['๐๑๒๓๔๕๖๗๘๙'.indexOf(d)]);
}
function workflowDigits(text){return workflowThaiDigits(text).replace(/[^0-9]/g,'');}
function workflowLoose(text){return workflowThaiDigits(text).normalize('NFKC').toLowerCase().replace(/[\s\-_.()\/\\:;,'"\x60~!@#$%^&*+=\[\]{}|<>?]+/g,'');}
async function legacyDuplicateCheck(config,p){
  if(p.duplicateConfirmed)return {status:200};
  const response=await db(config,'cases',{select:'caseid,customername,contact',deleted_at:'is.null',order:'updatedat.desc',limit:10000});
  if(!caseResultOk(response))return caseFail(502,caseDbError(response));
  const c=workflowDigits(p.contact),n=workflowLoose(p.customername);
  const matches=response.data.filter(row=>{
    if(p.previewId&&String(row.caseid)===String(p.previewId))return true;
    const other=workflowDigits(row.contact);
    return c.length>=6&&other===c||(n.length>=3&&workflowLoose(row.customername)===n&&c.length>=3&&other.includes(c));
  }).slice(0,10);
  if(matches.length)return {status:200,result:{success:false,duplicates:matches,error:'พบเคสที่อาจซ้ำ กรุณาตรวจสอบก่อน'}};
  return {status:200};
}
async function oneCallSave(config,user,data){
  const started=Date.now();
  let response,body;
  try{
    response=await fetch(config.url+'/rest/v1/rpc/casemyp_save_case_v1',{
      method:'POST',
      headers:{...serverHeaders(config.secret),'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({p_operation:data.operation,p_payload:data.payload,p_actor_userid:user.userid})
    });
    body=await response.json().catch(()=>({}));
  }catch(error){
    console.error('CaseMYP fast RPC network failure:',String(error?.message||error).slice(0,130));
    return caseFail(502,'เชื่อมต่อฐานข้อมูลเพื่อบันทึกเคสไม่สำเร็จ');
  }finally{
    console.info('CaseMYP save RPC duration_ms='+String(Date.now()-started)+' operation='+String(data.operation).slice(0,10));
  }
  // Before the additive migration is installed, retain original saving behavior.
  // Do not fallback on an arbitrary RPC error: an ambiguous response could hide a committed write.
  if(response.status===404&&body?.code==='PGRST202')return null;
  if(!response.ok){
    console.error('CaseMYP save RPC error status='+response.status+' code='+String(body?.code||''));
    return caseFail(response.status===401||response.status===403?403:502,
      'บันทึกข้อมูลไม่สำเร็จ: '+String(body?.message||body?.details||'กรุณาลองอีกครั้ง').slice(0,200));
  }
  if(!body||typeof body!=='object'||typeof body.success!=='boolean')
    return caseFail(502,'รูปแบบผลบันทึกไม่ถูกต้อง กรุณาตรวจสอบเคสก่อนลองซ้ำ');
  // Duplicate/conflict responses are deliberate and not transport errors.
  return {status:200,result:body};
}
async function fastCaseWorkflow(config,user,data){
  if(user.role!=='Admin'&&!(user.role==='Sales'&&user.username==='art'))
    return caseFail(403,'ไม่มีสิทธิ์แก้ไขเคส');
  if(!['create','update'].includes(data.operation)||!validCasePayload(data.payload))
    return caseFail(400,'ข้อมูลเคสไม่ถูกต้อง');
  const outcome=await oneCallSave(config,user,data);
  if(outcome)return outcome;
  // Database RPC not yet deployed: preserve duplicate confirmation and legacy writes.
  if(data.operation==='create'){
    const dup=await legacyDuplicateCheck(config,data.payload);
    if(dup.result||dup.status!==200)return dup;
    return caseCreate(config,user,data.payload);
  }
  return caseUpdate(config,user,data.payload);
}

async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{message:'Method not allowed'});
  if(!sameOrigin(req))return json(res,403,{message:'Origin mismatch'});
  let config;
  try{config=settings();}catch{return json(res,503,{message:'ระบบล็อกอินฝั่งเซิร์ฟเวอร์ยังไม่ได้ตั้งค่า'});}
  const data=requestBody(req);
  try{
    if(data.action==='login'){
      const username=String(data.username||'').trim(),password=String(data.password||'');
      if(!username||username.length>80||!password||password.length>256)return json(res,401,{message:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'});
      if(!await loginAllowed(config,req,username))return json(res,429,{message:'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'});
      const r=await db(config,'users',{select:'userid,username,password,name,role,status,avatar,startdate',username:'eq.'+username,status:'eq.active',limit:2});
      if(r.status!==200)return json(res,502,{message:'ไม่สามารถตรวจสอบบัญชีได้'});
      const user=Array.isArray(r.data)&&r.data.length===1?r.data[0]:null;
      if(!user||!safeEqual(user.password??'',password))return json(res,401,{message:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'});
      setSession(res,config,user);
      return json(res,200,{success:true,user:userPublic(user)});
    }
    if(data.action==='logout'){clearSession(res);return json(res,200,{success:true});}
    const user=await currentUser(req,config);
    if(!user)return json(res,401,{message:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'});
    if(data.action==='session')return json(res,200,{success:true,user:userPublic(user)});
    if(data.action==='caseWorkflow'){
      const outcome=await fastCaseWorkflow(config,user,data);
      return json(res,outcome.status,outcome.result);
    }
    if(data.action!=='data')return json(res,400,{message:'Unknown action'});
    const method=String(data.method||'GET').toUpperCase(),table=String(data.table||'');
    if(!TABLES.has(table)||!['GET','POST','PATCH','DELETE'].includes(method))return json(res,403,{message:'Operation not allowed'});
    const admin=user.role==='Admin',sales=user.role==='Sales';
    // This existing two-person operations account submits cases for other assigned salespeople.
    // Permit case workflow access without granting user or security-setting mutations.
    const operator=sales&&user.username==='art';
    if(operator&&method!=='GET'&&['users','bank_logos','line_recipients','profile_images','fcm_tokens','audit_log'].includes(table))return json(res,403,{message:'Operation not allowed for operator'});
    if(!admin&&!sales)return json(res,403,{message:'Role not allowed'});
    // Sales requests are constrained to the authenticated user's scope server-side.
    // Admin functionality stays unchanged for the isolated preview.
    if(!admin&&(!sales||!String(user.name||'')))return json(res,403,{message:'Permission denied'});
    let query=validParams(data.query||'');
    if(table==='users'){
      // Allow only the existing user-list search and sorting. Never permit password filters.
      const allowed=new Set(['select','order','limit','offset','userid','username','name','role','status','auth_user_id']);
      if(Object.keys(query).some(k=>!allowed.has(k)))return json(res,403,{message:'User filter not allowed'});
      // Prevent credential exposure even for returning POST/PATCH representations.
      query.select=PUBLIC_USER_FIELDS;
    }
    const range=String(data.range||'');
    if(range&&!/^\d{1,6}-\d{1,6}$/.test(range))return json(res,400,{message:'Invalid range'});
    if(range){const [start,end]=range.split('-').map(Number);if(end<start||end-start>4999)return json(res,400,{message:'Range too large'});}
    let body=data.body??null;
    if(method!=='GET'&&body===null)return json(res,400,{message:'Missing body'});
    if(!admin&&!operator){
      const scope=await salesScope(config,user,table,method,query,body);
      if(!scope.allow)return json(res,403,{message:'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้'});
      if(scope.empty)return json(res,200,[]);
      query=scope.query;body=scope.body??body;
    }
    const result=await db(config,table,query,{method,write:method!=='GET',body,range});
    if(table==='users'&&Array.isArray(result.data)){
      result.data=result.data.map(({password,...safe})=>safe);
    }
    return json(res,result.status,result.data);
  }catch(error){
    console.error('CaseMYP-New gateway:',error?.message||error);
    return json(res,500,{message:'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์'});
  }
}
module.exports=handler;
