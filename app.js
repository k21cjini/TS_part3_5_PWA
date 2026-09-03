const KEY='engspeak-pwa-state-v1';
const CATS=['전체','Part 3','Part 5','내 문장장','즐겨찾기','복습필요'];
const defaults=window.DEFAULT_SENTENCES||[];
let state=JSON.parse(localStorage.getItem(KEY)||'null')||{sentences:defaults,history:[],category:'전체',query:'',index:0,tab:'practice',input:'',result:null,seconds:0,mode:'HYBRID',question:'VOICE_AUTO',speed:1,autoSpeak:true,hint:0};
if(!state.sentences.length)state.sentences=defaults;
let timer=null,recognition=null,deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;render()});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function deck(){let a=state.sentences.filter(s=>{if(state.category==='전체')return true;if(state.category==='즐겨찾기')return s.isBookmarked;if(state.category==='복습필요')return s.practiceCount>0&&((s.successCount/s.practiceCount)*100)<70;if(state.category==='내 문장장')return s.isCustom;return s.category===state.category});let q=state.query.trim().toLowerCase();return q?a.filter(s=>(s.korean+s.english+s.category).toLowerCase().includes(q)):a}
function cur(){let d=deck();if(!d.length)return null;state.index=Math.min(state.index,d.length-1);return d[state.index]}
function esc(s=''){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function norm(t){t=String(t||'').replace(/[’‘]/g,"'").replace(/[“”]/g,'"');let c={"i'm":"i am",im:'i am',"you're":'you are',youre:'you are',"he's":'he is',hes:'he is',"she's":'she is',shes:'she is',"it's":'it is',its:'it is',"we're":'we are',were:'we are',"they're":'they are',theyre:'they are',"i'll":'i will',ill:'i will',"you'll":'you will',"he'll":'he will',"she'll":'she will',"we'll":'we will',"they'll":'they will',"i've":'i have',ive:'i have',"you've":'you have',"we've":'we have',"they've":'they have',"i'd":'i would',"you'd":'you would',"he'd":'he would',"she'd":'she would',"we'd":'we would',"they'd":'they would',"can't":'cannot',cant:'cannot',"don't":'do not',dont:'do not',"doesn't":'does not',doesnt:'does not',"didn't":'did not',didnt:'did not',"won't":'will not',wont:'will not',"wouldn't":'would not',"couldn't":'could not',"shouldn't":'should not',"let's":'let us',lets:'let us'};return t.toLowerCase().replace(/[.,!?;:"()—\[\]{}]/g,' ').split(/\s+/).filter(Boolean).map(x=>c[x]||x).join(' ')}
function lev(a,b){let d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++){for(let j=1;j<=b.length;j++){d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));}}return d[a.length][b.length]}
function sim(a,b){let m=Math.max(a.length,b.length);return m?1-lev(a,b)/m:1}
function evaluate(user,target,alts=''){
  if(!user.trim()) return {
    accuracy:0, grade:'TRY_AGAIN', expected:target, diffs:[],
    message:'답변이 비어있습니다.'
  };

  const targets=[target,...alts.split('|').map(x=>x.trim()).filter(Boolean)];

  // 문장 전체를 먼저 정규화합니다.
  // 예: "I'm"과 "I am", "don't"와 "do not"을 같은 표현으로 인정합니다.
  function words(text){
    return norm(text).split(/\s+/).filter(Boolean);
  }

  function alignScore(u,t){
    const n=u.length, m=t.length;
    const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));

    for(let i=1;i<=n;i++) dp[i][0]=i;
    for(let j=1;j<=m;j++) dp[0][j]=j;

    for(let i=1;i<=n;i++){
      for(let j=1;j<=m;j++){
        const wordSim=sim(u[i-1],t[j-1]);
        const subCost=u[i-1]===t[j-1]?0:(wordSim>=0.84?0.25:1);

        dp[i][j]=Math.min(
          dp[i-1][j]+1,
          dp[i][j-1]+1,
          dp[i-1][j-1]+subCost
        );
      }
    }

    const maxLen=Math.max(n,m,1);
    return Math.max(0,Math.min(100,Math.round((1-dp[n][m]/maxLen)*100)));
  }

  function makeDiffs(u,t){
    const n=u.length,m=t.length;
    const dp=Array.from({length:n+1},()=>Array(m+1).fill(0));
    const op=Array.from({length:n+1},()=>Array(m+1).fill(''));

    for(let i=1;i<=n;i++){dp[i][0]=i;op[i][0]='DELETE';}
    for(let j=1;j<=m;j++){dp[0][j]=j;op[0][j]='INSERT';}

    for(let i=1;i<=n;i++){
      for(let j=1;j<=m;j++){
        const wordSim=sim(u[i-1],t[j-1]);
        const subCost=u[i-1]===t[j-1]?0:(wordSim>=0.84?0.25:1);

        const choices=[
          {cost:dp[i-1][j]+1,op:'DELETE'},
          {cost:dp[i][j-1]+1,op:'INSERT'},
          {cost:dp[i-1][j-1]+subCost,op:u[i-1]===t[j-1]?'MATCH':'CHANGE'}
        ];
        choices.sort((a,b)=>a.cost-b.cost);
        dp[i][j]=choices[0].cost;
        op[i][j]=choices[0].op;
      }
    }

    const out=[];
    let i=n,j=m;
    while(i>0 || j>0){
      const action=op[i]?.[j];

      if(action==='MATCH'){
        out.push({w:t[j-1],status:'MATCH'});
        i--;j--;
      }else if(action==='CHANGE'){
        out.push({w:t[j-1],status:'MISSING'});
        i--;j--;
      }else if(action==='DELETE'){
        i--;
      }else{
        out.push({w:t[j-1],status:'MISSING'});
        j--;
      }
    }
    return out.reverse();
  }

  let best=null;

  for(const t of targets){
    const uWords=words(user);
    const tWords=words(t);

    const normalizedUser=uWords.join(' ');
    const normalizedTarget=tWords.join(' ');

    let score,diffs;

    // ★ 정규화한 결과가 완전히 같으면 무조건 100점
    if(normalizedUser===normalizedTarget){
      score=100;
      diffs=tWords.map(w=>({w,status:'MATCH'}));
    }else{
      score=alignScore(uWords,tWords);
      diffs=makeDiffs(uWords,tWords);
    }

    const grade=score>=95?'PERFECT':score>=80?'GREAT':score>=60?'GOOD':'TRY_AGAIN';
    const message={
      PERFECT:'🎉 완벽한 문장입니다!',
      GREAT:'👍 아주 훌륭합니다! 거의 완벽합니다.',
      GOOD:'👏 좋습니다! 몇 가지 표현을 다듬어보세요.',
      TRY_AGAIN:'💪 조금 아쉬워요. 모범 문장을 보고 다시 시도해보세요.'
    }[grade];

    if(!best || score>best.accuracy){
      best={accuracy:score,grade,expected:t,diffs,message};
    }
  }

  return best;
}
function speak(text,lang='en-US'){if(!('speechSynthesis'in window))return;speechSynthesis.cancel();let u=new SpeechSynthesisUtterance(text);u.lang=lang;u.rate=state.speed;speechSynthesis.speak(u)}
function startRec(){if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window)){toast('이 브라우저에서는 음성인식을 지원하지 않습니다. Chrome/Safari 최신 버전을 사용하세요.');return}let R=window.SpeechRecognition||window.webkitSpeechRecognition;recognition=new R();recognition.lang='en-US';recognition.interimResults=true;recognition.continuous=false;recognition.onstart=()=>{document.querySelector('#mic')?.classList.add('recording');toast('듣고 있습니다. 영어로 말해보세요.')} ;recognition.onresult=e=>{let t=[...e.results].map(x=>x[0].transcript).join('');state.input=t;document.querySelector('#answer').value=t};recognition.onerror=()=>toast('음성인식에 실패했습니다. 다시 시도해 주세요.');recognition.onend=()=>{document.querySelector('#mic')?.classList.remove('recording');if(state.input.trim())submit(true)};recognition.start()}
function submit(voice=false){let c=cur(),v=document.querySelector('#answer')?.value||state.input;if(!c||!v.trim())return;clearInterval(timer);let r=evaluate(v,c.english,c.acceptableAnswers);state.input=v;state.result=r;let s=state.sentences.find(x=>x.id===c.id);if(s){s.practiceCount++;if(r.accuracy>=80)s.successCount++;s.lastPracticedAt=Date.now()}state.history.unshift({date:Date.now(),sentenceId:c.id,accuracy:r.accuracy,korean:c.korean,expected:c.english,userAnswer:v,modeUsed:voice?'VOICE':'TEXT',durationSec:state.seconds});state.history=state.history.slice(0,200);save();render();if(state.autoSpeak)setTimeout(()=>speak(c.english,'en-US'),300)}
function newSentence(i){let d=deck();if(!d.length)return;state.index=(i+d.length)%d.length;state.input='';state.result=null;state.seconds=0;state.hint=0;save();startTimer();render();let c=cur();if(c&&state.question!=='TEXT_ONLY')setTimeout(()=>speak(c.korean,'ko-KR'),250)}
function startTimer(){clearInterval(timer);timer=setInterval(()=>{if(!state.result){state.seconds++;let el=document.querySelector('#timer');if(el)el.textContent=`⏱ ${state.seconds}s`}},1000)}
function toggleBook(){let c=cur();if(!c)return;c.isBookmarked=!c.isBookmarked;save();render()}
function toast(t){let x=document.querySelector('.toast');if(!x){x=document.createElement('div');x.className='toast';document.body.appendChild(x)}x.textContent=t;x.style.display='block';setTimeout(()=>x.style.display='none',1800)}
function render(){let root=document.querySelector('#app');root.innerHTML=`<div class="app"><header class="top"><div><div class="brand">◉ EngSpeak</div><small>영어 말하기 생각하기</small></div><div class="row"><button class="ghost install" id="install">앱 설치</button></div></header><nav class="tabs">${[['practice','🎙️','스피킹 훈련'],['library','📚','문장 보관함'],['stats','📊','학습 통계']].map(x=>`<button class="${state.tab===x[0]?'active':''}" data-tab="${x[0]}">${x[1]}<br>${x[2]}</button>`).join('')}</nav><main>${state.tab==='practice'?practice():state.tab==='library'?library():stats()}</main><div class="toast"></div></div>`;document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;save();render()});document.querySelector('#install')?.addEventListener('click',async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else toast('브라우저 메뉴에서 "홈 화면에 추가"를 선택하세요.')});bind();}
function practice(){let d=deck(),c=cur();if(!c)return `<div class="card"><h2>연습할 문장이 없습니다.</h2><p>문장 보관함에서 문장을 추가하거나 카테고리를 변경하세요.</p></div>`;let r=state.result;let pct=Math.round((state.index+1)/d.length*100);return `<div class="row between wrap"><div class="row"><select id="category" class="select">${CATS.map(x=>`<option ${state.category===x?'selected':''}>${x}</option>`).join('')}</select><span class="pill">${state.index+1} / ${d.length}</span></div><div class="row"><button class="ghost" id="mode">⚙️ ${state.mode==='VOICE'?'음성':state.mode==='TEXT'?'텍스트':'음성+텍스트'}</button><button class="ghost" id="book">${c.isBookmarked?'★':'☆'}</button></div></div><div class="progress" style="margin:12px 0 16px"><i style="width:${pct}%"></i></div><div class="card"><div class="row between"><span class="pill">${esc(c.category)} · ${esc(c.difficulty)}</span><span id="timer">⏱ ${state.seconds}s</span></div><div class="ko">${state.question==='VOICE_ONLY'&&!state.revealed?'🔊 음성으로 들어보세요':'🇰🇷 '+esc(c.korean)}</div><div class="row wrap"><button class="secondary" id="speakKo">🔊 한글 듣기</button><button class="ghost" id="reveal">${state.revealed?'한글 숨기기':'한글 표시'}</button></div><hr><textarea id="answer" rows="3" placeholder="영어로 말하거나 입력하세요">${esc(state.input)}</textarea><div class="actions"><button class="bigbtn" id="mic">🎙️ 음성으로 답하기</button><button class="secondary" id="check">✓ 정답 확인</button></div>${state.hint?`<div class="hint">💡 ${state.hint===1?esc(c.patternTip):state.hint===2?`첫 단어: <b>${esc(c.english.split(/\s+/)[0])}</b>`:`단어 힌트: ${c.english.split(/\s+/).map(x=>`<span class="pill">${esc(x[0])}…</span>`).join(' ')}`}</div>`:''}<div class="row between" style="margin-top:12px"><button class="ghost" id="hint">💡 힌트</button><button class="ghost" id="retry">↻ 다시</button><button class="ghost" id="prev">← 이전</button><button class="ghost" id="next">다음 →</button></div></div>${r?resultCard(r,c):''}`}
function resultCard(r,c){return `<div class="card"><div class="row between"><div><div class="score">${r.accuracy}%</div><div class="grade">${r.grade}</div></div><button class="secondary" id="speakEn">🔊 모범답안 듣기</button></div><p>${esc(r.message)}</p><p><b>내 답변:</b> ${esc(state.input)}</p><p><b>모범 답안:</b> ${esc(r.expected)}</p><div>${r.diffs.map(d=>`<span class="${d.status==='MATCH'?'match':'missing'}" style="margin-right:7px">${esc(d.w)}</span>`).join('')}</div></div>`}
function library(){let d=deck();return `<div class="card"><div class="row between"><h2 style="margin:0">문장 보관함</h2><button class="secondary" id="add">＋ 문장 추가</button></div><input class="search" id="search" type="text" placeholder="한국어 또는 영어 문장 검색..." value="${esc(state.query)}"><div class="chips">${CATS.map(x=>`<button class="chip ${state.category===x?'active':''}" data-cat="${esc(x)}">${esc(x)}</button>`).join('')}</div></div><div class="sentence-list">${d.map((s,i)=>`<div class="sentence-item"><div class="row between"><span class="pill">${esc(s.category)} · ${esc(s.difficulty)}</span><button class="ghost" data-book-id="${s.id}">${s.isBookmarked?'★':'☆'}</button></div><div class="ko">${esc(s.korean)}</div><div class="en">${esc(s.english)}</div>${s.patternTip?`<div class="tip">${esc(s.patternTip)}</div>`:''}<div class="row" style="margin-top:10px"><button class="secondary" data-practice-id="${s.id}">연습</button>${s.isCustom?`<button class="ghost danger" data-del-id="${s.id}">삭제</button>`:''}</div></div>`).join('')}</div>`}
function stats(){let h=state.history,total=h.length,avg=total?Math.round(h.reduce((a,x)=>a+x.accuracy,0)/total):0,master=state.sentences.filter(s=>s.practiceCount>0&&(s.successCount/s.practiceCount)>=.8).length,weak=state.sentences.filter(s=>s.practiceCount>0&&(s.successCount/s.practiceCount)<.7).length;return `<div class="stats"><div class="card stat"><span>누적 연습</span><strong>${total}</strong></div><div class="card stat"><span>평균 일치도</span><strong>${avg}%</strong></div><div class="card stat"><span>마스터</span><strong>${master}</strong></div></div><div class="card"><h2>학습 현황</h2><p>복습 필요 문장 <b>${weak}개</b></p><button class="secondary" id="weak">복습 필요 문장 연습</button></div><div class="card"><h2>최근 기록</h2>${h.slice(0,20).map(x=>`<div class="sentence-item" style="margin-bottom:8px"><div class="row between"><b>${x.accuracy}%</b><small>${new Date(x.date).toLocaleString('ko-KR')}</small></div><div>${esc(x.korean)}</div><small>${esc(x.userAnswer)}</small></div>`).join('')||'<p class="tip">아직 학습 기록이 없습니다.</p>'}</div>`}
function bind(){document.querySelector('#category')?.addEventListener('change',e=>{state.category=e.target.value;state.index=0;state.result=null;state.input='';save();startTimer();render()});document.querySelector('#search')?.addEventListener('input',e=>{state.query=e.target.value;save();render()});document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;state.index=0;state.query='';save();render()});document.querySelector('#speakKo')?.addEventListener('click',()=>{let c=cur();if(c)speak(c.korean,'ko-KR')});document.querySelector('#speakEn')?.addEventListener('click',()=>{let c=cur();if(c)speak(c.english,'en-US')});document.querySelector('#mic')?.addEventListener('click',()=>{if(recognition){recognition.stop();recognition=null}else startRec()});document.querySelector('#check')?.addEventListener('click',()=>submit(false));document.querySelector('#answer')?.addEventListener('input',e=>state.input=e.target.value);document.querySelector('#book')?.addEventListener('click',toggleBook);document.querySelector('#retry')?.addEventListener('click',()=>newSentence(0));document.querySelector('#next')?.addEventListener('click',()=>newSentence(1));document.querySelector('#prev')?.addEventListener('click',()=>newSentence(-1));document.querySelector('#hint')?.addEventListener('click',()=>{state.hint=state.hint>=3?0:state.hint+1;save();render()});document.querySelector('#reveal')?.addEventListener('click',()=>{state.revealed=!state.revealed;render()});document.querySelectorAll('[data-practice-id]').forEach(b=>b.onclick=()=>{let d=deck(),idx=d.findIndex(s=>s.id==b.dataset.practiceId);state.tab='practice';state.index=idx>=0?idx:0;state.result=null;state.input='';save();startTimer();render()});document.querySelectorAll('[data-book-id]').forEach(b=>b.onclick=()=>{let s=state.sentences.find(x=>x.id==b.dataset.bookId);if(s){s.isBookmarked=!s.isBookmarked;save();render()}});document.querySelectorAll('[data-del-id]').forEach(b=>b.onclick=()=>{state.sentences=state.sentences.filter(x=>x.id!=b.dataset.delId);save();render()});document.querySelector('#add')?.addEventListener('click',addDialog);document.querySelector('#weak')?.addEventListener('click',()=>{state.category='복습필요';state.tab='practice';state.index=0;save();startTimer();render()});document.querySelector('#mode')?.addEventListener('click',()=>{state.mode=state.mode==='VOICE'?'TEXT':state.mode==='TEXT'?'HYBRID':'VOICE';save();render()})}
function addDialog(){let m=document.createElement('div');m.className='modal';m.innerHTML=`<div><div class="row between"><h2>내 문장 추가</h2><button class="ghost" id="close">닫기</button></div><label>한국어 문장</label><input id="k"><label>영어 모범 답안</label><input id="e"><label>패턴/팁</label><input id="p"><label>허용 답안 (| 로 구분)</label><input id="a"><button class="bigbtn" id="saveSentence" style="margin-top:15px">저장</button></div>`;document.body.appendChild(m);m.querySelector('#close').onclick=()=>m.remove();m.querySelector('#saveSentence').onclick=()=>{let k=m.querySelector('#k').value,e=m.querySelector('#e').value,p=m.querySelector('#p').value,a=m.querySelector('#a').value;if(!k||!e)return toast('한국어와 영어를 입력하세요.');state.sentences.push({id:Date.now(),category:'내 문장장',korean:k,english:e,patternTip:p,acceptableAnswers:a,difficulty:'맞춤',isBookmarked:false,practiceCount:0,successCount:0,lastPracticedAt:0,isCustom:true});save();m.remove();render()}}
startTimer();render();
