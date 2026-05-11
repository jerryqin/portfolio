import { create } from 'zustand';
import Realm from 'realm';
import { Alert } from 'react-native';
import { getRealm } from '../database';
import { Portfolio, Holding, Transaction, PortfolioSnapshot, DailySnapshot } from '../database/schema';
import { fetchBatchQuotes } from '../services/yahooFinance';
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
  batchImportTransactions: (portfolioId: string, rows: ParsedRow[], cashRows?: CashAdjustRow[]) => {
    imported: number;
  };

  // 删除组合及其全部持仓、流水
  deletePortfolio: (portfolioId: string) => void;

  // 删除单个持仓及其全部流水
  deleteHolding: (holdingId: string) => void;

  // 快照管理
  saveSnapshot: (portfolioId: string, label: string) => void;
  restoreSnapshot: (snapshotId: string) => void;
  deleteSnapshot: (snapshotId: string) => void;
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
          const cash = Math.max(portfolio.currentCapital, 0);
          const totalAssets = totalValue + cash;
          const nav =
            portfolio.initialCapital > 0 ? totalAssets / portfolio.initialCapital : 1;

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

  batchImportTransactions: (portfolioId, rows, cashRows = []) => {
    const realm = getRealm();
    const pId = new Realm.BSON.ObjectId(portfolioId);

    // 只操作已有持仓，不自动创建
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
        if (!holdingMap.has(row.ticker)) continue;

        // 股息若 shares/price 均为0，将总金额编码为 price=amount, shares=1，便于后续重算
        const storedShares = (row.type === 'dividend' && row.shares === 0) ? 1 : row.shares;
        const storedPrice  = (row.type === 'dividend' && row.shares === 0) ? row.amount : row.price;

        const key = makeKey(row.ticker, row.type, row.date, storedShares, storedPrice);
        if (importedKeys.has(key)) continue;
        importedKeys.add(key);

        const holding = holdingMap.get(row.ticker)!;

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

    // ── DailySnapshot：从数据库全量已导入流水重建（幂等）──
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

      const allDates = [...byDate.keys()].sort();
      const simShares = new Map<string, number>();
      const simPrice  = new Map<string, number>();
      // 以 initialCapital 为起点做正向完整回放，彻底消除"逆推现金"的虚假回撤
      let simCash = initialCapital;

      const minDate = new Date(allDates[0]);
      const maxDate = new Date(allDates[allDates.length - 1]);
      maxDate.setDate(maxDate.getDate() + 1);

      realm.write(() => {
        const existingSnaps = realm
          .objects(DailySnapshot)
          .filtered('portfolioId == $0 AND date >= $1 AND date < $2', pId, minDate, maxDate);
        realm.delete(existingSnaps);

        for (const dateStr of allDates) {
          const dayTxs = byDate.get(dateStr)!;
          for (const tx of dayTxs) {
            if (tx.ticker === '__CASH__') {
              simCash += tx.price * tx.shares; // 现金调整行
              continue;
            }
            if (tx.type === 'buy') {
              simShares.set(tx.ticker, (simShares.get(tx.ticker) ?? 0) + tx.shares);
              simPrice.set(tx.ticker, tx.price);
              simCash -= tx.price * tx.shares;
            } else if (tx.type === 'sell') {
              simShares.set(tx.ticker, Math.max(0, (simShares.get(tx.ticker) ?? 0) - tx.shares));
              simPrice.set(tx.ticker, tx.price);
              simCash += tx.price * tx.shares;
            } else if (tx.type === 'dividend') {
              simCash += tx.price * tx.shares;
            }
          }

          let totalValue = 0;
          for (const [ticker, shares] of simShares) {
            totalValue += shares * (simPrice.get(ticker) ?? 0);
          }
          const totalAssets = totalValue + Math.max(simCash, 0);
          const nav = initialCapital > 0 ? totalAssets / initialCapital : 1;
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

    // 不序列化流水（几千条会导致 JSON 过大，恢复时 parse 阻塞 JS 线程）
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
      // 只恢复 DailySnapshot 历史净值序列，不修改当前持仓/交易/资金
      realm.delete(realm.objects(DailySnapshot).filtered('portfolioId == $0', pId));
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
}));
