
(() => {
"use strict";
const $=id=>document.getElementById(id);
const els={file:$("fileInput"),drop:$("dropZone"),tracks:$("trackList"),audio:$("audio"),wave:$("waveCanvas"),playhead:$("playhead"),sections:$("sectionsList")};
let tracks=[],activeTrack=null,activeLoopIndex=null,raf=0,audioCtx=null,db=null,loopTrim=0;

const colors={"Intro":"#9ca7b8","Verse":"#79a8ff","Pre-Chorus":"#67d9c5","Chorus":"#ffbe62","Bridge":"#d88dff","Break":"#ff829b","Outro":"#a9b4c8"};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const waitFrame=()=>new Promise(r=>requestAnimationFrame(r));
const fmt=s=>{if(!Number.isFinite(s))return"0:00.0";const m=Math.floor(s/60),q=s-m*60;return `${m}:${q<10?"0":""}${q.toFixed(1)}`};
const short=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const parseTime=t=>{t=String(t).trim().replace(",",".");if(t.includes(":")){const p=t.split(":").map(Number);return p.length===2&&!p.some(Number.isNaN)?p[0]*60+p[1]:NaN}return Number(t)};
function toast(msg){$("toast").textContent=msg;$("toast").classList.remove("hidden");clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").classList.add("hidden"),2600)}
function ensureCtx(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();return audioCtx}

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open("SongMapperDB",2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("tracks"))d.createObjectStore("tracks",{keyPath:"id"})};r.onsuccess=()=>{db=r.result;resolve(db)};r.onerror=()=>reject(r.error)})}
function dbAll(){return new Promise((resolve,reject)=>{const r=db.transaction("tracks").objectStore("tracks").getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function dbPut(record){return new Promise((resolve,reject)=>{const r=db.transaction("tracks","readwrite").objectStore("tracks").put(record);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}
function dbDelete(id){return new Promise((resolve,reject)=>{const r=db.transaction("tracks","readwrite").objectStore("tracks").delete(id);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}
function dbClear(){return new Promise((resolve,reject)=>{const r=db.transaction("tracks","readwrite").objectStore("tracks").clear();r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}

async function init(){
  try{await openDB();const saved=await dbAll();tracks=saved.map(r=>({...r,url:URL.createObjectURL(r.blob),file:{name:r.name,size:r.blob.size,type:r.blob.type}}));}catch(e){console.warn("IndexedDB unavailable",e)}
  renderTracks();
}
init();

$("pickBtn").onclick=()=>els.file.click();
els.file.onchange=()=>addFiles(els.file.files);
["dragenter","dragover"].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.remove("drag")}));
els.drop.addEventListener("drop",e=>addFiles(e.dataTransfer.files));

async function addFiles(fileList){
  const accepted=[...fileList].filter(f=>f.type.startsWith("audio/")||/\.(mp3|m4a|aac|wav|aiff|flac)$/i.test(f.name));
  if(!accepted.length)return toast("Nie znaleziono obsługiwanego pliku audio.");
  for(const file of accepted){
    const id=crypto.randomUUID?crypto.randomUUID():`${Date.now()}_${Math.random()}`;
    const rec={id,name:file.name,blob:file,status:"Oczekuje",sections:null,duration:0,peaks:null,bpm:null,confidence:null,featuresSummary:null,analyzed:false,updatedAt:Date.now()};
    rec.url=URL.createObjectURL(file);rec.file={name:file.name,size:file.size,type:file.type};tracks.push(rec);
    try{await dbPut(stripRuntime(rec))}catch(e){console.warn(e);toast("Utwór dodany, ale iOS nie pozwolił zapisać go trwale.");}
  }
  renderTracks();if(!activeTrack)analyzeTrack(tracks[tracks.length-accepted.length]);
}
function stripRuntime(t){return {id:t.id,name:t.name,blob:t.blob,status:t.status,sections:t.sections,duration:t.duration,peaks:t.peaks?Array.from(t.peaks):null,bpm:t.bpm,confidence:t.confidence,featuresSummary:t.featuresSummary,analyzed:t.analyzed,updatedAt:Date.now()}}

function renderTracks(){
  $("libraryMeta").textContent=tracks.length?`${tracks.length} ${tracks.length===1?"utwór":"utwory"} zapisane lokalnie`:"Brak utworów";
  els.tracks.innerHTML="";
  if(!tracks.length){els.tracks.className="track-list empty-state";els.tracks.textContent="Dodane utwory pojawią się tutaj.";return}
  els.tracks.className="track-list";
  for(const t of tracks){
    const row=document.createElement("div");row.className="track-item"+(t===activeTrack?" active":"");
    row.innerHTML=`<div class="track-main"><div class="track-name"></div><div class="track-state"></div></div><button class="track-open">Otwórz</button><button class="track-delete">×</button>`;
    row.querySelector(".track-name").textContent=t.name;
    row.querySelector(".track-state").textContent=(t.status||"Gotowe")+(t.duration?` • ${short(t.duration)}`:"")+(t.bpm?` • ${Math.round(t.bpm)} BPM`:"");
    row.querySelector(".track-open").onclick=()=>t.analyzed?openTrack(t):analyzeTrack(t);
    row.querySelector(".track-delete").onclick=async()=>{if(activeTrack===t){els.audio.pause();activeTrack=null;$("analysisCard").classList.add("hidden");$("sectionsCard").classList.add("hidden");$("assistantCard").classList.add("hidden")}URL.revokeObjectURL(t.url);tracks=tracks.filter(x=>x!==t);try{await dbDelete(t.id)}catch{}renderTracks()};
    els.tracks.appendChild(row);
  }
}
$("clearLibraryBtn").onclick=async()=>{els.audio.pause();tracks.forEach(t=>URL.revokeObjectURL(t.url));tracks=[];activeTrack=null;try{await dbClear()}catch{}$("analysisCard").classList.add("hidden");$("sectionsCard").classList.add("hidden");$("assistantCard").classList.add("hidden");renderTracks()};

async function analyzeTrack(track){
  activeTrack=track;activeLoopIndex=null;loopTrim=0;$("loopToggle").checked=false;
  $("analysisCard").classList.remove("hidden");$("sectionsCard").classList.add("hidden");$("assistantCard").classList.add("hidden");$("waveWrap").classList.add("hidden");$("playerWrap").classList.add("hidden");$("statsGrid").classList.add("hidden");$("progressWrap").classList.remove("hidden");$("analysisBadge").textContent="Analiza";$("trackName").textContent=track.name;$("trackMeta").textContent=`${(track.blob.size/1048576).toFixed(1)} MB`;progress(2,"Wczytywanie pliku…");renderTracks();
  try{
    ensureCtx();const arr=await track.blob.arrayBuffer();progress(8,"Dekodowanie audio…");await waitFrame();const buffer=await audioCtx.decodeAudioData(arr.slice(0));track.duration=buffer.duration;
    const mono=mixMono(buffer);progress(18,"Waveform i energia…");track.peaks=makePeaks(mono,950);await waitFrame();
    progress(28,"Wykrywanie tempa i transjentów…");const beat=await estimateBPM(mono,buffer.sampleRate,buffer.duration,p=>progress(28+p*18,"Wykrywanie tempa i transjentów…"));
    track.bpm=beat.bpm;await waitFrame();
    const analysis=await extractFeatures(mono,buffer.sampleRate,buffer.duration,(p,s)=>progress(47+p*34,s));
    progress(84,"Budowanie mapy utworu…");await waitFrame();
    const result=detectSections(analysis,buffer.duration,beat);
    track.sections=numberLabels(result.sections);track.confidence=result.confidence;track.featuresSummary=result.summary;track.analyzed=true;track.status="Gotowe";
    await dbPut(stripRuntime(track));progress(100,`Znaleziono ${track.sections.length} sekcji`);$("analysisBadge").textContent="Gotowe";await new Promise(r=>setTimeout(r,180));openTrack(track);
  }catch(err){console.error(err);track.status="Błąd";$("analysisBadge").textContent="Błąd";$("analysisStatus").textContent="Nie udało się zdekodować pliku. Najpewniejsze formaty na iOS: MP3, AAC/M4A i WAV.";renderTracks()}
}
function progress(v,t){$("analysisProgress").style.width=`${clamp(v,0,100)}%`;$("analysisStatus").textContent=t}
function mixMono(buffer){const len=buffer.length,ch=buffer.numberOfChannels;if(ch===1)return buffer.getChannelData(0).slice();const out=new Float32Array(len);for(let c=0;c<ch;c++){const d=buffer.getChannelData(c);for(let i=0;i<len;i++)out[i]+=d[i]/ch}return out}
function makePeaks(data,count){const out=new Float32Array(count),step=data.length/count;for(let i=0;i<count;i++){const a=Math.floor(i*step),b=Math.floor((i+1)*step);let p=0;for(let j=a;j<b;j+=Math.max(1,Math.floor((b-a)/90)))p=Math.max(p,Math.abs(data[j]));out[i]=p}return out}

async function estimateBPM(data,sr,duration,cb){
  const hop=Math.max(1,Math.floor(sr/200)),envLen=Math.floor(data.length/hop),env=new Float32Array(envLen);let prev=0;
  for(let i=0;i<envLen;i++){let s=0;const a=i*hop,b=Math.min(data.length,a+hop);for(let j=a;j<b;j++)s+=data[j]*data[j];const e=Math.sqrt(s/Math.max(1,b-a));env[i]=Math.max(0,e-prev*.82);prev=e;if(i%3000===0){cb(i/envLen);await waitFrame()}}
  const envRate=sr/hop;let mean=0;for(const x of env)mean+=x;mean/=env.length;for(let i=0;i<env.length;i++)env[i]=Math.max(0,env[i]-mean*.8);
  let bestBpm=120,best=-1;
  for(let bpm=70;bpm<=180;bpm+=.5){const lag=Math.round(envRate*60/bpm);let sum=0;for(let i=lag;i<env.length;i++)sum+=env[i]*env[i-lag];if(sum>best){best=sum;bestBpm=bpm}}
  // normalize common half/double errors toward practical pop range
  if(bestBpm<82)bestBpm*=2;if(bestBpm>168)bestBpm/=2;
  const beatSec=60/bestBpm;
  // infer phase from highest onset in first several beats
  let bestPhase=0,bestPhaseScore=-1;
  const maxPhase=Math.max(1,Math.round(beatSec*envRate));
  for(let ph=0;ph<maxPhase;ph+=Math.max(1,Math.floor(maxPhase/30))){let s=0;for(let i=ph;i<env.length;i+=maxPhase)s+=env[i];if(s>bestPhaseScore){bestPhaseScore=s;bestPhase=ph}}
  return {bpm:bestBpm,beatSec,phaseSec:bestPhase/envRate};
}

function fftMag(input){const n=input.length,re=new Float64Array(n),im=new Float64Array(n);for(let i=0;i<n;i++)re[i]=input[i];let j=0;for(let i=1;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}}for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wlr=Math.cos(ang),wli=Math.sin(ang);for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let k=0;k<len/2;k++){const ur=re[i+k],ui=im[i+k],vr=re[i+k+len/2]*wr-im[i+k+len/2]*wi,vi=re[i+k+len/2]*wi+im[i+k+len/2]*wr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;const nwr=wr*wlr-wi*wli;wi=wr*wli+wi*wlr;wr=nwr}}}const mag=new Float32Array(n/2);for(let i=0;i<mag.length;i++)mag[i]=Math.hypot(re[i],im[i]);return mag}
function norm(v){let n=0;for(const x of v)n+=x*x;n=Math.sqrt(n)||1;for(let i=0;i<v.length;i++)v[i]/=n}
async function extractFeatures(data,sr,duration,cb){
  const hopSec=duration>420?1.75:1.25,frameSec=1.05,N=1024,frames=Math.max(1,Math.floor((duration-frameSec)/hopSec)+1),features=[],energies=[],fluxes=[];let prevBands=null;
  for(let f=0;f<frames;f++){const start=Math.floor(f*hopSec*sr),rawLen=Math.max(1,Math.floor(frameSec*sr)),frame=new Float32Array(N);let sum2=0,zc=0,prev=0;
    for(let i=0;i<N;i++){const src=start+Math.floor(i*rawLen/N),x=src<data.length?data[src]:0,w=.5-.5*Math.cos(2*Math.PI*i/(N-1));frame[i]=x*w;sum2+=x*x;if(i&&(x>=0)!=(prev>=0))zc++;prev=x}
    const rms=Math.sqrt(sum2/N),mag=fftMag(frame),bands=new Float32Array(16);let total=0,centroidNum=0;
    for(let k=1;k<mag.length;k++){const hz=k*sr/N;if(hz<45||hz>Math.min(12000,sr/2))continue;const q=(Math.log(hz)-Math.log(45))/(Math.log(Math.min(12000,sr/2))-Math.log(45)),bi=clamp(Math.floor(q*bands.length),0,bands.length-1),val=mag[k];bands[bi]+=val;total+=val;centroidNum+=val*hz}
    for(let i=0;i<bands.length;i++)bands[i]=Math.log1p(bands[i]);norm(bands);let flux=0;if(prevBands)for(let i=0;i<bands.length;i++)flux+=Math.max(0,bands[i]-prevBands[i]);prevBands=bands.slice();
    const feat=Array.from(bands);feat.push(Math.log1p(rms*90),clamp((total?centroidNum/total:0)/7000,0,1),clamp(zc/250,0,1),flux/7);features.push(feat);energies.push(rms);fluxes.push(flux);
    if(f%10===0){cb(f/frames,"Analiza barwy i zmian harmonicznych…");await waitFrame()}
  }
  smooth(features,2);return{features,energies,fluxes,hopSec}
}
function smooth(a,r){const cp=a.map(v=>v.slice());for(let i=0;i<a.length;i++)for(let d=0;d<a[i].length;d++){let s=0,c=0;for(let j=Math.max(0,i-r);j<=Math.min(a.length-1,i+r);j++){s+=cp[j][d];c++}a[i][d]=s/c}}
function cosine(a,b){let dot=0,aa=0,bb=0,n=Math.min(16,a.length,b.length);for(let i=0;i<n;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return dot/(Math.sqrt(aa*bb)||1)}
function avg(features,a,b){const n=features[0].length,o=new Array(n).fill(0);let c=0;for(let i=Math.max(0,a);i<Math.min(features.length,b);i++,c++)for(let d=0;d<n;d++)o[d]+=features[i][d];if(c)for(let d=0;d<n;d++)o[d]/=c;return o}
function snapToBar(sec,beat,duration){if(!beat?.beatSec)return clamp(sec,0,duration);const bar=beat.beatSec*4,phase=beat.phaseSec||0,n=Math.round((sec-phase)/bar),s=phase+n*bar;return Math.abs(s-sec)<1.4?clamp(s,0,duration):clamp(sec,0,duration)}

function detectSections(a,duration,beat){
  const {features,energies,hopSec}=a,n=features.length;
  if(duration<35||n<8)return{sections:[{label:"Intro",start:0,end:Math.min(duration,10),confidence:.55},{label:"Verse",start:Math.min(duration,10),end:duration,confidence:.45}].filter(s=>s.end-s.start>2),confidence:.45,summary:{}};
  const novelty=new Float32Array(n),r=4;for(let i=r;i<n-r;i++)novelty[i]=1-cosine(avg(features,i-r,i),avg(features,i,i+r));
  const vals=Array.from(novelty).slice(r,n-r).sort((x,y)=>x-y),thr=vals[Math.floor(vals.length*.70)]||.14,cand=[0],minGap=Math.max(5,Math.round(8/hopSec));
  for(let i=r;i<n-r;i++)if(novelty[i]>=thr&&novelty[i]>=novelty[i-1]&&novelty[i]>=novelty[i+1]){if(i-cand[cand.length-1]>=minGap)cand.push(i);else if(novelty[i]>novelty[cand[cand.length-1]])cand[cand.length-1]=i}cand.push(n);
  let bounds=[cand[0]];for(let k=1;k<cand.length;k++){let p=bounds[bounds.length-1],cur=cand[k],mx=Math.round(42/hopSec);while(cur-p>mx){p+=Math.round((cur-p)/2);bounds.push(p)}bounds.push(cur)}
  for(let pass=0;pass<2;pass++){const out=[bounds[0]];for(let i=1;i<bounds.length-1;i++){const p=out[out.length-1],cur=bounds[i],nx=bounds[i+1];if((cur-p)*hopSec<7||(nx-cur)*hopSec<6)continue;out.push(cur)}out.push(bounds[bounds.length-1]);bounds=out}
  let segs=[];for(let i=0;i<bounds.length-1;i++){const fi=bounds[i],fj=bounds[i+1],rawStart=fi*hopSec,rawEnd=i===bounds.length-2?duration:Math.min(duration,fj*hopSec),start=i===0?0:snapToBar(rawStart,beat,duration),end=i===bounds.length-2?duration:snapToBar(rawEnd,beat,duration);if(end-start<4)continue;let e=0,fl=0;for(let x=fi;x<Math.min(fj,energies.length);x++){e+=energies[x];fl+=a.fluxes[x]||0}const c=Math.max(1,fj-fi);segs.push({start,end,feat:avg(features,fi,fj),energy:e/c,flux:fl/c,label:"Verse",repeat:0,bestSimilarity:0,confidence:.55})}
  if(!segs.length)segs=[{start:0,end:duration,label:"Verse",feat:avg(features,0,n),energy:1,flux:0,repeat:0,bestSimilarity:0,confidence:.4}];
  for(let i=0;i<segs.length;i++){let best=0,count=0;for(let j=0;j<segs.length;j++){if(i===j)continue;const di=segs[i].end-segs[i].start,dj=segs[j].end-segs[j].start,ratio=Math.min(di,dj)/Math.max(di,dj),s=cosine(segs[i].feat,segs[j].feat)*(.68+.32*ratio);best=Math.max(best,s);if(s>.88)count++}segs[i].bestSimilarity=best;segs[i].repeat=best+count*.07}
  const es=segs.map(s=>s.energy).sort((x,y)=>x-y),med=es[Math.floor(es.length/2)]||1;
  if(segs[0].end<=24||segs[0].energy<med*.78){segs[0].label="Intro";segs[0].confidence=.78}
  if(segs.length>2){const last=segs[segs.length-1];if(last.end-last.start<28&&(last.energy<med*.82||last.bestSimilarity<.84)){last.label="Outro";last.confidence=.7}}
  let ci=-1,cs=-1;for(let i=0;i<segs.length;i++){if(["Intro","Outro"].includes(segs[i].label))continue;const score=segs[i].repeat+clamp(segs[i].energy/med,.5,2)*.12+clamp(segs[i].flux,0,.5)*.08;if(score>cs){cs=score;ci=i}}
  if(ci>=0&&cs>.86){const anchor=segs[ci];for(let i=0;i<segs.length;i++)if(!["Intro","Outro"].includes(segs[i].label)&&cosine(anchor.feat,segs[i].feat)>.895){segs[i].label="Chorus";segs[i].confidence=clamp(.62+(cosine(anchor.feat,segs[i].feat)-.895)*2.2,0,0.95)}}
  // Pre-chorus: section immediately before chorus, repeated before multiple choruses, or rising energy.
  for(let i=1;i<segs.length-1;i++){if(segs[i].label!=="Verse"||segs[i+1].label!=="Chorus")continue;const dur=segs[i].end-segs[i].start,rise=segs[i].energy<(segs[i+1].energy*1.05);let recurring=false;for(let j=1;j<segs.length-1;j++)if(j!==i&&segs[j+1].label==="Chorus"&&cosine(segs[i].feat,segs[j].feat)>.88)recurring=true;if((dur<28&&rise)||recurring){segs[i].label="Pre-Chorus";segs[i].confidence=recurring?.8:.62}}
  let bi=-1,bs=-1;for(let i=1;i<segs.length-1;i++){if(segs[i].label!=="Verse")continue;const pos=((segs[i].start+segs[i].end)/2)/duration;if(pos<.45||pos>.9)continue;const unique=1-segs[i].bestSimilarity,score=unique+(pos>.58?.08:0);if(score>bs){bs=score;bi=i}}if(bi>=0&&segs.length>=5&&bs>.09){segs[bi].label="Bridge";segs[bi].confidence=clamp(.58+bs,0,0.86)}
  // detect low-energy instrumental break
  for(let i=1;i<segs.length-1;i++)if(segs[i].label==="Verse"&&segs[i].energy<med*.62&&(segs[i].end-segs[i].start)<24){segs[i].label="Break";segs[i].confidence=.58}
  // prevent overlaps from bar snapping
  for(let i=1;i<segs.length;i++){const mid=(segs[i-1].end+segs[i].start)/2;segs[i-1].end=mid;segs[i].start=mid}
  segs[0].start=0;segs[segs.length-1].end=duration;
  const confidence=segs.reduce((s,x)=>s+x.confidence,0)/segs.length;
  return{sections:segs.map((s,i)=>({label:s.label,start:s.start,end:s.end,confidence:s.confidence,similarity:s.bestSimilarity,id:`s_${Date.now()}_${i}`})),confidence,summary:{medianEnergy:med,chorusAnchorScore:cs,hopSec}};
}
function numberLabels(sections){const counts={};return sections.map(s=>{counts[s.label]=(counts[s.label]||0)+1;return{...s,displayLabel:["Verse","Chorus","Pre-Chorus"].includes(s.label)?`${s.label} ${counts[s.label]}`:s.label}})}

function openTrack(t){
  activeTrack=t;activeLoopIndex=null;loopTrim=0;$("loopToggle").checked=false;els.audio.pause();els.audio.src=t.url;els.audio.load();
  $("trackName").textContent=t.name;$("trackMeta").textContent=`${short(t.duration)} • ${(t.blob.size/1048576).toFixed(1)} MB`;$("analysisCard").classList.remove("hidden");$("progressWrap").classList.add("hidden");$("waveWrap").classList.remove("hidden");$("playerWrap").classList.remove("hidden");$("statsGrid").classList.remove("hidden");$("sectionsCard").classList.remove("hidden");$("assistantCard").classList.remove("hidden");$("analysisBadge").textContent="Gotowe";
  $("bpmValue").textContent=t.bpm?Math.round(t.bpm):"—";$("tempoLabel").textContent=tempoName(t.bpm);$("sectionCount").textContent=t.sections?.length||0;$("confidenceValue").textContent=t.confidence?`${Math.round(t.confidence*100)}%`:"—";$("durationTime").textContent=short(t.duration);$("currentTime").textContent="0:00";$("seek").value=0;$("loopLabel").textContent="Wybierz sekcję poniżej";renderTracks();renderSections();drawWave();
}
function tempoName(bpm){if(!bpm)return"—";if(bpm<90)return"Wolne";if(bpm<120)return"Średnie";if(bpm<145)return"Szybkie";return"B. szybkie"}

function renderSections(){
  els.sections.innerHTML="";if(!activeTrack?.sections)return;
  activeTrack.sections=numberLabels(activeTrack.sections.map(s=>({...s,displayLabel:undefined})));
  activeTrack.sections.forEach((s,i)=>{const row=document.createElement("div");row.className="section-item";row.innerHTML=`<div class="section-color"></div><div class="section-body"><div class="section-label"></div><div class="section-time"></div></div><div class="section-actions"><button class="mini-btn playsec">▶</button><button class="mini-btn loopsec">↻</button></div>`;row.querySelector(".section-color").style.background=colors[s.label]||"#79a8ff";row.querySelector(".section-label").textContent=s.displayLabel;const conf=Number.isFinite(s.confidence)?Math.round(s.confidence*100):50;row.querySelector(".section-time").innerHTML=`<span class="confidence-dot" style="opacity:${clamp(conf/100,.3,1)}"></span>${fmt(s.start)} – ${fmt(s.end)} • ${(s.end-s.start).toFixed(1)} s • ${conf}%`;row.querySelector(".section-body").onclick=()=>editSection(i);row.querySelector(".playsec").onclick=()=>playSection(i,false);const lb=row.querySelector(".loopsec");if(activeLoopIndex===i&&$("loopToggle").checked)lb.classList.add("active");lb.onclick=()=>playSection(i,true);els.sections.appendChild(row)});
  $("sectionCount").textContent=activeTrack.sections.length;drawWave();
}
function playSection(i,loop){const s=activeTrack.sections[i];activeLoopIndex=i;loopTrim=0;$("loopToggle").checked=loop;$("loopLabel").textContent=`${s.displayLabel}: ${fmt(s.start)} – ${fmt(s.end)}`;els.audio.currentTime=s.start;els.audio.play().catch(()=>{});renderSections()}
$("playBtn").onclick=async()=>{ensureCtx();if(els.audio.paused)await els.audio.play().catch(()=>{});else els.audio.pause()};
$("back10").onclick=()=>els.audio.currentTime=Math.max(0,els.audio.currentTime-10);$("fwd10").onclick=()=>els.audio.currentTime=Math.min(els.audio.duration||0,els.audio.currentTime+10);
$("seek").oninput=()=>{if(Number.isFinite(els.audio.duration))els.audio.currentTime=($("seek").value/1000)*els.audio.duration};
$("prevSection").onclick=()=>{if(!activeTrack)return;let i=findSectionAt(els.audio.currentTime);i=Math.max(0,(i<0?0:i-1));els.audio.currentTime=activeTrack.sections[i].start;activeLoopIndex=i;if($("loopToggle").checked)renderSections()};
$("nextSection").onclick=()=>{if(!activeTrack)return;let i=findSectionAt(els.audio.currentTime);i=Math.min(activeTrack.sections.length-1,(i<0?0:i+1));els.audio.currentTime=activeTrack.sections[i].start;activeLoopIndex=i;if($("loopToggle").checked)renderSections()};
$("loopToggle").onchange=()=>{if($("loopToggle").checked&&activeLoopIndex===null){let i=findSectionAt(els.audio.currentTime);activeLoopIndex=i<0?0:i}updateLoopLabel();renderSections()};
$("loopMinus").onclick=()=>{loopTrim=clamp(loopTrim-.1,-2,2);updateLoopLabel()};$("loopPlus").onclick=()=>{loopTrim=clamp(loopTrim+.1,-2,2);updateLoopLabel()};
function updateLoopLabel(){if(activeLoopIndex===null||!activeTrack)return;$("loopLabel").textContent=$("loopToggle").checked?`${activeTrack.sections[activeLoopIndex].displayLabel} • korekta końca ${loopTrim>=0?"+":""}${loopTrim.toFixed(1)} s`:"Zapętlanie wyłączone"}
document.querySelectorAll(".speed-buttons button").forEach(b=>b.onclick=()=>{els.audio.playbackRate=Number(b.dataset.speed);document.querySelectorAll(".speed-buttons button").forEach(x=>x.classList.toggle("active",x===b))});
els.audio.onplay=()=>{$("playBtn").textContent="❚❚";tick()};els.audio.onpause=()=>{$("playBtn").textContent="▶";cancelAnimationFrame(raf);updatePlayer()};els.audio.onended=()=>{$("playBtn").textContent="▶"};
els.audio.ontimeupdate=()=>{if($("loopToggle").checked&&activeLoopIndex!==null){const s=activeTrack?.sections?.[activeLoopIndex];if(s&&els.audio.currentTime>=clamp(s.end+loopTrim,s.start+.25,activeTrack.duration)-.035){els.audio.currentTime=s.start;els.audio.play().catch(()=>{})}}};
function tick(){updatePlayer();if(!els.audio.paused)raf=requestAnimationFrame(tick)}function updatePlayer(){const d=els.audio.duration||activeTrack?.duration||0,t=els.audio.currentTime||0;$("currentTime").textContent=short(t);$("seek").value=d?Math.round(t/d*1000):0;els.playhead.style.left=`${d?clamp(t/d*100,0,100):0}%`}function findSectionAt(t){return activeTrack?.sections?.findIndex(s=>t>=s.start&&t<s.end)??-1}

function drawWave(){
  if(!activeTrack?.peaks)return;const c=els.wave,rect=c.getBoundingClientRect(),sc=window.devicePixelRatio||1;c.width=Math.max(600,Math.floor(rect.width*sc));c.height=Math.floor(130*sc);const ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.fillStyle="#0b0e14";ctx.fillRect(0,0,w,h);
  for(const s of activeTrack.sections||[]){ctx.globalAlpha=.10;ctx.fillStyle=colors[s.label]||"#79a8ff";ctx.fillRect(s.start/activeTrack.duration*w,0,(s.end-s.start)/activeTrack.duration*w,h)}ctx.globalAlpha=1;ctx.strokeStyle="#d7e2f5";ctx.lineWidth=Math.max(1,sc);ctx.beginPath();const p=activeTrack.peaks;for(let x=0;x<w;x++){const v=p[Math.floor(x/w*p.length)]||0,amp=Math.max(1,v*h*.43);ctx.moveTo(x,h/2-amp);ctx.lineTo(x,h/2+amp)}ctx.stroke();
  if(activeTrack.bpm){const beat=60/activeTrack.bpm,bar=beat*4;ctx.globalAlpha=.15;ctx.strokeStyle="#fff";ctx.lineWidth=1;for(let t=0;t<activeTrack.duration;t+=bar){const x=t/activeTrack.duration*w;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}}
  for(const s of activeTrack.sections||[]){const x=s.start/activeTrack.duration*w;ctx.strokeStyle=colors[s.label]||"#79a8ff";ctx.globalAlpha=.8;ctx.lineWidth=Math.max(1,sc);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}ctx.globalAlpha=1;
}
window.addEventListener("resize",()=>{clearTimeout(window.__rw);window.__rw=setTimeout(drawWave,100)});
els.wave.onclick=e=>{if(!activeTrack)return;const r=els.wave.getBoundingClientRect();els.audio.currentTime=clamp((e.clientX-r.left)/r.width,0,1)*activeTrack.duration;updatePlayer()};

function editSection(i){const s=activeTrack.sections[i];$("editIndex").value=i;$("editLabel").value=s.label;$("editStart").value=fmt(s.start);$("editEnd").value=fmt(s.end);$("editDialog").showModal()}
$("saveSectionBtn").onclick=async e=>{e.preventDefault();const i=Number($("editIndex").value),s=activeTrack.sections[i],st=parseTime($("editStart").value),en=parseTime($("editEnd").value);if(!Number.isFinite(st)||!Number.isFinite(en)||st<0||en<=st||en>activeTrack.duration+.2)return toast("Sprawdź czas początku i końca.");s.label=$("editLabel").value;s.start=st;s.end=Math.min(en,activeTrack.duration);s.confidence=1;activeTrack.sections.sort((a,b)=>a.start-b.start);activeTrack.sections=numberLabels(activeTrack.sections);$("editDialog").close();renderSections();await dbPut(stripRuntime(activeTrack))};
$("deleteSectionBtn").onclick=async()=>{const i=Number($("editIndex").value);if(activeTrack.sections.length<=1)return toast("Musi pozostać co najmniej jedna sekcja.");activeTrack.sections.splice(i,1);activeLoopIndex=null;$("editDialog").close();renderSections();await dbPut(stripRuntime(activeTrack))};
$("addSectionBtn").onclick=async()=>{if(!activeTrack)return;const st=Math.min(els.audio.currentTime||0,Math.max(0,activeTrack.duration-8)),obj={label:"Verse",displayLabel:"Verse",start:st,end:Math.min(activeTrack.duration,st+8),confidence:1,id:`manual_${Date.now()}`};activeTrack.sections.push(obj);activeTrack.sections.sort((a,b)=>a.start-b.start);renderSections();await dbPut(stripRuntime(activeTrack));const idx=activeTrack.sections.indexOf(obj);if(idx>=0)editSection(idx)};
$("splitSectionBtn").onclick=async()=>{if(!activeTrack)return;const t=els.audio.currentTime,i=findSectionAt(t);if(i<0)return toast("Ustaw kursor wewnątrz sekcji.");const s=activeTrack.sections[i];if(t-s.start<1||s.end-t<1)return toast("Podział jest zbyt blisko granicy sekcji.");const second={...s,start:t,id:`split_${Date.now()}`,confidence:1};s.end=t;s.confidence=1;activeTrack.sections.splice(i+1,0,second);renderSections();await dbPut(stripRuntime(activeTrack))};
$("reanalyzeBtn").onclick=()=>activeTrack&&analyzeTrack(activeTrack);$("infoBtn").onclick=()=>$("infoDialog").showModal();

function buildPrompt(){
  if(!activeTrack)return"";
  const map=activeTrack.sections.map((s,i)=>`${i+1}. ${s.displayLabel}: ${fmt(s.start)}–${fmt(s.end)} (${(s.end-s.start).toFixed(1)} s), confidence ${Math.round((s.confidence||.5)*100)}%`).join("\n");
  return `Pomóż mi zweryfikować mapę struktury utworu muzycznego. Analiza została wykonana lokalnie na iPhonie na podstawie energii, zmian widma, podobieństwa segmentów i estymacji tempa.

Utwór: ${activeTrack.name}
Długość: ${fmt(activeTrack.duration)}
BPM: ${activeTrack.bpm?activeTrack.bpm.toFixed(1):"nieznane"}
Średni confidence: ${activeTrack.confidence?Math.round(activeTrack.confidence*100)+"%":"nieznany"}

Wykryte sekcje:
${map}

Sprawdź logiczność struktury. Jeśli widzisz podejrzane oznaczenia, wskaż które sekcje prawdopodobnie powinny być Intro, Verse, Pre-Chorus, Chorus, Bridge, Break albo Outro. Nie wymyślaj nowych timestampów na podstawie samej nazwy utworu; oceniaj wyłącznie dostarczoną mapę i zależności między fragmentami. Zwróć wynik jako prostą listę sekcji z timestampami.`;
}
$("copyPromptBtn").onclick=async()=>{const p=buildPrompt();if(!p)return;try{await navigator.clipboard.writeText(p);toast("Prompt skopiowany. Wklej go w aplikacji ChatGPT.")}catch{toast("Nie udało się skopiować automatycznie.")}};
$("shareChatGPTBtn").onclick=async()=>{const text=buildPrompt();if(!text)return;if(navigator.share){try{await navigator.share({title:`Song Mapper – ${activeTrack.name}`,text});return}catch(e){if(e.name==="AbortError")return}}try{await navigator.clipboard.writeText(text);toast("Skopiowano analizę. Otwórz ChatGPT i wklej prompt.")}catch{toast("Udostępnianie nie jest dostępne w tej przeglądarce.")}};

if("serviceWorker"in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});
})();