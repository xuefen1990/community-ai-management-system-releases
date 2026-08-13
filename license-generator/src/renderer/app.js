'use strict';

const planLabels = { monthly: '月度授权（30 天）', yearly: '年度授权（365 天）', permanent: '永久授权' };

document.getElementById('generate').addEventListener('click', async () => {
  const button = document.getElementById('generate');
  const error = document.getElementById('error');
  error.textContent = '';
  button.disabled = true;
  try {
    const plan = document.querySelector('input[name="plan"]:checked').value;
    const result = await window.licenseTool.issueLicense({
      customer: document.getElementById('customer').value,
      machineId: document.getElementById('machineId').value,
      notes: document.getElementById('notes').value,
      plan,
    });
    document.getElementById('code').value = result.code;
    document.getElementById('summary').textContent = `${planLabels[plan]} · ${result.payload.customer || '未填写客户名'} · ${result.payload.machineId}`;
    document.getElementById('result').classList.remove('hidden');
  } catch (caught) {
    error.textContent = caught.message || '授权码生成失败';
  } finally {
    button.disabled = false;
  }
});

document.getElementById('copy').addEventListener('click', async (event) => {
  await navigator.clipboard.writeText(document.getElementById('code').value);
  event.currentTarget.textContent = '已复制';
  setTimeout(() => { event.currentTarget.textContent = '复制授权码'; }, 1500);
});
