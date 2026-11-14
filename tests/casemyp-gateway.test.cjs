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
