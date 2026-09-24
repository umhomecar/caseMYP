const crypto=require('node:crypto');
const zlib=require('node:zlib');
const encryptedPayload=require('../lib/line-import-2609026-payload');

const AAD=Buffer.from('caseMYP-line-import-2609026-2609121','utf8');
const CONFIRM='2609026-2609121';
const EXPECTED_COUNT=96;
const EXPECTED_SALES=['บอล','แฟ้บ','เพ้นท์','พีร์','เจ'];

function decryptRows(secretHex){
  if(!/^[0-9a-f]{64}$/i.test(String(secretHex||'')))throw new Error('bad key');
  const key=Buffer.from(secretHex,'hex');
  const packed=Buffer.from(encryptedPayload,'base64url');
  if(packed.length<29)throw new Error('bad payload');
  const nonce=packed.subarray(0,12);
  const tag=packed.subarray(packed.length-16);
  const ciphertext=packed.subarray(12,packed.length-16);
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  const compressed=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
  const rows=JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  if(!Array.isArray(rows)||rows.length!==EXPECTED_COUNT)throw new Error('unexpected row count');
  const ids=rows.map(r=>String(r.caseid||''));
  if(ids[0]!=='2609026'||ids[ids.length-1]!=='2609121'||new Set(ids).size!==EXPECTED_COUNT)throw new Error('unexpected case ids');
  return rows;
}

async function supa(path,{method='GET',body,prefer}={}){
  const base=String(process.env.CASEMYP_SUPABASE_URL||'').trim().replace(/\/$/,'');
  const key=String(process.env.CASEMYP_SUPABASE_ANON_KEY||'').trim();
  if(!base||!key)throw new Error('CaseMYP Supabase environment is not configured');
  const response=await fetch(base+'/rest/v1/'+path,{
    method,
    headers:{
      apikey:key,
      Authorization:'Bearer '+key,
      Accept:'application/json',
      ...(body!==undefined?{'Content-Type':'application/json'}:{}),
      ...(prefer?{Prefer:prefer}:{})
    },
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const raw=await response.text();
  let data=null;
  try{data=raw?JSON.parse(raw):null;}catch(e){data=raw;}
  if(!response.ok){
    const err=new Error('Supabase '+method+' '+path.split('?')[0]+' failed: '+response.status);
    err.detail=data;
    throw err;
  }
  return data;
}

function inFilter(ids){
  return 'in.('+ids.map(id=>String(id).replace(/[^0-9]/g,'')).join(',')+')';
}

function statusCounts(rows){
  return rows.reduce((a,r)=>{const k=String(r.status||'รอข้อมูล');a[k]=(a[k]||0)+1;return a;},{});
}
function salesCounts(rows){
  return rows.reduce((a,r)=>{const k=String(r.sales||'รอมอบหมาย');a[k]=(a[k]||0)+1;return a;},{});
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({success:false,error:'Method not allowed'});
  }
  if(String(req.query?.confirm||'')!==CONFIRM){
    return res.status(400).json({success:false,error:'Confirmation mismatch'});
  }
  const mode=String(req.query?.mode||'preview');
  if(!['preview','commit'].includes(mode)){
    return res.status(400).json({success:false,error:'Invalid mode'});
  }

  let rows;
  try{
    rows=decryptRows(String(req.query?.key||''));
  }catch(e){
    return res.status(403).json({success:false,error:'Import authorization failed'});
  }

  const ids=rows.map(r=>String(r.caseid));
  try{
    const [existingRaw,usersRaw]=await Promise.all([
      supa('cases?select=caseid,report,deleted_at&caseid='+encodeURIComponent(inFilter(ids))),
      supa('users?select=name,role,status&order=name.asc')
    ]);
    const existing=Array.isArray(existingRaw)?existingRaw:[];
    const existingMap=new Map(existing.map(r=>[String(r.caseid),r]));
    const missing=rows.filter(r=>!existingMap.has(String(r.caseid)));
    const alreadyImported=existing.filter(r=>String(r.report||'').startsWith('นำเข้าจาก LINE Export'));
    const userNames=new Set((Array.isArray(usersRaw)?usersRaw:[]).map(r=>String(r.name||'').trim()).filter(Boolean));
    const sellerCheck={
      found:EXPECTED_SALES.filter(n=>userNames.has(n)),
      missing:EXPECTED_SALES.filter(n=>!userNames.has(n))
    };

    if(mode==='preview'){
      return res.status(200).json({
        success:true,
        mode:'preview',
        sourceRange:CONFIRM,
        sourceRows:rows.length,
        existingCount:existing.length,
        alreadyImportedCount:alreadyImported.length,
        missingCount:missing.length,
        existingIds:existing.map(r=>String(r.caseid)).sort(),
        sellerCheck,
        statusCounts:statusCounts(rows),
        salesCounts:salesCounts(rows)
      });
    }

    let inserted=[];
    if(missing.length){
      const caseBody=missing.map(r=>({
        caseid:String(r.caseid),
        customername:String(r.customername||''),
        contact:String(r.contact||''),
        report:String(r.report||''),
        status:String(r.status||'รอข้อมูล'),
        sales:String(r.sales||'รอมอบหมาย'),
        createdat:String(r.createdat||''),
        updatedat:String(r.updatedat||r.createdat||''),
        sent:String(r.sent||'ปกติ'),
        attachment:String(r.attachment||''),
        next_action:String(r.next_action||''),
        next_action_at:r.next_action_at||null,
        version:Number(r.version||1)
      }));
      const result=await supa('cases?on_conflict=caseid',{
        method:'POST',
        body:caseBody,
        prefer:'resolution=ignore-duplicates,return=representation'
      });
      inserted=Array.isArray(result)?result:[];
    }

    // Re-read imported rows so a retry can repair missing history without duplicating cases.
    const importedCasesRaw=await supa('cases?select=caseid,customername,sales,createdat,report&caseid='+encodeURIComponent(inFilter(ids)));
    const importedCases=(Array.isArray(importedCasesRaw)?importedCasesRaw:[])
      .filter(r=>String(r.report||'').startsWith('นำเข้าจาก LINE Export'));
    const importedIds=importedCases.map(r=>String(r.caseid));

    let historyInserted=[];
    if(importedIds.length){
      const histRaw=await supa('history?select=caseid&action='+encodeURIComponent('eq.นำเข้า LINE')+'&caseid='+encodeURIComponent(inFilter(importedIds)));
      const histIds=new Set((Array.isArray(histRaw)?histRaw:[]).map(r=>String(r.caseid)));
      const needHistory=importedCases.filter(r=>!histIds.has(String(r.caseid)));
      if(needHistory.length){
        const historyBody=needHistory.map(r=>({
          caseid:String(r.caseid),
          sales:'แอดมิน',
          action:'นำเข้า LINE',
          detail:'นำเข้าจาก LINE Export — '+String(r.customername||'')+' — มอบหมายให้ '+String(r.sales||'รอมอบหมาย'),
          createdat:String(r.createdat||'')
        }));
        const result=await supa('history',{
          method:'POST',
          body:historyBody,
          prefer:'return=representation'
        });
        historyInserted=Array.isArray(result)?result:[];
      }
    }

    const verifyRaw=await supa('cases?select=caseid,report&caseid='+encodeURIComponent(inFilter(ids)));
    const verified=Array.isArray(verifyRaw)?verifyRaw:[];
    const verifiedIds=new Set(verified.map(r=>String(r.caseid)));
    const stillMissing=ids.filter(id=>!verifiedIds.has(id));

    return res.status(stillMissing.length?500:200).json({
      success:stillMissing.length===0,
      mode:'commit',
      sourceRange:CONFIRM,
      sourceRows:rows.length,
      insertedNow:inserted.length,
      skippedExisting:existing.length,
      importedFromLineTotal:verified.filter(r=>String(r.report||'').startsWith('นำเข้าจาก LINE Export')).length,
      historyInsertedNow:historyInserted.length,
      verifiedCount:verified.length,
      stillMissing,
      sellerCheck
    });
  }catch(error){
    console.error('LINE historical import failed',error?.message||error);
    return res.status(500).json({
      success:false,
      error:error?.message||'Import failed',
      detail:error?.detail&&typeof error.detail==='object'?error.detail:undefined
    });
  }
};
