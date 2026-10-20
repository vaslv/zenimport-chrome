import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';

function* sources(path){
  for(const item of readdirSync(path,{withFileTypes:true})){
    const file=join(path,item.name);
    if(item.isDirectory())yield* sources(file);
    else if(/\.[cm]?[jt]s$/.test(file))yield file;
  }
}

test('native financial handles and generic transactions remain storage-private',()=>{
  for(const file of [...sources('src'),...sources('extension')]){
    // The L1 feasibility entry is excluded from distributed assets by build.py.
    if(file.startsWith('src/local/storage/')||file==='src/local/feasibility.ts')continue;
    const source=readFileSync(file,'utf8');
    assert.doesNotMatch(source,/(?:import|export)[\s\S]*?from\s*['"][^'"]*(?:storage\/(?:kernel|database|kernel-probe|probe)|dexie)(?:\.js)?['"]/,file);
    assert.doesNotMatch(source,/\bimport\s*\(\s*['"][^'"]*(?:storage\/(?:kernel|database|kernel-probe|probe)|dexie)/,file);
  }
});
