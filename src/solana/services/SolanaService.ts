import {AccountInfo, PublicKey, TokenAmount} from '@solana/web3.js';
import {
	LIQUIDITY_STATE_LAYOUT_V4,
	LiquidityStateV4,

} from '@raydium-io/raydium-sdk';
import * as Sentry from '@sentry/node';
import {CONNECTION} from '../../index';

export type PriceUpdateCallback = (price: number) => void;

export class SolanaService {
	private static subscriptions: Map<string, number> = new Map();
	private static callbacks: Map<string, Array<PriceUpdateCallback>> = new Map();
	private static SOLAddress = new PublicKey('So11111111111111111111111111111111111111112');

	public static async subscribeToPriceUpdates(poolID: string, callback: PriceUpdateCallback): Promise<void> {
		const publicKey = new PublicKey(poolID);

		// Check if the pool is already subscribed
		if (!this.subscriptions.has(poolID)) {
			try {
				// Get the initial pool state
				await this.getInitialPoolState(publicKey, poolID);

				// Subscribe to account changes
				const subscriptionId = CONNECTION.onAccountChange(publicKey, (info) => this.handleAccountChange(info as AccountInfo<Buffer>, poolID));
				this.subscriptions.set(poolID, subscriptionId);

				console.log(`Subscribed to pool ${poolID} with subscription ID ${subscriptionId}`);
			} catch (error) {
				Sentry.captureException({ message: 'Error during subscription', error });
				console.error('Error during subscription:', error);
			}
		}

		// Add the callback for this pool
		if (!this.callbacks.has(poolID)) {
			this.callbacks.set(poolID, []);
		}

		this.callbacks.get(poolID)?.push(callback);
	}

	public static async unsubscribeFromPriceUpdates(poolID: string, callback?: PriceUpdateCallback): Promise<void> {
		if (!this.subscriptions.has(poolID)) {
			console.log(`No active subscription found for pool ${poolID}`);
			return;
		}

		if (callback) {
			// Remove specific callback
			const callbackArray = this.callbacks.get(poolID);
			if (callbackArray) {
				const index = callbackArray.indexOf(callback);
				if (index > -1) {
					callbackArray.splice(index, 1);
					console.log(`Removed callback for pool ${poolID}`);
				}
			}

			// If no more callbacks are left, unsubscribe
			if (callbackArray?.length === 0) {
				const subscriptionId = this.subscriptions.get(poolID);
				await CONNECTION.removeAccountChangeListener(subscriptionId!);
				this.subscriptions.delete(poolID);
				this.callbacks.delete(poolID);
				console.log(`Unsubscribed from pool ${poolID}`);
			}
		}
	}

	public static async getTokenPrice(poolID: string): Promise<number|undefined> {
		const publicKey = new PublicKey(poolID);

		const info = await CONNECTION.getAccountInfo(publicKey);

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
				Sentry.captureException({message: 'Failed to retrieve pool state on account change.'});

				console.error('Failed to retrieve pool state on account change.');
			}
		} catch (error) {
			Sentry.captureException({message: 'Error during account change processing', error});

			console.error('Error during account change processing:', error);
		}
	}

	private static async processPoolUpdate(poolState: LiquidityStateV4, poolID: string): Promise<void> {
		const price = await this.fetchAndParseTokenPrice(poolState);

		if (!price) {
			return
		}

		// Trigger the callback with the new price
		const callbacksArray = this.callbacks.get(poolID);

		if (callbacksArray?.length) {
			callbacksArray.forEach(( callback) => callback(price as number));
		}
	}

	private static async fetchAndParseTokenPrice(poolState: LiquidityStateV4): Promise<number | undefined> {
		try {
			const baseTokenAmount = await CONNECTION.getTokenAccountBalance(poolState.baseVault);
			const quoteTokenAmount = await CONNECTION.getTokenAccountBalance(poolState.quoteVault);

			const baseTokenPrice = this.parseWalletAmount(baseTokenAmount.value);
			const quoteTokenPrice = this.parseWalletAmount(quoteTokenAmount.value);

			return poolState.baseMint.equals(this.SOLAddress)
				? baseTokenPrice / quoteTokenPrice
				: quoteTokenPrice / baseTokenPrice;
		} catch (error) {
			Sentry.captureException({message: 'Error processing token price', error, baseVault: poolState.baseVault.toString(), quoteVault: poolState.quoteVault.toString()});


			console.error('Error processing token price:', poolState.baseVault, poolState.quoteVault);
			return undefined;
		}
	}

	private static async getInitialPoolState(publicKey: PublicKey, poolID: string): Promise<void> {
		try {
			const info = await CONNECTION.getAccountInfo(publicKey);
			if (info && info.data) {
				const poolState: LiquidityStateV4 = LIQUIDITY_STATE_LAYOUT_V4.decode(info.data as Buffer);
				await this.processPoolUpdate(poolState, poolID);
			} else {
				throw new Error('Initial pool information could not be retrieved.');
			}
		} catch (error) {
			Sentry.captureException({message: 'Error fetching initial pool state', error});

			console.error('Error fetching initial pool state:', error);
		}
	}

	private static parseWalletAmount(value: TokenAmount) {
		return parseFloat(value.amount) / Math.pow(10, value.decimals)
	}
}
