import {AccountInfo, PublicKey} from '@solana/web3.js';

import * as Sentry from '@sentry/node';
import {CONNECTION, raydiumSdk} from '../../index';

type PriceUpdateCallback = (price: number) => void;

export class SolanaServiceV2 {
	private static subscriptions: Map<string, number> = new Map();
	private static callbacks: Map<string, PriceUpdateCallback> = new Map();
	private static SOLAddress = new PublicKey('So11111111111111111111111111111111111111112');
	
	// Throttling: не чаще 2 секунд на токен
	private static lastFetchTime: Map<string, number> = new Map();
	private static readonly THROTTLE_INTERVAL_MS = 2000; // 2 секунды
	private static pendingUpdates: Map<string, NodeJS.Timeout> = new Map();

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
			await this.getInitialPoolState(poolID);

			// Subscribe to account changes
			const subscriptionId = CONNECTION.onAccountChange(publicKey, (info) => this.handleAccountChange(info as AccountInfo<Buffer>, poolID));
			this.subscriptions.set(poolID, subscriptionId);

			console.log(`Subscribed to pool ${poolID} with subscription ID ${subscriptionId}`);
		} catch (error) {
			Sentry.captureException({message: 'Error during subscription', error});

			console.error('Error during subscription:', error);
		}
	}

	public static async unsubscribeFromPriceUpdates(poolID: string): Promise<void> {
		const subscriptionId = this.subscriptions.get(poolID);

		// Очищаем отложенные updates
		const pendingTimeout = this.pendingUpdates.get(poolID);
		if (pendingTimeout) {
			clearTimeout(pendingTimeout);
			this.pendingUpdates.delete(poolID);
		}

		// Очищаем throttling данные
		this.lastFetchTime.delete(poolID);

		if (subscriptionId !== undefined) {
			await CONNECTION.removeAccountChangeListener(subscriptionId);
			this.subscriptions.delete(poolID);
			this.callbacks.delete(poolID);
			console.log(`Unsubscribed from pool ${poolID}`);
		} else {
			console.log(`No active subscription found for pool ${poolID}`);
		}
	}

	public static async getTokenPrice(poolID: string): Promise<number|undefined> {
		try {
			const publicKey = new PublicKey(poolID);

			return 	await this.fetchAndParseTokenPrice(publicKey);
		}
		catch (error) {
			return undefined
		}
	}

	private static async handleAccountChange(info: AccountInfo<Buffer>, poolID: string): Promise<void> {
		try {
			const now = Date.now();
			const lastFetch = this.lastFetchTime.get(poolID) || 0;
			const timeSinceLastFetch = now - lastFetch;

			// Отменяем предыдущий отложенный update если есть
			const existingTimeout = this.pendingUpdates.get(poolID);
			if (existingTimeout) {
				clearTimeout(existingTimeout);
			}

			// Если прошло меньше 2 секунд - откладываем на оставшееся время
			if (timeSinceLastFetch < this.THROTTLE_INTERVAL_MS) {
				const delay = this.THROTTLE_INTERVAL_MS - timeSinceLastFetch;
				
				const timeout = setTimeout(async () => {
					this.pendingUpdates.delete(poolID);
					await this.processPoolUpdate(poolID);
				}, delay);

				this.pendingUpdates.set(poolID, timeout);
				return;
			}

			// Прошло достаточно времени - обновляем сразу
			await this.processPoolUpdate(poolID);
		} catch (error) {
			Sentry.captureException({message: 'Error during account change processing', error});
			console.error('Error during account change processing:', error);
		}
	}

	private static async processPoolUpdate( poolID: string): Promise<void> {
		// Обновляем время последнего fetch
		this.lastFetchTime.set(poolID, Date.now());

		const price = await this.fetchAndParseTokenPrice(new PublicKey(poolID));

		if (!price) {
			return
		}

		// Trigger the callback with the new price
		const callback = this.callbacks.get(poolID);

		if (callback) {
			callback(price as number);
		}
	}

	private static async fetchAndParseTokenPrice(publicKey: PublicKey): Promise<number | undefined> {
		try {
			const rawPool = await  raydiumSdk.cpmm.getPoolInfoFromRpc(publicKey.toString());

			if(rawPool.poolInfo.mintA.address === this.SOLAddress.toString()) {
				return rawPool.poolInfo.mintAmountA / rawPool.poolInfo.mintAmountB
			} else {
				return  rawPool.poolInfo.mintAmountB / rawPool.poolInfo.mintAmountA
			}
		} catch (error) {
			Sentry.captureException({message: 'Error processing token price', error, publicKey});


			console.error('Error processing token price:', publicKey);
			return undefined;
		}
	}

	private static async getInitialPoolState(poolID: string): Promise<void> {
		try {
			await this.processPoolUpdate(poolID);
		} catch (error) {
			Sentry.captureException({message: 'Error fetching initial pool state', error});


			console.error('Error fetching initial pool state:', error);
		}
	}
}
