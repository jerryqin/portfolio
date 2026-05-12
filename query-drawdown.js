#!/usr/bin/env node

/**
 * 数据查询脚本：从 Realm 数据库查询最大回撤详情
 * 用法：node query-drawdown.js
 */

const Realm = require('realm');
const path = require('path');

// Schema 定义（与 src/database/schema.ts 保持一致）
const PortfolioSchema = {
  name: 'Portfolio',
  primaryKey: '_id',
  properties: {
    _id: 'objectId',
    name: 'string',
    currency: { type: 'string', default: 'USD' },
    initialCapital: 'double',
    currentCapital: 'double',
    createdAt: 'date',
    isArchived: { type: 'bool', default: false },
  },
};

const DailySnapshotSchema = {
  name: 'DailySnapshot',
  primaryKey: '_id',
  properties: {
    _id: 'objectId',
    portfolioId: 'objectId',
    date: 'date',
    navPerUnit: 'double',
    totalValue: 'double',
    cumulativeReturn: 'double',
  },
};

const TransactionSchema = {
  name: 'Transaction',
  primaryKey: '_id',
  properties: {
    _id: 'objectId',
    portfolioId: 'objectId',
    ticker: 'string',
    date: 'date',
    type: 'string',
    shares: 'double',
    price: 'double',
    commission: 'double',
    tax: 'double',
  },
};

const HoldingSchema = {
  name: 'Holding',
  primaryKey: '_id',
  properties: {
    _id: 'objectId',
    portfolioId: 'objectId',
    ticker: 'string',
    shares: 'double',
    currentPrice: 'double',
    avgCost: 'double',
    tranche: 'string',
    isDisabled: { type: 'bool', default: false },
  },
};

async function queryDrawdown() {
  try {
    // 打开 Realm 数据库（使用 iOS 模拟器或本地路径）
    // 注意：真机数据无法直接在开发端访问，此脚本用于模拟环境
    const realm = await Realm.open({
      schema: [PortfolioSchema, DailySnapshotSchema, TransactionSchema, HoldingSchema],
      path: path.join(process.env.HOME, 'Library/Developer/CoreSimulator/Devices', '**', 'data/Containers/Data/Application', '**', 'Documents/portfolio.realm'),
    }).catch(() => {
      // 如果模拟器路径不存在，尝试默认路径
      return Realm.open({
        schema: [PortfolioSchema, DailySnapshotSchema, TransactionSchema, HoldingSchema],
      });
    });

    const portfolios = realm.objects('Portfolio').filtered('isArchived == false');
    if (portfolios.length === 0) {
      console.log('❌ 未找到组合数据');
      realm.close();
      return;
    }

    // 获取第一个组合（或可以指定特定组合）
    const portfolio = portfolios[0];
    console.log(`\n📊 组合：${portfolio.name} (${portfolio.currency})`);
    console.log(`初始资金：${portfolio.initialCapital.toFixed(2)}`);

    // 查询所有快照
    const snapshots = realm
      .objects('DailySnapshot')
      .filtered(`portfolioId == oid(${portfolio._id})`)
      .sorted('date');

    if (snapshots.length < 2) {
      console.log('❌ 快照数据不足（需要至少 2 个）');
      realm.close();
      return;
    }

    // 计算最大回撤详情
    const navSeries = Array.from(snapshots).map(s => s.navPerUnit);
    const dates = Array.from(snapshots).map(s => s.date);

    let peak = navSeries[0];
    let peakIdx = 0;
    let maxDD = 0;
    let bestPeakIdx = 0;
    let bestTroughIdx = 0;

    for (let i = 0; i < navSeries.length; i++) {
      const nav = navSeries[i];
      if (nav > peak) {
        peak = nav;
        peakIdx = i;
      }
      const dd = (peak - nav) / peak;
      if (dd > maxDD) {
        maxDD = dd;
        bestPeakIdx = peakIdx;
        bestTroughIdx = i;
      }
    }

    const peakNav = navSeries[bestPeakIdx];
    const peakDate = dates[bestPeakIdx];
    const troughNav = navSeries[bestTroughIdx];
    const troughDate = dates[bestTroughIdx];
    const durationDays = Math.round(
      (troughDate.getTime() - peakDate.getTime()) / 86400000
    );

    console.log(`\n🔴 最大回撤：-${(maxDD * 100).toFixed(2)}%`);
    console.log(`\n📈 峰值净值：${peakNav.toFixed(4)}`);
    console.log(`   日期：${peakDate.toLocaleDateString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    })}`);
    console.log(`\n📉 谷值净值：${troughNav.toFixed(4)}`);
    console.log(`   日期：${troughDate.toLocaleDateString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    })}`);
    console.log(`\n⏱️  回撤持续：${durationDays} 天`);
    console.log(`\n📊 数据统计`);
    console.log(`   总快照数：${snapshots.length}`);
    console.log(`   时间跨度：${dates[0].toLocaleDateString('zh-CN')} ~ ${dates[dates.length - 1].toLocaleDateString('zh-CN')}`);

    realm.close();
  } catch (error) {
    console.error('❌ 错误：', error.message);
    console.log('\n💡 提示：');
    console.log('   - 此脚本需要访问 Realm 数据库文件');
    console.log('   - 对于真机数据，请在 App 的绩效页面查看详情');
    console.log('   - 或使用 Xcode > Device > View Device Logs 导出数据');
  }
}

queryDrawdown();
