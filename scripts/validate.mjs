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
for(const file of publicFiles){
  const sourcePath=path.join(root,file);
  const deployPath=path.join(root,'public',file);
  if(!fs.existsSync(deployPath))fail(`ไม่พบ public/${file}`);
  if(!fs.readFileSync(sourcePath).equals(fs.readFileSync(deployPath)))fail(`public/${file} ไม่ตรงกับ source`);
}

console.log('Validation passed: source, production bundle, public output, accessibility and dead-feature checks');
