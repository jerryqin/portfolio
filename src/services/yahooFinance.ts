/**
 * Yahoo Finance 行情服务
 * 使用 /v8/finance/chart 端点 —— 无需 crumb/cookie 认证
 * 从 meta.regularMarketPrice 提取实时价格
 */

const CHART_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';

const YF_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface QuoteResult {
  ticker: string;
  price: number;
  change: number;        // 当日涨跌额
  changePercent: number; // 当日涨跌幅 %
  previousClose: number;
  marketCap?: number;
  shortName?: string;
  currency: string;
  marketState: string; // 'REGULAR' | 'PRE' | 'POST' | 'CLOSED'
}

export interface HistoricalBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 券商代码 → Yahoo Finance 代码映射（部分券商使用不带"-"的格式）
const TICKER_MAP: Record<string, string> = {
  BRKB: 'BRK-B',
  BRKA: 'BRK-A',
};

/**
 * 获取单只股票实时报价（通过 chart meta 字段）
 */
export async function fetchQuote(rawTicker: string): Promise<QuoteResult> {
  const ticker = TICKER_MAP[rawTicker.toUpperCase()] ?? rawTicker;
  const url = `${CHART_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const response = await fetch(url, { headers: YF_HEADERS });
  if (!response.ok) {
    throw new Error(`行情请求失败 [${ticker}]: ${response.status}`);
  }
  const json = await response.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`未找到标的: ${ticker}`);

  const price: number = meta.regularMarketPrice ?? 0;
  const prevClose: number = meta.previousClose ?? meta.chartPreviousClose ?? 0;
  const change = price - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    ticker: rawTicker,   // 保持用原始 ticker，方便调用方 priceMap 匹配
    price,
    change,
    changePercent,
    previousClose: prevClose,
    currency: meta.currency ?? 'USD',
    marketState: meta.marketState ?? 'CLOSED',
    shortName: meta.shortName,
  };
}

/**
 * 批量获取多只股票报价（并发请求，单个失败不影响其他）
 */
export async function fetchBatchQuotes(
  tickers: string[],
): Promise<QuoteResult[]> {
  if (tickers.length === 0) return [];
  const results = await Promise.allSettled(tickers.map(fetchQuote));
  return results
    .filter(
      (r): r is PromiseFulfilledResult<QuoteResult> =>
        r.status === 'fulfilled',
    )
    .map(r => r.value);
}

/**
 * 获取历史 K 线数据（用于净值曲线对比）
 * @param interval '1d' | '1wk' | '1mo'
 * @param range '1mo' | '3mo' | '6mo' | '1y' | '5y' | 'max'
 */
export async function fetchHistorical(
  ticker: string,
  range: string = '1y',
  interval: string = '1d',
): Promise<HistoricalBar[]> {
  const url = `${CHART_BASE}/${encodeURIComponent(
    ticker,
  )}?range=${range}&interval=${interval}`;
  const response = await fetch(url, { headers: YF_HEADERS });
  if (!response.ok) {
    throw new Error(`历史数据请求失败 [${ticker}]: ${response.status}`);
  }
  const json = await response.json();
  const chart = json?.chart?.result?.[0];
  if (!chart) return [];

  const timestamps: number[] = chart.timestamp ?? [];
  const quotes = chart.indicators?.quote?.[0] ?? {};

  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000),
    open: quotes.open?.[i] ?? 0,
    high: quotes.high?.[i] ?? 0,
    low: quotes.low?.[i] ?? 0,
    close: quotes.close?.[i] ?? 0,
    volume: quotes.volume?.[i] ?? 0,
  }));
}

