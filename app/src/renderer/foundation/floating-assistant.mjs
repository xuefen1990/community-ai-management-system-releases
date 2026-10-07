import { installAiTokenStatus } from './ai-token-status.mjs';

export function installFloatingAssistant({ auth, loadScript, loadStyle }) {
  let mounted=false, assistantHost=null, assistantAllowed=true;
  async function mount() {
    if(!auth.canEnterApp)return;
    const tokenStatus=installAiTokenStatus();
    await tokenStatus?.refresh();
    const account=(await window.api.getLocalAuthStatus()).account;
    const allowed=account?.role!=='member'||account.aiAccessEnabled!==false;
    assistantAllowed=allowed;
    if(assistantHost)assistantHost.hidden=!allowed;
    if(!allowed||mounted)return;
    mounted=true;
    loadStyle('foundation/assistant-extension.css');
    window.communityFoundationFloating=true;
    const host=document.createElement('div');host.className='foundation-floating-assistant foundation-assistant';
    host.innerHTML=`<button id="aiCopilotToggleBtn" class="foundation-ai-launcher" aria-label="打开 AI 助理，可拖动" aria-expanded="false"><span aria-hidden="true">✦</span><span class="ai-btn-text">AI 助理</span></button>
      <div class="foundation-assistant-backdrop" aria-hidden="true"></div>
      <section id="aiCopilotDrawer" class="foundation-assistant-panel" role="dialog" aria-label="AI 助理" aria-hidden="true"><header class="ai-drawer-header"><div class="ai-assistant-header-main"><div class="ai-assistant-title-row"><h3>AI 助理</h3><span id="aiDrawerModelStatus">村居业务助手</span></div><div class="ai-assistant-header-actions" aria-label="AI 助理功能"></div></div><button type="button" id="aiCopilotExpandBtn" class="ai-assistant-expand-button" aria-label="放大 AI 助理" aria-pressed="false" title="放大 AI 助理">放大</button><button type="button" id="aiCopilotCloseBtn" aria-label="收起 AI 助理">×</button></header>
      <div id="aiDesktopChatContainer" class="foundation-assistant-chat" aria-live="polite"></div>
      <footer class="ai-drawer-footer"><div class="ai-assistant-shortcuts" aria-label="常用功能"></div><div class="foundation-assistant-composer"><textarea id="aiDesktopInputText" aria-label="发送给 AI 助理" rows="1"></textarea><button id="aiDesktopSendBtn" class="btn btn-primary">发送</button></div><div class="ai-composer-meta"><small>Enter 发送 · Shift + Enter 换行</small><span class="ai-token-status-line" data-ai-token-status aria-live="polite"><span data-ai-token-used>本次消耗 — Token</span><span aria-hidden="true">·</span><span data-ai-token-remaining>余量读取中</span></span></div></footer></section>`;
    document.body.appendChild(host);assistantHost=host;tokenStatus?.sync();
    const button=host.querySelector('#aiCopilotToggleBtn'),panel=host.querySelector('#aiCopilotDrawer'),expandButton=host.querySelector('#aiCopilotExpandBtn'),backdrop=host.querySelector('.foundation-assistant-backdrop');
    let open=false,expanded=false,position=null,panelPosition=null,suppressClick=false;
    const clamp=(v,min,max)=>Math.max(min,Math.min(Math.max(min,max),v));
    function place() {
      const br=button.getBoundingClientRect();
      if(position){position.x=clamp(position.x,12,innerWidth-br.width-12);position.y=clamp(position.y,12,innerHeight-br.height-12);button.style.left=`${position.x}px`;button.style.top=`${position.y}px`;button.style.right='auto';button.style.bottom='auto';}
      if(expanded){const width=panel.offsetWidth,height=panel.offsetHeight;panel.style.left=`${Math.max(12,(innerWidth-width)/2)}px`;panel.style.top=`${Math.max(12,(innerHeight-height)/2)}px`;panel.style.right='auto';panel.style.bottom='auto';return;}
      panel.style.right='auto';panel.style.bottom='auto';
      const r=button.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight;
      const x=clamp(panelPosition?.x??r.right-width,12,innerWidth-width-12),y=clamp(panelPosition?.y??r.top-height-12,12,innerHeight-height-12);
      panel.style.left=`${x}px`;panel.style.top=`${y}px`;
    }
    function setExpanded(next){expanded=next;host.classList.toggle('is-expanded',expanded);expandButton.textContent=expanded?'缩小':'放大';expandButton.setAttribute('aria-label',expanded?'缩小 AI 助理':'放大 AI 助理');expandButton.setAttribute('aria-pressed',String(expanded));expandButton.title=expanded?'缩小 AI 助理':'放大 AI 助理';place();}
    function toggle(next=!open) {if(!assistantAllowed)return;open=next;if(!open)setExpanded(false);else place();host.classList.toggle('is-open',open);panel.setAttribute('aria-hidden',String(!open));panel.inert=!open;button.setAttribute('aria-expanded',String(open));if(open)host.querySelector('textarea').focus();}
    panel.inert=true;
    window.communityOpenAssistant=()=>toggle(true);
    window.toggleDesktopAiDrawer=()=>toggle();
    function drag(handle,target,onMove) {
      let start;
      handle.addEventListener('pointerdown',event=>{if(event.button!==0||handle!==button&&(expanded||event.target.closest('button')))return;const r=target.getBoundingClientRect();start={x:event.clientX,y:event.clientY,left:r.left,top:r.top,moved:false};handle.setPointerCapture(event.pointerId);});
      handle.addEventListener('pointermove',event=>{if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(!start.moved&&Math.hypot(dx,dy)<5)return;start.moved=true;onMove({x:start.left+dx,y:start.top+dy});place();});
      const end=()=>{if(start?.moved&&handle===button)suppressClick=true;start=null;};handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
    }
    drag(button,button,value=>{position=value;panelPosition=null;});
    drag(panel.querySelector('header'),panel,value=>{panelPosition=value;});
    button.addEventListener('click',()=>{if(suppressClick){suppressClick=false;return;}toggle();});
    expandButton.addEventListener('click',()=>setExpanded(!expanded));
    backdrop.addEventListener('click',()=>setExpanded(false));
    host.querySelector('#aiCopilotCloseBtn').addEventListener('click',()=>toggle(false));
    document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();toggle();}else if(event.key==='Escape'&&open){event.preventDefault();if(expanded)setExpanded(false);else toggle(false);}});
    window.addEventListener('resize',place);
    try {await loadScript('js/ai-settings-ui.js');await window.CommunityAiUi.mountAssistant();}catch(error){host.querySelector('#aiDesktopChatContainer').textContent='AI 助理载入失败，请重新打开软件：'+error.message;}
    place();
  }
  auth.$subscribe(()=>{void mount();},{detached:true});void mount();
}
