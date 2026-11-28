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

test('fast case creation keeps queue-assigned salesperson, history, and notification',async()=>{
  setup();
  const requests=[];
  global.fetch=async(url,opts={})=>{
    const u=new URL(url),table=u.pathname.split('/').pop();
    requests.push({table,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null});
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='casemyp_save_case_v1')return new Response(JSON.stringify({code:'PGRST202'}),{status:404});
    if(table==='users')return new Response(JSON.stringify([exampleUser]),{status:200});
    if(table==='cases'&&opts.method==='POST')return new Response(JSON.stringify([{caseid:opts.body?JSON.parse(opts.body).caseid:'2611001',sales:'แฟ้บ',version:1}]),{status:201});
    if(table==='cases')return new Response('[]',{status:200});
    return new Response(JSON.stringify([{id:1}]),{status:201});
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();
  await handler(req({action:'caseWorkflow',operation:'create',payload:{customername:'Test person',sales:'รอมอบหมาย',casePrefix:'2611',note:'Needs call'}},cookie),result);
  assert.equal(result.statusCode,200);
  assert.equal(result.body.success,true);
  assert.equal(result.body.sales,'แฟ้บ');
  assert.equal(result.body.noteSaved,true);
  assert.ok(requests.some(x=>x.table==='history'&&x.method==='POST'));
  assert.ok(requests.some(x=>x.table==='case_notes'&&x.method==='POST'));
  assert.equal(requests.find(x=>x.table==='case_notes'&&x.method==='POST').body.deletedat,null);
  assert.ok(requests.some(x=>x.table==='notifications'&&x.method==='POST'));
  assert.equal(requests.filter(x=>x.table==='cases'&&x.method==='POST').length,1);
});
test('fast case update rejects stale versions before making any write',async()=>{
  setup();let writes=0;
  global.fetch=async(url,opts={})=>{
    const u=new URL(url),table=u.pathname.split('/').pop();
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='casemyp_save_case_v1')return new Response(JSON.stringify({code:'PGRST202'}),{status:404});
    if(table==='users')return new Response(JSON.stringify([exampleUser]),{status:200});
    if(table==='cases')return new Response(JSON.stringify([{caseid:'2611001',version:3,customername:'Before',sales:'แฟ้บ'}]),{status:200});
    if(opts.method==='POST'||opts.method==='PATCH')writes++;
    return new Response('[]',{status:200});
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();await handler(req({action:'caseWorkflow',operation:'update',payload:{caseid:'2611001',expectedVersion:2,status:'ไปต่อได้'}},cookie),result);
  assert.equal(result.statusCode,409);
  assert.equal(result.body.conflict,true);
  assert.equal(writes,0);
});
test('fast case update performs one versioned patch including admin reassignment',async()=>{
  setup();const requests=[];
  global.fetch=async(url,opts={})=>{
    const u=new URL(url),table=u.pathname.split('/').pop();
    requests.push({table,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null,params:u.searchParams});
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='casemyp_save_case_v1')return new Response(JSON.stringify({code:'PGRST202'}),{status:404});
    if(table==='users')return new Response(JSON.stringify([exampleUser]),{status:200});
    if(table==='cases'&&opts.method==='PATCH')return new Response(JSON.stringify([{caseid:'2611001',version:4,sales:'พีร์'}]),{status:200});
    if(table==='cases')return new Response(JSON.stringify([{caseid:'2611001',version:3,customername:'Before',sales:'แฟ้บ'}]),{status:200});
    return new Response(JSON.stringify([{id:1}]),{status:201});
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();await handler(req({action:'caseWorkflow',operation:'update',payload:{caseid:'2611001',expectedVersion:3,status:'ไปต่อได้',newSales:'พีร์'}},cookie),result);
  assert.equal(result.statusCode,200);
  assert.equal(result.body.success,true);
  assert.equal(requests.filter(x=>x.table==='cases'&&x.method==='PATCH').length,1);
  const patch=requests.find(x=>x.table==='cases'&&x.method==='PATCH');
  assert.equal(patch.params.get('version'),'eq.3');
  assert.equal(patch.body.sales,'พีร์');
  assert.equal(patch.body.version,4);
  assert.equal(requests.filter(x=>x.table==='history').length,2);
  assert.equal(requests.filter(x=>x.table==='notifications').length,1);
});
test('fast case workflow remains limited to the two operations accounts',async()=>{
  setup();global.fetch=async(url,opts={})=>{
    const u=new URL(url),table=u.pathname.split('/').pop();
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='users')return new Response(JSON.stringify([{...exampleUser,username:'ball',role:'Sales'}]),{status:200});
    return new Response('[]',{status:200});
  };
  const login=res();await handler(req({action:'login',username:'ball',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();await handler(req({action:'caseWorkflow',operation:'create',payload:{customername:'Test'}},cookie),result);
  assert.equal(result.statusCode,403);
});
test('mobile app routes two authorized case actions to fast gateway',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  assert.match(source,/action:'caseWorkflow',operation,payload/);
  assert.match(source,/if\(SECURE_GATEWAY&&data.fastMode\)return fastCaseSave\('create',data\)/);
  assert.match(source,/if\(SECURE_GATEWAY&&data.fastMode\)return fastCaseSave\('update',data\)/);
});

test('current case pages initially request only the current month, with archive access retained',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const app=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  const admin=app.slice(app.indexOf('function AdminCurrentCases('),app.indexOf('function SalesCurrentCases('));
  const sales=app.slice(app.indexOf('function SalesCurrentCases('),app.indexOf('\nfunction ',app.indexOf('function SalesCurrentCases(')+20));
  assert.match(admin,/const \[scope,setScope\]=useState\('current_month'\)/);
  assert.match(sales,/const \[scope,setScope\]=useState\('current_month'\)/);
  assert.match(admin,/const params=scope==='all'\?\{all:'true'\}:\{scope\}/);
  assert.match(sales,/const params=scope==='all'\?\{all:'true',sales:currentUser.name\}:\{scope,sales:currentUser.name\}/);
  assert.match(app,/else if\(data.scope==='current_month'\)q.caseid=`like\.\$\{pre\}\*`/);
  assert.match(admin,/option value="current_and_pending"/);
  assert.match(admin,/option value="all"/);
  assert.match(admin,/api\('searchCases',\{q:term\}\)/);
  assert.match(sales,/api\('searchCases',\{q:term,sales:currentUser.name\}\)/);
});

test('new RPC saves one operation through service-role-only endpoint without extra case table roundtrips',async()=>{
  setup();
  const requests=[];
  global.fetch=async(url,opts={})=>{
    const p=new URL(url),table=p.pathname.split('/').pop(),body=opts.body?JSON.parse(opts.body):null;
    requests.push({table,method:opts.method||'GET',body});
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='users')return new Response(JSON.stringify([exampleUser]),{status:200});
    if(table==='casemyp_save_case_v1')return new Response(JSON.stringify({
      success:true,caseId:'2611002',sales:'บอลเล็ก',noteSaved:true,historySaved:true,notificationSaved:true
    }),{status:200});
    throw new Error('Unexpected database access: '+table);
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const out=res();
  await handler(req({action:'caseWorkflow',operation:'create',payload:{customername:'Test person',contact:'1234567890',note:'Test'}},cookie),out);
  assert.equal(out.statusCode,200);
  assert.equal(out.body.caseId,'2611002');
  const saves=requests.filter(x=>x.table==='casemyp_save_case_v1');
  assert.equal(saves.length,1);
  assert.equal(saves[0].body.p_operation,'create');
  assert.equal(saves[0].body.p_actor_userid,'A001');
  assert.equal(requests.filter(x=>x.table==='cases').length,0);
});
test('RPC duplicate confirmation is returned without writing cases',async()=>{
  setup();
  const requests=[];
  global.fetch=async(url,opts={})=>{
    const p=new URL(url),table=p.pathname.split('/').pop();
    requests.push(table);
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='users')return new Response(JSON.stringify([exampleUser]),{status:200});
    if(table==='casemyp_save_case_v1')return new Response(JSON.stringify({
      success:false,duplicates:[{caseid:'2611001',customername:'Same',contact:'1234'}]
    }),{status:200});
    throw Error('Unexpected route '+table);
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const out=res();await handler(req({action:'caseWorkflow',operation:'create',payload:{customername:'Same'}},cookie),out);
  assert.equal(out.statusCode,200);
  assert.equal(out.body.success,false);
  assert.equal(out.body.duplicates.length,1);
  assert.equal(requests.filter(x=>x==='casemyp_save_case_v1').length,1);
});
test('RPC transport failure never retries an ambiguous case write through legacy path',async()=>{
  setup();
  const requests=[];
  global.fetch=async(url,opts={})=>{
    const p=new URL(url),table=p.pathname.split('/').pop();requests.push(table);
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='users')return new Response(JSON.stringify([exampleUser]),{status:200});
    if(table==='casemyp_save_case_v1')return new Response(JSON.stringify({message:'Database error',code:'XX000'}),{status:500});
    throw Error('Unexpected fallback access');
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const out=res();await handler(req({action:'caseWorkflow',operation:'create',payload:{customername:'Test'}},cookie),out);
  assert.equal(out.statusCode,502);
  assert.equal(out.body.success,false);
  assert.equal(requests.filter(x=>x==='cases').length,0);
});
test('SQL RPC contract keeps audit triggers and service-role-only access',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/production/20261113_case_save_rpc_v1.sql'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  assert.match(sql,/SECURITY INVOKER/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.casemyp_save_case_v1\(text,jsonb,text\) FROM PUBLIC/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.casemyp_save_case_v1\(text,jsonb,text\) TO service_role/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/INSERT INTO public\.cases/);
  assert.match(sql,/SELECT \* INTO v_before FROM public\.cases/);
  assert.match(sql,/v_expected_version<>v_prev_version/);
  assert.match(sql,/INSERT INTO public\.history/);
  assert.match(sql,/INSERT INTO public\.case_notes/);
  assert.match(sql,/INSERT INTO public\.notifications/);
  assert.match(ui,/useRpcDuplicateCheck=SECURE_GATEWAY/);
  assert.match(ui,/submitData\.duplicateConfirmed=duplicateConfirmed/);
  assert.match(ui,/if\(Array\.isArray\(r\.duplicates\)&&r\.duplicates\.length\)/);
});


test('QR Code photo larger than 5000 characters can create case with intact contact image',async()=>{
  setup();
  const photo='data:image/jpeg;base64,'+'A'.repeat(120000);
  const requests=[];
  global.fetch=async(url,opts={})=>{
    const path=new URL(url).pathname,table=path.split('/').pop();
    requests.push({table,body:opts.body?JSON.parse(opts.body):null});
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='users')return new Response(JSON.stringify([exampleUser]),{status:200});
    if(table==='casemyp_save_case_v1')return new Response(JSON.stringify({success:true,caseId:'2611009',sales:'แฟ้บ',noteSaved:true,historySaved:true,notificationSaved:true}),{status:200});
    throw Error('Unexpected endpoint '+table);
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const output=res();await handler(req({action:'caseWorkflow',operation:'create',payload:{customername:'QR test case',contact:photo,contact_by:'QR Code',duplicateConfirmed:true}},cookie),output);
  assert.equal(output.statusCode,200);
  assert.equal(output.body.success,true);
  const sent=requests.find(x=>x.table==='casemyp_save_case_v1');
  assert.equal(sent.body.p_payload.contact,photo,'QR data must reach SQL unchanged');
  assert.equal(requests.filter(x=>x.table==='casemyp_save_case_v1').length,1);
});
test('QR Code safety limits reject malformed or oversized image data URL',async()=>{
  setup();
  let writes=0;
  global.fetch=async(url)=>{
    const table=new URL(url).pathname.split('/').pop();
    if(table==='casemyp_check_login_limit')return new Response('true',{status:200});
    if(table==='users')return new Response(JSON.stringify([exampleUser]),{status:200});
    if(table==='casemyp_save_case_v1')writes++;
    return new Response('[]',{status:200});
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  for(const contact of [
    'data:image/svg+xml;base64,'+'A'.repeat(120000),
    'data:image/jpeg;base64,'+'%'.repeat(120000),
    'data:image/png;base64,'+'A'.repeat(2000001),
    'B'.repeat(120000)
  ]){
    const out=res();await handler(req({action:'caseWorkflow',operation:'create',payload:{customername:'QR validation test',contact}},cookie),out);
    assert.equal(out.statusCode,400);
    assert.equal(out.body.success,false);
  }
  assert.equal(writes,0,'Invalid QR data should never reach SQL RPC');
});
test('QR upload preview validates image format and bounded encoding in case form',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  assert.match(source,/compressed\.length>2000000/);
  assert.match(source,/\/\^data:image/);
  assert.match(source,/function QrUploader/);
});


test('ad outcome table uses requested exact status columns and counts',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  const sectionStart=source.indexOf('📋 ตารางผลลัพธ์ของทุกแอด');
  const sectionEnd=source.indexOf('</table>',sectionStart);
  assert.ok(sectionStart>0&&sectionEnd>sectionStart,'outcome table must exist');
  const section=source.slice(sectionStart,sectionEnd);
  assert.ok(section.includes('<th>แอด</th><th>ได้รับ</th><th>รอข้อมูล</th><th>ไปต่อได้</th><th>จอง</th><th>ปิดเคส</th><th>โยนเคส</th><th>% ไปต่อได้</th>'),'columns and order must match user requirements');
  assert.ok(!section.includes('<th>ไปต่อไม่ได้</th>'));
  assert.ok(!section.includes('<th>ปล่อยแล้ว</th>'));
  assert.ok(!section.includes('<th>ติดตาม / อื่น ๆ</th>'));
  assert.ok(section.includes('a.counts[\'รอข้อมูล\']'));
  assert.ok(section.includes('a.counts[\'จอง\']'));
  assert.ok(section.includes('a.counts[\'โยนเคส\']'));
  assert.ok(section.includes("Math.round(a.counts['ไปต่อได้']/a.count*100)"),'pass rate uses exact status, not grouped pass');
  const match=source.match(/const adStatusCounts=items=>\{[\s\S]*?\n  \};/);
  assert.ok(match,'exact-status counting helper exists');
  const count=vm.runInNewContext(match[0].replace(/^const adStatusCounts=/,'(').replace(/;$/,')'));
  const actual=count([
    {status:'รอข้อมูล'}, {status:'ไปต่อได้'}, {status:' จอง '}, {status:'ปิดเคส'},
    {status:'โยนเคส'}, {status:'ไปต่อได้'}, {status:'ปล่อยแล้ว'}, {status:'รอเซ็นต์'}
  ]);
  assert.equal(actual['รอข้อมูล'],1);
  assert.equal(actual['ไปต่อได้'],2);
  assert.equal(actual['จอง'],1);
  assert.equal(actual['ปิดเคส'],1);
  assert.equal(actual['โยนเคส'],1);
  assert.equal(Math.round(actual['ไปต่อได้']/8*100),25);
  assert.match(source,/const overall=groupCounts\(rows\)/,'overview KPI grouping must remain unchanged');
});


test('persistent login cookie lasts 15 days and does not expose passwords',async()=>{
  setup();fakeDb();
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  assert.equal(login.statusCode,200);
  const cookie=login.headers['Set-Cookie'];
  assert.match(cookie,/Max-Age=1296000(?:;|$)/);
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict; Path=\/api\/casemyp-gateway/);
  const token=cookie.split(';')[0].split('=')[1],payload=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
  assert.equal(payload.uid,exampleUser.userid);
  assert.ok(payload.exp>Date.now()+14*24*3600000);
  assert.ok(payload.exp<=Date.now()+15*24*3600000);
  assert.ok(!Object.hasOwn(payload,'password'));
});
test('session probes and ordinary data reads never renew a 15-day idle cookie',async()=>{
  setup();fakeDb();
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const probe=res();await handler(req({action:'session'},cookie),probe);
  assert.equal(probe.statusCode,200);
  assert.equal(probe.headers['Set-Cookie'],undefined,'passive session probe must not reset inactivity');
  const read=res();await handler(req({action:'data',table:'cases',method:'GET',query:'limit=1'},cookie),read);
  assert.equal(read.statusCode,200);
  assert.equal(read.headers['Set-Cookie'],undefined,'automatic data polling must not reset inactivity');
});
test('authenticated foreground interaction slides the cookie window forward',async()=>{
  setup();fakeDb();
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const previous=login.headers['Set-Cookie'].split(';')[0];
  const touched=res();await handler(req({action:'activity'},previous),touched);
  assert.equal(touched.statusCode,200);
  assert.equal(touched.body.success,true);
  const cookie=touched.headers['Set-Cookie'];
  assert.match(cookie,/Max-Age=1296000(?:;|$)/);
  const renewed=cookie.split(';')[0];
  assert.notEqual(renewed,previous,'refreshed token must have a new signed nonce');
  const payload=JSON.parse(Buffer.from(renewed.split('=')[1].split('.')[0],'base64url').toString());
  assert.ok(payload.exp>Date.now()+14*24*3600000);
  const check=res();await handler(req({action:'session'},renewed),check);
  assert.equal(check.statusCode,200);
});
test('no interaction for 15 days expires server session without renewal',async()=>{
  setup();fakeDb();
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const raw=login.headers['Set-Cookie'].split(';')[0];
  const original=JSON.parse(Buffer.from(raw.split('=')[1].split('.')[0],'base64url').toString());
  const crypto=require('node:crypto');
  const makeCookie=exp=>{
    const payload=Buffer.from(JSON.stringify({...original,exp})).toString('base64url');
    const mac=crypto.createHmac('sha256',process.env.CASEMYP_SESSION_SECRET).update(payload).digest('base64url');
    return 'casemyp_new_session='+payload+'.'+mac;
  };
  for(const invalidExp of [Date.now()-1000,Date.now()+16*24*60*60*1000]){
    const response=res();await handler(req({action:'activity'},makeCookie(invalidExp)),response);
    assert.equal(response.statusCode,401);
    assert.equal(response.headers['Set-Cookie'],undefined,'expired or impossible future session must never renew');
  }
  const tampered=res();await handler(req({action:'activity'},raw.replace(/.$/,'X')),tampered);
  assert.equal(tampered.statusCode,401);
});
test('inactive users cannot refresh their session',async()=>{
  setup();fakeDb();
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  global.fetch=async(url)=>{
    const table=new URL(url).pathname.split('/').pop();
    if(table==='users')return new Response('[]',{status:200});
    throw Error('Unexpected route '+table);
  };
  const response=res();await handler(req({action:'activity'},cookie),response);
  assert.equal(response.statusCode,401);
  assert.equal(response.headers['Set-Cookie'],undefined);
});
test('foreground interaction, not background polling, renews the client session',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  const effect=source.slice(source.indexOf("const activityEvents=['click'"),source.indexOf('  function handleLogin(u)'));
  assert.match(effect,/action:'activity'/);
  assert.match(effect,/now-lastServerTouch<5\*60\*1000/);
  assert.match(effect,/visibilitychange/);
  assert.match(effect,/status===401/);
  assert.ok(!effect.includes('setInterval(onActivity'),'background timer must not extend idle cookie');
  assert.match(source,/sessionUnavailable/,'network problems should show a retry rather than a logout');
});


test('secure frontend tolerates localStorage being purged while signed server cookie remains valid',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const code=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  assert.match(code,/let lastVerifiedActivity=Date\.now\(\)/);
  assert.match(code,/SECURE_GATEWAY\?Math\.max\(lastVerifiedActivity,persistedLast\):persistedLast/);
  assert.match(code,/lastVerifiedActivity=now/);
});


test('case center hides unused booking navigation and creation without deleting booking implementation',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  const caseCenter=source.slice(source.indexOf('function AdminCurrentCases('),source.indexOf('function SalesCurrentCases('));
  const admin=source.slice(source.indexOf('function AdminApp('),source.indexOf('function App('));
  assert.ok(!caseCenter.includes('📋 เพิ่มจอง'),'unused booking button must disappear');
  assert.ok(!caseCenter.includes('showAddBook'),'case center should not open unused booking modal');
  assert.ok(!admin.includes("key:'bookings'"),'Admin booking menu must disappear');
  assert.ok(!admin.includes('bookings:<AdminBookings'),'unused booking page must no longer be routed');
  assert.ok(source.includes('function AdminBookings('),'historical booking logic/data must not be deleted');
  assert.ok(source.includes('function AddBookingModal('),'preserve legacy booking data implementation for audit/restore');
});
test('case center ad filter deduplicates names case-insensitively with status-safe matching',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  const caseCenter=source.slice(source.indexOf('function AdminCurrentCases('),source.indexOf('function SalesCurrentCases('));
  assert.match(caseCenter,/const currentMonthFilters=\(\)=>\(\{sales:'all',status:'',ad:'all'/);
  assert.match(caseCenter,/const adOptions=uniqueClipAdNames\(safeArray\(combinedCases\)\.map\(c=>getClipAd\(c\.attachment\)\)\)/);
  assert.match(caseCenter,/getClipAd\(c\.attachment\);[\s\S]*?filter\.ad==='__no_ad__'&&caseAd/);
  assert.match(caseCenter,/clipAdKey\(caseAd\)!==clipAdKey\(filter\.ad\)/);
  assert.equal((caseCenter.match(/aria-label="กรองแอด"/g)||[]).length,2);
  assert.ok(caseCenter.includes('<option value="all">ทุกแอด</option>'));
  assert.ok(caseCenter.includes('ไม่ระบุแอด'));
  const helpers=source.slice(source.indexOf('function normalizeClipAdName('),source.indexOf('const CLIP_AD_RECENTS_KEY='));
  const {uniqueClipAdNames,clipAdKey}=vm.runInNewContext(helpers+'\n;({uniqueClipAdNames,clipAdKey})');
  const cases=[{ad:'FE',status:'รอข้อมูล'},{ad:'fe',status:'จอง'},{ad:'D-max',status:'รอข้อมูล'},{ad:'',status:'ไปต่อได้'}];
  assert.deepEqual(Array.from(uniqueClipAdNames(cases.map(c=>c.ad))),['D-max','FE']);
  assert.equal(cases.filter(c=>clipAdKey(c.ad)===clipAdKey('FE')).length,2);
  assert.equal(cases.filter(c=>!clipAdKey(c.ad)).length,1);
  assert.equal(cases.filter(c=>clipAdKey(c.ad)===clipAdKey('FE')&&c.status==='รอข้อมูล').length,1);
});
test('case center search input is compact and redundant magnifier is removed without losing archive search',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const code=fs.readFileSync(path.join(__dirname,'../js/app.jsx'),'utf8');
  const cases=code.slice(code.indexOf('function AdminCurrentCases('),code.indexOf('function SalesCurrentCases('));
  assert.match(cases,/flex:'0 1 370px',width:'100%',maxWidth:370,minWidth:200/);
  assert.ok(!cases.includes('onClick={search} title="ค้นหา" aria-label="ค้นหา"'),'duplicate icon should be removed');
  assert.match(cases,/onKeyDown=\{e=>e\.key==='Enter'&&search\(\)\}/,'Enter must still support search');
  assert.match(cases,/onClick=\{search\}/,'visible archive-search button must remain');
  assert.match(cases,/api\('searchCases',\{q:term\}\)/,'search all months must still work');
});

test('case notification honors explicit channel, default Discord, and never silently falls back',async()=>{
  const notify=require('../api/line-case-created.js');
  const keys=['DISCORD_WEBHOOK_URL','LINE_CHANNEL_ACCESS_TOKEN','LINE_GROUP_ID','CASEMYP_ALLOWED_ORIGIN'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const originalFetch=global.fetch;
  try{
    process.env.DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/123456/fake-test-token';
    process.env.LINE_CHANNEL_ACCESS_TOKEN='test-token';
    process.env.LINE_GROUP_ID='test-group';
    delete process.env.CASEMYP_ALLOWED_ORIGIN;
    const seen=[];
    global.fetch=async(url,opts)=>{
      const u=new URL(url);
      if(u.hostname.endsWith('.supabase.co'))return new Response('[]',{status:200});
      seen.push({host:u.hostname,body:JSON.parse(opts.body)});
      return new Response('{}',{status:200});
    };
    const payload={caseId:'2601001',customername:'Synthetic test',contact:'000000',sales:'Test'};
    for(const provider of ['discord','line',undefined]){
      seen.length=0;
      const result=res();
      await notify(req({...payload,notificationProvider:provider}),result);
      assert.equal(result.body.success,true);
      assert.equal(seen.length,1);
      assert.equal(seen[0].host,provider==='line'?'api.line.me':'discord.com');
      if(provider!=='line'){
        assert.equal(result.body.provider,'discord');
        assert.deepEqual(seen[0].body.allowed_mentions,{parse:[]});
      }
    }
    delete process.env.DISCORD_WEBHOOK_URL;
    seen.length=0;
    const missing=res();await notify(req({...payload,notificationProvider:'discord'}),missing);
    assert.equal(missing.statusCode,503);assert.equal(seen.length,0);
  }finally{
    global.fetch=originalFetch;
    for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
  }
});
