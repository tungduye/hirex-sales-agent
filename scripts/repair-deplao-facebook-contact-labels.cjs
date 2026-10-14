// Targeted repair of the three contacts observed with the recipient's identity.
const { DatabaseSync } = require('node:sqlite');
const { writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const db = new DatabaseSync('C:/Users/Admin/AppData/Local/HireX/ZaloRuntime/deplao-qa-profile/deplao-tool.db');
const owner = '61586595958719';
const ids = ['100025779810107', '100024923024028', '61594514177690'];
try {
  db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  const rows = ids.map(id => db.prepare("SELECT contact_id,owner_zalo_id,display_name,avatar_url FROM contacts WHERE owner_zalo_id=? AND contact_id=? AND channel='facebook'").get(owner,id)).filter(r=>r?.display_name==='Hồ Minh Vy');
  const folder = path.resolve(__dirname, '../runtime/contact-repair-backups');
  mkdirSync(folder,{recursive:true});
  const backup = path.join(folder,`facebook-labels-${Date.now()}.json`);
  writeFileSync(backup,JSON.stringify(rows,null,2),{flag:'wx'});
  let changed=0;
  for(const row of rows) {
    // Unknown names must remain UID labels until verified by the provider.
    changed += Number(db.prepare("UPDATE contacts SET display_name=?,avatar_url='' WHERE owner_zalo_id=? AND contact_id=? AND channel='facebook' AND display_name=?").run(row.contact_id,owner,row.contact_id,row.display_name).changes);
  }
  db.exec('COMMIT');
  console.log(JSON.stringify({changed,backup}));
} catch(error) { try {db.exec('ROLLBACK')} catch {} throw error; }
finally {db.close();}
