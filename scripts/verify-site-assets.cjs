'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const sha12=bytes=>crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12);

function verify(html=fs.readFileSync(path.join(root,'index.html'),'utf8')){
  const release=html.match(/<meta name="carbon-release" content="([^"]+)">/)?.[1];
  assert.match(release||'',/^20261014-[a-z0-9-]+$/,'Missing release marker');
  const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
  assert.ok(readme.includes(`版本标记为\`${release}\``),'README current release marker differs from index.html');
  const assets=[];
  for(const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)){
    const url=tag.match(/\b(?:src|href)="([^"]+)"/)?.[1];
    if(!url?.startsWith('data/'))continue;
    const match=url.match(/^(data\/[^?]+\.(?:js|css))\?v=([0-9a-f]{12})$/);
    assert.ok(match,`Local asset must use a 12-digit SHA-256 query: ${url}`);
    const file=path.join(root,match[1]);
    assert.ok(fs.existsSync(file),`Missing local asset: ${match[1]}`);
    const actual=sha12(fs.readFileSync(file));
    assert.equal(match[2],actual,`Stale asset query: ${match[1]}`);
    assets.push(match[1]);
  }
  assert.ok(assets.length>=10,'Expected the website styles and scripts');
  assert.equal(new Set(assets).size,assets.length,'Duplicate local asset reference');
  return {passed:true,release,assets:assets.length};
}

if(require.main===module)console.log(JSON.stringify(verify()));
module.exports=verify;
