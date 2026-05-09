import Realm from 'realm';
import { RealmSchema, REALM_SCHEMA_VERSION } from './schema';

let realmInstance: Realm | null = null;

export function getRealm(): Realm {
  if (!realmInstance || realmInstance.isClosed) {
    realmInstance = new Realm({
      schema: RealmSchema,
      schemaVersion: REALM_SCHEMA_VERSION,
      migration: (oldRealm, newRealm) => {
        // v1 → v2: Holding 新增 initialShares/initialAvgCost，Transaction 新增 isImported
        if (oldRealm.schemaVersion < 2) {
          const oldHoldings = oldRealm.objects('Holding');
          const newHoldings = newRealm.objects<{
            initialShares: number;
            initialAvgCost: number;
            shares: number;
            avgCost: number;
          }>('Holding');
          for (let i = 0; i < oldHoldings.length; i++) {
            newHoldings[i].initialShares = newHoldings[i].shares;
            newHoldings[i].initialAvgCost = newHoldings[i].avgCost;
          }
        }
        // v2 → v3: 新增 PortfolioSnapshot 表，无需迁移已有数据
      },
      // \u672c\u5730\u52a0\u5bc6 key \u540e\u7eed\u63a5\u5165 iOS Keychain
      // encryptionKey: getEncryptionKey(),
    });
  }
  return realmInstance;
}

export function closeRealm(): void {
  if (realmInstance && !realmInstance.isClosed) {
    realmInstance.close();
    realmInstance = null;
  }
}
