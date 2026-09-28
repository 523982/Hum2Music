(() => {
"use strict";

const HOP=256;
let rec=null,stream=null,chunks=[],recording=false,start=0,timerId=null;
let original=[],quantized=[],audioCtx=null,players=[];
const $=id=>document.getElementById(id);
const names=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const nm=n=>names[(n%12+12)%12]+(Math.floor(n/12)-1);
const fmt=s=>String(Math.floor(s/60)).padStart(2,"0")+":"+String(Math.floor(s%60)).padStart(2,"0");
const mode=()=>document.querySelector('input[name="mode"]:checked').value;

function debug(s){
  const d=$("debug");
  if(d) d.textContent=s;
}

function setStatus(s){ $("status").textContent=s; }

function boot(){
  $("engine").textContent =
    window.isSecureContext ? "Browser microphone engine ready" : "Microphone requires HTTPS";
  debug(
    "Secure context: "+window.isSecureContext+
    "\\ngetUserMedia: "+!!navigator.mediaDevices?.getUserMedia+
    "\\nMediaRecorder: "+!!window.MediaRecorder+
    "\\nSafari/iOS can now request the microphone from this button."
  );

  $("record").addEventListener("click", startRecording, {passive:false});
  $("stop").addEventListener("click", stopRecording);
  $("clear").addEventListener("click", clearAll);
  $("play").addEventListener("click", playMelody);
  $("stopplay").addEventListener("click", stopPlayback);
  $("midi").addEventListener("click", exportMidi);

  document.querySelectorAll('input[name="mode"],#division,#bpm').forEach(e=>{
    e.addEventListener("change",()=>{
      if(original.length){quantized=quant(original);render();}
    });
  });

  draw([]);
}

async function startRecording(ev){
  ev?.preventDefault();
  debug("Start button clicked.");

  try{
    if(!window.isSecureContext)
      throw new Error("This page is not running in a secure context. Open the GitHub Pages HTTPS URL.");

    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new Error("Safari did not expose microphone access. Check Settings → Safari → Microphone.");

    if(!window.MediaRecorder)
      throw new Error("This browser does not support MediaRecorder. Update iOS/Safari.");

    setStatus("Requesting microphone permission…");
    debug("Requesting microphone permission…");

    stream=await navigator.mediaDevices.getUserMedia({
      audio:{
        channelCount:1,
        echoCancellation:false,
        noiseSuppression:false,
        autoGainControl:false
      }
    });

    debug("Microphone permission granted.");

    chunks=[];
    let mime="";
    const candidates=["audio/mp4","audio/webm;codecs=opus","audio/webm"];
    for(const c of candidates){
      try{
        if(MediaRecorder.isTypeSupported(c)){mime=c;break;}
      }catch{}
    }

    rec=mime ? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream);
    rec.ondataavailable=e=>{if(e.data && e.data.size)chunks.push(e.data);};
    rec.onerror=e=>{
      console.error(e);
      setStatus("Recorder error — see diagnostic text below.");
      debug("Recorder error: "+(e.error?.message||"unknown error"));
    };
    rec.onstop=analyse;

    rec.start(200);
    recording=true;
    start=performance.now();

    $("record").disabled=true;
    $("stop").disabled=false;
    $("clear").disabled=true;

    setStatus("Recording… hum your complete melody");
    timerId=setInterval(()=>{
      $("timer").textContent=fmt((performance.now()-start)/1000);
    },100);
  }catch(e){
    console.error(e);
    setStatus(e.message || "Could not start recording.");
    debug(
      "ERROR: "+(e.message||e)+
      "\\nSecure: "+window.isSecureContext+
      "\\ngetUserMedia: "+!!navigator.mediaDevices?.getUserMedia+
      "\\nMediaRecorder: "+!!window.MediaRecorder
    );
    stream?.getTracks().forEach(t=>t.stop());
    stream=null;
  }
}

function stopRecording(){
  if(!recording || !rec)return;
  recording=false;
  try{rec.stop();}catch{}
  stream?.getTracks().forEach(t=>t.stop());
  stream=null;
  clearInterval(timerId);
  $("record").disabled=false;
  $("stop").disabled=true;
  $("clear").disabled=false;
  setStatus("Analysing pitch + rhythm…");
}

async function analyse(){
  try{
    const blob=new Blob(chunks,{type:rec?.mimeType||"audio/mp4"});
    if(!blob.size)throw new Error("No audio data was recorded.");

    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)throw new Error("Safari AudioContext is unavailable.");

    const ctx=new Ctx();
    const buf=await ctx.decodeAudioData(await blob.arrayBuffer());
    await ctx.close();

    if(buf.duration<0.6)throw new Error("Recording is too short.");
    if(buf.duration>30)throw new Error("Keep recordings below 30 seconds.");

    original=detectMelody(buf.getChannelData(0),buf.sampleRate);
    quantized=quant(original);

    if(!original.length)
      throw new Error("No stable melody found. Try a clearer, louder hum.");

    render();
    setStatus(`Done — ${original.length} notes detected`);
    $("play").disabled=false;
    $("stopplay").disabled=false;
    $("midi").disabled=false;
    debug("Analysis complete.");
  }catch(e){
    console.error(e);
    setStatus(e.message||"Analysis failed.");
    debug("ANALYSIS ERROR: "+(e.message||e));
  }
}

function detectMelody(x,sr){
  const fs=2048,minHz=70,maxHz=1000;
  const minLag=Math.floor(sr/maxHz);
  const maxLag=Math.min(Math.floor(sr/minHz),fs-1);
  const frames=[];let total=0;

  for(let s=0;s+fs<=x.length;s+=HOP){
    let sum=0;
    for(let i=0;i<fs;i++)sum+=x[s+i]*x[s+i];
    const rms=Math.sqrt(sum/fs);
    frames.push({s,rms});total+=rms;
  }

  const threshold=Math.max(.008,(total/Math.max(1,frames.length))*.35);
  const points=[];

  for(const f of frames){
    if(f.rms<threshold){points.push(null);continue;}
    const b=f.s,e=b+fs;
    let mean=0;
    for(let i=b;i<e;i++)mean+=x[i];
    mean/=fs;

    let best=-1,bestCorr=0;
    for(let lag=minLag;lag<=maxLag;lag++){
      let sum=0,aa=0,bb=0;
      for(let i=b;i<e-lag;i++){
        const a=x[i]-mean,v=x[i+lag]-mean;
        sum+=a*v;aa+=a*a;bb+=v*v;
      }
      const corr=sum/Math.sqrt((aa*bb)||1);
      if(corr>bestCorr){bestCorr=corr;best=lag;}
    }

    if(best<0||bestCorr<.52){points.push(null);continue;}
    const hz=sr/best;
    if(hz<minHz||hz>maxHz){points.push(null);continue;}

    points.push({
      m:Math.round(69+12*Math.log2(hz/440)),
      s:b/sr,e:e/sr
    });
  }

  const notes=[];let cur=null;const frameSec=HOP/sr;

  for(const p of points){
    if(!p){
      if(cur){
        if(cur.last-cur.s>=.10)
          notes.push({t:cur.s,d:cur.last-cur.s,m:cur.m});
        cur=null;
      }
      continue;
    }

    if(!cur){cur={s:p.s,last:p.e,m:p.m};continue;}

    if(p.s-cur.last<=frameSec*2.5 && Math.abs(p.m-cur.m)<=1){
      cur.last=p.e;
      cur.m=Math.round((cur.m*3+p.m)/4);
    }else{
      if(cur.last-cur.s>=.10)
        notes.push({t:cur.s,d:cur.last-cur.s,m:cur.m});
      cur={s:p.s,last:p.e,m:p.m};
    }
  }

  if(cur&&cur.last-cur.s>=.10)
    notes.push({t:cur.s,d:cur.last-cur.s,m:cur.m});

  return clean(notes);
}

function clean(ns){
  const out=[];
  for(const n of ns){
    const p=out.at(-1);
    if(!p){out.push({...n});continue;}
    const gap=n.t-(p.t+p.d);
    if(n.m===p.m&&gap<.10){p.d=n.t+n.d-p.t;continue;}
    if(n.d<.13&&Math.abs(n.m-p.m)<=2&&gap<.06){
      p.d=n.t+n.d-p.t;continue;
    }
    out.push({...n});
  }
  return out;
}

function quant(ns){
  const bpm=Math.max(50,Math.min(180,Number($("bpm").value)||100));
  const grid=60/bpm/(Number($("division").value)||8);
  return ns.map(n=>({...n,t:Math.max(0,Math.round(n.t/grid)*grid),d:Math.max(grid,Math.round(n.d/grid)*grid}));
}

function active(){return mode()==="quantized"?quantized:original;}

function render(){
  const ns=active();
  $("count").textContent=`${ns.length} notes · ${mode()==="quantized"?"quantized":"original timing"}`;
  $("notes").innerHTML=ns.map(n=>`<span class="note">${nm(n.m)} · ${n.d.toFixed(2)}s · ${n.t.toFixed(2)}s</span>`).join("");
  draw(ns);
}

function draw(ns){
  const canvas=$("roll"),c=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
  c.clearRect(0,0,w,h);c.fillStyle="#0b0e14";c.fillRect(0,0,w,h);
  if(!ns.length)return;

  const lo=Math.min(...ns.map(n=>n.m))-4;
  const hi=Math.max(...ns.map(n=>n.m))+4;
  const total=Math.max(...ns.map(n=>n.t+n.d),1);
  const row=h/(hi-lo+1),left=48;

  for(let m=lo;m<=hi;m++){
    const y=h-(m-lo+1)*row;
    c.strokeStyle=m%12===0?"#2b3240":"#181d26";
    c.beginPath();c.moveTo(left,y);c.lineTo(w,y);c.stroke();
    c.fillStyle="#667083";c.font="10px sans-serif";c.fillText(nm(m),5,y+10);
  }

  for(const n of ns){
    const x=left+n.t/total*(w-left-8);
    const width=Math.max(4,n.d/total*(w-left-8)-2);
    const y=h-(n.m-lo+1)*row;
    c.fillStyle="#e3e7ed";c.fillRect(x,y+2,width,Math.max(7,row-4));
  }
}

function playMelody(){
  const ns=active();if(!ns.length)return;
  stopPlayback();

  const Ctx=window.AudioContext||window.webkitAudioContext;
  audioCtx=new Ctx();
  const base=audioCtx.currentTime+.08;

  for(const n of ns){
    const o=audioCtx.createOscillator(),g=audioCtx.createGain(),t=base+n.t;
    o.type="sine";
    o.frequency.value=440*Math.pow(2,(n.m-69)/12);
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(.16,t+.015);
    g.gain.exponentialRampToValueAtTime(.0001,t+Math.max(.04,n.d-.02));
    o.connect(g).connect(audioCtx.destination);
    o.start(t);o.stop(t+n.d+.03);
    players.push(o);
  }
  setStatus(`Playing ${mode()==="quantized"?"quantized":"original"} timing…`);
}

function stopPlayback(){
  players.forEach(o=>{try{o.stop();}catch{}});
  players=[];
  if(audioCtx){audioCtx.close().catch(()=>{});audioCtx=null;}
}

function exportMidi(){
  const ns=active(),ppq=480,bpm=Number($("bpm").value)||100,beat=60/bpm;
  let tr=[],cursor=0;

  for(const n of ns){
    const d=Math.max(0,Math.round((n.t-cursor)/beat*ppq));
    const du=Math.max(1,Math.round(n.d/beat*ppq));
    tr.push(...vlq(d),144,n.m,92,...vlq(du),128,n.m,0);
    cursor=n.t+n.d;
  }

  tr.push(0,255,47,0);

  const h=[77,84,104,100,0,0,0,6,0,0,0,1,1,224];
  const l=tr.length;
  const b=[77,84,114,107,(l>>>24)&255,(l>>>16)&255,(l>>>8)&255,l&255,...tr];

  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([new Uint8Array([...h,...b])],{type:"audio/midi"}));
  a.download=`hum2music-${mode()}-timing.mid`;
  a.click();
}

function vlq(n){
  const a=[n&127];
  while(n>>=7)a.unshift((n&127)|128);
  return a;
}

function clearAll(){
  stopPlayback();
  original=[];quantized=[];
  $("notes").textContent="Record something to see the melody.";
  $("count").textContent="0 notes";
  $("timer").textContent="00:00";
  setStatus("Ready — tap Start recording");
  $("play").disabled=true;$("stopplay").disabled=true;$("midi").disabled=true;
  debug("Ready.");
  draw([]);
}

window.addEventListener("error",e=>{
  debug("JAVASCRIPT ERROR: "+e.message);
});

window.addEventListener("unhandledrejection",e=>{
  debug("PROMISE ERROR: "+(e.reason?.message||e.reason));
});

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
else boot();
})();