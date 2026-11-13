'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/casemyp-gateway.js');
const PROJECT='vujcmmnnakqqjiejavfs';
const exampleUser={userid:'A001',username:'admin',password:'test-only-password',name:'Administrator',role:'Admin',status:'active',avatar:'',startdate:''};
function setup(){
  process.env.CASEMYP_SUPABASE_URL='https://'+PROJECT+'.supabase.co';
  process.env.CASEMYP_SUPABASE_SECRET_KEY='example-secret-key-for-tests-only';
  process.env.CASEMYP_SESSION_SECRET='test-signing-secret-with-more-than-32-characters';
  process.env.CASEMYP_SECURE_GATEWAY='true';
}
function req(body,cookie){
  return{method:'POST',headers:{host:'preview.example',origin:'https://preview.example',...(cookie?{cookie}:{})},body};
}
function res(){
  return{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
}
function fakeDb(){
  const seen=[];
  global.fetch=async(url,opts)=>{
    const parsed=new URL(url);seen.push(parsed);
    const table=parsed.pathname.split('/').pop();
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='users'){
      const query=parsed.searchParams;
      if(query.get('username')==='eq.wrong')return new Response('[]',{status:200});
      const {password,...safe}=exampleUser;
      return new Response(JSON.stringify([query.get('select')?.split(',').includes('password')?exampleUser:safe]),{status:200});
    }
    return new Response(JSON.stringify([{caseid:'2601001'}]),{status:200});
  };
  return seen;
}
test('new database gateway is enabled by backend key without a new flag',async()=>{
  setup();process.env.CASEMYP_SECURE_GATEWAY='false';
  fakeDb();
  const result=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),result);
  assert.equal(result.statusCode,200);
});
test('rejects cross-origin requests',async()=>{
  setup();const input=req({action:'login'});input.headers.origin='https://attacker.example';
  const result=res();await handler(input,result);
  assert.equal(result.statusCode,403);
});
test('rejects an invalid legacy password without setting a session',async()=>{
  setup();fakeDb();
  const result=res();await handler(req({action:'login',username:'admin',password:'wrong-password'}),result);
  assert.equal(result.statusCode,401);assert.equal(result.headers['Set-Cookie'],undefined);
});
test('logs in server-side with an HTTP-only cookie and no returned password',async()=>{
  setup();fakeDb();
  const result=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),result);
  assert.equal(result.statusCode,200);assert.equal(result.body.success,true);
  assert.equal(result.body.user.username,'admin');
  assert.equal(JSON.stringify(result.body).includes('test-only-password'),false);
  assert.match(result.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);
});
test('rejects anonymous reads and strips user credential fields from authenticated reads',async()=>{
  setup();const seen=fakeDb();
  const deny=res();await handler(req({action:'data',table:'cases',method:'GET',query:''}),deny);
  assert.equal(deny.statusCode,401);
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const output=res();await handler(req({action:'data',table:'users',method:'GET',query:'?select=*'},cookie),output);
  assert.equal(output.statusCode,200);
  assert.equal(Object.hasOwn(output.body[0],'password'),false);
  assert.equal(seen.at(-1).searchParams.get('select').includes('password'),false);
});
test('rejects a Sales write while ownership authorization is unfinished',async()=>{
  setup();
  global.fetch=async(url)=>{
    const parsed=new URL(url);
    if(parsed.pathname.endsWith('/casemyp_check_login_limit'))return new Response('true',{status:200});
    if(parsed.pathname.endsWith('/users')){
      return new Response(JSON.stringify([{...exampleUser,role:'Sales'}]),{status:200});
    }
    return new Response('[]',{status:200});
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();await handler(req({action:'data',table:'cases',method:'PATCH',query:'caseid=eq.123',body:{status:'จอง'}},cookie),result);
  assert.equal(result.statusCode,403);
});
test('refuses using the gateway against the original database',async()=>{
  setup();process.env.CASEMYP_SUPABASE_URL='https://lhmycnzarbcmweavhnxh.supabase.co';
  const result=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),result);
  assert.equal(result.statusCode,503);
});

test('rejects the publicly documented session secret example',async()=>{
  setup();process.env.CASEMYP_SESSION_SECRET='replace-with-a-random-strong-session-secret-at-least-32-characters';
  const result=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),result);
  assert.equal(result.statusCode,503);
});
test('rejects password-based filters against the users endpoint',async()=>{
  setup();fakeDb();
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();await handler(req({action:'data',table:'users',method:'GET',query:'?password=eq.example&select=*'},cookie),result);
  assert.equal(result.statusCode,403);
});
test('Sales GET is scoped on the server to the logged-in employee',async()=>{
  setup();const seen=[];
  global.fetch=async(url)=>{
    const parsed=new URL(url);seen.push(parsed);
    if(parsed.pathname.endsWith('/casemyp_check_login_limit'))return new Response('true',{status:200});
    if(parsed.pathname.endsWith('/users'))return new Response(JSON.stringify([{...exampleUser,role:'Sales'}]),{status:200});
    return new Response(JSON.stringify([{caseid:'2601001',sales:'Administrator'}]),{status:200});
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();await handler(req({action:'data',table:'cases',method:'GET',query:'?select=*&sales=eq.other'},cookie),result);
  assert.equal(result.statusCode,200);
  assert.equal(seen.at(-1).searchParams.get('sales'),'eq.Administrator');
});
test('Sales cannot update a different employee case',async()=>{
  setup();const seen=[];
  global.fetch=async(url)=>{
    const parsed=new URL(url);seen.push(parsed);
    if(parsed.pathname.endsWith('/casemyp_check_login_limit'))return new Response('true',{status:200});
    if(parsed.pathname.endsWith('/users'))return new Response(JSON.stringify([{...exampleUser,role:'Sales'}]),{status:200});
    if(parsed.pathname.endsWith('/cases'))return new Response('[]',{status:200});
    return new Response('[]',{status:200});
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();await handler(req({action:'data',table:'cases',method:'PATCH',query:'caseid=eq.2601002',body:{status:'จอง'}},cookie),result);
  assert.equal(result.statusCode,403);
  assert.equal(seen.filter(u=>u.pathname.endsWith('/cases')).length,1);
});
test('new Supabase opaque secret key is never passed as a bearer JWT',async()=>{
  setup();process.env.CASEMYP_SUPABASE_SECRET_KEY='sb_secret_test-only-opaque-secret-for-tests';
  const headers=[];
  global.fetch=async(url,opts)=>{
    headers.push(opts.headers);
    const parsed=new URL(url);
    if(parsed.pathname.endsWith('/casemyp_check_login_limit'))return new Response('true',{status:200});
    return new Response(JSON.stringify([exampleUser]),{status:200});
  };
  const result=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),result);
  assert.equal(result.statusCode,200);
  assert.equal(headers.every(h=>!('Authorization' in h)),true);
});

test('fails closed on an unavailable persistent throttle',async()=>{
 setup();
 global.fetch=async()=>new Response('false',{status:200});
 const result=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),result);
 assert.equal(result.statusCode,429);
});

test('art operator can write cases without being granted user-management writes',async()=>{
  setup();
  global.fetch=async(url)=>{
    const p=new URL(url);
    if(p.pathname.endsWith('/casemyp_check_login_limit'))return new Response('true',{status:200});
    if(p.pathname.endsWith('/users'))return new Response(JSON.stringify([{...exampleUser,username:'art',role:'Sales'}]),{status:200});
    return new Response('[]',{status:200});
  };
  const login=res();await handler(req({action:'login',username:'art',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const caseResult=res();await handler(req({action:'data',table:'cases',method:'POST',query:'',body:{caseid:'2611109',sales:'บอลเล็ก'}} ,cookie),caseResult);
  assert.equal(caseResult.statusCode,200);
  const deny=res();await handler(req({action:'data',table:'users',method:'PATCH',query:'userid=eq.A001',body:{role:'Admin'}},cookie),deny);
  assert.equal(deny.statusCode,403);
});

test('case entry keeps automatic LINE send without blocking the saved form',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  assert.equal(source.includes('ส่ง LINE ใหม่'),false,'manual resend action must not appear');
  assert.equal(source.includes('retryLineNotification'),false,'retry handler must be removed');
  assert.match(source,/void notifyLineCaseCreated\(linePayload\)\.then\(/,'automatic LINE send must remain');
  const addModal=source.slice(source.indexOf('function AddCaseModal('),source.indexOf('function AddBookingModal('));
  assert.equal(addModal.includes('lineResult=await notifyLineCaseCreated'),false,'save must not wait for LINE');
  assert.match(source,/const \[firstHistorySaved,noteOutcome,notificationSaved\]=await Promise\.all\(/,'post-insert writes should run concurrently');
  assert.match(source,/submitInFlight\.current=true/,'double submit must be guarded');
});

test('mobile case modal is portaled and keeps its close and save actions visible',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../css/styles.css'),'utf8');
  const detail=source.slice(source.indexOf('function CaseModal('),source.indexOf('function ImageUploader('));
  assert.match(detail,/return createPortal\(<>/,'detail must portal beyond bottom navigation');
  assert.match(detail,/className="overlay cp-case-detail-overlay"/);
  assert.match(detail,/className="cp-case-detail-header"/);
  assert.match(detail,/className="cp-case-detail-body"/);
  assert.match(detail,/className="cp-case-detail-footer"/);
  assert.match(detail,/aria-label="ปิดหน้าต่าง"/);
  assert.match(detail,/onClick=\{save\}/);
  assert.match(css,/\.cp-case-detail-modal > \.cp-case-detail-body\{[\s\S]*?max-height:none!important/);
  assert.match(css,/\.cp-case-detail-modal > \.cp-case-detail-footer\{/);
});
