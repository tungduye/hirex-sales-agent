import { writeFile } from 'node:fs/promises';
for (const [name, url] of [['VTI','https://vti.com.vn/'],['Reco','https://reco-vn.com/vi/'],['NTQ','https://ntq.com.vn/vi/']]) {
 const response=await fetch(url); const html=await response.text();
 await writeFile(`tmp/website-scan-qa/${name}.html`,html);
 console.log(JSON.stringify({name,url:response.url,size:html.length,title:html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],links:[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]).filter(v=>/contact|career|tuyen|lien|about|cong-ty|who-we|mailto|tel:/i.test(v)).slice(0,40),sample:html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(-2000)}));
}
