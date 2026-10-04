'use strict';

const COMMON_PHRASES = ['现将有关情况报告如下', '在上级部门的指导下', '下一步', '特此报告', '请予审议', '以上请示'];

function cleanLines(contentText) {
  return String(contentText || '').split(/\n+/u).map((line) => line.trim()).filter(Boolean);
}

function extractWritingSignals(contentText) {
  const lines = cleanLines(contentText);
  const paragraphs = lines.filter((line) => !/^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])/u.test(line));
  const salutation = lines.find((line) => /^(?:尊敬的|各位).{0,30}[：:]$/u.test(line)) || '';
  const sectionHeadings = lines.filter((line) => /^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])/u.test(line)).slice(0, 12);
  const closing = [...lines].reverse().find((line) => /(?:特此报告|请予审议|以上请示|此致|敬礼)[。！]?$/u.test(line)) || '';
  const averageParagraphLength = paragraphs.length
    ? Math.round(paragraphs.reduce((total, line) => total + line.length, 0) / paragraphs.length)
    : 0;
  const phraseCounts = Object.fromEntries(COMMON_PHRASES.map((phrase) => [phrase, String(contentText || '').split(phrase).length - 1]).filter(([, count]) => count > 0));
  return { salutation, sectionHeadings, closing, averageParagraphLength, phraseCounts };
}

function mostWeighted(weights) {
  return Object.entries(weights || {}).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || '';
}

function updateProfileFromFinal(database, { userId, documentId, versionId = 'initial', contentText, finalizedAt }) {
  if (!userId || !documentId) throw new Error('画像更新缺少管理员或公文编号');
  database.writingProfiles ||= [];
  let profile = database.writingProfiles.find((item) => item.userId === userId);
  const finalizationKey = `${documentId}:${versionId}`;
  if (profile?.sourceFinalizationKeys?.includes(finalizationKey)) return profile;
  if (!profile) {
    profile = { userId, version: 1, finalizedCount: 0, sourceDocumentIds: [], sourceFinalizationKeys: [], salutationWeights: {}, closingWeights: {}, phraseWeights: {}, preferredSectionHeadings: [], averageParagraphLength: 0, updatedAt: null };
    database.writingProfiles.push(profile);
  }
  const signals = extractWritingSignals(contentText);
  const recencyWeight = 2;
  if (signals.salutation) profile.salutationWeights[signals.salutation] = (profile.salutationWeights[signals.salutation] || 0) + recencyWeight;
  if (signals.closing) profile.closingWeights[signals.closing] = (profile.closingWeights[signals.closing] || 0) + recencyWeight;
  for (const [phrase, count] of Object.entries(signals.phraseCounts)) profile.phraseWeights[phrase] = (profile.phraseWeights[phrase] || 0) + count * recencyWeight;
  profile.finalizedCount += 1;
  if (!profile.sourceDocumentIds.includes(documentId)) profile.sourceDocumentIds.push(documentId);
  profile.sourceFinalizationKeys ||= [];
  profile.sourceFinalizationKeys.push(finalizationKey);
  profile.preferredSalutation = mostWeighted(profile.salutationWeights);
  profile.preferredClosing = mostWeighted(profile.closingWeights);
  profile.commonPhrases = Object.entries(profile.phraseWeights).sort((left, right) => right[1] - left[1]).slice(0, 8).map(([phrase]) => phrase);
  profile.preferredSectionHeadings = signals.sectionHeadings.length ? signals.sectionHeadings : profile.preferredSectionHeadings;
  profile.averageParagraphLength = profile.finalizedCount === 1
    ? signals.averageParagraphLength
    : Math.round(((profile.averageParagraphLength * (profile.finalizedCount - 1)) + signals.averageParagraphLength) / profile.finalizedCount);
  profile.preferredTone ||= '正式务实';
  profile.updatedAt = finalizedAt;
  profile.version = (profile.version || 0) + 1;
  return profile;
}

async function currentAccount(getCurrentAccount) {
  const account = await getCurrentAccount();
  if (!account?.id) throw new Error('请先登录管理员账号');
  return account;
}

class WritingProfileService {
  constructor({ databaseStore, getCurrentAccount, now = () => new Date() }) {
    this.databaseStore = databaseStore;
    this.getCurrentAccount = getCurrentAccount;
    this.now = now;
  }

  async get() {
    const account = await currentAccount(this.getCurrentAccount);
    const database = await this.databaseStore.read();
    return structuredClone((database.writingProfiles || []).find((profile) => profile.userId === account.id) || null);
  }

  async save(changes = {}) {
    const account = await currentAccount(this.getCurrentAccount);
    const allowed = ['preferredTone', 'preferredSalutation', 'preferredClosing', 'preferredSectionHeadings', 'commonPhrases', 'averageParagraphLength'];
    const result = await this.databaseStore.update((database) => {
      database.writingProfiles ||= [];
      let profile = database.writingProfiles.find((item) => item.userId === account.id);
      if (!profile) {
        profile = { userId: account.id, version: 1, finalizedCount: 0, sourceDocumentIds: [] };
        database.writingProfiles.push(profile);
      }
      for (const key of allowed) if (Object.hasOwn(changes, key)) profile[key] = structuredClone(changes[key]);
      profile.updatedAt = this.now().toISOString();
      profile.version = (profile.version || 0) + 1;
      return structuredClone(profile);
    });
    return result.result;
  }

  async reset() {
    const account = await currentAccount(this.getCurrentAccount);
    await this.databaseStore.update((database) => {
      database.writingProfiles = (database.writingProfiles || []).filter((profile) => profile.userId !== account.id);
    });
    return { ok: true };
  }
}

module.exports = { extractWritingSignals, updateProfileFromFinal, WritingProfileService };
