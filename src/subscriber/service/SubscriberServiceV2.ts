import * as Sentry from '@sentry/node';

import {MongoService} from '../../mongo/services/MongoService';
import {Token} from '../../mongo/types/Token';
import {IPair} from '../../dexscreener/services/IPair';
import {DexscreenerService} from '../../dexscreener/services/DexscreenerService';
import {
	isCurrentDateGreaterThanStartDate
} from '../utils/isCurrentDateGreaterThanEndDate';
import {PriceUpdateCallback, SolanaService} from '../../solana/services/SolanaService';
import RaydiumSwap, {sleep} from '../../swap/service/RaydiumSwap';
import {SHOULD_SWAP} from '../../index';
import {TelegramMessageInfo} from '../../telegram/services/TelegramUserServiceV2';
import {MessageParams, TelegramBotService} from '../../telegram/services/TelegramServices';

const processingAddresses = new Set();


export class SubscriberServiceV2 {
	private static mongoDBInstance: MongoService
	private static maxPositiveROE: number;
	private static maxNegativeROE: number;

	private static callbacksMap: Map<string, PriceUpdateCallback> = new Map();

	public static async initialization() {
		this.maxPositiveROE = parseFloat(process.env.MAX_POSITIVE_ROE as string) || 15
		this.maxNegativeROE = (parseFloat(process.env.MAX_NEGATIVE_ROE as string) || 10) * -1;

		this.mongoDBInstance = new MongoService(2);
		await this.mongoDBInstance.connect();

		this.subscribeToActiveFromDB();
	}

	public static async subscribeToTokenV2(tokenAddress: string, {channelId, messageLink}: TelegramMessageInfo) {
		const tokenInfoFromDX = await DexscreenerService.getTokenFromSearch(tokenAddress) as IPair;

		if (!tokenInfoFromDX) {
			return
		}

		if (processingAddresses.has(tokenInfoFromDX.pairAddress)) {
			Sentry.captureMessage(`SubscriberServiceV2: We processing this token ${tokenInfoFromDX.pairAddress}`);
			console.log('SubscriberServiceV2: We processing this token', tokenInfoFromDX.pairAddress, channelId)

			return;
		}

		processingAddresses.add(tokenInfoFromDX.pairAddress)

		const tokenInfoFromFinishedCollection = await this.mongoDBInstance.getEntityFromFinishedCollection({
			'address': tokenInfoFromDX.pairAddress,
			parsedLink: channelId,
		})

		if (tokenInfoFromFinishedCollection) {
			processingAddresses.delete(tokenInfoFromDX.pairAddress)

			Sentry.captureMessage(`SubscriberServiceV2: We have this combination in finished collection ${tokenInfoFromDX.pairAddress} ${channelId}`);
			console.log('SubscriberServiceV2: We have this combination in finished collection', tokenInfoFromDX.pairAddress, channelId)

			return;
		}

		let tokenInfoFromDB = await this.mongoDBInstance.getEntity({
			address: tokenInfoFromDX.pairAddress,
			parsedLink: channelId
		});

		if (!tokenInfoFromDB) {
			tokenInfoFromDB = await this.generateNewTokenData(tokenInfoFromDX, {channelId, messageLink});

			if (tokenInfoFromDB) {
				if (SHOULD_SWAP) {
					const trx = await RaydiumSwap.submitTransaction(tokenInfoFromDB.address, tokenInfoFromDB.tokenAddress, false);

					sendMessageToGroup(tokenInfoFromDB, trx, false)
				}

				await this.putNewTokenToDB(tokenInfoFromDB)
			}
		}

		processingAddresses.delete(tokenInfoFromDX.pairAddress)

		if (tokenInfoFromDB) {
			const callback: PriceUpdateCallback = (price) => this.handlePriceChange(tokenInfoFromDB!, price);

			this.callbacksMap.set(`${tokenInfoFromDB.address}::${tokenInfoFromDB.parsedLink}`, callback);

			SolanaService.subscribeToPriceUpdates(tokenInfoFromDB.address, callback)
		}
	}

	public static async subscribeToActiveFromDB() {
		const activeSubsInDB = await this.mongoDBInstance.getEntitiesByValue('status', 'InProgress')
		console.log('SubscriberServiceV2:', activeSubsInDB)

		activeSubsInDB.forEach((token) => {
			const callback: PriceUpdateCallback = (price) => this.handlePriceChange(token!, price);

			this.callbacksMap.set(`${token.address}::${token.parsedLink}`, callback);

			SolanaService.subscribeToPriceUpdates(token.address, callback)
		})
	}

	public static async putNewTokenToDB(data: Token) {
		try {
			await this.mongoDBInstance.createEntity({
				...data,
			});
		} catch (error) {
			Sentry.captureException({message: 'SubscriberServiceV2: Error when put new token to DB', error});
		}
	}

	public static async handlePriceChange(token: Token, price: number) {
		const roe = 100 * (price - token.initialPrice) / ((price + token.initialPrice) / 2)

		const shouldBeFinished = roe > this.maxPositiveROE || roe < this.maxNegativeROE
			|| isCurrentDateGreaterThanStartDate(new Date(token.startDate), 20);

		const shouldBeRemoved = isCurrentDateGreaterThanStartDate(new Date(token.startDate), 60)

		this.updateTokenPriceInDB(token, price, roe, shouldBeFinished, shouldBeRemoved)

		if (shouldBeFinished && SHOULD_SWAP) {
			RaydiumSwap.submitTransaction(token.address, token.tokenAddress, true).then(
				async (trx) => {
					sendMessageToGroup(token, trx, true)

					if (trx) {
						sleep(45000).then(() => {
							console.log('Sale of the remaining balance')
							RaydiumSwap.submitTransaction(token.address, token.tokenAddress, true).then((trx) => {
								sendMessageToGroup(token, trx, true)
							})
						})
					}
				}
			)
		}

	}

	public static async updateTokenPriceInDB(token: Token, price: number, roe: number, shouldBeFinished: boolean, shouldBeRemoved: boolean) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		await this.mongoDBInstance.updateEntity({
			address: token.address,
			parsedLink: token.parsedLink
		}, {
			currentPrice: price,
			roe,
			lastUpdateDate: new Date(),
			...(shouldBeFinished ? {
				endDate: new Date(),
				status: 'Finished',
				soldPrice: price,
			} : {}),
			...(shouldBeRemoved ? {
				status: 'Removed'
			} :{})
		})

		if (shouldBeFinished) {
			const callback = this.callbacksMap.get(`${token.address}::${token.parsedLink}`)

			await SolanaService.unsubscribeFromPriceUpdates(token.address, callback)
			await this.mongoDBInstance.finishTokenSubscription({address: token.address, parsedLink: token.parsedLink})

			this.callbacksMap.delete(`${token.address}::${token.parsedLink}`)
		}
	}

	private static async generateNewTokenData(tokenInfo: IPair, messageInfo: TelegramMessageInfo): Promise<Token | null> {
		const price = await SolanaService.getTokenPrice(tokenInfo.pairAddress);

		if (!price) {
			Sentry.captureMessage(`SubscriberServiceV2: No price from SolanaService for  ${tokenInfo.pairAddress}`);
			console.log(`SubscriberServiceV2: No price from SolanaService for ${tokenInfo.pairAddress}`)

			return null
		}

		return {
			address: tokenInfo.pairAddress,
			tokenAddress: tokenInfo.baseToken.address,
			name: tokenInfo.baseToken.symbol,
			initialPrice: price || 0,
			currentPrice: price || 0,
			startDate: new Date(),
			lastUpdateDate: new Date(),
			parsedLink: messageInfo.channelId,
			messageLink: messageInfo.messageLink,
			provider: 'Solana',
			status: 'InProgress',
		}
	}


	public static async putIntoDBInfoMessage(isIncluded: boolean, hasTokenAddress: boolean): Promise<void> {
		await this.mongoDBInstance.insertTelegramMessageInfo(isIncluded, isIncluded && hasTokenAddress)
	}
}

export const sendMessageToGroup = async (token: Token, trxId: string | undefined, isSold: boolean): Promise<void> => {
	const params = {
		token: token.name,
		action: isSold ? 'sell' : 'buy',
		signalLink: token.messageLink,
		transactionLink: `https://solscan.io/tx/${trxId}`,
		purchaseTime: token.startDate,
		chartLink: `https://dexscreener.com/solana/${token.address}?maker=Heku6jueXJxHiaDK1UFuN2cZdc9BwnBGkiuiPL26TtaX`
	} as MessageParams

	TelegramBotService.sendTransactionMessage(params)
}
