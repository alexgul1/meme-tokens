import {AccountInfo, Connection, PublicKey, TokenAmount} from '@solana/web3.js';
import {LIQUIDITY_STATE_LAYOUT_V4, LiquidityStateV4,} from '@raydium-io/raydium-sdk';

type PriceUpdateCallback = (price: number) => void;

export class SolanaService {
	private static connection: Connection = new Connection(process.env.SOLANA_CONNECTION_URL || 'https://api.mainnet-beta.solana.com');
	private static subscriptions: Map<string, number> = new Map();
	private static callbacks: Map<string, PriceUpdateCallback> = new Map();
	private static SOLAddress = new PublicKey('So11111111111111111111111111111111111111112');

	public static async subscribeToPriceUpdates(poolID: string, callback: PriceUpdateCallback): Promise<void> {
		const publicKey = new PublicKey(poolID);

		// Check if the pool is already subscribed
		if (this.subscriptions.has(poolID)) {
			console.log(`Already subscribed to pool ${poolID}`);
			return;
		}

		try {
			// Store the callback
			this.callbacks.set(poolID, callback);

			// Get the initial pool state
			await this.getInitialPoolState(publicKey, poolID);

			// Subscribe to account changes
			const subscriptionId = this.connection.onAccountChange(publicKey, (info) => this.handleAccountChange(info as AccountInfo<Buffer>, poolID));
			this.subscriptions.set(poolID, subscriptionId);

			console.log(`Subscribed to pool ${poolID} with subscription ID ${subscriptionId}`);
		} catch (error) {
			console.error('Error during subscription:', error);
		}
	}

	public static async unsubscribeFromPriceUpdates(poolID: string): Promise<void> {
		const subscriptionId = this.subscriptions.get(poolID);


		if (subscriptionId !== undefined) {
			await this.connection.removeAccountChangeListener(subscriptionId);
			this.subscriptions.delete(poolID);
			this.callbacks.delete(poolID);
			console.log(`Unsubscribed from pool ${poolID}`);
		} else {
			console.log(`No active subscription found for pool ${poolID}`);
		}
	}

	public static async getTokenPrice(poolID: string): Promise<number|undefined> {
		const publicKey = new PublicKey(poolID);

		const info = await this.connection.getAccountInfo(publicKey);

		if (info && info.data) {
			const poolState: LiquidityStateV4 = LIQUIDITY_STATE_LAYOUT_V4.decode(info.data as Buffer);
			return 	await this.fetchAndParseTokenPrice(poolState);
		} else {
			return undefined
		}
	}

	private static async handleAccountChange(info: AccountInfo<Buffer>, poolID: string): Promise<void> {
		try {
			if (info && info.data) {
				const poolState: LiquidityStateV4 = LIQUIDITY_STATE_LAYOUT_V4.decode(info.data);
				await this.processPoolUpdate(poolState, poolID);
			} else {
				console.error('Failed to retrieve pool state on account change.');
			}
		} catch (error) {
			console.error('Error during account change processing:', error);
		}
	}

	private static async processPoolUpdate(poolState: LiquidityStateV4, poolID: string): Promise<void> {
		const price = await this.fetchAndParseTokenPrice(poolState);

		if (!price) {
			return
		}

		// Trigger the callback with the new price
		const callback = this.callbacks.get(poolID);

		if (callback) {
			callback(price as number);
		}
	}

	private static async fetchAndParseTokenPrice(poolState: LiquidityStateV4): Promise<number | undefined> {
		try {
			const baseTokenAmount = await this.connection.getTokenAccountBalance(poolState.baseVault);
			const quoteTokenAmount = await this.connection.getTokenAccountBalance(poolState.quoteVault);

			const baseTokenPrice = this.parseWalletAmount(baseTokenAmount.value);
			const quoteTokenPrice = this.parseWalletAmount(quoteTokenAmount.value);

			return poolState.baseMint.equals(this.SOLAddress)
				? baseTokenPrice / quoteTokenPrice
				: quoteTokenPrice / baseTokenPrice;
		} catch (error) {
			console.error('Error processing token price:', poolState.baseVault, poolState.quoteVault);
			return undefined;
		}
	}

	private static async getInitialPoolState(publicKey: PublicKey, poolID: string): Promise<void> {
		try {
			const info = await this.connection.getAccountInfo(publicKey);
			if (info && info.data) {
				const poolState: LiquidityStateV4 = LIQUIDITY_STATE_LAYOUT_V4.decode(info.data as Buffer);
				await this.processPoolUpdate(poolState, poolID);
			} else {
				throw new Error('Initial pool information could not be retrieved.');
			}
		} catch (error) {
			console.error('Error fetching initial pool state:', error);
		}
	}

	private static parseWalletAmount(value: TokenAmount) {
		return parseFloat(value.amount) / Math.pow(10, value.decimals)
	}
}
