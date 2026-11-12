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
  const signing=String(process.env.CASEMYP_SESSION_SECRET||'');
  if(process.env.CASEMYP_SECURE_GATEWAY!=='true'||url!==`https://${PROJECT}.supabase.co`||secret.length<24||signing.length<32||signing==='replace-with-a-random-strong-session-secret-at-least-32-characters')
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
    if(data.action!=='data')return json(res,400,{message:'Unknown action'});
    const method=String(data.method||'GET').toUpperCase(),table=String(data.table||'');
    if(!TABLES.has(table)||!['GET','POST','PATCH','DELETE'].includes(method))return json(res,403,{message:'Operation not allowed'});
    const admin=user.role==='Admin',sales=user.role==='Sales';
    if(!admin&&!sales)return json(res,403,{message:'Role not allowed'});
    // Until audited row/role policies are available, fail closed for all Sales gateway data requests.
    // This also blocks a direct GET ?select=* from bypassing UI-side Sales filters.
    if(!admin)return json(res,403,{message:'การเข้าถึงข้อมูลของเซลส์ยังรอการตรวจสิทธิ์ในเว็บทดสอบ'});
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
    const body=data.body??null;
    if(method!=='GET'&&body===null)return json(res,400,{message:'Missing body'});
    if(method!=='GET'&&!admin){
      // Require record-scoped mutations; avoid allowing a sales session to update whole tables.
      if((method==='PATCH'||method==='DELETE')&&!('caseid' in query)&&!('id' in query)&&!('case_code' in query))
        return json(res,403,{message:'Record filter required'});
      // Stronger ownership validation is required before enabling sales write access.
      return json(res,403,{message:'การแก้ไขข้อมูลของเซลส์ยังรอการตรวจสิทธิ์ในเว็บทดสอบ'});
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
