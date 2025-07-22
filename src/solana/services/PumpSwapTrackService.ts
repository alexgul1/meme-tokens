import WebSocket from 'ws';
import * as Sentry from '@sentry/node';

type PriceUpdateCallback = (price: number) => void;

/** структура ровно как приходит от PumpPortal */
interface TradeMsg {
	signature: string;
	mint: string;
	traderPublicKey: string;
	txType: 'buy' | 'sell';
	tokenAmount: number;
	solAmount: number;
	tokensInPool: number;
	solInPool: number;
	marketCapSol: number;
	pool: string; // «pump-amm»
}

export class PumpSwapService {
	private static ws: WebSocket | null = null;
	private static connecting = false;
	private static subscribed = new Set<string>();
	private static callbacks = new Map<string, PriceUpdateCallback>();
	private static lastPrice = new Map<string, number>();

	/* ───────── public API ───────── */

	public static async subscribeToPriceUpdates(
		mint: string,
		cb: PriceUpdateCallback,
	): Promise<void> {
		this.callbacks.set(mint, cb);
		this.subscribed.add(mint);
		await this.ensureSocket();
		if (this.ws?.readyState === WebSocket.OPEN) this.sendSub(mint);
	}

	public static async unsubscribeFromPriceUpdates(mint: string): Promise<void> {
		this.lastPrice.delete(mint);
		this.callbacks.delete(mint);
		this.subscribed.delete(mint);
		if (this.ws?.readyState === WebSocket.OPEN) this.sendUnsub(mint);
	}

	public static async getTokenPrice(mint: string): Promise<number> {
		if (this.lastPrice.has(mint)) return this.lastPrice.get(mint)!;

		return new Promise<number>((resolve) => {
			const tmp = new WebSocket('wss://pumpportal.fun/api/data');
			const timer = setTimeout(() => {
				tmp.close();
				resolve(0);
			}, 100_000);

			tmp.on('open', () =>
				tmp.send(
					JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }),
				),
			);

			tmp.on('message', (raw) => {
				try {
					const tx = JSON.parse(raw.toString()) as TradeMsg;
					if (tx.mint !== mint || !['buy', 'sell'].includes(tx.txType)) return;

					const price = this.calculatePrice(tx); // формула ✔
					clearTimeout(timer);
					tmp.close();
					resolve(price || 0);
				} catch {
					/* ignore */
				}
			});

			tmp.on('error', () => {
				clearTimeout(timer);
				tmp.close();
				resolve(0);
			});
		});
	}

	/* ───────── internal ───────── */

	private static async ensureSocket() {
		if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
		if (this.connecting) return;

		this.connecting = true;
		this.ws = new WebSocket('wss://pumpportal.fun/api/data');

		this.ws.on('open', () => {
			this.connecting = false;
			for (const mint of this.subscribed) this.sendSub(mint);
		});

		// ❗теперь парсим сразу TradeMsg без «method/data» оболочки
		this.ws.on('message', (raw) => this.handleMsg(raw.toString()));

		this.ws.on('error', (err) =>
			Sentry.captureException({ message: 'PumpPortal WS error', err }),
		);

		this.ws.on('close', () => {
			this.ws = null;
			setTimeout(() => this.ensureSocket(), 1_000); // авто‑reconnect
		});
	}

	private static sendSub(mint: string) {
		this.ws?.send(
			JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }),
		);
	}

	private static sendUnsub(mint: string) {
		this.ws?.send(
			JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [mint] }),
		);
	}

	/* ——— ваш «рабочий» handleMsg, без изменений ——— */
	private static handleMsg(msg: string) {
		try {
			const tx = JSON.parse(msg) as TradeMsg;

			if (!['buy', 'sell'].includes(tx.txType)) return;
			if (!this.subscribed.has(tx.mint)) return;

			const price = this.calculatePrice(tx);
			if (!price) return;

			this.lastPrice.set(tx.mint, price);
			this.callbacks.get(tx.mint)?.(price);
		} catch {
			/* malformed → ignore */
		}
	}

	private static calculatePrice(tx: TradeMsg) {
		const priceInPoolInfo = tx.solInPool / tx.tokensInPool;

		const priceInTXInfo = tx.solAmount / tx.tokenAmount;

		return (priceInTXInfo + priceInPoolInfo) / 2;
	}
}
