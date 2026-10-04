// Associate each mutable legacy editor object with the exact read that created
// it. Main-process transactions merge only the editor's changes into new data.
export function workspaceApi(api) {
  const snapshots = new WeakMap();
  return { ...api,
    async readDb() {
      const { database, token } = await api.readFoundationWorkspace();
      snapshots.set(database, { before: structuredClone(database), token });
      return database;
    },
    async writeDb(database) {
      const snapshot = snapshots.get(database);
      if (!snapshot) throw new Error('页面资料已失效，请重新打开后保存');
      const after = structuredClone(database);
      const result = await api.writeFoundationWorkspace({ ...snapshot, after });
      if (!result.ok) throw new Error(result.error || '保存失败');
      // Preserve object identity used by the existing extension.
      for (const key of Object.keys(database)) delete database[key];
      Object.assign(database, result.database);
      snapshots.set(database, { before: structuredClone(result.database), token: result.token });
      return { ok: true };
    },
  };
}
