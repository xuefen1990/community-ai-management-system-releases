'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CommunityIdentityCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createIdentityCardApi() {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

  function normalize(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/gu, '').toUpperCase();
  }

  function validate(value) {
    const normalized = normalize(value);
    if (!/^\d{17}[\dX]$/u.test(normalized)) {
      return { valid: false, normalized, reason: '必须为18位，末位可以是数字或X' };
    }
    const year = Number(normalized.slice(6, 10));
    const month = Number(normalized.slice(10, 12));
    const day = Number(normalized.slice(12, 14));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return { valid: false, normalized, reason: '中的出生日期不存在' };
    }
    const sum = weights.reduce((total, weight, index) => total + Number(normalized[index]) * weight, 0);
    if (checks[sum % 11] !== normalized[17]) {
      return { valid: false, normalized, reason: '校验码不正确，请核对号码' };
    }
    return {
      valid: true,
      normalized,
      birthDate: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      gender: Number(normalized[16]) % 2 === 1 ? '男' : '女',
      reason: '',
    };
  }

  return Object.freeze({ normalize, validate });
});
