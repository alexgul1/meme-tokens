import {MongoService} from '../../mongo/services/MongoService';
import {Token} from '../../mongo/types/Token';
import {IPair} from '../../dexscreener/services/IPair';
import {IJupToken, JupiterService} from '../../dex/services/JupiterService';
import {DexscreenerService} from '../../dexscreener/services/DexscreenerService';
import {isCurrentDateGreaterThanEndDate} from '../utils/isCurrentDateGreaterThanEndDate';

export class SubscriberService {
	private static mongoDBInstance: MongoService
	private static maxPositiveROE: number;
	private static maxNegativeROE: number
	private static shouldMoveToNewDB: number;

	public static async initialization() {
		this.maxPositiveROE = parseFloat(process.env.MAX_POSITIVE_ROE as string) || 15
		this.maxNegativeROE = (parseFloat(process.env.MAX_NEGATIVE_ROE as string) || 10) * -1;
		this.shouldMoveToNewDB = parseInt(process.env.SHOULD_MOVE_TO_NEW_DB as string) || 0;

		this.mongoDBInstance = new MongoService();
		await this.mongoDBInstance.connect();

		if (this.shouldMoveToNewDB) {
			this.moveOldToNewDB();
		}

		this.subscribeToActiveFromDB();
		JupiterService.fetchTokensPriceByTimeoutV2()
	}

	public static async subscribeToToken(tokenAddress: string, channelId: string) {
		const tokenInfoFromFinishedCollection = await this.mongoDBInstance.getEntityFromFinishedCollection({
			'address': tokenAddress,
			parsedLink: channelId,
		})

		if (tokenInfoFromFinishedCollection && !isCurrentDateGreaterThanEndDate(tokenInfoFromFinishedCollection, 2)) {
			console.log('We have this combination in finished collection', tokenAddress, channelId)

			return;
		}


		let tokenInfo = await this.mongoDBInstance.getEntity('address', tokenAddress);


		if (!tokenInfo) {
			tokenInfo = await this.generateNewTokenData(tokenAddress, channelId);

			if (tokenInfo) {
				await this.putNewTokenToDB(tokenInfo)
			}

		}


		if (tokenInfo) {
			JupiterService.subscribeToTokenPriceV2(tokenAddress, (data) => this.updateTokenPriceInDB(tokenInfo!, data))

			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			// JupiterService.subscribeToTokenPrice([tokenAddress], (data) => this.updateTokenPriceInDB(tokenInfo!, data.data[tokenAddress]))
		}
	}

	public static async subscribeToPair(pairdAddress: string, channelId: string) {
		const tokenInfo = await DexscreenerService.getTokenByPair(pairdAddress) as IPair;

		if (!tokenInfo?.baseToken) {
			return
		}

		await this.subscribeToToken(tokenInfo.baseToken.address, channelId)

	}


	public static async subscribeToActiveFromDB() {
		const activeSubsInDB = await this.mongoDBInstance.getEntitiesByValue('status', 'InProgress')
		console.log(activeSubsInDB)

		activeSubsInDB.forEach((token) => {
			JupiterService.subscribeToTokenPriceV2(token.address, (data) => this.updateTokenPriceInDB(token, data))

		})
	}

	public static async putNewTokenToDB(data: Token) {
		await this.mongoDBInstance.createEntity(data);
	}

	public static async updateTokenPriceInDB(token: Token, data: IJupToken) {

		const roe = 100 * (data.price - token.initialPrice) / ((data.price + token.initialPrice) / 2)

		const shouldBeFinished = roe > this.maxPositiveROE || roe < this.maxNegativeROE

		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		await this.mongoDBInstance.updateEntity('address', data.id, {
			currentPrice: data.price,
			roe,
			lastUpdateDate: new Date(),
			...(shouldBeFinished ? {
				endDate: new Date(),
				status: 'Finished',
				soldPrice: data.price
			} : {})
		})

		if (shouldBeFinished) {
			await JupiterService.unsubscribeFromToken(token.address)
			await this.mongoDBInstance.finishTokenSubscription('address', token.address)
		}
	}

	private static async generateNewTokenData(address: string, channelId: string): Promise<Token | null> {
		const pair = await DexscreenerService.getTokenPair(address) as IPair;

		if (!pair) {
			console.log(`No pair from DexscreenerService for ${address}`)

			return null
		}

		const price = await JupiterService.getTokenPrice(pair.baseToken.address);

		const tokenDataFromJup = price?.data[pair.baseToken.address];

		if (!tokenDataFromJup) {
			console.log(`No price from JupiterService for ${address}`)

			return null
		}

		return {
			address: pair.baseToken.address,
			name: pair.baseToken.symbol,
			initialPrice: tokenDataFromJup.price || 0,
			currentPrice: tokenDataFromJup.price || 0,
			startDate: new Date(),
			lastUpdateDate: new Date(),
			parsedLink: channelId,
			provider: 'Jupiter',
			status: 'InProgress',
		}
	}

	private static async moveOldToNewDB(): Promise<void> {
		console.log('MOVE OLD TO NEW DB')

		const finishedTokensInActiveDB = await this.mongoDBInstance.getEntitiesByValue('status', 'Finished');

		for (const token of finishedTokensInActiveDB) {
			await this.mongoDBInstance.finishTokenSubscription('address', token.address)
		}
	}

	public static async putIntoDBInfoMessage(isIncluded: boolean, hasTokenAddress: boolean): Promise<void> {
		await this.mongoDBInstance.insertTelegramMessageInfo(isIncluded, isIncluded && hasTokenAddress)
	}
}
