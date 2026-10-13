import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCvSession, writeCvSession } from '../src/modules/cv-scan/session.ts';
const result = { candidateName:'Test',prTitle:'PR đã sửa',translatedCvMarkdown:'Bản dịch',experienceAndSkills:['TypeScript'],educationAndCertificates:[],additionalNotes:[],importantPhrases:[],sourceFiles:['test.txt'] };
function memory() { const values=new Map(); return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}; }
test('restores result, edits and selected tab',()=>{const storage=memory();writeCvSession(storage,{result,activeTab:'translated'});assert.deepEqual(readCvSession(storage),{result,activeTab:'translated'});});
test('clear/new run removes previous result',()=>{const storage=memory();writeCvSession(storage,{result,activeTab:'pr'});writeCvSession(storage,null);assert.equal(readCvSession(storage),null);});
test('rejects corrupt and incomplete cached data',()=>{for(const raw of ['{','null','{"version":1,"result":{}}']){const storage=memory();storage.setItem('hirex:cv-scan:session:v1',raw);assert.equal(readCvSession(storage),null);}});
test('storage errors remain catchable by UI',()=>{assert.throws(()=>writeCvSession({setItem(){throw Error('quota')}},{result,activeTab:'pr'}),/quota/);});
