'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert.equal(new Set(ids).size,ids.length,'Duplicate id in index.html');
const idSet=new Set(ids);
const files=new Set();
let anchors=0;

for(const [tag] of html.matchAll(/<(?:a|script|link)\b[^>]*>/g)){
  const url=tag.match(/\b(?:href|src)="([^"]+)"/)?.[1];
  if(!url||/^[a-z][\da-z+.-]*:/i.test(url))continue;
  if(url.startsWith('#')){
    const target=decodeURIComponent(url.slice(1));
    assert.ok(idSet.has(target),`Broken page anchor: ${url}`);
    anchors++;
    continue;
  }
  const local=decodeURIComponent(url.split(/[?#]/,1)[0]);
  assert.ok(local&&!path.isAbsolute(local),`Invalid local link: ${url}`);
  const file=path.resolve(root,local);
  assert.ok(!path.relative(root,file).startsWith('..'),`Link leaves project: ${url}`);
  assert.ok(fs.existsSync(file)&&fs.statSync(file).isFile(),`Missing local link: ${url}`);
  files.add(local);
}

assert.ok(anchors>0&&files.size>0,'Expected page anchors and linked files');
console.log(JSON.stringify({passed:true,anchors,localFiles:files.size}));
