import env from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { readSheet } from 'read-excel-file/node';
import { normalizeCampaignEmail } from '../src/modules/campaigns/domain/campaign-rules.ts';

env.loadEnvConfig(process.cwd());
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const workspace = 'da7cef02-036a-4ee9-b3d7-5c7df54c73a0';
const creator = '1da75536-6742-4e3c-bced-c8baf4bf7fff';
if(process.argv.slice(2).some(arg=>!['--duong','--hai','--long','--tuan','--vananh'].includes(arg))||process.argv.slice(2).length>1) throw Error('Unknown argument');
const isDuong = process.argv.includes('--duong');
const isHai = process.argv.includes('--hai');
const isLong = process.argv.includes('--long');
const isTuan = process.argv.includes('--tuan');
const isVanAnh = process.argv.includes('--vananh');
const owner = isVanAnh ? 'Vân Anh J1' : isTuan ? 'Tuấn J1' : isLong ? 'Long J3' : isHai ? 'Hải J3' : isDuong ? 'Dương J3' : 'Cường J3';
const source = isVanAnh
 ? 'D:/Libraries/Downloads/051026_KIT Sống_Vân Anh J1_Email_Brse_R1_R1.1_New_New1_867.xlsx'
 : isTuan
 ? 'D:/Libraries/Downloads/051026_KIT Sống_Tuấn J1_Email_Brse_R1_R1.1_New_New1_3242.xlsx'
 : isLong
 ? 'D:/Libraries/Downloads/051026_KIT Sống_Long J3_Email_Brse_R1_R1.1_New_New1_543.xlsx'
 : isHai
 ? 'D:/Libraries/Downloads/051026_KIT Sống_Hải J3_Email_Brse_R1_R1.1_New_New1_1102.xlsx'
 : isDuong
 ? 'D:/Libraries/Downloads/051026_KIT Sống_Dương J3_Email_Brse_R1_R1.1_New_New1_373.xlsx'
 : 'D:/Libraries/Downloads/051026_KIT Sống_Cường J3_Email_Brse_R1_R1.1_New_New1_3011.xlsx';
const senders = isVanAnh
 ? [['kimchi.hoang.hr@gmail.com','Chi'],['quangminh.hr.02@gmail.com','Minh'],['thuylinh.hr91@gmail.com','Linh']]
 : isTuan
 ? [['caominhphu874@gmail.com','Phú'],['ngocmai.intalent@gmail.com','Mai'],['quynhanhh.manager@gmail.com','Anh']]
 : isLong
 ? [['phucthanh.manager.intalent@gmail.com','Thành'],['maianhbui.hr12@gmail.com','Anh'],['hongnhung.hr.11@gmail.com','Nhung']]
 : isHai
 ? [['quanganh.director@gmail.com','Anh'],['hoanggiang.hr12@gmail.com','Giang'],['daodat.manager97@gmail.com','Đạt']]
 : isDuong
 ? [['hongngoc.sale39@gmail.com','Ngọc'],['tuan456711t@gmail.com','Tuấn'],['hr.anhdung4@gmail.com','Dũng']]
 : [['tranthanhnam.hr@gmail.com','Nam'],['minhhungnguyen.hr@gmail.com','Hùng'],['leanhngoc.hr@gmail.com','Ngọc']];
const subject = '[Project Manager_Intalent VietNam]_Brse_ Việt Nam_Tokyo';
async function checked(query) { const r=await query; if(r.error) throw new Error(`${r.error.code}: ${r.error.message}`); return r.data; }
const rows = await readSheet(source, 1);
if(rows[0][2] !== 'Email') throw Error('Unexpected source columns');
const unique = new Map(); let invalid=0, duplicates=0;
for(const row of rows.slice(1)) { const email=normalizeCampaignEmail(row[2]); if(!email){invalid++;continue;} if(unique.has(email)){duplicates++;continue;} unique.set(email,{email,normalized_email:email,display_name:String(row[1]??'').trim()||null,personalization_json:{}}); }
const accounts = await checked(db.from('email_accounts').select('id,email_address,status,scopes').eq('workspace_id',workspace).in('email_address',senders.map(s=>s[0])));
for(const [email] of senders) if(!accounts.some(a=>a.email_address===email&&a.status==='CONNECTED'&&a.scopes.includes('https://www.googleapis.com/auth/gmail.send'))) throw Error('Sender unavailable');
let suppressed=0; const eligible=[]; const audience=[...unique.values()];
for(let i=0;i<audience.length;i+=200){const batch=audience.slice(i,i+200);const blocked=new Set((await checked(db.from('email_suppressions').select('normalized_email').eq('workspace_id',workspace).in('normalized_email',batch.map(r=>r.email)))).map(r=>r.normalized_email));for(const row of batch){if(blocked.has(row.email))suppressed++;else eligible.push(row);}}
const result=[];
for(let index=0;index<senders.length;index++){
 const [email,person]=senders[index]; const name=`${owner} - BrSE Việt Nam Tokyo - ${person} - 051026 KIT`;
 const existing=await checked(db.from('email_campaigns').select('id,status').eq('workspace_id',workspace).eq('name',name));
 if(existing.length) throw Error(`Draft already exists: ${name}; inspect before rerun`);
 const body=`Kính gửi anh,\n\nEm là ${person}, PM thuộc công ty Intalent Viet Nam, bên em đã hơn 6 năm thành lập và hỗ trợ cho hàng nghìn công ty, tập đoàn CNTT thị trường Nhật Bản và từ nền tảng Linkedin em xin phép được gửi mail kết nối để làm quen và giới thiệu anh các job bên em đang được order.\nEm xin phép được tóm tắt 3 khối job tiêu biểu cùng chế độ anh tham khảo ạ:\n\n1. Khối vị trí SE (N2) tại Tokyo/Osaka: Lương từ 550-650 Nenshu\n2. Khối vị trí Brse (N2/N1) tại Hà Nội/HCM: Lương từ 50-65 Gross\n3. Khối vị trí Highlevel (N2/N1): Lương Up 90 Gross tại Việt Nam, up 1000 Man tại Tokyo/Osaka có một trong các kinh nghiệm SAP (ABAP)/AWS/AI/ROBOT/Division Manager..V\n\nHiện tại em đang có cơ hội đồng hành cùng hàng trăm doanh nghiệp CNTT Thuần Nhật và CNTT IT Việt Nam thị trường Nhật, khách hàng sẵn sàng chờ UV OB vào đầu năm 2027. Anh quan tâm và tham khảo thị trường sắp tới cứ reply Alo, em sẽ phản hồi lại ngay ạ\n\nEm rất chờ mong nhận được sự quan tâm từ anh`;
 const html=body.split('\n\n').map(p=>`<p>${p.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\n','<br>')}</p>`).join('');
 const campaign=await checked(db.from('email_campaigns').insert({workspace_id:workspace,created_by:creator,name,owner_name:owner,campaign_type:'Email Marketing',campaign_type_color:'#2563EB',subject_template:subject,body_text_template:body,status:'DRAFT',sequence_enabled:true}).select('id').single());
 console.log(JSON.stringify({createdDraft:campaign.id,name}));
 await checked(db.from('email_campaign_steps').insert({workspace_id:workspace,campaign_id:campaign.id,step_order:0,step_type:'INITIAL',delay_minutes:0,subject_template:subject,body_text_template:body,body_html_template:html,enabled:true}));
 await checked(db.from('email_campaign_senders').insert({workspace_id:workspace,campaign_id:campaign.id,email_account_id:accounts.find(a=>a.email_address===email).id,daily_cap:100,per_minute_cap:1,enabled:true}));
 const group=eligible.filter((_,i)=>i%3===index);
 for(let i=0;i<group.length;i+=200) await checked(db.from('email_campaign_recipients').insert(group.slice(i,i+200).map(r=>({...r,workspace_id:workspace,campaign_id:campaign.id}))));
 await checked(db.from('email_campaign_events').insert([{workspace_id:workspace,campaign_id:campaign.id,event_type:'CAMPAIGN_CREATED',metadata:{source:'user_requested_setup',owner}},{workspace_id:workspace,campaign_id:campaign.id,event_type:'AUDIENCE_IMPORTED',metadata:{source:'XLSX',addedRows:group.length,invalidEmailRows:invalid,duplicateRows:duplicates,suppressedRows:suppressed}}]));
 const verify=await db.from('email_campaign_recipients').select('id',{count:'exact',head:true}).eq('campaign_id',campaign.id).eq('status','PENDING');
 if(verify.error||verify.count!==group.length) throw Error('Audience verification failed');
 const state=await checked(db.from('email_campaigns').select('status,scheduled_at').eq('id',campaign.id).single());
 if(state.status!=='DRAFT'||state.scheduled_at!==null)throw Error('Draft verification failed');
 result.push({id:campaign.id,email,count:group.length,status:state.status});
}
console.log(JSON.stringify({sourceRows:rows.length-1,invalid,duplicates,suppressed,campaigns:result}));
