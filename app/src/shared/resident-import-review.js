'use strict';

(function expose(root, factory) {
  const identity = typeof module !== 'undefined' && module.exports ? require('./chinese-identity-card') : root.CommunityIdentityCard;
  const api = factory(identity);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CommunityResidentImportReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createReview(identity) {
  const text = value => String(value ?? '').trim();
  const empty = value => value == null || (typeof value === 'string' && !value.trim());
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const cardOf = person => identity.normalize(person.idCard || person.id_card);
  const nameOf = person => text(person.name);
  const blockedKeys = new Set(['__proto__', 'constructor', 'prototype']);

  // Existing false/0 values and nested information are real data, not blanks.
  function fillEmpty(current, incoming, differences = [], path = '') {
    if (empty(incoming)) return copy(current);
    if (empty(current)) return copy(incoming);
    if (Array.isArray(current) && Array.isArray(incoming)) {
      const keyOf = row => row && typeof row === 'object' ? text(row.key || row.id || row.label) : '';
      if ([...current, ...incoming].every(row => keyOf(row))) {
        const result = copy(current);
        for (const item of incoming) {
          const index = result.findIndex(row => keyOf(row) === keyOf(item));
          if (index < 0) result.push(copy(item));
          else result[index] = fillEmpty(result[index], item, differences, `${path}.${keyOf(item)}`);
        }
        return result;
      }
    } else if (!Array.isArray(current) && !Array.isArray(incoming) && typeof current === 'object' && typeof incoming === 'object') {
      const result = copy(current);
      for (const [key, value] of Object.entries(incoming)) if (!blockedKeys.has(key)) {
        result[key] = fillEmpty(current[key], value, differences, path ? `${path}.${key}` : key);
      }
      return result;
    }
    if (!same(current, incoming)) differences.push({ field: path, current: copy(current), incoming: copy(incoming) });
    return copy(current);
  }

  function auditResidents(people = []) {
    const issues = [], byCard = new Map();
    people.forEach((person, index) => {
      const idCard = cardOf(person), name = nameOf(person);
      const base = { index: index + 1, personId: person.id || '', name, idCard, householdNo: person.householdNo ?? person.household_id ?? '', villageGroupName: person.villageGroupName ?? person.village_group ?? '' };
      if (!name) issues.push({ ...base, type: 'missing-name', reason: '姓名为空' });
      if (!idCard) issues.push({ ...base, type: 'missing-id', reason: '身份证号为空' });
      else {
        const validation = identity.validate(idCard);
        if (!validation.valid) issues.push({ ...base, type: 'invalid-id', reason: `身份证号${validation.reason}` });
        if (!byCard.has(idCard)) byCard.set(idCard, []);
        byCard.get(idCard).push(base);
      }
    });
    let duplicateGroups = 0, nameConflictGroups = 0;
    for (const rows of byCard.values()) if (rows.length > 1) {
      duplicateGroups++;
      const different = new Set(rows.map(row => row.name).filter(Boolean)).size > 1;
      if (different) nameConflictGroups++;
      for (const row of rows) issues.push({ ...row, type: different ? 'name-conflict' : 'duplicate-id', reason: `${different ? '同一身份证对应不同姓名' : '同一身份证有重复档案'}：第 ${rows.map(item => item.index).join('、')} 条`, relatedNames: [...new Set(rows.map(item => item.name))].join('、') });
    }
    return { total: people.length, affected: new Set(issues.map(row => row.index)).size, duplicateGroups, nameConflictGroups,
      missingId: issues.filter(row => row.type === 'missing-id').length, invalidId: issues.filter(row => row.type === 'invalid-id').length, issues };
  }

  function inspectImport({ rows = [], mappings = {}, existingPeople = [], mode = 'batch' }) {
    const byCard = new Map(), grouped = new Map(), invalid = [];
    for (const person of existingPeople) {
      const card = cardOf(person);
      if (!byCard.has(card)) byCard.set(card, []);
      byCard.get(card).push(person);
    }
    const idColumn = mappings.id_card || mappings.idCard, nameColumn = mappings.name;
    rows.forEach((row, index) => {
      const idCard = identity.normalize(row[idColumn]), name = text(row[nameColumn]), rowNo = Number.isInteger(row.__residentSourceRow) ? row.__residentSourceRow : index + 2;
      if (!idCard && !name) return;
      const validation = identity.validate(idCard);
      if (!validation.valid) { invalid.push({ rowNo, name, idCard, reason: idCard ? `身份证号${validation.reason}` : '身份证号为空' }); return; }
      if (!grouped.has(idCard)) grouped.set(idCard, { idCard, rows: [], names: [], original: null });
      const group = grouped.get(idCard);
      group.rows.push({ rowNo, row });
      if (name && !group.names.includes(name)) group.names.push(name);
    });
    const groups = [];
    for (const group of grouped.values()) {
      const matches = byCard.get(group.idCard) || [];
      let reason = matches.length > 1 ? '现有档案中此身份证有多条记录，请先人工核对重复档案' : '';
      group.original = matches[0] || null;
      if (!reason && mode === 'supplement' && !group.original) reason = '系统内无此身份证（补充信息模式下不新增）';
      group.currentName = nameOf(group.original || {});
      group.nameOptions = [...new Set([group.currentName, ...group.names].filter(Boolean))];
      if (!reason && !group.nameOptions.length) reason = '姓名为空';
      if (reason) {
        for (const { rowNo } of group.rows) invalid.push({ rowNo, name: group.names.join(' / '), idCard: group.idCard, reason });
        continue;
      }
      group.nameConflict = group.nameOptions.length > 1;
      groups.push(group);
    }
    return { groups, invalid, totalRows: rows.length, duplicateRows: [...grouped.values()].reduce((sum, group) => sum + group.rows.length - 1, 0),
      nameConflicts: groups.filter(group => group.nameConflict) };
  }

  function planImport(options, legacyBuilder, decisions = {}) {
    const inspection = inspectImport(options), rows = [], selectedGroups = [], differences = [], skipped = [];
    const mappings = { ...options.mappings };
    // Supplement imports may omit a name column; use the verified resident name.
    const nameColumn = mappings.name || '__resident_review_name__';
    mappings.name = nameColumn;
    for (const group of inspection.groups) {
      const selected = group.nameConflict ? decisions[group.idCard] : group.nameOptions[0];
      if (selected === '__skip__') {
        group.rows.forEach(({ rowNo }) => skipped.push({ rowNo, name: group.names.join(' / '), idCard: group.idCard, reason: '人工选择跳过姓名冲突' }));
        continue;
      }
      if (!group.nameOptions.includes(selected)) throw new Error(`请先选择身份证 ${group.idCard} 保留的姓名，或跳过此人`);
      let combined = {};
      for (const { row, rowNo } of group.rows) {
        const rowDiffs = [];
        combined = fillEmpty(combined, row, rowDiffs);
        differences.push(...rowDiffs.filter(item => item.field !== nameColumn && item.field !== '__residentSourceRow').map(item => ({ ...item, rowNo, idCard: group.idCard, name: selected, source: '表格内' })));
      }
      combined[mappings.id_card || mappings.idCard] = group.idCard;
      combined[nameColumn] = selected;
      rows.push(combined); selectedGroups.push({ ...group, selectedName: selected });
    }
    const groupByCard = new Map(selectedGroups.map(group => [group.idCard, group]));
    const originalByCard = new Map(selectedGroups.filter(group => group.original).map(group => [group.idCard, group.original]));
    // The reference converter handles all standard/custom special fields. Clone
    // its inputs because it mutates some nested custom-field arrays internally.
    const legacy = legacyBuilder(copy({ ...options, rows, mappings, mode: 'batch' }));
    const validRows = [], indexMap = new Map(), reviewRows = [];
    let unchangedRows = 0;
    for (const [index, input] of legacy.validRows.entries()) {
      const idCard = identity.normalize(input.fields.idCard), group = groupByCard.get(idCard);
      if (!group) throw new Error('导入检查与转换结果不一致，请重新选择表格');
      const original = originalByCard.get(idCard), rowDifferences = [];
      const item = copy(input);
      item.fields.idCard = idCard;
      item.importReview = { policy: 'fill-empty', expectedPersonId: original?.id || '', previousName: nameOf(original || {}), selectedName: group.selectedName };
      let changed = !original;
      if (original) {
        item.id = original.id;
        item.baseVersion = original.version;
        const fields = {};
        for (const [key, value] of Object.entries(item.fields)) {
          if (key === 'name' || key === 'idCard') continue;
          fields[key] = fillEmpty(original[key], value, rowDifferences, key);
          if (!same(fields[key], original[key])) changed = true;
        }
        fields.name = group.selectedName; fields.idCard = idCard;
        if (fields.name !== original.name) changed = true;
        item.fields = fields;
        for (const key of ['householdNo', 'villageGroupName']) if (Object.hasOwn(item, key)) {
          item[key] = fillEmpty(original[key], item[key], rowDifferences, key);
          if (!same(item[key], original[key])) changed = true;
        }
        if (Object.hasOwn(item, 'tags')) {
          item.tags = [...new Set([...(original.tags || []), ...(item.tags || [])])];
          if (!same(item.tags, original.tags || [])) changed = true;
        }
      }
      differences.push(...rowDifferences.map(diff => ({ ...diff, rowNo: group.rows.map(row => row.rowNo).join('、'), idCard, name: group.selectedName, source: '现有档案' })));
      reviewRows.push({ idCard, name: group.selectedName, rowNo: group.rows.map(row => row.rowNo).join('、'), action: original ? changed ? '补充空白' : '保留原档' : '新增档案' });
      if (changed) { indexMap.set(index, validRows.length); validRows.push(item); }
      else { indexMap.set(index, null); unchangedRows++; }
    }
    const failedList = [...inspection.invalid, ...skipped, ...(legacy.summary.failedList || []).map(row => ({ ...row, rowNo: selectedGroups[row.rowNo - 2]?.rows.map(item => item.rowNo).join('、') || row.rowNo }))];
    const householdGroupCandidates = (legacy.householdGroupCandidates || []).filter(row => {
      const group = groupByCard.get(identity.normalize(row.idCard));
      // A different non-empty household number cannot move an existing resident
      // or establish a household link using the unaccepted spreadsheet value.
      return !group?.original?.householdNo || text(row.householdNo) === text(group.original.householdNo);
    }).map(row => ({ ...row, validRowIndex: row.validRowIndex == null ? null : indexMap.get(row.validRowIndex) }));
    return { validRows, householdGroupCandidates, distinctRelations: legacy.distinctRelations || [], reviewRows, differences, inspection,
      summary: { totalRows: inspection.totalRows, insertedRows: validRows.filter(row => !row.importReview.expectedPersonId).length,
        updatedRows: validRows.filter(row => row.importReview.expectedPersonId).length, unchangedRows, duplicateRows: inspection.duplicateRows,
        nameConflictRows: inspection.nameConflicts.length, failedRows: failedList.length, failedList,
        review: { policy: 'fill-empty', decisions: inspection.nameConflicts.map(group => ({ idCard: group.idCard, previousName: group.currentName, selectedName: decisions[group.idCard] })), differences } } };
  }
  return { fillEmpty, auditResidents, inspectImport, planImport };
});
