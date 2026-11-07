import test from 'node:test';
import assert from 'node:assert/strict';
import {FeedService,parseFeed,extractArticle,articleUrlBlockedReason,fetchArticle,BODY_HTML_LIMIT,stripHtml} from '../feeds-core.js';
const articleHtml='<article><p>Read the <a href="/data">original data</a>.</p><pre><code class="language-js">if (ok) {\n    return 42;\n}</code></pre><table><tr><th>Revenue</th><th>Growth</th></tr><tr><td>100</td><td>20%</td></tr></table></article>';
test('RSS full content remains available beyond summary limit',()=>{const p=parseFeed(`<rss><channel><item><title>A</title><guid>a</guid><content:encoded><![CDATA[<p>${'正文'.repeat(650)}</p>]]></content:encoded></item></channel></rss>`,{url:'https://example.org/feed'});assert.ok(p.items[0].bodyHtml.length>1200);assert.equal(p.items[0].summary.length,500);});
test('RSS full content is read without fetching original page',async()=>{const s=new FeedService({dataDir:'/unused',fetchImpl:()=>{throw Error('network must not be used');}});s.state.feeds=[{id:'f',title:'RSS',read:{},items:[{id:'a',title:'A',link:'https://example.org/a',bodyHtml:`<p>${'RSS full content. '.repeat(30)}</p>`}]}];const a=await s.getArticle('a');assert.equal(a.contentSource,'feed');assert.ok(a.content.includes('RSS full content.'));});
test('links keep their safe absolute destination',()=>{const a=extractArticle(articleHtml,{url:'https://example.org/a'});assert.deepEqual(a.blocks[0].links,[{text:'original data',href:'https://example.org/data'}]);});
test('code blocks preserve indentation and language',()=>{const a=extractArticle(articleHtml);const code=a.blocks.find(b=>b.type==='code');assert.equal(code.text,'if (ok) {\n    return 42;\n}');assert.equal(code.language,'js');});
test('tables preserve rows and columns',()=>{const a=extractArticle(articleHtml);assert.deepEqual(a.blocks.find(b=>b.type==='table').rows,[['Revenue','Growth'],['100','20%']]);});
test('unsafe inline destinations are never exposed',()=>{const a=extractArticle('<article><p><a href="javascript:alert(1)">bad</a> <a href="https://safe.example/">safe</a></p></article>');assert.deepEqual(a.blocks[0].links,[{text:'safe',href:'https://safe.example/'}]);});
test('force retry bypasses cached article failure',async()=>{let fail=true;const s=new FeedService({dataDir:'/unused',fetchImpl:async()=>new Response(fail?'denied':`<article><p>${'Recovered. '.repeat(30)}</p></article>`,{status:fail?403:200,headers:{'content-type':'text/html'}})});s.state.feeds=[{id:'f',title:'F',read:{},items:[{id:'a',title:'A',link:'https://example.org/a',summary:'Fallback'}]}];assert.equal((await s.getArticle('a')).contentKind,'summary');fail=false;assert.equal((await s.getArticle('a',{force:true})).contentKind,'article');});
test('long articles explicitly signal bounded output',()=>{const a=extractArticle(`<article>${'<p>Paragraph.</p>'.repeat(350)}</article>`);assert.equal(a.truncated,true);assert.ok(a.blocks.length<=300);});
test('oversized article response is rejected before reading its body',async()=>{let read=false;const s=new FeedService({dataDir:'/unused',fetchImpl:async()=>({ok:true,status:200,headers:new Headers({'content-length':'9000000'}),body:{cancel:async()=>{}},arrayBuffer:async()=>{read=true;return new ArrayBuffer(0);}})});s.state.feeds=[{id:'f',read:{},items:[{id:'a',link:'https://example.org/a',summary:'Fallback'}]}];const a=await s.getArticle('a');assert.equal(read,false);assert.match(a.contentError,/large/);});
test('concurrent reads share one article fetch',async()=>{let calls=0;const s=new FeedService({dataDir:'/unused',fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return new Response('<article><p>'+('Body. '.repeat(40))+'</p></article>',{headers:{'content-type':'text/html'}});}});s.state.feeds=[{id:'f',read:{},items:[{id:'a',link:'https://example.org/a'}]}];await Promise.all([s.getArticle('a'),s.getArticle('a')]);assert.equal(calls,1);});
test('single oversized paragraph is explicitly labeled as truncated',()=>{const a=extractArticle(`<article><p>${'x'.repeat(5000)}</p></article>`);assert.equal(a.truncated,true);});
test('tables cut at the column bound are explicitly labeled as truncated',()=>{const a=extractArticle('<article><table><tr>'+Array.from({length:15},()=>'<td>Cell</td>').join('')+'</tr></table></article>');assert.equal(a.truncated,true);});
test('short photo RSS content is usable without a web fetch',async()=>{const s=new FeedService({dataDir:'/unused',fetchImpl:()=>{throw Error('unexpected web fetch');}});s.state.feeds=[{id:'f',url:'https://example.org/feed',read:{},items:[{id:'a',link:'https://example.org/a',bodyHtml:'<p>Photo</p><img src="https://example.org/photo.jpg">'}]}];const a=await s.getArticle('a');assert.equal(a.contentSource,'feed');assert.equal(a.blocks.find(b=>b.type==='image').src,'https://example.org/photo.jpg');});


test('private and non-HTTP article URLs are rejected before any network request',async()=>{
 let called=false;
 const blocked=['http://127.0.0.1/admin','http://localhost:8080/','http://10.1.2.3/x','http://192.168.1.1/','http://172.20.0.5/','http://169.254.169.254/latest/meta-data','http://[::1]/x','http://[::ffff:127.0.0.1]/x','file:///etc/passwd','javascript:alert(1)'];
 for(const url of blocked){
  const r=await fetchArticle(url,async()=>{called=true;throw Error('network must not be used');});
  assert.equal(r.ok,false,url);
  assert.equal(r.blocked,true,url);
 }
 assert.equal(called,false);
});
test('public article URLs pass the SSRF guard',()=>{
 assert.equal(articleUrlBlockedReason('https://example.org/a'),null);
 assert.equal(articleUrlBlockedReason('http://news.ycombinator.com/item?id=1'),null);
 assert.match(articleUrlBlockedReason('ftp://example.org/a'),/http/);
});


test('stored RSS bodies are capped per item',()=>{
 const p=parseFeed(`<rss><channel><item><title>A</title><guid>a</guid><content:encoded><![CDATA[<p>${'x'.repeat(300000)}</p>]]></content:encoded></item></channel></rss>`,{url:'https://example.org/feed'});
 assert.ok(p.items[0].bodyHtml.length<=BODY_HTML_LIMIT);
});


test('article redirects to a private address are blocked',async()=>{
 let fetched=0;
 const fake=async(url)=>{
  fetched+=1;
  if(fetched===1) return new Response('',{status:302,headers:{location:'http://127.0.0.1:9/secret'}});
  return new Response('<article><p>secret</p></article>',{status:200,headers:{'content-type':'text/html'}});
 };
 const r=await fetchArticle('https://example.org/redirect',fake);
 assert.equal(r.ok,false);
 assert.match(String(r.error),/private network/i);
 assert.equal(fetched,1);
});
test('trailing-dot and single-label hosts are treated as private',()=>{
 assert.match(String(articleUrlBlockedReason('http://localhost.:3000/')),/private/);
 assert.match(String(articleUrlBlockedReason('http://intranet/feed')),/private/);
 assert.equal(articleUrlBlockedReason('https://example.org.'),null);
});


test('Atom xhtml content and raw RSS HTML descriptions are not blank',()=>{
 const atom='<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><entry><title>E</title><id>x</id><content type="xhtml"><div><p>Hello xhtml.</p></div></content></entry></feed>';
 const rss='<rss><channel><item><title>A</title><guid>a</guid><description><p>Raw HTML text.</p></description></item></channel></rss>';
 assert.match(parseFeed(atom,{url:'https://e.org/f'}).items[0].summary,/Hello xhtml/);
 assert.match(parseFeed(rss,{url:'https://e.org/f'}).items[0].summary,/Raw HTML text/);
});
test('unclosed script markup cannot hang HTML stripping',()=>{
 const hostile='<script>'.repeat(20000)+'<p>hi</p>';
 const started=Date.now();
 const text=stripHtml(hostile);
 const elapsed=Date.now()-started;
 assert.ok(elapsed<1500,`took ${elapsed}ms`);
 assert.equal(text,'');
});
test('private-network images are dropped from article blocks',()=>{
 const html='<article><p>'+('Body '.repeat(40))+'</p><img src="http://127.0.0.1/a.png"><img src="https://example.org/ok.png"></article>';
 const article=extractArticle(html,{url:'https://example.org/a'});
 const images=article.blocks.filter(block=>block.type==='image').map(block=>block.src);
 assert.ok(!images.some(src=>/127\.0\.0\.1/.test(src)));
 assert.ok(images.some(src=>/example\.org/.test(src)));
});
