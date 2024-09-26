import * as Sentry from '@sentry/node';

import {MongoService} from '../../mongo/services/MongoService';
import {Token} from '../../mongo/types/Token';
import {IPair} from '../../dexscreener/services/IPair';
import {DexscreenerService} from '../../dexscreener/services/DexscreenerService';
import {
	isCurrentDateGreaterThanStartDate
} from '../utils/isCurrentDateGreaterThanEndDate';
import {SolanaService} from '../../solana/services/SolanaService';
import RaydiumSwap, {sleep} from '../../swap/service/RaydiumSwap';
import {SHOULD_SWAP} from '../../index';
import {TelegramMessageInfo} from '../../telegram/services/TelegramUserServiceV2';
import {MessageParams, TelegramBotService} from '../../telegram/services/TelegramServices';

const processingAddresses = new Set();


export class SubscriberServiceV2 {
	private static mongoDBInstance: MongoService
	private static maxPositiveROE: number;
	private static maxNegativeROE: number

	public static async initialization() {
		this.maxPositiveROE = parseFloat(process.env.MAX_POSITIVE_ROE as string) || 15
		this.maxNegativeROE = (parseFloat(process.env.MAX_NEGATIVE_ROE as string) || 10) * -1;

		this.mongoDBInstance = new MongoService(2);
		await this.mongoDBInstance.connect();

		this.subscribeToActiveFromDB();
	}

	public static async subscribeToTokenV2(tokenAddress: string, {channelId, messageLink, isEdited}: TelegramMessageInfo) {
		const tokenInfo = await DexscreenerService.getTokenFromSearch(tokenAddress) as IPair;

		if (!tokenInfo) {
			return
		}

		if (processingAddresses.has(tokenInfo.pairAddress)) {
			Sentry.captureMessage(`SubscriberServiceV2: We processing this token ${tokenInfo.pairAddress}`);
			console.log('SubscriberServiceV2: We processing this token', tokenInfo.pairAddress, channelId)

			return;
		}

		processingAddresses.add(tokenInfo.pairAddress)

		const tokenInfoFromFinishedCollection = await this.mongoDBInstance.getEntityFromFinishedCollection({
			'address': tokenInfo.pairAddress,
			parsedLink: channelId,
		})

		if (tokenInfoFromFinishedCollection) {
			processingAddresses.delete(tokenInfo.pairAddress)

			Sentry.captureMessage(`SubscriberServiceV2: We have this combination in finished collection ${tokenInfo.pairAddress} ${channelId}`);
			console.log('SubscriberServiceV2: We have this combination in finished collection', tokenInfo.pairAddress, channelId)

			return;
		}

		let tokenInfoFromDB = await this.mongoDBInstance.getEntity('address', tokenInfo.pairAddress);

		if (!tokenInfoFromDB) {
			tokenInfoFromDB = await this.generateNewTokenData(tokenInfo, {channelId, messageLink, isEdited});

			if (tokenInfoFromDB) {
				if (SHOULD_SWAP) {
					console.time('Buy token')

					const trx = await RaydiumSwap.submitTransaction(tokenInfoFromDB.address, tokenInfoFromDB.tokenAddress, false);

					console.timeEnd('Buy token')

					sendMessageToGroup(tokenInfoFromDB, trx, false)
				}

				const newTokenPrice = await SolanaService.getTokenPrice(tokenInfoFromDB.address) as number

				await this.putNewTokenToDB({
					...tokenInfoFromDB,
					initialPrice: newTokenPrice,
					currentPrice: newTokenPrice
				})
			}
		}

		processingAddresses.delete(tokenInfo.pairAddress)

		if (tokenInfoFromDB) {
			SolanaService.subscribeToPriceUpdates(tokenInfoFromDB.address, (price) => this.handlePriceChange(tokenInfoFromDB!, price))
		}
	}

	public static async subscribeToActiveFromDB() {
		const activeSubsInDB = await this.mongoDBInstance.getEntitiesByValue('status', 'InProgress')
		console.log('SubscriberServiceV2:', activeSubsInDB)

		activeSubsInDB.forEach((token) => {
			SolanaService.subscribeToPriceUpdates(token.address, (data) => this.handlePriceChange(token, data))
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

		this.updateTokenPriceInDB(token, price, roe, shouldBeFinished)

		if (shouldBeFinished && SHOULD_SWAP) {
			RaydiumSwap.submitTransaction(token.address, token.tokenAddress, true).then(
				async (trx) => {
					sendMessageToGroup(token, trx, true)

					sleep(45000).then(() => {
						console.log('Sale of the remaining balance')
						RaydiumSwap.submitTransaction(token.address, token.tokenAddress, true).then((trx) => {
							sendMessageToGroup(token, trx, true)

							sleep(45000).then(() => {
								console.log('Sale of the remaining balance 2')
								RaydiumSwap.submitTransaction(token.address, token.tokenAddress, true).then((trx) => {
									sendMessageToGroup(token, trx, true)
								})
							})
						})
					})

				}
			)
		}

	}

	public static async updateTokenPriceInDB(token: Token, price: number, roe: number, shouldBeFinished: boolean) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		await this.mongoDBInstance.updateEntity('address', token.address, {
			currentPrice: price,
			roe,
			lastUpdateDate: new Date(),
			...(shouldBeFinished ? {
				endDate: new Date(),
				status: 'Finished',
				soldPrice: price,
			} : {})
		})

		if (shouldBeFinished) {
			await SolanaService.unsubscribeFromPriceUpdates(token.address)
			await this.mongoDBInstance.finishTokenSubscription('address', token.address)
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
			isEdited: messageInfo.isEdited,
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
		transactionLink: trxId ? `https://solscan.io/tx/${trxId}` : '',
		purchaseTime: token.startDate,
		chartLink: `https://dexscreener.com/solana/${token.address}?maker=73ErWrfKWaHXur3fsKyHxyC88DoBTVSM9j7bivJ3JPty`,
		isEdited: token.isEdited
	} as MessageParams

	TelegramBotService.sendTransactionMessage(params)
}
