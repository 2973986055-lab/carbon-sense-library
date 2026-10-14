'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const verify=require('../scripts/verify-site-assets.cjs');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const result=verify(html);
assert.equal(result.passed,true);
assert.throws(()=>verify(html.replace(/\?v=[0-9a-f]{12}/,'?v=000000000000')),/Stale asset query/);
console.log(JSON.stringify(result));
