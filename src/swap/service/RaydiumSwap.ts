
import {AccountLayout} from '@solana/spl-token';

import {
	Connection,
	Keypair,
	PublicKey,
	TransactionMessage,
	VersionedTransaction
} from '@solana/web3.js'
import {
	ApiPoolInfoV4, jsonInfo2PoolKeys,
	Liquidity,
	LIQUIDITY_STATE_LAYOUT_V4,
	LiquidityPoolKeys,
	Market,
	MARKET_STATE_LAYOUT_V3,
	Percent, Price,
	SPL_ACCOUNT_LAYOUT,
	SPL_MINT_LAYOUT,
	Token,
	TOKEN_PROGRAM_ID, TokenAccount,
	TokenAmount,
	TxVersion,
} from '@raydium-io/raydium-sdk'
import {Wallet} from '@coral-xyz/anchor'
import bs58 from 'bs58'

export const sleep = (waitTimeInMs: number) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));


type SwapTransaction = {
	toToken: string,
	amount: number,
	poolKeys: LiquidityPoolKeys,
	maxLamports: number,
	fixedSide: 'in' | 'out'
}

/**
 * Class representing a Raydium Swap operation.
 */
class RaydiumSwap {
	private static connection: Connection = new Connection(process.env.SOLANA_CONNECTION_URL || 'https://api.mainnet-beta.solana.com');
	private static wallet: Wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(process.env.WALLET_PRIVATE_KEY!))))
	private static SOLAddress = 'So11111111111111111111111111111111111111112';
	private static buyTokenAmount:number = Number(process.env.BUY_SOL_AMOUNT) || 0.1;
	private static SOLD_SLIPPAGE = Number(process.env.SOLD_SLIPPAGE) || 5;
	private static BUY_SLIPPAGE = Number(process.env.BUY_SLIPPAGE) || 10;


	public static async submitTransaction(pairAddress: string, tokenAddress: string, isSoldTransaction: boolean): Promise<string> {
		const jsonPoolKeys = await this.formatAmmKeysById(pairAddress)

		const poolKeys = jsonInfo2PoolKeys(jsonPoolKeys);

		let amount = isSoldTransaction ?  await RaydiumSwap.getTokensAmountInWallet(tokenAddress) : this.buyTokenAmount;

		if (isSoldTransaction && amount < 1) {
			await sleep(15000)

			amount = await RaydiumSwap.getTokensAmountInWallet(tokenAddress);

			if (!amount) {
				return '';
			}
		}

		const swapTransactionParams = {
			toToken: isSoldTransaction ? this.SOLAddress : tokenAddress,
			poolKeys,
			maxLamports: 228000,
			amount: amount,
			fixedSide: isSoldTransaction ? 'out' : 'in'
		} as SwapTransaction

		const {transaction, executionPrice} = await this.getSwapTransactionV2(swapTransactionParams)

		const txid = await RaydiumSwap.sendVersionedTransaction(transaction, 20);

		console.log(`https://solscan.io/tx/${txid}`);

		return executionPrice.toSignificant();
	}

	/**
	 * Retrieves token accounts owned by the wallet.
	 * @async
	 * @returns {Promise<TokenAccount[]>} An array of token accounts.
	 */
	public static async getOwnerTokenAccounts(): Promise<TokenAccount[]> {
		const walletTokenAccount = await this.connection.getTokenAccountsByOwner(this.wallet.publicKey, {
			programId: TOKEN_PROGRAM_ID,
		})

		return walletTokenAccount.value.map((i) => ({
			pubkey: i.pubkey,
			programId: i.account.owner,
			accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data as Buffer),
		}))
	}

	public static async getTokensAmountInWallet(token: string): Promise<number> {
		const walletTokenAccount = await this.connection.getTokenAccountsByOwner(this.wallet.publicKey, {
			mint: new PublicKey(token)
		})

		const account = walletTokenAccount?.value[0]?.account;


		if (account) {
			const accountInfo = AccountLayout.decode(account.data as Buffer);
			const amount = Number(accountInfo.amount)
			const mintAddress = accountInfo.mint

			const mintInfo = await this.connection.getParsedAccountInfo(mintAddress);
			const decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals ?? 0;
			return amount / (10 ** decimals);
		}

		return 0

	}

	public static async getSwapTransactionV2({
		toToken,
		amount,
		poolKeys,
		maxLamports,
		fixedSide = 'in'
	}: SwapTransaction): Promise<{transaction: VersionedTransaction, executionPrice: Price}> {
		const directionIn = poolKeys.quoteMint.toString() == toToken;

		const slippage= fixedSide === 'in' ? this.BUY_SLIPPAGE : this.SOLD_SLIPPAGE;

		const { minAmountOut, amountIn, executionPrice,} = await this.calcAmountOut(poolKeys, amount, directionIn, slippage);
		const userTokenAccounts = await this.getOwnerTokenAccounts();

		const swapTransaction = await Liquidity.makeSwapInstructionSimple({
			connection: this.connection,
			makeTxVersion: TxVersion.V0,
			poolKeys: {
				...poolKeys,
			},
			userKeys: {
				tokenAccounts: userTokenAccounts,
				owner: this.wallet.publicKey,
			},
			amountIn: amountIn,
			amountOut: minAmountOut,
			fixedSide: fixedSide,
			config: {
				bypassAssociatedCheck: false,
			},
			computeBudgetConfig: {
				microLamports: maxLamports,
			},
		});

		const recentBlockhashForSwap = await this.connection.getLatestBlockhash();
		const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean);

		const versionedTransaction = new VersionedTransaction(
			new TransactionMessage({
				payerKey: this.wallet.publicKey,
				recentBlockhash: recentBlockhashForSwap.blockhash,
				instructions: instructions,
			}).compileToV0Message()
		);

		versionedTransaction.sign([this.wallet.payer]);

		return {transaction:versionedTransaction, executionPrice: executionPrice!};
	}

	public static async sendVersionedTransaction(tx: VersionedTransaction, maxRetries?: number) {
		const txid = await this.connection.sendTransaction(tx, {
			skipPreflight: true,
			maxRetries: maxRetries,
		});

		return txid;
	}

	/**
	 * Simulates a versioned transaction.
	 * @async
	 * @param {VersionedTransaction} tx - The versioned transaction to simulate.
	 * @returns {Promise<any>} The simulation result.
	 */
	public static async simulateVersionedTransaction(tx: VersionedTransaction) {
		const txid = await this.connection.simulateTransaction(tx)

		return txid
	}

	/**
	 * Calculates the amount out for a swap.
	 * @async
	 * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
	 * @param {number} rawAmountIn - The raw amount of the input token.
	 * @param {boolean} swapInDirection - The direction of the swap (true for in, false for out).
	 * @param slippage
	 * @returns {Promise<Object>} The swap calculation result.
	 */
	private static async calcAmountOut(poolKeys: LiquidityPoolKeys, rawAmountIn: number, swapInDirection: boolean, slippage: number) {
		const poolInfo = await Liquidity.fetchInfo({connection: this.connection, poolKeys})

		let currencyInMint = poolKeys.baseMint
		let currencyInDecimals = poolInfo.baseDecimals
		let currencyOutMint = poolKeys.quoteMint
		let currencyOutDecimals = poolInfo.quoteDecimals

		if (!swapInDirection) {
			currencyInMint = poolKeys.quoteMint
			currencyInDecimals = poolInfo.quoteDecimals
			currencyOutMint = poolKeys.baseMint
			currencyOutDecimals = poolInfo.baseDecimals
		}

		const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
		const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
		const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)

		const slippageP = new Percent(slippage, 100) // N% slippage

		const {amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee} = Liquidity.computeAmountOut({
			poolKeys,
			poolInfo,
			amountIn,
			currencyOut,
			slippage: slippageP,
		})

		return {
			amountIn,
			amountOut,
			minAmountOut,
			currentPrice,
			executionPrice,
			priceImpact,
			fee,
		}
	}


	static async formatAmmKeysById(id: string): Promise<ApiPoolInfoV4> {
		const account = await this.connection.getAccountInfo(new PublicKey(id))
		if (account === null) throw Error(' get id info error ')
		const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data as Buffer)

		const marketId = info.marketId
		const marketAccount = await this.connection.getAccountInfo(marketId)
		if (marketAccount === null) throw Error(' get market info error')
		const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data as Buffer)

		const lpMint = info.lpMint
		const lpMintAccount = await this.connection.getAccountInfo(lpMint)
		if (lpMintAccount === null) throw Error(' get lp mint info error')
		const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data as Buffer)

		return {
			id,
			baseMint: info.baseMint.toString(),
			quoteMint: info.quoteMint.toString(),
			lpMint: info.lpMint.toString(),
			baseDecimals: Number(info.baseDecimal),
			quoteDecimals: Number(info.quoteDecimal),
			lpDecimals: lpMintInfo.decimals,
			version: 4,
			programId: account.owner.toString(),
			authority: Liquidity.getAssociatedAuthority({programId: account.owner}).publicKey.toString(),
			openOrders: info.openOrders.toString(),
			targetOrders: info.targetOrders.toString(),
			baseVault: info.baseVault.toString(),
			quoteVault: info.quoteVault.toString(),
			withdrawQueue: info.withdrawQueue.toString(),
			lpVault: info.lpVault.toString(),
			marketVersion: 3,
			marketProgramId: info.marketProgramId.toString(),
			marketId: info.marketId.toString(),
			marketAuthority: Market.getAssociatedAuthority({
				programId: info.marketProgramId,
				marketId: info.marketId
			}).publicKey.toString(),
			marketBaseVault: marketInfo.baseVault.toString(),
			marketQuoteVault: marketInfo.quoteVault.toString(),
			marketBids: marketInfo.bids.toString(),
			marketAsks: marketInfo.asks.toString(),
			marketEventQueue: marketInfo.eventQueue.toString(),
			lookupTableAccount: PublicKey.default.toString()
		}
	}

	/*
		static formatConfigInfo(id: PublicKey, account: AccountInfo<Buffer>): ApiClmmConfigItem {
			const info = AmmConfigLayout.decode(account.data)

			return {
				id: id.toBase58(),
				index: info.index,
				protocolFeeRate: info.protocolFeeRate,
				tradeFeeRate: info.tradeFeeRate,
				tickSpacing: info.tickSpacing,
				fundFeeRate: info.fundFeeRate,
				fundOwner: info.fundOwner.toString(),
				description: '',
			}
		}

		static async getMintProgram(mint: PublicKey): Promise<PublicKey> {
			const account = await this.connection.getAccountInfo(mint);
			if (account === null) throw new Error('get id info error');
			return account.owner;
		}

		static async getConfigInfo(configId: PublicKey): Promise<ApiClmmConfigItem> {
			const account = await this.connection.getAccountInfo(configId);
			if (account === null) throw new Error('get id info error');
			return this.formatConfigInfo(configId, account as AccountInfo<Buffer>);
		}

		static async formatClmmKeysById(id: string): Promise<ApiClmmPoolsItem> {
			const account = await this.connection.getAccountInfo(new PublicKey(id));
			if (account === null) throw new Error('get id info error');

			const info = PoolInfoLayout.decode(account.data as Buffer);

			const mintProgramIdA = (await RaydiumSwap.getMintProgram(info.mintA)).toString();
			const mintProgramIdB = (await RaydiumSwap.getMintProgram(info.mintB)).toString();
			const ammConfig = await RaydiumSwap.getConfigInfo(info.ammConfig);

			const rewardInfos = await Promise.all(
				info.rewardInfos
					.filter((i) => !i.tokenMint.equals(PublicKey.default))
					.map(async (i) => ({
						mint: i.tokenMint.toString(),
						programId: (await RaydiumSwap.getMintProgram(i.tokenMint)).toString(),
					}))
			);

			return {
				id,
				mintProgramIdA,
				mintProgramIdB,
				mintA: info.mintA.toString(),
				mintB: info.mintB.toString(),
				vaultA: info.vaultA.toString(),
				vaultB: info.vaultB.toString(),
				mintDecimalsA: info.mintDecimalsA,
				mintDecimalsB: info.mintDecimalsB,
				ammConfig,
				rewardInfos,
				tvl: 0,
				day: getApiClmmPoolsItemStatisticsDefault(),
				week: getApiClmmPoolsItemStatisticsDefault(),
				month: getApiClmmPoolsItemStatisticsDefault(),
				lookupTableAccount: PublicKey.default.toBase58(),
			};
		}
	*/
}

export default RaydiumSwap
