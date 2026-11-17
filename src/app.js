(function(){
"use strict";
const SRC_LABEL = {CEDS:"CEDS", CTDL:"CTDL", CTDLASN:"CTDL-ASN", CTDLQData:"CTDL-QData"};
const REL_SHORT = {EXACT_MATCH:"Exact", CLOSE_MATCH:"Close", BROAD_MATCH:"Broad", NARROW_MATCH:"Narrow"};
const RELS = ["EXACT_MATCH","CLOSE_MATCH","BROAD_MATCH","NARROW_MATCH"];

// `short` is only for the map's sticky column headers, where a cell can be
// ~75px wide when zoomed out.
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
  if (/Apprentic|Journeyman|Master Trade|Work-Based|Workbased|Technical Level|Basic Technical|General Education Development|General Education Level/.test(n)) return "ad";
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
  props: [], byKey: new Map(), byId: new Map(), classes: new Map(),
  bridges: [], pairs: [], declared: [], spokes: [], stdLabel: {},
  // Evidence settings for "shared ground": which relations count on each hop,
  // the minimum confidence both hops must carry, and how many distinct spoke
  // standards must agree before a CEDS–CTDL pair is shown.
  ev: {rel:"ec", thr:0, minStd:1},
  sel: null, tab: "props",
  filters: {q:"",hub:"",status:"",stage:"",topic:"",spoke:""},
  sort: {props:{k:"status",dir:1}, pairs:{k:"ns",dir:-1}, decl:{k:"tscheme",dir:1}},
  layoutReady:false
};
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
function newProp(o){
  const p = {uses:new Map(), useN:0, bridges:[], declared:[], ...o};
  p.cls.props.push(p); S.props.push(p); S.byId.set(p.id, p);
  return p;
}
function build(D){
  const {ceds, ctdl, ctdlClasses, cedsClasses, hubUse=[], bridges=[], declared=[], spokes=[]} = D;
  (cedsClasses||[]).forEach(([name, id, desc])=>{ const c = ensureClass("CEDS","CEDS",name); c.cedsId = id; c.desc = desc; });
  ceds.forEach(([path, id, desc, dtype])=>{
    const i = path.indexOf("."); const cn = i>0 ? path.slice(0,i) : path; const pn = i>0 ? path.slice(i+1) : path;
    const p = newProp({id:"C:"+path, std:"CEDS", src:"CEDS", hub:"CEDS", cls:ensureClass("CEDS","CEDS",cn), name:pn, path, key:path, cedsId:id, desc, dtype});
    S.byKey.set("CEDS|"+path, p);
  });
  ctdlClasses.forEach(([src,name,parent,np,desc,uri])=>{ const c = ensureClass("CTDL",src,name); c.parent = parent; c.np = np; c.desc = desc; c.uri = uri; });
  const seen = new Map();
  ctdl.forEach(([src,name,path,nc,desc,uri])=>{
    const home = path && path.indexOf(".")>0 ? path.slice(0, path.indexOf(".")) : "";
    let c;
    if (nc >= 10) c = ensureClass("CTDL",src,"Shared on many "+SRC_LABEL[src]+" types",{shared:true});
    else if (!home || home===src) c = ensureClass("CTDL",src,"Unattached "+SRC_LABEL[src]+" properties",{pseudo:true});
    else c = ensureClass("CTDL",src,home);
    let id = "T:"+src+":"+(uri||path||name); const dup = seen.get(id)||0; seen.set(id, dup+1); if (dup) id += "~"+dup;
    // Only core CTDL is a hub in EDUcore; ASN and QData are forged as ordinary
    // standards that no spoke is mapped to.
    const p = newProp({id, std:"CTDL", src, hub: src==="CTDL" ? "CTDL" : "", cls:c, name, path, key:uri, nc, desc, uri});
    if (uri && !S.byKey.has("CTDL|"+uri) && src==="CTDL") S.byKey.set("CTDL|"+uri, p);
  });
  S.classes.forEach(c=>{
    if (c.shared){ c.stage="cr"; c.topic="Credentials & awards"; }
    if (c.pseudo){ c.stage="all"; c.topic="Data, records & outcomes"; }
    if (c.std==="CTDL" && c.src==="CTDLQData" && !c.pseudo){ c.topic = /Monetary/.test(c.name) ? "Finance & aid" : "Data, records & outcomes"; c.stage = c.stage==="all" ? "wf" : c.stage; }
  });

  // Spoke standards
  S.spokes = spokes.map(([std, family, version, title, total, toCeds, toCtdl, toBoth])=>({std, family, version, title, total, toCeds, toCtdl, toBoth}));
  S.spokes.forEach(s=>{ S.stdLabel[s.std] = spokeLabel(s.std); });

  // Spoke usage per hub property
  hubUse.forEach(([hub, key, std, rel, n])=>{
    const p = S.byKey.get(hub+"|"+key); if (!p) return;
    let u = p.uses.get(std); if (!u){ u = {EXACT_MATCH:0,CLOSE_MATCH:0,BROAD_MATCH:0,NARROW_MATCH:0,n:0}; p.uses.set(std,u); }
    u[rel] += n; u.n += n; p.useN += n;
  });

  // Shared spokes: one spoke element on a card in each hub.
  S.bridges = bridges.map(([std, en, ep, cpath, tkey, tdom, ra, ca, rb, cb])=>{
    const b = {std, en, ep, cpath, tkey, tdom, ra, ca:+ca, rb, cb:+cb, c:S.byKey.get("CEDS|"+cpath)||null, t:S.byKey.get("CTDL|"+tkey)||null};
    if (b.c) b.c.bridges.push(b); if (b.t) b.t.bridges.push(b);
    return b;
  });
  const pm = new Map();
  S.bridges.forEach(b=>{
    if (!b.c || !b.t) return;
    const k = b.c.id+"|"+b.t.id;
    let pr = pm.get(k); if (!pr){ pr = {c:b.c, t:b.t, rows:[]}; pm.set(k, pr); }
    pr.rows.push(b);
  });
  S.pairs = [...pm.values()];
  S.pairs.forEach(pr=>{ (pr.c.pairs ||= []).push(pr); (pr.t.pairs ||= []).push(pr); });

  // Published correspondences (Credential Engine's own, verbatim)
  S.declared = declared.map(([tsrc, trole, tname, tscheme, turi, crole, cname, cset, curi, pred, by, tprops, cprops])=>{
    const d = {tsrc, trole, tname, tscheme, turi, crole, cname, cset, curi, pred, by,
      tp:(tprops||[]).map(u=>S.byKey.get("CTDL|"+u)).filter(Boolean),
      cp:(cprops||[]).map(x=>S.byKey.get("CEDS|"+x)).filter(Boolean)};
    d.tp.forEach(p=>p.declared.push(d)); d.cp.forEach(p=>p.declared.push(d));
    return d;
  });

  S.classes.forEach(c=>c.props.sort((a,b)=>a.name.localeCompare(b.name)));
  recompute();
}
function spokeLabel(std){
  const fixed = {EdFi:"Ed-Fi", OpenBadges:"Open Badges", SIF260928:"SIF 4.3", PESCLD:"PESC JSON-LD"};
  if (fixed[std]) return fixed[std];
  let m = std.match(/^PESC-(.*)-(\d.*)$/);
  if (m) return "PESC " + m[1].replace(/([a-z])([A-Z])/g, "$1 $2") + " " + m[2];
  m = std.match(/^OneRoster-(.*)-(\d.*)$/);
  if (m) return "OneRoster " + m[1];
  return std;
}

/* ---------- evidence + status ---------- */
const relOk = r => S.ev.rel==="any" ? true : S.ev.rel==="exact" ? r==="EXACT_MATCH" : (r==="EXACT_MATCH" || r==="CLOSE_MATCH");
function passes(b){ return relOk(b.ra) && relOk(b.rb) && Math.min(b.ca, b.cb) >= S.ev.thr; }
function recompute(){
  S.pairs.forEach(pr=>{
    pr.live = pr.rows.filter(passes);
    pr.stds = new Set(pr.live.map(b=>b.std));
    pr.ns = pr.stds.size; pr.n = pr.live.length;
    pr.bothExact = pr.live.filter(b=>b.ra==="EXACT_MATCH" && b.rb==="EXACT_MATCH").length;
    pr.ok = pr.n > 0 && pr.ns >= S.ev.minStd;
  });
  S.props.forEach(p=>{ p.livePairs = (p.pairs||[]).filter(pr=>pr.ok).sort((a,b)=>b.ns-a.ns||b.n-a.n); p.st = statusOf(p); });
}
function statusOf(p){
  if (p.declared.length) return "declared";
  if (p.livePairs.length) return "shared";
  if (p.useN) return "used";
  return "unused";
}
const STATUS_LABEL = {declared:"Published counterpart", shared:"Shared ground", used:"Spokes use this hub only", unused:"No spoke uses it"};
const STATUS_ORDER = {declared:0, shared:1, used:2, unused:3};
function dotColor(p){
  if (p.st==="declared") return "var(--declared)";
  if (p.st==="shared") return "var(--overlap)";
  if (p.st==="used") return p.std==="CEDS" ? "var(--ceds-use)" : "var(--ctdl-use)";
  return p.std==="CEDS" ? "var(--ceds-none)" : "var(--ctdl-none)";
}
function classShared(c){ return c.props.some(p=>p.st==="shared"||p.st==="declared"); }

/* ---------- layout ---------- */
const CELL = 520;
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
    const cx = col*CELL + CELL/2, cy = row*CELL + CELL/2 + 8;
    root.each(n=>{ n.wx = cx - R + n.x; n.wy = cy - R + n.y; });
    root.children && root.children.forEach(n=>{ const c = n.data.c; c.x=n.wx; c.y=n.wy; c.r=n.r;
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
  if (!gCls) return;
  const sel = S.sel, vis = S.visible;
  gCls.selectAll("circle")
    .attr("fill", d=> d.std==="CEDS" ? "color-mix(in srgb, var(--ceds) 7%, transparent)" : "color-mix(in srgb, var(--ctdl) 9%, transparent)")
    .attr("stroke", d=> d.std==="CEDS" ? "var(--ceds)" : "var(--ctdl)")
    .attr("stroke-width", d=> (sel && sel.kind==="class" && sel.c===d) ? 3 : (classShared(d) ? 1.6 : 1))
    .attr("stroke-dasharray", d=> classShared(d) ? null : "4 3")
    .attr("opacity", d=> !vis ? 1 : (d.props.some(p=>vis.has(p.id)) ? 1 : .25));
  gDots.selectAll("circle")
    .attr("fill", dotColor)
    .attr("stroke", d=> (sel && sel.kind==="prop" && sel.p===d) ? "var(--focus)" : "none")
    .attr("stroke-width", d=> (sel && sel.kind==="prop" && sel.p===d) ? 3 : 1.2)
    .attr("vector-effect","non-scaling-stroke")
    .attr("opacity", d=> !vis ? 1 : (vis.has(d.id) ? 1 : 0.1));
  drawLinks(); schedule();
}

/* Selection links: shared-ground pairs (teal) and published counterparts
   (plum) between the selected property, or the selected class's properties,
   and the other hub. Width grows with the number of agreeing standards. */
function drawLinks(){
  const links = [];
  const add = p=>{
    p.livePairs.forEach(pr=>{ if (pr.c.r && pr.t.r) links.push({a:pr.c, b:pr.t, w:pr.ns, kind:"shared"}); });
    p.declared.forEach(d=>d.cp.forEach(c=>d.tp.forEach(t=>{ if (c.r && t.r) links.push({a:c, b:t, w:1, kind:"declared"}); })));
  };
  if (S.sel){
    if (S.sel.kind==="prop") add(S.sel.p);
    if (S.sel.kind==="class") S.sel.c.props.forEach(add);
    if (S.sel.kind==="pair" && S.sel.pr.c.r && S.sel.pr.t.r) links.push({a:S.sel.pr.c, b:S.sel.pr.t, w:S.sel.pr.ns, kind:"shared"});
  }
  const seen = new Set();
  const uniq = links.filter(l=>{ const k = l.a.id+"|"+l.b.id+"|"+l.kind; if (seen.has(k)) return false; seen.add(k); return true; });
  gLinks.selectAll("path").data(uniq).join("path").attr("class", d=>"link "+d.kind)
    .attr("stroke-width", d=> Math.min(6, 1.2 + Math.sqrt(d.w)))
    .attr("d", ({a,b})=>{ const mx=(a.x+b.x)/2, my=(a.y+b.y)/2 - Math.hypot(b.x-a.x,b.y-a.y)*0.18; return `M${a.x},${a.y}Q${mx},${my} ${b.x},${b.y}`; });
}

/* labels and sticky headers in screen space */
let raf = 0;
function schedule(){ if (!raf) raf = requestAnimationFrame(()=>{ raf=0; drawLabels(); }); }
function drawLabels(){
  if (!S.layoutReady || !gLabels) return;
  const k = T.k, inView = (x,y,r)=>{ const [sx,sy]=T.apply([x,y]); return sx+r*k>-40 && sx-r*k<vw+40 && sy+r*k>-40 && sy-r*k<vh+40; };
  const labels = [];
  if (k > 0.55){
    S.cells.forEach(c=>{
      const x = c.col*CELL+22, y = c.row*CELL+30;
      if (!inView(x+CELL/2,y+CELL/2,CELL)) return;
      if (T.applyY(y) < TOPBAND + 10) return;
      labels.push({id:"cell:"+c.stage+c.topic, x, y, t:`${stageLabel[c.stage]} · ${c.topic}`, cls:"cell", anchor:"start"});
    });
  }
  const vis = S.visible;
  S.classes.forEach(c=>{
    if (!c.r) return;
    const sr = c.r*k;
    if (sr < 26 || !inView(c.x,c.y,c.r)) return;
    if (vis && !c.props.some(p=>vis.has(p.id))) return;
    const big = sr > 90;
    labels.push({id:"cl:"+c.key, x:c.x, y: big ? c.y - c.r + 14/k : c.y, t:c.name, cls: big ? "clsbig" : "cls", anchor:"middle", c});
  });
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

  const hdr = [];
  STAGES.forEach((s,i)=>{
    const x0 = T.applyX(i*CELL), x1 = T.applyX((i+1)*CELL);
    if (x1 <= 0 || x0 >= vw) return;
    const avail = Math.max(24, Math.min(x1, vw) - Math.max(x0, 0) - 14);
    const f = fitHeader(s.label, s.short, avail);
    hdr.push({id:"s"+i, kind:"col", x:Math.max(8, Math.min((x0+x1)/2, vw-8)), y:16, t:f.t, size:f.size, w:x1-x0, i});
  });
  const gridLeft = T.applyX(0);
  TOPICS.forEach((t,i)=>{
    const y0 = T.applyY(i*CELL), y1 = T.applyY((i+1)*CELL);
    if (y1 <= 34 || y0 >= vh) return;
    const h = y1 - y0;
    const size = Math.max(9, Math.min(12, Math.round(h / 4.5)));
    const txt = clip(t, 30);
    const tw = measure(txt, size, 600);
    const x = Math.max(10, Math.min(gridLeft - tw - 16, vw - tw - 10));
    hdr.push({id:"t"+i, kind:"row", x, y:Math.max(46, Math.min((y0+y1)/2, vh-10)), t, h, i, size, txt, tw});
  });
  gHdr.selectAll("rect.hdr-band").data([0]).join("rect").attr("class","hdr-band").attr("x",0).attr("y",0).attr("width",vw).attr("height",32);
  const ROWMIN = 26;
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
const measure = (() => {
  const ctx = document.createElement("canvas").getContext("2d");
  return (t, size, weight) => { ctx.font = `${weight} ${size}px "Public Sans", system-ui, sans-serif`; return ctx.measureText(t).width; };
})();
function clipToWidth(t, maxW, size, weight){
  if (measure(t, size, weight) <= maxW) return t;
  let s = t;
  while (s.length > 1 && measure(s + "…", size, weight) > maxW) s = s.slice(0, -1);
  return s + "…";
}
function fitHeader(full, short, maxW){
  for (let size = 13; size >= 11; size--) if (measure(full, size, 700) <= maxW) return {t: full, size};
  for (let size = 13; size >= 9; size--) if (measure(short, size, 700) <= maxW) return {t: short, size};
  return {t: clipToWidth(short, maxW, 9, 700), size: 9};
}
function resize(){ const r = svg.node().getBoundingClientRect(); vw = r.width; vh = r.height; schedule(); }
const TOPBAND = 36, BOTBAND = 30;
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
function zoomToPair(a, b){
  const x0 = Math.min(a.x,b.x), x1 = Math.max(a.x,b.x), y0 = Math.min(a.y,b.y), y1 = Math.max(a.y,b.y);
  zoomTo((x0+x1)/2, (y0+y1)/2, Math.max(x1-x0, y1-y0)/2 + 40, 1.15);
}

/* ---------- selection + panel ---------- */
const panel = document.getElementById("panel");
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function stBadge(s){ return `<span class="st st-${s}">${STATUS_LABEL[s]}</span>`; }
function stdBadge(src){ return `<span class="badge ${src==="CEDS"?"b-ceds":"b-ctdl"}">${SRC_LABEL[src]}</span>`; }
function hop(rel, conf, hub){ return `<span class="hop h-${hub==="CEDS"?"ceds":"ctdl"}" title="${esc(hub)} hop: ${esc(REL_SHORT[rel]||rel)} match, confidence ${(+conf).toFixed(2)}">${hub} ${REL_SHORT[rel]||rel} ${(+conf).toFixed(2)}</span>`; }
function other(p){ return p.std==="CEDS" ? "CTDL" : "CEDS"; }

function clearSel(){ setHash(); S.sel=null; restyle(); highlightRow(); panel.innerHTML = panel.dataset.empty; }
function selectClass(c, zoomIn){
  S.sel = {kind:"class", c}; restyle(); highlightRow();
  if (zoomIn && c.r) zoomTo(c.x, c.y, c.r);
  const n = c.props.length, cnt = st=>c.props.filter(p=>p.st===st).length;
  const sh = cnt("shared") + cnt("declared"), us = cnt("used"), un = cnt("unused");
  const desc = c.shared ? "CTDL properties attached to ten or more classes (credential, assessment and learning-opportunity types), gathered here so each appears once on the map."
    : c.pseudo ? "Properties with no host class in the graph."
    : c.desc ? `${esc(c.desc)} <span class="meta">(${esc(c.std==="CEDS" ? c.cedsId : c.uri)})</span>` : '<span class="empty">No definition in the graph.</span>';
  panel.innerHTML = `
    <div>${stdBadge(c.src)} ${c.shared?'<span class="badge b-ctdl">grouped</span>':''} ${c.src!=="CEDS" && c.src!=="CTDL" ? '<span class="badge b-muted">not a hub module</span>':""}</div>
    <h2>${esc(c.name)}</h2>
    <div class="meta">${stageLabel[c.stage]} · ${esc(c.topic)}${c.parent?` · subclass of ${esc(c.parent)}`:""}</div>
    <p class="desc">${desc}</p>
    <div class="counts">
      <div><b style="color:var(--overlap)">${sh}</b>shared with ${other(c)}</div>
      <div><b style="color:${c.std==="CEDS"?"var(--ceds)":"var(--ctdl-ink)"}">${us}</b>spokes, this hub only</div>
      <div><b>${un}</b>unused by spokes</div>
    </div>
    ${c.std!=="CEDS" && c.np && c.np!==n ? `<p class="meta">Attached to ${c.np} properties in the graph; ${n} are drawn here and the rest under their first host or the shared group.</p>`:""}
    <div class="sec">Properties</div>
    <ul class="plist">${c.props.map((p,i)=>`<li><button data-i="${i}"><span class="sw" style="background:${dotColor(p)}"></span><span>${esc(p.name)}${p.livePairs.length?`<br><small>↔ ${esc(p.livePairs.slice(0,2).map(pr=>(p.std==="CEDS"?pr.t:pr.c).name).join(", "))}${p.livePairs.length>2?` +${p.livePairs.length-2}`:""}</small>`:""}</span>${stBadge(p.st)}</button></li>`).join("") || '<li class="empty" style="padding:8px 0">No properties of its own; it inherits from its parent type.</li>'}</ul>`;
  panel.querySelectorAll(".plist button").forEach(b=>b.onclick=()=>selectProp(c.props[+b.dataset.i], true));
  setHash("c", c.key);
}

function usesHtml(p){
  if (!p.uses.size) return `<p class="empty">${p.hub ? `No spoke element in EDUcore is mapped onto this ${p.hub} property.` : `${SRC_LABEL[p.src]} is forged as an ordinary standard, not part of the CTDL hub, so no spoke is mapped onto it.`}</p>`;
  const rows = [...p.uses.entries()].sort((a,b)=>b[1].n-a[1].n);
  return `<ul class="uses">${rows.map(([std,u])=>`<li><button data-spoke="${esc(std)}">${esc(S.stdLabel[std]||std)}</button><span class="n">${u.n}</span><span class="rels">${RELS.filter(r=>u[r]).map(r=>`${REL_SHORT[r]} ${u[r]}`).join(" · ")}</span></li>`).join("")}</ul>`;
}
function pairHtml(p, pr, idx){
  const o = p.std==="CEDS" ? pr.t : pr.c;
  const rows = pr.live.slice().sort((a,b)=>a.std.localeCompare(b.std)||a.en.localeCompare(b.en));
  const LIM = 8;
  return `<div class="xw">
    <div class="to">${stdBadge(o.src)} <button data-o="${idx}">${esc(o.name)}</button> <span class="meta">in ${esc(o.cls.name)}</span></div>
    <div class="why">${pr.n} spoke element${pr.n===1?"":"s"} from ${pr.ns} standard${pr.ns===1?"":"s"} land on both${pr.bothExact?` · ${pr.bothExact} exact on both hops`:""}</div>
    <details><summary>Show the elements</summary><ul class="ev">${rows.slice(0,LIM).map(b=>`<li><b>${esc(S.stdLabel[b.std]||b.std)}</b> ${esc(b.ep||b.en)}<br>${hop(b.ra,b.ca,"CEDS")} ${hop(b.rb,b.cb,"CTDL")}${b.tdom?` <span class="meta">CTDL card on ${esc(b.tdom)}</span>`:""}</li>`).join("")}${rows.length>LIM?`<li class="meta">+${rows.length-LIM} more (see the Shared pairs table)</li>`:""}</ul></details>
  </div>`;
}
function declaredHtml(p){
  if (!p.declared.length) return "";
  const groups = d3.group(p.declared, d=>p.std==="CEDS" ? d.cset : d.tscheme);
  return `<div class="sec">Published by Credential Engine</div>
    <p class="meta">CTDL's own correspondence statements to CEDS terms, carried verbatim. They are statements, not EDUcore judgments, and are the only direct CEDS–CTDL links in the graph.</p>
    ${[...groups].map(([g, list])=>`<div class="xw"><div class="to">${esc(g)}</div><ul class="ev">${list.map(d=>`<li>${esc(d.tname)} <span class="pred">${esc(d.pred)}</span> ${esc(d.cname)}${d.crole==="DmeOptionSet"?" <span class=\"meta\">(code set)</span>":""}</li>`).join("")}</ul>
      <div class="why">${p.std==="CEDS" ? `CTDL side: ${d3.union(list.flatMap(d=>d.tp.map(x=>x.name))).size ? [...d3.union(list.flatMap(d=>d.tp.map(x=>x.name)))].map(esc).join(", ") : esc(list[0].tscheme)}` : `CEDS side: ${[...d3.union(list.flatMap(d=>d.cp.map(x=>x.path)))].map(esc).join("; ")}`}</div></div>`).join("")}`;
}
function selectProp(p, zoomIn){
  S.sel = {kind:"prop", p}; restyle(); highlightRow();
  if (zoomIn && p.r) zoomTo(p.x, p.y, Math.max(p.r*6, 6), 1);
  const hidden = (p.pairs||[]).filter(pr=>!pr.ok && pr.rows.length).length;
  const ident = p.std==="CEDS" ? (p.cedsId ? "CEDS "+p.cedsId : "") : (p.uri||"");
  panel.innerHTML = `
    <div>${stdBadge(p.src)} ${stBadge(p.st)}</div>
    <h2>${esc(p.name)}</h2>
    <div class="meta">In <button class="btn" id="toCls" style="padding:1px 7px">${esc(p.cls.name)}</button> · ${stageLabel[p.cls.stage]} · ${esc(p.cls.topic)}${p.nc?` · on ${p.nc} classes`:""}</div>
    <p class="desc">${p.desc ? esc(p.desc) + (p.dtype?` <span class="meta">(${esc(p.dtype)})</span>`:"") : '<span class="empty">No definition in the graph.</span>'}</p>
    ${declaredHtml(p)}
    <div class="sec">Shared ground with ${other(p)}</div>
    ${p.livePairs.length ? `<p class="meta">Each pair is co-coverage: one spoke element was judged onto a card in each hub. Both hops are shown separately; they are not combined into a ${p.std==="CEDS"?"CEDS→CTDL":"CTDL→CEDS"} mapping.</p>` + p.livePairs.map((pr,i)=>pairHtml(p, pr, i)).join("")
      : `<p class="empty">${p.useN ? `No spoke element mapped here also lands on ${other(p)} under the current evidence settings.` : `Nothing to compare: no spoke uses this property.`}</p>`}
    ${hidden ? `<p class="meta">${hidden} more pair${hidden===1?"":"s"} hidden by the evidence settings.</p>`:""}
    <div class="sec">Spoke standards mapped here</div>
    ${usesHtml(p)}
    <p class="meta" style="margin-top:12px">${ident?esc(ident)+" · ":""}<code>${esc(p.path)}</code></p>`;
  document.getElementById("toCls").onclick = ()=>selectClass(p.cls, true);
  panel.querySelectorAll("button[data-o]").forEach(b=>b.onclick=()=>{ const pr = p.livePairs[+b.dataset.o]; selectProp(p.std==="CEDS"?pr.t:pr.c, true); });
  panel.querySelectorAll("button[data-spoke]").forEach(b=>b.onclick=()=>setSpoke(b.dataset.spoke));
  setHash("p", p.id);
}
function selectPair(pr){
  S.sel = {kind:"pair", pr}; restyle(); highlightRow();
  if (pr.c.r && pr.t.r) zoomToPair(pr.c, pr.t);
  panel.innerHTML = `
    <div>${stBadge("shared")}</div>
    <h2>${esc(pr.c.name)} <span class="vs">↔</span> ${esc(pr.t.name)}</h2>
    <div class="meta">CEDS <button class="btn" data-go="c">${esc(pr.c.path)}</button> · CTDL <button class="btn" data-go="t">${esc(pr.t.uri)}</button></div>
    <p class="meta">Co-coverage, not a mapping: ${pr.n} element${pr.n===1?"":"s"} from ${pr.ns} spoke standard${pr.ns===1?"":"s"} were judged onto both. Read each row's two hops on their own.</p>
    <ul class="ev">${pr.live.slice().sort((a,b)=>a.std.localeCompare(b.std)).map(b=>`<li><b>${esc(S.stdLabel[b.std]||b.std)}</b> ${esc(b.ep||b.en)}<br>${hop(b.ra,b.ca,"CEDS")} ${hop(b.rb,b.cb,"CTDL")}</li>`).join("")}</ul>`;
  panel.querySelectorAll("button[data-go]").forEach(b=>b.onclick=()=>selectProp(b.dataset.go==="c"?pr.c:pr.t, true));
}

/* ---------- deep links ---------- */
function hashParams(){ return new URLSearchParams(location.hash.slice(1)); }
function writeHash(h){ history.replaceState(null, "", "#"+h.toString()); }
function setHash(k, v){ const h = hashParams(); h.delete("c"); h.delete("p"); if (v) h.set(k, v); writeHash(h); }
function setHashParam(k, v){ const h = hashParams(); v ? h.set(k, v) : h.delete(k); writeHash(h); }
function restoreHash(){
  const h = hashParams();
  if (h.get("q")){ S.filters.q = h.get("q"); document.getElementById("q").value = S.filters.q; }
  if (h.get("rel")) S.ev.rel = h.get("rel");
  if (h.get("t")) S.ev.thr = +h.get("t") || 0;
  if (h.get("m")) S.ev.minStd = +h.get("m") || 1;
  if (h.get("s")) S.filters.spoke = h.get("s");
  syncEvidenceControls(); recompute(); refresh();
  const pid = h.get("p"), cid = h.get("c");
  if (pid && S.byId.get(pid)) selectProp(S.byId.get(pid), true);
  else if (cid && S.classes.get(cid)) selectClass(S.classes.get(cid), true);
}

/* ---------- finder (tabs, filters, table) ---------- */
const COLS = {
  props: [["hub","Hub"],["cls","Class"],["name","Property"],["stage","Stage"],["topic","Topic"],["status","Status"],["counter","Counterpart in the other hub"],["ns","Stds",1],["uses","Spoke elts",1]],
  pairs: [["cname","CEDS property"],["tname","CTDL property"],["n","Elements",1],["ns","Standards",1],["bothExact","Exact both",1],["stds","Spoke standards"]],
  decl:  [["tscheme","CTDL scheme"],["tname","CTDL term"],["pred","Statement"],["cname","CEDS term"],["cset","CEDS code set"],["cprop","CEDS property"]],
};
function rowsProps(){
  return S.props.map(p=>{
    const top = p.livePairs[0];
    const o = top ? (p.std==="CEDS" ? top.t : top.c) : null;
    const decl = p.declared[0];
    return {o:p, hub:SRC_LABEL[p.src], src:p.src, family:p.std, cls:p.cls.name, name:p.name, stage:stageLabel[p.cls.stage], stageId:p.cls.stage, topic:p.cls.topic,
      status:p.st, counter: o ? o.name + (p.livePairs.length>1?` +${p.livePairs.length-1}`:"") : decl ? (p.std==="CEDS" ? decl.tscheme : decl.cset) : "",
      ns: top ? top.ns : null, uses: p.useN || null, spokes:[...p.uses.keys()]};
  });
}
function rowsPairs(){
  return S.pairs.filter(pr=>pr.ok).map(pr=>({o:pr, cname:pr.c.path, tname:`${pr.t.name} (${pr.t.uri})`, n:pr.n, ns:pr.ns, bothExact:pr.bothExact,
    stds:[...pr.stds].map(s=>S.stdLabel[s]||s).sort().join(", "), spokes:[...pr.stds],
    stageId:pr.c.cls.stage, topic:pr.c.cls.topic, stageId2:pr.t.cls.stage, topic2:pr.t.cls.topic}));
}
function rowsDecl(){
  return S.declared.map(d=>({o:d, tscheme:d.tscheme, tname:d.tname, pred:d.pred, cname:d.cname, cset:d.cset, cprop:d.cp.map(p=>p.path).join("; "),
    stageId:d.cp[0]?.cls.stage, topic:d.cp[0]?.cls.topic}));
}
function filtered(rows){
  const f = S.filters, terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tab = S.tab;
  return rows.filter(r=>{
    if (tab==="props"){
      if (f.hub){ if (f.hub.startsWith("CTDL:")){ if (r.src!==f.hub.slice(5)) return false; } else if (r.family!==f.hub) return false; }
      if (f.status && r.status!==f.status) return false;
    }
    if (f.stage && r.stageId!==f.stage && r.stageId2!==f.stage) return false;
    if (f.topic && r.topic!==f.topic && r.topic2!==f.topic) return false;
    if (f.spoke && tab!=="decl" && !r.spokes.includes(f.spoke)) return false;
    if (terms.length){
      const hay = COLS[tab].map(([k])=>r[k]).join(" ").toLowerCase();
      if (!terms.every(t=>hay.includes(t))) return false;
    }
    return true;
  });
}
const thead = document.getElementById("thead"), tbody = document.getElementById("tbody");
function cellHtml(r, k){
  const v = r[k];
  if (k==="hub") return stdBadge(r.src);
  if (k==="status") return stBadge(v);
  if (k==="pred") return `<span class="pred">${esc(v)}</span>`;
  return esc(v==null?"":v);
}
function renderTable(){
  const tab = S.tab, cols = COLS[tab];
  const all = tab==="props" ? rowsProps() : tab==="pairs" ? rowsPairs() : rowsDecl();
  const list = filtered(all);
  const {k, dir} = S.sort[tab];
  list.sort((a,b)=>{
    let x = a[k], y = b[k];
    if (k==="status"){ x = STATUS_ORDER[x]; y = STATUS_ORDER[y]; }
    if (x==null) x = -1; if (y==null) y = -1;
    if (x<y) return -dir; if (x>y) return dir;
    return String(a[cols[1][0]]).localeCompare(String(b[cols[1][0]]));
  });
  thead.innerHTML = `<tr>${cols.map(([ck,label,num])=>`<th data-k="${ck}" class="${num?"num":""}" aria-sort="${ck===k?(dir>0?"ascending":"descending"):"none"}">${label}</th>`).join("")}</tr>`;
  thead.querySelectorAll("th").forEach(th=>th.onclick=()=>{
    const ck = th.dataset.k, cur = S.sort[tab], num = cols.find(c=>c[0]===ck)[2];
    S.sort[tab] = {k:ck, dir: cur.k===ck ? -cur.dir : (num?-1:1)}; renderTable();
  });
  const LIM = 500;
  tbody.innerHTML = list.slice(0, LIM).map((r,i)=>`<tr data-i="${i}">${cols.map(([ck,,num])=>`<td class="${num?"num":""}">${cellHtml(r,ck)}</td>`).join("")}</tr>`).join("")
    || `<tr><td colspan="${cols.length}" class="empty" style="padding:16px">Nothing matches. Clear a filter, loosen the evidence settings, or broaden the search.</td></tr>`;
  S.shown = list;
  const noun = tab==="props" ? "propert" : tab==="pairs" ? "pair" : "statement";
  const plural = (n)=> tab==="props" ? (n===1?"property":"properties") : noun+(n===1?"":"s");
  document.getElementById("count").textContent = list.length > LIM ? `Showing ${LIM} of ${list.length.toLocaleString()} — narrow the search to see the rest` : `${list.length.toLocaleString()} ${plural(list.length)}`;
  // Map dimming follows whatever the table is showing.
  const f = S.filters, active = f.q || f.hub || f.status || f.stage || f.topic || f.spoke || tab!=="props";
  if (active){
    const set = new Set();
    list.forEach(r=>{
      if (tab==="props") set.add(r.o.id);
      else if (tab==="pairs"){ set.add(r.o.c.id); set.add(r.o.t.id); }
      else { r.o.cp.forEach(p=>set.add(p.id)); r.o.tp.forEach(p=>set.add(p.id)); }
    });
    S.visible = set;
  } else S.visible = null;
  highlightRow();
  restyle();
}
function highlightRow(){
  tbody.querySelectorAll("tr[data-i]").forEach(tr=>{
    const r = S.shown && S.shown[+tr.dataset.i]; if (!r) return;
    const s = S.sel;
    const on = s && ((s.kind==="prop" && (r.o===s.p || (r.o.c===s.p) || (r.o.t===s.p))) || (s.kind==="pair" && r.o===s.pr));
    tr.classList.toggle("sel", !!on);
  });
}
tbody.addEventListener("click", ev=>{
  const tr = ev.target.closest("tr[data-i]"); if (!tr) return;
  const r = S.shown[+tr.dataset.i]; if (!r) return;
  if (S.tab==="props") selectProp(r.o, true);
  else if (S.tab==="pairs") selectPair(r.o);
  else { const p = r.o.cp[0] || r.o.tp[0]; if (p) selectProp(p, true); }
});
document.querySelectorAll(".tabs button").forEach(b=>b.addEventListener("click", ()=>setTab(b.dataset.tab)));
function setTab(t){
  S.tab = t;
  document.querySelectorAll(".tabs button").forEach(b=>b.setAttribute("aria-selected", String(b.dataset.tab===t)));
  document.querySelectorAll("[data-only]").forEach(el=>el.hidden = el.dataset.only!==t);
  renderTable();
}
let tq = 0;
document.getElementById("q").addEventListener("input", e=>{ clearTimeout(tq); tq = setTimeout(()=>{ S.filters.q = e.target.value; setHashParam("q", e.target.value); renderTable(); }, 140); });
[["fHub","hub"],["fStatus","status"],["fStage","stage"],["fTopic","topic"],["fSpoke","spoke"]].forEach(([id,k])=>{
  document.getElementById(id).addEventListener("change", e=>{ S.filters[k] = e.target.value; if (k==="stage") markStage(); if (k==="spoke"){ setHashParam("s", e.target.value); renderSpokes(); } renderTable(); });
});
document.getElementById("reset").addEventListener("click", ()=>{
  S.filters = {q:"",hub:"",status:"",stage:"",topic:"",spoke:""};
  ["q","fHub","fStatus","fStage","fTopic","fSpoke"].forEach(id=>document.getElementById(id).value="");
  setHashParam("q",""); setHashParam("s","");
  markStage(); renderSpokes(); renderTable();
});
document.getElementById("fStage").innerHTML = `<option value="">All stages</option>` + STAGES.map(s=>`<option value="${s.id}">${s.label}</option>`).join("");
document.getElementById("fTopic").innerHTML = `<option value="">All topics</option>` + TOPICS.map(t=>`<option>${t}</option>`).join("");
function setSpoke(std){
  S.filters.spoke = S.filters.spoke===std ? "" : std;
  document.getElementById("fSpoke").value = S.filters.spoke;
  setHashParam("s", S.filters.spoke);
  renderSpokes(); renderTable();
  document.querySelector(".mapbox").scrollIntoView({behavior: reduce()?"auto":"smooth", block:"nearest"});
}

/* CSV of whatever the table shows */
document.getElementById("csv").addEventListener("click", ()=>{
  const list = S.shown || [], cols = COLS[S.tab];
  const cell = v => `"${String(v==null?"":v).replace(/"/g,'""')}"`;
  let header, body;
  if (S.tab==="pairs"){
    header = ["ceds_property","ctdl_property","ctdl_uri","spoke_standard","spoke_element","ceds_relation","ceds_confidence","ctdl_relation","ctdl_confidence","ctdl_card_domain"];
    body = list.flatMap(r=>r.o.live.map(b=>[r.o.c.path, r.o.t.name, r.o.t.uri, b.std, b.ep||b.en, b.ra, b.ca, b.rb, b.cb, b.tdom]));
  } else {
    header = cols.map(c=>c[1]);
    body = list.map(r=>cols.map(([k])=> k==="status" ? STATUS_LABEL[r[k]] : r[k]));
    if (S.tab==="props"){ header.push("path"); body.forEach((row,i)=>row.push(list[i].o.path)); }
  }
  const lines = [header.map(cell).join(",")].concat(body.map(row=>row.map(cell).join(",")));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], {type:"text/csv"}));
  const a = document.createElement("a"); a.href = url; a.download = `educore-ceds-ctdl-${S.tab}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
});

/* ---------- headline figures ---------- */
function renderFigures(){
  const hubProps = std => S.props.filter(p=>p.hub===std);
  const ceds = hubProps("CEDS"), ctdl = hubProps("CTDL");
  const used = list => list.filter(p=>p.useN).length;
  const sharedC = ceds.filter(p=>p.livePairs.length).length, sharedT = ctdl.filter(p=>p.livePairs.length).length;
  const livePairs = S.pairs.filter(pr=>pr.ok);
  const elems = new Set(), stds = new Set();
  livePairs.forEach(pr=>pr.live.forEach(b=>{ elems.add(b.std+"|"+(b.ep||b.en)); stds.add(b.std); }));
  const declVals = S.declared.length, declSchemes = new Set(S.declared.map(d=>d.tscheme)).size;
  const pct = (a,b)=> b ? Math.round(a/b*100)+"%" : "–";
  document.getElementById("figs").innerHTML = `
    <div class="fig"><b style="color:var(--declared)">${declVals}</b><span>published CTDL→CEDS statements, all on code values in ${declSchemes} CTDL scheme${declSchemes===1?"":"s"}</span></div>
    <div class="fig"><b style="color:var(--overlap)">${livePairs.length.toLocaleString()}</b><span>CEDS–CTDL property pairs with shared spoke evidence: ${elems.size.toLocaleString()} elements from ${stds.size} standards</span></div>
    <div class="fig"><b style="color:var(--ceds)">${pct(used(ceds), ceds.length)}</b><span>of ${ceds.length.toLocaleString()} CEDS properties used by a spoke; ${sharedC.toLocaleString()} share ground with CTDL</span></div>
    <div class="fig"><b style="color:var(--ctdl-ink)">${pct(used(ctdl), ctdl.length)}</b><span>of ${ctdl.length.toLocaleString()} core CTDL properties used by a spoke; ${sharedT.toLocaleString()} share ground with CEDS</span></div>`;
}

/* ---------- continuum strip ---------- */
function renderContinuum(){
  const agg = STAGES.map(s=>({s, C:{sh:0,us:0,un:0,n:0}, T:{sh:0,us:0,un:0,n:0}}));
  S.props.forEach(p=>{
    const a = agg[stageIdx[p.cls.stage]][p.std==="CEDS"?"C":"T"];
    a.n++; if (p.st==="shared"||p.st==="declared") a.sh++; else if (p.st==="used") a.us++; else a.un++;
  });
  const max = Math.max(...agg.map(a=>Math.max(a.C.n,a.T.n)), 1);
  const bar = (lab, a, use, none)=>`<span class="bar"><span>${lab}</span><span class="track"><i style="width:${a.sh/max*100}%;background:var(--overlap)"></i><i style="width:${a.us/max*100}%;background:${use}"></i><i style="width:${a.un/max*100}%;background:${none}"></i></span><span class="n">${a.n}</span></span>`;
  const nav = document.getElementById("continuum");
  nav.innerHTML = agg.map((a,i)=>`<button class="stage ${a.s.id==="all"?"all":""}" data-s="${a.s.id}" aria-pressed="${S.filters.stage===a.s.id}"
      title="${a.s.label}: CEDS ${a.C.sh} shared / ${a.C.us} spokes only / ${a.C.un} unused · CTDL ${a.T.sh} / ${a.T.us} / ${a.T.un}">
      <span class="nm">${a.s.label}${i<5?' <span class="arrow">→</span>':""}</span>
      <span class="bars">${bar("CEDS", a.C, "var(--ceds-use)", "var(--ceds-none)")}${bar("CTDL", a.T, "var(--ctdl-use)", "var(--ctdl-none)")}</span></button>`).join("");
  nav.querySelectorAll(".stage").forEach(b=>b.onclick=()=>{
    const id = b.dataset.s, same = S.filters.stage===id;
    S.filters.stage = same ? "" : id; document.getElementById("fStage").value = S.filters.stage;
    markStage(); renderTable();
    if (!same){ const i = stageIdx[id]; zoomTo(i*CELL+CELL/2, H/2, Math.max(CELL/2, H/2), 1.02); } else fit(true);
  });
}
function markStage(){ document.querySelectorAll("#continuum .stage").forEach(b=>b.setAttribute("aria-pressed", String(S.filters.stage===b.dataset.s))); }

/* ---------- spoke standards ---------- */
function renderSpokes(){
  const el = document.getElementById("spokes");
  const list = S.spokes.slice().sort((a,b)=>(b.toCeds+b.toCtdl-b.toBoth)/b.total - (a.toCeds+a.toCtdl-a.toBoth)/a.total);
  el.innerHTML = list.map(s=>{
    const onlyC = s.toCeds - s.toBoth, onlyT = s.toCtdl - s.toBoth, none = s.total - onlyC - onlyT - s.toBoth;
    const w = n => (n/s.total*100).toFixed(2)+"%";
    return `<button class="spoke" data-std="${esc(s.std)}" aria-pressed="${S.filters.spoke===s.std}" title="${esc(s.title)} ${esc(s.version)}: ${s.total} elements · ${onlyC} CEDS only · ${s.toBoth} both · ${onlyT} CTDL only · ${none} neither">
      <span class="sn">${esc(S.stdLabel[s.std])}</span>
      <span class="sbar"><i style="width:${w(onlyC)};background:var(--ceds-use)"></i><i style="width:${w(s.toBoth)};background:var(--overlap)"></i><i style="width:${w(onlyT)};background:var(--ctdl-use)"></i></span>
      <span class="sv">${s.toCeds.toLocaleString()} <small>CEDS</small> · ${s.toCtdl.toLocaleString()} <small>CTDL</small> · ${s.toBoth.toLocaleString()} <small>both</small> <small>of ${s.total.toLocaleString()}</small></span>
    </button>`;
  }).join("");
  el.querySelectorAll(".spoke").forEach(b=>b.onclick=()=>setSpoke(b.dataset.std));
  const sel = document.getElementById("fSpoke");
  if (sel.options.length <= 1) sel.innerHTML = `<option value="">Any spoke standard</option>` + S.spokes.slice().sort((a,b)=>S.stdLabel[a.std].localeCompare(S.stdLabel[b.std])).map(s=>`<option value="${esc(s.std)}">${esc(S.stdLabel[s.std])}</option>`).join("");
  sel.value = S.filters.spoke;
}

/* ---------- evidence controls ---------- */
const relSel = document.getElementById("evRel"), thr = document.getElementById("thr"), thrOut = document.getElementById("thrOut"), minSel = document.getElementById("evMin");
function syncEvidenceControls(){
  relSel.value = S.ev.rel; thr.value = S.ev.thr; minSel.value = String(S.ev.minStd);
  thrOut.textContent = S.ev.thr===0 ? "any" : S.ev.thr.toFixed(2);
}
function onEvidence(){
  S.ev = {rel:relSel.value, thr:+thr.value, minStd:+minSel.value};
  thrOut.textContent = S.ev.thr===0 ? "any" : S.ev.thr.toFixed(2);
  setHashParam("rel", S.ev.rel==="ec" ? "" : S.ev.rel); setHashParam("t", S.ev.thr ? String(S.ev.thr) : ""); setHashParam("m", S.ev.minStd>1 ? String(S.ev.minStd) : "");
  recompute(); refresh();
  if (S.sel){ S.sel.kind==="class" ? selectClass(S.sel.c,false) : S.sel.kind==="prop" ? selectProp(S.sel.p,false) : (S.sel.pr.ok ? selectPair(S.sel.pr) : clearSel()); }
}
relSel.addEventListener("change", onEvidence); minSel.addEventListener("change", onEvidence);
thr.addEventListener("input", onEvidence);
function refresh(){ renderFigures(); renderContinuum(); renderSpokes(); renderTable(); }

/* zoom buttons */
document.getElementById("zin").onclick = ()=>svg.transition().duration(reduce()?0:250).call(zoom.scaleBy, 1.8);
document.getElementById("zout").onclick = ()=>svg.transition().duration(reduce()?0:250).call(zoom.scaleBy, 1/1.8);
document.getElementById("zfit").onclick = ()=>fit(true);
new ResizeObserver(()=>{ if (S.layoutReady){ resize(); } }).observe(document.querySelector(".mapbox"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>schedule());

/* ---------- boot ---------- */
panel.dataset.empty = panel.innerHTML;
(async function boot(){
  try {
    prog(.2);
    const res = await fetch(DATA_URL, {cache:"no-cache"});
    if (!res.ok) throw new Error("HTTP "+res.status);
    const D = await res.json(); prog(.8);
    if (!D.bridges) throw new Error("this snapshot predates the two-hub export; run npm run export");
    build(D);
    const ver = D.versions || {};
    const when = D.generatedAt ? new Date(D.generatedAt).toLocaleString([], {dateStyle:"medium", timeStyle:"short"}) : "unknown";
    document.getElementById("stamp").innerHTML =
      `CEDS <b>${esc(ver.CEDS||"?")}</b> · CTDL <b>${esc(ver.CTDL||"?")}</b><br>ASN ${esc(ver.CTDLASN||"?")} · QData ${esc(ver.CTDLQData||"?")}<br>Graph snapshot ${esc(when)}`;
    layout(); ov.remove(); render(); setTab("props"); restoreHash();
  } catch(e){
    fatal("The graph snapshot didn't load", "This site reads data/atlas.json, built from EDUcore at deploy time. Run `npm run export` and rebuild. ("+(e.message||e)+")");
  }
})();
})();
