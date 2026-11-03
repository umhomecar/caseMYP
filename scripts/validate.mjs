import fs from 'node:fs';
import path from 'node:path';
import {parse} from '@babel/parser';
import {parse as parseCss} from 'css-tree';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const fail=message=>{throw new Error(message);};

const source=read('js/app.jsx');
const css=read('css/styles.css');
const html=read('index.html');
const bundlePath=path.join(root,'public/js/app.bundle.js');
const bundle=fs.existsSync(bundlePath)?fs.readFileSync(bundlePath,'utf8'):'';
const publicFiles=['index.html','manifest.json','css/styles.css','js/preload.js'];
const runtimeConfigPath=path.join(root,'public/runtime-config.js');

parse(source,{sourceType:'module',plugins:['jsx']});
// Design preview isolation and single-source React rendering contract.
const previewHtml=read('design-preview.html');
if(!previewHtml.includes('./js/app.bundle.js'))fail('Design preview must render the production React bundle');
if(!source.includes("const DESIGN_PREVIEW=window.location.pathname==='/design-preview.html'"))fail('Design preview path isolation is missing');
if(!source.includes("if(DESIGN_PREVIEW){\n    if(String(method).toUpperCase()==='GET')return[];"))fail('Design preview direct DB reads are not isolated');
if(!source.includes("READ_ONLY_PREVIEW"))fail('Design preview does not reject DB mutations');
if(!source.includes("if(action==='getLineNotificationSetting')return{success:true,enabled:false};"))fail('Design preview LINE status is not isolated');


parseCss(css,{positions:true});

if(!fs.existsSync(bundlePath))fail('ไม่พบ public/js/app.bundle.js');
if(fs.statSync(bundlePath).size===0)fail('public/js/app.bundle.js เป็นไฟล์ว่าง');
if(!fs.existsSync(runtimeConfigPath))fail('ไม่พบ public/runtime-config.js');
if(!read('public/runtime-config.js').includes('window.__CASEMYP_CONFIG__'))fail('runtime config ไม่ถูกต้อง');
if(!html.includes('./js/app.bundle.js'))fail('index.html ไม่ได้โหลด production bundle');
if(!html.includes('./runtime-config.js'))fail('index.html ไม่ได้โหลด runtime config');
if(html.indexOf('./runtime-config.js')>html.indexOf('./js/app.bundle.js'))fail('runtime config ต้องโหลดก่อน production bundle');
if(/text\/babel|babel-standalone/i.test(html))fail('index.html ยังโหลด Babel runtime');
if(/user-scalable\s*=\s*no/i.test(html))fail('viewport ยังปิดการซูม');
if(/\binitFCM\s*\(/.test(source))fail('ยังมีการเรียก initFCM ที่ไม่มี implementation');
if(!css.includes('prefers-reduced-motion'))fail('ยังไม่มี reduced-motion fallback');
if(!css.includes(':focus-visible'))fail('ยังไม่มี keyboard focus style');
if(css.includes('{`')||css.includes('`}'))fail('CSS มี template literal หลุดมาจาก JSX');
if(/api\.anthropic\.com|firebase-messaging-sw|\binitFCM\b/.test(bundle))fail('production bundle ยังมีฟีเจอร์ทดลองที่ถอดออกแล้ว');
if(!source.includes('window.__CASEMYP_CONFIG__'))fail('แอปยังไม่อ่าน Supabase runtime config');
if(/https:\/\/[a-z]{20}\.supabase\.co/i.test(source))fail('พบ Supabase project URL ฝังใน source');
if(/umhome-summary/i.test(source))fail('CASE_MYP ยังมี navigation/link ไป umhome-summary');
if(/eyJhbGciOi[A-Za-z0-9_-]*\./.test(source)||/eyJhbGciOi[A-Za-z0-9_-]*\./.test(bundle))fail('พบ JWT/anon key ฝังใน source หรือ bundle');
if(/>Copy<\/button>/.test(source))fail('ยังมีปุ่ม Copy ภาษาอังกฤษในหน้าข้อมูลลูกค้า');
if(source.includes("background:'#e53935'")&&source.includes("'บันทึก & ปิด'"))fail('ปุ่มบันทึกยังใช้สีเดียวกับการลบ');
for(const action of ['ลบ Note','ทำ Follow-up เสร็จ','ลบนัด Follow-up']){
  if(!source.includes(`action:'${action}'`)&&!source.includes(`?'${action}'`))fail(`ยังไม่มี audit trail สำหรับ ${action}`);
}
if(source.includes("s.includes('T')?' '+s.slice(11,16):''"))fail('ยังตัดเวลา UTC จาก ISO มาแสดงโดยไม่แปลง timezone');
if(!source.includes('formatLocalDateTimeToTHBE'))fail('ยังไม่มีตัวแปลง timestamp เป็นเวลาท้องถิ่น');
if(!source.includes("T.*(?:Z|[+-]"))fail('parseTHDateTime ยังไม่รองรับ timezone ใน ISO timestamp');
const standaloneModal=source.slice(source.indexOf('function StandaloneCaseModal'),source.indexOf('function AdminSentCasesPage'));
if(/\bconfirm\s*\(/.test(standaloneModal))fail('เคสส่วนตัวและ Line OA ยังใช้กล่องยืนยันลบของเบราว์เซอร์');
if(!standaloneModal.includes('confirmDelete&&<Confirm'))fail('เคสส่วนตัวและ Line OA ยังไม่ใช้กล่องยืนยันลบมาตรฐานของระบบ');
const bookingSection=source.slice(source.indexOf('function AddBookingModal'),source.indexOf('function AdminUsers'));
if(/\bconfirm\s*\(/.test(bookingSection))fail('หน้าการจองยังใช้กล่องยืนยันลบของเบราว์เซอร์');
if(!bookingSection.includes('confirmDelete&&<Confirm'))fail('หน้าการจองยังไม่ใช้กล่องยืนยันลบมาตรฐานของระบบ');
if(!source.includes('bookingId:r.id'))fail('รายการจองยังไม่เก็บ primary key สำหรับแก้ไขหรือลบเฉพาะแถว');
if(!bookingSection.includes('bookingId:booking.bookingId'))fail('หน้าการจองยังแก้ไขหรือลบด้วยรหัสเคสแทน primary key');
if(!source.includes("กรุณากรอกรหัสเคส ชื่อลูกค้า และเลือกเซลส์"))fail('การจองยังไม่บังคับเลือกเซลส์ผู้รับผิดชอบ');
const adminApp=source.slice(source.indexOf('function AdminApp'),source.indexOf('function SalesFollowups'));
const salesApp=source.slice(source.indexOf('function SalesApp'),source.indexOf('function App'));
if(source.includes('autoSendStaleCasesToMarket('))fail('ยังมีระบบย้ายเคสเข้าตลาดอัตโนมัติ');
if(!source.includes("const UNASSIGNED_SALES = 'รอมอบหมาย'"))fail('ยังไม่มีสถานะคิวรอมอบหมาย');
for(const deadMarketCode of [
  "function AdminMarket",
  "function SalesMarket",
  "function SalesClaimedCases",
  "case 'getMarket'",
  "case 'sendToMarket'",
  "case 'getMarketIds'",
  "case 'closeMarketCase'",
  "case 'claimCase'",
  "case 'getClaimedCases'",
  "case 'updateClaimed'",
  "case 'returnCase'",
  "case 'getSmartAssign'",
  'getSmartAssignSales',
  'retiredMarketActions'
]){
  if(source.includes(deadMarketCode))fail('ยังมีโค้ดตลาดเคสที่ยกเลิกแล้ว: '+deadMarketCode);
}
if(!source.includes("case 'bulkAssignCases'"))fail('ยังไม่มีการมอบหมายเคสแบบหลายรายการ');
if(adminApp.includes("key:'assignment'")||adminApp.includes('assignment:<AdminCurrentCases'))fail('เมนูคิวรอมอบหมายยังไม่ถูกถอดออก');
const searchSection=source.slice(source.indexOf("case 'searchCases'"),source.indexOf("case 'getBookings'"));
if(!searchSection.includes("deleted_at:'is.null'"))fail('การค้นหาเคสยังไม่ตัดรายการในถังขยะ');
if(!searchSection.includes("query.sales=`eq.${sales}`")||!source.includes("api('searchCases',{q:term,sales:currentUser.name})"))fail('การค้นหาของเซลส์ยังไม่จำกัดข้อมูลที่ฝั่งฐานข้อมูล');
if(!source.includes("const _searchCasesCache=new Map()")||!source.includes('clearSearchCasesCache()'))fail('search cache ยังไม่แยก scope หรือไม่ถูกล้างหลังแก้ข้อมูล');
if(source.includes("localStorage.getItem('cases')")||source.includes("localStorage.setItem('cases'"))fail('ยังเก็บสำเนาข้อมูลลูกค้าแบบถาวรใน localStorage');
if(source.includes("localStorage.getItem('cnotes_")||source.includes("localStorage.getItem(FU_KEY"))fail('Note/Follow-up ยังอ่าน fallback เก่าจาก localStorage');
if(source.includes("localStorage.getItem('cp_seen_notifs')")||source.includes("localStorage.getItem('cp_pn_dismissed')"))fail('notification cache ยังใช้ key ร่วมกันทุกบัญชี');
if(/\bFCM_EDGE_URL\b|\bpushNotif\s*\(/.test(source))fail('ยังมีการเรียก Edge Function แจ้งเตือนที่ไม่ได้ใช้งาน');
const broadcastSection=source.slice(source.indexOf("case 'broadcast'"),source.indexOf('default:return'));
if(broadcastSection.includes('sbNotif('))fail('Broadcast ยังบันทึก notification ซ้ำ');
for(const deadNoop of ["case 'uploadImage'","case 'deleteImage'","case 'checkInactive'"]){
  if(source.includes(deadNoop))fail('ยังมี API no-op ที่ไม่ได้ใช้งาน: '+deadNoop);
}
for(const deadAiCode of ['function AdminAIPage','function AIAdvisorPage','function ApiKeyManager','/api/disabled-ai','getAnthropicKey','saveAnthropicKey']){
  if(source.includes(deadAiCode))fail('ยังมี AI feature ที่ถูกถอดแล้ว: '+deadAiCode);
}
if(!source.includes("case 'checkCaseDuplicates'"))fail('ยังไม่มีตัวตรวจเคสซ้ำ');
if(!source.includes('expectedVersion'))fail('ยังไม่มี optimistic concurrency');
if(!source.includes("case 'getTrashCases'")||!source.includes('function AdminTrash'))fail('ยังไม่มีถังขยะและการกู้คืน');
if(source.includes('next_action')||source.includes('next_action_at'))fail('ยังมีขั้นตอนถัดไป/กำหนดติดตามที่ถอดออกแล้ว');
if(!source.includes("AUTH_MODE==='supabase'")||!source.includes('signInWithPassword'))fail('แอปยังไม่รองรับ Supabase Auth cutover');
if(!adminApp.includes('private_cases:<AdminSentCasesPage')||!adminApp.includes('line_oa:<AdminSentCasesPage'))fail('เคสส่วนตัวและ Line OA ต้องคงเป็นคนละหมวด');
for(const migration of [
  'supabase/migrations/20260729_01_workflow_hardening.sql',
  'supabase/staging/03_workflow_hardening.sql',
  'supabase/production/20260729_01_prepare_auth_account_link.sql',
  'supabase/production/20260729_02_auth_rls_after_account_link.sql'
]){
  if(!fs.existsSync(path.join(root,migration)))fail(`ไม่พบ migration ${migration}`);
}
for(const file of publicFiles){
  const sourcePath=path.join(root,file);
  const deployPath=path.join(root,'public',file);
  if(!fs.existsSync(deployPath))fail(`ไม่พบ public/${file}`);
  if(!fs.readFileSync(sourcePath).equals(fs.readFileSync(deployPath)))fail(`public/${file} ไม่ตรงกับ source`);
}


// Phase 4: non-destructive regression contracts for redesign.
// These do not write cases, consume queue slots or send LINE notifications.
const section=(from,to)=>{
  const start=source.indexOf(from);
  const end=source.indexOf(to,start+from.length);
  if(start<0||end<start)fail('Regression section missing: '+from);
  return source.slice(start,end);
};
const createModal=section('function AddCaseModal(', '\nfunction ');
const editModal=section('function CaseModal(', '\nfunction ');
const caseCenter=section('function AdminCurrentCases(', '\nfunction ');
const analytics=section('function AdminAnalytics(', '\nfunction ');

if(!createModal.includes("api('checkCaseDuplicates'")||!createModal.includes("api('addCase'"))
  fail('Case creation lost duplicate verification or save path');
if(!createModal.includes("if(DESIGN_PREVIEW)return")||!createModal.includes("disabled={loading||DESIGN_PREVIEW}"))
  fail('Design preview creation form must remain read-only');
if(!editModal.includes('expectedVersion:Number(caseData.version)||1'))
  fail('Case editing must preserve optimistic concurrency');
if(!editModal.includes("api('updateCase'")||!editModal.includes('onUpdated(optimisticData)'))
  fail('Case editor save and state refresh contract changed');
if(!caseCenter.includes("api('getCases'")||!caseCenter.includes('casemyp-v2-case-filters'))
  fail('Current-case filtering or read path is missing');
if(!analytics.includes('belongsToPeriod(c,prefixes)')||!analytics.includes('const convPct='))
  fail('Analytics period selection or funnel conversion missing');
if(!source.includes("if(action==='getCases')return{success:true,data:previewCases()};"))
  fail('Design preview mock data path is missing');
if(!source.includes("if(DESIGN_PREVIEW){\n    if(String(method).toUpperCase()==='GET')return[];"))
  fail('Design preview must isolate raw Supabase access');
for(const selector of ['.cp-action-copy','.cp-action-save','.cp-action-line','.cp-action-danger','.cp-action-edit','.cp-action-refresh']){
  if(!css.includes(selector))fail('Missing semantic action style: '+selector);
}
if(!source.includes('const PREVIEW_SALES=[\'แฟ้บ\',\'บอล\',\'พี่บอล\',\'เพ้นท์\',\'พีร์\']'))
  fail('Demo sales names changed unexpectedly');
console.log('Phase 4 regression contracts passed: case create/edit, preview isolation, analytics and action colors');

console.log('Validation passed: source, production bundle, public output, accessibility and dead-feature checks');
