import * as Sentry from '@sentry/node';
import {AccountInfo, Commitment, GetProgramAccountsFilter, PublicKey} from '@solana/web3.js';
import {CONNECTION} from '../../index';

interface PumpPoolData {
	poolBump: number;
	index: number;
	creator: PublicKey;
	baseMint: PublicKey;
	quoteMint: PublicKey;
	lpMint: PublicKey;
	poolBaseTokenAccount: PublicKey;
	poolQuoteTokenAccount: PublicKey;
	lpSupply: bigint;
	coinCreator: PublicKey;
}

type PriceUpdateCallback = (price: number) => void;


export class PumpSwapService {
	private static subscriptions: Map<string, NodeJS.Timeout> = new Map();
	private static callbacks: Map<string, PriceUpdateCallback> = new Map();
	private static poolDataCache: Map<string, PumpPoolData> = new Map();
	private static accountInfoCache: Map<string, AccountInfo<Buffer>> = new Map();
	private static SOLAddress = new PublicKey('So11111111111111111111111111111111111111112');
	private static PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

	public static async subscribeToPriceUpdates(mintAddress: string, callback: PriceUpdateCallback): Promise<void> {
		if (this.subscriptions.has(mintAddress)) {
			return;
		}

		try {
			// Store the callback
			this.callbacks.set(mintAddress, callback);

			// Get initial price
			await this.getInitialPoolState(mintAddress);

			// Start interval polling every 500ms
			const intervalId = setInterval(async () => {
				await this.processPoolUpdate(mintAddress);
			}, 500);

			this.subscriptions.set(mintAddress, intervalId);
		} catch (error) {
			Sentry.captureException({ message: 'Error during subscription', error });
			console.error('Error during subscription:', error);
		}
	}

	public static async unsubscribeFromPriceUpdates(mintAddress: string): Promise<void> {
		const intervalId = this.subscriptions.get(mintAddress);

		if (intervalId !== undefined) {
			clearInterval(intervalId);
			this.subscriptions.delete(mintAddress);
			this.callbacks.delete(mintAddress);
		}
	}

	public static async getTokenPrice(mintAddress: string): Promise<number | undefined> {
		try {
			const publicKey = new PublicKey(mintAddress);
			return await this.fetchAndParseTokenPrice(publicKey);
		} catch (error) {
			return undefined;
		}
	}

	private static async processPoolUpdate(mintAddress: string): Promise<void> {
		const price = await this.fetchAndParseTokenPrice(new PublicKey(mintAddress));

		if (!price) {
			return;
		}

		// Trigger the callback with the new price
		const callback = this.callbacks.get(mintAddress);

		if (callback) {
			callback(price as number);
		}
	}

	private static async fetchAndParseTokenPrice(mintAddress: PublicKey): Promise<number | undefined> {
		try {
			// Check cache first
			let poolData = this.poolDataCache.get(mintAddress.toBase58());

			if (!poolData) {
				poolData = await this.getPumpswapPoolData(mintAddress);
				// Cache the pool data
				this.poolDataCache.set(mintAddress.toBase58(), poolData);
			}

			// Check if accounts exist first
			const quoteAccountInfo = this.accountInfoCache.get(poolData.poolQuoteTokenAccount.toString())
				?? await CONNECTION.getAccountInfo(poolData.poolQuoteTokenAccount);
			const baseAccountInfo = this.accountInfoCache.get(poolData.poolBaseTokenAccount.toString())
				?? await CONNECTION.getAccountInfo(poolData.poolBaseTokenAccount);

			if (!quoteAccountInfo || !baseAccountInfo) {
				return undefined;
			} else {
				this.accountInfoCache.set(poolData.poolQuoteTokenAccount.toString(), quoteAccountInfo);
				this.accountInfoCache.set(poolData.poolBaseTokenAccount.toString(), baseAccountInfo);
			}

			const quoteBalance = await CONNECTION.getTokenAccountBalance(poolData.poolQuoteTokenAccount);
			const baseBalance = await CONNECTION.getTokenAccountBalance(poolData.poolBaseTokenAccount);

			if (poolData.baseMint.equals(this.SOLAddress)) {
				return (baseBalance.value.uiAmount || 0) / (quoteBalance.value.uiAmount || 0);
			} else {
				return (quoteBalance.value.uiAmount || 0) / (baseBalance.value.uiAmount || 0);
			}
		} catch (error) {
			Sentry.captureException({ message: 'Error processing token price', error, mintAddress });
			return undefined;
		}
	}

	private static async getPumpswapPoolData(mint: PublicKey): Promise<PumpPoolData> {
		console.log('get pool data from connection')
		const searchOrders: [PublicKey, PublicKey][] = [
			[mint, this.SOLAddress],
			[this.SOLAddress, mint]
		];

		for (const [tokenA, tokenB] of searchOrders) {
			const filters: GetProgramAccountsFilter[] = [
				{
					memcmp: {
						offset: 43,
						bytes: tokenA.toBase58()
					}
				},
				{
					memcmp: {
						offset: 75,
						bytes: tokenB.toBase58()
					}
				}
			];

			const response = await CONNECTION.getProgramAccounts(
				this.PUMP_AMM_PROGRAM_ID,
				{
					filters,
					encoding: 'base64',
					commitment: 'processed' as Commitment
				}
			);

			if (response.length > 0) {
				const accountData = response[0].account.data;
				const binaryData = Buffer.from(accountData as unknown as string, 'base64');
				return this.parsePumpPoolData(binaryData);
			}
		}

		throw new Error('No matching pool found');
	}

	private static parsePumpPoolData(binaryData: Buffer): PumpPoolData {
		// Skip the first 8 bytes (discriminator) and parse data from bytes 8 to 243
		const poolData = binaryData.slice(8, 243);

		if (poolData.length < 235) {
			throw new Error(`Insufficient data length: ${poolData.length}, expected at least 235 bytes`);
		}

		let offset = 0;

		// Parse according to the Python struct
		const poolBump = poolData.readUInt8(offset);
		offset += 1;

		const index = poolData.readUInt16LE(offset);
		offset += 2;

		const creator = new PublicKey(poolData.slice(offset, offset + 32));
		offset += 32;

		const baseMint = new PublicKey(poolData.slice(offset, offset + 32));
		offset += 32;

		const quoteMint = new PublicKey(poolData.slice(offset, offset + 32));
		offset += 32;

		const lpMint = new PublicKey(poolData.slice(offset, offset + 32));
		offset += 32;

		const poolBaseTokenAccount = new PublicKey(poolData.slice(offset, offset + 32));
		offset += 32;

		const poolQuoteTokenAccount = new PublicKey(poolData.slice(offset, offset + 32));
		offset += 32;

		const lpSupply = poolData.readBigUInt64LE(offset);
		offset += 8;

		const coinCreator = new PublicKey(poolData.slice(offset, offset + 32));
		offset += 32;

		return {
			poolBump,
			index,
			creator,
			baseMint,
			quoteMint,
			lpMint,
			poolBaseTokenAccount,
			poolQuoteTokenAccount,
			lpSupply,
			coinCreator
		};
	}

	private static async getInitialPoolState(mintAddress: string): Promise<void> {
		try {
			await this.processPoolUpdate(mintAddress);
		} catch (error) {
			Sentry.captureException({ message: 'Error fetching initial pool state', error });
			console.error('Error fetching initial pool state:', error);
		}
	}
}