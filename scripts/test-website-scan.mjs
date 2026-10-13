import { mkdir, writeFile } from 'node:fs/promises';
import { scanWebsite } from '../src/modules/website-scan/server/scan-website.ts';

const sites = [['VTI', 'https://vti.com.vn/'], ['Reco', 'https://reco-vn.com/vi/'], ['NTQ', 'https://ntq.com.vn/vi/']];
const label = process.argv[2] || 'latest';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid run label');
await mkdir('tmp/website-scan-qa', { recursive: true });
const originalFetch=globalThis.fetch;
let responseIndex=0;
globalThis.fetch=async (...args)=>{
 const response=await originalFetch(...args);
 if(String(args[0])==='https://api.openai.com/v1/responses') {
  const body=await response.clone().json();
  await writeFile(`tmp/website-scan-qa/${label}-ai-${++responseIndex}.json`,JSON.stringify(body,null,2));
 }
 return response;
};
await Promise.all(sites.map(async ([companyName, website]) => {
  const start = Date.now();
  const result = await scanWebsite({ companyName, website, mode: 'FULL' });
  await writeFile(`tmp/website-scan-qa/${label}-${companyName}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ companyName, seconds: Math.round((Date.now() - start) / 1000), status: result.status, score: result.headhuntScore, pages: result.pagesCrawled, emails: result.emails, phones: result.phones, reportLength: result.fullReport?.length, error: result.error }));
}));
