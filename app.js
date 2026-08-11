(() => {
"use strict";
const $=id=>document.getElementById(id);
const els={file:$("fileInput"),map:$("mapInput"),drop:$("dropZone"),tracks:$("trackList"),audio:$("audio"),wave:$("waveCanvas"),playhead:$("playhead"),sections:$("sectionsList"),cues:$("cuesList")};
let tracks=[],activeTrack=null,activeLoopIndex=null,raf=0,audioCtx=null,db=null,loopTrim=0,pendingImport=null,lastCueType="HIT";
const colors={"Intro":"#9ca7b8","Verse":"#79a8ff","Pre-Chorus":"#67d9c5","Chorus":"#ffbe62","Bridge":"#d88dff","Break":"#ff829b","Instrumental":"#70c8ff","Outro":"#a9b4c8"};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),waitFrame=()=>new Promise(r=>requestAnimationFrame(r));
const fmt=s=>{if(!Number.isFinite(s))return"0:00.0";const m=Math.floor(s/60),q=s-m*60;return `${m}:${q<10?"0":""}${q.toFixed(1)}`};
const short=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const parseTime=t=>{t=String(t).trim().replace(",",".");if(t.includes(":")){const p=t.split(":").map(Number);return p.length===2&&!p.some(Number.isNaN)?p[0]*60+p[1]:NaN}return Number(t)};
function toast(m){$("toast").textContent=m;$("toast").classList.remove("hidden");clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").classList.add("hidden"),2800)}
function ensureCtx(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();return audioCtx}
function slug(s){return (s||"song").replace(/\.[^.]+$/,"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-|-$/g,"").toLowerCase()||"song"}
function download(name,text,type="application/json"){const b=new Blob([text],{type}),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open("SongMapperDB",3);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("tracks"))d.createObjectStore("tracks",{keyPath:"id"})};r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)})}
function dbAll(){return new Promise((res,rej)=>{const r=db.transaction("tracks").objectStore("tracks").getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function dbPut(x){return new Promise((res,rej)=>{const r=db.transaction("tracks","readwrite").objectStore("tracks").put(x);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function dbDelete(id){return new Promise((res,rej)=>{const r=db.transaction("tracks","readwrite").objectStore("tracks").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function dbClear(){return new Promise((res,rej)=>{const r=db.transaction("tracks","readwrite").objectStore("tracks").clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function stripRuntime(t){return{id:t.id,name:t.name,blob:t.blob,status:t.status,sections:t.sections,duration:t.duration,peaks:t.peaks?Array.from(t.peaks):null,bpm:t.bpm,confidence:t.confidence,featuresSummary:t.featuresSummary,analyzed:t.analyzed,updatedAt:Date.now(),cues:t.cues||[],mapSource:t.mapSource||"Local",analysisNotes:t.analysisNotes||""}}
async function init(){try{await openDB();const saved=await dbAll();tracks=saved.map(r=>({...r,cues:r.cues||[],mapSource:r.mapSource||"Local",url:URL.createObjectURL(r.blob),file:{name:r.name,size:r.blob.size,type:r.blob.type}}))}catch(e){console.warn(e)}renderTracks()}init();

$("pickBtn").onclick=()=>els.file.click();els.file.onchange=()=>addFiles(els.file.files);
["dragenter","dragover"].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.remove("drag")}));
els.drop.addEventListener("drop",e=>addFiles(e.dataTransfer.files));
async function addFiles(list){const acc=[...list].filter(f=>f.type.startsWith("audio/")||/\.(mp3|m4a|aac|wav|aiff|flac)$/i.test(f.name));if(!acc.length)return toast("Nie znaleziono obsługiwanego audio.");for(const file of acc){const id=crypto.randomUUID?crypto.randomUUID():`${Date.now()}_${Math.random()}`,t={id,name:file.name,blob:file,status:"Oczekuje",sections:null,duration:0,peaks:null,bpm:null,confidence:null,featuresSummary:null,analyzed:false,cues:[],mapSource:"Local",updatedAt:Date.now()};t.url=URL.createObjectURL(file);t.file={name:file.name,size:file.size,type:file.type};tracks.push(t);try{await dbPut(stripRuntime(t))}catch{toast("Dodano utwór, ale zapis trwały nie jest dostępny.")}}renderTracks();if(!activeTrack)analyzeTrack(tracks[tracks.length-acc.length])}
function renderTracks(){$("libraryMeta").textContent=tracks.length?`${tracks.length} ${tracks.length===1?"utwór":"utwory"} zapisane lokalnie`:"Brak utworów";els.tracks.innerHTML="";if(!tracks.length){els.tracks.className="track-list empty-state";els.tracks.textContent="Dodane utwory pojawią się tutaj.";return}els.tracks.className="track-list";for(const t of tracks){const r=document.createElement("div");r.className="track-item"+(t===activeTrack?" active":"");r.innerHTML=`<div class="track-main"><div class="track-name"></div><div class="track-state"></div></div><button class="track-open">Otwórz</button><button class="track-delete">×</button>`;r.querySelector(".track-name").textContent=t.name;r.querySelector(".track-state").textContent=(t.status||"Gotowe")+(t.duration?` • ${short(t.duration)}`:"")+(t.bpm?` • ${Math.round(t.bpm)} BPM`:"")+` • ${t.mapSource||"Local"}`;r.querySelector(".track-open").onclick=()=>t.analyzed?openTrack(t):analyzeTrack(t);r.querySelector(".track-delete").onclick=async()=>{if(activeTrack===t){els.audio.pause();activeTrack=null;hideWorkspace()}URL.revokeObjectURL(t.url);tracks=tracks.filter(x=>x!==t);try{await dbDelete(t.id)}catch{}renderTracks()};els.tracks.appendChild(r)}}
function hideWorkspace(){["analysisCard","chatgptCard","sectionsCard","cuesCard","exchangeCard"].forEach(id=>$(id).classList.add("hidden"))}
$("clearLibraryBtn").onclick=async()=>{els.audio.pause();tracks.forEach(t=>URL.revokeObjectURL(t.url));tracks=[];activeTrack=null;try{await dbClear()}catch{}hideWorkspace();renderTracks()};

async function analyzeTrack(track){activeTrack=track;activeLoopIndex=null;loopTrim=0;$("loopToggle").checked=false;$("analysisCard").classList.remove("hidden");["chatgptCard","sectionsCard","cuesCard","exchangeCard"].forEach(id=>$(id).classList.add("hidden"));$("waveWrap").classList.add("hidden");$("playerWrap").classList.add("hidden");$("statsGrid").classList.add("hidden");$("timelineWrap").classList.add("hidden");$("progressWrap").classList.remove("hidden");$("analysisBadge").textContent="Analiza";$("trackName").textContent=track.name;$("trackMeta").textContent=`${(track.blob.size/1048576).toFixed(1)} MB`;progress(2,"Wczytywanie pliku…");renderTracks();try{ensureCtx();const arr=await track.blob.arrayBuffer();progress(8,"Dekodowanie audio…");await waitFrame();const buffer=await audioCtx.decodeAudioData(arr.slice(0));track.duration=buffer.duration;const mono=mixMono(buffer);progress(18,"Waveform i energia…");track.peaks=makePeaks(mono,950);await waitFrame();progress(28,"Wykrywanie tempa…");const beat=await estimateBPM(mono,buffer.sampleRate,buffer.duration,p=>progress(28+p*18,"Wykrywanie tempa…"));track.bpm=beat.bpm;const analysis=await extractFeatures(mono,buffer.sampleRate,buffer.duration,beat,(p,s)=>progress(47+p*34,s));progress(84,"Budowanie mapy…");await waitFrame();const result=detectSections(analysis,buffer.duration,beat);track.sections=numberLabels(result.sections);track.confidence=result.confidence;track.featuresSummary=result.summary;track.analyzed=true;track.status="Gotowe";track.mapSource="Local Enhanced";track.analysisNotes="Enhanced local analysis v3.1: beat/bar grid + chroma + self-similarity + phrase recurrence";track.cues=track.cues||[];await dbPut(stripRuntime(track));progress(100,`Znaleziono ${track.sections.length} sekcji`);$("analysisBadge").textContent="Gotowe";await new Promise(r=>setTimeout(r,160));openTrack(track)}catch(e){console.error(e);track.status="Błąd";$("analysisBadge").textContent="Błąd";$("analysisStatus").textContent="Nie udało się zdekodować pliku.";renderTracks()}}
function progress(v,t){$("analysisProgress").style.width=`${clamp(v,0,100)}%`;$("analysisStatus").textContent=t}
function mixMono(buffer){const len=buffer.length,ch=buffer.numberOfChannels;if(ch===1)return buffer.getChannelData(0).slice();const out=new Float32Array(len);for(let c=0;c<ch;c++){const d=buffer.getChannelData(c);for(let i=0;i<len;i++)out[i]+=d[i]/ch}return out}
function makePeaks(data,count){const out=new Float32Array(count),step=data.length/count;for(let i=0;i<count;i++){const a=Math.floor(i*step),b=Math.floor((i+1)*step);let p=0;for(let j=a;j<b;j+=Math.max(1,Math.floor((b-a)/90)))p=Math.max(p,Math.abs(data[j]));out[i]=p}return out}

async function estimateBPM(data,sr,duration,cb){
  // High-resolution onset envelope (100 Hz), then tempo autocorrelation.
  const envRate=100,hop=Math.max(1,Math.floor(sr/envRate)),envLen=Math.floor(data.length/hop);
  const env=new Float32Array(envLen),energy=new Float32Array(envLen);
  let prevE=0,prev2=0;
  for(let i=0;i<envLen;i++){
    const a=i*hop,b=Math.min(data.length,a+hop);let sum=0,peak=0;
    for(let j=a;j<b;j++){const x=data[j];sum+=x*x;peak=Math.max(peak,Math.abs(x))}
    const e=Math.sqrt(sum/Math.max(1,b-a));energy[i]=e;
    const fast=Math.max(0,e-prevE);
    const accel=Math.max(0,fast-prev2*.55);
    env[i]=fast*.72+accel*.28+peak*.015;
    prev2=fast;prevE=e;
    if(i%2500===0){cb(i/envLen);await waitFrame()}
  }
  // local adaptive threshold
  const clean=new Float32Array(envLen),radius=40;
  let rolling=0;
  for(let i=0;i<envLen;i++){
    rolling+=env[i];
    if(i-radius>=0)rolling-=env[i-radius];
    const mean=rolling/Math.min(radius,i+1);
    clean[i]=Math.max(0,env[i]-mean*.75);
  }
  // tempo candidates
  let bestBpm=120,bestScore=-1,secondScore=-1;
  const scores=[];
  for(let bpm=60;bpm<=190;bpm+=.25){
    const lag=envRate*60/bpm,li=Math.round(lag);
    let corr=0,n=0;
    for(let i=li;i<clean.length;i+=2){corr+=clean[i]*clean[i-li];n++}
    corr/=Math.max(1,n);
    // reward harmonic support at 2 beats and half-beat, reduce common half/double errors
    let corr2=0,corrHalf=0,n2=0,nh=0;
    const li2=Math.round(lag*2),lih=Math.max(1,Math.round(lag/2));
    for(let i=li2;i<clean.length;i+=3){corr2+=clean[i]*clean[i-li2];n2++}
    for(let i=lih;i<clean.length;i+=3){corrHalf+=clean[i]*clean[i-lih];nh++}
    const score=corr+(corr2/Math.max(1,n2))*.28+(corrHalf/Math.max(1,nh))*.10;
    scores.push([bpm,score]);
    if(score>bestScore){secondScore=bestScore;bestScore=score;bestBpm=bpm}else if(score>secondScore)secondScore=score;
  }
  // Prefer musically plausible equivalent if almost equally strong.
  const candidateScore=b=>{let best=null,dist=1e9;for(const x of scores){const d=Math.abs(x[0]-b);if(d<dist){dist=d;best=x[1]}}return best??-1};
  if(bestBpm<78 && candidateScore(bestBpm*2)>bestScore*.82)bestBpm*=2;
  if(bestBpm>165 && candidateScore(bestBpm/2)>bestScore*.86)bestBpm/=2;
  const beatSec=60/bestBpm,beatSamples=Math.max(1,Math.round(beatSec*envRate));

  // Beat phase: maximize onset strength at projected beat positions.
  let bestPhase=0,bestPhaseScore=-1;
  for(let ph=0;ph<beatSamples;ph+=Math.max(1,Math.floor(beatSamples/45))){
    let sc=0,c=0;
    for(let i=ph;i<clean.length;i+=beatSamples){sc+=clean[i];c++}
    sc/=Math.max(1,c);
    if(sc>bestPhaseScore){bestPhaseScore=sc;bestPhase=ph}
  }
  const tempoConfidence=clamp((bestScore-secondScore)/(Math.abs(bestScore)+1e-9)*6,0.25,0.95);
  return {bpm:bestBpm,beatSec,phaseSec:bestPhase/envRate,tempoConfidence,onsetEnvelope:Array.from(clean),onsetRate:envRate};
}

function fftMag(input){
  const n=input.length,re=new Float64Array(n),im=new Float64Array(n);
  for(let i=0;i<n;i++)re[i]=input[i];
  let j=0;
  for(let i=1;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}}
  for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wlr=Math.cos(ang),wli=Math.sin(ang);for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let k=0;k<len/2;k++){const ur=re[i+k],ui=im[i+k],vr=re[i+k+len/2]*wr-im[i+k+len/2]*wi,vi=re[i+k+len/2]*wi+im[i+k+len/2]*wr;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;const nwr=wr*wlr-wi*wli;wi=wr*wli+wi*wlr;wr=nwr}}}
  const mag=new Float32Array(n/2);for(let i=0;i<mag.length;i++)mag[i]=Math.hypot(re[i],im[i]);return mag
}
function norm(v){let n=0;for(const x of v)n+=x*x;n=Math.sqrt(n)||1;for(let i=0;i<v.length;i++)v[i]/=n}
function cosine(a,b,start=0,end=Math.min(a.length,b.length)){let dot=0,aa=0,bb=0;for(let i=start;i<end;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return dot/(Math.sqrt(aa*bb)||1)}
function avg(features,a,b){const n=features[0].length,o=new Array(n).fill(0);let c=0;for(let i=Math.max(0,a);i<Math.min(features.length,b);i++,c++)for(let d=0;d<n;d++)o[d]+=features[i][d];if(c)for(let d=0;d<n;d++)o[d]/=c;return o}
function percentile(arr,p){if(!arr.length)return 0;const x=arr.slice().sort((a,b)=>a-b);return x[Math.min(x.length-1,Math.max(0,Math.floor((x.length-1)*p)))]}
function zscores(arr){const m=arr.reduce((a,b)=>a+b,0)/Math.max(1,arr.length);let v=0;for(const x of arr)v+=(x-m)*(x-m);const sd=Math.sqrt(v/Math.max(1,arr.length))||1;return arr.map(x=>(x-m)/sd)}
function featureSimilarity(a,b){
  // 12 chroma + 10 spectral/texture dimensions. Harmony carries more weight.
  const chrom=cosine(a,b,0,12),timbre=cosine(a,b,12,Math.min(22,a.length,b.length));
  return clamp(chrom*.62+timbre*.38,0,1);
}

async function extractFeatures(data,sr,duration,beat,cb){
  // ~0.5 beat resolution. This captures harmonic changes without creating huge matrices on iPhone.
  const hopSec=clamp((beat?.beatSec||.5)*.5,.20,.42),frameSec=Math.max(.55,(beat?.beatSec||.5)*1.35);
  const N=2048,frames=Math.max(1,Math.floor((duration-frameSec)/hopSec)+1);
  const features=[],energies=[],fluxes=[],chromaFrames=[];let prevSpec=null;
  for(let f=0;f<frames;f++){
    const start=Math.floor(f*hopSec*sr),rawLen=Math.max(1,Math.floor(frameSec*sr)),frame=new Float32Array(N);
    let sum2=0,zc=0,prev=0;
    for(let i=0;i<N;i++){
      const src=start+Math.floor(i*rawLen/N),x=src<data.length?data[src]:0,w=.5-.5*Math.cos(2*Math.PI*i/(N-1));
      frame[i]=x*w;sum2+=x*x;if(i&&(x>=0)!=(prev>=0))zc++;prev=x
    }
    const rms=Math.sqrt(sum2/N),mag=fftMag(frame),chroma=new Float32Array(12),bands=new Float32Array(8);
    let total=0,centroid=0,high=0,low=0,flux=0;
    for(let k=2;k<mag.length;k++){
      const hz=k*sr/N;if(hz<55||hz>Math.min(12000,sr/2))continue;
      const power=Math.sqrt(mag[k]+1e-9);
      const midi=69+12*Math.log2(hz/440),pc=((Math.round(midi)%12)+12)%12;
      if(hz<5000)chroma[pc]+=power;
      const q=(Math.log(hz)-Math.log(55))/(Math.log(Math.min(12000,sr/2))-Math.log(55));
      const bi=clamp(Math.floor(q*bands.length),0,bands.length-1);bands[bi]+=power;
      total+=power;centroid+=power*hz;if(hz<250)low+=power;if(hz>3000)high+=power;
      if(prevSpec&&k<prevSpec.length)flux+=Math.max(0,power-prevSpec[k]);
    }
    const spec=new Float32Array(mag.length);for(let k=0;k<mag.length;k++)spec[k]=Math.sqrt(mag[k]+1e-9);prevSpec=spec;
    for(let i=0;i<12;i++)chroma[i]=Math.log1p(chroma[i]);norm(chroma);
    for(let i=0;i<bands.length;i++)bands[i]=Math.log1p(bands[i]);norm(bands);
    const feat=[...chroma,...bands,
      Math.log1p(rms*100),
      clamp((total?centroid/total:0)/7000,0,1),
      clamp(zc/350,0,1),
      clamp((high/(low+high+1e-9)),0,1)
    ];
    features.push(feat);energies.push(rms);fluxes.push(flux/(total+1e-9));chromaFrames.push(Array.from(chroma));
    if(f%18===0){cb(f/frames,"Analiza harmonii, barwy i powtarzalności…");await waitFrame()}
  }
  // gentle temporal smoothing
  const cp=features.map(v=>v.slice());
  for(let i=0;i<features.length;i++)for(let d=0;d<features[i].length;d++){
    let acc=0,c=0;for(let j=Math.max(0,i-1);j<=Math.min(features.length-1,i+1);j++){acc+=cp[j][d];c++}features[i][d]=acc/c
  }
  return {features,energies,fluxes,chromaFrames,hopSec,frameSec};
}

function chooseBarPhase(a,beat,duration){
  const beatSec=beat?.beatSec||.5,base=beat?.phaseSec||0;
  let bestOffset=0,bestScore=-Infinity;
  for(let off=0;off<4;off++){
    const first=base+off*beatSec;const scores=[];
    for(let t=first+4*beatSec;t<duration-2*beatSec;t+=4*beatSec){
      const i=Math.round(t/a.hopSec);
      const left=avg(a.features,i-Math.max(2,Math.round(beatSec*2/a.hopSec)),i);
      const right=avg(a.features,i,i+Math.max(2,Math.round(beatSec*2/a.hopSec)));
      scores.push(1-featureSimilarity(left,right));
    }
    const strong=percentile(scores,.75),mean=scores.reduce((x,y)=>x+y,0)/Math.max(1,scores.length);
    const score=strong*.7+mean*.3;
    if(score>bestScore){bestScore=score;bestOffset=off}
  }
  return base+bestOffset*beatSec;
}
function buildBarUnits(a,beat,duration){
  const beatSec=beat?.beatSec||.5,barSec=beatSec*4,phase=chooseBarPhase(a,beat,duration);
  let first=phase;while(first>barSec)first-=barSec;while(first>0)first-=barSec;while(first+barSec<=0)first+=barSec;
  const boundaries=[0];for(let t=first;t<duration;t+=barSec)if(t>1&&t<duration-1)boundaries.push(t);boundaries.push(duration);
  boundaries.sort((x,y)=>x-y);
  const clean=[];for(const x of boundaries)if(!clean.length||x-clean[clean.length-1]>.3)clean.push(x);
  const units=[];
  for(let u=0;u<clean.length-1;u++){
    const st=clean[u],en=clean[u+1],fi=Math.max(0,Math.floor(st/a.hopSec)),fj=Math.min(a.features.length,Math.ceil(en/a.hopSec));
    if(fj<=fi)continue;
    const feat=avg(a.features,fi,fj);let e=0,fl=0;
    for(let i=fi;i<fj;i++){e+=a.energies[i]||0;fl+=a.fluxes[i]||0}
    const c=Math.max(1,fj-fi);units.push({start:st,end:en,feat,energy:e/c,flux:fl/c})
  }
  return {units,barSec,phase};
}
function selfSimilarity(units){
  const n=units.length,m=Array.from({length:n},()=>new Float32Array(n));
  for(let i=0;i<n;i++){m[i][i]=1;for(let j=i+1;j<n;j++){const s=featureSimilarity(units[i].feat,units[j].feat);m[i][j]=m[j][i]=s}}
  return m
}
function checkerNovelty(sim){
  const n=sim.length,out=new Float32Array(n),r=n>120?3:4;
  for(let i=r;i<n-r;i++){
    let same=0,cross=0,c1=0,c2=0;
    for(let a=i-r;a<i;a++)for(let b=i-r;b<i;b++){same+=sim[a][b];c1++}
    for(let a=i;a<i+r;a++)for(let b=i;b<i+r;b++){same+=sim[a][b];c1++}
    for(let a=i-r;a<i;a++)for(let b=i;b<i+r;b++){cross+=sim[a][b];c2++}
    out[i]=Math.max(0,same/Math.max(1,c1)-cross/Math.max(1,c2))
  }
  return out
}
function segmentDescriptor(units,a,b){
  const n=units[0].feat.length,o=new Array(n).fill(0);let e=0,fl=0,c=0;
  for(let i=a;i<b;i++,c++){for(let d=0;d<n;d++)o[d]+=units[i].feat[d];e+=units[i].energy;fl+=units[i].flux}
  if(c)for(let d=0;d<n;d++)o[d]/=c;
  return {feat:o,energy:e/Math.max(1,c),flux:fl/Math.max(1,c)}
}
function segmentPatternSimilarity(units,a0,a1,b0,b1){
  const la=a1-a0,lb=b1-b0,L=Math.min(la,lb);
  if(L<=0)return 0;
  let sc=0;
  for(let k=0;k<L;k++){
    const ia=a0+Math.floor(k*la/L),ib=b0+Math.floor(k*lb/L);
    sc+=featureSimilarity(units[ia].feat,units[ib].feat)
  }
  const lenPenalty=Math.min(la,lb)/Math.max(la,lb);
  return sc/L*(.72+.28*lenPenalty)
}

function detectSections(a,duration,beat){
  if(duration<28||a.features.length<12)return{sections:[{label:"Intro",start:0,end:Math.min(duration,8),confidence:.55},{label:"Verse",start:Math.min(duration,8),end:duration,confidence:.48}].filter(s=>s.end-s.start>2),confidence:.5,summary:{algorithm:"enhanced-v3.1"}};
  const grid=buildBarUnits(a,beat,duration),units=grid.units,n=units.length;
  if(n<5)return{sections:[{label:"Verse",start:0,end:duration,confidence:.45}],confidence:.45,summary:{algorithm:"enhanced-v3.1"}};
  const sim=selfSimilarity(units),nov=checkerNovelty(sim);
  const changes=new Float32Array(n);
  for(let i=1;i<n;i++){
    const harmonic=1-featureSimilarity(units[i-1].feat,units[i].feat);
    const e=Math.abs(Math.log((units[i].energy+1e-5)/(units[i-1].energy+1e-5)));
    const f=Math.abs(units[i].flux-units[i-1].flux);
    changes[i]=harmonic*.64+clamp(e,0,1)*.22+clamp(f*3,0,1)*.14;
  }
  const combined=Array.from({length:n},(_,i)=>(nov[i]||0)*.62+(changes[i]||0)*.38);
  const threshold=Math.max(percentile(combined.slice(1,-1),.67),.07);

  // Candidate phrase boundaries are bars with structural novelty, with a weak 4-bar prior.
  const cand=[0];
  for(let i=2;i<n-2;i++){
    const phrasePrior=(i%4===0)?.035:(i%2===0?.012:0);
    const sc=combined[i]+phrasePrior;
    if(sc>=threshold && sc>=combined[i-1] && sc>=combined[i+1]){
      const last=cand[cand.length-1];
      if(i-last>=2)cand.push(i);
      else if(combined[i]>combined[last])cand[cand.length-1]=i
    }
  }
  cand.push(n);

  // Split implausibly long sections near strongest 4/8-bar candidate.
  let bounds=[cand[0]];
  for(let k=1;k<cand.length;k++){
    let prev=bounds[bounds.length-1],cur=cand[k];
    while(cur-prev>12){
      let best=-1,bi=-1;
      for(let x=prev+4;x<=cur-4;x++){
        const phraseBonus=(x-prev)%4===0?.04:0,sc=combined[x]+phraseBonus;
        if(sc>best){best=sc;bi=x}
      }
      if(bi<0)break;bounds.push(bi);prev=bi
    }
    bounds.push(cur)
  }
  bounds=[...new Set(bounds)].sort((x,y)=>x-y);

  // Remove tiny 1-bar fragments unless the change is exceptionally strong.
  for(let pass=0;pass<2;pass++){
    const out=[bounds[0]];
    for(let i=1;i<bounds.length-1;i++){
      const prev=out[out.length-1],cur=bounds[i],next=bounds[i+1];
      if((cur-prev)<2 && combined[cur]<percentile(combined,.90))continue;
      if((next-cur)<2 && combined[cur]<percentile(combined,.90))continue;
      out.push(cur)
    }
    out.push(bounds[bounds.length-1]);bounds=out
  }

  let segs=[];
  for(let i=0;i<bounds.length-1;i++){
    const a0=bounds[i],a1=bounds[i+1],d=segmentDescriptor(units,a0,a1);
    segs.push({u0:a0,u1:a1,start:units[a0].start,end:units[a1-1].end,...d,label:"Verse",confidence:.54,bestSimilarity:0,repeatCount:0})
  }
  segs[0].start=0;segs[segs.length-1].end=duration;

  // Recurrence at section-pattern level. This is the main chorus/verse signal.
  for(let i=0;i<segs.length;i++){
    let best=0,count=0;
    for(let j=0;j<segs.length;j++){
      if(i===j)continue;
      const ps=segmentPatternSimilarity(units,segs[i].u0,segs[i].u1,segs[j].u0,segs[j].u1);
      best=Math.max(best,ps);if(ps>.83)count++
    }
    segs[i].bestSimilarity=best;segs[i].repeatCount=count
  }
  const medE=percentile(segs.map(x=>x.energy),.5)||1;
  const medFlux=percentile(segs.map(x=>x.flux),.5)||.01;

  // Intro / Outro use position + uniqueness, not just loudness.
  const first=segs[0],firstDur=first.end-first.start;
  if(firstDur<32 && (first.bestSimilarity<.83 || first.energy<medE*.82)){first.label="Intro";first.confidence=.76}
  const last=segs[segs.length-1],lastDur=last.end-last.start;
  if(segs.length>2&&lastDur<32&&(last.bestSimilarity<.82||last.energy<medE*.78)){last.label="Outro";last.confidence=.73}

  // Find recurring families. Chorus favors recurrence across separated positions and a fuller texture,
  // but recurrence is much more important than loudness.
  let chorusIdx=-1,chorusScore=-Infinity;
  for(let i=0;i<segs.length;i++){
    const s=segs[i];if(["Intro","Outro"].includes(s.label))continue;
    let separated=0;
    for(let j=0;j<segs.length;j++)if(i!==j&&Math.abs(j-i)>1&&segmentPatternSimilarity(units,s.u0,s.u1,segs[j].u0,segs[j].u1)>.83)separated++;
    const texture=clamp(s.energy/medE,.6,1.6)-1;
    const score=s.bestSimilarity*.58+Math.min(2,separated)*.16+Math.min(3,s.repeatCount)*.06+texture*.05;
    if(score>chorusScore){chorusScore=score;chorusIdx=i}
  }
  if(chorusIdx>=0 && chorusScore>.68){
    const anchor=segs[chorusIdx];
    for(let i=0;i<segs.length;i++){
      if(["Intro","Outro"].includes(segs[i].label))continue;
      const ps=segmentPatternSimilarity(units,anchor.u0,anchor.u1,segs[i].u0,segs[i].u1);
      if(ps>.82){segs[i].label="Chorus";segs[i].confidence=clamp(.64+(ps-.82)*1.55+Math.min(2,segs[i].repeatCount)*.035,.62,.96)}
    }
  }

  // Determine a second recurring family as verses; unclassified sections are not automatically Verse yet.
  let verseAnchor=-1,verseScore=-1;
  for(let i=0;i<segs.length;i++){
    if(segs[i].label!=="Verse"||["Intro","Outro"].includes(segs[i].label))continue;
    const score=segs[i].bestSimilarity+Math.min(2,segs[i].repeatCount)*.07;
    if(score>verseScore){verseScore=score;verseAnchor=i}
  }
  if(verseAnchor>=0 && verseScore>.78){
    const anchor=segs[verseAnchor];
    for(let i=0;i<segs.length;i++)if(segs[i].label==="Verse"){
      const ps=segmentPatternSimilarity(units,anchor.u0,anchor.u1,segs[i].u0,segs[i].u1);
      if(ps>.80)segs[i].confidence=clamp(.60+(ps-.80)*1.3,.58,.88)
    }
  }

  // Pre-chorus: directly before repeated choruses, usually shorter and harmonically distinct.
  for(let i=0;i<segs.length-1;i++){
    const s=segs[i],next=segs[i+1];if(s.label!=="Verse"||next.label!=="Chorus")continue;
    const bars=s.u1-s.u0,transition=1-featureSimilarity(s.feat,next.feat);
    let counterpart=false;
    for(let j=0;j<segs.length-1;j++){
      if(j===i||segs[j+1].label!=="Chorus")continue;
      if(segmentPatternSimilarity(units,s.u0,s.u1,segs[j].u0,segs[j].u1)>.80){counterpart=true;break}
    }
    if(counterpart || (bars<=6&&transition>.10&&s.energy<=next.energy*1.1)){
      s.label="Pre-Chorus";s.confidence=counterpart?.84:.67
    }
  }

  // Bridge: unique mid/late passage between repeated material.
  let bridge=-1,bridgeScore=-Infinity;
  for(let i=1;i<segs.length-1;i++){
    const s=segs[i];if(s.label!=="Verse")continue;
    const pos=(s.start+s.end)/2/duration;if(pos<.42||pos>.90)continue;
    const unique=1-s.bestSimilarity;
    const surrounded=(segs[i-1].label==="Chorus"||segs[i+1].label==="Chorus")?.10:0;
    const score=unique+surrounded+(pos>.60?.04:0);
    if(score>bridgeScore){bridgeScore=score;bridge=i}
  }
  if(bridge>=0&&segs.length>=5&&bridgeScore>.18){segs[bridge].label="Bridge";segs[bridge].confidence=clamp(.60+bridgeScore*.55,.62,.88)}

  // Break / Instrumental only when there is evidence; otherwise retain Verse.
  for(let i=1;i<segs.length-1;i++){
    const s=segs[i];if(s.label!=="Verse")continue;
    const bars=s.u1-s.u0;
    if(s.energy<medE*.58&&bars<=4){s.label="Break";s.confidence=.61}
    else if(s.flux>medFlux*1.45&&s.bestSimilarity<.74&&bars<=8){s.label="Instrumental";s.confidence=.58}
  }

  // Continuity and exact song limits.
  segs[0].start=0;
  for(let i=1;i<segs.length;i++){const cut=(segs[i-1].end+segs[i].start)/2;segs[i-1].end=cut;segs[i].start=cut}
  segs[segs.length-1].end=duration;

  // confidence also reflects boundary strength
  for(let i=0;i<segs.length;i++){
    const left=i===0?.15:combined[segs[i].u0]||0,right=i===segs.length-1?.15:combined[segs[i].u1]||0;
    const boundaryConf=clamp((left+right)*2.5,.35,.92);
    segs[i].confidence=clamp(segs[i].confidence*.78+boundaryConf*.22,.45,.97)
  }
  const confidence=segs.reduce((x,y)=>x+y.confidence,0)/segs.length;
  return{
    sections:segs.map((x,i)=>({label:x.label,start:x.start,end:x.end,confidence:x.confidence,similarity:x.bestSimilarity,note:"",id:`enh_${Date.now()}_${i}`})),
    confidence,
    summary:{algorithm:"enhanced-v3.1",barSec:grid.barSec,barCount:n,tempoConfidence:beat?.tempoConfidence||null,chorusScore,medianEnergy:medE}
  };
}
function numberLabels(sections){const counts={};return sections.map(s=>{counts[s.label]=(counts[s.label]||0)+1;return{...s,displayLabel:["Verse","Chorus","Pre-Chorus"].includes(s.label)?`${s.label} ${counts[s.label]}`:s.label}})}


function openTrack(t){activeTrack=t;activeLoopIndex=null;loopTrim=0;$("loopToggle").checked=false;els.audio.pause();els.audio.src=t.url;els.audio.load();$("trackName").textContent=t.name;$("trackMeta").textContent=`${short(t.duration)} • ${(t.blob.size/1048576).toFixed(1)} MB`;$("analysisCard").classList.remove("hidden");$("progressWrap").classList.add("hidden");$("waveWrap").classList.remove("hidden");$("playerWrap").classList.remove("hidden");$("statsGrid").classList.remove("hidden");$("timelineWrap").classList.remove("hidden");["chatgptCard","sectionsCard","cuesCard","exchangeCard"].forEach(id=>$(id).classList.remove("hidden"));$("analysisBadge").textContent=t.mapSource==="ChatGPT"?"AI mapa":"Gotowe";$("bpmValue").textContent=t.bpm?Math.round(t.bpm):"—";$("tempoLabel").textContent=tempoName(t.bpm);$("sectionCount").textContent=t.sections?.length||0;$("sourceValue").textContent=t.mapSource||"Local";$("durationTime").textContent=short(t.duration);$("currentTime").textContent="0:00";$("seek").value=0;$("loopLabel").textContent="Wybierz sekcję poniżej";$("importResult").classList.add("hidden");renderTracks();renderSections();renderCues();renderTimeline();drawWave();updatePlayer()}
function tempoName(b){if(!b)return"—";if(b<90)return"Wolne";if(b<120)return"Średnie";if(b<145)return"Szybkie";return"B. szybkie"}

function renderSections(){els.sections.innerHTML="";if(!activeTrack?.sections)return;activeTrack.sections=numberLabels(activeTrack.sections.map(s=>({...s,displayLabel:undefined})));activeTrack.sections.forEach((s,i)=>{const row=document.createElement("div");row.className="section-item";row.innerHTML=`<div class="section-color"></div><div class="section-body"><div class="section-label"></div><div class="section-time"></div></div><div class="section-actions"><button class="mini-btn playsec">▶</button><button class="mini-btn loopsec">↻</button></div>`;row.querySelector(".section-color").style.background=colors[s.label]||"#79a8ff";row.querySelector(".section-label").textContent=s.displayLabel+(s.note?` • ${s.note}`:"");const conf=Number.isFinite(s.confidence)?Math.round(s.confidence*100):50;row.querySelector(".section-time").innerHTML=`<span class="confidence-dot" style="opacity:${clamp(conf/100,.3,1)}"></span>${fmt(s.start)} – ${fmt(s.end)} • ${(s.end-s.start).toFixed(1)} s${s.confidence!=null?` • ${conf}%`:""}`;row.querySelector(".section-body").onclick=()=>editSection(i);row.querySelector(".playsec").onclick=()=>playSection(i,false);const lb=row.querySelector(".loopsec");if(activeLoopIndex===i&&$("loopToggle").checked)lb.classList.add("active");lb.onclick=()=>playSection(i,true);els.sections.appendChild(row)});$("sectionCount").textContent=activeTrack.sections.length;renderTimeline();drawWave()}
function renderCues(){els.cues.innerHTML="";const cs=(activeTrack?.cues||[]).slice().sort((a,b)=>a.time-b.time);if(!cs.length){els.cues.innerHTML='<div class="muted small">Brak cue pointów. Ustaw odtwarzanie w odpowiednim miejscu i dodaj marker.</div>';return}cs.forEach(c=>{const original=activeTrack.cues.indexOf(c),row=document.createElement("div");row.className="cue-item";row.innerHTML=`<div class="cue-tag"></div><div class="cue-time"></div><div class="cue-note"></div><button class="mini-btn">›</button>`;row.querySelector(".cue-tag").textContent=c.type;row.querySelector(".cue-time").textContent=fmt(c.time);row.querySelector(".cue-note").textContent=c.note||"";row.onclick=e=>{if(e.target.tagName==="BUTTON"){editCue(original)}else{els.audio.currentTime=c.time;updatePlayer()}};els.cues.appendChild(row)})}
function renderTimeline(){if(!activeTrack?.duration)return;const dur=activeTrack.duration,secs=activeTrack.sections||[],cues=activeTrack.cues||[];$("timelineSections").innerHTML="";for(const s of secs){const d=document.createElement("div");d.className="timeline-block";d.style.width=`${(s.end-s.start)/dur*100}%`;d.style.background=colors[s.label]||"#79a8ff";d.textContent=s.displayLabel||s.label;d.onclick=()=>{els.audio.currentTime=s.start;updatePlayer()};$("timelineSections").appendChild(d)}$("timelineRuler").innerHTML="";const step=dur>360?60:30;for(let t=0;t<dur;t+=step){const d=document.createElement("div");d.className="ruler-mark";d.style.left=`${t/dur*100}%`;d.textContent=short(t);$("timelineRuler").appendChild(d)}$("timelineCues").innerHTML="";cues.forEach((c,i)=>{const d=document.createElement("div");d.className="timeline-cue";d.style.left=`${c.time/dur*100}%`;d.textContent=c.type;d.onclick=()=>editCue(i);$("timelineCues").appendChild(d)})}

function playSection(i,loop){const s=activeTrack.sections[i];activeLoopIndex=i;loopTrim=0;$("loopToggle").checked=loop;$("loopLabel").textContent=`${s.displayLabel}: ${fmt(s.start)} – ${fmt(s.end)}`;els.audio.currentTime=s.start;els.audio.play().catch(()=>{});renderSections()}
$("playBtn").onclick=async()=>{ensureCtx();if(els.audio.paused)await els.audio.play().catch(()=>{});else els.audio.pause()};$("back10").onclick=()=>els.audio.currentTime=Math.max(0,els.audio.currentTime-10);$("fwd10").onclick=()=>els.audio.currentTime=Math.min(els.audio.duration||0,els.audio.currentTime+10);$("seek").oninput=()=>{if(Number.isFinite(els.audio.duration))els.audio.currentTime=($("seek").value/1000)*els.audio.duration};$("prevSection").onclick=()=>jumpSection(-1);$("nextSection").onclick=()=>jumpSection(1);
function jumpSection(dir){if(!activeTrack)return;let i=findSectionAt(els.audio.currentTime);i=clamp((i<0?0:i)+dir,0,activeTrack.sections.length-1);els.audio.currentTime=activeTrack.sections[i].start;activeLoopIndex=i;if($("loopToggle").checked)renderSections();updatePlayer()}
$("loopToggle").onchange=()=>{if($("loopToggle").checked&&activeLoopIndex===null){let i=findSectionAt(els.audio.currentTime);activeLoopIndex=i<0?0:i}updateLoopLabel();renderSections()};$("loopMinus").onclick=()=>{loopTrim=clamp(loopTrim-.1,-2,2);updateLoopLabel()};$("loopPlus").onclick=()=>{loopTrim=clamp(loopTrim+.1,-2,2);updateLoopLabel()};function updateLoopLabel(){if(activeLoopIndex===null||!activeTrack)return;$("loopLabel").textContent=$("loopToggle").checked?`${activeTrack.sections[activeLoopIndex].displayLabel} • koniec ${loopTrim>=0?"+":""}${loopTrim.toFixed(1)}s`:"Zapętlanie wyłączone"}
document.querySelectorAll(".speed-buttons button").forEach(b=>b.onclick=()=>{els.audio.playbackRate=Number(b.dataset.speed);document.querySelectorAll(".speed-buttons button").forEach(x=>x.classList.toggle("active",x===b))});
els.audio.onplay=()=>{$("playBtn").textContent="❚❚";tick()};els.audio.onpause=()=>{$("playBtn").textContent="▶";cancelAnimationFrame(raf);updatePlayer()};els.audio.ontimeupdate=()=>{if($("loopToggle").checked&&activeLoopIndex!==null){const s=activeTrack?.sections?.[activeLoopIndex];if(s&&els.audio.currentTime>=clamp(s.end+loopTrim,s.start+.25,activeTrack.duration)-.035){els.audio.currentTime=s.start;els.audio.play().catch(()=>{})}}};function tick(){updatePlayer();if(!els.audio.paused)raf=requestAnimationFrame(tick)}
function updatePlayer(){const d=els.audio.duration||activeTrack?.duration||0,t=els.audio.currentTime||0;$("currentTime").textContent=short(t);$("seek").value=d?Math.round(t/d*1000):0;els.playhead.style.left=`${d?clamp(t/d*100,0,100):0}%`;const i=findSectionAt(t);$("nowSection").textContent=i>=0?(activeTrack.sections[i].displayLabel||activeTrack.sections[i].label):"—"}
function findSectionAt(t){return activeTrack?.sections?.findIndex(s=>t>=s.start&&t<s.end)??-1}

function drawWave(){if(!activeTrack?.peaks)return;const c=els.wave,rect=c.getBoundingClientRect(),sc=window.devicePixelRatio||1;c.width=Math.max(600,Math.floor(rect.width*sc));c.height=Math.floor(130*sc);const ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.fillStyle="#0b0e14";ctx.fillRect(0,0,w,h);for(const s of activeTrack.sections||[]){ctx.globalAlpha=.10;ctx.fillStyle=colors[s.label]||"#79a8ff";ctx.fillRect(s.start/activeTrack.duration*w,0,(s.end-s.start)/activeTrack.duration*w,h)}ctx.globalAlpha=1;ctx.strokeStyle="#d7e2f5";ctx.beginPath();const p=activeTrack.peaks;for(let x=0;x<w;x++){const v=p[Math.floor(x/w*p.length)]||0,a=Math.max(1,v*h*.43);ctx.moveTo(x,h/2-a);ctx.lineTo(x,h/2+a)}ctx.stroke();for(const s of activeTrack.sections||[]){const x=s.start/activeTrack.duration*w;ctx.strokeStyle=colors[s.label]||"#79a8ff";ctx.globalAlpha=.8;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}ctx.globalAlpha=1}
window.addEventListener("resize",()=>{clearTimeout(window.__rw);window.__rw=setTimeout(drawWave,100)});els.wave.onclick=e=>{if(!activeTrack)return;const r=els.wave.getBoundingClientRect();els.audio.currentTime=clamp((e.clientX-r.left)/r.width,0,1)*activeTrack.duration;updatePlayer()};

function editSection(i){const s=activeTrack.sections[i];$("editIndex").value=i;$("editLabel").value=s.label;$("editStart").value=fmt(s.start);$("editEnd").value=fmt(s.end);$("editNote").value=s.note||"";$("editDialog").showModal()}
$("saveSectionBtn").onclick=async()=>{const i=Number($("editIndex").value),s=activeTrack.sections[i],st=parseTime($("editStart").value),en=parseTime($("editEnd").value);if(!Number.isFinite(st)||!Number.isFinite(en)||st<0||en<=st||en>activeTrack.duration+.3)return toast("Sprawdź timestampy.");s.label=$("editLabel").value;s.start=st;s.end=Math.min(en,activeTrack.duration);s.note=$("editNote").value.trim();s.confidence=1;activeTrack.sections.sort((a,b)=>a.start-b.start);activeTrack.mapSource=activeTrack.mapSource==="ChatGPT"?"ChatGPT + manual":"Local + manual";$("editDialog").close();renderSections();await dbPut(stripRuntime(activeTrack));renderTracks();$("sourceValue").textContent=activeTrack.mapSource};
$("deleteSectionBtn").onclick=async()=>{const i=Number($("editIndex").value);if(activeTrack.sections.length<=1)return toast("Musi pozostać co najmniej jedna sekcja.");activeTrack.sections.splice(i,1);$("editDialog").close();renderSections();await dbPut(stripRuntime(activeTrack))};
$("addSectionBtn").onclick=async()=>{if(!activeTrack)return;const st=Math.min(els.audio.currentTime,Math.max(0,activeTrack.duration-8)),o={label:"Verse",start:st,end:Math.min(activeTrack.duration,st+8),confidence:1,note:"",id:`m_${Date.now()}`};activeTrack.sections.push(o);activeTrack.sections.sort((a,b)=>a.start-b.start);renderSections();await dbPut(stripRuntime(activeTrack));editSection(activeTrack.sections.indexOf(o))};
$("splitSectionBtn").onclick=async()=>{if(!activeTrack)return;const t=els.audio.currentTime,i=findSectionAt(t);if(i<0)return toast("Ustaw kursor wewnątrz sekcji.");const s=activeTrack.sections[i];if(t-s.start<1||s.end-t<1)return toast("Za blisko granicy.");const second={...s,start:t,id:`split_${Date.now()}`,confidence:1};s.end=t;s.confidence=1;activeTrack.sections.splice(i+1,0,second);renderSections();await dbPut(stripRuntime(activeTrack))};$("reanalyzeBtn").onclick=()=>activeTrack&&analyzeTrack(activeTrack);

function openCue(type="HIT",time=els.audio.currentTime,index=""){lastCueType=type;$("cueIndex").value=index;$("cueType").value=type;$("cueTime").value=fmt(time);$("cueNote").value=index!==""?(activeTrack.cues[index]?.note||""):"";$("deleteCueBtn").style.visibility=index===""?"hidden":"visible";$("cueDialog").showModal()}
document.querySelectorAll(".cue-types button").forEach(b=>b.onclick=()=>openCue(b.dataset.cue,els.audio.currentTime,""));$("addCueNowBtn").onclick=()=>openCue(lastCueType,els.audio.currentTime,"");
function editCue(i){const c=activeTrack.cues[i];openCue(c.type,c.time,i)}
$("saveCueBtn").onclick=async()=>{const i=$("cueIndex").value,t=parseTime($("cueTime").value),type=$("cueType").value,note=$("cueNote").value.trim();if(!Number.isFinite(t)||t<0||t>activeTrack.duration)return toast("Nieprawidłowy czas cue.");const obj={type,time:t,note,id:`cue_${Date.now()}`};if(i==="")activeTrack.cues.push(obj);else activeTrack.cues[Number(i)]={...activeTrack.cues[Number(i)],...obj};activeTrack.cues.sort((a,b)=>a.time-b.time);$("cueDialog").close();renderCues();renderTimeline();await dbPut(stripRuntime(activeTrack))};$("deleteCueBtn").onclick=async()=>{const i=Number($("cueIndex").value);activeTrack.cues.splice(i,1);$("cueDialog").close();renderCues();renderTimeline();await dbPut(stripRuntime(activeTrack))};

function exportObject(){return{format:"SongMapper",version:3,song:{title:activeTrack.name.replace(/\.[^.]+$/,""),audioFileName:activeTrack.name,duration:Number(activeTrack.duration.toFixed(3)),bpm:activeTrack.bpm?Number(activeTrack.bpm.toFixed(2)):null},analysis:{source:activeTrack.mapSource||"Local",notes:activeTrack.analysisNotes||""},sections:(activeTrack.sections||[]).map(s=>({type:s.label,start:Number(s.start.toFixed(3)),end:Number(s.end.toFixed(3)),confidence:s.confidence==null?null:Number(s.confidence.toFixed(3)),note:s.note||""})),cues:(activeTrack.cues||[]).map(c=>({type:c.type,time:Number(c.time.toFixed(3)),note:c.note||""}))}}
$("exportMapBtn").onclick=()=>download(`${slug(activeTrack.name)}.songmap.json`,JSON.stringify(exportObject(),null,2));$("copyMapBtn").onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(exportObject(),null,2));toast("Mapa JSON skopiowana.")}catch{toast("Nie udało się skopiować.")}};

function chatPrompt(){
const local=JSON.stringify(exportObject(),null,2);
return `SONG MAPPER v3 — ANALIZA AUDIO I PLIK IMPORTU

Przeanalizuj ZAŁĄCZONY PLIK AUDIO jako rzeczywisty utwór muzyczny. Nie opieraj się wyłącznie na poniższej lokalnej analizie — traktuj ją jako sugestię pomocniczą.

CEL
1. Rozpoznaj rzeczywiste granice struktury utworu.
2. Używaj typów: Intro, Verse, Pre-Chorus, Chorus, Bridge, Break, Instrumental, Outro.
3. Jeżeli utwór nie pasuje do klasycznej struktury, dobierz najbliższy logiczny typ; nie twórz sztucznych refrenów.
4. Timestampy mają być możliwie precyzyjne do 0.1 s i ciągłe: pierwsza sekcja start=0, koniec jednej sekcji = start następnej, ostatni end = długość audio.
5. Chorus oznaczaj na podstawie faktycznego powtarzalnego motywu/refrenu, nie tylko energii.
6. Uwzględnij wejście/wyjście wokalu, zmianę instrumentacji, harmonii, groove'u, build-upy i dropy.
7. Dodaj SHOW CUES, kiedy słyszysz istotne punkty dla operatora oświetlenia: DROP, BUILD, BREAKDOWN, HIT, BLACKOUT, ACCENT, VOCAL IN, VOCAL OUT. Nie dodawaj markerów na siłę. HIT/ACCENT tylko dla wyraźnych zdarzeń.
8. confidence: 0–1 dla każdej sekcji.
9. BPM zweryfikuj z audio.

WAŻNE
Zwróć wynik jako GOTOWY PLIK do pobrania o nazwie:
${slug(activeTrack.name)}.songmap.json

Nie zwracaj Markdownu zamiast pliku. Plik musi zawierać poprawny UTF-8 JSON i dokładnie ten model danych:
{
  "format": "SongMapper",
  "version": 3,
  "song": {
    "title": "tytuł",
    "audioFileName": "${activeTrack.name}",
    "duration": 0.0,
    "bpm": 0.0
  },
  "analysis": {
    "source": "ChatGPT",
    "notes": "krótka informacja o strukturze / ewentualnych niepewnościach"
  },
  "sections": [
    {
      "type": "Intro",
      "start": 0.0,
      "end": 12.4,
      "confidence": 0.95,
      "note": ""
    }
  ],
  "cues": [
    {
      "type": "VOCAL IN",
      "time": 12.4,
      "note": "pierwsze wejście wokalu"
    }
  ]
}

DOZWOLONE section.type:
Intro, Verse, Pre-Chorus, Chorus, Bridge, Break, Instrumental, Outro

DOZWOLONE cue.type:
DROP, BUILD, BREAKDOWN, HIT, BLACKOUT, ACCENT, VOCAL IN, VOCAL OUT, CUSTOM

Przed utworzeniem pliku sprawdź:
- JSON parsuje się bez błędu,
- section.start/end są liczbami w sekundach,
- sekcje są chronologiczne i nie nachodzą na siebie,
- nie ma luk między sekcjami większych niż 0.2 s,
- żaden timestamp nie wykracza poza długość audio,
- duration zgadza się z plikiem audio,
- source = "ChatGPT".

LOKALNA MAPA Z SONG MAPPER (TYLKO JAKO POMOC):
${local}
`;
}
$("exportPromptBtn").onclick=()=>download(`${slug(activeTrack.name)}-CHATGPT-INSTRUCTIONS.txt`,chatPrompt(),"text/plain;charset=utf-8");
$("importMapBtn").onclick=()=>els.map.click();els.map.onchange=async()=>{const f=els.map.files[0];els.map.value="";if(!f)return;try{const obj=JSON.parse(await f.text()),check=validateMap(obj);if(!check.ok)throw new Error(check.errors.join("\n"));pendingImport=obj;const delta=Math.abs((obj.song?.duration||0)-activeTrack.duration);$("importPreview").innerHTML=`<b>${obj.song?.title||f.name}</b><br>${obj.sections.length} sekcji • ${(obj.cues||[]).length} cues • BPM ${obj.song?.bpm||"—"}<br>Źródło: ${obj.analysis?.source||"nieznane"}<br>Różnica długości względem audio: ${delta.toFixed(2)} s`;$("importDialog").showModal()}catch(e){toast("Błąd mapy: "+String(e.message).slice(0,180))}};
function validateMap(o){const errors=[];if(o?.format!=="SongMapper")errors.push("format musi być SongMapper");if(Number(o?.version)<3)errors.push("wymagana wersja 3");if(!Array.isArray(o?.sections)||!o.sections.length)errors.push("brak sections");const allowed=new Set(["Intro","Verse","Pre-Chorus","Chorus","Bridge","Break","Instrumental","Outro"]);let prev=0;if(Array.isArray(o.sections))o.sections.forEach((s,i)=>{if(!allowed.has(s.type))errors.push(`sekcja ${i+1}: nieznany typ ${s.type}`);if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<=s.start)errors.push(`sekcja ${i+1}: błędne czasy`);if(i&&s.start<prev-.2)errors.push(`sekcja ${i+1}: nakłada się`);prev=s.end});if(activeTrack&&Number.isFinite(o?.song?.duration)&&Math.abs(o.song.duration-activeTrack.duration)>3)errors.push(`długość mapy różni się od audio o >3 s`);return{ok:!errors.length,errors}}
$("confirmImportBtn").onclick=async()=>{if(!pendingImport)return;const mode=$("importMode").value,o=pendingImport;activeTrack.sections=o.sections.map((s,i)=>({label:s.type,start:s.start,end:s.end,confidence:s.confidence??.8,note:s.note||"",id:`ai_${Date.now()}_${i}`}));if(mode==="replace")activeTrack.cues=(o.cues||[]).map((c,i)=>({...c,id:`aicue_${Date.now()}_${i}`}));if(mode==="sections")activeTrack.cues=activeTrack.cues||[];if(mode==="mergecues"){const imported=(o.cues||[]).map((c,i)=>({...c,id:`aicue_${Date.now()}_${i}`}));activeTrack.cues=[...(activeTrack.cues||[]),...imported].sort((a,b)=>a.time-b.time)}if(Number.isFinite(o.song?.bpm))activeTrack.bpm=o.song.bpm;activeTrack.mapSource="ChatGPT";activeTrack.analysisNotes=o.analysis?.notes||"";activeTrack.confidence=activeTrack.sections.reduce((s,x)=>s+(x.confidence||.7),0)/activeTrack.sections.length;activeTrack.status="Gotowe";activeTrack.analyzed=true;await dbPut(stripRuntime(activeTrack));$("importDialog").close();pendingImport=null;openTrack(activeTrack);const box=$("importResult");box.textContent=`Zaimportowano mapę ChatGPT: ${activeTrack.sections.length} sekcji, ${activeTrack.cues.length} cues.`;box.classList.remove("hidden");toast("Mapa ChatGPT została zaimportowana.")};

$("infoBtn").onclick=()=>$("infoDialog").showModal();
if("serviceWorker"in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(()=>{});
})();