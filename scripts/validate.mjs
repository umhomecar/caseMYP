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
if(source.includes("n.key==='claimed'&&notifCount"))fail('ยังนำจำนวนแจ้งเตือนไปแสดงผิดความหมายที่เมนูรับตลาด');
if(/>Copy<\/button>/.test(source))fail('ยังมีปุ่ม Copy ภาษาอังกฤษในหน้าข้อมูลลูกค้า');
if(source.includes("background:'#e53935'")&&source.includes("'บันทึก & ปิด'"))fail('ปุ่มบันทึกยังใช้สีเดียวกับการลบ');
for(const action of ['ลบ Note','ทำ Follow-up เสร็จ','ลบนัด Follow-up']){
  if(!source.includes(`action:'${action}'`)&&!source.includes(`?'${action}'`))fail(`ยังไม่มี audit trail สำหรับ ${action}`);
}
if(!source.includes('allSales.length>0&&allSales.every'))fail('การคืนเคสยังเสี่ยงปิดตลาดเมื่อไม่พบรายชื่อเซลส์');
if(!source.includes('marketWritten=false,claimedDeleted=false'))fail('การคืนเคสยังไม่มีสถานะสำหรับ rollback เมื่อบันทึกได้เพียงบางส่วน');
if(source.includes("s.includes('T')?' '+s.slice(11,16):''"))fail('ยังตัดเวลา UTC จาก ISO มาแสดงโดยไม่แปลง timezone');
if(!source.includes('formatLocalDateTimeToTHBE'))fail('ยังไม่มีตัวแปลง timestamp เป็นเวลาท้องถิ่น');
if(!source.includes("T.*(?:Z|[+-]"))fail('parseTHDateTime ยังไม่รองรับ timezone ใน ISO timestamp');
for(const file of publicFiles){
  const sourcePath=path.join(root,file);
  const deployPath=path.join(root,'public',file);
  if(!fs.existsSync(deployPath))fail(`ไม่พบ public/${file}`);
  if(!fs.readFileSync(sourcePath).equals(fs.readFileSync(deployPath)))fail(`public/${file} ไม่ตรงกับ source`);
}

console.log('Validation passed: source, production bundle, public output, accessibility and dead-feature checks');
