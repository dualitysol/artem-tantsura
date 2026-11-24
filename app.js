const root = document.documentElement;
const themeButton = document.getElementById('appearance');
const preference = matchMedia('(prefers-color-scheme: light)');
const canvas = document.getElementById('sculpture');

function applyTheme(theme) {
  root.dataset.theme = theme;
  const next = theme === 'light' ? 'dark' : 'light';
  themeButton.setAttribute('aria-label', 'Switch to ' + next + ' theme');
  themeButton.title = 'Switch to ' + next + ' theme';
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f5f6f1' : '#101412';
  paintSculpture();
}

themeButton.addEventListener('click', () => {
  const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('appearance', theme); } catch {}
  applyTheme(theme);
});
preference.addEventListener('change', () => {
  try { if (localStorage.getItem('appearance')) return; } catch {}
  applyTheme(preference.matches ? 'light' : 'dark');
});

// Cross sections of a continuous trefoil tube, projected orthographically.
const tau = 2 * Math.PI;
function center(t) {
  const r = 1.54 + 0.63 * Math.cos(3*t);
  return [r*Math.cos(2*t), r*Math.sin(2*t), 0.96*Math.sin(3*t)];
}
function unit(v) { const length = Math.hypot(...v); return v.map(x => x/length); }
function cross(a,b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function rotate([x,y,z]) {
  const a = -.30, b = .32;
  const v = y*Math.cos(a)-z*Math.sin(a);
  return [x*Math.cos(b)-v*Math.sin(b), x*Math.sin(b)+v*Math.cos(b), y*Math.sin(a)+z*Math.cos(a)];
}
function makeMesh() {
  const rings = [], faces = [], slices = 176, sides = 34;
  for (let i=0; i<slices; i++) {
    const t = tau*i/slices, c = center(t), next = center(t+.0001);
    const tangent = unit(next.map((x,k)=>x-c[k]));
    const normal = unit(cross(tangent,[0,0,1])), binormal = cross(tangent,normal);
    const ring = [];
    for (let j=0; j<sides; j++) {
      const a = tau*j/sides;
      const n = normal.map((x,k)=>x*Math.cos(a)+binormal[k]*Math.sin(a));
      ring.push({p:rotate(c.map((x,k)=>x+.40*n[k])), n:rotate(n)});
    }
    rings.push(ring);
  }
  for(let i=0;i<slices;i++) for(let j=0;j<sides;j++) {
    const r=rings[i], s=rings[(i+1)%slices], k=(j+1)%sides;
    const v=[r[j],s[j],s[k],r[k]];
    if(v.reduce((sum,e)=>sum+e.n[2],0)<-.12) continue;
    faces.push({v,depth:v.reduce((sum,e)=>sum+e.p[2],0),light:Math.max(0,(-.42*v[0].n[0]-.70*v[0].n[1]+.56*v[0].n[2])),index:i});
  }
  const points=rings.flat().map(e=>e.p);
  const range=k=>[Math.min(...points.map(p=>p[k])),Math.max(...points.map(p=>p[k]))];
  return {slices,faces:faces.sort((a,b)=>a.depth-b.depth),x:range(0),y:range(1)};
}
const mesh=makeMesh();
function paintSculpture() {
  const ctx=canvas.getContext('2d');
  if(!ctx) return;
  const w=canvas.clientWidth,h=canvas.clientHeight;
  if(!w||!h) return;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr);
  const scale=Math.min(w*.90/(mesh.x[1]-mesh.x[0]),h*.90/(mesh.y[1]-mesh.y[0]));
  ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*(w/2-scale*(mesh.x[1]+mesh.x[0])/2),dpr*(h/2-scale*(mesh.y[1]+mesh.y[0])/2));
  const light=root.dataset.theme==='light';
  for(const f of mesh.faces) {
    const l=f.light, m=l*.52+Math.pow(l,6)*.48;
    const shade=light?[43+120*m,63+126*m,46+115*m]:[29+161*m,47+171*m,34+150*m];
    const color='rgb('+shade.map(Math.round).join(',')+')';
    ctx.beginPath(); ctx.moveTo(...f.v[0].p.slice(0,2));
    for(let i=1;i<4;i++) ctx.lineTo(...f.v[i].p.slice(0,2));
    ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=.75/scale;ctx.stroke();
    ctx.beginPath();ctx.moveTo(...f.v[0].p.slice(0,2));ctx.lineTo(...f.v[3].p.slice(0,2));
    ctx.strokeStyle=light?'rgba(213,237,199,.63)':'rgba(201,234,189,.62)';ctx.lineWidth=(.55+.5*l)/scale;ctx.stroke();
  }
}
// Cache the visible tube segment at each pixel. Only its light level changes per frame.
const flow = document.getElementById('tube-flow');
const flowContext = flow.getContext('2d');
const motionButton = document.getElementById('motion');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let paused = reducedMotion.matches;
let inView = false;
let frameId = 0;
let lastPaint = 0;
let travel = 0;
let segmentMap;
let coverage;
let frameImage;
const intensity = new Uint8Array(mesh.slices);

function buildFlowMap() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!flowContext || !w || !h) return;
  const ratio = Math.min(1, 420 / Math.max(w,h));
  flow.width = Math.max(1,Math.round(w*ratio));
  flow.height = Math.max(1,Math.round(h*ratio));
  const buffer = document.createElement('canvas');
  buffer.width = flow.width;
  buffer.height = flow.height;
  const ctx = buffer.getContext('2d');
  const scale = Math.min(w*.90/(mesh.x[1]-mesh.x[0]),h*.90/(mesh.y[1]-mesh.y[0]));
  const sx = flow.width/w, sy = flow.height/h;
  ctx.setTransform(scale*sx,0,0,scale*sy,sx*(w-scale*(mesh.x[0]+mesh.x[1]))/2,sy*(h-scale*(mesh.y[0]+mesh.y[1]))/2);
  for (const face of mesh.faces) {
    const vertices = face.v;
    ctx.beginPath();
    ctx.moveTo(vertices[0].p[0],vertices[0].p[1]);
    for(let i=1;i<4;i++) ctx.lineTo(vertices[i].p[0],vertices[i].p[1]);
    ctx.closePath();
    ctx.fillStyle = 'rgb('+face.index+',0,0)';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = .7/(scale*sx);
    ctx.fill();
    ctx.stroke();
  }
  const pixels = ctx.getImageData(0,0,flow.width,flow.height).data;
  segmentMap = new Uint8Array(flow.width*flow.height);
  coverage = new Uint8Array(segmentMap.length);
  frameImage = flowContext.createImageData(flow.width,flow.height);
  for (let i=0;i<segmentMap.length;i++) {
    const offset = i*4;
    segmentMap[i] = Math.min(mesh.slices-1,pixels[offset]);
    coverage[i] = pixels[offset+3];
    frameImage.data[offset] = 208;
    frameImage.data[offset+1] = 250;
    frameImage.data[offset+2] = 184;
  }
  renderFlow();
}

function renderFlow() {
  if (!frameImage) return;
  for(let i=0;i<mesh.slices;i++) {
    const band = (1+Math.cos(tau*(2*i/mesh.slices-travel)))/2;
    intensity[i] = Math.round(128*Math.pow(band,14) + 20*Math.pow(band,3));
  }
  for(let i=0;i<segmentMap.length;i++) {
    frameImage.data[i*4+3] = coverage[i]*intensity[segmentMap[i]]/255;
  }
  flowContext.putImageData(frameImage,0,0);
}

function animate(now) {
  if (now-lastPaint >= 1000/30) {
    if (lastPaint) travel = (travel+Math.min(now-lastPaint,120)/5400)%1;
    lastPaint = now;
    renderFlow();
  }
  frameId = requestAnimationFrame(animate);
}
function updateMotion() {
  cancelAnimationFrame(frameId);
  lastPaint = 0;
  motionButton.hidden = !flowContext;
  motionButton.dataset.paused = String(paused);
  const label = paused ? 'Play tube animation' : 'Pause tube animation';
  motionButton.setAttribute('aria-label',label);
  motionButton.title = label;
  if (inView && !paused && !document.hidden && flowContext) frameId = requestAnimationFrame(animate);
}
motionButton.addEventListener('click',()=>{ paused = !paused; updateMotion(); });
reducedMotion.addEventListener('change',()=>{ paused = reducedMotion.matches; updateMotion(); });
document.addEventListener('visibilitychange',updateMotion);
new IntersectionObserver(([entry])=>{ inView = entry.isIntersecting; updateMotion(); }).observe(canvas);
new ResizeObserver(()=>{ paintSculpture(); buildFlowMap(); }).observe(canvas);
const mast = document.querySelector('.mast');
new ResizeObserver(()=>root.style.setProperty('--mast-height',mast.offsetHeight+'px')).observe(mast);
updateMotion();
applyTheme(root.dataset.theme || (preference.matches?'light':'dark'));
