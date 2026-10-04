'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { FoundationDocumentService, documentRows } = require('./foundation-document-service');
const { FoundationAuthService } = require('./foundation-auth-service');
function registerFoundationFileProtocol({ protocol, net, store, authService }) {
  const auth = new FoundationAuthService({ authService });
  const files = new FoundationDocumentService({ store, authorize: request => auth.authorize(request) });
  protocol.handle('community-file', async request => {
    try {
      await auth.authorize({ method: 'GET', path: '/documents' });
      const url = new URL(request.url);
      if (url.hostname !== 'document' || request.method !== 'GET') return new Response('Invalid request', { status: 400 });
      const id = url.searchParams.get('id'), reference = url.searchParams.get('path');
      const document = documentRows(await store.read()).find(record => id ? String(record.id) === id
        : reference && [record.file_path, record.fileObjectRelativePath].includes(reference));
      if (!document) return new Response('Document not found', { status: 404 });
      const remoteChild = await store.isRemoteChild?.() || false;
      const file = remoteChild ? (document.fileObjectRelativePath || document.file_path || document.path) : await files.resolveFile(document);
      // Only passive preview formats run inside the renderer. Active HTML/SVG
      // and executables remain external files opened explicitly by the user.
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.pdf', '.docx', '.xlsx', '.mp4', '.mov', '.mp3', '.wav'].includes(path.extname(file).toLowerCase())) return new Response('Preview unavailable', { status: 415 });
      if (remoteChild) return store.fetchArchivedFile(document.id);
      return net.fetch(pathToFileURL(file).href);
    } catch (error) { return new Response(error.code === 'PRODUCT_AUTH_REQUIRED' ? 'Sign in required' : 'File unavailable', { status: error.code === 'PRODUCT_AUTH_REQUIRED' ? 403 : 404 }); }
  });
}
module.exports = { registerFoundationFileProtocol };
