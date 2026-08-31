'use strict';

(function installUpdateUi() {
  const api = window.api;
  if (!api?.checkForAppUpdate || !api?.onAppUpdateStatus) return;

  function formatBytes(value) {
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function formatReleaseNotes(value) {
    const source = String(value || '').trim();
    if (!source) return '';
    const htmlEntities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
    return source
      .replace(/<br\s*\/?\s*>/giu, '\n')
      .replace(/<\/(?:li|p|div|h[1-6]|ul|ol)\s*>/giu, '\n')
      .replace(/<li\b[^>]*>/giu, '• ')
      .replace(/<[^>]+>/gu, '')
      .replace(/&([a-z]+|#39);/giu, (_, name) => htmlEntities[name.toLowerCase()] || `&${name};`)
      .replace(/^#{1,6}\s*/gmu, '')
      .replace(/^\s*[-*+]\s+/gmu, '• ')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  }

  function closeModal() {
    const modal = document.getElementById('appUpdateModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  function ensureModal() {
    let modal = document.getElementById('appUpdateModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'appUpdateModal';
    modal.className = 'modal-overlay hidden';
    modal.style.cssText = 'z-index:100002;display:none;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div class="modal-card" style="width:520px;max-width:92vw;border-radius:14px;overflow:hidden;background:var(--bg-card);">
        <div class="modal-header" style="padding:18px 22px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;"><div><h3 style="margin:0 0 4px;font-size:17px;">发现新版本</h3><p id="appUpdateVersion" style="margin:0;color:var(--text-secondary);font-size:12px;"></p></div><button id="closeAppUpdateModal" class="close-modal-btn" style="background:none;border:0;font-size:22px;cursor:pointer;color:var(--text-secondary);">×</button></div>
        <div class="modal-body" style="padding:20px 22px;display:flex;flex-direction:column;gap:12px;"><p id="appUpdateMessage" style="margin:0;font-size:13px;color:var(--text-primary);line-height:1.7;white-space:pre-wrap;"></p><pre id="appUpdateNotes" style="margin:0;max-height:180px;overflow:auto;padding:12px;border-radius:8px;background:var(--bg-body);border:1px solid var(--border-color);font:12px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;white-space:pre-wrap;color:var(--text-secondary);"></pre><div id="appUpdateProgressWrap" style="display:none;"><div style="height:7px;border-radius:999px;background:var(--border-color);overflow:hidden;"><div id="appUpdateProgressBar" style="width:0%;height:100%;background:var(--primary);transition:width .2s;"></div></div><p id="appUpdateProgressText" style="margin:8px 0 0;font-size:12px;color:var(--text-secondary);"></p></div><p id="appUpdateError" style="min-height:18px;margin:0;color:#ef4444;font-size:12px;"></p></div>
        <div class="modal-footer" style="padding:14px 22px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:10px;"><button id="deferAppUpdate" class="btn btn-outline">暂不更新</button><button id="downloadAppUpdate" class="btn btn-primary">立即更新</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#closeAppUpdateModal').addEventListener('click', closeModal);
    modal.querySelector('#deferAppUpdate').addEventListener('click', closeModal);
    modal.querySelector('#downloadAppUpdate').addEventListener('click', async () => {
      const button = modal.querySelector('#downloadAppUpdate');
      if (button.dataset.action === 'install') {
        const result = await api.installAppUpdate();
        if (!result.ok) modal.querySelector('#appUpdateError').textContent = result.error || '无法安装更新';
        return;
      }
      button.disabled = true;
      modal.querySelector('#appUpdateError').textContent = '';
      modal.querySelector('#appUpdateProgressWrap').style.display = 'block';
      modal.querySelector('#appUpdateMessage').textContent = '正在下载更新，下载完成后可重启安装。';
      try {
        const result = await api.downloadAppUpdate();
        if (!result.ok) throw new Error(result.error || '下载更新失败');
      } catch (error) {
        modal.querySelector('#appUpdateError').textContent = error.message || '下载更新失败';
        button.disabled = false;
      }
    });
    return modal;
  }

  function showAvailable(status) {
    const modal = ensureModal();
    modal.querySelector('#appUpdateVersion').textContent = `新版本 ${status.version}`;
    modal.querySelector('#appUpdateMessage').textContent = '已发现新版本。是否现在下载并安装？';
    modal.querySelector('#appUpdateNotes').textContent = formatReleaseNotes(status.releaseNotes) || '本次版本包含体验优化和问题修复。';
    modal.querySelector('#appUpdateError').textContent = '';
    modal.querySelector('#appUpdateProgressWrap').style.display = 'none';
    const button = modal.querySelector('#downloadAppUpdate');
    button.disabled = false;
    button.dataset.action = 'download';
    button.textContent = '立即更新';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
  }

  function handleStatus(status) {
    if (status.type === 'available') return showAvailable(status);
    const modal = document.getElementById('appUpdateModal');
    if (status.type === 'download-progress' && modal) {
      modal.querySelector('#appUpdateProgressWrap').style.display = 'block';
      modal.querySelector('#appUpdateProgressBar').style.width = `${Math.max(0, Math.min(100, status.percent || 0))}%`;
      modal.querySelector('#appUpdateProgressText').textContent = `已下载 ${status.percent.toFixed(1)}% · ${formatBytes(status.transferred)} / ${formatBytes(status.total)} · ${formatBytes(status.bytesPerSecond)}/秒`;
      return;
    }
    if (status.type === 'downloaded' && modal) {
      modal.querySelector('#appUpdateMessage').textContent = '更新已下载完成，重启应用即可安装。';
      const button = modal.querySelector('#downloadAppUpdate');
      button.disabled = false;
      button.dataset.action = 'install';
      button.textContent = '重启并安装';
      return;
    }
    if (status.type === 'installation-required') {
      showToast(status.message || '请先将社区AI管理系统拖入“应用程序”后再打开', 'info');
      return;
    }
    if (status.type === 'backend-unavailable') {
      showToast('更新服务器暂时不可用，本次不下载更新。', 'info');
      return;
    }
    if (status.type === 'release-mismatch') {
      showToast('更新发布尚未同步完成，稍后再试。', 'info');
      return;
    }
    if (status.type === 'error' && modal && !modal.classList.contains('hidden')) {
      modal.querySelector('#appUpdateError').textContent = status.message || '更新服务暂时不可用';
    }
  }

  function setManualCheckButtonState(button, checking) {
    button.disabled = checking;
    button.classList.toggle('is-checking', checking);
    button.setAttribute('aria-busy', String(checking));
    button.title = checking ? '正在检查软件新版本' : '检查软件新版本';
    button.innerHTML = `<span class="sidebar-update-btn__icon" aria-hidden="true">⟳</span><span>${checking ? '检查中' : '检查更新'}</span>`;
  }

  function addManualCheckButton() {
    if (document.getElementById('manualUpdateCheckBtn')) return;
    const row = document.querySelector('.sidebar-secondary-actions');
    if (!row) return;
    const button = document.createElement('button');
    button.id = 'manualUpdateCheckBtn';
    button.className = 'sidebar-update-btn';
    button.type = 'button';
    button.title = '检查软件新版本';
    setManualCheckButtonState(button, false);
    button.addEventListener('click', async () => {
      setManualCheckButtonState(button, true);
      try {
        const result = await api.checkForAppUpdate();
        if (result.disabled) showToast('当前为本机测试版，暂不检查线上更新', 'info');
        else if (result.installRequired) showToast(result.error || '请先将社区AI管理系统拖入“应用程序”后再打开', 'info');
        else if (result.backendUnavailable) showToast('更新服务器暂时不可用，本次不下载更新。', 'info');
        else if (!result.ok) showToast(result.error || '检查更新失败', 'error');
        else if (!result.hasUpdate) showToast('当前已是最新版本', 'success');
      } catch (error) {
        showToast(error?.message || '检查更新失败', 'error');
      } finally {
        setManualCheckButtonState(button, false);
      }
    });
    row.appendChild(button);
  }

  function initialize() {
    api.onAppUpdateStatus(handleStatus);
    addManualCheckButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
}());
