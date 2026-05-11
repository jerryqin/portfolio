/**
 * CSV 导入解析工具
 * 支持格式：券商导出的中文 CSV（日期/交易类别/数量/说明/代号/账户类别/价格/金额）
 */

export type ImportTxType = 'buy' | 'sell' | 'dividend';

export interface ParsedRow {
  date: Date;
  type: ImportTxType;
  ticker: string;
  shares: number;
  price: number;
  amount: number;
  notes: string;
}

/** 不涉及持仓但有现金流的行（期权溢价、利息、未知类型等） */
export interface CashAdjustRow {
  date: Date;
  amount: number;   // 正数=现金流入, 负数=现金流出
  notes: string;    // rawType + 说明，用于审计
}

export interface ImportSummary {
  rows: ParsedRow[];
  tickers: string[];
  skipped: number;
  cashRows: CashAdjustRow[];  // 仅影响现金、不创建持仓记录的行
}

/** 解析带引号的 CSV 行，正确处理字段内部的逗号 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** 把 "12,377.00" / "-12,377.00" / "2,017" 这类字符串转成数字 */
function parseNumber(s: string): number {
  const cleaned = s.replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** "2026/5/6" → Date */
function parseDate(s: string): Date {
  const parts = s.split('/');
  if (parts.length !== 3) return new Date();
  const [y, m, d] = parts.map(Number);
  return new Date(y, m - 1, d);
}

/** 判断是否为期权代码（含数字，如 CEG260508P00265000） */
function isOptionTicker(ticker: string): boolean {
  return /\d/.test(ticker);
}

const TYPE_MAP: Record<string, ImportTxType | null> = {
  买进: 'buy',
  卖出: 'sell',
  股息: 'dividend',
  利息收入: null, // 跳过
};

/**
 * 解析 CSV 文本，返回有效交易行及汇总
 */
export function parseCSV(text: string): ImportSummary {
  const lines = text
    .split('\n')
    .map(l => l.replace(/\r/g, '').trim())
    .filter(Boolean);

  if (lines.length < 2) return { rows: [], tickers: [], skipped: 0 };

  // 找表头行（首行或第一行含"日期"的行）
  const headerIndex = lines.findIndex(l => l.includes('日期'));
  if (headerIndex === -1) return { rows: [], tickers: [], skipped: 0 };

  const header = parseCSVLine(lines[headerIndex]);
  const COL = {
    date:   header.indexOf('日期'),
    type:   header.indexOf('交易类别'),
    shares: header.indexOf('数量'),
    notes:  header.indexOf('说明'),
    ticker: header.indexOf('代号'),
    price:  header.indexOf('价格'),
    amount: header.indexOf('金额'),
  };

  const rows: ParsedRow[] = [];
  const cashRows: CashAdjustRow[] = [];
  let skipped = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 5) { skipped++; continue; }

    const rawType   = fields[COL.type]   ?? '';
    const rawTicker = fields[COL.ticker] ?? '';
    const rawDate   = fields[COL.date]   ?? '';
    const amount    = parseNumber(fields[COL.amount] ?? '0');
    const rawNotes  = fields[COL.notes] ?? '';

    // 完全空行（无代码、无金额）→ 真正跳过
    if (!rawTicker && amount === 0) { skipped++; continue; }

    // 期权交易（代号含数字）→ 只记录现金流，不创建持仓
    if (rawTicker && isOptionTicker(rawTicker)) {
      if (amount !== 0) {
        cashRows.push({ date: parseDate(rawDate), amount, notes: `期权 ${rawTicker} ${rawType} ${rawNotes}`.trim() });
      }
      continue;
    }

    const txType = TYPE_MAP[rawType];

    // 利息收入、未知类型 → 只记录现金流
    if (txType === undefined || txType === null) {
      if (amount !== 0) {
        cashRows.push({ date: parseDate(rawDate), amount, notes: `${rawType} ${rawTicker} ${rawNotes}`.trim() });
      } else {
        skipped++;
      }
      continue;
    }

    // 无代码行（理论上不会到这里，但保险起见）
    if (!rawTicker) { skipped++; continue; }

    const sharesRaw = parseNumber(fields[COL.shares] ?? '0');
    const shares = Math.abs(sharesRaw);
    const price  = parseNumber(fields[COL.price]  ?? '0');

    // 股息价格为0，但数量可以是0，金额不为0
    if (shares === 0 && txType !== 'dividend') { skipped++; continue; }

    rows.push({
      date: parseDate(rawDate),
      type: txType,
      ticker: rawTicker.toUpperCase(),
      shares,
      price,
      amount,
      notes: rawNotes,
    });
  }

  // 按日期升序排列（最早优先），保证 avgCost 累积正确
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  const tickers = [...new Set(rows.map(r => r.ticker))];

  return { rows, tickers, skipped, cashRows };
}
