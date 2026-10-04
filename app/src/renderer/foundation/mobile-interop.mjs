// Desktop boundary for a future mini program. Only browser file intake is live.
// The proposal types below reserve stable fields; they are not callable APIs yet.
/**
 * @typedef {Object} MobileDeviceProposal
 * @property {number} protocolVersion
 * @property {string} officerId
 * @property {string} deviceId
 * @property {string} pairRequestId
 */
/**
 * @typedef {Object} MobileRecordProposal
 * @property {number} protocolVersion
 * @property {string} deviceId
 * @property {string} operationId Unique per operation for retry deduplication.
 * @property {string} recordId
 * @property {string} baseRevision
 * @property {Object<string, unknown>} changes
 * @property {'pending_review'} status
 */
/**
 * @typedef {Object} MobileRosterCursor
 * @property {number} protocolVersion
 * @property {string} deviceId
 * @property {string} cursor
 * @property {string} auditDigest
 */
export const MOBILE_INTEROP_PROTOCOL_VERSION = 1;

export function createMobileInterop(api) {
  return Object.freeze({
    protocolVersion: MOBILE_INTEROP_PROTOCOL_VERSION,
    capabilities: Object.freeze({ fileUpload: true, devicePairing: false, rosterDownload: false, reviewedSync: false }),
    async getUploadSession() {
      const info = await api.getMobileUploadInfo();
      if (!info?.running || !info.token || !info.port) throw new Error(info?.error || '手机上传服务未能启动');
      const addresses = (info.ips || []).filter(ip => typeof ip === 'string' && ip.trim());
      return {
        expiresAt: info.expiresAt,
        addresses: addresses.map(ip => ({
          ip,
          url: `http://${ip.includes(':') ? `[${ip}]` : ip}:${info.port}${info.shortCode ? `/s/${info.shortCode}` : `/mobile_upload.html?token=${encodeURIComponent(info.token)}`}`,
          qrUrl: `http://${ip.includes(':') ? `[${ip}]` : ip}:${info.port}/mobile_upload.html?token=${encodeURIComponent(info.token)}`,
        })),
      };
    },
    onFileReceived(callback) { return api.onMobileFileUploaded(callback); },
  });
}
