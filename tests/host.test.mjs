import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {apply} from '../index.js';
async function host(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-host-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'state.json'),JSON.stringify({feeds:[{id:'f',title:'Feed',url:'https://example.org/feed',category:'Tech',read:{},items:[{id:'a',title:'A',summary:'Summary',published:1,link:'https://example.org/a',bodyHtml:'<p>'+('Stored RSS content. '.repeat(15))+'</p>'}]}],lastRefreshAt:Date.now()}));const routes=new Map();const connection={fetch:{register(route){routes.set(route.path,route.fetch);return()=>{};}}};apply({connection,get:()=>connection,tools:{register(){}},effect(fn,label){if(label==='feeds: Client RPC routes')fn();}},{dataDir:dir,refreshMinutes:30});return async(endpoint,payload={})=>{const route=routes.get('/api/feeds/'+endpoint);assert.ok(route,`route ${endpoint} registered`);return (await (await route(new Request('http://localhost/api/feeds/'+endpoint,{method:'POST',body:JSON.stringify({type:'client-request',rpcId:'test',payload})}))).json()).result;};}
test('items RPC supports query and returns page metadata',async t=>{const call=await host(t);const r=await call('items',{feedId:'f',limit:80});assert.equal(r.ok,true);assert.equal(r.value.total,1);assert.equal(r.value.items[0].id,'a');});
test('compact snapshot omits article rows without losing global totals',async t=>{const call=await host(t);const r=await call('snapshot',{compact:true});assert.equal(r.value.items.length,0);assert.equal(r.value.stats.items,1);});
test('saved RPC writes persistent bookmark and saved filter returns it',async t=>{const call=await host(t);assert.equal((await call('save',{ids:['a'],saved:true})).ok,true);assert.equal((await call('items',{savedOnly:true})).value.total,1);});
test('article RPC includes stored RSS content provenance',async t=>{const call=await host(t);const r=await call('article',{itemId:'a'});assert.equal(r.value.contentSource,'feed');});
test('save RPC rejects absent ids instead of broad mutation',async t=>{const call=await host(t);const r=await call('save',{});assert.equal(r.ok,false);});


test('invalid cursor is reported as a client request error',async t=>{
 const call=await host(t);
 const r=await call('items',{cursor:'not-a-cursor'});
 assert.equal(r.ok,false);
 assert.equal(r.error.code,'feeds/invalid-request');
});


test('failure envelopes carry an object details field for the transport validator',async t=>{
 const call=await host(t);
 const r=await call('save',{});
 assert.equal(r.ok,false);
 assert.equal(typeof r.error.details,'object');
 assert.equal(r.error.details!==null,true);
});


test('update and category RPCs mutate the store',async t=>{
 const call=await host(t);
 const created=await call('category',{op:'create',name:'Research'});
 assert.equal(created.ok,true);assert.equal(created.value.created,true);
 assert.ok(created.value.categories.includes('Research'));
 const moved=await call('update',{feedId:'f',category:'Research',title:'Renamed'});
 assert.equal(moved.ok,true);assert.equal(moved.value.feed.category,'Research');
 const snapshot=await call('snapshot',{compact:true});
 const group=snapshot.value.categories.find(c=>c.name==='Research');
 assert.equal(group.feeds[0].title,'Renamed');
 const deleted=await call('category',{op:'delete',name:'Research',moveTo:'Tech'});
 assert.equal(deleted.ok,true);assert.equal(deleted.value.moved,1);
 const bad=await call('category',{op:'delete',name:'Nope'});
 assert.equal(bad.ok,false);assert.equal(bad.error.code,'feeds/not-found');
});


test('add RPC validates URLs and reports duplicates without fetching',async t=>{
 const call=await host(t);
 const invalid=await call('add',{url:'ftp://example.org/feed'});
 assert.equal(invalid.ok,false);assert.equal(invalid.error.code,'feeds/invalid-request');
 // the fixture already subscribes https://example.org/feed
 const duplicate=await call('add',{url:'https://example.org/feed'});
 assert.equal(duplicate.ok,true);assert.equal(duplicate.value.added,false);
});
test('import RPC rejects an empty OPML without touching subscriptions',async t=>{
 const call=await host(t);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-host-import-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'empty.opml');
 await fs.writeFile(file,'<opml version="2.0"><body></body></opml>');
 const r=await call('import',{path:file,mode:'merge'});
 assert.equal(r.ok,false);assert.equal(r.error.code,'feeds/invalid-request');
 const snapshot=await call('snapshot',{compact:true});
 assert.equal(snapshot.value.stats.feeds,1);
});


test('import RPC maps missing files and invalid modes to client errors',async t=>{
 const call=await host(t);
 const missing=await call('import',{path:'/definitely/not/here.opml',mode:'merge'});
 assert.equal(missing.ok,false);assert.equal(missing.error.code,'feeds/invalid-request');
 const badMode=await call('import',{path:'/tmp/whatever.opml',mode:'MERG'});
 assert.equal(badMode.ok,false);assert.equal(badMode.error.code,'feeds/invalid-request');
 const relative=await call('import',{path:'relative/file.opml'});
 assert.equal(relative.ok,false);assert.equal(relative.error.code,'feeds/invalid-request');
 const snapshot=await call('snapshot',{compact:true});
 assert.equal(snapshot.value.stats.feeds,1);
});
