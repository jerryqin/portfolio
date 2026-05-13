import { create } from 'zustand';
import Realm from 'realm';
import { Alert } from 'react-native';
import { getRealm } from '../database';
import { Portfolio, Holding, Transaction, PortfolioSnapshot, DailySnapshot } from '../database/schema';
import { fetchBatchQuotes, fetchHistorical } from '../services/yahooFinance';
import { calcAvgCost } from '../utils/finance';
import type { ParsedRow, CashAdjustRow } from '../utils/csvImport';

interface PortfolioStore {
  // 当前选中组合
  activePortfolioId: string | null;
  setActivePortfolioId: (id: string) => void;

  // 刷新行情价格
  refreshPrices: (portfolioId: string) => Promise<void>;
  isPriceLoading: boolean;

  // 新建组合
  createPortfolio: (data: Partial<Portfolio>) => string;

  // 新增交易并自动更新持仓成本
  addTransaction: (tx: {
    portfolioId: string;
    holdingId: string;
    ticker: string;
    type: Transaction['type'];
    date: Date;
    price: number;
    shares: number;
    commission: number;
    tax: number;
    notes: string;
  }) => void;

  // 新增持仓标的
  addHolding: (data: {
    portfolioId: string;
    ticker: string;
    name: string;
    tranche: 'core' | 'satellite' | 'trading';
    targetWeight: number;
    shares: number;
    avgCost: number;
  }) => string;

  // 激活组合（校验仓位 = 100%）
  activatePortfolio: (portfolioId: string) => { ok: boolean; error?: string };

  // 批量导入 CSV 交易流水
  batchImportTransactions: (portfolioId: string, rows: ParsedRow[], cashRows?: CashAdjustRow[]) => Promise<{
    imported: number;
  }>;

  // 删除组合及其全部持仓、流水
  deletePortfolio: (portfolioId: string) => void;

  // 删除单个持仓及其全部流水
  deleteHolding: (holdingId: string) => void;

  // 快照管理
  saveSnapshot: (portfolioId: string, label: string) => void;
  restoreSnapshot: (snapshotId: string) => void;
  deleteSnapshot: (snapshotId: string) => void;

  // 全量备份 / 恢复
  exportAllData: () => string;
  importAllData: (jsonStr: string) => void;
}

export const usePortfolioStore = create<PortfolioStore>((set, get) => ({
  activePortfolioId: null,
  isPriceLoading: false,

  setActivePortfolioId: (id) => set({ activePortfolioId: id }),

  createPortfolio: (data) => {
    const realm = getRealm();
    let newId = '';
    realm.write(() => {
      const portfolio = realm.create(Portfolio, {
        name: data.name ?? '新组合',
        investmentStyle: data.investmentStyle ?? '',
        createdAt: new Date(),
        initialCapital: data.initialCapital ?? 0,
        currentCapital: data.currentCapital ?? data.initialCapital ?? 0,
        market: data.market ?? 'US',
        currency: data.currency ?? 'USD',
        benchmarkIndex: data.benchmarkIndex ?? 'SPY',
        isArchived: false,
        isDraft: true,
        updatedAt: new Date(),
      });
      newId = portfolio._id.toHexString();
    });
    return newId;
  },

  addHolding: (data) => {
    const realm = getRealm();
    const portfolioId = new Realm.BSON.ObjectId(data.portfolioId);
    let newId = '';
    realm.write(() => {
      const holding = realm.create(Holding, {
        portfolioId,
        ticker: data.ticker.toUpperCase(),
        name: data.name,
        tranche: data.tranche,
        targetWeight: data.targetWeight,
        shares: data.shares,
        avgCost: data.avgCost,
        initialShares: data.shares,
        initialAvgCost: data.avgCost,
        currentPrice: data.avgCost, // 先用成本价占位，刷新行情后更新
        isDisabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      newId = holding._id.toHexString();
    });
    return newId;
  },

  activatePortfolio: (portfolioId) => {
    const realm = getRealm();
    const id = new Realm.BSON.ObjectId(portfolioId);
    const holdings = realm
      .objects(Holding)
      .filtered('portfolioId == $0 AND isDisabled == false', id);

    // 只在已有持仓时校验权重，空组合允许直接激活
    if (holdings.length > 0) {
      const totalWeight = holdings.reduce((sum, h) => sum + h.targetWeight, 0);
      // 允许 0.01% 的浮点误差
      if (Math.abs(totalWeight - 100) > 0.01) {
        return {
          ok: false,
          error: `目标仓位总和为 ${totalWeight.toFixed(2)}%，必须等于 100%`,
        };
      }
    }

    realm.write(() => {
      const portfolio = realm.objectForPrimaryKey(Portfolio, id);
      if (portfolio) {
        portfolio.isDraft = false;
        portfolio.updatedAt = new Date();
      }
    });
    return { ok: true };
  },

  addTransaction: (tx) => {
    const realm = getRealm();
    const portfolioId = new Realm.BSON.ObjectId(tx.portfolioId);
    const holdingId = new Realm.BSON.ObjectId(tx.holdingId);

    realm.write(() => {
      // 写入流水
      realm.create(Transaction, {
        portfolioId,
        holdingId,
        ticker: tx.ticker,
        type: tx.type,
        date: tx.date,
        price: tx.price,
        shares: tx.shares,
        commission: tx.commission,
        tax: tx.tax,
        notes: tx.notes,
      });

      // 更新持仓
      const holding = realm.objectForPrimaryKey(Holding, holdingId);
      if (!holding) return;

      // 更新现金（currentCapital 代表现金余额）
      const portfolio = realm.objectForPrimaryKey(Portfolio, portfolioId);
      if (portfolio) {
        if (tx.type === 'buy') {
          portfolio.currentCapital -= tx.shares * tx.price + tx.commission + tx.tax;
        } else if (tx.type === 'sell') {
          portfolio.currentCapital += tx.shares * tx.price - tx.commission - tx.tax;
        } else if (tx.type === 'dividend') {
          portfolio.currentCapital += tx.shares * tx.price; // price 字段存每股分红额
        }
        portfolio.updatedAt = new Date();
      }

      if (tx.type === 'buy') {
        holding.avgCost = calcAvgCost(
          holding.shares,
          holding.avgCost,
          tx.shares,
          tx.price,
        );
        holding.shares += tx.shares;
      } else if (tx.type === 'sell') {
        holding.shares -= tx.shares;
        if (holding.shares < 0) holding.shares = 0;
      } else if (tx.type === 'split') {
        // 拆股：shares *= splitRatio（price 字段存拆股比例）
        holding.avgCost = holding.avgCost / tx.price;
        holding.shares *= tx.price;
      }
    });
  },

  refreshPrices: async (portfolioId) => {
    set({ isPriceLoading: true });
    try {
      const realm = getRealm();
      const id = new Realm.BSON.ObjectId(portfolioId);
      const holdings = realm
        .objects(Holding)
        .filtered('portfolioId == $0 AND isDisabled == false', id);

      const tickers = [...new Set(holdings.map(h => h.ticker))];
      const quotes = await fetchBatchQuotes(tickers);
      const priceMap = new Map(quotes.map(q => [q.ticker, q.price]));

      realm.write(() => {
        for (const holding of holdings) {
          const price = priceMap.get(holding.ticker);
          if (price !== undefined) {
            holding.currentPrice = price;
            holding.priceUpdatedAt = new Date();
          }
        }

        // 刷新后写入/更新今日 DailySnapshot，用于最大回撤、夏普等指标计算
        const portfolio = realm.objectForPrimaryKey(Portfolio, id);
        if (portfolio) {
          const totalValue = Array.from(holdings).reduce(
            (s, h) => s + h.shares * h.currentPrice,
            0,
          );
          // 从流水从头重算现金余额，避免依赖可能有误差的 currentCapital 字段
          const allTxs = Array.from(realm.objects(Transaction).filtered('portfolioId == $0', id));
          let cashBalance = portfolio.initialCapital;
          let totalDeposits = 0;
          for (const tx of allTxs) {
            if (tx.ticker === '__CASH__') {
              const amount = tx.price * tx.shares;
              cashBalance += amount;
              totalDeposits += amount;
            } else if (tx.type === 'buy') {
              cashBalance -= tx.shares * tx.price;
            } else if (tx.type === 'sell') {
              cashBalance += tx.shares * tx.price;
            } else if (tx.type === 'dividend') {
              cashBalance += tx.price * tx.shares;
            }
          }
          const totalCapital = Math.max(portfolio.initialCapital + totalDeposits, portfolio.initialCapital);
          const totalAssets = totalValue + cashBalance;
          const nav =
            totalCapital > 0 ? totalAssets / totalCapital : 1;

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today.getTime() + 86400000);
          const existing = realm
            .objects(DailySnapshot)
            .filtered('portfolioId == $0 AND date >= $1 AND date < $2', id, today, tomorrow)[0];

          if (existing) {
            existing.totalValue = totalAssets;
            existing.navPerUnit = nav;
            existing.cumulativeReturn = nav - 1;
          } else {
            realm.create(DailySnapshot, {
              portfolioId: id,
              date: new Date(),
              totalValue: totalAssets,
              cashFlow: 0,
              navPerUnit: nav,
              cumulativeReturn: nav - 1,
              maxDrawdown: 0,
              volatility: 0,
              sharpeRatio: 0,
            });
          }
        }
      });
    } catch (e: any) {
      Alert.alert('行情刷新失败', e?.message ?? '请检查网络后重试');
    } finally {
      set({ isPriceLoading: false });
    }
  },

  batchImportTransactions: async (portfolioId, rows, cashRows = []) => {
    const realm = getRealm();
    const pId = new Realm.BSON.ObjectId(portfolioId);

    // 自动纳入 CSV 中出现的标的，保证按全标的口径回放
    const existingHoldings = realm
      .objects(Holding)
      .filtered('portfolioId == $0 AND isDisabled == false', pId);
    const holdingMap = new Map<string, Holding>();
    for (const h of existingHoldings) {
      holdingMap.set(h.ticker, h);
    }

    const portfolioSnap = realm.objectForPrimaryKey(Portfolio, pId);
    if (!portfolioSnap) return { imported: 0 };
    const initialCapital = portfolioSnap.initialCapital;

    let imported = 0;

    // 四舍五入到4位小数，消除浮点 toString 差异导致的去重失效
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const makeKey = (ticker: string, type: string, date: Date, shares: number, price: number) => {
      const d = date;
      return `${ticker}|${type}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${r4(shares)}|${r4(price)}`;
    };

    realm.write(() => {
      const portfolio = realm.objectForPrimaryKey(Portfolio, pId);
      if (!portfolio) return;

      // ── 构建去重集合（已存在的导入流水）──
      const existingImported = realm
        .objects(Transaction)
        .filtered('portfolioId == $0 AND isImported == true', pId);
      const importedKeys = new Set<string>();
      for (const tx of existingImported) {
        importedKeys.add(makeKey(tx.ticker, tx.type, tx.date, tx.shares, tx.price));
      }

      // ── 写入股票交易（只写去重后的新流水，以 delta 更新持仓和现金）──
      for (const row of rows) {
        let holding = holdingMap.get(row.ticker);
        if (!holding) {
          holding = realm.create(Holding, {
            portfolioId: pId,
            ticker: row.ticker,
            name: row.ticker,
            tranche: 'trading',
            targetWeight: 0,
            shares: 0,
            avgCost: 0,
            initialShares: 0,
            initialAvgCost: 0,
            currentPrice: row.price,
            isDisabled: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          holdingMap.set(row.ticker, holding);
        }

        // 股息若 shares/price 均为0，将总金额编码为 price=amount, shares=1，便于后续重算
        const storedShares = (row.type === 'dividend' && row.shares === 0) ? 1 : row.shares;
        const storedPrice  = (row.type === 'dividend' && row.shares === 0) ? row.amount : row.price;

        const key = makeKey(row.ticker, row.type, row.date, storedShares, storedPrice);
        if (importedKeys.has(key)) continue;
        importedKeys.add(key);

        realm.create(Transaction, {
          portfolioId: pId,
          holdingId: holding._id,
          ticker: row.ticker,
          type: row.type,
          date: row.date,
          price: storedPrice,
          shares: storedShares,
          commission: 0,
          tax: 0,
          notes: row.notes,
          isImported: true,
        });

        // 持仓 delta（仅对本次新写入的流水）
        if (row.type === 'buy') {
          holding.avgCost = calcAvgCost(holding.shares, holding.avgCost, row.shares, row.price);
          holding.shares += row.shares;
        } else if (row.type === 'sell') {
          holding.shares = Math.max(0, holding.shares - row.shares);
        }

        // 现金 delta（仅对本次新写入的流水）
        if (row.type === 'buy')           portfolio.currentCapital -= row.shares * row.price;
        else if (row.type === 'sell')     portfolio.currentCapital += row.shares * row.price;
        else if (row.type === 'dividend') portfolio.currentCapital += row.amount;

        holding.updatedAt = new Date();
        imported++;
      }

      // ── 写入现金调整行（存为 __CASH__ dividend，天然去重，彻底防止重复叠加）──
      // 兼容旧版本迁移：若本次 imported=0（全部已存在）且 __CASH__ 流水也为0，
      // 说明是旧代码导入的数据（cashRows 已直接加入 currentCapital），跳过以防重复。
      const existingCashTxCount = realm
        .objects(Transaction)
        .filtered('portfolioId == $0 AND ticker == "__CASH__"', pId).length;
      const isLegacyData = imported === 0 && existingCashTxCount === 0 &&
        existingImported.length > 0;

      if (!isLegacyData) {
        for (const cr of cashRows) {
          const key = makeKey('__CASH__', 'dividend', cr.date, 1, cr.amount);
          if (importedKeys.has(key)) continue;
          importedKeys.add(key);

          // holdingId 使用 portfolioId 作为占位符（Realm 无外键约束）
          realm.create(Transaction, {
            portfolioId: pId,
            holdingId: pId,
            ticker: '__CASH__',
            type: 'dividend',
            date: cr.date,
            price: cr.amount,
            shares: 1,
            commission: 0,
            tax: 0,
            notes: cr.notes,
            isImported: true,
          });

          portfolio.currentCapital += cr.amount;
        }
      }
    });

    // ── DailySnapshot：拉取历史行情，按每个交易日实际市价重建（幂等）──
    const allImportedTxs = Array.from(
      realm.objects(Transaction)
        .filtered('portfolioId == $0 AND isImported == true', pId)
        .sorted('date'),
    );

    if (allImportedTxs.length > 0) {
      const byDate = new Map<string, typeof allImportedTxs>();
      for (const tx of allImportedTxs) {
        const d = tx.date;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!byDate.has(dateStr)) byDate.set(dateStr, []);
        byDate.get(dateStr)!.push(tx);
      }

      const txDates = [...byDate.keys()].sort();
      const firstTxDateStr = txDates[0];

      // 总投入资本（分母）
      const totalCashDeposits = allImportedTxs
        .filter(t => t.ticker === '__CASH__')
        .reduce((s, t) => s + t.price * t.shares, 0);
      const totalCapital = Math.max(initialCapital + totalCashDeposits, initialCapital);

      // ── 拉取所有标的历史行情 ──
      const uniqueTickers = [...new Set(
        allImportedTxs.filter(t => t.ticker !== '__CASH__').map(t => t.ticker),
      )];
      const priceHistory = new Map<string, Map<string, number>>(); // ticker → dateStr → close
      await Promise.allSettled(uniqueTickers.map(async ticker => {
        try {
          const bars = await fetchHistorical(ticker, 'max', '1d');
          const dateMap = new Map<string, number>();
          for (const bar of bars) {
            if (bar.close > 0) {
              const d = bar.date;
              const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              dateMap.set(ds, bar.close);
            }
          }
          priceHistory.set(ticker, dateMap);
        } catch {
          // 网络失败时跳过该标的，后续用成交价填充
        }
      }));

      // ── 合并所有交易日（行情日历 ∪ 交易日）──
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const tradingDatesSet = new Set<string>();
      for (const ds of txDates) tradingDatesSet.add(ds);
      for (const [, dateMap] of priceHistory) {
        for (const ds of dateMap.keys()) {
          if (ds >= firstTxDateStr && ds <= todayStr) tradingDatesSet.add(ds);
        }
      }
      const allTradingDates = [...tradingDatesSet].sort();

      const minDate = new Date(allTradingDates[0]);
      const maxDate = new Date(today.getTime() + 86400000); // 明天 00:00，确保包含今天

      const simShares = new Map<string, number>();
      const simPrice  = new Map<string, number>(); // 当前已知最新市价（fill-forward）
      let simCash = totalCapital;

      realm.write(() => {
        // 删除该范围内全部旧快照（完全重建）
        const existingSnaps = realm
          .objects(DailySnapshot)
          .filtered('portfolioId == $0 AND date >= $1 AND date < $2', pId, minDate, maxDate);
        realm.delete(existingSnaps);

        for (const dateStr of allTradingDates) {
          // 1. 当日交易处理
          const dayTxs = byDate.get(dateStr) ?? [];
          for (const tx of dayTxs) {
            if (tx.ticker === '__CASH__') continue;
            if (tx.type === 'buy') {
              simShares.set(tx.ticker, (simShares.get(tx.ticker) ?? 0) + tx.shares);
              // 若行情拉取失败，用成交价作为该日市价兜底
              if (!priceHistory.get(tx.ticker)?.has(dateStr)) {
                simPrice.set(tx.ticker, tx.price);
              }
              simCash -= tx.price * tx.shares;
            } else if (tx.type === 'sell') {
              simShares.set(tx.ticker, Math.max(0, (simShares.get(tx.ticker) ?? 0) - tx.shares));
              if (!priceHistory.get(tx.ticker)?.has(dateStr)) {
                simPrice.set(tx.ticker, tx.price);
              }
              simCash += tx.price * tx.shares;
            } else if (tx.type === 'dividend') {
              simCash += tx.price * tx.shares;
            }
          }

          // 2. 用历史行情更新市价（fill-forward：若当日无数据则保留上一个已知价）
          for (const ticker of uniqueTickers) {
            const p = priceHistory.get(ticker)?.get(dateStr);
            if (p !== undefined && p > 0) simPrice.set(ticker, p);
          }

          // 3. 估值 & 写入快照
          let totalValue = 0;
          for (const [ticker, shares] of simShares) {
            totalValue += shares * (simPrice.get(ticker) ?? 0);
          }
          const totalAssets = totalValue + simCash;
          const nav = totalCapital > 0 ? totalAssets / totalCapital : 1;
          const [y, mo, da] = dateStr.split('-').map(Number);

          realm.create(DailySnapshot, {
            portfolioId: pId,
            date: new Date(y, mo - 1, da),
            totalValue: totalAssets,
            cashFlow: 0,
            navPerUnit: nav,
            cumulativeReturn: nav - 1,
            maxDrawdown: 0,
            volatility: 0,
            sharpeRatio: 0,
          });
        }
      });
    }

    return { imported };
  },

  deletePortfolio: (portfolioId) => {
    const realm = getRealm();
    const pId = new Realm.BSON.ObjectId(portfolioId);
    realm.write(() => {
      // 删除流水
      const txs = realm.objects(Transaction).filtered('portfolioId == $0', pId);
      realm.delete(txs);
      // 删除持仓
      const hs = realm.objects(Holding).filtered('portfolioId == $0', pId);
      realm.delete(hs);
      // 删除组合
      const portfolio = realm.objectForPrimaryKey(Portfolio, pId);
      if (portfolio) realm.delete(portfolio);
    });
    set(state => ({
      activePortfolioId:
        state.activePortfolioId === portfolioId ? null : state.activePortfolioId,
    }));
  },

  deleteHolding: (holdingId) => {
    const realm = getRealm();
    const hId = new Realm.BSON.ObjectId(holdingId);
    realm.write(() => {
      // 删除该持仓的所有流水
      const txs = realm.objects(Transaction).filtered('holdingId == $0', hId);
      realm.delete(txs);
      // 删除持仓本身
      const holding = realm.objectForPrimaryKey(Holding, hId);
      if (holding) realm.delete(holding);
    });
  },

  saveSnapshot: (portfolioId, label) => {
    const realm = getRealm();
    const pId = new Realm.BSON.ObjectId(portfolioId);
    const portfolio = realm.objectForPrimaryKey(Portfolio, pId);
    if (!portfolio) return;

    const holdings = realm.objects(Holding).filtered('portfolioId == $0', pId);
    const dailySnaps = realm.objects(DailySnapshot).filtered('portfolioId == $0', pId);

    const transactions = realm.objects(Transaction).filtered('portfolioId == $0', pId);

    const holdingsData = Array.from(holdings).map(h => ({
      holdingId: h._id.toHexString(),
      ticker: h.ticker,
      name: h.name,
      tranche: h.tranche,
      targetWeight: h.targetWeight,
      shares: h.shares,
      avgCost: h.avgCost,
      initialShares: h.initialShares,
      initialAvgCost: h.initialAvgCost,
      currentPrice: h.currentPrice,
      isDisabled: h.isDisabled,
    }));

    const transactionsData = Array.from(transactions).map(t => ({
      transactionId: t._id.toHexString(),
      holdingId: t.holdingId.toHexString(),
      ticker: t.ticker,
      type: t.type,
      date: t.date.toISOString(),
      price: t.price,
      shares: t.shares,
      commission: t.commission,
      tax: t.tax,
      notes: t.notes,
      isImported: t.isImported,
    }));

    // DailySnapshot 每天一条，通常几十~几百条，序列化开销可接受
    const dailySnapsData = Array.from(dailySnaps).map(s => ({
      date: s.date.toISOString(),
      totalValue: s.totalValue,
      cashFlow: s.cashFlow,
      navPerUnit: s.navPerUnit,
      cumulativeReturn: s.cumulativeReturn,
      maxDrawdown: s.maxDrawdown,
      volatility: s.volatility,
      sharpeRatio: s.sharpeRatio,
    }));

    const dataJson = JSON.stringify({
      portfolio: {
        name: portfolio.name,
        investmentStyle: portfolio.investmentStyle,
        initialCapital: portfolio.initialCapital,
        currentCapital: portfolio.currentCapital,
        market: portfolio.market,
        currency: portfolio.currency,
        benchmarkIndex: portfolio.benchmarkIndex,
      },
      holdings: holdingsData,
      transactions: transactionsData,
      dailySnaps: dailySnapsData,
    });

    realm.write(() => {
      realm.create(PortfolioSnapshot, {
        portfolioId: pId,
        label: label.trim() || new Date().toLocaleString('zh-CN'),
        createdAt: new Date(),
        dataJson,
      });
    });
  },

  restoreSnapshot: (snapshotId) => {
    const realm = getRealm();
    const sId = new Realm.BSON.ObjectId(snapshotId);
    const snapshot = realm.objectForPrimaryKey(PortfolioSnapshot, sId);
    if (!snapshot) return;

    const pId = snapshot.portfolioId;
    const data = JSON.parse(snapshot.dataJson);

    realm.write(() => {
      // 1. 恢复 Portfolio 基本数据
      const portfolio = realm.objectForPrimaryKey(Portfolio, pId);
      if (portfolio && data.portfolio) {
        portfolio.name = data.portfolio.name;
        portfolio.investmentStyle = data.portfolio.investmentStyle;
        portfolio.initialCapital = data.portfolio.initialCapital;
        portfolio.currentCapital = data.portfolio.currentCapital;
        portfolio.market = data.portfolio.market;
        portfolio.currency = data.portfolio.currency;
        portfolio.benchmarkIndex = data.portfolio.benchmarkIndex;
        portfolio.updatedAt = new Date();
      }

      // 2. 删除现有 Holdings / Transactions / DailySnapshots
      realm.delete(realm.objects(Transaction).filtered('portfolioId == $0', pId));
      realm.delete(realm.objects(Holding).filtered('portfolioId == $0', pId));
      realm.delete(realm.objects(DailySnapshot).filtered('portfolioId == $0', pId));

      // 3. 重建 Holdings（保留原 _id，以便 Transaction 的 holdingId 引用正确）
      for (const h of (data.holdings ?? [])) {
        realm.create(Holding, {
          _id: new Realm.BSON.ObjectId(h.holdingId),
          portfolioId: pId,
          ticker: h.ticker,
          name: h.name,
          tranche: h.tranche,
          targetWeight: h.targetWeight,
          shares: h.shares,
          avgCost: h.avgCost,
          initialShares: h.initialShares,
          initialAvgCost: h.initialAvgCost,
          currentPrice: h.currentPrice,
          isDisabled: h.isDisabled,
        });
      }

      // 4. 重建 Transactions
      for (const t of (data.transactions ?? [])) {
        realm.create(Transaction, {
          _id: new Realm.BSON.ObjectId(t.transactionId),
          portfolioId: pId,
          holdingId: new Realm.BSON.ObjectId(t.holdingId),
          ticker: t.ticker,
          type: t.type,
          date: new Date(t.date),
          price: t.price,
          shares: t.shares,
          commission: t.commission,
          tax: t.tax,
          notes: t.notes,
          isImported: t.isImported,
        });
      }

      // 5. 重建 DailySnapshots
      for (const s of (data.dailySnaps ?? [])) {
        realm.create(DailySnapshot, {
          portfolioId: pId,
          date: new Date(s.date),
          totalValue: s.totalValue,
          cashFlow: s.cashFlow,
          navPerUnit: s.navPerUnit,
          cumulativeReturn: s.cumulativeReturn,
          maxDrawdown: s.maxDrawdown,
          volatility: s.volatility,
          sharpeRatio: s.sharpeRatio,
        });
      }
    });
  },

  deleteSnapshot: (snapshotId) => {
    const realm = getRealm();
    const sId = new Realm.BSON.ObjectId(snapshotId);
    realm.write(() => {
      const snapshot = realm.objectForPrimaryKey(PortfolioSnapshot, sId);
      if (snapshot) realm.delete(snapshot);
    });
  },

  // ── 全量备份 ──────────────────────────────────────────────
  exportAllData: () => {
    const realm = getRealm();
    const portfolios = Array.from(realm.objects(Portfolio));

    const data = portfolios.map(p => {
      const pId = p._id;
      const holdings = Array.from(realm.objects(Holding).filtered('portfolioId == $0', pId));
      const transactions = Array.from(realm.objects(Transaction).filtered('portfolioId == $0', pId));
      const dailySnaps = Array.from(realm.objects(DailySnapshot).filtered('portfolioId == $0', pId));
      const portfolioSnaps = Array.from(realm.objects(PortfolioSnapshot).filtered('portfolioId == $0', pId));

      return {
        _id: p._id.toHexString(),
        name: p.name,
        investmentStyle: p.investmentStyle,
        createdAt: p.createdAt.toISOString(),
        initialCapital: p.initialCapital,
        currentCapital: p.currentCapital,
        market: p.market,
        currency: p.currency,
        benchmarkIndex: p.benchmarkIndex,
        isArchived: p.isArchived,
        isDraft: p.isDraft,
        updatedAt: p.updatedAt.toISOString(),
        holdings: holdings.map(h => ({
          _id: h._id.toHexString(),
          ticker: h.ticker,
          name: h.name,
          tranche: h.tranche,
          targetWeight: h.targetWeight,
          shares: h.shares,
          avgCost: h.avgCost,
          initialShares: h.initialShares,
          initialAvgCost: h.initialAvgCost,
          currentPrice: h.currentPrice,
          priceUpdatedAt: h.priceUpdatedAt?.toISOString() ?? null,
          isDisabled: h.isDisabled,
        })),
        transactions: transactions.map(t => ({
          _id: t._id.toHexString(),
          holdingId: t.holdingId.toHexString(),
          ticker: t.ticker,
          type: t.type,
          date: t.date.toISOString(),
          price: t.price,
          shares: t.shares,
          commission: t.commission,
          tax: t.tax,
          notes: t.notes,
          isImported: t.isImported,
        })),
        dailySnapshots: dailySnaps.map(s => ({
          _id: s._id.toHexString(),
          date: s.date.toISOString(),
          totalValue: s.totalValue,
          cashFlow: s.cashFlow,
          navPerUnit: s.navPerUnit,
          cumulativeReturn: s.cumulativeReturn,
          maxDrawdown: s.maxDrawdown,
          volatility: s.volatility,
          sharpeRatio: s.sharpeRatio,
        })),
        portfolioSnapshots: portfolioSnaps.map(s => ({
          _id: s._id.toHexString(),
          label: s.label,
          createdAt: s.createdAt.toISOString(),
          dataJson: s.dataJson,
        })),
      };
    });

    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), portfolios: data }, null, 2);
  },

  // ── 全量恢复（覆盖所有现有数据）────────────────────────────
  importAllData: (jsonStr) => {
    const realm = getRealm();
    const backup = JSON.parse(jsonStr);
    if (!backup || backup.version !== 1 || !Array.isArray(backup.portfolios)) {
      throw new Error('备份文件格式不正确');
    }

    realm.write(() => {
      // 清空所有现有数据
      realm.delete(realm.objects(PortfolioSnapshot));
      realm.delete(realm.objects(DailySnapshot));
      realm.delete(realm.objects(Transaction));
      realm.delete(realm.objects(Holding));
      realm.delete(realm.objects(Portfolio));

      // 逐个重建
      for (const p of backup.portfolios) {
        const pId = new Realm.BSON.ObjectId(p._id);
        realm.create(Portfolio, {
          _id: pId,
          name: p.name,
          investmentStyle: p.investmentStyle ?? '',
          createdAt: new Date(p.createdAt),
          initialCapital: p.initialCapital,
          currentCapital: p.currentCapital,
          market: p.market ?? 'US',
          currency: p.currency ?? 'USD',
          benchmarkIndex: p.benchmarkIndex ?? 'SPY',
          isArchived: p.isArchived ?? false,
          isDraft: p.isDraft ?? false,
          updatedAt: new Date(p.updatedAt),
        });

        for (const h of (p.holdings ?? [])) {
          realm.create(Holding, {
            _id: new Realm.BSON.ObjectId(h._id),
            portfolioId: pId,
            ticker: h.ticker,
            name: h.name ?? '',
            tranche: h.tranche ?? 'core',
            targetWeight: h.targetWeight ?? 0,
            shares: h.shares ?? 0,
            avgCost: h.avgCost ?? 0,
            initialShares: h.initialShares ?? 0,
            initialAvgCost: h.initialAvgCost ?? 0,
            currentPrice: h.currentPrice ?? 0,
            priceUpdatedAt: h.priceUpdatedAt ? new Date(h.priceUpdatedAt) : null,
            isDisabled: h.isDisabled ?? false,
          });
        }

        for (const t of (p.transactions ?? [])) {
          realm.create(Transaction, {
            _id: new Realm.BSON.ObjectId(t._id),
            portfolioId: pId,
            holdingId: new Realm.BSON.ObjectId(t.holdingId),
            ticker: t.ticker,
            type: t.type,
            date: new Date(t.date),
            price: t.price ?? 0,
            shares: t.shares ?? 0,
            commission: t.commission ?? 0,
            tax: t.tax ?? 0,
            notes: t.notes ?? '',
            isImported: t.isImported ?? false,
          });
        }

        for (const s of (p.dailySnapshots ?? [])) {
          realm.create(DailySnapshot, {
            _id: new Realm.BSON.ObjectId(s._id),
            portfolioId: pId,
            date: new Date(s.date),
            totalValue: s.totalValue ?? 0,
            cashFlow: s.cashFlow ?? 0,
            navPerUnit: s.navPerUnit ?? 1,
            cumulativeReturn: s.cumulativeReturn ?? 0,
            maxDrawdown: s.maxDrawdown ?? 0,
            volatility: s.volatility ?? 0,
            sharpeRatio: s.sharpeRatio ?? 0,
          });
        }

        for (const ps of (p.portfolioSnapshots ?? [])) {
          realm.create(PortfolioSnapshot, {
            _id: new Realm.BSON.ObjectId(ps._id),
            portfolioId: pId,
            label: ps.label ?? '',
            createdAt: new Date(ps.createdAt),
            dataJson: ps.dataJson ?? '{}',
          });
        }
      }
    });
  },
}));
