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
    let imported = 0;

    // 只操作已有持仓，不自动创建
    const existingHoldings = realm
      .objects(Holding)
      .filtered('portfolioId == $0 AND isDisabled == false', pId);
    const holdingMap = new Map<string, Holding>();
    for (const h of existingHoldings) {
      holdingMap.set(h.ticker, h);
    }

    // 导入前快照，用于逐日模拟净值
    const portfolioPre = realm.objectForPrimaryKey(Portfolio, pId);
    const preCapital = portfolioPre?.currentCapital ?? 0;
    const preInitialCapital = portfolioPre?.initialCapital ?? 1;
    const preHoldings = Array.from(existingHoldings).map(h => ({
      ticker: h.ticker,
      shares: h.shares,
      avgCost: h.avgCost,
      currentPrice: h.currentPrice > 0 ? h.currentPrice : h.avgCost,
    }));

    realm.write(() => {
      const portfolio = realm.objectForPrimaryKey(Portfolio, pId);

      // 查出已有的 isImported 流水（ticker + date + type + shares），用于去重
      const existingImported = realm
        .objects(Transaction)
        .filtered('portfolioId == $0 AND isImported == true', pId);
      const importedKeys = new Set<string>();
      for (const tx of existingImported) {
        const d = tx.date;
        const key = `${tx.ticker}|${tx.type}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${tx.shares}|${tx.price}`;
        importedKeys.add(key);
      }

      for (const row of rows) {
        // 不在组合持仓中的 ticker 直接跳过
        if (!holdingMap.has(row.ticker)) continue;

        // 去重：完全相同的导入记录跳过
        const d = row.date;
        const dedupKey = `${row.ticker}|${row.type}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${row.shares}|${row.price}`;
        if (importedKeys.has(dedupKey)) { continue; }
        importedKeys.add(dedupKey);

        const holding = holdingMap.get(row.ticker)!;

        // 写入交易流水
        realm.create(Transaction, {
          portfolioId: pId,
          holdingId: holding._id,
          ticker: row.ticker,
          type: row.type,
          date: row.date,
          price: row.price,
          shares: row.shares,
          commission: 0,
          tax: 0,
          notes: row.notes,
          isImported: true,
        });

        // 更新持仓状态
        if (row.type === 'buy') {
          holding.avgCost = calcAvgCost(holding.shares, holding.avgCost, row.shares, row.price);
          holding.shares += row.shares;
        } else if (row.type === 'sell') {
          holding.shares = Math.max(0, holding.shares - row.shares);
        }
        // dividend 只记录流水，不改变 shares/avgCost

        // 更新现金
        if (portfolio) {
          if (row.type === 'buy') {
            portfolio.currentCapital -= row.shares * row.price;
          } else if (row.type === 'sell') {
            portfolio.currentCapital += row.shares * row.price;
          } else if (row.type === 'dividend') {
            portfolio.currentCapital += row.amount;
          }
        }

        holding.updatedAt = new Date();
        imported++;
      }

      // 应用现金调整行（期权溢价、利息收入等）到现金余额
      if (portfolio && cashRows.length > 0) {
        for (const cr of cashRows) {
          portfolio.currentCapital += cr.amount;
        }
      }
    });

    // 逐日模拟历史净值，生成 DailySnapshot 供最大回撤/夏普计算
    const importedRows = rows.filter(r => holdingMap.has(r.ticker));
    if (importedRows.length > 0) {
      const byDate = new Map<string, typeof importedRows>();
      for (const row of importedRows) {
        const d = row.date;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!byDate.has(dateStr)) byDate.set(dateStr, []);
        byDate.get(dateStr)!.push(row);
      }
      const dates = [...byDate.keys()].sort();

      // 初始化模拟状态
      const simShares = new Map<string, number>();
      const simAvgCost = new Map<string, number>();
      const simPrice = new Map<string, number>();
      for (const h of preHoldings) {
        simShares.set(h.ticker, h.shares);
        simAvgCost.set(h.ticker, h.avgCost);
        simPrice.set(h.ticker, h.currentPrice);
      }

      // 推算 CSV 第一笔交易之前的现金量：
      // preCapital 是 CSV 全部回放完成后的现金，逆推得到起始现金，
      // 避免回放大量买入时 simCash 变负，产生虚假的净值暴跌
      let totalNetCashFlow = 0;
      for (const row of importedRows) {
        if (row.type === 'buy') totalNetCashFlow -= row.shares * row.price;
        else if (row.type === 'sell') totalNetCashFlow += row.shares * row.price;
        else if (row.type === 'dividend') totalNetCashFlow += row.amount;
      }
      // 现金调整行（期权、利息等）也计入净流入
      for (const cr of cashRows) {
        totalNetCashFlow += cr.amount;
      }

      // 按日期整理现金调整行，合并进日模拟
      const cashByDate = new Map<string, number>();
      for (const cr of cashRows) {
        const d = cr.date;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        cashByDate.set(dateStr, (cashByDate.get(dateStr) ?? 0) + cr.amount);
      }
      // simCash 起点 = 当前现金 - CSV净流入（即 CSV 开始前的现金）
      let simCash = Math.max(preCapital - totalNetCashFlow, 0);

      // 日期范围：涵盖持仓交易 + 现金调整行
      const allDates = [...new Set([...dates, ...[...cashByDate.keys()]])].sort();
      const minDate = new Date(allDates[0]);
      const maxDate = new Date(allDates[allDates.length - 1]);
      maxDate.setDate(maxDate.getDate() + 1);

      realm.write(() => {
        // 删除该日期范围内已有快照，避免重复
        const existingSnaps = realm
          .objects(DailySnapshot)
          .filtered('portfolioId == $0 AND date >= $1 AND date < $2', pId, minDate, maxDate);
        realm.delete(existingSnaps);

        for (const dateStr of allDates) {
          const dayRows = byDate.get(dateStr) ?? [];
          for (const row of dayRows) {
            simPrice.set(row.ticker, row.price);
            if (row.type === 'buy') {
              const oldShares = simShares.get(row.ticker) ?? 0;
              const oldCost = simAvgCost.get(row.ticker) ?? 0;
              simAvgCost.set(row.ticker, calcAvgCost(oldShares, oldCost, row.shares, row.price));
              simShares.set(row.ticker, oldShares + row.shares);
              simCash -= row.shares * row.price;
            } else if (row.type === 'sell') {
              const oldShares = simShares.get(row.ticker) ?? 0;
              simShares.set(row.ticker, Math.max(0, oldShares - row.shares));
              simCash += row.shares * row.price;
            } else if (row.type === 'dividend') {
              simCash += row.amount;
            }
          }
          // 当日现金调整（期权溢价、利息等）
          if (cashByDate.has(dateStr)) {
            simCash += cashByDate.get(dateStr)!;
          }

          let totalValue = 0;
          for (const [ticker, shares] of simShares) {
            totalValue += shares * (simPrice.get(ticker) ?? simAvgCost.get(ticker) ?? 0);
          }
          const totalAssets = totalValue + Math.max(simCash, 0);
          const nav = totalAssets / preInitialCapital;
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
      // 删除持仓和全部交易流水，恢复为快照时的干净状态
      realm.delete(realm.objects(Holding).filtered('portfolioId == $0', pId));
      realm.delete(realm.objects(Transaction).filtered('portfolioId == $0', pId));

      // 恢复组合元数据
      const portfolio = realm.objectForPrimaryKey(Portfolio, pId);
      if (portfolio) {
        portfolio.name = data.portfolio.name;
        portfolio.investmentStyle = data.portfolio.investmentStyle;
        portfolio.initialCapital = data.portfolio.initialCapital;
        portfolio.currentCapital = data.portfolio.currentCapital;
        portfolio.market = data.portfolio.market;
        portfolio.currency = data.portfolio.currency;
        portfolio.benchmarkIndex = data.portfolio.benchmarkIndex;
        portfolio.updatedAt = new Date();
      }

      // 重建持仓（通常只有几十条，瞬间完成）
      for (const h of data.holdings) {
        realm.create(Holding, {
          portfolioId: pId,
          ticker: h.ticker,
          name: h.name,
          tranche: h.tranche,
          targetWeight: h.targetWeight,
          shares: h.shares,
          avgCost: h.avgCost,
          initialShares: h.initialShares,
          initialAvgCost: h.initialAvgCost,
          currentPrice: h.currentPrice ?? 0,
          isDisabled: h.isDisabled,
        });
      }

      // 恢复 DailySnapshot 历史净值序列
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
