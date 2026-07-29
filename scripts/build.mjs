import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';

const root=process.cwd();
const publicDir=path.join(root,'public');
const copyFiles=['index.html','manifest.json','css/styles.css','js/preload.js'];
const supabaseUrl=String(process.env.CASEMYP_SUPABASE_URL||'').trim();
const supabaseAnonKey=String(process.env.CASEMYP_SUPABASE_ANON_KEY||'').trim();
const deployEnvironment=String(process.env.VERCEL_ENV||process.env.NODE_ENV||'local').trim();

fs.rmSync(publicDir,{recursive:true,force:true});

await build({
  entryPoints:[path.join(root,'js/app.jsx')],
  bundle:true,
  minify:true,
  target:'es2020',
  define:{'process.env.NODE_ENV':'"production"'},
  outfile:path.join(publicDir,'js/app.bundle.js'),
});

for(const file of copyFiles){
  const source=path.join(root,file);
  const destination=path.join(publicDir,file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(source,destination);
}

const runtimeConfigPath=path.join(publicDir,'runtime-config.js');
const runtimeConfig={
  supabaseUrl,
  supabaseAnonKey,
  deployEnvironment,
};
fs.writeFileSync(
  runtimeConfigPath,
  `window.__CASEMYP_CONFIG__=Object.freeze(${JSON.stringify(runtimeConfig)});\n`,
  {encoding:'utf8',mode:0o600},
);

console.log(
  `Production build created in public/ (${deployEnvironment}; Supabase config: ${
    supabaseUrl&&supabaseAnonKey?'configured':'missing'
  })`,
);
