const $ = id => document.getElementById(id);
let currentTune = null;
let deferredPrompt = null;

const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
const round = (n,d=2)=>Number(n).toFixed(d);
const val = id => $(id).value;
const num = id => Number($(id).value || 0);

function buildProfile(){
  return {
    maker: val('maker') || 'Custom', model: val('model') || 'Car', year: val('year') || '',
    carClass: val('carClass'), build: val('build'), drive: val('drive'), hp: num('hp'), tq: num('tq'),
    weight: num('weight'), front: num('frontWeight'), compound: val('compound'), gears: Number(val('gears')), gearMode: val('gearMode'), firstStyle: val('firstStyle'), spacing: val('spacing'), fdBias: val('fdBias'), suspMode: val('suspMode'), launchStyle: val('launchStyle'), wheelieMode: val('wheelieMode'), hopControl: val('hopControl'), dragSurface: val('dragSurface'), dragDistance: val('dragDistance')
  };
}

function tuneCar(p){
  const powerWeight = p.hp / Math.max(1800,p.weight);
  const rear = 100 - p.front;
  const gripBase = {Drag:1.25,'Semi-Slick':1.12,Race:1.1,Sport:.98,Street:.9,Rally:.96,'Off-road':.9,Drift:.82}[p.compound] || 1;
  const mode = p.build;
  const topMode = mode === 'top';
  const dragMode = mode === 'drag';
  const rallyMode = mode === 'rally' || mode === 'offroad';
  const driftMode = mode === 'drift';
  const circuitMode = mode === 'circuit' || mode === 'street';

  const gearPlan = gearboxAI(p, powerWeight, {topMode, dragMode, rallyMode, driftMode, circuitMode});
  const baseSpeed = 145 + p.hp*0.075 - p.weight*0.006 + (topMode?40:0) + (dragMode?10:0) + (p.carClass==='X'?28:p.carClass==='R'?22:p.carClass==='S2'?16:p.carClass==='S1'?9:0);
  const topSpeed = clamp((baseSpeed + gearPlan.speedBonus) * (gearPlan.modeTop?1.12:1) * (rallyMode?.86:1) * (driftMode?.82:1), 115, 330);
  const finalDrive = gearPlan.finalDrive;
  const gears = gearPlan.gears;

  const launch = clamp(72 + gripBase*16 + (p.drive==='AWD'?9:p.drive==='RWD'?2:-2) + (dragMode?7:0) - powerWeight*8, 45, 100);
  const grip = clamp(64 + gripBase*18 + (circuitMode?8:0) + (rallyMode?5:0) - (topMode?5:0), 40, 100);
  const stability = clamp(70 + (p.drive==='AWD'?7:0) + (topMode?4:0) + (p.weight>3400?4:0) - (driftMode?12:0), 35, 100);
  const braking = clamp(72 + gripBase*12 - powerWeight*6 + (circuitMode?7:0), 45, 100);
  const accel = clamp(68 + powerWeight*45 + gripBase*8 + (dragMode?8:0), 45, 100);
  const score = clamp((launch+grip+stability+braking+accel)/5, 40, 100);

  const tire = tirePressure(p, gripBase, topMode, dragMode, rallyMode, driftMode);
  const align = alignment(p, circuitMode, rallyMode, driftMode, dragMode, topMode);
  const arb = antiRoll(p, circuitMode, rallyMode, driftMode, dragMode, topMode);
  const springs = springTune(p, circuitMode, rallyMode, dragMode, topMode);
  const damping = dampingTune(p, circuitMode, rallyMode, dragMode, topMode);
  const aero = aeroTune(p, topMode, dragMode, circuitMode, rallyMode, driftMode);
  const brakes = brakeTune(p, braking, circuitMode, rallyMode, dragMode);
  const diff = differential(p, dragMode, circuitMode, rallyMode, driftMode, topMode);
  const perf = {
    topSpeed: Math.round(topSpeed),
    zero60: clamp(5.8 - powerWeight*3.3 - gripBase*.5 - (p.drive==='AWD'?.35:0), 1.8, 9.9),
    quarter: clamp(14.2 - powerWeight*6.2 - gripBase*.8 - (dragMode?.45:0), 7.2, 18.5),
    launch, grip, stability, braking, accel, score
  };

  return {profile:p, finalDrive, gears, gearPlan, tire, align, arb, springs, damping, aero, brakes, diff, perf, advisor: makeAdvisor(p, perf)};
}


function gearboxAI(p, powerWeight, flags){
  const {topMode, dragMode, rallyMode, driftMode, circuitMode} = flags;
  const m = p.gearMode || 'topspeed';
  const modeTop = m === 'topspeed' || p.fdBias === 'max' || topMode;
  const modeDrag = m === 'draglaunch' || dragMode;
  const modeRoll = m === 'roll';
  const modeShort = m === 'short';

  let fdBase = modeTop ? 2.18 : modeDrag ? 3.30 : modeRoll ? 2.82 : modeShort ? 3.75 : circuitMode ? 3.35 : rallyMode ? 3.65 : driftMode ? 3.90 : 3.20;
  if(p.fdBias === 'short') fdBase += .34;
  if(p.fdBias === 'long') fdBase -= .28;
  if(p.fdBias === 'max') fdBase -= .55;
  fdBase += (p.gears - 6) * .055 - powerWeight * .42;

  let firstBase = modeTop ? 2.12 : modeDrag ? 2.92 : modeRoll ? 2.55 : modeShort ? 3.25 : rallyMode ? 3.25 : driftMode ? 3.45 : 2.90;
  if(p.firstStyle === 'safe') firstBase -= .22;
  if(p.firstStyle === 'aggressive') firstBase += .25;
  if(p.drive === 'FWD') firstBase -= .12;
  if(p.drive === 'AWD' && modeDrag) firstBase += .10;
  firstBase -= powerWeight * .24;

  let lastBase = modeTop ? .46 : modeDrag ? .68 : modeRoll ? .62 : modeShort ? .82 : circuitMode ? .78 : rallyMode ? .86 : driftMode ? .92 : .74;
  if(p.spacing === 'wide') lastBase -= .06;
  if(p.spacing === 'close') lastBase += .05;
  if(p.fdBias === 'max') lastBase -= .04;

  const finalDrive = clamp(fdBase, 1.85, 4.85);
  const first = clamp(firstBase, 1.70, 4.40);
  const last = clamp(lastBase, .42, 1.08);
  const gears=[];
  const curve = p.spacing === 'close' ? 1.02 : p.spacing === 'wide' ? 1.62 : modeTop ? 1.70 : modeDrag ? 1.36 : circuitMode ? 1.14 : 1.25;
  for(let i=0;i<p.gears;i++){
    const t = p.gears===1?1:i/(p.gears-1);
    let ratio = first * Math.pow(last/first, Math.pow(t, curve));
    if(modeRoll && i < 2) ratio *= .94;
    if(modeDrag && i === 1) ratio *= 1.03;
    if(modeTop && i > p.gears-3) ratio *= .96;
    gears.push(clamp(ratio, .42, 4.60));
  }
  const recovery=[];
  for(let i=1;i<gears.length;i++) recovery.push(clamp(100*(gears[i]/gears[i-1]),45,92));
  const redline = p.hp > 1000 ? 8200 : p.hp > 700 ? 7800 : p.hp > 450 ? 7400 : 7000;
  const shift = modeTop ? redline - 150 : modeDrag ? redline - 50 : redline - 100;
  const speedBonus = (modeTop?28:0) + (p.fdBias==='max'?18:0) + (p.fdBias==='long'?8:0) - (modeShort?18:0) - (modeDrag?4:0);
  return {finalDrive, gears, first, last, recovery, shift, modeTop, speedBonus, style: gearModeLabel(m)};
}
function gearModeLabel(m){return {auto:'Auto Balanced',topspeed:'Highest Top Speed',draglaunch:'Drag Launch',roll:'Roll Racing',short:'Short Acceleration',custom:'Custom Manual Bias'}[m]||'Auto Balanced'}
function gearSpeedRows(t){
  const shift = t.gearPlan?.shift || 7600;
  return t.gears.map((g,i)=>{
    const speed = (shift/(g*t.finalDrive))*0.0305*26.5;
    const rec = i===0 ? 'Launch Gear' : Math.round(t.gearPlan.recovery[i-1])+'% RPM recovery';
    return [`${i+1}${suffix(i+1)} Gear Speed`, `${Math.round(speed)} mph · ${rec}`];
  });
}

function tirePressure(p, grip, top, drag, rally, drift){
  let f=28, r=28;
  if(drag){f=31; r=p.drive==='FWD'?24:20.5;}
  if(top){f=30.5; r=31;}
  if(rally){f=25; r=25;}
  if(drift){f=32; r=33;}
  if(p.compound==='Drag'){r-=1.5; f-=.5}
  if(p.compound==='Street'){f+=1; r+=1}
  f += (p.front-50)*.05; r += (50-p.front)*.04;
  return {front:clamp(f,18,36), rear:clamp(r,18,36)};
}
function effectiveSuspMode(p, circuit, rally, drift, drag, top){
  if(p.suspMode && p.suspMode !== 'auto') return p.suspMode;
  if(drag) return 'drag';
  if(top) return 'top';
  if(drift) return 'drift';
  if(rally) return 'rally';
  return 'road';
}
function dragSuspensionModifiers(p){
  const hard = p.launchStyle === 'hard';
  const safe = p.launchStyle === 'safe';
  const wheelieAgg = p.wheelieMode === 'aggressive';
  const wheelieSmall = p.wheelieMode === 'small';
  const wheeliePrevent = p.wheelieMode === 'prevent';
  const hopMax = p.hopControl === 'max';
  const strip = p.dragSurface === 'strip';
  const dirt = p.dragSurface === 'dirt';
  const mile = p.dragDistance === 'mile';
  return {hard,safe,wheelieAgg,wheelieSmall,wheeliePrevent,hopMax,strip,dirt,mile};
}
function alignment(p,circuit,rally,drift,drag,top){
  const mode = effectiveSuspMode(p,circuit,rally,drift,drag,top);
  if(mode==='drag') return {camberF:-0.2, camberR:-0.1, toeF:0.0, toeR:0.0, caster:p.wheelieMode==='aggressive'?6.8:5.6};
  if(mode==='top') return {camberF:-0.4, camberR:-0.2, toeF:0.0, toeR:0.0, caster:6.0};
  if(mode==='drift') return {camberF:-4.2, camberR:-1.2, toeF:0.8, toeR:-0.2, caster:7.0};
  if(mode==='rally') return {camberF:-1.2, camberR:-0.8, toeF:0.1, toeR:0.0, caster:6.2};
  return {camberF:-1.8, camberR:-1.2, toeF:0.0, toeR:0.0, caster:6.5};
}
function antiRoll(p,circuit,rally,drift,drag,top){
  const mode = effectiveSuspMode(p,circuit,rally,drift,drag,top);
  let f=22,r=22;
  if(mode==='drag'){
    const m = dragSuspensionModifiers(p);
    f = p.drive==='FWD'?24:8;
    r = p.drive==='RWD'?30:p.drive==='AWD'?25:10;
    if(m.wheelieAgg){f-=3; r+=4}
    if(m.wheeliePrevent){f+=4; r-=3}
    if(m.hopMax){f+=2; r+=2}
    if(m.dirt){f-=2; r-=2}
  } else if(mode==='top'){f=18;r=20}
  else if(mode==='rally'){f=16;r=15}
  else if(mode==='drift'){f=28;r=18}
  else {f=24+(p.front-50)*.25;r=22+(50-p.front)*.18}
  return {front:clamp(f,1,65),rear:clamp(r,1,65)};
}
function springTune(p,circuit,rally,drag,top){
  const mode = effectiveSuspMode(p,circuit,rally,false,drag,top);
  const base = p.weight/5.8;
  let f=base*(p.front/50), r=base*((100-p.front)/50);
  let heightF=4.5, heightR=4.7;
  if(mode==='drag'){
    const m=dragSuspensionModifiers(p);
    if(p.drive==='RWD') { f*=.62; r*= m.wheelieAgg?1.18:1.04; heightF= m.wheelieAgg?6.8: m.wheelieSmall?6.2:5.4; heightR= m.wheelieAgg?4.6:4.0; }
    else if(p.drive==='AWD') { f*=.70; r*=.95; heightF= m.wheeliePrevent?5.2:5.8; heightR=4.1; }
    else { f*=1.12; r*=.62; heightF=3.9; heightR=6.3; }
    if(m.safe){ f*=1.05; r*=.94; }
    if(m.hard){ f*=.92; r*=1.08; }
    if(m.hopMax){ r*=1.06; }
    if(m.dirt){ f*=.78; r*=.78; heightF+=.7; heightR+=.7; }
    if(m.mile){ heightF-=.4; heightR-=.2; }
  } else if(mode==='top'){f*=.95; r*=.98; heightF=3.8; heightR=3.9}
  else if(mode==='rally'){f*=.62; r*=.62; heightF=6.2; heightR=6.4}
  else if(circuit){f*=1.08; r*=1.05; heightF=4.4; heightR=4.6}
  return {front:clamp(f,120,1200), rear:clamp(r,120,1200), heightF:clamp(heightF,3.0,7.5), heightR:clamp(heightR,3.0,7.5)};
}
function dampingTune(p,circuit,rally,drag,top){
  const mode = effectiveSuspMode(p,circuit,rally,false,drag,top);
  let rbF=8, rbR=8, bpF=4, bpR=4;
  if(mode==='drag'){
    const m=dragSuspensionModifiers(p);
    rbF=4.8; rbR=10.8; bpF=2.8; bpR=5.2;
    if(p.drive==='FWD'){rbF=8.5; rbR=4.8; bpF=4.8; bpR=2.8;}
    if(m.wheelieAgg){rbF-=.8; rbR+=.9; bpF-=.3; bpR+=.3;}
    if(m.wheeliePrevent){rbF+=1.2; rbR-=.8; bpF+=.4; bpR-=.4;}
    if(m.hopMax){rbR+=.7; bpR+=.6;}
    if(m.dirt){rbF-=.8; rbR-=.8; bpF-=.6; bpR-=.6;}
  }
  else if(mode==='rally'){rbF=6.0; rbR=5.8; bpF=2.8; bpR=2.7}
  else if(mode==='top'){rbF=8.2; rbR=8.8; bpF=4.1; bpR=4.4}
  else if(circuit){rbF=9.2; rbR=8.7; bpF=5.0; bpR=4.6}
  return {reboundF:clamp(rbF,1,20),reboundR:clamp(rbR,1,20),bumpF:clamp(bpF,1,13),bumpR:clamp(bpR,1,13)};
}
function dragSuspensionReport(t){
  const p=t.profile, s=t.springs, d=t.damping, a=t.arb;
  const rearBias = p.drive==='RWD' ? 8 : p.drive==='AWD' ? 4 : -4;
  const wheelie = p.wheelieMode==='aggressive' ? 'High / controlled wheelie' : p.wheelieMode==='small' ? 'Small front lift' : 'Low / prevented';
  const hop = p.hopControl==='max' ? 'Very low' : p.hopControl==='balanced' ? 'Low-medium' : 'Medium';
  const transfer = p.drive==='FWD' ? 'Forward bite / reduced rear squat' : (s.heightF>s.heightR && d.reboundR>d.reboundF ? 'Strong rearward transfer' : 'Balanced transfer');
  return [
    ['Suspension Mode', effectiveSuspMode(p,false,false,false,p.build==='drag',p.build==='top').toUpperCase()],
    ['Launch Style', labelChoice(p.launchStyle,{safe:'Safe / low spin',balanced:'Balanced',hard:'Hard launch'})],
    ['Wheelie Control', wheelie],
    ['Weight Transfer', transfer],
    ['Wheel Hop Risk', hop],
    ['Drag Surface', labelChoice(p.dragSurface,{street:'Street',strip:'Prepared strip',airport:'Airport / highway',dirt:'Dirt drag'})],
    ['Drag Distance', labelChoice(p.dragDistance,{quarter:'1/4 mile',half:'1/2 mile',mile:'Standing mile'})],
    ['Launch Notes', dragNote(p, rearBias)]
  ];
}
function labelChoice(v,map){return map[v]||v}
function dragNote(p,bias){
  if(p.drive==='FWD') return 'FWD drag setup keeps the front planted and rear soft for front tire bite.';
  if(p.wheelieMode==='aggressive') return 'Allows front lift for hard RWD/AWD drag launches; reduce wheelie setting if it climbs too much.';
  if(p.wheelieMode==='prevent') return 'Keeps launch flatter with more front control and less rear squat.';
  return 'Balanced drag suspension for grip without excessive wheel hop.';
}

function aeroTune(p,top,drag,circuit,rally,drift){
  if(top||drag) return {front:'Minimum', rear: top?'Low':'Minimum'};
  if(rally) return {front:'Medium', rear:'Medium'};
  if(drift) return {front:'Low', rear:'Low'};
  return {front:'Medium-High', rear:'High'};
}
function brakeTune(p,score,circuit,rally,drag){
  return {balance: circuit?48:drag?50:rally?47:49, pressure: clamp(95 + (score-70)*.4 + (circuit?8:0), 85, 130)};
}
function differential(p,drag,circuit,rally,drift,top){
  if(p.drive==='FWD') return {frontAccel: drag?55:circuit?38:rally?32:45, frontDecel: circuit?12:8};
  if(p.drive==='RWD') return {rearAccel: drift?85:drag?78:circuit?55:top?62:65, rearDecel: drift?65:circuit?22:14};
  return {frontAccel: drag?35:circuit?25:rally?22:30, frontDecel: 5, rearAccel: drift?82:drag?78:circuit?58:rally?50:65, rearDecel: drift?55:circuit?18:12, center: drag?72:top?68:rally?55:circuit?65:70};
}
function makeAdvisor(p,perf){
  if(p.build==='top') return 'Built for highest top speed: long final drive, low aero drag, stable tire pressures, and stretched upper gears.';
  if(p.build==='drag') return 'Built for launch: softer front, planted rear, low rear tire pressure, and strong differential lock.';
  if(p.build==='circuit') return 'Built for corner speed: balanced aero, stronger braking, tighter damping, and moderate diff lock.';
  if(p.build==='rally'||p.build==='offroad') return 'Built for uneven surfaces: softer springs, taller ride height, lower tire pressure, and controlled diff lock.';
  if(p.build==='drift') return 'Built for controllable slide: high rear diff lock, drift alignment, and higher tire pressures.';
  return 'Balanced setup: strong acceleration, stable handling, and easy-to-copy Forza tuning order.';
}

function renderTune(t){
  currentTune = t;
  $('overallScore').textContent = Math.round(t.perf.score);
  $('mTop').textContent = t.perf.topSpeed + ' mph';
  $('m060').textContent = round(t.perf.zero60,1) + 's';
  $('mQtr').textContent = round(t.perf.quarter,1) + 's';
  $('mLaunch').textContent = Math.round(t.perf.launch) + '/100';
  $('mGrip').textContent = Math.round(t.perf.grip) + '/100';
  $('mStability').textContent = Math.round(t.perf.stability) + '/100';
  $('advisor').textContent = t.advisor;
  document.querySelector('.score-ring').style.background = `conic-gradient(var(--green) ${Math.round(t.perf.score)}%, #26362c 0)`;

  const sections = [];
  sections.push(['Tire Pressure', [['Front', round(t.tire.front,1)+' PSI'], ['Rear', round(t.tire.rear,1)+' PSI']]]);
  const gearRows = [['Gear Tune Mode', t.gearPlan?.style || 'Auto'], ['Shift RPM', Math.round(t.gearPlan?.shift || 7600)+' RPM'], ['Final Drive', round(t.finalDrive,2)], ...t.gears.map((g,i)=>[`${i+1}${suffix(i+1)} Gear`, round(g,2)])];
  sections.push(['Gearing', gearRows]);
  sections.push(['Gear Speed / RPM Recovery', gearSpeedRows(t)]);
  sections.push(['Alignment', [['Front Camber', round(t.align.camberF,1)+'°'], ['Rear Camber', round(t.align.camberR,1)+'°'], ['Front Toe', round(t.align.toeF,1)+'°'], ['Rear Toe', round(t.align.toeR,1)+'°'], ['Caster', round(t.align.caster,1)+'°']]]);
  sections.push(['Anti-Roll Bars', [['Front', round(t.arb.front,1)], ['Rear', round(t.arb.rear,1)]]]);
  sections.push(['Springs', [['Front', round(t.springs.front,1)+' lb/in'], ['Rear', round(t.springs.rear,1)+' lb/in'], ['Front Ride Height', round(t.springs.heightF,1)+' in'], ['Rear Ride Height', round(t.springs.heightR,1)+' in']]]);
  sections.push(['Damping', [['Front Rebound', round(t.damping.reboundF,1)], ['Rear Rebound', round(t.damping.reboundR,1)], ['Front Bump', round(t.damping.bumpF,1)], ['Rear Bump', round(t.damping.bumpR,1)]]]);
  sections.push(['Drag Race Suspension', dragSuspensionReport(t)]);
  sections.push(['Aero', [['Front', t.aero.front], ['Rear', t.aero.rear]]]);
  sections.push(['Brakes', [['Balance', round(t.brakes.balance,0)+'% Front'], ['Pressure', round(t.brakes.pressure,0)+'%']]]);
  const d = t.diff;
  const diffRows = Object.keys(d).map(k=>[labelMap(k), round(d[k],0)+'%']);
  sections.push(['Differential', diffRows]);
  sections.push(['Tune Ratings', [['Launch', Math.round(t.perf.launch)+'/100'], ['Acceleration', Math.round(t.perf.accel)+'/100'], ['Top Speed', t.perf.topSpeed+' mph'], ['Cornering Grip', Math.round(t.perf.grip)+'/100'], ['Braking', Math.round(t.perf.braking)+'/100'], ['Stability', Math.round(t.perf.stability)+'/100']]]);

  const box = $('results'); box.innerHTML='';
  const tpl = $('sectionTemplate');
  sections.forEach(([name,rows])=>{
    const node = tpl.content.cloneNode(true);
    node.querySelector('.section-name').textContent = name;
    const rowBox = node.querySelector('.rows');
    rows.forEach(([a,b])=>{
      const div=document.createElement('div'); div.className='row';
      const label=document.createElement('span'), value=document.createElement('b');
      label.textContent=String(a); value.textContent=String(b);
      div.append(label,value); rowBox.appendChild(div);
    });
    node.querySelector('.copy-btn').addEventListener('click', e=>{e.preventDefault(); e.stopPropagation(); copyText(name+'\n'+rows.map(r=>`${r[0]}: ${r[1]}`).join('\n'));});
    box.appendChild(node);
  });
}
function labelMap(k){return {frontAccel:'Front Acceleration',frontDecel:'Front Deceleration',rearAccel:'Rear Acceleration',rearDecel:'Rear Deceleration',center:'Center Balance'}[k]||k}
function suffix(n){return n===1?'st':n===2?'nd':n===3?'rd':'th'}
function copyText(text){
  if(navigator.clipboard && location.protocol !== 'file:') navigator.clipboard.writeText(text);
  else { const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
}
function tuneTitle(t){const p=t.profile; return `${p.year? p.year+' ':''}${p.maker} ${p.model} - ${p.build.toUpperCase()}`}
function readSaves(){
  try {
    const parsed=JSON.parse(localStorage.getItem('fh6v19')||'[]');
    if(!Array.isArray(parsed)) throw new Error('Saved tunes must be a list');
    return parsed.filter(s=>s && typeof s.title==='string' && s.tune && typeof s.tune==='object' && Number.isFinite(s.id));
  } catch(e){ return null; }
}
function saveTune(){
  if(!currentTune) return;
  const saves=readSaves();
  if(!saves){alert('Saved tunes could not be read. Export or clear them before saving new tunes.');return;}
  saves.unshift({id:Date.now(), title:tuneTitle(currentTune), tune:currentTune});
  try {localStorage.setItem('fh6v19',JSON.stringify(saves.slice(0,30)));}
  catch(e){alert('Could not save tune. Browser storage may be full or blocked.');return;}
  renderGarage();
}
function renderGarage(){
  const saves=readSaves(), g=$('garage');g.replaceChildren();
  if(!saves){g.textContent='Saved tunes could not be read. Clear Saves only if you are willing to remove them.';return;}
  if(!saves.length){g.textContent='No saved tunes yet.';return;}
  saves.forEach(s=>{
    const div=document.createElement('div');div.className='saved';
    const info=document.createElement('div'),title=document.createElement('b'),time=document.createElement('small'),button=document.createElement('button');
    title.textContent=s.title;time.textContent=new Date(s.id).toLocaleString();button.textContent='Load';
    button.onclick=()=>{try{renderTune(s.tune)}catch(e){alert('This saved tune is damaged and cannot be loaded.')}};
    info.append(title,time);div.append(info,button);g.appendChild(div);
  });
}

function validateProfile(p){
  const checks=[['Horsepower',p.hp,50,3000],['Torque',p.tq,50,3000],['Weight',p.weight,1000,7000],['Front weight',p.front,30,70],['Gears',p.gears,4,10]];
  for(const [label,value,min,max] of checks){if(!Number.isFinite(value)||value<min||value>max)return `${label} must be between ${min} and ${max}.`;}
  if(p.year && (!/^\d{4}$/.test(p.year)||Number(p.year)<1900||Number(p.year)>2100)) return 'Year must be 1900 to 2100.';
  return '';
}
$('generate').addEventListener('click',()=>{
  const p=buildProfile(), error=validateProfile(p), status=$('formError');
  status.hidden=!error;status.textContent=error;
  if(!error)renderTune(tuneCar(p));
});
$('saveTune').addEventListener('click',saveTune);
$('clearGarage').addEventListener('click',()=>{localStorage.removeItem('fh6v19');renderGarage();});
window.addEventListener('beforeinstallprompt', e=>{e.preventDefault(); deferredPrompt=e; $('installBtn').hidden=false;});
$('installBtn').addEventListener('click', async()=>{ if(deferredPrompt){deferredPrompt.prompt(); deferredPrompt=null; $('installBtn').hidden=true;}});
if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(()=>{});
renderGarage();
renderTune(tuneCar(buildProfile()));
