import Realm from 'realm';

// ─── 1. 组合模型 ───────────────────────────────────────────
export class Portfolio extends Realm.Object<Portfolio> {
  _id!: Realm.BSON.ObjectId;
  name!: string;
  investmentStyle!: string;
  createdAt!: Date;
  initialCapital!: number;
  currentCapital!: number;      // 追加/减少后的总投入
  market!: string;              // 'US' | 'CN' | 'HK'
  currency!: string;            // 'USD' | 'CNY' | 'HKD'
  benchmarkIndex!: string;      // 'SPY' | 'HSI' | 'CSI300' 等
  isArchived!: boolean;
  isDraft!: boolean;            // 草稿模式，未激活
  updatedAt!: Date;

  static schema: Realm.ObjectSchema = {
    name: 'Portfolio',
    primaryKey: '_id',
    properties: {
      _id: { type: 'objectId', default: () => new Realm.BSON.ObjectId() },
      name: 'string',
      investmentStyle: { type: 'string', default: '' },
      createdAt: { type: 'date', default: () => new Date() },
      initialCapital: { type: 'double', default: 0 },
      currentCapital: { type: 'double', default: 0 },
      market: { type: 'string', default: 'US' },
      currency: { type: 'string', default: 'USD' },
      benchmarkIndex: { type: 'string', default: 'SPY' },
      isArchived: { type: 'bool', default: false },
      isDraft: { type: 'bool', default: true },
      updatedAt: { type: 'date', default: () => new Date() },
    },
  };
}

// ─── 2. 标的模型 ───────────────────────────────────────────
export class Holding extends Realm.Object<Holding> {
  _id!: Realm.BSON.ObjectId;
  portfolioId!: Realm.BSON.ObjectId;
  ticker!: string;              // 股票代码，如 'AAPL'
  name!: string;                // 股票名称
  tranche!: string;             // 'core' | 'satellite' | 'trading'
  targetWeight!: number;        // 目标仓位百分比 0-100
  shares!: number;              // 当前持股数
  avgCost!: number;             // 加权平均成本（每股）
  initialShares!: number;       // 建仓快照持股数（用于重置）
  initialAvgCost!: number;      // 建仓快照成本（用于重置）
  currentPrice!: number;        // 最新价格
  priceUpdatedAt!: Date | null;
  isDisabled!: boolean;         // 临时禁用（保留数据不参与统计）

  static schema: Realm.ObjectSchema = {
    name: 'Holding',
    primaryKey: '_id',
    properties: {
      _id: { type: 'objectId', default: () => new Realm.BSON.ObjectId() },
      portfolioId: 'objectId',
      ticker: 'string',
      name: { type: 'string', default: '' },
      tranche: { type: 'string', default: 'core' },
      targetWeight: { type: 'double', default: 0 },
      shares: { type: 'double', default: 0 },
      avgCost: { type: 'double', default: 0 },
      initialShares: { type: 'double', default: 0 },
      initialAvgCost: { type: 'double', default: 0 },
      currentPrice: { type: 'double', default: 0 },
      priceUpdatedAt: 'date?',
      isDisabled: { type: 'bool', default: false },
    },
  };
}

// ─── 3. 交易流水模型 ────────────────────────────────────────
export type TransactionType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'split'
  | 'rights';

export class Transaction extends Realm.Object<Transaction> {
  _id!: Realm.BSON.ObjectId;
  portfolioId!: Realm.BSON.ObjectId;
  holdingId!: Realm.BSON.ObjectId;
  ticker!: string;
  type!: TransactionType;
  date!: Date;
  price!: number;               // 每股价格
  shares!: number;              // 数量（卖出为负）
  commission!: number;          // 手续费
  tax!: number;                 // 印花税等
  notes!: string;
  isImported!: boolean;         // true = CSV 批量导入，false = 手动录入

  static schema: Realm.ObjectSchema = {
    name: 'Transaction',
    primaryKey: '_id',
    properties: {
      _id: { type: 'objectId', default: () => new Realm.BSON.ObjectId() },
      portfolioId: 'objectId',
      holdingId: 'objectId',
      ticker: 'string',
      type: 'string',
      date: { type: 'date', default: () => new Date() },
      price: { type: 'double', default: 0 },
      shares: { type: 'double', default: 0 },
      commission: { type: 'double', default: 0 },
      tax: { type: 'double', default: 0 },
      notes: { type: 'string', default: '' },
      isImported: { type: 'bool', default: false },
    },
  };
}

// ─── 4. 每日净值快照模型（用于 TWRR 计算）──────────────────
export class DailySnapshot extends Realm.Object<DailySnapshot> {
  _id!: Realm.BSON.ObjectId;
  portfolioId!: Realm.BSON.ObjectId;
  date!: Date;
  totalValue!: number;          // 当日总市值
  cashFlow!: number;            // 当日净现金流入（追加为正，撤出为负）
  navPerUnit!: number;          // 单位净值（TWRR基础）
  cumulativeReturn!: number;    // 累计收益率 %
  maxDrawdown!: number;         // 截至当日最大回撤 %
  volatility!: number;          // 年化波动率 %
  sharpeRatio!: number;         // 夏普比率

  static schema: Realm.ObjectSchema = {
    name: 'DailySnapshot',
    primaryKey: '_id',
    properties: {
      _id: { type: 'objectId', default: () => new Realm.BSON.ObjectId() },
      portfolioId: 'objectId',
      date: 'date',
      totalValue: { type: 'double', default: 0 },
      cashFlow: { type: 'double', default: 0 },
      navPerUnit: { type: 'double', default: 1 },
      cumulativeReturn: { type: 'double', default: 0 },
      maxDrawdown: { type: 'double', default: 0 },
      volatility: { type: 'double', default: 0 },
      sharpeRatio: { type: 'double', default: 0 },
    },
  };
}

// ─── 5. 操作日志模型 ────────────────────────────────────────
export class OperationLog extends Realm.Object<OperationLog> {
  _id!: Realm.BSON.ObjectId;
  portfolioId!: Realm.BSON.ObjectId;
  type!: string;  // 'create'|'rebalance'|'add_holding'|'remove_holding'|'update_weight'|'update_capital'|'archive'
  timestamp!: Date;
  description!: string;
  beforeJson!: string;          // 变更前快照（JSON字符串）
  afterJson!: string;           // 变更后快照

  static schema: Realm.ObjectSchema = {
    name: 'OperationLog',
    primaryKey: '_id',
    properties: {
      _id: { type: 'objectId', default: () => new Realm.BSON.ObjectId() },
      portfolioId: 'objectId',
      type: 'string',
      timestamp: { type: 'date', default: () => new Date() },
      description: { type: 'string', default: '' },
      beforeJson: { type: 'string', default: '{}' },
      afterJson: { type: 'string', default: '{}' },
    },
  };
}

// ─── 6. 组合快照模型 ────────────────────────────────────────
export class PortfolioSnapshot extends Realm.Object<PortfolioSnapshot> {
  _id!: Realm.BSON.ObjectId;
  portfolioId!: Realm.BSON.ObjectId;
  label!: string;               // 用户自定义标签
  createdAt!: Date;
  dataJson!: string;            // 组合+持仓+流水的完整 JSON 序列化

  static schema: Realm.ObjectSchema = {
    name: 'PortfolioSnapshot',
    primaryKey: '_id',
    properties: {
      _id: { type: 'objectId', default: () => new Realm.BSON.ObjectId() },
      portfolioId: 'objectId',
      label: { type: 'string', default: '' },
      createdAt: { type: 'date', default: () => new Date() },
      dataJson: { type: 'string', default: '{}' },
    },
  };
}

// ─── 所有 Schema 汇总 ───────────────────────────────────────
export const RealmSchema = [
  Portfolio,
  Holding,
  Transaction,
  DailySnapshot,
  OperationLog,
  PortfolioSnapshot,
];

export const REALM_SCHEMA_VERSION = 3;
