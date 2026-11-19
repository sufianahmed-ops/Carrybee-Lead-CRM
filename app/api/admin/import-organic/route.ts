import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sheetsClient } from '@/lib/google';

export const runtime = 'nodejs';
export const maxDuration = 300;
const key = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases: Record<string,string[]> = {
 date:['Registration Date (Local)','Registration Date','Registered At','Created At','Created Date'],bid:['Business ID','BID'],phone:['Business Phone','Phone','Mobile','Contact Number'],phone2:['Merchant Phone','Merchant Mobile'],bname:['Business Name','Shop Name','Store Name'],mname:['Merchant Name','Owner Name'],email:['Business Email','Email'],address:['Store Address','Address'],hub:['Store Hub Name','Hub Name','Hub']
};
function normalize(raw:any){const d=String(raw??'').replace(/\D/g,'');if(d.length<10)return'';const p='0'+d.slice(-10);return /^01[3-9]\d{8}$/.test(p)?p:'';}
function dateStr(v:any){const s=String(v??'').trim();if(!s)return'';let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[0];m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);if(m)return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;const d=new Date(s);return isNaN(d.getTime())?'':d.toISOString().slice(0,10);}
export async function POST() {
 try {
  const userClient=await createClient();const{data:{user}}=await userClient.auth.getUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
  const{data:actor}=await userClient.from('team_members').select('role').eq('auth_user_id',user.id).eq('active',true).single();if(!actor||!/lead|admin/i.test(actor.role))return NextResponse.json({error:'Admin access required'},{status:403});
  const admin=createAdminClient();const{data:settings}=await admin.from('app_settings').select('key,value').in('key',['ORGANIC_SHEET_ID','LEGACY_CUTOFF']);
  const sheetId=settings?.find(s=>s.key==='ORGANIC_SHEET_ID')?.value||process.env.ORGANIC_SHEET_ID;if(!sheetId)throw new Error('Organic sheet ID is not configured.');
  const cutoff=settings?.find(s=>s.key==='LEGACY_CUTOFF')?.value||'2026-11-04';const client=sheetsClient();
  const{data:source}=await client.spreadsheets.values.get({spreadsheetId:sheetId,range:"'Dump2'",valueRenderOption:'FORMATTED_VALUE',dateTimeRenderOption:'FORMATTED_STRING'});const values=source.values||[];if(values.length<2)return NextResponse.json({added:0,skipped:0});
  const headers=values[0].map(key);const cols:Record<string,number>={};for(const[k,names]of Object.entries(aliases))cols[k]=headers.findIndex(h=>h&&names.map(key).includes(h));
  if(cols.date<0||cols.phone<0)throw new Error('Could not find the organic date or phone column.');
  const existing:any[]=[];for(let from=0;;from+=1000){const{data,error}=await admin.from('leads').select('phone_clean,business_id').range(from,from+999);if(error)throw error;existing.push(...(data||[]));if(!data||data.length<1000)break;}
  const phones=new Set(existing.map(l=>l.phone_clean).filter(Boolean));const bids=new Set(existing.map(l=>l.business_id).filter(Boolean));let skipped=0;const add:any[]=[];
  for(const row of values.slice(1)){const txt=(k:string)=>cols[k]>=0?String(row[cols[k]]??'').trim():'';const reg=dateStr(row[cols.date]);if(!reg||reg<=cutoff){skipped++;continue;}const phone=normalize(row[cols.phone])||(cols.phone2>=0?normalize(row[cols.phone2]):'');const bid=txt('bid');if(!phone||phones.has(phone)||(bid&&bids.has(bid))){skipped++;continue;}phones.add(phone);if(bid)bids.add(bid);add.push({lead_id:null,source:'Self Registered',phone,business_id:bid,business_name:txt('bname'),merchant_name:txt('mname'),email:txt('email'),zone:txt('hub'),area:txt('address'),registration_date:reg,sheet_notes:'Auto-imported from Organic sheet (Dump2)'});}
  for(let i=0;i<add.length;i+=400){const{error}=await admin.from('leads').insert(add.slice(i,i+400));if(error)throw error;}
  return NextResponse.json({added:add.length,skipped});
 }catch(error:any){return NextResponse.json({error:error.message||String(error)},{status:400});}
}
