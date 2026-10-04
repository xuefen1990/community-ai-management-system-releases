const { keyOf } = require('../../src/main/finance-import-integrity');
module.exports = input => ({...input,sourceManifest:{expectedRowKeys:input.rows.map(keyOf),decisions:input.rows.map(row=>({key:keyOf(row),status:'import'})),coverage:input.sheets.map(sheetName=>({sheetName,rows:input.rows.filter(row=>row.sheetName===sheetName).map(row=>row.sourceRowNumber),nonBusiness:[]})),totals:[]}});
