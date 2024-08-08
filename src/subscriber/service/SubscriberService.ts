import {MongoService} from '../../mongo/services/MongoService';
import {Token} from '../../mongo/types/Token';
import {IPair} from '../../dexscreener/services/IPair';
import {IJupToken, JupiterService} from '../../dex/services/JupiterService';
import {DexscreenerService} from '../../dexscreener/services/DexscreenerService';

export class SubscriberService {
	private static mongoDBInstance: MongoService
	private static maxPositiveROE: number;
	private static maxNegativeROE: number

	public static async initialization() {
		this.maxPositiveROE = parseFloat(process.env.MAX_POSITIVE_ROE as string) || 15
		this.maxNegativeROE = (parseFloat(process.env.MAX_NEGATIVE_ROE as string) || 10) * -1;

		this.mongoDBInstance = new MongoService();
		await this.mongoDBInstance.connect();


		this.subscribeToActiveFromDB();
		JupiterService.fetchTokensPriceByTimeout()
	}

	public static async subscribeToToken(tokenAddress: string, channelId: string) {
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


		if (shouldBeFinished) {
			await JupiterService.unsubscribeFromToken(token.address)
		}

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
	}

	private static async generateNewTokenData(address: string, channelId: string): Promise<Token | null> {
		const pair = await DexscreenerService.getTokenPair(address) as IPair;

		if (!pair) {
			return null
		}

		const price = await JupiterService.getTokenPrice(pair.baseToken.address);


		console.log(price)

		return {
			address: pair.baseToken.address,
			name: pair.baseToken.symbol,
			initialPrice: price?.data[pair.baseToken.address].price || 0,
			currentPrice: price?.data[pair.baseToken.address].price || 0,
			startDate: new Date(),
			lastUpdateDate: new Date(),
			parsedLink: channelId,
			provider: 'Jupiter',
			status: 'InProgress',
		}
	}
}
