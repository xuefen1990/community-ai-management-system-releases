(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.CommunityFinanceCategoryRules = rules;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const broad = { income: ['上级拨款', '集体经营收入', '补贴资金', '捐赠收入', '其他收入'], expense: ['办公支出', '工程建设', '环境整治', '慰问帮扶', '公益支出', '维修维护', '其他支出'] };
  const specific = { income: ['场地管理费收入', '公共运行经费收入', '土地流转收入', '土地租金收入', '工资及社保经费收入', '工资经费收入', '社保经费收入', '租赁收入', '利息收入'],
    expense: ['水费', '电费', '水电费', '饮用水费', '土地租金支出', '租金支出', '人员报酬', '社保支出', '工资及社保支出', '垃圾清运费', '排涝工程支出', '办公用品费', '通信费', '差旅费', '诉讼费', '体检费', '机械作业费', '道路工程支出', '保洁费', '绿化养护费', '维修费'] };
  const additional = {
    income: ['物业管理费收入', '土地征收补偿收入', '项目补偿收入', '工会会费收入', '危房整改经费收入', '信访维稳经费收入', '城管补助经费收入', '管护劳务收入', '帮扶资金收入', '鱼塘承包收入'],
    expense: ['评估费', '工伤补偿费', '拆迁补偿支出', '征地补偿支出', '项目补偿支出', '日用品费', '宣传材料费', '工作餐费', '代理记账费', '租车费', '办公家具费', '办公设备费', '监控设备费', '灯具购置费', '门窗购置安装费', '安装材料费', '排水设施工程支出', '房屋改造工程支出', '道路交通设施费', '文化活动费', '职工福利费', '慰问费', '图书购置费', '防尘网购置费', '除雪材料费', '摄影摄像费', '公共设施维护费', '土方清运费', '绿化清理费', '拆除工程支出', '运输费', '环境整治费', '劳务费', '土地流转支出'],
  };
  const categories = Object.freeze(Object.fromEntries(Object.keys(broad).map(type => [type, Object.freeze([...broad[type], ...specific[type], ...additional[type]])])));
  const validCategory = value => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 40 && !/[<>\u0000-\u001f\u007f\uFFFD]/u.test(value);
  const aliases = { 自来水费: '水费', 用水费: '水费', 用电费: '电费', 电力费: '电费', 桶装水费: '饮用水费', 瓶装水费: '饮用水费', 人员工资: '人员报酬', 工资报酬: '人员报酬', 工资: '人员报酬', 土地租金: '土地租金支出', 土地租赁费: '土地租金支出', 土地租赁支出: '土地租金支出', 土地租赁收入: '土地租金收入', 清运费: '垃圾清运费', 垃圾清理费: '垃圾清运费' };
  function canonicalCategory(value, catalog, type) {
    const name = String(value || '').trim(); if (!validCategory(name) || !['income','expense'].includes(type)) return '';
    const canonical = type === 'income' && ['土地租金','土地租赁费'].includes(name) ? '土地租金收入' : aliases[name] || name;
    return (catalog[type] || []).find(existing => !broad[type].includes(existing) && (aliases[existing] || existing) === canonical) || canonical;
  }
  function classifySummary(type, summary, catalog = categories) {
    if (!['income','expense'].includes(type)) return null;
    const text = String(summary || '').trim(); if (!text) return null;
    const wage = /工资|报酬|薪酬|津贴|补贴.*(?:组长|临干)|(?:组长|临干|委员会成员).*(?:工作)?补助/u.test(text), social = /社保|社会保险/u.test(text);
    const legal = /诉讼|律师|法律服务/u.test(text), assessment = /评估/u.test(text), compensation = /补偿|征地款/u.test(text);
    const detailed = type === 'income' ? [
      ['物业管理费收入', /物业.*管理费/u.test(text) && !/(?:场地|地块|空间).*管理费/u.test(text)],
      ['土地征收补偿收入', /征地|土地征收|鱼塘征收/u.test(text) && compensation],
      ['项目补偿收入', compensation && !/征地|土地征收|鱼塘征收/u.test(text)],
      ['工会会费收入', /工会.*会费/u.test(text)],
      ['危房整改经费收入', /危房.*(?:整改|改造).*(?:资金|经费|款)/u.test(text)],
      ['信访维稳经费收入', /信访|维稳/u.test(text) && /经费|补助|资金/u.test(text)],
      ['城管补助经费收入', /城管.*(?:补助|经费|资金)/u.test(text)],
      ['管护劳务收入', /管护|清理/u.test(text) && /劳务费/u.test(text)],
      ['帮扶资金收入', /帮扶款|帮扶资金/u.test(text)], ['鱼塘承包收入', /鱼塘.*承包费/u.test(text)],
    ] : [
      ['评估费', assessment], ['工伤补偿费', compensation && /受伤|工伤/u.test(text)],
      ['拆迁补偿支出', compensation && /拆除|拆迁|违建/u.test(text) && !/受伤|工伤/u.test(text)],
      ['征地补偿支出', compensation && /征地|土地征收|鱼塘征收/u.test(text) && !/受伤|工伤|拆除|拆迁|违建/u.test(text)],
      ['项目补偿支出', compensation && !/受伤|工伤|拆除|拆迁|违建|征地|土地征收|鱼塘征收/u.test(text)],
      ['日用品费', /日用品/u.test(text)], ['宣传材料费', /宣传.*材料|广告.*制作/u.test(text)],
      ['工作餐费', /工作餐|盒饭/u.test(text)], ['代理记账费', /代账|代理记账/u.test(text)], ['租车费', /租车/u.test(text)],
      ['办公家具费', /办公桌|办公.*桌椅|办公.*家具/u.test(text)],
      ['办公设备费', /办公设备|电脑|投影仪|音响设备|无人机|空调/u.test(text) && !/维修|修理|处置/u.test(text)],
      ['监控设备费', /监控设备/u.test(text) && !/维修|修理/u.test(text)],
      ['灯具购置费', /灯具/u.test(text) && !/维修|修理/u.test(text)],
      ['门窗购置安装费', /电动门|办公室门|门窗.*安装|安装.*门窗|锁具/u.test(text) && !/维修|修理|补偿|拆除/u.test(text)],
      ['安装材料费', /安装材料/u.test(text)], ['排水设施工程支出', /下水道|下水沟|管道预埋/u.test(text) && !assessment && !compensation],
      ['房屋改造工程支出', /彩钢瓦|地盘铺设|车位改造/u.test(text) && !assessment && !compensation],
      ['道路交通设施费', /减速带|护栏/u.test(text) && !compensation],
      ['文化活动费', /宣传演出|重阳节活动/u.test(text)], ['职工福利费', /工会.*福利|职工福利/u.test(text)],
      ['慰问费', /慰问/u.test(text)], ['图书购置费', /图书款|图书购置/u.test(text)],
      ['防尘网购置费', /防尘网/u.test(text)], ['除雪材料费', /除雪.*(?:盐|材料)/u.test(text)],
      ['摄影摄像费', /录像|摄影|摄像/u.test(text)],
      ['公共设施维护费', /公共维护经费/u.test(text) && !wage],
      ['土方清运费', /清运土方|土方清运/u.test(text)], ['绿化清理费', /杂树.*清理/u.test(text)],
      ['拆除工程支出', /拆除|违建.*清理|清理.*违建/u.test(text) && !compensation],
      ['运输费', /运输车|运输费/u.test(text) && !/垃圾|土方/u.test(text)],
      ['环境整治费', /环境整治|清洁家园/u.test(text) && !/地盘铺设|运输车|运输费|排涝|垃圾/u.test(text)],
      ['劳务费', /杂工|劳务费/u.test(text) && !/垃圾|排涝|排水沟|清洁家园|环境整治|保洁|补偿/u.test(text)],
      ['土地流转支出', /土地.*流转/u.test(text) && !/租金|租赁|诉讼|补偿/u.test(text)],
    ];
    const rules = type === 'income' ? [
      ['场地管理费收入', /(?:场地|地块|空间).*管理费/u.test(text)],
      ['公共运行经费收入', /公共.*运行.*经费/u.test(text)],
      ['工资及社保经费收入', wage && social], ['工资经费收入', wage && !social], ['社保经费收入', social && !wage],
      ['土地流转收入', /(?:土地|地).*流转/u.test(text)], ['土地租金收入', /(?:土地|地块).*租[金赁]|租[金赁].*(?:土地|地块)/u.test(text)],
      ['租赁收入', /租金|租赁|承包费/u.test(text) && !/土地|地块|流转|鱼塘/u.test(text)], ['利息收入', /利息/u.test(text)],
    ] : [
      ['饮用水费', /桶装水|瓶装水|饮用水/u.test(text)],
      ['水电费', /水电费|水费.*电费|电费.*水费/u.test(text)],
      ['水费', /水费|用水账单|自来水费/u.test(text) && !/桶装水|瓶装水|饮用水|电费/u.test(text)],
      ['电费', /电费|用电账单/u.test(text) && !/水费|水电费/u.test(text)],
      ['土地租金支出', /土地.*租[金赁]|租[金赁].*土地|流转.*租金/u.test(text) && !legal && !compensation],
      ['租金支出', /租金|租赁费/u.test(text) && !/土地|流转/u.test(text) && !legal && !compensation],
      ['工资及社保支出', wage && social], ['人员报酬', wage && !social], ['社保支出', social && !wage],
      ['垃圾清运费', /垃圾|杂工.*清[运理]/u.test(text) && /清[运理扫]|转运|环卫|垃圾费|垃圾.*杂工|杂工.*垃圾/u.test(text)],
      ['排涝工程支出', /排涝|排水沟|疏浚/u.test(text)], ['道路工程支出', /道路.*(?:工程|施工|硬化)|路面.*(?:工程|硬化)/u.test(text)],
      ['办公用品费', /办公用品|办公耗材|纸张|文具|打印纸|复印纸/u.test(text)], ['通信费', /电话费|通信费|网络费|宽带费/u.test(text)],
      ['差旅费', /差旅|出差/u.test(text)], ['诉讼费', legal], ['体检费', /体检/u.test(text) && !/租车/u.test(text)],
      ['机械作业费', /机械费|机械作业/u.test(text) && !/垃圾|排涝|道路|环境整治|杂树|违建|土方/u.test(text)],
      ['保洁费', /保洁|清扫/u.test(text) && !/垃圾/u.test(text)], ['绿化养护费', /绿化.*(?:养护|维护|费用)|苗木|树木养护/u.test(text)],
      ['维修费', /维修|修缮|修理/u.test(text)],
    ];
    const matches = [...detailed, ...rules].filter(([, matched]) => matched).map(([name]) => name);
    // Only these combinations describe the same transaction rather than separate uses.
    const names = [...new Set(matches)];
    if (names.length > 1) return null;
    if (names.length === 1) return { category: canonicalCategory(names[0],catalog,type), categorySource:'rules', reason:'根据摘要明确用途识别' };
    const known = (catalog[type] || []).filter(name => !broad[type].includes(name) && text.includes(name));
    if (known.length === 1) return { category: canonicalCategory(known[0],catalog,type), categorySource:'rules', reason:'匹配已有具体科目' };
    return null;
  }
  return { categories, broad, validCategory, canonicalCategory, classifySummary };
}));
