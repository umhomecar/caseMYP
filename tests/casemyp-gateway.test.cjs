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
test('fails closed when preview gateway is not enabled',async()=>{
  setup();process.env.CASEMYP_SECURE_GATEWAY='false';
  const result=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),result);
  assert.equal(result.statusCode,503);
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
test('blocks all Sales data reads while row-level authorization is incomplete',async()=>{
  setup();global.fetch=async(url)=>{
    const parsed=new URL(url);
    if(parsed.pathname.endsWith('/users'))return new Response(JSON.stringify([{...exampleUser,role:'Sales'}]),{status:200});
    return new Response(JSON.stringify([{caseid:'private-other-sales-case'}]),{status:200});
  };
  const login=res();await handler(req({action:'login',username:'admin',password:'test-only-password'}),login);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const result=res();await handler(req({action:'data',table:'cases',method:'GET',query:'?select=*'},cookie),result);
  assert.equal(result.statusCode,403);
});
