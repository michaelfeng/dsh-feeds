import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness,sample,text} from './client-harness.mjs';
test('article source link queries the feed id rather than the article id',async t=>{const queries=[];const h=createHarness({snapshot:sample,loadItems:async(q)=>{queries.push(q);return {ok:true,value:{items:sample.items,total:2,nextCursor:null}};}});t.after(()=>h.dispose());await h.flush();const source=h.find(n=>n.props.className==='dsh-feeds-sourceLink')[0];source.props.onClick({stopPropagation(){}});await h.flush();assert.equal(queries.at(-1).feedId,'f1');});
test('switching source clears an incompatible category filter',async t=>{const queries=[];const h=createHarness({snapshot:sample,prefs:{category:'Tech',mode:'sources'},loadItems:async(q)=>{queries.push(q);return {ok:true,value:{items:[],total:0,nextCursor:null}};}});t.after(()=>h.dispose());await h.flush();const row=h.find(n=>n.props.className==='dsh-feeds-sourceRow').find(n=>text(n).includes('Beta source'));h.find(n=>n.type==='button',row)[0].props.onClick();await h.flush();assert.equal(queries.at(-1).feedId,'f2');assert.ok(!queries.at(-1).category||queries.at(-1).category==='News');});
test('load more appends the next page without duplicate rows',async t=>{const h=createHarness({snapshot:sample,loadItems:async(q)=>({ok:true,value:q.cursor?{items:[sample.items[1]],total:2,nextCursor:null}:{items:[sample.items[0]],total:2,nextCursor:'next'}})});t.after(()=>h.dispose());await h.flush();assert.equal(h.find(n=>n.props.className==='dsh-feeds-rowTitle').length,1);await h.click('加载更多');assert.equal(h.find(n=>n.props.className==='dsh-feeds-rowTitle').length,2);});
test('summary prompt carries item id and requires article tool evidence',async t=>{let prompt='';const h=createHarness({snapshot:sample,helpers:{inputActions:{insertText:p=>{prompt=p;}},loadArticle:async(id)=>({ok:true,value:{item:sample.items[0],feed:{id:'f1',title:'Alpha source'},content:'Body',blocks:[],contentKind:'article'}})}});t.after(()=>h.dispose());await h.flush();h.find(n=>n.props.className==='dsh-feeds-rowTitle')[0].props.onClick({stopPropagation(){}});await h.flush();await h.click('送入对话');assert.ok(prompt.includes('i1'));assert.ok(prompt.includes('feeds'));assert.ok(prompt.includes('article'));});
test('saved action reaches host and can be undone',async t=>{const actions=[];const h=createHarness({snapshot:sample,helpers:{saveItems:async(ids,saved)=>{actions.push({ids:Array.from(ids),saved});return {ok:true};},loadArticle:async()=>({ok:true,value:{item:sample.items[0],feed:{id:'f1',title:'Alpha source'},content:'Body',blocks:[],contentKind:'article'}})}});t.after(()=>h.dispose());await h.flush();h.find(n=>n.props.className==='dsh-feeds-rowTitle')[0].props.onClick({stopPropagation(){}});await h.flush();h.find(n=>n.props.className==='dsh-feeds-paneAction'&&text(n)==='稍后读')[0].props.onClick();await h.flush();assert.deepEqual(actions[0],{ids:['i1'],saved:true});h.find(n=>n.props.className==='dsh-feeds-paneAction'&&text(n)==='移出稍后读')[0].props.onClick();await h.flush();assert.deepEqual(actions[1],{ids:['i1'],saved:false});});
test('late query result cannot replace a newer source selection',async t=>{let finishOld;const h=createHarness({snapshot:sample,loadItems:async(q)=>q.feedId?{ok:true,value:{items:[sample.items[0]],total:1,nextCursor:null}}:new Promise(r=>finishOld=r)});t.after(()=>h.dispose());await h.flush();const nav=h.find(n=>n.type==='button'&&n.props['data-feed-id']==='f1')[0];assert.ok(nav);nav.props.onClick();await h.flush();finishOld({ok:true,value:{items:[sample.items[1]],total:1,nextCursor:null}});await h.flush();assert.ok(h.text().includes('Article A'));assert.ok(!h.text().includes('Article B'));});
test('new refresh timestamp reloads rows even if the entire refresh happened between polls',async t=>{let metaCalls=0,queries=0;const h=createHarness({snapshot:sample,virtualTime:true,helpers:{loadSnapshot:async()=>({ok:true,value:{...sample,lastRefreshAt:++metaCalls===1?1:2000}})},loadItems:async()=>({ok:true,value:{items:[{...sample.items[0],title:++queries===1?'Old article':'New article'}],total:1,nextCursor:null}})});t.after(()=>h.dispose());await h.flush();await h.advance(30000);assert.equal(queries,2);assert.ok(h.text().includes('New article'));assert.ok(!h.text().includes('Old article'));});
test('hidden view pauses polling and catches up after becoming visible',async t=>{let metaCalls=0;const h=createHarness({snapshot:sample,virtualTime:true,helpers:{loadSnapshot:async()=>{metaCalls++;return {ok:true,value:sample};}}});t.after(()=>h.dispose());await h.flush();await h.visibility('hidden');await h.advance(60000);assert.equal(metaCalls,1);await h.visibility('visible');await h.advance(30000);assert.equal(metaCalls,2);});
test('unmount cancels timers and performs no further host calls',async()=>{let calls=0;const h=createHarness({snapshot:sample,virtualTime:true,helpers:{loadSnapshot:async()=>{calls++;return {ok:true,value:sample};}}});await h.flush();h.dispose();await h.advance(60000);assert.equal(calls,1);});
test('old failed bulk mark does not undo a later successful individual decision',async t=>{let finishBulk,calls=0;const h=createHarness({snapshot:sample,prefs:{readMode:'manual'},helpers:{markItems:async()=>++calls===1?new Promise(r=>finishBulk=r):{ok:true}}});t.after(()=>h.dispose());await h.flush();h.find(n=>n.type==='button'&&String(n.props['aria-label']||'').includes('已加载的'))[0].props.onClick();await h.flush();const toggle=()=>h.find(n=>n.props.className==='dsh-feeds-toggle')[0].props.onClick({stopPropagation(){}});toggle();await h.flush();toggle();await h.flush();finishBulk({ok:false});await h.flush();assert.equal(h.find(n=>n.type==='li'&&String(n.props.className).includes('dsh-feeds-row'))[0].props['data-unread'],'false');});
test('rapid article navigation only marks the article actually read after the delay',async t=>{const marks=[];const h=createHarness({snapshot:sample,virtualTime:true,helpers:{markItems:async ids=>{marks.push(...ids);return {ok:true};},loadArticle:async id=>({ok:true,value:{item:sample.items.find(i=>i.id===id),feed:{},content:'Body',contentKind:'article'}})}});t.after(()=>h.dispose());await h.flush();h.find(n=>n.props.className==='dsh-feeds-rowTitle')[0].props.onClick({stopPropagation(){}});await h.flush();await h.advance(1000);h.find(n=>n.props.className==='dsh-feeds-rowTitle')[1].props.onClick({stopPropagation(){}});await h.flush();await h.advance(2100);assert.deepEqual(marks,['i2']);});
test('multiple updates from the same source are folded and expand on demand',async t=>{const many={...sample,items:Array.from({length:6},(_,i)=>({...sample.items[0],id:`a${i}`,title:`Update ${i}`,published:Date.now()-i}))};const h=createHarness({snapshot:many});t.after(()=>h.dispose());await h.flush();assert.equal(h.find(n=>n.props.className==='dsh-feeds-rowTitle').length,3);h.find(n=>n.type==='button'&&String(n.props['aria-label']||'').includes('展开'))[0].props.onClick();await h.flush();assert.equal(h.find(n=>n.props.className==='dsh-feeds-rowTitle').length,6);});
test('feed icons use lazy source-host favicons in subscription management',async t=>{const h=createHarness({snapshot:sample,prefs:{mode:'sources'}});t.after(()=>h.dispose());await h.flush();const icons=h.find(n=>n.type==='img'&&n.props.className==='dsh-feeds-sourceIconImage');assert.ok(icons.length>0);assert.equal(icons[0].props.loading,'lazy');assert.match(icons[0].props.src,/^https:\/\/[ab]\.example\/favicon.ico$/);});
test('old metadata response cannot overwrite a newer successful read decision',async t=>{let calls=0,resolvePoll;const h=createHarness({snapshot:sample,virtualTime:true,prefs:{readMode:'manual'},helpers:{loadSnapshot:async()=>++calls===1?{ok:true,value:sample}:new Promise(resolve=>resolvePoll=resolve)}});t.after(()=>h.dispose());await h.flush();await h.advance(30000);h.find(n=>n.props.className==='dsh-feeds-toggle')[0].props.onClick({stopPropagation(){}});await h.flush();assert.ok(h.text().includes('1 条未读'));resolvePoll({ok:true,value:sample});await h.flush();assert.ok(h.text().includes('1 条未读'));});
test('restoring an article also restores its reading scroll position',async t=>{const h=createHarness({snapshot:sample,virtualTime:true,prefs:{selectedItem:sample.items[0],positions:{i1:777},readMode:'manual'},helpers:{loadArticle:async()=>({ok:true,value:{item:sample.items[0],feed:{},content:'Restored article',contentKind:'article'}})}});t.after(()=>h.dispose());await h.flush();assert.equal(h.nodes.get('dsh-feeds-paneScroll').scrollTop,777);});
test('scroll position persists with debounce without changing list scope',async t=>{const h=createHarness({snapshot:sample,virtualTime:true});t.after(()=>h.dispose());await h.flush();h.nodes.get('dsh-feeds-listPane').scrollTop=234;h.find(n=>n.props.className==='dsh-feeds-listPane')[0].props.onScroll();await h.flush();await h.advance(300);assert.equal(JSON.parse(h.storage.get('dsh-feeds:prefs:v1')).listPosition,234);});
test('fold can collapse again while reading a previously hidden update',async t=>{const many={...sample,items:Array.from({length:6},(_,i)=>({...sample.items[0],id:`a${i}`,title:`Update ${i}`,published:Date.now()-i}))};const h=createHarness({snapshot:many,virtualTime:true,prefs:{readMode:'manual'}});t.after(()=>h.dispose());await h.flush();h.find(n=>n.props.className==='dsh-feeds-rowTitle')[0].props.onClick({stopPropagation(){}});await h.flush();for(let i=0;i<3;i++){h.listeners.get('keydown')({key:'j',target:{tagName:'DIV'},preventDefault(){}});await h.flush();}assert.equal(h.find(n=>n.props.className==='dsh-feeds-rowTitle').length,6);await h.click('收起更新');assert.equal(h.find(n=>n.props.className==='dsh-feeds-rowTitle').length,3);});


test('clicking a row and loading the reading pane does not scroll the list',async t=>{
 const h=createHarness({snapshot:sample,prefs:{readMode:'manual'},helpers:{loadArticle:async id=>({ok:true,value:{item:{...sample.items.find(i=>i.id===id),unread:false},feed:{},content:'Body',contentKind:'article'}})}});
 t.after(()=>h.dispose());await h.flush();
 h.find(n=>n.props.className==='dsh-feeds-rowTitle')[0].props.onClick({stopPropagation(){}});
 await h.flush();
 assert.equal(h.scrollCalls.length,0);
});
test('keyboard navigation reveals the selected row',async t=>{
 const h=createHarness({snapshot:sample,prefs:{readMode:'manual'}});t.after(()=>h.dispose());await h.flush();
 h.listeners.get('keydown')({key:'j',target:{tagName:'BODY'},preventDefault(){},defaultPrevented:false});
 await h.flush();
 assert.equal(h.scrollCalls.length,1);
});


test('auto-read in the unread queue does not reload and jump the list',async t=>{
 let loads=0,marks=0;
 const h=createHarness({snapshot:sample,virtualTime:true,prefs:{unreadOnly:true,readMode:'delay'},helpers:{
   loadItems:async()=>{loads+=1;return {ok:true,value:{items:sample.items,total:sample.items.length,nextCursor:null}};},
   markItems:async()=>{marks+=1;return {ok:true};},
   loadArticle:async id=>({ok:true,value:{item:sample.items.find(i=>i.id===id),feed:{},content:'Body',contentKind:'article'}}),
 }});
 t.after(()=>h.dispose());await h.flush();
 const initial=loads;
 h.find(n=>n.props.className==='dsh-feeds-rowTitle')[0].props.onClick({stopPropagation(){}});
 await h.flush();await h.advance(2500);
 assert.equal(loads,initial,'auto-read must not trigger a list reload');
 assert.ok(marks>=1,'auto-read reached the host');
});


test('Hacker News style summary fallback explains the limitation and offers the discussion',async t=>{
 const h=createHarness({snapshot:sample,prefs:{readMode:'manual'},helpers:{loadArticle:async id=>({ok:true,value:{
   item:{...sample.items.find(i=>i.id===id),summary:'',comments:'https://news.ycombinator.com/item?id=50403063'},
   feed:{id:'hn',title:'Hacker News',category:'IT News',site:'https://news.ycombinator.com/'},
   content:'',contentKind:'summary',contentSource:'summary',contentError:'fetch failed',
 }})}});
 t.after(()=>h.dispose());await h.flush();
 h.find(n=>n.props.className==='dsh-feeds-rowTitle')[0].props.onClick({stopPropagation(){}});
 await h.flush();
 const text=h.text();
 assert.ok(text.includes('无法从源站读取全文'),text.slice(0,300));
 assert.ok(text.includes('讨论'),'discussion action should be offered');
 assert.ok(text.includes('该订阅源只提供标题'),'summary-only explanation should be shown');
 assert.ok(!text.includes('Comments'),'placeholder summary must not be displayed');
});
