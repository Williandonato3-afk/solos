
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,5);
let db={props:[],pastos:[],analises:[]};
try{db=Object.assign(db,JSON.parse(localStorage.getItem('sa_db')||'{}'))}catch(e){}
const save=()=>{try{localStorage.setItem('sa_db',JSON.stringify(db))}catch(e){toast('Não foi possível salvar neste navegador',1)}};
function toast(m,e){const t=$('#toast');t.textContent=m;t.className=e?'e':'';t.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>t.style.display='none',3000)}
const fd=d=>d?d.split('-').reverse().join('/'):'—',PR=id=>db.props.find(x=>x.id==id)||{},PA=id=>db.pastos.find(x=>x.id==id)||{};
const CAPINS=['Brachiaria brizantha (Marandu)','Brachiaria decumbens','Brachiaria humidicola','Panicum maximum (Mombaça)','Panicum maximum (Tanzânia)','Cynodon (Tifton / Coastcross)','Outro'];
const N=(k,l,u,x={})=>({k,l:l+(u?' ('+u+')':''),t:'number',...x});
const SCH={
props:[{g:'Dados da propriedade',f:[{k:'nome',l:'Nome da propriedade',r:1},{k:'produtor',l:'Nome do produtor',r:1},{k:'local',l:'Localização (município/UF)',r:1},N('area','Área total','ha',{r:1,min:.01}),{k:'obs',l:'Observações',t:'textarea',w:1}]}],
pastos:[{g:'Dados da pastagem',f:[{k:'nome',l:'Nome / identificação da área',r:1},{k:'prop',l:'Propriedade',t:'select',r:1,o:()=>db.props.map(p=>[p.id,p.nome])},N('area','Área','ha',{r:1,min:.01}),{k:'capim',l:'Tipo de capim',t:'select',r:1,o:()=>CAPINS},{k:'data',l:'Data de implantação',t:'date'},{k:'obs',l:'Observações',t:'textarea',w:1}]}],
analises:[
{g:'Identificação',f:[{k:'prop',l:'Propriedade',t:'select',r:1,dep:1,o:()=>db.props.map(p=>[p.id,p.nome])},{k:'pasto',l:'Pastagem / talhão',t:'select',r:1,o:v=>db.pastos.filter(p=>p.prop==v.prop).map(p=>[p.id,p.nome])},{k:'amostra',l:'Identificação da amostra',r:1},{k:'data',l:'Data da coleta',t:'date',r:1},{k:'prof',l:'Profundidade',t:'select',o:()=>['0–10 cm','0–20 cm','20–40 cm','Outra']}]},
{g:'Acidez e matéria orgânica',f:[N('ph','pH em água','',{r:1,max:14}),N('mo','Matéria orgânica','dag/kg'),N('al','Alumínio (Al)','cmolc/dm³',{r:1}),N('hal','H+Al','cmolc/dm³',{r:1})]},
{g:'Macronutrientes',f:[N('p','Fósforo (P)','mg/dm³',{r:1}),N('k','Potássio (K)','mg/dm³',{r:1}),N('ca','Cálcio (Ca)','cmolc/dm³',{r:1}),N('mg','Magnésio (Mg)','cmolc/dm³',{r:1})]},
{g:'Complexo de troca (deixe em branco para calcular)',f:[N('sb','Soma de bases','cmolc/dm³'),N('ctc','CTC (pH 7)','cmolc/dm³'),N('v','Saturação por bases V','%',{max:100})]},
{g:'Textura (opcional, necessária para classificar o P)',f:[N('argila','Argila','%',{max:100})]}]};
const KEYS=[['ph','pH (H₂O)',''],['mo','Matéria orgânica','dag/kg'],['p','Fósforo (P)','mg/dm³'],['k','Potássio (K)','mg/dm³'],['ca','Cálcio (Ca)','cmolc/dm³'],['mg','Magnésio (Mg)','cmolc/dm³'],['al','Alumínio (Al)','cmolc/dm³'],['hal','H+Al','cmolc/dm³'],['sb','Soma de bases','cmolc/dm³'],['ctc','CTC (pH 7)','cmolc/dm³'],['v','Saturação por bases (V)','%']];
/* Faixas de referência: Comissão de Fertilidade do Solo de MG (5ª Aproximação, 1999) – classes agrupadas em baixo/médio/adequado/alto; pH: faixa geral. */
const RULES={ph:[[4.99,'baixo','bad'],[5.49,'médio','warn'],[6.5,'adequado','ok'],[99,'alto','warn']],mo:[[2,'baixo','warn'],[4,'médio','warn'],[7,'adequado','ok'],[99,'alto','ok']],k:[[40,'baixo','bad'],[70,'médio','warn'],[120,'adequado','ok'],[1e9,'alto','ok']],ca:[[1.2,'baixo','bad'],[2.4,'médio','warn'],[4,'adequado','ok'],[99,'alto','ok']],mg:[[.45,'baixo','bad'],[.9,'médio','warn'],[1.5,'adequado','ok'],[99,'alto','ok']],al:[[.5,'baixo','ok'],[1,'médio','warn'],[99,'alto','bad']],sb:[[1.8,'baixo','bad'],[3.6,'médio','warn'],[6,'adequado','ok'],[99,'alto','ok']],ctc:[[4.3,'baixo','warn'],[8.6,'médio','ok'],[15,'adequado','ok'],[99,'alto','ok']],v:[[40,'baixo','bad'],[60,'médio','warn'],[80,'adequado','ok'],[100,'alto','warn']]};
const NT={'ph|baixo':'Solo ácido: limita o crescimento radicular e a disponibilidade de nutrientes.','ph|alto':'Acima da faixa de referência: possível excesso de calagem e menor disponibilidade de micronutrientes.','p|baixo':'Possível deficiência de fósforo, essencial ao perfilhamento e ao estabelecimento do capim.','p|alto':'Teor elevado: possível excesso, sem necessidade de reforço no curto prazo.','k|baixo':'Possível deficiência de potássio, com risco à persistência da pastagem.','k|alto':'Teor elevado: possível excesso, evitar adubação potássica desnecessária.','ca|baixo':'Possível deficiência de cálcio.','ca|alto':'Teor elevado de cálcio (possível excesso).','mg|baixo':'Possível deficiência de magnésio.','mg|alto':'Teor elevado de magnésio (possível excesso); observar a relação com K e Ca.','al|médio':'Alumínio em nível intermediário; acompanhar.','al|alto':'Alumínio em nível tóxico, prejudica o desenvolvimento radicular.','v|baixo':'Baixa saturação por bases: indica acidez e necessidade de avaliar a calagem.','v|alto':'Saturação elevada: evitar calagem adicional.','mo|baixo':'Baixa matéria orgânica: menor retenção de nutrientes e água.','ctc|baixo':'CTC baixa: menor capacidade de reter nutrientes, com risco de perdas por lixiviação.','sb|baixo':'Baixa soma de bases.'};
function calc(a){const n=k=>a[k]===''||a[k]==null?null:+a[k];const ca=n('ca'),mg=n('mg'),k=n('k'),h=n('hal');
if(a.sb===''&&ca!=null&&mg!=null&&k!=null)a.sb=String(+(ca+mg+k/391).toFixed(2));
if(a.ctc===''&&n('sb')!=null&&h!=null)a.ctc=String(+(n('sb')+h).toFixed(2));
if(a.v===''&&n('sb')!=null&&n('ctc'))a.v=String(+(100*n('sb')/n('ctc')).toFixed(1))}
function interp(a){const n=k=>a[k]===''||a[k]==null?null:+a[k];const items=[];
const ar=n('argila');let pr=null;if(ar!=null){const t=ar<15?[20,30,45]:ar<=35?[12,20,30]:ar<=60?[8,12,18]:[5.4,8,12];pr=[[t[0],'baixo','bad'],[t[1],'médio','warn'],[t[2],'adequado','ok'],[1e9,'alto','ok']]}
KEYS.forEach(([k,nome,u])=>{const v=n(k);let c='sem classificação',s='na',r=k=='p'?pr:RULES[k];
if(v==null){c='sem dados'}else if(r){const x=r.find(x=>v<=x[0]);if(x){c=x[1];s=x[2]}}else if(k=='p')c='informe a argila';
items.push({k,nome,u,v,c,s,note:NT[k+'|'+c]||''})});return items}
function overall(it){const ev=it.filter(x=>x.s!='na'),b=ev.filter(x=>x.s=='bad').length,w=ev.filter(x=>x.s=='warn').length;
if(ev.length<4)return['na','Dados insuficientes','Preencha mais parâmetros para uma avaliação geral. Necessária avaliação agronômica.'];
if(b==0&&w<=1)return['ok','Condição geral favorável','Os parâmetros avaliados estão predominantemente adequados.'];
if(b>=3)return['bad','Fertilidade limitada','Vários parâmetros em nível baixo ou crítico: correção necessária.'];
return['warn','Condição intermediária','Há parâmetros que merecem atenção e correção.']}
function recs(it){const g=k=>it.find(x=>x.k==k).c,r=[];
if(g('ph')=='baixo'||g('al')=='alto'||g('v')=='baixo')r.push('Acidez elevada ou saturação por bases baixa: indica-se avaliar a calagem. A dose deve ser calculada por profissional, conforme método e recomendação regional para a forrageira, considerando PRNT do calcário e profundidade de incorporação.');
if(g('ca')=='baixo'||g('mg')=='baixo')r.push('Ca e/ou Mg baixos: a escolha da fonte de calcário (calcítico, magnesiano ou dolomítico) deve ser definida por agrônomo.');
if(g('p')=='baixo')r.push('P baixo: pastagens costumam responder à adubação fosfatada, sobretudo na formação e reforma. A dose depende de argila, espécie e sistema de manejo: necessária avaliação agronômica.');
if(g('p')=='informe a argila')r.push('Informe o teor de argila para classificar o fósforo.');
if(g('k')=='baixo')r.push('K baixo: avaliar adubação potássica, em geral parcelada para reduzir perdas. Dose a definir por agrônomo.');
if(g('mo')=='baixo')r.push('Matéria orgânica baixa: priorizar manejo do pastejo (lotação adequada, altura de entrada e saída) para manter cobertura e evitar degradação.');
if(g('v')=='alto'||g('ph')=='alto')r.push('pH ou saturação por bases elevados: evitar calagem adicional e acompanhar micronutrientes.');
['ca','mg','k','p'].filter(k=>g(k)=='alto').length&&r.push('Há teores elevados de nutrientes: evitar adubação desnecessária e acompanhar nas próximas análises.');
it.some(x=>x.c=='sem dados')&&r.push('Há parâmetros sem dados; para eles não foi possível interpretar. Necessária avaliação agronômica.');
r.length||r.push('Sem correções prioritárias indicadas pelos parâmetros avaliados. Manter o monitoramento periódico e o manejo adequado.');
return r}
const bd=(s,t)=>`<span class="b ${s}">${esc(t)}</span>`;
function fld(f,v){const val=v[f.k]??'';let i;
if(f.t=='select'){const o=f.o(v);i=`<select name="${f.k}" ${f.dep?'onchange="dep(this)"':''}><option value="">Selecione…</option>${o.map(x=>{x=Array.isArray(x)?x:[x,x];return`<option value="${esc(x[0])}" ${x[0]==val?'selected':''}>${esc(x[1])}</option>`}).join('')}</select>`}
else if(f.t=='textarea')i=`<textarea name="${f.k}" rows="3">${esc(val)}</textarea>`;
else i=`<input name="${f.k}" type="${f.t||'text'}" ${f.t=='number'?'step="any" min="0"':''} value="${esc(val)}">`;
return`<label class="${f.w?'w':''}">${f.l}${f.r?' *':''}${i}</label>`}
function form(t,v){return`<form onsubmit="return sub(event,'${t}')" novalidate>${SCH[t].map(g=>`<fieldset><legend>${g.g}</legend><div class="fg">${g.f.map(f=>fld(f,v)).join('')}</div></fieldset>`).join('')}<div class="err"></div><div class="row"><button class="btn">💾 Salvar</button>${ed[t]?`<button type="button" class="btn s" onclick="ed.${t}=null;render()">Cancelar</button>`:''}</div></form>`}
function dep(s){const o=db.pastos.filter(p=>p.prop==s.value);s.form.pasto.innerHTML='<option value="">Selecione…</option>'+o.map(p=>`<option value="${p.id}">${esc(p.nome)}</option>`).join('')}
const ed={props:null,pastos:null,analises:null};
function sub(e,t){e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f)),er=[];
SCH[t].flatMap(g=>g.f).forEach(x=>{const v=(d[x.k]||'').trim();d[x.k]=v;if(x.r&&!v)er.push(x.l.replace(/ \(.*/,'')+': campo obrigatório');else if(x.t=='number'&&v){const n=+v;if(isNaN(n)||n<0)er.push(x.l+': informe um número maior ou igual a zero');else if(x.min&&n<x.min)er.push(x.l+': deve ser maior que zero');else if(x.max&&n>x.max)er.push(x.l+': máximo '+x.max)}});
if(er.length){f.querySelector('.err').innerHTML=er.map(esc).join('<br>');toast('Verifique os campos do formulário',1);return false}
if(t=='analises')calc(d);let id=ed[t];
if(id)Object.assign(db[t].find(x=>x.id==id),d);else{d.id=id=uid();db[t].push(d)}
save();ed[t]=null;toast(id&&!d.id?'Registro atualizado':'Registro salvo com sucesso');
if(t=='analises')location.hash='resultado-'+id;else render();return false}
function del(t,id){if(!confirm('Excluir este registro? '+(t=='props'?'As pastagens e análises vinculadas também serão excluídas.':t=='pastos'?'As análises vinculadas também serão excluídas.':'')))return;
if(t=='props'){const ps=db.pastos.filter(p=>p.prop==id).map(p=>p.id);db.pastos=db.pastos.filter(p=>p.prop!=id);db.analises=db.analises.filter(a=>a.prop!=id&&!ps.includes(a.pasto))}
if(t=='pastos')db.analises=db.analises.filter(a=>a.pasto!=id);
if(t=='analises'||1)db[t]=db[t].filter(x=>x.id!=id);save();toast('Registro excluído');render()}
const edit=(t,id)=>{ed[t]=id;if(t=='analises')location.hash='analises';else render();scrollTo(0,0)};
const act=(t,id,ver)=>`<div class="row">${ver?`<a class="btn s sm" href="#resultado-${id}">Ver</a>`:''}<button class="btn s sm" onclick="edit('${t}','${id}')">Editar</button><button class="btn d sm" onclick="del('${t}','${id}')">Excluir</button></div>`;
const tbl=(h,r)=>r.length?`<div class="tw"><table><tr>${h.map(x=>`<th>${x}</th>`).join('')}</tr>${r.map(x=>`<tr>${x.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>`:'<div class="empty">Nenhum registro cadastrado.</div>';
const main=h=>{$('#main').innerHTML=h};
const need=(t)=>`<div class="card"><div class="empty">${t}</div></div>`;
const sorted=()=>[...db.analises].sort((a,b)=>b.data.localeCompare(a.data));
const sit=a=>{const o=overall(interp(a));return bd(o[0],o[1])};
const V={};
V.inicio=()=>{const ha=db.props.reduce((s,p)=>s+(+p.area||0),0);
main(`<h1>Início</h1><div class="stats"><div class="stat"><b>${db.props.length}</b><span>Propriedades</span></div><div class="stat"><b>${db.pastos.length}</b><span>Pastagens</span></div><div class="stat"><b>${db.analises.length}</b><span>Análises realizadas</span></div><div class="stat"><b>${+ha.toFixed(1)}</b><span>Hectares cadastrados</span></div></div>
<div class="card"><h2>Acesso rápido</h2><div class="row"><a class="btn" href="#propriedades">+ Propriedade</a><a class="btn" href="#pastagens">+ Pastagem</a><a class="btn" href="#analises">🧪 Nova análise</a><a class="btn s" href="#historico">📋 Histórico</a></div></div>
<div class="card"><h2>Propriedades cadastradas</h2>${tbl(['Propriedade','Produtor','Área (ha)','Pastagens','Análises'],db.props.map(p=>{const ps=db.pastos.filter(x=>x.prop==p.id);return[esc(p.nome),esc(p.produtor),p.area,ps.length,db.analises.filter(a=>a.prop==p.id).length]}))}</div>
<div class="card"><h2>Últimas análises</h2>${tbl(['Data','Pastagem','Amostra','Situação',''],sorted().slice(0,5).map(a=>[fd(a.data),esc(PA(a.pasto).nome),esc(a.amostra),sit(a),`<a class="btn s sm" href="#resultado-${a.id}">Ver</a>`]))}</div>`)};
V.propriedades=()=>main(`<h1>Propriedades</h1><div class="card"><h2>${ed.props?'Editar':'Nova'} propriedade</h2>${form('props',db.props.find(x=>x.id==ed.props)||{})}</div><div class="card"><h2>Propriedades cadastradas (${db.props.length})</h2>${tbl(['Propriedade','Produtor','Localização','Área (ha)','Observações',''],db.props.map(p=>[esc(p.nome),esc(p.produtor),esc(p.local),p.area,esc(p.obs),act('props',p.id)]))}</div>`);
V.pastagens=()=>db.props.length?main(`<h1>Pastagens</h1><div class="card"><h2>${ed.pastos?'Editar':'Nova'} pastagem</h2>${form('pastos',db.pastos.find(x=>x.id==ed.pastos)||{})}</div><div class="card"><h2>Pastagens cadastradas (${db.pastos.length})</h2>${tbl(['Área','Propriedade','Hectares','Capim','Implantação',''],db.pastos.map(p=>[esc(p.nome),esc(PR(p.prop).nome),p.area,esc(p.capim),fd(p.data),act('pastos',p.id)]))}</div>`):main(`<h1>Pastagens</h1>${need('Cadastre uma <a href="#propriedades">propriedade</a> antes de cadastrar pastagens.')}`);
V.analises=()=>db.pastos.length?main(`<h1>Análises de solo</h1><div class="card"><h2>${ed.analises?'Editar':'Nova'} análise</h2>${form('analises',db.analises.find(x=>x.id==ed.analises)||{})}<p class="note">* obrigatório. Soma de bases, CTC e V% são calculadas automaticamente quando deixadas em branco (SB = Ca + Mg + K/391; CTC = SB + H+Al; V = SB/CTC × 100).</p></div>`):main(`<h1>Análises de solo</h1>${need('Cadastre uma <a href="#propriedades">propriedade</a> e uma <a href="#pastagens">pastagem</a> antes de inserir análises.')}`);
V.resultado=id=>{const a=db.analises.find(x=>x.id==id);if(!a)return main(`<h1>Interpretação</h1>${need('Análise não encontrada.')}`);
const it=interp(a),o=overall(it);
main(`<h1>Interpretação da análise</h1><div class="card"><div class="row" style="justify-content:space-between"><div><b>${esc(PA(a.pasto).nome)}</b> · ${esc(PR(a.prop).nome)}<br><span class="note">Amostra ${esc(a.amostra)} · coleta ${fd(a.data)} · prof. ${esc(a.prof||'não informada')} · ${esc(PA(a.pasto).capim)}</span></div><div class="row noprint"><button class="btn s sm" onclick="edit('analises','${a.id}')">Editar</button><button class="btn s sm" onclick="print()">Imprimir</button><a class="btn s sm" href="#historico">Histórico</a></div></div></div>
<div class="ban ${o[0]}">${o[1]}<small>${o[2]}</small></div>
<div class="card"><h2>Interpretação por parâmetro</h2><div class="grid">${it.map(x=>`<div class="ic ${x.s}"><h3>${x.nome}</h3><div class="v">${x.v==null?'—':x.v} <small class="note">${x.u}</small></div>${bd(x.s,x.c)}${x.note?`<p>${x.note}</p>`:''}</div>`).join('')}</div></div>
<div class="card"><h2>Recomendações gerais para pastagem</h2><ul class="rc">${recs(it).map(r=>`<li>${r}</li>`).join('')}</ul><p class="note">Referência das faixas: Comissão de Fertilidade do Solo do Estado de Minas Gerais (5ª Aproximação, 1999), com classes agrupadas, e faixa geral de pH. P (Mehlich-1) classificado conforme a argila. Este sistema não calcula doses; calagem e adubação exigem avaliação de um engenheiro agrônomo, considerando espécie forrageira, manejo e recomendação regional.</p></div>`)};
let hf='',cm={p:'',a:'',b:''};
V.historico=()=>{const L=sorted().filter(a=>!hf||a.pasto==hf),po=db.pastos.map(p=>`<option value="${p.id}">${esc(p.nome)} (${esc(PR(p.prop).nome)})</option>`).join('');
const sel=(id,v)=>v==id?'selected':'';
const ca=cm.p?db.analises.filter(a=>a.pasto==cm.p).sort((a,b)=>a.data.localeCompare(b.data)):[];
const ao=ca.map(a=>`<option value="${a.id}">${fd(a.data)} · ${esc(a.amostra)}</option>`).join('');
let cmp='';const A=db.analises.find(x=>x.id==cm.a),B=db.analises.find(x=>x.id==cm.b);
if(A&&B){const [x,y]=A.data<=B.data?[A,B]:[B,A],ix=interp(x),iy=interp(y);
cmp=`<div class="tw"><table><tr><th>Parâmetro</th><th>${fd(x.data)}</th><th>${fd(y.data)}</th><th>Variação</th></tr>${ix.map((i,n)=>{const j=iy[n],d=i.v!=null&&j.v!=null?+(j.v-i.v).toFixed(2):null;return`<tr><td>${i.nome}</td><td>${i.v??'—'} ${bd(i.s,i.c)}</td><td>${j.v??'—'} ${bd(j.s,j.c)}</td><td>${d==null?'—':(d>0?'▲ +':d<0?'▼ ':'= ')+d}</td></tr>`}).join('')}</table></div><p class="note">Variação = análise mais recente − mais antiga. Em geral, desejável redução do Al e aumento de pH, bases e V% dentro das faixas adequadas.</p>`}
main(`<h1>Histórico</h1><div class="card"><div class="row" style="justify-content:space-between"><h2>Análises realizadas</h2><select style="width:auto;max-width:100%" onchange="hf=this.value;render()"><option value="">Todas as pastagens</option>${po.replace(`value="${hf}"`,`value="${hf}" selected`)}</select></div>${tbl(['Data','Propriedade','Pastagem','Amostra','pH','P','V%','Situação',''],L.map(a=>[fd(a.data),esc(PR(a.prop).nome),esc(PA(a.pasto).nome),esc(a.amostra),a.ph,a.p,a.v||'—',sit(a),act('analises',a.id,1)]))}</div>
<div class="card"><h2>Comparar análises da mesma área</h2><div class="fg"><label>Pastagem<select onchange="cm={p:this.value,a:'',b:''};render()"><option value="">Selecione…</option>${po.replace(`value="${cm.p}"`,`value="${cm.p}" selected`)}</select></label>
<label>Análise 1<select onchange="cm.a=this.value;render()"><option value="">Selecione…</option>${ao.replace(`value="${cm.a}"`,`value="${cm.a}" selected`)}</select></label>
<label>Análise 2<select onchange="cm.b=this.value;render()"><option value="">Selecione…</option>${ao.replace(`value="${cm.b}"`,`value="${cm.b}" selected`)}</select></label></div>
${cm.p&&ca.length<2?'<p class="empty">Esta pastagem possui menos de duas análises para comparar.</p>':''}${cmp}</div>`)};
V.config=()=>main(`<h1>Configurações</h1><div class="card"><h2>Dados do sistema</h2><p>Os dados são salvos no armazenamento local deste navegador e permanecem após atualizar a página. Eles não são compartilhados entre dispositivos.</p><div class="row"><button class="btn s" onclick="demo()">🌾 Carregar dados de exemplo</button><button class="btn d" onclick="clr()">Apagar todos os dados</button></div></div><div class="card"><h2>Sobre</h2><p>Soil Analysis: sistema acadêmico para cadastro e interpretação de análises de solo em pastagens. As interpretações são orientativas e não substituem a avaliação de um engenheiro agrônomo.</p></div>`);
function demo(){if(db.props.length&&!confirm('Adicionar dados de exemplo aos já existentes?'))return;
const s=uid(),p={id:'ex'+s,nome:'Fazenda Boa Esperança (exemplo)',produtor:'João Silva',local:'Maringá/PR',area:'120',obs:'Dados fictícios'},t={id:'pa'+s,nome:'Pasto 1 – Marandu',prop:p.id,area:'18',capim:CAPINS[0],data:'2019-11-10',obs:''};
const mk=(d,v)=>{const a={id:uid(),prop:p.id,pasto:t.id,amostra:'A-'+d.slice(0,4),data:d,prof:'0–20 cm',mo:'',sb:'',ctc:'',v:'',argila:'40',...v};calc(a);return a};
db.props.push(p);db.pastos.push(t);db.analises.push(mk('2023-08-15',{ph:'4.8',mo:'2.4',p:'3.1',k:'55',ca:'1.6',mg:'0.6',al:'0.8',hal:'5.2'}),mk('2025-08-12',{ph:'5.6',mo:'2.9',p:'9.5',k:'88',ca:'2.9',mg:'1.0',al:'0.1',hal:'3.4'}));save();toast('Dados de exemplo carregados');render()}
function clr(){if(!confirm('Apagar TODOS os dados? Esta ação não pode ser desfeita.'))return;db={props:[],pastos:[],analises:[]};save();toast('Dados apagados');render()}
const NAV=[['inicio','🏡 Início'],['propriedades','🏞 Propriedades'],['pastagens','🌾 Pastagens'],['analises','🧪 Análises de solo'],['historico','📋 Histórico'],['config','⚙ Configurações']];
function render(){const [r,id]=(location.hash||'#inicio').slice(1).split('-');
$('#nav').innerHTML=NAV.map(([k,l])=>`<a href="#${k}" class="${k==r||(r=='resultado'&&k=='analises')?'on':''}">${l}</a>`).join('');
(V[r]||V.inicio)(id);if(r!='analises'&&r!='propriedades'&&r!='pastagens')scrollTo(0,0)}
addEventListener('hashchange',render);render();



0.0.0.0
