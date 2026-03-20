import { WsServerDurableObject } from 'tinybase/synchronizers/synchronizer-ws-server-durable-object';
import { createMergeableStore } from 'tinybase/mergeable-store';
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage';

export class AppSyncDO extends WsServerDurableObject {
  createPersister() {
    return createDurableObjectSqlStoragePersister(
      createMergeableStore(),
      this.ctx.storage.sql,
      { mode: 'fragmented' },
    );
  }
}
