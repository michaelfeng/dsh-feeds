import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FeedService} from '../feeds-core.js';

function fixture(n=905){
 const service=new FeedService({dataDir:'/unused'});
 service.state.feeds=Array.from({length:Math.ceil(n/40)},(_,f)=>({id:`f${f}`,title:`Source ${f}`,url:`https://example.org/${f}`,category:f===22?'Quiet':'Tech',read:{},saved:{},error:null,items:Array.from({length:Math.min(40,n-f*40)},(_,j)=>({id:`i${f*40+j}`,title:`Article ${f*40+j}`,summary:j===0?'needle':'',link:`https://example.org/a/${f*40+j}`,published:100000-f*40-j}))}));
 return service;
}
test('global unread count includes items outside default snapshot',()=>{const s=fixture();assert.equal(s.snapshot().stats.unread,905);assert.equal(s.snapshot().stats.items,905);});
test('server filters a quiet source before pagination',()=>{const s=fixture();const p=s.queryItems({feedId:'f22',limit:10});assert.equal(p.total,25);assert.equal(p.items.length,10);assert.equal(p.items[0].id,'i880');});
test('cursor pagination has no duplicates after a new newest article arrives',()=>{const s=fixture();const a=s.queryItems({limit:80});s.state.feeds[0].items.unshift({id:'new',title:'New',published:200000});const b=s.queryItems({limit:80,cursor:a.nextCursor});assert.equal(b.items[0].id,'i80');assert.equal(new Set([...a.items,...b.items].map(i=>i.id)).size,160);});
test('search and unread filtering operate over all stored items',()=>{const s=fixture();s.state.feeds[22].read.i880=1;assert.equal(s.queryItems({query:'Article 880'}).total,1);assert.equal(s.queryItems({query:'Article 880',unreadOnly:true}).total,0);});
test('invalid cursor fails clearly',()=>{assert.throws(()=>fixture().queryItems({cursor:'not-valid'}),/cursor/i);});
test('saved items persist across reload',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const s=fixture(2);s.dataDir=dir;s.stateFile=path.join(dir,'state.json');await s.saveItems({ids:['i1'],saved:true});const other=new FeedService({dataDir:dir});await other.load();assert.equal(other.queryItems({savedOnly:true}).items[0].id,'i1');});
test('saving failure rejects instead of reporting success',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const blocker=path.join(dir,'file');await fs.writeFile(blocker,'x');const s=new FeedService({dataDir:blocker});await assert.rejects(s.save());});
test('corrupt existing data is quarantined and the plugin recovers',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'state.json'),'{broken');const s=new FeedService({dataDir:dir});await s.load();assert.equal(s.loaded,true);assert.equal(s.state.feeds.length,0);const files=await fs.readdir(dir);assert.ok(files.some(name=>name.startsWith('state.json.corrupt-')),'corrupt file quarantined');await s.addFeed({url:'https://example.org/feed'});assert.equal(s.state.feeds.length,1);});
test('concurrent load callers both see loaded data',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(fixture(2).state));const s=new FeedService({dataDir:dir});const results=await Promise.all([s.load().then(()=>s.state.feeds.length),s.load().then(()=>s.state.feeds.length)]);assert.deepEqual(results,[1,1]);});
test('a full refresh requested during single-source refresh still refreshes remaining sources',async()=>{const s=fixture(80);s.save=async()=>{};const seen=[];let release;const gate=new Promise(r=>release=r);s.refreshOne=async f=>{seen.push(f.id);if(seen.length===1)await gate;};const one=s.refresh({feedId:'f0'});const all=s.refresh();release();await Promise.all([one,all]);assert.ok(seen.includes('f1'));});
test('only a full refresh advances the global refresh timestamp',async()=>{const s=fixture(80);s.save=async()=>{};s.refreshOne=async()=>{};s.state.lastRefreshAt=123;await s.refresh({feedId:'f0'});assert.equal(s.state.lastRefreshAt,123);});
test('failed read-state save restores in-memory state',async()=>{const s=fixture(2);s.save=async()=>{throw Error('disk full');};await assert.rejects(s.mark({ids:['i0'],unread:false}));assert.equal(s.queryItems({unreadOnly:true}).total,2);});
test('failed bookmark save restores in-memory state',async()=>{const s=fixture(2);s.save=async()=>{throw Error('disk full');};await assert.rejects(s.saveItems({ids:['i0'],saved:true}));assert.equal(s.queryItems({savedOnly:true}).total,0);});
test('a later successful write never persists a failed earlier mutation',async()=>{const s=fixture(2);let calls=0,persisted;let release;const gate=new Promise(r=>release=r);s.save=async()=>{const value=JSON.parse(JSON.stringify(s.state));if(++calls===1){await gate;throw Error('write failed');}persisted=value;};const first=s.mark({ids:['i0'],unread:false}).catch(()=>{});const second=s.saveItems({ids:['i1'],saved:true});release();await Promise.all([first,second]);assert.equal(persisted.feeds[0].read.i0,undefined);assert.equal(persisted.feeds[0].saved.i1,1);});
test('refresh keeps read and bookmark changes made during network wait',async()=>{const s=fixture(2);s.save=async()=>{};let release;const gate=new Promise(r=>release=r);s.refreshOne=async feed=>{await gate;feed.items=[];};const refresh=s.refresh();await s.saveItems({ids:['i0'],saved:true});await s.mark({ids:['i0'],unread:false});release();await refresh;const saved=s.queryItems({savedOnly:true});assert.equal(saved.total,1);assert.equal(saved.items[0].id,'i0');assert.equal(saved.items[0].unread,false);});
test('failed source removal leaves subscription present',async()=>{const s=fixture(2);s.save=async()=>{throw Error('disk full');};await assert.rejects(s.removeFeed('f0'));assert.equal(s.snapshot().stats.feeds,1);assert.equal(s.snapshot().stats.items,2);});
test('failed source addition does not create a phantom subscription',async()=>{const s=fixture(2);s.save=async()=>{throw Error('disk full');};await assert.rejects(s.addFeed({url:'https://new.example/feed'}));assert.equal(s.snapshot().stats.feeds,1);});


test('failed refresh keeps the previous stale timestamp so retries are not suppressed',async()=>{
 const s=fixture(2);s.save=async()=>{};s.state.lastRefreshAt=123;s.refreshOne=async()=>{throw Error('offline');};
 const result=await s.refresh();
 assert.equal(result.failed,s.state.feeds.length);
 assert.equal(s.state.lastRefreshAt,123);
});
test('scoped refresh after a full refresh still fetches the new source',async()=>{
 const s=fixture(2);s.save=async()=>{};const seen=[];let release;const gate=new Promise(r=>release=r);
 s.refreshOne=async feed=>{seen.push(feed.id);if(feed.id==='f0')await gate;};
 const full=s.refresh();
 await s.addFeed({url:'https://new.example/feed'});
 const added=s.state.feeds.find(feed=>feed.url==='https://new.example/feed');
 const scoped=s.refresh({feedId:added.id});
 release();await full;await scoped;
 assert.ok(seen.includes(added.id),'new feed fetched by the scoped refresh');
});


test('importing an empty or malformed OPML keeps the existing subscriptions',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=fixture(2);s.dataDir=dir;s.stateFile=path.join(dir,'state.json');
 await fs.writeFile(path.join(dir,'empty.opml'),'<opml version="2.0"><head></head><body></body></opml>');
 await assert.rejects(s.importOpml(path.join(dir,'empty.opml')),/no subscriptions/i);
 assert.equal(s.state.feeds.length,1);
 await fs.writeFile(path.join(dir,'broken.opml'),'not xml at all');
 await assert.rejects(s.importOpml(path.join(dir,'broken.opml')),/no subscriptions/i);
 assert.equal(s.state.feeds.length,1);
});


test('feed refresh rejects hostnames that resolve to private addresses',async()=>{
 const s=new FeedService({dataDir:'/unused',fetchImpl:async()=>{throw Error('network must not be used');},checkDns:true,lookup:async()=>[{address:'127.0.0.1'}]});
 s.save=async()=>{};
 s.state.feeds=[{id:'f',title:'F',url:'http://feed.example.com/rss',category:'T',read:{},saved:{},error:null,items:[]}];
 await s.refresh();
 assert.match(String(s.state.feeds[0].error),/private network/i);
});
test('article fetching rejects hostnames that resolve to private addresses',async()=>{
 let fetched=false;
 const s=new FeedService({dataDir:'/unused',fetchImpl:async()=>{fetched=true;throw Error('network must not be used');},checkDns:true,lookup:async()=>[{address:'10.0.0.7'}]});
 s.state.feeds=[{id:'f',title:'F',read:{},saved:{},items:[{id:'a',title:'A',link:'http://public.example.com/a',summary:'Fallback'}]}];
 const article=await s.getArticle('a');
 assert.equal(fetched,false);
 assert.equal(article.contentKind,'summary');
 assert.match(String(article.contentError),/private network/i);
});
test('a fully failed refresh backs off before the next automatic attempt',async()=>{
 const s=fixture(2);s.save=async()=>{};s.refreshOne=async()=>{throw Error('offline');};
 await s.refresh();
 assert.ok(s.nextRefreshAt>Date.now());
 assert.equal(s.isStale(),false);
});


test('categories can be created, renamed, moved and deleted',async()=>{
 const s=fixture(2);s.save=async()=>{};
 assert.equal((await s.addCategory('Research')).created,true);
 assert.ok(s.snapshot().categories.some(c=>c.name==='Research'&&c.feeds.length===0));
 assert.equal((await s.addCategory('Research')).created,false);
 const updated=await s.updateFeed('f0',{category:'Research',title:'Renamed Source'});
 assert.equal(updated.feed.category,'Research');
 assert.equal(s.state.feeds[0].title,'Renamed Source');
 const renamed=await s.renameCategory('Research','Reading');
 assert.equal(renamed.renamed,true);assert.equal(renamed.moved,1);
 assert.ok(s.state.categories.includes('Reading'));
 await assert.rejects(s.deleteCategory('Reading'),/moveTo/);
 const deleted=await s.deleteCategory('Reading',{moveTo:'Tech'});
 assert.equal(deleted.deleted,true);assert.equal(deleted.moved,1);
 assert.equal(s.state.feeds[0].category,'Tech');
 await s.addCategory('Empty');await s.deleteCategory('Empty');
 assert.ok(!s.state.categories.includes('Empty'));
});
test('OPML merge keeps existing subscriptions and adds/updates categories',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=fixture(2);s.dataDir=dir;s.stateFile=path.join(dir,'state.json');s.save=async()=>{};
 const opml='<opml version="2.0"><head><title>T</title></head><body>'+
  '<outline text="Existing"><outline type="rss" text="Source 0 v2" xmlUrl="https://example.org/0"/></outline>'+
  '<outline text="Fresh"><outline type="rss" text="New Source" xmlUrl="https://example.org/new"/></outline>'+
  '</body></opml>';
 await fs.writeFile(path.join(dir,'merge.opml'),opml);
 const result=await s.importOpml(path.join(dir,'merge.opml'),{mode:'merge'});
 assert.equal(result.mode,'merge');
 assert.equal(result.added,1);assert.equal(result.updated,1);assert.equal(s.state.feeds.length,2);
 assert.equal(s.state.feeds.find(f=>f.url==='https://example.org/0').category,'Existing');
 assert.ok(s.state.categories.includes('Existing'));
 assert.ok(s.state.categories.includes('Fresh'));
});
test('OPML replace reports removed subscriptions',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=fixture(80);s.dataDir=dir;s.stateFile=path.join(dir,'state.json');s.save=async()=>{};
 const before=s.state.feeds.length;
 const opml='<opml version="2.0"><body><outline text="Cat"><outline type="rss" text="Only" xmlUrl="https://example.org/only"/></outline></body></opml>';
 await fs.writeFile(path.join(dir,'replace.opml'),opml);
 const result=await s.importOpml(path.join(dir,'replace.opml'),{mode:'replace'});
 assert.equal(result.mode,'replace');assert.equal(result.feeds,1);assert.equal(result.removed,before-1);
 assert.deepEqual(s.state.categories,['Cat']);
});


test('duplicate detection ignores scheme, www and trailing slash',async()=>{
 const s=fixture(2);s.save=async()=>{};
 assert.equal((await s.addFeed({url:'http://www.example.org/0/'})).added,false);
 assert.equal((await s.addFeed({url:'https://example.org/other'})).added,true);
});
test('unsubscribing reports the removed feed title',async()=>{
 const s=fixture(2);s.save=async()=>{};
 const result=await s.removeFeed('f0');
 assert.equal(result.removed,true);assert.equal(result.title,'Source 0');
});


test('a duplicate add does not create its target category',async()=>{
 const s=fixture(2);s.save=async()=>{};
 const result=await s.addFeed({url:'https://example.org/0',category:'Brand New'});
 assert.equal(result.added,false);
 assert.ok(!s.state.categories.includes('Brand New'));
});


test('refresh does not revert user category/title changes made while it runs',async()=>{
 const s=fixture(2);s.save=async()=>{};s.refreshOne=async feed=>{await gate;feed.items=feed.items;};
 let release;const gate=new Promise(resolve=>release=resolve);
 const running=s.refresh();
 await s.updateFeed('f0',{category:'Research',title:'Renamed During Refresh'});
 release();await running;
 const feed=s.state.feeds.find(entry=>entry.id==='f0');
 assert.equal(feed.category,'Research');
 assert.equal(feed.title,'Renamed During Refresh');
 assert.ok(s.state.categories.includes('Research'));
});
test('OPML replace deduplicates identity-colliding URLs',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=fixture(2);s.dataDir=dir;s.stateFile=path.join(dir,'state.json');s.save=async()=>{};
 const opml='<opml version="2.0"><body><outline text="C"><outline type="rss" text="A" xmlUrl="https://example.org/feed"/><outline type="rss" text="B" xmlUrl="http://www.example.org/feed/"/></outline></body></opml>';
 await fs.writeFile(path.join(dir,'dup.opml'),opml);
 await s.importOpml(path.join(dir,'dup.opml'),{mode:'replace'});
 const ids=s.state.feeds.map(feed=>feed.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.equal(s.queryItems({}).total,s.state.feeds.reduce((n,feed)=>n+feed.items.length,0));
});
test('feed identity keeps port, path case and query case distinct',async()=>{
 const s=fixture(2);s.save=async()=>{};
 assert.equal((await s.addFeed({url:'https://example.org:8443/feed'})).added,true);
 assert.equal((await s.addFeed({url:'https://example.org/Feed'})).added,true);
 assert.equal((await s.addFeed({url:'https://example.org/feed?A=1'})).added,true);
 assert.equal((await s.addFeed({url:'https://example.org/feed?a=1'})).added,true);
});
test('creating a category that only exists through feeds is not a new category',async()=>{
 const s=fixture(2);s.save=async()=>{};
 const result=await s.addCategory('Tech');
 assert.equal(result.created,false);
});
test('legacy empty feed category is migrated to the uncategorized bucket',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'state.json'),JSON.stringify({version:2,feeds:[{id:'a',url:'https://example.org/a',title:'A',category:'',items:[]}]}));
 const s=new FeedService({dataDir:dir});await s.load();
 assert.equal(s.state.feeds[0].category,'未分类');
 const result=await s.deleteCategory('未分类',{moveTo:'Tech'});
 assert.equal(result.moved,1);
 assert.equal(s.state.feeds[0].category,'Tech');
});


test('an import during an in-flight refresh keeps the imported category after the refresh lands',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feeds-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const s=fixture(2);s.dataDir=dir;s.stateFile=path.join(dir,'state.json');s.save=async()=>{};
 let release;const gate=new Promise(resolve=>release=resolve);
 s.refreshOne=async feed=>{await gate;};
 const running=s.refresh();
 const opml='<opml version="2.0"><body><outline text="Imported"><outline type="rss" text="Imported Feed" xmlUrl="https://example.org/imported"/></outline></body></opml>';
 await fs.writeFile(path.join(dir,'import.opml'),opml);
 await s.importOpml(path.join(dir,'import.opml'),{mode:'merge'});
 release();await running;
 assert.equal(s.state.feeds.find(feed=>feed.url==='https://example.org/imported').category,'Imported');
 assert.ok(s.state.categories.includes('Imported'));
});
