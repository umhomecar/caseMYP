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
if(adminApp.includes("key:'market'")||adminApp.includes('market:<AdminMarket'))fail('เมนูแอดมินยังเปิดตลาดเคสได้');
if(salesApp.includes("key:'market'")||salesApp.includes("key:'claimed'")||salesApp.includes('market:<SalesMarket')||salesApp.includes('claimed:<SalesClaimedCases'))fail('เมนูเซลส์ยังเปิดตลาดเคสหรือรับตลาดได้');
if(source.includes('autoSendStaleCasesToMarket('))fail('ยังมีระบบย้ายเคสเข้าตลาดอัตโนมัติ');
if(!source.includes("const UNASSIGNED_SALES = 'รอมอบหมาย'"))fail('ยังไม่มีสถานะคิวรอมอบหมาย');
if(!source.includes('retiredMarketActions')||!source.includes('ตลาดเคสถูกยกเลิกแล้ว'))fail('ยังปิด endpoint เก่าของตลาดเคสไม่ครบ');
if(!source.includes("case 'bulkAssignCases'"))fail('ยังไม่มีการมอบหมายเคสแบบหลายรายการ');
if(!source.includes("case 'checkCaseDuplicates'"))fail('ยังไม่มีตัวตรวจเคสซ้ำ');
if(!source.includes('expectedVersion'))fail('ยังไม่มี optimistic concurrency');
if(!source.includes("case 'getTrashCases'")||!source.includes('function AdminTrash'))fail('ยังไม่มีถังขยะและการกู้คืน');
if(!source.includes('next_action_at'))fail('ยังไม่มีขั้นตอนถัดไปและวันติดตาม');
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

console.log('Validation passed: source, production bundle, public output, accessibility and dead-feature checks');
