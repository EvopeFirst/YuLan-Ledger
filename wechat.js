'use strict';
function wxParse(table){
 const alipay=table.some(row=>row.includes('交易分类')&&row.includes('收/付款方式'));
 const prefix=alipay?'ali':'wx';
 const fields=alipay?['交易时间','交易分类','交易对方','商品说明','收/支','金额','收/付款方式','交易状态','交易订单号']:['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号'];
 const clean=v=>String(v??'').trim().replace(/（/g,'(').replace(/）/g,')');
 const start=table.findIndex(row=>fields.every(name=>row.map(clean).includes(name)));
 if(start<0)throw Error('无法识别账单表头，请选择支付宝或微信导出的 XLSX 明细。');
 const cols=fields.map(name=>table[start].map(clean).indexOf(name));
 const occurrences=new Map();
 return table.slice(start+1).filter(row=>row.some(v=>v!=null)).map(row=>{
  const [raw,type,merchant,item,direction,amountText,method,status,order]=cols.map(i=>clean(row[i]));
  let stamp=raw;
  const cell=row[cols[0]];
  if(cell instanceof Date)stamp=cell.toISOString();
  else if(typeof cell==='number')stamp=new Date(Math.round((cell-25569)*86400000)).toISOString();
  const date=stamp.slice(0,10).replaceAll('/','-');
  const amount=Math.round(Number(amountText.replace(/[¥￥,]/g,''))*100);
  const note=[merchant,item].filter(x=>x&&x!=='/').join(' · ');
  const signature=JSON.stringify([stamp,type,merchant,item,direction,amount,method]);
  const count=(occurrences.get(signature)||0)+1;
  occurrences.set(signature,count);
  const stable=typeof row[cols[8]]==='string'&&/^[a-z0-9_-]{12,}$/i.test(order)&&!/^x+$/i.test(order);
  const wxKey=stable?prefix+':id:'+order:prefix+':row:'+signature+':'+count;
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isSafeInteger(amount)&&amount>0&&['支出','收入'].includes(direction);
  const ordinary=alipay?status==='交易成功'&&!/退款|还款|充值|提现|理财/.test(type):['支付成功','已转账','已存入零钱','对方已收钱','收款成功'].includes(status)&&!type.includes('退款');
  let account;
  if(alipay){
   // A combined payment needs a split across accounts.
   if(/^(账户余额|支付宝余额|余额)$/.test(method))account='支付宝余额';
   else if(!/[+＋、,，\/]|组合|优惠|红包|花呗|余额/.test(method)&&/储蓄卡|借记卡|银行卡/.test(method))account='支付宝·银行卡';
   else account='';
  }else account=method==='零钱'||status==='已存入零钱'?'微信零钱':/银行|储蓄卡|信用卡/.test(method)?'银行卡':'';
  const campus=direction==='支出'&&/玉兰卡|校园卡|校园一卡通/.test(note)&&/充值|圈存/.test(note);
  return {category:alipay?type:'其他',wxKey,date,amount,type,note,status,direction,account,campus,allowed:valid&&ordinary&&!!account};
 });
}
function wxOptions(pairs){
 const node=document.createElement('select');
 node.replaceChildren(...pairs.map(([value,label])=>new Option(label,value)));
 return node;
}
const amountsInPreview=new WeakMap();
function wxShow(records){
 const panel=$('wxRows');
 panel.replaceChildren();
 const snapshot=revision;
 const seen=new Set(state.rows.map(r=>r.wxKey));
 const choices=[];
 let duplicate=0,review=0;
 const summary=element('p','');
 panel.append(summary);
 for(const rec of records){
  if(seen.has(rec.wxKey)){duplicate++;continue}
  seen.add(rec.wxKey);
  const card=element('div','');card.className='row';
  const title=element('b',rec.date+' · '+rec.direction+' ');
  const amount=element('span',money(rec.amount));
  amountsInPreview.set(amount,rec.amount);amount.className='previewAmount';title.append(amount);
  card.append(title,element('small',[rec.type,rec.status,rec.note].join(' · ')));
  panel.append(card);
  if(!rec.allowed){review++;card.append(element('small','跳过，请人工核对状态、退款或资金账户'));continue}
  const matches=state.rows.filter(r=>!r.wxKey&&r.date===rec.date&&r.amount===rec.amount&&wallet(r.account)===wallet(rec.account)&&(r.kind===rec.direction||(rec.direction==='支出'&&r.kind==='转账')||(rec.direction==='收入'&&recovery(r))));
  const actions=[['skip','暂不导入'],['new','新增'+rec.direction]];
  if(rec.direction==='支出')actions.push(['campus','转入玉兰卡']);
  for(const m of matches)actions.push([m.id,'合并手记 · '+m.kind+' '+(m.cat||m.dest)+' '+m.note]);
  const action=wxOptions(actions);
  const personal=/转账|群收款|红包/.test(rec.type);
  action.value=matches.length?'skip':rec.campus?'campus':personal?'skip':'new';
  const category=document.createElement('select');
  const list=categoriesFor(rec.direction);
  const aliases={'餐饮':'饮食','餐饮美食':'饮食','文化休闲':'娱乐','交通出行':'车费'};
  const suggested=list.includes(rec.category)?rec.category:aliases[rec.category];
  options(category,list);
  if(list.includes(suggested))category.value=suggested;
  else if(rec.direction==='收入')category.value='其他';
  else{category.insertBefore(new Option('请选择分类',''),category.firstChild);category.value=''}
  category.setAttribute('aria-label','新增流水的分类');
  const sync=()=>category.hidden=action.value!=='new';action.onchange=sync;sync();
  card.append(element('small',rec.account+(matches.length?' · 疑似已有手记，请选择合并或新增':'')),action,category);
  choices.push({rec,action,category});
 }
 summary.textContent='共 '+records.length+' 笔，重复 '+duplicate+' 笔，状态或账户待核对 '+review+' 笔。请检查每笔的处理方式。';
 if(!choices.length)return;
 const commit=button('确认所选流水',async()=>{
  if(snapshot!==revision)throw Error('账本已变化，请重新预览。');
  const rows=state.rows.map(r=>({...r}));
  let added=0,merged=0;
  for(const {rec,action,category} of choices){
   const op=action.value;
   if(op==='skip')continue;
   if(op==='new'||op==='campus'){
    if(op==='new'&&!category.value)throw Error('请为 '+rec.date+' '+money(rec.amount)+' 的流水选择分类，或选暂不导入。');
    rows.push({id:crypto.randomUUID(),wxKey:rec.wxKey,date:rec.date,account:rec.account,kind:op==='campus'?'转账':rec.direction,dest:op==='campus'?'玉兰卡':'',cat:op==='campus'?'':category.value.trim()||'其他',note:rec.note,amount:rec.amount,parent:''});
    added++;
   }else{
    const target=rows.find(r=>r.id===op);
    if(!target||target.wxKey)throw Error('同一笔手记只能匹配一次，请检查选择。');
    target.wxKey=rec.wxKey;merged++;
   }
  }
  if(!added&&!merged)throw Error('请先选择要新增或合并的流水。');
  if(!confirm('新增 '+added+' 笔，合并 '+merged+' 笔。确认入账？'))return;
  commit.disabled=true;
  try{await save({...state,rows});panel.replaceChildren(element('p','已新增 '+added+' 笔，合并 '+merged+' 笔。'));$('wxFile').value=''}finally{commit.disabled=false}
 });
 panel.append(commit);
}
$('wxFile').onchange=()=>$('wxRows').replaceChildren();
$('wxPreview').onclick=guard(async()=>{
 const file=$('wxFile').files[0];if(!file)throw Error('请选择微信或支付宝 XLSX 账单');
 $('wxRows').replaceChildren();
 const table=await readXlsxFile(file);
 if(file===$('wxFile').files[0])wxShow(wxParse(table));
});
