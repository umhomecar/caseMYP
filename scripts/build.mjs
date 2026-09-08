import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';

const root=process.cwd();
const publicDir=path.join(root,'public');
const copyFiles=['index.html','facebook-ads.html','manifest.json','css/styles.css','js/preload.js','js/facebook-ads-nav.js','js/preview-db-diagnostics.js','js/preview-readonly.js','js/facebook-ads-range.js'];
const supabaseUrl=String(process.env.CASEMYP_SUPABASE_URL||'').trim();
const supabaseAnonKey=String(process.env.CASEMYP_SUPABASE_ANON_KEY||'').trim();
const deployEnvironment=String(process.env.VERCEL_ENV||process.env.NODE_ENV||'local').trim();
const authMode=String(process.env.CASEMYP_AUTH_MODE||'legacy').trim().toLowerCase()==='supabase'?'supabase':'legacy';

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

// Keep the source prototype simple, but always attach the historical/date-range
// enhancement in the deployable build (Preview and Production alike).
const adsHtmlPath=path.join(publicDir,'facebook-ads.html');
let adsHtml=fs.readFileSync(adsHtmlPath,'utf8');
if(!adsHtml.includes('./js/facebook-ads-range.js')){
  adsHtml=adsHtml.replace('</body>','  <script src="./js/facebook-ads-range.js"></script>\n</body>');
  fs.writeFileSync(adsHtmlPath,adsHtml,'utf8');
}

const runtimeConfigPath=path.join(publicDir,'runtime-config.js');
const runtimeConfig={
  supabaseUrl,
  supabaseAnonKey,
  deployEnvironment,
  authMode,
};

let runtimeConfigSource=`window.__CASEMYP_CONFIG__=Object.freeze(${JSON.stringify(runtimeConfig)});\n`;

if(deployEnvironment==='preview'){
  runtimeConfigSource=[
    `window.__CASEMYP_CONFIG__=Object.freeze(${JSON.stringify(runtimeConfig)});`,
    'window.__CASEMYP_PREVIEW_BOOTSTRAP__=window.__CASEMYP_CONFIG__;',
    `document.write('<script src="https://case-myp.vercel.app/runtime-config.js"><\\/script><script src="./js/preview-readonly.js"><\\/script>');`,
    ''
  ].join('\n');
}

fs.writeFileSync(
  runtimeConfigPath,
  runtimeConfigSource,
  {encoding:'utf8',mode:0o600},
);

console.log(
  `Production build created in public/ (${deployEnvironment}; Supabase config: ${
    supabaseUrl&&supabaseAnonKey?'configured':'missing'
  }; preview data mode: ${deployEnvironment==='preview'?'production-readonly':'normal'})`,
);
