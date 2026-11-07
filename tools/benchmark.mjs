import {performance} from 'node:perf_hooks';
import {FeedService} from '../feeds-core.js';
const service=new FeedService({dataDir:'/unused'});
service.state.feeds=Array.from({length:100},(_,f)=>({id:`f${f}`,title:`Source ${f}`,url:`https://example.org/${f}`,category:`Category ${f%5}`,read:{},saved:{},error:null,items:Array.from({length:40},(_,i)=>({id:`${f}:${i}`,title:`Article ${f}:${i}`,summary:'Example summary text. '.repeat(15),published:1700000000000-f*40-i,link:`https://example.org/${f}/${i}`}))}));
function measure(fn){for(let i=0;i<10;i++)fn();const runs=[];for(let i=0;i<100;i++){const start=performance.now();fn();runs.push(performance.now()-start);}runs.sort((a,b)=>a-b);return {medianMs:+runs[50].toFixed(3),p95Ms:+runs[95].toFixed(3)};}
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const legacySnapshot=service.snapshot();
const compact=service.snapshot({includeItems:false});
const page=service.queryItems({limit:80});
console.log(JSON.stringify({items:4000,pageSize:page.items.length,query:measure(()=>service.queryItems({limit:80})),search:measure(()=>service.queryItems({query:'Article 99:',limit:80})),compactSnapshot:measure(()=>service.snapshot({includeItems:false})),legacySnapshotBytes:bytes(legacySnapshot),initialPayloadBytes:bytes(compact)+bytes(page),payloadReductionPercent:+(100*(1-(bytes(compact)+bytes(page))/bytes(legacySnapshot))).toFixed(1)},null,2));
