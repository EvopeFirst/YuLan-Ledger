'use strict';
const $ = id => document.getElementById(id);
const names = ['微信零钱','支付宝余额','银行卡','玉兰卡'];
const channels = ['微信零钱','支付宝余额','支付宝·银行卡','银行卡','玉兰卡'];
const wallet = channel => channel === '支付宝·银行卡' ? '银行卡' : channel;
const expenseCategories=['饮食','生活','转账','玉兰卡','AI','应用续费','娱乐','购物','日用百货','快递寄付','学习','车费','体育','学费'];
const incomeCategories=['生活费','校园补贴','工资','其他'];
function categoriesFor(kind){return kind==='收入'?incomeCategories:expenseCategories}
const types = ['支出','收入','转账','分摊收回','退款'];
const recovery = t => ['退款','分摊收回'].includes(t.kind);
let amountsVisible=false;
const pinStorageKey='yulan-pocket-ledger.pin.v1';
const money = cents => !amountsVisible?'••••':'¥' + (cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const iso = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const today = () => iso(new Date());
function cents(value){
 if(!/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw Error('请填写最多两位小数的非负金额');
 return Math.round(Number(value)*100);
}
function options(node,values){node.replaceChildren(...values.map(v=>new Option(v,v)))}
function element(tag,str){const node=document.createElement(tag);node.textContent=str;return node}
function button(label,fn){const b=element('button',label);b.onclick=guard(fn);return b}
function guard(fn){return async(...args)=>{try{await fn(...args)}catch(e){alert(e.message||'操作失败，请重试')}}}
let db, state, parentId='', editing='', revision=0, predicate=()=>true;
const empty=()=>({version:1,opening:Object.fromEntries(names.map(n=>[n,0])),rows:[]});
function validate(s){
 if(s?.version!==1||!Array.isArray(s.rows)||!names.every(n=>Number.isSafeInteger(s.opening?.[n])&&s.opening[n]>=0))throw Error('账本格式不正确');
 const ids=new Set(), parents=new Map(), paid=new Map();
 for(const r of s.rows){
  if(!r||typeof r.id!=='string'||ids.has(r.id)||!types.includes(r.kind)||!channels.includes(r.account)||!Number.isSafeInteger(r.amount)||r.amount<=0||!/^\d{4}-\d\d-\d\d$/.test(r.date)||typeof r.cat!=='string'||typeof r.note!=='string')throw Error('流水格式不正确');
  ids.add(r.id);
  if(r.kind==='支出')parents.set(r.id,r);
  if(r.kind==='转账'&&(!names.includes(r.dest)||wallet(r.account)===r.dest))throw Error('请选择不同的转入账户');
 }
 for(const r of s.rows.filter(recovery)){
  const p=parents.get(r.parent);
  if(!p||r.date<p.date)throw Error('回款日期必须在原支出当日或之后');
  const sum=(paid.get(p.id)||0)+r.amount;
  if(sum>p.amount)throw Error('累计回款不能超过原支出');
  paid.set(p.id,sum);
 }
}
function read(){
 return new Promise((resolve,reject)=>{const q=db.transaction('book').objectStore('book').get(1);q.onerror=()=>reject(q.error);q.onsuccess=()=>{state=q.result?.data||empty();revision=q.result?.revision||0;resolve()}})
}
async function save(next){
 validate(next);
 await new Promise((resolve,reject)=>{
  const tx=db.transaction('book','readwrite'), store=tx.objectStore('book'), q=store.get(1);
  q.onsuccess=()=>{if((q.result?.revision||0)!==revision){tx.abort();return}store.put({data:next,revision:revision+1},1)};
  tx.oncomplete=resolve;tx.onabort=()=>reject(Error('保存失败或账本已在另一窗口更新，请刷新再试'));
 });
 revision++;state=next;render();
}
function bounds(){
 const now=new Date(),y=now.getFullYear(),m=now.getMonth();
 switch($('period').value){
 case '上月':return [iso(new Date(y,m-1,1)),iso(new Date(y,m,0))];
 case '最近七天':return [iso(new Date(y,m,now.getDate()-6)),today()];
 case '自选日期':return [$('start').value,$('end').value];
 default:return [iso(new Date(y,m,1)),iso(new Date(y,m+1,0))];
 }
}
function page(id){document.querySelectorAll('main section').forEach(s=>s.hidden=s.id!==id);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===(id==='incomeView'?'overview':id)));window.scrollTo(0,0)}
function flows(test,label,fromIncome=false){$('incomeBack').hidden=!fromIncome;predicate=test;$('filter').textContent=label;renderRows();page('flow')}
function renderRows(){
 const box=$('rows');box.replaceChildren();
 for(const r of state.rows.filter(predicate).reverse().sort((a,b)=>b.date.localeCompare(a.date))){
  const line=element('div','');line.className='row';
  line.append(element('b',r.kind+' · '+(r.cat||r.dest||'')+'　'+money(r.amount)),element('small',[r.date,r.account,r.note].filter(Boolean).join(' · ')));
  line.append(button('编辑',()=>openForm(r.kind,r.account,r)));
  if(r.kind==='支出'){
   for(const k of ['分摊收回','退款'])line.append(button(k,()=>openForm(k,r.account,null,r.id)));
   if(state.rows.some(x=>x.parent===r.id))line.append(button('查看回款',()=>flows(x=>x.parent===r.id||x.id===r.id,'原支出与回款')));
  }
  if(recovery(r))line.append(button('查看原支出',()=>flows(x=>x.id===r.parent||x.parent===r.parent,'原支出与回款')));
  line.append(button('删除',async()=>{if(state.rows.some(x=>x.parent===r.id))throw Error('请先处理关联回款');if(confirm('删除这笔流水？账户余额和统计将重新计算。'))await save({...state,rows:state.rows.filter(x=>x.id!==r.id)})}));
  box.append(line);
 }
 if(!box.children.length)box.append(element('p','暂无流水'));
}
function render(){
 $('clearRows').disabled=!state.rows.length;
 const [from,to]=bounds(), balances={...state.opening}, groups=new Map(),returns=new Map();
 const byIncome=new Map();
 let income=0,expense=0;
 for(const r of state.rows){
  balances[wallet(r.account)]+=['支出','转账'].includes(r.kind)?-r.amount:r.amount;
  if(r.kind==='转账')balances[r.dest]+=r.amount;
  if(recovery(r))returns.set(r.parent,(returns.get(r.parent)||0)+r.amount);
 }
 for(const r of state.rows.filter(x=>x.date>=from&&x.date<=to)){
  if(r.kind==='收入'){
   income+=r.amount;
   byIncome.set(r.cat,(byIncome.get(r.cat)||0)+r.amount);
  }
  if(r.kind==='支出'){const net=r.amount-(returns.get(r.id)||0);expense+=net;groups.set(r.cat,(groups.get(r.cat)||0)+net)}
 }
 $('total').textContent=money(expense);$('income').textContent=money(income);$('net').textContent=money(income-expense);
 $('incomeDates').textContent=from+' 至 '+to;
 $('incomeSum').textContent=money(income);
 const incomeBox=$('incomeGroups');
 incomeBox.replaceChildren();
 for(const [cat,sum] of [...byIncome].sort((a,b)=>b[1]-a[1])){
  const row=button((cat||'未分类')+'　'+money(sum),()=>flows(
   r=>r.kind==='收入'&&r.cat===cat&&r.date>=from&&r.date<=to,
   '个人收入 · '+(cat||'未分类')+' · '+from+' 至 '+to,true));
  incomeBox.append(row);
 }
 if(!byIncome.size)incomeBox.textContent=from>to?'请检查起止日期':'这段时间没有收入记录';
 $('cats').replaceChildren();
 for(const [cat,sum] of [...groups].sort((a,b)=>b[1]-a[1])){
  const row=element('div','');row.className='row';row.append(button(cat+'　'+money(sum),()=>flows(r=>r.kind==='支出'&&r.cat===cat&&r.date>=from&&r.date<=to,cat+' · '+from+' 至 '+to)));
  const bar=element('progress','');bar.max=1;bar.value=expense?sum/expense:0;row.append(bar);$('cats').append(row);
 }
 if(!groups.size)$('cats').textContent=from>to?'开始日期应早于结束日期':'这段时间还没有支出';
 $('balances').replaceChildren();
 for(const n of names){
  const line=element('div','');line.className='row';line.append(element('b',n+'　'+money(balances[n])),button('查看流水',()=>flows(r=>wallet(r.account)===n||r.dest===n,n)),button('期初余额',async()=>{if(!amountsVisible){askPin(()=>editOpening(n));return}await editOpening(n)}));$('balances').append(line);
 }
 renderRows();
}
async function editOpening(n){const v=prompt(n+'期初余额（元），修改后将重新计算当前余额',String(state.opening[n]/100));if(v!==null)await save({...state,opening:{...state.opening,[n]:cents(v)}})}
function fields(){
 const k=$('kind').value;$('destLabel').hidden=k!=='转账';$('catLabel').hidden=!['支出','收入'].includes(k);
 options($('category'),categoriesFor(k));
}
function openForm(kind='支出',account='微信零钱',r=null,parent='',date=today()){
 editing=r?.id||'';parentId=r?.parent||parent;$('form').reset();
 options($('kind'),parentId?types.slice(3):types.slice(0,3));$('kind').value=kind;fields();
 $('account').value=account;$('day').value=r?.date||date;const hiddenAmount=Boolean(r)&&!amountsVisible;
 $('amt').disabled=hiddenAmount;
 $('amt').placeholder=hiddenAmount?'••••':'';
 $('editAmount').hidden=!hiddenAmount;
 $('amt').value=r&&!hiddenAmount?String(r.amount/100):'';$('dest').value=r?.dest||'玉兰卡';
 if(r){if(r.cat&&!categoriesFor(kind).includes(r.cat))$('category').add(new Option(r.cat,r.cat));$('category').value=r.cat;$('note').value=r.note}
 $('formTitle').textContent=editing?'编辑流水':'记一笔';$('editor').showModal();
}
$('form').onsubmit=guard(async e=>{
 e.preventDefault();const kind=$('kind').value,account=$('account').value,date=$('day').value;
 const cat=['支出','收入'].includes(kind)?$('category').value.trim():'';
 if(['支出','收入'].includes(kind)&&!cat)throw Error('请选择或填写分类');
 const r={...state.rows.find(x=>x.id===editing),id:editing||crypto.randomUUID(),kind,account,date,amount:editing&&!amountsVisible?state.rows.find(x=>x.id===editing).amount:cents($('amt').value),cat,note:$('note').value,dest:kind==='转账'?$('dest').value:'',parent:parentId};
 const keep=$('again').checked&&!parentId&&!editing;
 await save({...state,rows:editing?state.rows.map(x=>x.id===editing?r:x):[...state.rows,r]});
 $('editor').close();if(keep){openForm(kind,account,null,'',date);$('again').checked=true}
});
$('kind').onchange=fields;$('cancel').onclick=()=>$('editor').close();
function bytes64(data){return btoa(Array.from(new Uint8Array(data),n=>String.fromCharCode(n)).join(''))}
function decode(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
let pinRequest=null;
function askPin(afterUnlock){
 const saved=localStorage.getItem(pinStorageKey);
 pinRequest={saved,afterUnlock};
 $('pinForm').reset();
 $('pinTitle').textContent=saved?'查看金额':'设置四位数字 PIN';
 $('confirmLabel').hidden=Boolean(saved);
 $('pinConfirm').disabled=Boolean(saved);
 $('pinConfirm').required=!saved;
 $('pinSubmit').disabled=false;
 $('pinError').textContent='';
 $('pinDialog').showModal();
 $('pin').focus();
}
async function pinVerifier(pin,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
 return bytes64(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},key,256));
}
$('showMoney').onclick=guard(()=>askPin());
$('editAmount').onclick=guard(()=>askPin(()=>{
 $('amt').disabled=false;
 $('amt').placeholder='';
 $('amt').value=String(state.rows.find(r=>r.id===editing).amount/100);
 $('editAmount').hidden=true;
 $('amt').focus();
}));
$('pinCancel').onclick=()=>$('pinDialog').close();
$('pinDialog').onclose=()=>{$('pinForm').reset();pinRequest=null};
$('pinForm').onsubmit=guard(async event=>{
 event.preventDefault();
 const request=pinRequest,pin=$('pin').value;
 if(!request||$('pinSubmit').disabled)return;
 if(!/^\d{4}$/.test(pin)||(!request.saved&&pin!==$('pinConfirm').value)){
  $('pinError').textContent='请输入四位数字，并确认两次输入一致。';return;
 }
 $('pinSubmit').disabled=true;
 try{
  const saved=request.saved&&JSON.parse(request.saved);
  const salt=saved?decode(saved.salt):crypto.getRandomValues(new Uint8Array(16));
  const verifier=await pinVerifier(pin,salt);
  if(pinRequest!==request||!$('pinDialog').open)return;
  if(localStorage.getItem(pinStorageKey)!==request.saved)throw Error('PIN 设置已更新，请关闭后重试。');
  if(saved&&saved.verifier!==verifier){$('pinError').textContent='PIN 不正确，请重试。';$('pin').select();return}
  if(!saved)localStorage.setItem(pinStorageKey,JSON.stringify({salt:bytes64(salt),verifier}));
  amountsVisible=true;
  $('pinDialog').close();
  $('showMoney').hidden=true;
  render();
  for(const node of document.querySelectorAll('.previewAmount'))node.textContent=money(amountsInPreview.get(node));
  await request.afterUnlock?.();
 }finally{$('pinSubmit').disabled=false}
});
async function key(salt){
 if($('password').value.length<8)throw Error('备份密码至少 8 位');
 const pw=await crypto.subtle.importKey('raw',new TextEncoder().encode($('password').value),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},pw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
$('export').onclick=guard(async()=>{
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(salt),new TextEncoder().encode(JSON.stringify(state)));
 const blob=new Blob([JSON.stringify({format:'yulan-1',salt:bytes64(salt),iv:bytes64(iv),data:bytes64(data)})],{type:'application/json'});
 const a=element('a','');a.href=URL.createObjectURL(blob);a.download='玉兰小账-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000);
});
$('restore').onclick=guard(async()=>{
 const file=$('file').files[0];if(!file)throw Error('请选择备份文件');
 const b=JSON.parse(await file.text());if(b.format!=='yulan-1')throw Error('备份格式不正确');
 const k=await key(decode(b.salt));let raw;try{raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(b.iv)},k,decode(b.data))}catch{throw Error('密码错误或文件损坏')}
 const incoming=JSON.parse(new TextDecoder().decode(raw));validate(incoming);
 const dates=incoming.rows.map(r=>r.date).sort(),bal={...incoming.opening};
 for(const r of incoming.rows){bal[wallet(r.account)]+=['转账','支出'].includes(r.kind)?-r.amount:r.amount;if(r.kind==='转账')bal[r.dest]+=r.amount}
 if(confirm(['备份包含 '+dates.length+' 笔流水',dates.length?dates[0]+' 至 '+dates.at(-1):'空账本',...names.map(n=>n+' '+money(bal[n])),'确认覆盖当前账本？'].join('\n')))await save(incoming);
});
$('clearRows').onclick=guard(async()=>{
 if(!state?.rows.length)return;
 const phrase='清除全部流水';
 const answer=prompt('将清除全部 '+state.rows.length+' 笔流水，包括手记、导入和关联回款。账户余额将回到期初余额。恢复需要此前导出的备份。请输入「'+phrase+'」确认。','');
 if(answer!==phrase)return;
 await save({...state,rows:[]});
 $('wxRows').replaceChildren();
 $('wxFile').value='';
 alert('已清除全部流水。');
});
async function boot(){
 const q=indexedDB.open('yulan-pocket-ledger',1);q.onupgradeneeded=()=>q.result.createObjectStore('book');
 db=await new Promise((res,rej)=>{q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});await read();validate(state);
 options($('account'),channels);options($('dest'),names);
 $('start').value=bounds()[0];$('end').value=today();
 for(const id of ['period','start','end'])$(id).onchange=()=>{$('range').hidden=$('period').value!=='自选日期';render()};
 document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>b.dataset.page==='flow'?flows(()=>true,'全部流水'):page(b.dataset.page));
 $('openIncome').onclick=$('incomeBack').onclick=()=>page('incomeView');
 $('incomeHome').onclick=()=>page('overview');
 $('all').onclick=()=>flows(()=>true,'全部流水');$('add').onclick=()=>openForm();
 for(const [label,k,a,c] of [['微信充值','转账','微信零钱',''],['收到补贴','收入','玉兰卡','校园补贴'],['食堂消费','支出','玉兰卡','饮食']])$('shortcuts').append(button(label,()=>{openForm(k,a);if(c)$('category').value=c}));
 $('showMoney').disabled=false;
 render();page('overview');
 try{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;$('offline').textContent='离线缓存已就绪'}catch{$('offline').textContent='离线缓存未就绪'}
}
boot().catch(e=>alert('账本启动失败：'+e.message));

