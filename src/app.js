(function(){
"use strict";
const SERVER = "educore new", TOOL = "cypherQuery";
const CTDL_SRCS = ["CTDL","CTDLASN","CTDLQData"];
const SRC_LABEL = {CEDS:"CEDS", CTDL:"CTDL", CTDLASN:"CTDL-ASN", CTDLQData:"CTDL-QData"};

// `short` is only for the map's sticky column headers, where a cell can be
// ~75px wide when zoomed out. A chosen abbreviation reads better than an
// ellipsis cutting "Credentials & competencies" down to "Credenti…".
const STAGES = [
  {id:"el",  label:"Early learning",             short:"Early"},
  {id:"k12", label:"K–12",                       short:"K–12"},
  {id:"ps",  label:"Postsecondary",              short:"Postsec."},
  {id:"ad",  label:"Adult ed & CTE",             short:"Adult & CTE"},
  {id:"cr",  label:"Credentials & competencies", short:"Credentials"},
  {id:"wf",  label:"Workforce & career",         short:"Workforce"},
  {id:"all", label:"Across the continuum",       short:"Across all"}
];
const TOPICS = [
  "Learners & people","Organizations & places","Programs & learning","Assessment",
  "Credentials & awards","Competencies & frameworks","Staff, jobs & employment",
  "Finance & aid","Facilities & operations","Data, records & outcomes"
];
const stageIdx = Object.fromEntries(STAGES.map((s,i)=>[s.id,i]));
const stageLabel = Object.fromEntries(STAGES.map(s=>[s.id,s.label]));

/* ---------- classification rules (one place to edit) ---------- */
function stageOf(name, std){
  const n = name;
  if (std === "CEDS"){
    if (/Early Learning|Child|Core Knowledge Area/.test(n)) return "el";
    if (/Adult Education|Career And Technical|Program Participation (Adult|Career|WIOA)|Workforce Program/.test(n)) return "ad";
    if (/Postsecondary|IPEDS|Financial Aid|Teacher Prep|Teacher Education/.test(n)) return "ps";
    if (/K12|Local Education Ag|State Education Agency|School|Individualized Program|^IEP|Goal|Eligibility|Classroom|Teacher Student|Charter|Incident|Apip|Assessment Need|Assessment Personal|Program Participation (Title|Migrant|Neglected|Special)|Course Section|^Assignment|Student Course Section|Role Attendance|Service Plan/.test(n)) return "k12";
    if (/Credential|Competency|Rubric|Learner Act|Learning Resource|Peer Rating/.test(n)) return "cr";
    if (/Quarterly Employment|Workforce|Person Military|^Job|^Employment|Career Education/.test(n)) return "wf";
    return "all";
  }
  if (/Secondary School Diploma|Secondary Education Certificate/.test(n)) return "k12";
  if (/Apprentic|Journeyman|Master Trade|Work-Based|Technical Level|Basic Technical|General Education Development|General Education Level/.test(n)) return "ad";
  if (/Degree|Doctora|Post-Baccalaureate|Post-Master|Higher Education Level|Transfer|Advanced Standing|Prior Learning|^Course|Learning Program|Learning Opportunity|Scheduled Offering|Instructional Program/.test(n)) return "ps";
  if (/Job|Occupation|Industry|Task|Work Role|Workforce|Pay Profile|Earnings|Employment Outcome|Work Experience/.test(n)) return "wf";
  if (/Competenc|Rubric|Criterion|Progression|Proficiency|Concept|Credential|Badge|Certificat|License|Diploma|Alignment|Qualifications|Action|Verification|Revocation|Pathway|Shared on/.test(n)) return "cr";
  return "all";
}
function topicOf(name){
  const n = name;
  if (/Assess|Apip|Rubric|Criterion|Evaluation Outcome|Admission Test|Literacy Assessment|Credential Exam/.test(n)) return "Assessment";
  if (/Competenc|Progression|Concept|Alignment|Framework|Learning Resource|Learner Act|Peer Rating|Proficiency Scale|Core Knowledge/.test(n)) return "Competencies & frameworks";
  if (/Credential|Degree|Certificat|Diploma|Badge|License|Award|Honor|General Education Development|Accredit|Approve Action|Recogni|Regulate|Renew|Revo|Rights Action|Registration Action|Offer Action|Verification|Qualifications|Doctora|Shared on/.test(n)) return "Credentials & awards";
  if (/Financ|Fund|Cost|Price|Pay Profile|Salary|Compensation|Monetary|Mortgage|Lease|Indirect Cost|Financial/.test(n)) return "Finance & aid";
  if (/Facilit|Building/.test(n)) return "Facilities & operations";
  if (/Staff|Employ|^Job|Job |Occupation|Industry|^Task|Work Role|Workforce|Professional Development|Teacher|^Assignment|Board Member|Earnings|Military Occupational/.test(n)) return "Staff, jobs & employment";
  if (/Data|Record|Observation|Metric|Dimension|Aggregate|Outcome|Indicator|Accountability|Incident|Quantitative|Holders|Base CEDS|Collection$|Collection Member|Identifier Value|Unattached/.test(n)) return "Data, records & outcomes";
  if (/Enrollment|Course|Section|Pathway|Learning Opportunity|Learning Program|Membership|Class|Activity|Session|Calendar|Transfer|Prior Learning|Advanced Standing|Scheduled Offering|Program|Service|Plan|IEP|Individualized|Goal|Eligibility|Attendance|Component|Condition|Constraint|Duration|Process Profile/.test(n)) return "Programs & learning";
  if (/Person|Student|Child|Learner|Contact|Military|Referral|Demographic|Telephone/.test(n)) return "Learners & people";
  return "Organizations & places";
}

/* ---------- state ---------- */
const S = {
  props: [], byKey: new Map(), classes: new Map(), values: [],
  thr: 0, sel: null, filters: {q:"",std:"",status:"",stage:"",topic:"",level:""},
  sort: {k:"status", dir:1}, mcp:null, downloads:null, layoutReady:false
};

/* ---------- data ---------- */
// The site reads a snapshot produced by scripts/export.mjs at build time.
const DATA_URL = "data/atlas.json";

/* ---------- overlay ---------- */
const ov = document.getElementById("overlay");
function prog(f){ document.getElementById("progBar").style.width = Math.round(f*100)+"%"; }
function fatal(title, body){
  document.getElementById("ovT").textContent = title;
  document.getElementById("ovP").textContent = body;
  document.querySelector(".prog").style.display = "none";
  document.getElementById("stamp").textContent = "No data";
}

/* ---------- build model ---------- */
function classKey(std, src, name){ return std+"|"+src+"|"+name; }
function ensureClass(std, src, name, extra){
  const k = classKey(std, src, name);
  let c = S.classes.get(k);
  if (!c){
    c = {key:k, std, src, name, parent:"", np:0, props:[], stage:stageOf(name, std), topic:topicOf(name), ...extra};
    S.classes.set(k, c);
  }
  return c;
}
function build(D){
  const {ceds, ctdl, ctdlClasses:cls, matches:match, cedsClasses} = D;
  (cedsClasses||[]).forEach(([name, id, desc])=>{ const c = ensureClass("CEDS","CEDS",name); c.cedsId = id; c.desc = desc; });
  // CEDS properties
  ceds.forEach(([path, id, desc, dtype])=>{
    const i = path.indexOf("."); const cn = i>0 ? path.slice(0,i) : path; const pn = i>0 ? path.slice(i+1) : path;
    const c = ensureClass("CEDS","CEDS",cn);
    const p = {id:"C:"+path, std:"CEDS", src:"CEDS", cls:c, name:pn, path, cedsId:id, desc, dtype, matches:[], matchedBy:[], level:"property"};
    c.props.push(p); S.props.push(p); S.byKey.set("CEDS|"+path, p);
  });
  // CTDL classes
  cls.forEach(([src,name,parent,np,desc,uri])=>{ const c = ensureClass("CTDL",src,name); c.parent = parent; c.np = np; c.desc = desc; c.uri = uri; });
  // CTDL properties
  const seen = new Map();
  ctdl.forEach(([src,name,path,nc,desc,uri])=>{
    let home = path && path.indexOf(".")>0 ? path.slice(0, path.indexOf(".")) : "";
    let c;
    if (nc >= 10) c = ensureClass("CTDL",src,"Shared on many "+SRC_LABEL[src]+" types",{shared:true});
    else if (!home || home===src) c = ensureClass("CTDL",src,"Unattached "+SRC_LABEL[src]+" properties",{pseudo:true});
    else c = ensureClass("CTDL",src,home);
    let id = "T:"+src+":"+(path||name); const dup = seen.get(id)||0; seen.set(id, dup+1); if (dup) id += "~"+dup;
    const p = {id, std:"CTDL", src, cls:c, name, path, nc, desc, uri, matches:[], matchedBy:[], level:"property"};
    c.props.push(p); S.props.push(p);
    const key = src+"|"+path; if (!S.byKey.has(key)) S.byKey.set(key, p);
  });
  // shared-class stage/topic overrides
  S.classes.forEach(c=>{
    if (c.shared){ c.stage="cr"; c.topic="Credentials & awards"; }
    if (c.pseudo){ c.stage="all"; c.topic="Data, records & outcomes"; }
    if (c.std==="CTDL" && c.src==="CTDLQData" && !c.pseudo){ c.topic = /Monetary/.test(c.name) ? "Finance & aid" : "Data, records & outcomes"; c.stage = c.stage==="all" ? "wf" : c.stage; }
  });
  // crosswalk edges
  match.forEach(([src, role, name, path, type, conf, dom, cprop, cval, cpath, desc])=>{
    const m = {type, conf:+(+conf).toFixed(2), dom, cprop, cval, cpath};
    if (role === "DmeProperty"){
      const p = S.byKey.get(src+"|"+path) || S.props.find(x=>x.src===src && x.name===name);
      if (!p) return;
      m.ceds = S.byKey.get("CEDS|"+cpath) || null;
      p.matches.push(m);
      if (m.ceds) m.ceds.matchedBy.push({p, m});
    } else {
      const i = path.indexOf(".");
      const setName = i>0 ? path.slice(0,i) : "";
      const owner = S.props.find(x=>x.std==="CTDL" && x.src===src && (x.name===setName || x.name===setName+" Type"));
      const v = {id:"V:"+src+":"+path, std:"CTDL", src, name, path, setName, desc, level:"value", matches:[m], matchedBy:[],
                 cls: owner ? owner.cls : ensureClass("CTDL",src,"Unattached "+SRC_LABEL[src]+" properties",{pseudo:true}), owner};
      m.ceds = S.byKey.get("CEDS|"+cpath) || null;
      S.values.push(v);
    }
  });
  S.classes.forEach(c=>{
    c.props.sort((a,b)=>a.name.localeCompare(b.name));
  });
  S.byId = new Map(); S.props.concat(S.values).forEach(p=>S.byId.set(p.id, p));
}

/* ---------- status with threshold ---------- */
function liveMatches(p){ return p.matches.filter(m=>m.conf >= S.thr || m.type==="EXACT_MATCH"); }
function liveMatchedBy(p){ return p.matchedBy.filter(x=>x.m.conf >= S.thr || x.m.type==="EXACT_MATCH"); }
function status(p){
  if (p.std === "CEDS") return liveMatchedBy(p).length ? "overlap" : "ceds-only";
  return liveMatches(p).length ? "overlap" : "ctdl-only";
}
const STATUS_LABEL = {"overlap":"Overlap","ctdl-only":"CTDL only","ceds-only":"CEDS only"};
function classOverlap(c){ return c.props.some(p=>status(p)==="overlap"); }

/* ---------- layout ---------- */
const CELL = 520, LM = 0, TM = 0;
const W = STAGES.length*CELL, H = TOPICS.length*CELL;
function layout(){
  const cells = new Map();
  S.classes.forEach(c=>{
    const k = c.stage+"|"+c.topic;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(c);
  });
  S.cells = [];
  cells.forEach((list, k)=>{
    const [st, tp] = k.split("|");
    const col = stageIdx[st], row = TOPICS.indexOf(tp);
    const leaves = list.reduce((s,c)=>s+Math.max(1,c.props.length),0);
    const R = Math.min(CELL/2-26, 8.2*Math.sqrt(leaves)+18);
    const root = d3.hierarchy({children: list.map(c=>({c, children: c.props.length? c.props.map(p=>({p})) : undefined}))})
      .sum(d=> (d.p ? 1 : (d.c && !d.children ? 1.4 : 0)))
      .sort((a,b)=> (a.data.c && b.data.c ? (a.data.c.std===b.data.c.std ? b.value-a.value : (a.data.c.std==="CEDS"?-1:1)) : b.value-a.value));
    d3.pack().size([2*R,2*R]).padding(d=> d.depth===0 ? 7 : 1.4)(root);
    const cx = LM + col*CELL + CELL/2, cy = TM + row*CELL + CELL/2 + 8;
    root.each(n=>{ n.wx = cx - R + n.x; n.wy = cy - R + n.y; });
    root.children && root.children.forEach(n=>{ const c = n.data.c; c.x=n.wx; c.y=n.wy; c.r=n.r; c.node=n;
      (n.children||[]).forEach(m=>{ const p = m.data.p; p.x=m.wx; p.y=m.wy; p.r=m.r; }); });
    S.cells.push({stage:st, topic:tp, col, row, n:leaves, list});
  });
  S.layoutReady = true;
}

/* ---------- render ---------- */
const svg = d3.select("#map");
let world, gCells, gLinks, gCls, gDots, gLabels, gHdr, zoom, T = d3.zoomIdentity, vw=800, vh=600;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function render(){
  svg.selectAll("*").remove();
  world = svg.append("g");
  gCells = world.append("g");
  gCls = world.append("g");
  gDots = world.append("g");
  gLinks = world.append("g");
  gLabels = svg.append("g");
  gHdr = svg.append("g");

  gCells.selectAll("rect").data(d3.cross(d3.range(STAGES.length), d3.range(TOPICS.length))).join("rect")
    .attr("class","cellrect").attr("x",d=>d[0]*CELL+6).attr("y",d=>d[1]*CELL+6).attr("width",CELL-12).attr("height",CELL-12).attr("rx",14)
    .attr("vector-effect","non-scaling-stroke")
    .style("fill-opacity", d=> d[0]===6 ? .55 : 1);
  // continuum arrow across the top of the stage columns
  world.append("line").attr("x1",CELL*0.08).attr("x2",CELL*5.92).attr("y1",-14).attr("y2",-14)
    .attr("stroke",css("--rule")).attr("stroke-width",2).attr("vector-effect","non-scaling-stroke");

  const classes = [...S.classes.values()].filter(c=>c.r);
  gCls.selectAll("circle").data(classes, d=>d.key).join("circle")
    .attr("class","cls").attr("cx",d=>d.x).attr("cy",d=>d.y).attr("r",d=>d.r)
    .attr("vector-effect","non-scaling-stroke")
    .on("click",(ev,d)=>{ ev.stopPropagation(); selectClass(d, true); })
    .append("title").text(d=>`${d.name} · ${SRC_LABEL[d.src]} · ${d.props.length} properties`);

  const dots = S.props.filter(p=>p.r);
  gDots.selectAll("circle").data(dots, d=>d.id).join("circle")
    .attr("class","dot").attr("cx",d=>d.x).attr("cy",d=>d.y).attr("r",d=>Math.max(.6,d.r*0.86))
    .on("click",(ev,d)=>{ ev.stopPropagation(); selectProp(d, false); })
    .append("title").text(d=>`${d.name} — ${d.cls.name} (${SRC_LABEL[d.src]})`);

  restyle();

  zoom = d3.zoom().scaleExtent([0.08, 60]).on("zoom", ev=>{ T = ev.transform; world.attr("transform", T); schedule(); });
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("click", ()=>{ clearSel(); });
  resize(); fit(false);
}
function restyle(){
  const sel = S.sel, vis = S.visible;
  gCls.selectAll("circle")
    .attr("fill", d=> d.std==="CEDS" ? "color-mix(in srgb, var(--ceds) 7%, transparent)" : "color-mix(in srgb, var(--ctdl) 9%, transparent)")
    .attr("stroke", d=> d.std==="CEDS" ? "var(--ceds)" : "var(--ctdl)")
    .attr("stroke-width", d=> (sel && sel.kind==="class" && sel.c===d) ? 3 : (classOverlap(d) ? 1.6 : 1))
    .attr("stroke-dasharray", d=> (d.std!=="CEDS" && !classOverlap(d)) ? "4 3" : null)
    .attr("opacity", d=> !vis ? 1 : (d.props.some(p=>vis.has(p.id)) || (vis.classes && vis.classes.has(d.key)) ? 1 : .25));
  gDots.selectAll("circle")
    .attr("fill", d=>{ const s=status(d); return s==="overlap" ? "var(--overlap)" : s==="ctdl-only" ? "var(--gap)" : "var(--ceds-dot)"; })
    .attr("stroke", d=> (sel && sel.kind==="prop" && sel.p===d) ? "var(--focus)" : (d.std==="CTDL" && status(d)==="overlap" ? "var(--ctdl)" : "none"))
    .attr("stroke-width", d=> (sel && sel.kind==="prop" && sel.p===d) ? 3 : 1.2)
    .attr("vector-effect","non-scaling-stroke")
    .attr("opacity", d=> !vis ? 1 : (vis.has(d.id) ? 1 : 0.1));
  drawLinks(); schedule();
}

/* links for selection */
function drawLinks(){
  const pairs = [];
  const add = (p)=>{
    if (p.std==="CTDL") liveMatches(p).forEach(m=>{ if (m.ceds && m.ceds.r) pairs.push([p, m.ceds]); });
    else liveMatchedBy(p).forEach(x=>{ if (x.p.r) pairs.push([x.p, p]); });
  };
  if (S.sel){
    if (S.sel.kind==="prop" && S.sel.p.level==="property") add(S.sel.p);
    if (S.sel.kind==="prop" && S.sel.p.level==="value" && S.sel.p.owner) add(S.sel.p.owner);
    if (S.sel.kind==="class") S.sel.c.props.forEach(add);
  }
  gLinks.selectAll("path").data(pairs).join("path").attr("class","link")
    .attr("d", ([a,b])=>{ const mx=(a.x+b.x)/2, my=(a.y+b.y)/2 - Math.hypot(b.x-a.x,b.y-a.y)*0.18; return `M${a.x},${a.y}Q${mx},${my} ${b.x},${b.y}`; });
}

/* labels and sticky headers in screen space */
let raf = 0;
function schedule(){ if (!raf) raf = requestAnimationFrame(()=>{ raf=0; drawLabels(); }); }
function drawLabels(){
  if (!S.layoutReady) return;
  const k = T.k, inView = (x,y,r)=>{ const [sx,sy]=T.apply([x,y]); return sx+r*k>-40 && sx-r*k<vw+40 && sy+r*k>-40 && sy-r*k<vh+40; };
  const labels = [];
  // cell captions when zoomed in enough to need context
  if (k > 0.55){
    S.cells.forEach(c=>{
      const x = c.col*CELL+22, y = c.row*CELL+30;
      if (!inView(x+CELL/2,y+CELL/2,CELL)) return;
      // Drop the caption once its row has slid under the sticky header band,
      // otherwise it ghosts behind the column header.
      if (T.applyY(y) < TOPBAND + 10) return;
      labels.push({id:"cell:"+c.stage+c.topic, x, y, t:`${stageLabel[c.stage]} · ${c.topic}`, cls:"cell", anchor:"start"});
    });
  }
  // class labels
  const vis = S.visible;
  S.classes.forEach(c=>{
    if (!c.r) return;
    const sr = c.r*k;
    if (sr < 26 || !inView(c.x,c.y,c.r)) return;
    if (vis && !c.props.some(p=>vis.has(p.id))) return;
    const big = sr > 90;
    labels.push({id:"cl:"+c.key, x:c.x, y: big ? c.y - c.r + 14/k : c.y, t:c.name, cls: big ? "clsbig" : "cls", anchor:"middle", c});
  });
  // property labels
  if (k > 5){
    let n = 0;
    for (const p of S.props){
      if (!p.r) continue;
      if (p.r*k < 13 || !inView(p.x,p.y,p.r)) continue;
      if (vis && !vis.has(p.id)) continue;
      labels.push({id:"p:"+p.id, x:p.x, y:p.y, t:p.name, cls:"prop", anchor:"middle", p});
      if (++n > 420) break;
    }
  }
  const muted = css("--muted"), ink = css("--ink");
  gLabels.selectAll("text").data(labels, d=>d.id).join("text")
    .attr("class","halo")
    .attr("x", d=>T.applyX(d.x)).attr("y", d=>T.applyY(d.y))
    .attr("text-anchor", d=>d.anchor).attr("dominant-baseline","middle")
    .attr("font-size", d=> d.cls==="cell" ? 13 : d.cls==="prop" ? Math.min(12, Math.max(9, d.p.r*k*0.22)) : d.cls==="clsbig" ? 14 : 12)
    .attr("font-weight", d=> d.cls==="prop" ? 400 : d.cls==="cell" ? 600 : 700)
    .attr("fill", d=> d.cls==="cell" ? muted : d.c ? (d.c.std==="CEDS" ? "var(--ceds)" : "color-mix(in srgb, var(--ctdl) 75%, var(--ink))") : ink)
    .style("pointer-events","none")
    .text(d=> clip(d.t, d.cls==="prop" ? Math.max(8, Math.floor(d.p.r*k*2/6.2)) : d.c ? Math.max(10, Math.floor(d.c.r*k*1.7/7)) : 60));

  // sticky headers
  const hdr = [];
  STAGES.forEach((s,i)=>{
    const x0 = T.applyX(i*CELL), x1 = T.applyX((i+1)*CELL);
    if (x1 <= 0 || x0 >= vw) return;
    // Fit to the visible slice of the column, so a half-scrolled header still reads.
    const avail = Math.max(24, Math.min(x1, vw) - Math.max(x0, 0) - 14);
    const f = fitHeader(s.label, s.short, avail);
    hdr.push({id:"s"+i, kind:"col", x:Math.max(8, Math.min((x0+x1)/2, vw-8)), y:16, t:f.t, size:f.size, w:x1-x0, i});
  });
  const gridLeft = T.applyX(0);
  TOPICS.forEach((t,i)=>{
    const y0 = T.applyY(i*CELL), y1 = T.applyY((i+1)*CELL);
    if (y1 <= 34 || y0 >= vh) return;
    const h = y1 - y0;
    // Shrink the label on short rows rather than dropping it: at ~1280px wide a
    // row is only ~57px tall, which used to suppress every topic label.
    const size = Math.max(9, Math.min(12, Math.round(h / 4.5)));
    const txt = clip(t, 30);
    const tw = measure(txt, size, 600);
    // Sit just outside the grid when there is room; pin to the viewport once the
    // grid's left edge has been panned off-screen.
    const x = Math.max(10, Math.min(gridLeft - tw - 16, vw - tw - 10));
    hdr.push({id:"t"+i, kind:"row", x, y:Math.max(46, Math.min((y0+y1)/2, vh-10)), t, h, i,
              size, txt, tw});
  });
  gHdr.selectAll("rect.hdr-band").data([0]).join("rect").attr("class","hdr-band").attr("x",0).attr("y",0).attr("width",vw).attr("height",32);
  // Row labels float over the map, so give each one a plate to sit on.
  const ROWMIN = 26;  // below this a row is too thin to carry a readable label
  gHdr.selectAll("rect.hdr-pill").data(hdr.filter(d=>d.kind==="row" && d.h>ROWMIN), d=>d.id).join("rect")
    .attr("class","hdr-pill").attr("rx",5)
    .attr("x",d=>d.x-7).attr("y",d=>d.y-(d.size+8)/2).attr("width",d=>d.tw+14).attr("height",d=>d.size+8);
  gHdr.selectAll("text").data(hdr, d=>d.id).join("text")
    .attr("class","halo").attr("x",d=>d.x).attr("y",d=>d.y)
    .attr("text-anchor", d=> d.kind==="col" ? "middle" : "start").attr("dominant-baseline","middle")
    .attr("font-size", d=> d.size).attr("font-weight", d=> d.kind==="col" ? 700 : 600)
    .attr("fill", d=> d.kind==="col" ? ink : muted)
    .style("pointer-events","none")
    .text(d=> d.kind==="col" ? d.t : (d.h > ROWMIN ? d.txt : ""));
}
function clip(t, n){ return t.length > n ? t.slice(0, Math.max(1,n-1)) + "…" : t; }

/* Real text metrics, so headers shrink to fit instead of being chopped at a
   guessed character count. Canvas and SVG use the same font stack. */
const measure = (() => {
  const ctx = document.createElement("canvas").getContext("2d");
  return (t, size, weight) => {
    ctx.font = `${weight} ${size}px "Public Sans", system-ui, sans-serif`;
    return ctx.measureText(t).width;
  };
})();
function clipToWidth(t, maxW, size, weight){
  if (measure(t, size, weight) <= maxW) return t;
  let s = t;
  while (s.length > 1 && measure(s + "…", size, weight) > maxW) s = s.slice(0, -1);
  return s + "…";
}
// Widest label that fits, at the largest size that fits: full text first, then
// the abbreviation, then the abbreviation clipped.
function fitHeader(full, short, maxW){
  for (let size = 13; size >= 11; size--) if (measure(full, size, 700) <= maxW) return {t: full, size};
  for (let size = 13; size >= 9; size--) if (measure(short, size, 700) <= maxW) return {t: short, size};
  return {t: clipToWidth(short, maxW, 9, 700), size: 9};
}

function resize(){ const r = svg.node().getBoundingClientRect(); vw = r.width; vh = r.height; schedule(); }
const TOPBAND = 36, BOTBAND = 30;  // sticky column headers; hint bar and zoom buttons
function fit(anim){
  const h = vh - TOPBAND - BOTBAND;
  const k = Math.min(vw/(W+40), h/(H+40));
  const t = d3.zoomIdentity.translate((vw - W*k)/2, TOPBAND + (h - H*k)/2).scale(k);
  (anim ? svg.transition().duration(reduce()?0:450) : svg).call(zoom.transform, t);
}
function reduce(){ return matchMedia("(prefers-reduced-motion: reduce)").matches; }
function zoomTo(x,y,r, pad){
  const k = Math.max(0.1, Math.min(60, Math.min(vw, vh-36) / (2*r*(pad||1.25))));
  const t = d3.zoomIdentity.translate(vw/2 - x*k, (vh+36)/2 - y*k).scale(k);
  svg.transition().duration(reduce()?0:600).call(zoom.transform, t);
}

/* ---------- selection + panel ---------- */
const panel = document.getElementById("panel");
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function stBadge(s){ return `<span class="st st-${s}">${STATUS_LABEL[s]}</span>`; }
function stdBadge(src){ return `<span class="badge ${src==="CEDS"?"b-ceds":"b-ctdl"}">${SRC_LABEL[src]}</span>`; }
function dotColor(p){ const s=status(p); return s==="overlap"?"var(--overlap)":s==="ctdl-only"?"var(--gap)":"var(--ceds-dot)"; }

function clearSel(){ setHash(); S.sel=null; restyle(); highlightRow(); panel.innerHTML = panel.dataset.empty || panel.innerHTML; }
function selectClass(c, zoomIn){
  S.sel = {kind:"class", c}; restyle(); highlightRow();
  if (zoomIn && c.r) zoomTo(c.x, c.y, c.r);
  const n = c.props.length, ov = c.props.filter(p=>status(p)==="overlap").length;
  const gap = c.std==="CEDS" ? 0 : n-ov;
  panel.innerHTML = `
    <div>${stdBadge(c.src)} ${c.shared?'<span class="badge b-ctdl">grouped</span>':''}</div>
    <h2>${esc(c.name)}</h2>
    <div class="meta">${stageLabel[c.stage]} · ${esc(c.topic)}${c.parent?` · subclass of ${esc(c.parent)}`:""}</div>
    <p class="desc" id="cdesc">${c.shared ? "CTDL properties attached to ten or more classes (credential, assessment and learning-opportunity types). They are gathered here so each appears once on the map." : c.pseudo ? "Properties with no host class in the graph." : '<span class="empty">Loading definition…</span>'}</p>
    <div class="counts">
      <div><b>${n}</b>${c.std==="CEDS"?"properties":"properties placed here"}</div>
      <div><b style="color:var(--overlap)">${ov}</b>crosswalked</div>
      <div><b style="color:${c.std==="CEDS"?"var(--ceds)":"var(--gap)"}">${c.std==="CEDS"? n-ov : gap}</b>${c.std==="CEDS"?"CEDS only":"CTDL only"}</div>
    </div>
    ${c.std!=="CEDS" && c.np && c.np!==n ? `<p class="meta">Attached to ${c.np} properties in the graph in total; the rest are shown once under their first host or the shared group.</p>`:""}
    <div class="sec">Properties</div>
    <ul class="plist">${c.props.map((p,i)=>`<li><button data-i="${i}"><span class="sw" style="background:${dotColor(p)}"></span><span>${esc(p.name)}${p.matches.length||p.matchedBy.length?`<br><small>${esc(xwSummary(p))}</small>`:""}</span>${stBadge(status(p))}</button></li>`).join("") || '<li class="empty" style="padding:8px 0">No properties of its own; it inherits from its parent type.</li>'}</ul>`;
  panel.querySelectorAll(".plist button").forEach(b=>b.onclick=()=>selectProp(c.props[+b.dataset.i], true));
  const cd = document.getElementById("cdesc");
  if (cd && !c.shared && !c.pseudo){
    const id = c.std==="CEDS" ? c.cedsId : c.uri;
    cd.innerHTML = c.desc ? `${esc(c.desc)}${id?` <span class="meta">(${esc(id)})</span>`:""}` : '<span class="empty">No definition in the graph.</span>';
  }
  setHash("c", c.key);
}
function xwSummary(p){
  if (p.std==="CEDS") return liveMatchedBy(p).map(x=>`← ${SRC_LABEL[x.p.src]} ${x.p.name} (${x.m.conf.toFixed(2)})`).join("; ");
  return liveMatches(p).map(m=>`→ ${m.dom}.${m.cprop}${m.cval?" = "+m.cval:""} (${m.conf.toFixed(2)})`).join("; ");
}
function selectProp(p, zoomIn){
  S.sel = {kind:"prop", p}; restyle(); highlightRow();
  const target = p.level==="value" ? p.owner : p;
  if (zoomIn && target && target.r) zoomTo(target.x, target.y, Math.max(target.r*6, 6), 1);
  const st = status(p);
  let xw = "";
  if (p.std==="CTDL"){
    const all = p.matches;
    xw = all.length ? all.map((m,i)=>`<div class="xw">
        <div><span class="st ${ (m.conf>=S.thr||m.type==="EXACT_MATCH")?"st-overlap":"st-ceds-only"}">${m.type==="EXACT_MATCH"?"Exact":"Close"} · ${m.conf.toFixed(2)}</span></div>
        <div class="to" style="margin-top:4px">${esc(m.dom)} › ${m.ceds?`<button data-x="${i}">${esc(m.cprop)}</button>`:esc(m.cprop)}${m.cval?` = ${esc(m.cval)}`:""}</div>
        <div class="why">${m.type==="EXACT_MATCH"?"Authored crosswalk; trust as fact.":"Inferred by embedding and rerank; a scored hypothesis."}${(m.conf<S.thr && m.type!=="EXACT_MATCH")?" Below your threshold, so counted as a gap.":""}</div>
      </div>`).join("") : `<p class="empty">No crosswalk edge to any CEDS tuple. This is something CTDL describes that CEDS (as forged in EDUcore) does not.</p>`;
  } else {
    xw = p.matchedBy.length ? p.matchedBy.map((x,i)=>`<div class="xw">
        <div><span class="st ${(x.m.conf>=S.thr||x.m.type==="EXACT_MATCH")?"st-overlap":"st-ceds-only"}">${x.m.type==="EXACT_MATCH"?"Exact":"Close"} · ${x.m.conf.toFixed(2)}</span></div>
        <div class="to" style="margin-top:4px">${stdBadge(x.p.src)} ${esc(x.p.cls.name)} › <button data-b="${i}">${esc(x.p.name)}</button></div>
      </div>`).join("") : `<p class="empty">No CTDL element resolves to this CEDS property.</p>`;
  }
  panel.innerHTML = `
    <div>${stdBadge(p.src)} ${stBadge(st)} ${p.level==="value"?'<span class="badge b-ctdl">code value</span>':""}</div>
    <h2>${esc(p.name)}</h2>
    <div class="meta">${p.level==="value" ? `Value in ${esc(p.setName)}` : `In <button class="btn" id="toCls" style="padding:1px 7px">${esc(p.cls.name)}</button>`} · ${stageLabel[p.cls.stage]} · ${esc(p.cls.topic)}${p.nc?` · on ${p.nc} classes`:""}</div>
    <p class="desc" id="pdesc"><span class="empty">Loading definition…</span></p>
    <div class="sec">${p.std==="CTDL" ? "Crosswalk to CEDS" : "Reached from CTDL"}</div>
    ${xw}
    <p class="meta" style="margin-top:12px">${p.std==="CEDS" && p.cedsId ? `CEDS ${esc(p.cedsId)} · ` : ""}<code>${esc(p.path)}</code></p>`;
  const tc = document.getElementById("toCls"); if (tc) tc.onclick = ()=>selectClass(p.cls, true);
  panel.querySelectorAll("button[data-x]").forEach(b=>b.onclick=()=>{ const m=p.matches[+b.dataset.x]; if (m.ceds) selectProp(m.ceds, true); });
  panel.querySelectorAll("button[data-b]").forEach(b=>b.onclick=()=>selectProp(p.matchedBy[+b.dataset.b].p, true));
  const pd = document.getElementById("pdesc");
  const ident = p.std==="CEDS" ? "" : (p.uri||"");
  if (pd) pd.innerHTML = p.desc ? esc(p.desc) + (p.dtype?` <span class="meta">(${esc(p.dtype)})</span>`:"") + (ident?` <span class="meta">(${esc(ident)})</span>`:"") : '<span class="empty">No definition in the graph.</span>';
  setHash("p", p.id);
}

/* ---------- deep links ---------- */
function setHash(k, v){
  const h = new URLSearchParams(location.hash.slice(1));
  h.delete("c"); h.delete("p"); if (v) h.set(k, v);
  history.replaceState(null, "", "#"+h.toString());
}
function restoreHash(){
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("q")){ S.filters.q = h.get("q"); document.getElementById("q").value = S.filters.q; renderTable(); }
  if (h.get("t")){ thr.value = h.get("t"); thr.dispatchEvent(new Event("input")); }
  const pid = h.get("p"), cid = h.get("c");
  if (pid && S.byId.get(pid)) selectProp(S.byId.get(pid), true);
  else if (cid && S.classes.get(cid)) selectClass(S.classes.get(cid), true);
}

/* ---------- table + filters ---------- */
function rowsAll(){
  const rows = [];
  const mk = (p)=>{
    const st = status(p);
    let target = "", conf = null;
    if (p.std==="CTDL"){ const ms = p.matches.slice().sort((a,b)=>b.conf-a.conf); if (ms[0]){ target = `${ms[0].dom}.${ms[0].cprop}${ms[0].cval?" = "+ms[0].cval:""}`; conf = ms[0].conf; } }
    else { const ms = p.matchedBy.slice().sort((a,b)=>b.m.conf-a.m.conf); if (ms[0]){ target = `${SRC_LABEL[ms[0].p.src]} ${ms[0].p.cls.name}.${ms[0].p.name}${ms.length>1?` +${ms.length-1}`:""}`; conf = ms[0].m.conf; } }
    rows.push({p, std:SRC_LABEL[p.src], src:p.src, family:p.std, cls:p.level==="value"?p.setName:p.cls.name, name:p.name, level:p.level,
      stage:stageLabel[p.cls.stage], stageId:p.cls.stage, topic:p.cls.topic, status:st, target, conf});
  };
  S.props.forEach(mk); S.values.forEach(mk);
  return rows;
}
function filtered(){
  const f = S.filters, qq = f.q.trim().toLowerCase();
  const terms = qq ? qq.split(/\s+/) : [];
  return S.rows.filter(r=>{
    if (f.std){ if (f.std.startsWith("CTDL:")){ if (r.src!==f.std.slice(5)) return false; } else if (r.family!==f.std) return false; }
    if (f.status && r.status!==f.status) return false;
    if (f.stage && r.stageId!==f.stage) return false;
    if (f.topic && r.topic!==f.topic) return false;
    if (f.level && r.level!==f.level) return false;
    if (terms.length){ const hay = (r.name+" "+r.cls+" "+r.target+" "+r.std).toLowerCase(); if (!terms.every(t=>hay.includes(t))) return false; }
    return true;
  });
}
const tbody = document.getElementById("tbody");
const ORDER = {"ctdl-only":0,"overlap":1,"ceds-only":2};
function renderTable(){
  S.rows = rowsAll();
  const list = filtered();
  const {k, dir} = S.sort;
  list.sort((a,b)=>{
    let x = a[k], y = b[k];
    if (k==="status"){ x = ORDER[x]; y = ORDER[y]; }
    if (k==="conf"){ x = x==null?-1:x; y = y==null?-1:y; }
    if (x<y) return -dir; if (x>y) return dir;
    return a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name);
  });
  const LIM = 500;
  const frag = list.slice(0, LIM).map((r,i)=>`<tr data-i="${i}" class="${S.sel && S.sel.p===r.p ? "sel":""}">
    <td>${stdBadge(r.src)}</td><td>${esc(r.cls)}</td><td>${esc(r.name)}${r.level==="value"?' <span class="lvl">value</span>':""}</td>
    <td>${esc(r.stage)}</td><td>${esc(r.topic)}</td><td>${stBadge(r.status)}</td><td>${esc(r.target)}</td><td class="num">${r.conf==null?"":r.conf.toFixed(2)}</td></tr>`).join("");
  tbody.innerHTML = frag || `<tr><td colspan="8" class="empty" style="padding:16px">Nothing matches. Clear a filter or broaden the search.</td></tr>`;
  S.shown = list;
  document.getElementById("count").textContent = list.length > LIM ? `Showing ${LIM} of ${list.length.toLocaleString()} — narrow the search to see the rest` : `${list.length.toLocaleString()} element${list.length===1?"":"s"}`;
  document.querySelectorAll("thead th").forEach(th=>th.setAttribute("aria-sort", th.dataset.k===k ? (dir>0?"ascending":"descending") : "none"));
  // map dimming
  const f = S.filters, active = f.q || f.std || f.status || f.stage || f.topic || f.level;
  if (active){
    const set = new Set(); list.forEach(r=>{ set.add(r.p.id); if (r.p.owner) set.add(r.p.owner.id); });
    S.visible = set;
  } else S.visible = null;
  restyle();
}
function highlightRow(){
  tbody.querySelectorAll("tr").forEach(tr=>{ const r = S.shown && S.shown[+tr.dataset.i]; tr.classList.toggle("sel", !!(r && S.sel && S.sel.p===r.p)); });
}
tbody.addEventListener("click", ev=>{
  const tr = ev.target.closest("tr[data-i]"); if (!tr) return;
  const r = S.shown[+tr.dataset.i]; if (r) selectProp(r.p, true);
});
document.querySelectorAll("thead th").forEach(th=>th.addEventListener("click", ()=>{
  const k = th.dataset.k; S.sort = {k, dir: S.sort.k===k ? -S.sort.dir : (k==="conf"?-1:1)}; renderTable();
}));
let tq = 0;
document.getElementById("q").addEventListener("input", e=>{ clearTimeout(tq); tq = setTimeout(()=>{ S.filters.q = e.target.value; renderTable(); const h=new URLSearchParams(location.hash.slice(1)); e.target.value?h.set("q",e.target.value):h.delete("q"); history.replaceState(null,"","#"+h.toString()); }, 140); });
[["fStd","std"],["fStatus","status"],["fStage","stage"],["fTopic","topic"],["fLevel","level"]].forEach(([id,k])=>{
  document.getElementById(id).addEventListener("change", e=>{ S.filters[k] = e.target.value; if (k==="stage") markStage(); renderTable(); });
});
document.getElementById("reset").addEventListener("click", ()=>{
  S.filters = {q:"",std:"",status:"",stage:"",topic:"",level:""};
  ["q","fStd","fStatus","fStage","fTopic","fLevel"].forEach(id=>document.getElementById(id).value="");
  markStage(); renderTable();
});
document.getElementById("fStage").innerHTML = `<option value="">All stages</option>` + STAGES.map(s=>`<option value="${s.id}">${s.label}</option>`).join("");
document.getElementById("fTopic").innerHTML = `<option value="">All topics</option>` + TOPICS.map(t=>`<option>${t}</option>`).join("");

/* CSV */
document.getElementById("csv").addEventListener("click", async ()=>{
  const list = S.shown || [];
  const cell = v => `"${String(v==null?"":v).replace(/"/g,'""')}"`;
  const lines = [["standard","class","element","level","stage","topic","status","crosswalk_to","confidence","path"].join(",")]
    .concat(list.map(r=>[r.std,r.cls,r.name,r.level,r.stage,r.topic,r.status,r.target,r.conf==null?"":r.conf,r.p.path].map(cell).join(",")));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], {type:"text/csv"}));
  const a = document.createElement("a"); a.href = url; a.download = "educore-ceds-ctdl-gaps.csv"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
});

/* ---------- continuum strip ---------- */
function renderContinuum(){
  const agg = STAGES.map(s=>({s, ceds:0, cedsOv:0, ctdl:0, ctdlOv:0}));
  S.props.forEach(p=>{ const a = agg[stageIdx[p.cls.stage]]; const st = status(p);
    if (p.std==="CEDS"){ a.ceds++; if (st==="overlap") a.cedsOv++; } else { a.ctdl++; if (st==="overlap") a.ctdlOv++; } });
  const max = Math.max(...agg.map(a=>Math.max(a.ceds,a.ctdl)), 1);
  const nav = document.getElementById("continuum");
  nav.innerHTML = agg.map((a,i)=>`<button class="stage ${a.s.id==="all"?"all":""}" data-s="${a.s.id}" aria-pressed="${S.filters.stage===a.s.id}">
      <span class="nm">${a.s.label}${i<5?' <span class="arrow">→</span>':""}</span>
      <span class="bars">
        <span class="bar"><span>CEDS</span><span class="track"><i style="width:${a.cedsOv/max*100}%;background:var(--overlap)"></i><i style="width:${(a.ceds-a.cedsOv)/max*100}%;background:var(--ceds-dot)"></i></span><span class="n">${a.ceds}</span></span>
        <span class="bar"><span>CTDL</span><span class="track"><i style="width:${a.ctdlOv/max*100}%;background:var(--overlap)"></i><i style="width:${(a.ctdl-a.ctdlOv)/max*100}%;background:var(--gap)"></i></span><span class="n">${a.ctdl}</span></span>
      </span></button>`).join("");
  nav.querySelectorAll(".stage").forEach(b=>b.onclick=()=>{
    const id = b.dataset.s, same = S.filters.stage===id;
    S.filters.stage = same ? "" : id; document.getElementById("fStage").value = S.filters.stage;
    markStage(); renderTable();
    if (!same){ const i = stageIdx[id]; zoomTo(i*CELL+CELL/2, H/2, Math.max(CELL/2, H/2), 1.02); } else fit(true);
  });
}
function markStage(){ document.querySelectorAll("#continuum .stage").forEach(b=>b.setAttribute("aria-pressed", String(S.filters.stage===b.dataset.s))); }

/* threshold */
const thr = document.getElementById("thr"), thrOut = document.getElementById("thrOut");
thr.addEventListener("input", ()=>{
  S.thr = +thr.value; { const h=new URLSearchParams(location.hash.slice(1)); S.thr?h.set("t",S.thr):h.delete("t"); history.replaceState(null,"","#"+h.toString()); }
  thrOut.textContent = S.thr===0 ? "any" : S.thr.toFixed(2);
  renderContinuum(); renderTable();
  if (S.sel){ S.sel.kind==="class" ? selectClass(S.sel.c,false) : selectProp(S.sel.p,false); }
});

/* zoom buttons */
document.getElementById("zin").onclick = ()=>svg.transition().duration(reduce()?0:250).call(zoom.scaleBy, 1.8);
document.getElementById("zout").onclick = ()=>svg.transition().duration(reduce()?0:250).call(zoom.scaleBy, 1/1.8);
document.getElementById("zfit").onclick = ()=>fit(true);
new ResizeObserver(()=>{ if (S.layoutReady){ resize(); } }).observe(document.querySelector(".mapbox"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>schedule());

/* ---------- boot ---------- */
panel.dataset.empty = panel.innerHTML;
(async function boot(){
  document.getElementById("csv").hidden = false;
  try {
    prog(.2);
    const res = await fetch(DATA_URL, {cache:"no-cache"});
    if (!res.ok) throw new Error("HTTP "+res.status);
    const D = await res.json(); prog(.8);
    build(D);
    const ver = D.versions || {};
    const nC = S.props.filter(p=>p.std==="CEDS").length, nT = S.props.length - nC;
    const when = D.generatedAt ? new Date(D.generatedAt).toLocaleString([], {dateStyle:"medium", timeStyle:"short"}) : "unknown";
    document.getElementById("stamp").innerHTML =
      `CEDS <b>${esc(ver.CEDS||"?")}</b> · ${nC.toLocaleString()} properties<br>CTDL <b>${esc(ver.CTDL||"?")}</b> + ASN + QData · ${nT.toLocaleString()} properties<br>Graph snapshot ${esc(when)}`;
    layout(); ov.remove(); render(); renderContinuum(); renderTable(); restoreHash();
  } catch(e){
    fatal("The graph snapshot didn't load", "This site reads data/atlas.json, built from EDUcore at deploy time. Run `npm run export` and rebuild. ("+(e.message||e)+")");
  }
})();
})();
