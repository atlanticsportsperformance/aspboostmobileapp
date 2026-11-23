/**
 * Motion tab HTML for the mocap pitch/swing detail screen.
 *
 * Byte-for-byte port of the Motion tab in the approved mockups
 * (docs/mocap-redesign-v2.html — pitching, docs/mocap-redesign-hitting-v1.html
 * — hitting). Everything frame-rate-sensitive lives inside the WebView:
 * the C3D is fetched + parsed here (never shipped over the bridge), the
 * <video> is the master clock so 3D ↔ video sync is exact, and the
 * scrubber / transport / "At this frame" readouts update from the same rAF
 * loop. The RN side only receives:
 *   {type:'height', h}     → size the WebView inside the RN ScrollView
 *   {type:'lock'|'unlock'} → disable RN scroll while orbiting / scrubbing
 *   {type:'needC3D'}       → WebView fetch failed (CORS) — RN fetches and
 *                            injects window.__loadC3D64(base64) once
 *   {type:'ready'} / {type:'error', message}
 * RN → WebView: window.__setActive(bool), window.__jumpTo(eventKey).
 */

export type MotionMode = 'pitching' | 'hitting';

export interface MotionStageConfig {
  mode: MotionMode;
  accent: string;
  c3dUrl: string | null;
  videoUrl: string | null;
  eventTimes: Record<string, number> | null;
  curves: Record<string, (number | null)[]> | null;
  handedness: string | null;
  scalarMetrics: Record<string, number> | null;
  batSpeed: number | null;
}

export const MESH_BASE_URL = 'https://aspboostapp.vercel.app/';

export function buildMotionStageHtml(cfg: MotionStageConfig): string {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return HTML.replace('__CFG__', json);
}

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="color-scheme" content="dark">
<style>
:root{
  --bg:#000;--card:#0c1016;--rule:rgba(255,255,255,.07);--hair:rgba(255,255,255,.12);
  --text:#fff;--day:#d7e0ea;--sub:#9ca3af;--mute:#6b7280;--past:#4b5563;
  --acc:#a78bfa;
  color-scheme:dark;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
html,body{background:#000;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",system-ui,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
.body{padding:0 16px}
.section{padding:18px 0}
.hairline{height:1px;background:var(--hair);margin-bottom:18px}
.ebrow{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px}
.eyebrow{color:#e5e7eb;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase}
.enote{color:var(--mute);font-size:11px;font-weight:600}
.kpirow{display:flex;gap:12px}
.kpi{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0}
.klabel{color:var(--mute);font-size:10px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase}
.kval{font-weight:800;letter-spacing:-.5px;font-variant-numeric:tabular-nums;font-size:24px;line-height:1.05}
.kunit{font-size:11px;font-weight:700;color:var(--mute);letter-spacing:0}
.knote{color:var(--mute);font-size:10.5px;font-weight:600}
.chips{display:flex;gap:8px;overflow-x:auto;padding:2px 0;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--rule);color:var(--sub);font:700 12.5px/1.2 inherit;cursor:pointer;font-family:inherit;white-space:nowrap}
.chip.on{background:#1b2430;border-color:#2a3442;color:#fff}
.note{color:var(--mute);font-size:11px;line-height:1.45}
.stage{position:relative;width:100%;height:430px;margin-top:14px;background:#000;overflow:hidden;touch-action:none}
.stage canvas{display:block}
.vmodes{display:flex;gap:6px;margin-top:14px;padding:0 16px}.vmodes .chip{padding:7px 13px}
.stage.split{height:auto}.stage.split .pip{top:0;left:0;right:0;width:100%;height:auto;aspect-ratio:16/9;border-radius:0;border:0;border-bottom:1px solid var(--hair)}
.stage.vonly{height:560px}.stage.vonly .pip{top:0;left:0;right:0;bottom:0;width:100%;height:100%;border-radius:0;border:0}.stage.vonly .pip video,.stage.split .pip video{object-fit:contain}
.stage.vonly canvas,.stage.vonly .camchips,.stage.split .phase{visibility:hidden}
.pip{position:absolute;top:10px;right:10px;width:132px;height:74px;border-radius:10px;overflow:hidden;border:1px solid var(--hair);background:#000;cursor:pointer;transition:width .2s,height .2s;z-index:3}
.pip.big{width:266px;height:150px}
.pip video{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.camchips{position:absolute;left:10px;bottom:10px;display:flex;gap:6px;z-index:3}
.camchips .chip{padding:6px 11px;font-size:11.5px;background:rgba(12,16,22,.82);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.camchips .chip.on{background:rgba(27,36,48,.95)}
.phase{position:absolute;left:12px;top:12px;z-index:3;font-size:10px;font-weight:800;letter-spacing:1.6px;color:var(--acc);pointer-events:none}
.phase .fr{display:block;color:var(--mute);font-weight:700;letter-spacing:.5px;margin-top:3px;font-size:10.5px}
.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--mute);font-size:12px;z-index:2;text-align:center;padding:0 24px}
.scrub{position:relative;height:50px;margin-top:14px;cursor:pointer;touch-action:none}
.scrub .track{position:absolute;left:0;right:0;top:20px;height:4px;border-radius:2px;background:#1b2430}
.scrub .fill{position:absolute;left:0;top:20px;height:4px;border-radius:2px;background:var(--acc)}
.scrub .knob{position:absolute;top:13px;width:18px;height:18px;margin-left:-9px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.6)}
.scrub .tick{position:absolute;top:14px;width:2px;height:16px;margin-left:-1px;background:var(--sub);border-radius:1px}
.scrub .tl{position:absolute;top:0;font-size:9px;font-weight:800;letter-spacing:.8px;color:var(--sub);transform:translateX(-50%);white-space:nowrap}
.transport{display:flex;align-items:center;justify-content:space-between;margin-top:10px}
.tbtns{display:flex;gap:8px;align-items:center}
.tb{width:40px;height:40px;border-radius:999px;border:1px solid var(--rule);background:var(--card);color:#fff;font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit}
.tb.play{width:48px;height:48px;background:var(--acc);border-color:var(--acc);color:#0b0614;font-size:16px}
.speeds{display:flex;background:var(--card);border-radius:999px;padding:3px}
.speeds button{padding:7px 11px;border-radius:999px;border:0;background:none;color:var(--sub);font:700 12px/1 inherit;cursor:pointer;font-family:inherit}
.speeds button.on{background:#1b2430;color:#fff}
.readout{display:flex;justify-content:space-between;margin-top:12px;color:var(--mute);font-size:11px;font-weight:700;letter-spacing:.4px}
.readout b{color:var(--day);font-weight:800}
.afgrid{display:grid;grid-template-columns:1fr 1fr;column-gap:18px;margin-top:4px}
.afr{display:flex;align-items:baseline;gap:6px;padding:8px 0;border-top:1px solid rgba(255,255,255,.07)}
.afr span{flex:1;color:#9ca3af;font-size:12px;font-weight:600}.afr b{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}.afr small{color:#6b7280;font-size:10px;font-weight:700;width:24px}
.hidden{display:none!important}
</style>
</head>
<body>
<div id="root">
  <div class="vmodes" id="vmodes"><button class="chip on" data-m="">3D</button><button class="chip" data-m="split">Split</button><button class="chip" data-m="vonly">Video</button></div>
  <div class="stage" id="stage">
    <div class="loading" id="loading">Loading body…</div>
    <div class="phase" id="phase"> <span class="fr" id="phasefr"></span></div>
    <div class="pip" id="pip"><video id="vid" muted playsinline webkit-playsinline preload="auto"></video></div>
    <div class="camchips" id="cams"></div>
  </div>
  <div class="body">
    <div class="scrub" id="scrub"><div class="track"></div><div class="fill" id="fill"></div><div id="ticks"></div><div class="knob" id="knob"></div></div>
    <div class="transport">
      <div class="tbtns">
        <button class="tb" id="stepb" aria-label="Step back">‹</button>
        <button class="tb play" id="playb" aria-label="Play">❚❚</button>
        <button class="tb" id="stepf" aria-label="Step forward">›</button>
      </div>
      <div class="speeds" id="speeds">
        <button data-s="1">1×</button><button data-s="0.25" class="on">¼×</button><button data-s="0.1">⅒×</button>
      </div>
    </div>
    <div class="readout"><span>FRAME <b id="rf">0</b> / <span id="rfn"></span></span><span>TIME <b id="rt">0.000 s</b></span><span id="rrel"></span></div>
    <div class="section" style="padding-bottom:0" id="jumpsec">
      <div class="ebrow"><span class="eyebrow">Jump to</span><span class="enote" id="evnote">event_times · 360 Hz</span></div>
      <div class="chips" id="evchips"></div>
    </div>
    <div class="section">
      <div class="hairline"></div>
      <div class="ebrow"><span class="eyebrow">At this frame</span><span class="enote" id="atf"></span></div>
      <div id="atgrid"></div>
    </div>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js"></script>
<script>
'use strict';
var CFG = __CFG__;
function $(id){return document.getElementById(id)}
function post(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o))}catch(e){}}
function fmt(v,d){if(v==null||!isFinite(v))return '—';return v.toFixed(d==null?1:d)}
function loc(v){return Math.round(v).toLocaleString('en-US')}
var HIT = CFG.mode==='hitting';
var ACC = CFG.accent || (HIT?'#fb923c':'#a78bfa');
var ACCI = parseInt(ACC.slice(1),16);
document.documentElement.style.setProperty('--acc',ACC);
var SM = CFG.scalarMetrics || {};

// ── height → RN (WebView sits inside the RN ScrollView) ──
var lastH=0;
function reportHeight(){var h=Math.ceil($('root').getBoundingClientRect().height)+2;if(Math.abs(h-lastH)>1){lastH=h;post({type:'height',h:h})}}
if(window.ResizeObserver)new ResizeObserver(reportHeight).observe($('root'));
window.addEventListener('load',reportHeight);
// ── scroll lock while a finger is on the stage / scrubber ──
function lock(){post({type:'lock'})}
function unlock(){post({type:'unlock'})}
$('stage').addEventListener('pointerdown',lock);
$('scrub').addEventListener('pointerdown',lock);
window.addEventListener('pointerup',unlock);
window.addEventListener('pointercancel',unlock);

// ── static markup that differs between pitching and hitting ──
var CAM_LABELS = HIT ? [['side','Side'],['front','Pitcher'],['top','Top'],['catcher','Catcher']]
                     : [['side','Side'],['front','Front'],['top','Top'],['catcher','Catcher']];
$('cams').innerHTML = CAM_LABELS.map(function(c,i){return '<button class="chip'+(i===0?' on':'')+'" data-c="'+c[0]+'">'+c[1]+'</button>'}).join('');
function kpi(label,id,note,noteId){return '<div class="kpi"><div class="klabel">'+label+'</div><div class="kval" id="'+id+'">—</div><div class="knote"'+(noteId?' id="'+noteId+'"':'')+'>'+(note||'')+'</div></div>'}
function row(cells,first){return '<div class="kpirow"'+(first?'':' style="margin-top:14px"')+'>'+cells.join('')+'</div>'}
function afr(label,id,unit){return '<div class="afr"><span>'+label+'</span><b id="'+id+'">—</b><small>'+unit+'</small></div>'}
function afgrid(cells){return '<div class="afgrid" id="afgrid" style="margin-top:16px">'+cells.join('')+'</div>'}
if(!HIT){
  $('atgrid').innerHTML =
    row([kpi('Shoulder ER','aER','layback 185°','aERn'),kpi('Lead knee flex','aKN','','aKNn'),kpi('Hip-shldr sep','aHS','','aHSn')],true)+
    afgrid([afr('Pelvis rot','xPV','°/s'),afr('Trunk rot','xTV','°/s'),afr('Shoulder IR','xSV','°/s'),afr('Trunk fwd tilt','xFT','°'),afr('Trunk side tilt','xLT','°'),afr('Shoulder abd','xAB','°'),afr('Elbow flex','xEF','°'),afr('Horiz abd','xHA','°'),afr('Body speed','xCG','m/s')])+
    '<p class="note" style="margin-top:14px">Knee flexion is computed live from the C3D joint centres (hip–knee–ankle). Shoulder ER and separation come from the extractor\'s joint-angle curves for this pitch, sampled at the playhead; outside the analysed window they show —.</p>';
} else {
  $('atgrid').innerHTML =
    row([kpi('Bat speed','aER','','aERn'),kpi('Lead knee flex','aKN','','aKNn'),kpi('Hip-shldr sep','aHS','','aHSn')],true)+
    afgrid([afr('Pelvis rot','xPV','°/s'),afr('Trunk rot','xTV','°/s'),afr('Lead arm |ω|','xLA','°/s'),afr('Rear hand','xHS','m/s'),afr('Trunk fwd tilt','xFT','°'),afr('Trunk side bend','xLT','°'),afr('Rear elbow','xEF','°'),afr('Body speed','xCG','m/s'),afr('Stride','xST','m')])+
    '<p class="note" style="margin-top:14px">All three are computed live from the C3D with the app\'s extractHittingBiomechanics port: bat speed is the stored swing value (the bat itself isn\'t tracked), separation = torso yaw − pelvis yaw, lead knee = thigh→shank flexion.</p>';
}
if(!CFG.videoUrl){$('vmodes').classList.add('hidden');$('pip').classList.add('hidden')}
reportHeight();

// ════════════════ C3D parser (port of lib/mocap/c3dParser.ts) ════════════════
function parseParameters(view, paramBlockStart){
  var firstFrame=view.getInt16(6,true), lastFrame=view.getInt16(8,true), headerFrameRate=view.getFloat32(20,true);
  var offset=paramBlockStart+4, groups={}, rotationGroupId=0, rotationRate=0, dataStart=0, used=0, labels=[];
  while(offset<view.byteLength-2){
    var nameLen=Math.abs(view.getInt8(offset)), groupId=view.getInt8(offset+1);
    if(nameLen===0)break;
    var nameBytes=new Uint8Array(view.buffer,view.byteOffset+offset+2,nameLen);
    var name=String.fromCharCode.apply(null,nameBytes).trim().toUpperCase();
    if(groupId<0){
      var absId=Math.abs(groupId); groups[absId]=name;
      var nextOffset=view.getInt16(offset+2+nameLen,true);
      var descLen=view.getUint8(offset+2+nameLen+2);
      if(name==='ROTATION')rotationGroupId=absId;
      offset+=2+nameLen+2+1+descLen;
      if(nextOffset===0)break;
    } else {
      var nextOffset2=view.getInt16(offset+2+nameLen,true);
      var dataType=view.getInt8(offset+2+nameLen+2), numDims=view.getUint8(offset+2+nameLen+3);
      var dataOffset=offset+2+nameLen+2+1+1, dims=[];
      for(var d=0;d<numDims;d++)dims.push(view.getUint8(dataOffset+d));
      dataOffset+=numDims;
      if(groupId===rotationGroupId){
        if(name==='DATA_START'){ if(dataType===2)dataStart=view.getInt16(dataOffset,true); else if(dataType===1)dataStart=view.getInt8(dataOffset); }
        else if(name==='USED'){ if(dataType===2)used=view.getInt16(dataOffset,true); else if(dataType===1)used=view.getInt8(dataOffset); }
        else if(name==='RATE'){ if(dataType===4)rotationRate=view.getFloat32(dataOffset,true); else if(dataType===2)rotationRate=view.getInt16(dataOffset,true); }
        else if(name==='LABELS'){ if(dataType===-1&&dims.length===2){var charLen=dims[0],count=dims[1];
          for(var i=0;i<count;i++){var lb=new Uint8Array(view.buffer,view.byteOffset+dataOffset+i*charLen,charLen);labels.push(String.fromCharCode.apply(null,lb).trim())}}}
      }
      if(nextOffset2===0)break;
      offset+=2+nameLen+Math.abs(nextOffset2);
    }
  }
  var frameRate=rotationRate>0?rotationRate:(headerFrameRate>0?headerFrameRate:360);
  return {dataStart:dataStart,used:used,labels:labels,firstFrame:firstFrame,lastFrame:lastFrame,frameRate:frameRate};
}
function parseC3D(buffer){
  var view=new DataView(buffer);
  var paramBlockStart=(view.getUint8(0)-1)*512;
  var params=parseParameters(view,paramBlockStart);
  if(params.dataStart===0)throw new Error('ROTATION:DATA_START not found');
  if(params.used===0)throw new Error('ROTATION:USED not found');
  var frameCount=params.lastFrame-params.firstFrame+1, segmentCount=params.used;
  var floatsPerRot=17, floatsPerFrame=segmentCount*floatsPerRot, dataByteOffset=(params.dataStart-1)*512;
  var positions=new Float32Array(frameCount*segmentCount*3), rotations=new Float32Array(frameCount*segmentCount*9);
  for(var frame=0;frame<frameCount;frame++)for(var seg=0;seg<segmentCount;seg++){
    var b=dataByteOffset+(frame*floatsPerFrame+seg*floatsPerRot)*4;
    var pi=(frame*segmentCount+seg)*3, ri=(frame*segmentCount+seg)*9;
    positions[pi]=view.getFloat32(b+48,true);positions[pi+1]=view.getFloat32(b+52,true);positions[pi+2]=view.getFloat32(b+56,true);
    rotations[ri]=view.getFloat32(b,true);rotations[ri+1]=view.getFloat32(b+4,true);rotations[ri+2]=view.getFloat32(b+8,true);
    rotations[ri+3]=view.getFloat32(b+16,true);rotations[ri+4]=view.getFloat32(b+20,true);rotations[ri+5]=view.getFloat32(b+24,true);
    rotations[ri+6]=view.getFloat32(b+32,true);rotations[ri+7]=view.getFloat32(b+36,true);rotations[ri+8]=view.getFloat32(b+40,true);
  }
  return {frameCount:frameCount,frameRate:params.frameRate,segmentCount:segmentCount,positions:positions,rotations:rotations};
}
function b64ToBuf(s){var bin=atob(s.replace(/\s+/g,'')),n=bin.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=bin.charCodeAt(i);return u.buffer}

// ════════════════ RN bridge ════════════════
var STARTED=false, ACTIVE=true, API={};
window.__setActive=function(a){ACTIVE=!!a;if(API.setActive)API.setActive(ACTIVE)};
window.__jumpTo=function(k){if(API.jumpTo)API.jumpTo(k);else API.pendingJump=k};
function start(buf){
  if(STARTED)return;
  try{var c3d=parseC3D(buf);STARTED=true;init(c3d)}
  catch(e){$('loading').textContent='Could not read motion data';post({type:'error',message:String(e&&e.message||e)})}
}
window.__loadC3D64=function(s){start(b64ToBuf(s))};
if(!CFG.c3dUrl){$('loading').textContent='No motion data for this capture'}
else if(typeof THREE==='undefined'){$('loading').textContent='Could not load the 3D engine';post({type:'error',message:'three.js failed to load'})}
else{
  fetch(CFG.c3dUrl).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer()})
    .then(start)
    .catch(function(e){post({type:'needC3D',message:String(e&&e.message||e)})});
}

// ════════════════ Motion (everything that needs the C3D) ════════════════
function init(C3D){
var FC=C3D.frameCount, FR=C3D.frameRate, NS=C3D.segmentCount, DT=1/FR;
$('evnote').textContent='event_times · '+Math.round(FR)+' Hz';
var SEGI={worldbody:0,head:1,torso:2,l_uarm:3,l_larm:4,l_hand:5,r_uarm:6,r_larm:7,r_hand:8,pelvis:9,l_thigh:10,l_shank:11,l_foot:12,l_toes:13,r_thigh:14,r_shank:15,r_foot:16,r_toes:17};
var RH = CFG.handedness!=='L';
var LEAD = RH?'l':'r', THROW = HIT ? LEAD : (RH?'r':'l');
var ETIN = CFG.eventTimes || {};
var EVK = HIT ? ['load','fp','fm','peakRot'] : ['pkh','fp','mer','br'];
function clampF(f){return Math.max(0,Math.min(FC-1,f))}

// ── geometry helpers (C3D z-up) ──
function P(f,s){var i=(f*NS+s)*3;return [C3D.positions[i],C3D.positions[i+1],C3D.positions[i+2]]}
function M(f,s){var i=(f*NS+s)*9;return C3D.rotations.subarray(i,i+9)}
function add(a,b,k){k=k==null?1:k;return [a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k]}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
function lerp(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]}
function len(a){return Math.hypot(a[0],a[1],a[2])}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function smooth(a,w){w=w==null?3:w;return a.map(function(_,i){var s=0,n=0;for(var k=-w;k<=w;k++){var j=i+k;if(j>=0&&j<a.length){s+=a[j];n++}}return s/n})}
function omega(s){var out=[];for(var f=0;f<FC;f++){var f0=Math.max(0,f-1),f1=Math.min(FC-1,f+1),a=M(f0,s),b=M(f1,s),h=(f1-f0)*DT;
  var A=function(i,j){return b[i]*a[j]+b[3+i]*a[3+j]+b[6+i]*a[6+j]};
  out.push([(A(2,1)-A(1,2))/(2*h),(A(0,2)-A(2,0))/(2*h),(A(1,0)-A(0,1))/(2*h)])}return out}

// lead knee flexion from C3D joint centres (pitching readout)
var KNEE=new Array(FC);
for(var fk=0;fk<FC;fk++){var hp=P(fk,SEGI[LEAD+'_thigh']),kn=P(fk,SEGI[LEAD+'_shank']),an=P(fk,SEGI[LEAD+'_foot']);
  var ka=sub(hp,kn),kb=sub(an,kn);KNEE[fk]=180-Math.acos(Math.max(-1,Math.min(1,dot(ka,kb)/(len(ka)*len(kb)))))*180/Math.PI}

// whole-body COM (de Leva fractions)
var DL=[['head',null,0,.0694],['torso','pelvis',.45,.3229],['pelvis',null,0,.1117]];
['l','r'].forEach(function(s){DL.push([s+'_uarm',s+'_larm',.577,.0271],[s+'_larm',s+'_hand',.457,.0162],[s+'_hand',null,0,.0061],[s+'_thigh',s+'_shank',.4095,.1416],[s+'_shank',s+'_foot',.4459,.0433],[s+'_foot',null,0,.0137])});
var COM=new Float32Array(FC*3);
for(var f2=0;f2<FC;f2++){var c=[0,0,0],mt=0;DL.forEach(function(d){var a=P(f2,SEGI[d[0]]);var q=d[1]?lerp(a,P(f2,SEGI[d[1]]),d[2]):a;c=add(c,q,d[3]);mt+=d[3]});
  COM[f2*3]=c[0]/mt;COM[f2*3+1]=c[1]/mt;COM[f2*3+2]=c[2]/mt;}

// ── hitting biomechanics (port of lib/mocap/biomechanics.ts extractHittingBiomechanics) ──
var HB=null;
if(HIT){HB=(function(){
  var n=FC,fr=FR,SMOOTH_HALF=1,RAD2DEG=180/Math.PI,side=RH?'R':'L';
  var LEAD_HAND=SEGI[side==='L'?'r_hand':'l_hand'],REAR_HAND=SEGI[side==='L'?'l_hand':'r_hand'],LEAD_FOOT=SEGI[side==='L'?'r_foot':'l_foot'],REAR_FOOT=SEGI[side==='L'?'l_foot':'r_foot'],
      LEAD_SHANK=SEGI[side==='L'?'r_shank':'l_shank'],LEAD_THIGH=SEGI[side==='L'?'r_thigh':'l_thigh'],REAR_UARM=SEGI[side==='L'?'l_uarm':'r_uarm'],REAR_LARM=SEGI[side==='L'?'l_larm':'r_larm'],
      LEAD_UARM=SEGI[side==='L'?'r_uarm':'l_uarm'],PELVIS=SEGI.pelvis,TORSO=SEGI.torso,SIGN=side==='R'?1:-1;
  function getR(f,s){var i=(f*NS+s)*9,r=C3D.rotations;return [r[i],r[i+3],r[i+6],r[i+1],r[i+4],r[i+7],r[i+2],r[i+5],r[i+8]]}
  function getPos(f,s){return P(f,s)}
  function mtA(a,b){var o=new Array(9);for(var row=0;row<3;row++)for(var col=0;col<3;col++)o[row*3+col]=a[row]*b[col]+a[3+row]*b[3+col]+a[6+row]*b[6+col];return o}
  function cardanXYZ(R){var y=Math.asin(Math.max(-1,Math.min(1,R[2]))),x=Math.atan2(-R[5],R[8]),z=Math.atan2(-R[1],R[0]);return [x*RAD2DEG,y*RAD2DEG,z*RAD2DEG]}
  function unwrap(a){var r=a.slice();for(var i=1;i<r.length;i++){var d=r[i]-r[i-1];while(d>180){d-=360;r[i]-=360}while(d<-180){d+=360;r[i]+=360}}return r}
  var BAT=0.71,MPH=2.23694,sweet=[];
  for(var f=0;f<n;f++){var L=getPos(f,LEAD_HAND),Rh=getPos(f,REAR_HAND),bx=L[0]-Rh[0],by=L[1]-Rh[1],bz=L[2]-Rh[2],bl=Math.sqrt(bx*bx+by*by+bz*bz);
    sweet.push(bl>.01?[L[0]+bx/bl*BAT,L[1]+by/bl*BAT,L[2]+bz/bl*BAT]:L)}
  var batSpeed=new Array(n).fill(0);for(f=1;f<n;f++){var a=sweet[f-1],b=sweet[f];batSpeed[f]=Math.hypot((b[0]-a[0])*fr,(b[1]-a[1])*fr,(b[2]-a[2])*fr)*MPH}
  function yaw(s){var o=[];for(var f=0;f<n;f++){var R=getR(f,s);o.push(Math.atan2(R[3],R[0])*RAD2DEG*SIGN)}return unwrap(o)}
  var pelvisRotation=yaw(PELVIS);
  var halfN=Math.floor(n/3),maxAnkleZ=0,strideTop=halfN;
  for(f=halfN;f<n-50;f++){var z=getPos(f,LEAD_FOOT)[2];if(z>maxAnkleZ){maxAnkleZ=z;strideTop=f}}
  var fpFrame=Math.min(n-50,strideTop+100);
  for(f=strideTop;f<n-1;f++){var az=getPos(f,LEAD_FOOT)[2],azn=getPos(f+1,LEAD_FOOT)[2];if(az<.10&&Math.abs((azn-az)*fr)<.25){fpFrame=f;break}}
  var minP=Infinity,loadFrame=Math.max(0,fpFrame-100);for(f=Math.max(0,fpFrame-400);f<fpFrame;f++)if(pelvisRotation[f]<minP){minP=pelvisRotation[f];loadFrame=f}
  var maxBS=Math.max.apply(null,batSpeed),fmFrame=Math.min(n-1,fpFrame+50);for(f=fpFrame;f<n;f++)if(batSpeed[f]>maxBS*.1){fmFrame=f;break}
  var torsoRotation=yaw(TORSO),hipShoulderSep=torsoRotation.map(function(v,i){return v-pelvisRotation[i]});
  var tf=[],tl=[];for(f=0;f<n;f++){var c=cardanXYZ(mtA(getR(f,PELVIS),getR(f,TORSO)));tf.push(c[0]*SIGN);tl.push(c[1]*SIGN)}
  var torsoForwardTilt=unwrap(tf),torsoLateralTilt=unwrap(tl);
  function flex(a,b){var o=[];for(var f=0;f<n;f++)o.push(Math.abs(cardanXYZ(mtA(getR(f,a),getR(f,b)))[0]));return unwrap(o)}
  var leadKneeFlex=flex(LEAD_THIGH,LEAD_SHANK),rearElbowFlex=flex(REAR_UARM,REAR_LARM);
  var handSpeed=new Array(n).fill(0);for(f=1;f<n;f++){var h0=getPos(f-1,REAR_HAND),h1=getPos(f,REAR_HAND);handSpeed[f]=Math.hypot((h1[0]-h0[0])*fr,(h1[1]-h0[1])*fr,(h1[2]-h0[2])*fr)}
  function velo(a){var o=new Array(n).fill(0);for(var f=0;f<n;f++){var lo=Math.max(0,f-SMOOTH_HALF),hi=Math.min(n-1,f+SMOOTH_HALF);if(hi>lo)o[f]=(a[hi]-a[lo])/(hi-lo)*fr}return o}
  var pelvisRotVelo=velo(pelvisRotation),torsoRotVelo=velo(torsoRotation);
  var maxPV=0,peakRotFrame=fmFrame+20;for(f=fmFrame;f<Math.min(n,fmFrame+200);f++)if(Math.abs(pelvisRotVelo[f])>maxPV){maxPV=Math.abs(pelvisRotVelo[f]);peakRotFrame=f}
  var cogVelocity=new Array(n).fill(0);for(f=1;f<n;f++){var p0=getPos(f-1,PELVIS),p1=getPos(f,PELVIS);cogVelocity[f]=Math.hypot((p1[0]-p0[0])*fr,(p1[1]-p0[1])*fr,(p1[2]-p0[2])*fr)}
  var lf=getPos(fpFrame,LEAD_FOOT),rf=getPos(fpFrame,REAR_FOOT);
  return {events:{load:loadFrame,fp:fpFrame,fm:fmFrame,peakRot:Math.min(n-1,peakRotFrame)},hipShoulderSep:hipShoulderSep,
    torsoForwardTilt:torsoForwardTilt,torsoLateralTilt:torsoLateralTilt,leadKneeFlex:leadKneeFlex,rearElbowFlex:rearElbowFlex,handSpeed:handSpeed,
    pelvisRotVelo:pelvisRotVelo,torsoRotVelo:torsoRotVelo,cogVelocity:cogVelocity,strideLengthM:Math.hypot(lf[0]-rf[0],lf[1]-rf[1])};
})();}

// ── events: stored event_times (seconds) → frames; hitting falls back to the kinematic events ──
var EV=null, ET=null;
(function(){var ok=EVK.every(function(k){return typeof ETIN[k]==='number'&&isFinite(ETIN[k])});
  if(ok){EV={};ET={};EVK.forEach(function(k){EV[k]=clampF(Math.round(ETIN[k]*FR));ET[k]=ETIN[k]})}
  else if(HB){EV={};ET={};EVK.forEach(function(k){EV[k]=HB.events[k];ET[k]=HB.events[k]/FR})}})();

// ── curves (extractor normalized_curves, 301-pt two-phase grid: PKH@50, FP@150, BR@250) ──
var CURVES=CFG.curves||{};
function idxOfT(t){return t<ET.fp?50+(t-ET.pkh)/(ET.fp-ET.pkh)*100:150+(t-ET.fp)/(ET.br-ET.fp)*100}
function curveAt(key,t){if(!ET||HIT)return null;var a=CURVES[key];if(!a||!a.length)return null;var x=idxOfT(t);if(!isFinite(x)||x<0||x>a.length-1)return null;var i=Math.floor(x),j=Math.min(i+1,a.length-1);
  if(a[i]==null||a[j]==null)return null;return a[i]+(a[j]-a[i])*(x-i)}

// hitting live series
var LIVE=null;
if(HIT){
  var W1=EV?Math.min(FC-1,EV.peakRot+60):FC-1, WL=EV?EV.load:0;
  var LEADW=smooth(omega(SEGI[LEAD+'_uarm']).map(function(v){return len(v)*180/Math.PI}),2);
  var sgn=function(a){var m=0,s=1;for(var f=WL;f<=W1;f++)if(Math.abs(a[f])>m){m=Math.abs(a[f]);s=a[f]<0?-1:1}return a.map(function(v){return v*s})};
  var PVo=sgn(HB.pelvisRotVelo),TVo=sgn(HB.torsoRotVelo);
  var ST=HB.leadKneeFlex.map(function(){return HB.strideLengthM});
  LIVE=[['xPV',PVo,0],['xTV',TVo,0],['xLA',LEADW,0],['xHS',HB.handSpeed,1],['xFT',HB.torsoForwardTilt,0],['xLT',HB.torsoLateralTilt,0],['xEF',HB.rearElbowFlex,0],['xCG',HB.cogVelocity,2],['xST',ST,2]];
}

// ════════════════ Three.js stage ════════════════
var RENDERABLE=['head','torso','pelvis','l_uarm','l_larm','l_hand','r_uarm','r_larm','r_hand','l_thigh','l_shank','l_foot','r_thigh','r_shank','r_foot'];
var BONES=[['head','torso'],['torso','pelvis'],['torso','l_uarm'],['l_uarm','l_larm'],['l_larm','l_hand'],['torso','r_uarm'],['r_uarm','r_larm'],['r_larm','r_hand'],['pelvis','l_thigh'],['l_thigh','l_shank'],['l_shank','l_foot'],['pelvis','r_thigh'],['r_thigh','r_shank'],['r_shank','r_foot']];
var MESH_MAP={head:{file:'head.obj'},torso:{file:'thorax.obj'},pelvis:{file:'pelvis.obj'},
  r_uarm:{file:'right-arm.obj'},r_larm:{file:'right-forearm.obj'},r_hand:{file:'right-hand.obj'},
  r_thigh:{file:'right-thigh.obj'},r_shank:{file:'right-leg.obj'},r_foot:{file:'right-foot.obj'},
  l_uarm:{file:'right-arm.obj',mirror:true},l_larm:{file:'right-forearm.obj',mirror:true},l_hand:{file:'right-hand.obj',mirror:true},
  l_thigh:{file:'right-thigh.obj',mirror:true},l_shank:{file:'right-leg.obj',mirror:true},l_foot:{file:'right-foot.obj',mirror:true}};
var MESH_SIZE={head:.23,torso:.48,pelvis:.30,r_uarm:.30,r_larm:.27,r_hand:.10,r_thigh:.42,r_shank:.44,r_foot:.26,l_uarm:.30,l_larm:.27,l_hand:.10,l_thigh:.42,l_shank:.44,l_foot:.26};
var PI=Math.PI;
var PRE_ROT={head:[0,PI,0],torso:[0,PI,0],pelvis:[0,PI,0],r_uarm:[0,0,0],r_larm:[0,0,0],r_hand:[0,PI,0],r_thigh:[0,PI,0],r_shank:[0,0,0],r_foot:[0,PI,0],l_uarm:[0,0,0],l_larm:[0,0,0],l_hand:[0,PI,0],l_thigh:[0,PI,0],l_shank:[0,0,0],l_foot:[0,PI,0]};
var MESH_OFFSET={head:[0,.08,-.07]};
var ARM={}; [THROW+'_uarm',THROW+'_larm',THROW+'_hand'].forEach(function(k){ARM[k]=1});

var stage=$('stage');
var scene=new THREE.Scene(); scene.background=new THREE.Color('#000000');
scene.fog=new THREE.Fog(0x000000,7,16);
var camera=new THREE.PerspectiveCamera(42,1,.01,100);
var renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputEncoding=THREE.sRGBEncoding;
stage.insertBefore(renderer.domElement,stage.firstChild);
var controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=.08; controls.minDistance=.5; controls.maxDistance=15; controls.enablePan=false;

scene.add(new THREE.AmbientLight(0xffffff,.45));
scene.add(new THREE.HemisphereLight(0xb0d0ff,0x1a1a1a,.4));
var d1=new THREE.DirectionalLight(0xffffff,.55); d1.position.set(5,8,5); scene.add(d1);
var d2=new THREE.DirectionalLight(0xffffff,.25); d2.position.set(-3,6,-2); scene.add(d2);
var key=new THREE.DirectionalLight(0xd0d8ff,.5); key.position.set(0,8,0); key.castShadow=true;
key.shadow.mapSize.set(2048,2048); key.shadow.bias=-.0005; key.shadow.radius=4;
var sc=key.shadow.camera; sc.left=-3;sc.right=3;sc.top=3;sc.bottom=-3;sc.near=.5;sc.far=20;
scene.add(key); scene.add(key.target);
var ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x000000,roughness:1,metalness:0}));
ground.rotation.x=-PI/2; ground.position.y=-.005; ground.receiveShadow=true; scene.add(ground);
var grid=new THREE.GridHelper(20,40,0x3a4250,0x1e232b); grid.position.y=.001; scene.add(grid);

var meshMat=new THREE.MeshStandardMaterial({color:0xd8d8d8,roughness:.55,metalness:.1,emissive:new THREE.Color(0x9bddff),emissiveIntensity:.04,side:THREE.DoubleSide});
var meshMatMirror=new THREE.MeshStandardMaterial({color:0xd8d8d8,roughness:.55,metalness:.1,emissive:new THREE.Color(0x9bddff),emissiveIntensity:.04,side:THREE.FrontSide});
var armMat=new THREE.MeshStandardMaterial({color:ACCI,roughness:.5,metalness:.1,emissive:new THREE.Color(ACCI),emissiveIntensity:.35,side:THREE.DoubleSide});
var armMatMirror=armMat.clone(); armMatMirror.side=THREE.FrontSide;
var jointMat=new THREE.MeshStandardMaterial({color:0x9bddff,emissive:new THREE.Color(0x9bddff),emissiveIntensity:.4,roughness:.3,metalness:.2});
var boneMat=new THREE.MeshStandardMaterial({color:0x556677,roughness:.7,metalness:.05});
var jointGeo=new THREE.SphereGeometry(.012,10,6), boneGeo=new THREE.CylinderGeometry(.005,.005,2,6);
var joints={},segGroups={},boneObjs={};
RENDERABLE.forEach(function(n){var j=new THREE.Mesh(jointGeo,jointMat);scene.add(j);joints[n]=j;var g=new THREE.Group();scene.add(g);segGroups[n]=g});
BONES.forEach(function(p){var b=new THREE.Mesh(boneGeo,boneMat);scene.add(b);boneObjs[p[0]+'-'+p[1]]=b});

// meshes from the web app's public/meshes (same OBJ files the web viewer uses)
(function(){var loader=new THREE.OBJLoader(),files={},pending=0;
  RENDERABLE.forEach(function(n){files[MESH_MAP[n].file]=1});
  function place(file,geo,bb){RENDERABLE.forEach(function(n){var info=MESH_MAP[n];if(info.file!==file)return;
    var maxDim=Math.max(bb.x,bb.y,bb.z),sf=maxDim>0?MESH_SIZE[n]/maxDim:1,sx=info.mirror?-sf:sf,pr=PRE_ROT[n],off=MESH_OFFSET[n];
    var pre=new THREE.Group();pre.rotation.set(pr[0],pr[1],pr[2]);if(off)pre.position.set(off[0],off[1],off[2]);
    var mat=ARM[n]?(info.mirror?armMatMirror:armMat):(info.mirror?meshMatMirror:meshMat);
    var mesh=new THREE.Mesh(geo,mat);mesh.scale.set(sx,sf,sf);mesh.castShadow=true;pre.add(mesh);segGroups[n].add(pre)})}
  function done(){if(--pending<=0)$('loading').style.display='none'}
  Object.keys(files).forEach(function(file){pending++;
    loader.load('https://aspboostapp.vercel.app/meshes/'+file,function(obj){var got=false;obj.traverse(function(ch){if(ch.isMesh&&!got){got=true;var g=ch.geometry.clone();g.computeVertexNormals();g.computeBoundingBox();var s=new THREE.Vector3();g.boundingBox.getSize(s);place(file,g,s)}});done()},undefined,done)});
})();

// precompute per-frame transforms (C3D → three: x, z, -y)
var NR=RENDERABLE.length, TP=new Float32Array(FC*NR*3), TQ=new Float32Array(FC*NR*4);
(function(){var m=new THREE.Matrix4(),q=new THREE.Quaternion(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),r=C3D.rotations,ps=C3D.positions;
  for(var f=0;f<FC;f++)for(var i=0;i<NR;i++){var s=SEGI[RENDERABLE[i]],pi=(f*NS+s)*3,ri=(f*NS+s)*9,o=(f*NR+i);
    TP[o*3]=ps[pi];TP[o*3+1]=ps[pi+2];TP[o*3+2]=-ps[pi+1];
    m.makeBasis(a.set(r[ri],r[ri+2],-r[ri+1]),b.set(r[ri+6],r[ri+8],-r[ri+7]),c.set(-r[ri+3],-r[ri+5],r[ri+4]));
    q.setFromRotationMatrix(m);TQ[o*4]=q.x;TQ[o*4+1]=q.y;TQ[o*4+2]=q.z;TQ[o*4+3]=q.w}})();

// COM dot + trail
var comDot=new THREE.Mesh(new THREE.SphereGeometry(.035,20,14),new THREE.MeshBasicMaterial({color:ACCI}));scene.add(comDot);
var comShadow=new THREE.Mesh(new THREE.RingGeometry(.03,.05,32),new THREE.MeshBasicMaterial({color:ACCI,transparent:true,opacity:.6,side:THREE.DoubleSide}));comShadow.rotation.x=-PI/2;scene.add(comShadow);
var TRAIL=new Float32Array(FC*3);for(var f3=0;f3<FC;f3++){TRAIL[f3*3]=COM[f3*3];TRAIL[f3*3+1]=COM[f3*3+2];TRAIL[f3*3+2]=-COM[f3*3+1]}
var trailGeo=new THREE.BufferGeometry();trailGeo.setAttribute('position',new THREE.BufferAttribute(TRAIL,3));
var trail=new THREE.Line(trailGeo,new THREE.LineBasicMaterial({color:ACCI,transparent:true,opacity:.75}));scene.add(trail);
var gTrail=new THREE.BufferGeometry();var GT=new Float32Array(FC*3);for(var f4=0;f4<FC;f4++){GT[f4*3]=TRAIL[f4*3];GT[f4*3+1]=.004;GT[f4*3+2]=TRAIL[f4*3+2]}
gTrail.setAttribute('position',new THREE.BufferAttribute(GT,3));var gtl=new THREE.Line(gTrail,new THREE.LineBasicMaterial({color:ACCI,transparent:true,opacity:.25}));scene.add(gtl);

var tmpV=new THREE.Vector3(),pelvisTarget=new THREE.Vector3(),UPV=new THREE.Vector3(0,1,0);
var PELVIS_I=RENDERABLE.indexOf('pelvis');
function applyFrame(f){f=clampF(Math.round(f));
  for(var i=0;i<NR;i++){var o=f*NR+i,n=RENDERABLE[i];joints[n].position.set(TP[o*3],TP[o*3+1],TP[o*3+2]);segGroups[n].position.copy(joints[n].position);segGroups[n].quaternion.set(TQ[o*4],TQ[o*4+1],TQ[o*4+2],TQ[o*4+3])}
  for(var b=0;b<BONES.length;b++){var bo=boneObjs[BONES[b][0]+'-'+BONES[b][1]],pj=joints[BONES[b][0]].position,cj=joints[BONES[b][1]].position;
    bo.position.lerpVectors(pj,cj,.5);tmpV.subVectors(cj,pj);var l=tmpV.length();if(l<.001)continue;bo.scale.set(1,l/2,1);bo.quaternion.setFromUnitVectors(UPV,tmpV.normalize())}
  comDot.position.set(TRAIL[f*3],TRAIL[f*3+1],TRAIL[f*3+2]);comShadow.position.set(TRAIL[f*3],.006,TRAIL[f*3+2]);
  trailGeo.setDrawRange(0,f+1);gTrail.setDrawRange(0,f+1);
  var pi=f*NR+PELVIS_I;pelvisTarget.set(TP[pi*3],1,TP[pi*3+2]);
}

// camera presets
var pA,pB;
if(HIT){var fpF=EV?EV.fp:Math.round(FC/2);pA=P(fpF,SEGI[RH?'r_foot':'l_foot']);pB=P(fpF,SEGI[RH?'l_foot':'r_foot'])} // rear → lead foot at FP = toward pitcher
else{pA=P(EV?EV.pkh:0,SEGI.pelvis);pB=P(EV?EV.br:FC-1,SEGI.pelvis)} // pelvis travel PKH→BR = toward home
var dir=new THREE.Vector3(pB[0]-pA[0],0,-(pB[1]-pA[1]));if(dir.lengthSq()<1e-8)dir.set(1,0,0);dir.normalize();
var chest=new THREE.Vector3().crossVectors(dir,UPV).multiplyScalar(RH?1:-1);
var CAMS=HIT?{side:function(){return chest.clone().multiplyScalar(3.4).setY(.35)},
  front:function(){return dir.clone().multiplyScalar(3.6).setY(.3)},
  top:function(){return dir.clone().multiplyScalar(.01).setY(4.2)},
  catcher:function(){return dir.clone().multiplyScalar(-3.4).setY(.45)}}
 :{side:function(){return chest.clone().multiplyScalar(3.4).setY(.35)},
  front:function(){return dir.clone().multiplyScalar(2.4).add(chest.clone().multiplyScalar(2.0)).setY(.45)},
  top:function(){return dir.clone().multiplyScalar(.01).setY(4.2)},
  catcher:function(){return dir.clone().multiplyScalar(3.6).setY(.25)}};
var camOff=CAMS.side(), tweenTo=null;
function setCam(k){tweenTo={off:CAMS[k](),t:0,from:camera.position.clone().sub(controls.target)};
  [].forEach.call($('cams').children,function(b){b.classList.toggle('on',b.dataset.c===k)})}
$('cams').addEventListener('click',function(e){var b=e.target.closest('button');if(b)setCam(b.dataset.c)});

// ════════════════ Playback (video = master clock) ════════════════
var vid=$('vid'); var VREADY=false;
var frame=0,PLAYING=true,SPEED=.25,last=performance.now();
if(CFG.videoUrl){
  // WKWebView doesn't buffer frames until play() is called, so loadeddata may never fire on its own:
  // treat metadata as ready and let play()/seek pull the data.
  var onReady=function(){if(VREADY)return;VREADY=true;vid.playbackRate=SPEED;if(PLAYING&&ACTIVE)vid.play().catch(function(){});else seekVideo()};
  vid.addEventListener('loadedmetadata',onReady);vid.addEventListener('loadeddata',onReady);
  vid.src=CFG.videoUrl;
}
$('pip').addEventListener('click',function(){if(!stage.classList.contains('split')&&!stage.classList.contains('vonly'))$('pip').classList.toggle('big')});
$('pip').addEventListener('transitionend',resize); // pip animates width/height; re-measure once it settles (split height = 2 × pip)
$('vmodes').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;[].forEach.call(this.children,function(c){c.classList.toggle('on',c===b)});stage.classList.remove('split','vonly');$('pip').classList.remove('big');if(b.dataset.m)stage.classList.add(b.dataset.m);requestAnimationFrame(resize)});
function setPlaying(p){PLAYING=p;$('playb').textContent=p?'❚❚':'▶';if(VREADY){if(p&&ACTIVE){vid.playbackRate=SPEED;vid.play().catch(function(){})}else{vid.pause();if(!p)seekVideo()}}}
function seekVideo(){if(VREADY&&isFinite(vid.duration))vid.currentTime=Math.max(0,Math.min(vid.duration-1e-3,(Math.round(frame)+.5)/FR))}
$('playb').onclick=function(){setPlaying(!PLAYING)};
$('stepb').onclick=function(){setPlaying(false);frame=Math.max(0,Math.round(frame)-1);seekVideo()};
$('stepf').onclick=function(){setPlaying(false);frame=Math.min(FC-1,Math.round(frame)+1);seekVideo()};
$('speeds').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;SPEED=+b.dataset.s;vid.playbackRate=SPEED;[].forEach.call($('speeds').children,function(x){x.classList.toggle('on',x===b)})});

// scrubber + event ticks + jump chips
$('rfn').textContent=FC-1;
var EVL=HIT?[['LOAD','load'],['FP','fp'],['FM','fm'],['PEAK ROT','peakRot']]:[['PKH','pkh'],['FP','fp'],['MER','mer'],['BR','br']];
var EVNAME=HIT?{load:'Load',fp:'Foot plant',fm:'First move',peakRot:'Peak rotation'}:{pkh:'Peak knee',fp:'Foot plant',mer:'Max ER',br:'Release'};
if(EV){
  $('ticks').innerHTML=EVL.map(function(e){var x=EV[e[1]]/(FC-1)*100;var tr=HIT
      ?(e[0]==='FP'?'transform:translateX(calc(-100% - 2px))':e[0]==='FM'?'transform:translateX(2px)':e[0]==='PEAK ROT'?'transform:translateX(-50%);top:33px':'')
      :(e[0]==='FP'?'transform:translateX(calc(-100% - 2px))':e[0]==='MER'?'transform:translateX(2px)':e[0]==='BR'?'transform:translateX(2px);top:33px':'');
    return '<div class="tick" style="left:'+x+'%"></div><div class="tl" style="left:'+x+'%;'+tr+'">'+e[0]+'</div>'}).join('');
  $('evchips').innerHTML=EVL.map(function(e){return '<button class="chip" data-e="'+e[1]+'">'+EVNAME[e[1]]+' · '+ET[e[1]].toFixed(3)+'s</button>'}).join('');
  $('evchips').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;jumpTo(b.dataset.e)});
} else { $('jumpsec').classList.add('hidden') }
function jumpTo(k){if(!EV)return;var kk=null;EVK.forEach(function(x){if(x.toLowerCase()===String(k).toLowerCase())kk=x});
  if(!kk){var alias={release:'br',ball_release:'br',footplant:'fp',foot_plant:'fp',max_er:'mer',peak_knee:'pkh',peak_rot:'peakRot',peakrot:'peakRot',first_move:'fm'};kk=alias[String(k).toLowerCase()]||null}
  if(kk==null||EV[kk]==null)return;setPlaying(false);frame=EV[kk];seekVideo()}
(function(){var el=$('scrub'),drag=false;function at(e){var r=el.getBoundingClientRect();frame=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*(FC-1);seekVideo()}
  el.addEventListener('pointerdown',function(e){drag=true;try{el.setPointerCapture(e.pointerId)}catch(_){}setPlaying(false);at(e)});
  el.addEventListener('pointermove',function(e){if(drag)at(e)});
  el.addEventListener('pointerup',function(){drag=false});el.addEventListener('pointercancel',function(){drag=false})})();
function phaseOf(f){if(!EV)return '';return HIT
  ?(f<EV.load?'SET-UP':f<EV.fp?'STRIDE':f<EV.fm?'LANDING':f<EV.peakRot?'ROTATION':'SWING / FINISH')
  :(f<EV.pkh?'WINDUP':f<EV.fp?'STRIDE':f<EV.mer?'ARM COCKING':f<EV.br?'ACCELERATION':'FOLLOW-THROUGH')}
function deg(v){return v==null||!isFinite(v)?'—':v.toFixed(0)+'<span class="kunit"> °</span>'}
var lastUI=-1;
function updateUI(){var f=Math.round(frame);if(f===lastUI)return;lastUI=f;var t=f/FR;
  var pct=FC>1?f/(FC-1)*100:0;$('fill').style.width=pct+'%';$('knob').style.left=pct+'%';
  $('rf').textContent=f;$('rt').textContent=t.toFixed(3)+' s';
  var refT=ET?(HIT?ET.peakRot:ET.br):null;
  if(refT!=null){var ms=Math.round((t-refT)*1000);$('rrel').innerHTML=(HIT?'PEAK':'BR')+' <b>'+(ms>0?'+':ms<0?'−':'')+Math.abs(ms)+' ms</b>'}else $('rrel').innerHTML='';
  var ph=phaseOf(f);$('phase').firstChild.nodeValue=ph;$('phasefr').textContent='f '+f+' · '+t.toFixed(3)+'s';
  $('atf').textContent=ph.toLowerCase();
  if(!HIT){
    var er=curveAt('shoulderER',t),hs=curveAt('hipShoulderSep',t),kn=KNEE[f];
    $('aER').innerHTML=deg(er);$('aER').style.color=er==null?'#4b5563':ACC;
    $('aKN').innerHTML=deg(kn);
    $('aKNn').textContent=EV?'FP '+KNEE[EV.fp].toFixed(0)+'° · BR '+KNEE[EV.br].toFixed(0)+'°':'';
    $('aHS').innerHTML=deg(hs);$('aHS').style.color=hs==null?'#4b5563':'#fff';
    $('aHSn').textContent='at FP '+fmt(SM.hipShoulderSep,1)+'°';
    [['xPV','pelvisRotVelo',0],['xTV','trunkRotVelo',0],['xSV','shoulderRotVelo',0],['xFT','trunkForwardTilt',0],['xLT','trunkLateralTilt',0],['xAB','shoulderAbduction',0],['xEF','elbowFlex',0],['xHA','shoulderHorizAbd',0],['xCG','cogVelocity',2]].forEach(function(q){var v=curveAt(q[1],t),el=$(q[0]);el.textContent=v==null?'—':(q[2]?v.toFixed(q[2]):loc(v));el.style.color=v==null?'#4b5563':'#fff'});
    $('aERn').textContent='layback '+fmt(SM.layback,0)+'°';
  } else {
    var hs2=HB.hipShoulderSep[f],kn2=HB.leadKneeFlex[f];
    $('aER').innerHTML=fmt(CFG.batSpeed,1)+(CFG.batSpeed!=null?'<span class="kunit"> mph</span>':'');$('aER').style.color=CFG.batSpeed!=null?ACC:'#4b5563';
    $('aERn').textContent='peak · this swing';
    $('aKN').innerHTML=deg(kn2);
    $('aKNn').textContent=EV?'FP '+HB.leadKneeFlex[EV.fp].toFixed(0)+'° · peak '+HB.leadKneeFlex[EV.peakRot].toFixed(0)+'°':'';
    $('aHS').innerHTML=deg(hs2);$('aHS').style.color='#fff';
    $('aHSn').textContent='at FP '+(EV?fmt(HB.hipShoulderSep[EV.fp],1):'—')+'°';
    LIVE.forEach(function(q){var v=q[1][f],el=$(q[0]);el.textContent=v==null||!isFinite(v)?'—':(q[2]?v.toFixed(q[2]):loc(v));el.style.color='#fff'});
  }
}
function resize(){var sp=stage.classList.contains('split'),off=sp?$('pip').offsetHeight:0;stage.style.height=sp?(off*2)+'px':'';renderer.domElement.style.marginTop=off+'px';var w=stage.clientWidth,h=stage.clientHeight-off;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);reportHeight()}
window.addEventListener('resize',resize);

API.setActive=function(a){if(!VREADY)return;if(a&&PLAYING){vid.playbackRate=SPEED;vid.play().catch(function(){})}else vid.pause();if(a)requestAnimationFrame(resize)};
API.jumpTo=jumpTo;
if(API.pendingJump){jumpTo(API.pendingJump);API.pendingJump=null}

// init camera — start at frame 0
applyFrame(0);
controls.target.copy(pelvisTarget);
camera.position.copy(pelvisTarget).add(camOff);
resize();
updateUI();
post({type:'ready',frameCount:FC,frameRate:FR});
var prevT=new THREE.Vector3().copy(controls.target);
function tick(now){requestAnimationFrame(tick);var dt=Math.min(.1,(now-last)/1000);last=now;
  if(!ACTIVE)return;
  if(PLAYING){
    if(VREADY&&!vid.paused){frame=vid.currentTime*FR; if(vid.ended||frame>=FC-1){vid.currentTime=0;frame=0;vid.play().catch(function(){})}}
    else if(!VREADY||!CFG.videoUrl){frame+=dt*FR*SPEED;if(frame>FC-1)frame=0}
  }
  applyFrame(frame);
  prevT.copy(controls.target);controls.target.lerp(pelvisTarget,.1);camera.position.add(tmpV.subVectors(controls.target,prevT));
  key.position.set(controls.target.x,8,controls.target.z);key.target.position.set(controls.target.x,0,controls.target.z);
  if(tweenTo){tweenTo.t=Math.min(1,tweenTo.t+dt*2.2);var e=1-Math.pow(1-tweenTo.t,3);camera.position.copy(controls.target).add(tweenTo.from.clone().lerp(tweenTo.off,e));if(tweenTo.t>=1)tweenTo=null}
  controls.update();
  renderer.render(scene,camera);
  updateUI();
}
requestAnimationFrame(tick);
}
</script>
</body>
</html>`;
