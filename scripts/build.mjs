import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';

const root=process.cwd();
const publicDir=path.join(root,'public');
const copyFiles=['index.html','manifest.json','css/styles.css','js/preload.js','js/app.bundle.js'];

fs.rmSync(publicDir,{recursive:true,force:true});

await build({
  entryPoints:[path.join(root,'js/app.jsx')],
  bundle:true,
  minify:true,
  target:'es2020',
  define:{'process.env.NODE_ENV':'"production"'},
  outfile:path.join(root,'js/app.bundle.js'),
});

for(const file of copyFiles){
  const source=path.join(root,file);
  const destination=path.join(publicDir,file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(source,destination);
}

console.log('Production build created in public/');
