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
const bundlePath=path.join(root,'js/app.bundle.js');
const bundle=fs.existsSync(bundlePath)?fs.readFileSync(bundlePath,'utf8'):'';

parse(source,{sourceType:'module',plugins:['jsx']});
parseCss(css,{positions:true});

if(!fs.existsSync(bundlePath))fail('ไม่พบ js/app.bundle.js');
if(fs.statSync(bundlePath).size===0)fail('js/app.bundle.js เป็นไฟล์ว่าง');
if(!html.includes('./js/app.bundle.js'))fail('index.html ไม่ได้โหลด production bundle');
if(/text\/babel|babel-standalone/i.test(html))fail('index.html ยังโหลด Babel runtime');
if(/user-scalable\s*=\s*no/i.test(html))fail('viewport ยังปิดการซูม');
if(/\binitFCM\s*\(/.test(source))fail('ยังมีการเรียก initFCM ที่ไม่มี implementation');
if(!css.includes('prefers-reduced-motion'))fail('ยังไม่มี reduced-motion fallback');
if(!css.includes(':focus-visible'))fail('ยังไม่มี keyboard focus style');
if(css.includes('{`')||css.includes('`}'))fail('CSS มี template literal หลุดมาจาก JSX');
if(/api\.anthropic\.com|firebase-messaging-sw|\binitFCM\b/.test(bundle))fail('production bundle ยังมีฟีเจอร์ทดลองที่ถอดออกแล้ว');

console.log('Validation passed: JSX, CSS, bundle, viewport, accessibility, motion and dead-feature checks');
