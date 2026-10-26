import {createBasicFieldDisplay} from './special-basic-display.mjs';
import { categoryCatalog, labelCategory, preserveCategoryHistory } from './special-category-model.mjs';

// Labels are presentation aliases. Input values, identity predicates and saved
// resident fields remain canonical, including records belonging to deleted tags.
export function installSpecialCategoryDisplay(store) {
  let catalog = categoryCatalog(), scheduled = false, started = false;
  const originals = new WeakMap();
  const hidden = element => element.classList.contains('community-category-hidden');
  const hide = (element, value) => { if (hidden(element) !== value) element.classList.toggle('community-category-hidden', value); };
  const labelSelectors = [
    '[data-stat-key] .stat-label', '.el-checkbox__label', '.el-select-dropdown__item',
    '.el-select__selected-item', '.el-tag__content', '.subform-title', '.modal-nav-link',
    '.tag-checkbox-card span', '.special-tag-button', '.personnel-sub-tab-nav .tab-label', '.wb-h360-label', '.care-options-grid strong',
    '.personnel-filter-panel option',
  ].join(',');
  const decorate = () => {
    scheduled = false;
    document.querySelectorAll('[data-stat-key],[data-care-key],.personnel-sub-tab-nav button').forEach(element => {
      const category = catalog.find(c => c.statKey === (element.dataset.statKey || element.dataset.careKey || element.dataset.testid?.replace(/^stat-/, '')) || `custom-stat-${c.id}` === element.dataset.testid);
      hide(element, !!category?.deleted);
      if (category?.row?.displayName) element.title = `点击筛选：${category.displayName}`;
    });
    for (const category of catalog.filter(c => c.isSystem)) {
      const keys = category.key === 'extreme_poor' ? [] : [category.key];
      // Low income and extreme poverty share one legacy section. Hide it only
      // when both labels are deleted, preserving the other category's controls.
      if (category.key === 'low_income') keys.splice(0, 1);
      for (const key of keys) for (const id of [`subform_${key}`, `nav_subform_${key}`]) {
        const element = document.getElementById(id); if (element) hide(element, category.deleted);
      }
    }
    const benefitsDeleted = ['standard_low_income','standard_extreme_poor'].every(code => catalog.find(c => c.code === code)?.deleted);
    for (const id of ['subform_low_income','nav_subform_low_income']) {
      const element = document.getElementById(id); if (element) hide(element, benefitsDeleted);
    }
    document.querySelectorAll(labelSelectors).forEach(element => {
      if (element.closest('.special-category-manager')) return;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const saved = originals.get(node);
        // Vue can reuse a text node for another option; forget our previous
        // source when the framework replaces it with a new canonical value.
        const source = saved && node.nodeValue === saved.applied ? saved.source : node.nodeValue;
        const title = element.matches('.subform-title,.modal-nav-link');
        const tagControl = element.closest('.tag-checkbox-card');
        const assigned = tagControl && catalog.find(c => tagControl.querySelector('input')?.id === `tag_${c.key}`);
        const category = assigned || labelCategory(source, catalog) || (tagControl ? labelCategory(source.trim().replace(/^[\p{Symbol}\p{Punctuation}\p{Mark}\s]+/u, ''), catalog) : null) || (title ? catalog.find(c => c.aliases.some(alias => source.includes(alias))) : null);
        let applied = source;
        if (category?.row?.displayName) applied = (title || tagControl) ? source.replace([...category.aliases].sort((a, b) => b.length - a.length).find(alias => source.includes(alias)), category.displayName) : source.replace(source.trim(), category.displayName);
        originals.set(node, { source, applied });
        if (node.nodeValue !== applied) node.nodeValue = applied;
        const option = element.closest('.el-select-dropdown__item,option,.el-checkbox,.tag-checkbox-card,.personnel-sub-tab-nav button');
        if (category && option) hide(option, category.deleted);
      }
    });
    basicDisplay.decorate();
    if (!started && document.querySelector('[data-testid="business-shell"]')) {
      started = true; void refresh().catch(() => { started = false; });
    }
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(decorate); } };
  const basicDisplay=createBasicFieldDisplay(()=>catalog,schedule);
  const originalLoad = store.load.bind(store);
  const refreshCatalog = async () => {
    const response = await window.api.businessRequest({ path: '/api/v3/special-categories' });
    if (!response?.ok) throw new Error(response?.error?.message || '标签配置读取失败');
    const rows = response.data?.items || [];
    catalog = categoryCatalog(rows);
    store.specialCategories = rows.filter(row => !row.deletedAt);
    if (labelCategory(store.filters.identity, catalog)?.deleted || catalog.some(c => c.deleted && (store.primaryTab === c.statKey || store.primaryTab === `custom:${c.name}`))) store.filterByStat('all');
    schedule();
  };
  store.load = async (...args) => { const result = await originalLoad(...args); if (!store.error) await refreshCatalog(); return result; };
  const refresh = refreshCatalog;
  window.communityRefreshSpecialCategories = refresh;
  const createEditor = window.communityCreateResidentEditor;
  window.communityCreateResidentEditor = options => {
    basicDisplay.setForm(options.form);
    const editor = createEditor(options), handle = editor.handle.bind(editor);
    editor.handle = (event, payload) => handle(event, event === 'save'
      ? preserveCategoryHistory(options.person || {}, payload, catalog, options.form) : payload);
    return editor;
  };
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true });
  schedule();
}
