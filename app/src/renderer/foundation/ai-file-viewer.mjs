export function installAiFileViewer() {
  if (window.AiFileViewer) return window.AiFileViewer;
  const overlay = document.createElement('div'); overlay.className = 'ai-file-viewer hidden'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div class="ai-file-viewer-shell"><header><div><strong data-viewer-name>图片查看</strong><span data-viewer-page></span></div><button type="button" data-viewer-close aria-label="关闭">×</button></header>
    <div class="ai-file-viewer-stage"><img data-viewer-image alt="材料原图"><iframe data-viewer-pdf title="PDF 原文件"></iframe></div>
    <footer><button type="button" data-viewer-minus>缩小</button><span data-viewer-scale>100%</span><button type="button" data-viewer-plus>放大</button><button type="button" data-viewer-fit>适应窗口</button><button type="button" data-viewer-rotate>旋转</button></footer></div>`;
  document.body.appendChild(overlay);
  const image = overlay.querySelector('[data-viewer-image]'); const pdf = overlay.querySelector('[data-viewer-pdf]'); const scaleLabel = overlay.querySelector('[data-viewer-scale]');
  let scale = 1; let rotation = 0;
  const draw = () => { image.style.transform = `scale(${scale}) rotate(${rotation}deg)`; scaleLabel.textContent = `${Math.round(scale * 100)}%`; };
  const close = () => { overlay.classList.add('hidden'); image.removeAttribute('src'); pdf.removeAttribute('src'); };
  overlay.querySelector('[data-viewer-close]').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.querySelector('[data-viewer-minus]').addEventListener('click', () => { scale = Math.max(.25, scale - .25); draw(); });
  overlay.querySelector('[data-viewer-plus]').addEventListener('click', () => { scale = Math.min(4, scale + .25); draw(); });
  overlay.querySelector('[data-viewer-fit]').addEventListener('click', () => { scale = 1; rotation = 0; draw(); });
  overlay.querySelector('[data-viewer-rotate]').addEventListener('click', () => { rotation = (rotation + 90) % 360; draw(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.classList.contains('hidden')) close(); });
  const api = Object.freeze({ open(file = {}) {
    if (!file.previewUrl) throw new Error('该文件没有可用的安全预览地址');
    scale = 1; rotation = 0; draw(); overlay.querySelector('[data-viewer-name]').textContent = file.fileName || '材料原图';
    overlay.querySelector('[data-viewer-page]').textContent = file.pageCount ? `${file.pageCount} 页` : '';
    const isPdf = file.format === 'pdf'; image.hidden = isPdf; pdf.hidden = !isPdf;
    if (isPdf) pdf.src = file.previewUrl; else image.src = file.previewUrl;
    overlay.classList.remove('hidden'); overlay.querySelector('[data-viewer-close]').focus();
  }, close });
  window.AiFileViewer = api; return api;
}
