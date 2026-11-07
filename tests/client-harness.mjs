import vm from 'node:vm';
import fs from 'node:fs';

export function createHarness({snapshot,loadItems,helpers={},prefs=null,virtualTime=false}={}) {
 let View,dicts={},hooks=[],index=0,dirty=true,pending=[],tree,disposed=false;
 const listeners=new Map(),timers=new Map();let time=0,nextTimer=1;const nodes=new Map();const scrollCalls=[];
 const storage=new Map(prefs?[['dsh-feeds:prefs:v1',JSON.stringify(prefs)]]:[]);
 const React={
  createElement(type,props,...children){return {type,props:{...props,children:children.length===1?children[0]:children}};},
  useState(initial){const i=index++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,v=>{const next=typeof v==='function'?v(hooks[i].value):v;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];},
  useRef(initial){const i=index++;return (hooks[i]??={current:initial});},
  useMemo(fn,deps){const i=index++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={value:fn(),deps};return hooks[i].value;},
  useEffect(fn,deps){const i=index++;if(!hooks[i]||!same(hooks[i].deps,deps)){pending.push(()=>{hooks[i]?.cleanup?.();hooks[i]={deps,cleanup:fn()};});}},
  useLayoutEffect(fn,deps){this.useEffect(fn,deps);},
 };
 const later=(fn,ms)=>{if(virtualTime){const id=nextTimer++;timers.set(id,{fn,at:time+ms});return id;}const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.set(id,null);return id;};
 const win={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k),__ModuleLoader__:{load(def){def.factory(()=>React).apply({effect(fn){fn();},locale:{register(ns,d){dicts=d;},bind(){return t;}},slots:{inject(n,fn){fn();},register(meta,view){View=view;}}});}}};
 const document={visibilityState:'visible',createElement:()=>({dataset:{},remove(){}}),head:{appendChild(){}},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
 function t(k,v={}){return String(dicts.zh?.[k]??k).replace(/\{(\w+)\}/g,(_,key)=>v[key]??'');}
 vm.runInNewContext(fs.readFileSync(new URL('../client.js',import.meta.url),'utf8'),{window:win,document,console,URL,AbortController,setTimeout:later,clearTimeout:id=>{if(!virtualTime)clearTimeout(id);timers.delete(id);},setInterval:()=>0,clearInterval(){},requestAnimationFrame:fn=>later(fn,0)});
 const props={t,loadSnapshot:async()=>({ok:true,value:snapshot}),loadItems:loadItems??(async()=>({ok:true,value:{items:snapshot.items,total:snapshot.items.length,nextCursor:null}})),markItems:async()=>({ok:true}),saveItems:async()=>({ok:true}),...helpers};
 function expand(n){if(Array.isArray(n))return n.flatMap(expand);if(n==null||typeof n!=='object')return n;if(typeof n.type==='function')return expand(n.type(n.props));const key=n.props.className||n.props.id;let dom=nodes.get(key);if(!dom){dom={scrollTop:0,offsetTop:0,scrollIntoView(){scrollCalls.push(this);},focus(){},getBoundingClientRect(){return {top:0,left:0,right:0,bottom:0,width:0,height:0};}};nodes.set(key,dom);}if(typeof n.props.ref==='function')n.props.ref(dom);else if(n.props.ref)n.props.ref.current=dom;return {...n,props:{...n.props,children:expand(n.props.children)}};}
 function render(){index=0;pending=[];tree=expand(View(props));dirty=false;const current=pending;pending=[];for(const run of current)run();}
 async function flush(){for(let k=0;k<20;k++){if(dirty)render();await new Promise(r=>setImmediate(r));if(!dirty)return tree;}throw Error('render did not settle');}
 function find(predicate,n=tree){if(Array.isArray(n))return n.flatMap(x=>find(predicate,x));if(!n||typeof n!=='object')return [];return [...(predicate(n)?[n]:[]),...find(predicate,n.props.children)];}
 return {flush,find,storage,scrollCalls,listeners,nodes,async advance(ms){const target=time+ms;for(let n=0;n<100;n++){const pending=[...timers.entries()].filter(([id,value])=>value&&value.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!pending)break;time=pending[1].at;timers.delete(pending[0]);pending[1].fn();await flush();}time=target;await flush();},async visibility(value){document.visibilityState=value;listeners.get('visibilitychange')?.();await flush();},async click(label){const n=find(n=>n.type==='button'&&(text(n).includes(label)||n.props['aria-label']===label))[0];if(!n)throw Error(`missing button ${label}`);n.props.onClick?.({stopPropagation(){}});return flush();},text:()=>text(tree),dispose(){disposed=true;for(const h of hooks)h?.cleanup?.();for(const id of timers.keys())if(!virtualTime)clearTimeout(id);timers.clear();}};
}
function same(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));}
export function text(n){if(Array.isArray(n))return n.map(text).join(' ');if(n==null||typeof n==='boolean')return '';return typeof n==='object'?text(n.props.children):String(n);}
export const sample={generatedAt:1,refreshing:false,progress:null,refreshMinutes:30,lastRefreshAt:1,opml:{path:null},stats:{feeds:2,items:2,unread:2,failed:0,saved:0},categories:[{name:'Tech',unread:1,feeds:[{id:'f1',title:'Alpha source',url:'https://a.example/feed',unread:1,itemCount:1,error:null}]},{name:'News',unread:1,feeds:[{id:'f2',title:'Beta source',url:'https://b.example/feed',unread:1,itemCount:1,error:null}]}],items:[{id:'i1',feedId:'f1',feedTitle:'Alpha source',category:'Tech',title:'Article A',summary:'Alpha summary',link:'https://a.example/1',published:10,unread:true},{id:'i2',feedId:'f2',feedTitle:'Beta source',category:'News',title:'Article B',summary:'Beta summary',link:'https://b.example/1',published:9,unread:true}]};
