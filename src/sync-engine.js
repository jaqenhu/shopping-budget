/* >_ sync-engine · 小账本的同步内核 🔄
 * 维护入口：本文件；发布副本：由 scripts/embed-runtime.cjs 嵌入 index.html。
 * dirty 留住待同步修改，revision 检测云端冲突，epoch 隔离账号切换后的迟到响应。
 */
(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  class BudgetSyncEngine {
    constructor(options) {
      this.options = options;
      this.storage = options.storage;
      this.prefix = options.prefix || "double11-cloud-v1:";
      this.epoch = 0;
      this.userId = null;
      this.entry = null;
      this.conflict = null;
      this.ready = false;
      this.loading = false;
      this.writing = false;
      this.cached = true;
      this.sequence = 0;
      this.timer = null;
      this.refreshPromise = null;
      this.lastCacheRaw = null;
    }
    status(kind, detail = "") {
      this.kind = kind;
      this.options.onStatus?.({kind, detail, cached: this.cached,
        dirty: Boolean(this.entry?.dirty), ready: this.ready,
        loading: this.loading, conflict: Boolean(this.conflict)});
    }
    cache() {
      if (!this.entry || !this.userId) return false;
      const raw = JSON.stringify(this.entry);
      try {
        const key = this.prefix + this.userId;
        const current = this.storage.getItem(key);
        // [guard] 别覆盖另一个标签页还没同步的草稿。
        if (current && current !== this.lastCacheRaw) {
          const other = JSON.parse(current);
          if (!this.validEntry(other) || other.dirty && JSON.stringify(other.payload) !== JSON.stringify(this.entry.payload)) {
            throw new Error("OTHER_TAB_PENDING");
          }
        }
        this.storage.setItem(key, raw);
        if (this.storage.getItem(key) !== raw) throw new Error("CACHE_VERIFY");
        this.lastCacheRaw = raw;
        this.cached = true;
      } catch { this.cached = false; }
      return this.cached;
    }
    validEntry(entry) {
      return entry && this.options.validate(entry.payload) &&
        (entry.revision === null || Number.isSafeInteger(entry.revision) && entry.revision >= 0) &&
        typeof entry.dirty === "boolean";
    }
    validRemote(row) {
      return row === null || row && this.options.validate(row.payload) &&
        Number.isSafeInteger(row.revision) && row.revision >= 0;
    }
    cancelTimer() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }
    deactivate() {
      this.cancelTimer();
      // [epoch] 账号切换后，旧请求返回也不能再改动当前清单。
      this.epoch++;
      this.userId = null;
      this.entry = null;
      this.conflict = null;
      this.ready = false;
      this.loading = false;
      this.writing = false;
      this.refreshPromise = null;
      this.lastCacheRaw = null;
      this.status("signed-out");
    }
    async activate(userId) {
      this.deactivate();
      this.userId = userId;
      this.cached = true;
      try {
        const raw = this.storage.getItem(this.prefix + userId);
        if (raw) {
          const entry = JSON.parse(raw);
          if (this.validEntry(entry)) {
            this.entry = entry;
            this.lastCacheRaw = raw;
            this.ready = true;
            this.options.onState?.(clone(entry.payload));
          }
        }
      } catch { this.cached = false; }
      return this.refresh();
    }
    async refresh() {
      if (!this.userId) return;
      if (this.refreshPromise) return this.refreshPromise;
      if (this.writing) return;
      const epoch = this.epoch;
      const userId = this.userId;
      const task = this.readLatest(epoch, userId);
      this.refreshPromise = task;
      try { await task; }
      finally { if (epoch === this.epoch && this.refreshPromise === task) this.refreshPromise = null; }
    }
    async readLatest(epoch, userId) {
      this.loading = true;
      this.status("loading");
      try {
        const row = await this.options.readRemote(userId);
        if (epoch !== this.epoch) return;
        if (!this.validRemote(row)) throw new Error("INVALID_REMOTE");
        if (this.entry?.dirty) {
          const sameBase = (row?.revision ?? null) === this.entry.revision;
          if (!sameBase) {
            this.conflict = {remote: row ? clone(row) : null};
            this.ready = true;
            this.loading = false;
            this.status("conflict");
            return;
          }
          this.conflict = null;
          this.ready = true;
          this.loading = false;
          this.status("pending");
          await this.flush();
          return;
        }
        this.conflict = null;
        // [empty] 云端没有记录时只展示空清单，不顺手上传本地示例。
        this.entry = {payload: row ? clone(row.payload) : this.options.emptyState(),
          revision: row?.revision ?? null, dirty: false};
        this.ready = true;
        this.cache();
        this.options.onState?.(clone(this.entry.payload));
        this.loading = false;
        this.status(row ? "synced" : "empty");
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.loading = false;
        this.ready = Boolean(this.entry);
        this.status(this.entry?.dirty ? "pending-error" : "read-error", error.message);
      }
    }
    stage(payload) {
      if (!this.userId || !this.ready || this.loading || this.conflict) throw new Error("NOT_READY");
      if (!this.options.validate(payload)) throw new Error("INVALID_LOCAL");
      this.entry.payload = clone(payload);
      this.entry.dirty = true;
      this.sequence++;
      const saved = this.cache();
      this.status(saved ? "pending" : "pending-uncached");
      this.cancelTimer();
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.options.delay ?? 650);
      return saved;
    }
    async flush() {
      this.cancelTimer();
      if (!this.userId || !this.entry?.dirty || !this.ready || this.loading || this.conflict || this.writing) return;
      const epoch = this.epoch;
      const userId = this.userId;
      this.writing = true;
      try {
        while (epoch === this.epoch && this.entry?.dirty && !this.conflict) {
          const payload = clone(this.entry.payload);
          // [snapshot] 版本用于条件写入；序号识别请求途中新增的本地修改。
          const revision = this.entry.revision;
          const sequence = this.sequence;
          this.status("saving");
          const result = await this.options.writeRemote({userId, payload, revision});
          if (epoch !== this.epoch) return;
          if (result?.conflict) {
            this.conflict = {remote: undefined};
            this.status("conflict");
            try {
              const row = await this.options.readRemote(userId);
              if (epoch !== this.epoch) return;
              if (!this.validRemote(row)) throw new Error("INVALID_REMOTE");
              this.conflict = {remote: row ? clone(row) : null};
              this.status("conflict");
            } catch (error) {
              if (epoch === this.epoch) this.status("conflict", error.message);
            }
            return;
          }
          if (!result || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
              result.revision !== (revision === null ? 0 : revision + 1)) throw new Error("INVALID_SAVE_RESPONSE");
          this.entry.revision = result.revision;
          this.entry.dirty = this.sequence !== sequence;
          this.cache();
          this.status(this.entry.dirty ? "pending" : "synced");
        }
      } catch (error) {
        if (epoch === this.epoch) this.status(this.cached ? "pending-error" : "pending-uncached", error.message);
      } finally {
        if (epoch === this.epoch) this.writing = false;
      }
    }
    async retry() {
      if (!this.userId) return;
      await this.refresh();
    }
    async useRemote() {
      if (!this.conflict || this.conflict.remote === undefined) return false;
      const row = this.conflict.remote;
      // [undo buffer] 切换到云端版本前，先写好本地恢复副本。
      const recovery = JSON.stringify({savedAt: new Date().toISOString(), ...this.entry});
      try {
        const key = this.prefix + this.userId + ":conflict-recovery";
        this.storage.setItem(key, recovery);
        if (this.storage.getItem(key) !== recovery) return false;
      } catch { return false; }
      this.entry = {payload: row ? clone(row.payload) : this.options.emptyState(), revision: row?.revision ?? null, dirty: false};
      this.conflict = null;
      this.sequence++;
      this.cache();
      this.options.onState?.(clone(this.entry.payload));
      this.status(row ? "synced" : "empty");
      return true;
    }
    async keepLocal() {
      if (!this.conflict || this.conflict.remote === undefined) return false;
      this.entry.revision = this.conflict.remote?.revision ?? null;
      this.entry.dirty = true;
      this.conflict = null;
      this.sequence++;
      this.cache();
      this.status("pending");
      await this.flush();
      return true;
    }
    needsUnloadWarning() {
      return Boolean(this.entry?.dirty);
    }
  }
  root.BudgetSyncEngine = BudgetSyncEngine;
  if (typeof module === "object" && module.exports) module.exports = {BudgetSyncEngine};
})(typeof globalThis !== "undefined" ? globalThis : this);
