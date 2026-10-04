'use strict';

function normalizePrinters(printers) {
  return (printers || []).filter((printer) => printer?.name).map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    isDefault: Boolean(printer.isDefault),
    status: printer.status,
  }));
}

async function printDisbursementPages({ BrowserWindow, printers, value }) {
  const printer = normalizePrinters(printers).find((entry) => entry.name === value?.printerName);
  if (!printer) throw new Error('所选打印机已不可用，请重新选择');
  const paper = value?.paper;
  const orientation = value?.orientation;
  const html = value?.html;
  const pageCount = Number(value?.pageCount);
  if (!['A4', 'A5'].includes(paper) || !['portrait', 'landscape'].includes(orientation)) throw new Error('纸张或方向设置无效');
  if (typeof html !== 'string' || !html.includes('class="wb-sheet"') || Buffer.byteLength(html, 'utf8') > 12_000_000) throw new Error('打印内容无效或过大');
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount !== (html.match(/class="wb-sheet"/gu) || []).length) throw new Error('打印页数与预览不一致，请重新打开预览');
  const printWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  try {
    const safeHtml = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">');
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(safeHtml)}`);
    await printWindow.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    const result = await new Promise((resolve) => printWindow.webContents.print({
      silent: true,
      deviceName: printer.name,
      pageSize: paper,
      landscape: orientation === 'landscape',
      margins: { marginType: 'none' },
      printBackground: true,
    }, (success, failureReason) => resolve({ success, failureReason })));
    if (!result.success) throw new Error(`打印任务提交失败：${result.failureReason || '请检查打印机和纸张设置'}`);
    return { ok: true, printerName: printer.name, pageCount };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

module.exports = { normalizePrinters, printDisbursementPages };
