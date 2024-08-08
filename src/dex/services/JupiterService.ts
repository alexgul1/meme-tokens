
export interface IJupToken {
    id: string,
    mintSymbol: string
    price: number
    vsToken: string
    vsTokenSymbol: string
}

export interface IJupPrice {
    timeTaken: string,
    data: {
        [key: string]: IJupToken
    }
}


export class JupiterService {
	private static tokensMap = new Map();

	static async getTokenPrice(pairAddress: string): Promise<IJupPrice|null> {
		try {
			const url = `https://price.jup.ag/v6/price?ids=${pairAddress}`;

			const response  = await fetch(url);

			return await response.json() as IJupPrice

		} catch (e) {
			return null
		}
	}

	static async subscribeToTokenPriceV2(tokenAddress:string, callback:(price: IJupToken) => void) {
		if(this.tokensMap.has(tokenAddress)) {
			console.log('WE have this address in map', tokenAddress)
			return;
		}


		this.tokensMap.set(tokenAddress, callback);
	}

	static async unsubscribeFromToken(tokenAddress:string) {
		this.tokensMap.delete(tokenAddress)
	}

	static async fetchTokensPriceByTimeout() {
		try {
			const tokensQuery = Array.from(this.tokensMap.keys()).join(',')

			if (!tokensQuery) {
				setTimeout(() =>this.fetchTokensPriceByTimeout(), 5000)
			}

			const responseData = (await this.getTokenPrice(tokensQuery));

			if (!responseData?.data) {
				return;
			}

			Object.values(responseData.data).forEach(tokenInfo => {
				const callback = this.tokensMap.get(tokenInfo.id);

				callback?.(tokenInfo);
			})

			setTimeout(() =>this.fetchTokensPriceByTimeout(), 5000)

		} catch (e) {
			console.error('Error fetching Jupiter token price:', e);
			setTimeout(() => this.fetchTokensPriceByTimeout(), 5000)


		}

	}

	static async subscribeToTokenPrice(tokenAddressList: Array<string>, callback: (price: IJupPrice) => void): Promise<void> {
		try {
			const response = await this.getTokenPrice(tokenAddressList.join(','));

			if (response) {
				callback(response)
			}

			setTimeout(() => this.subscribeToTokenPrice(tokenAddressList, callback), 5000)

		} catch (error) {
			console.error('Error fetching Raydium token price:', error);
			setTimeout(() => this.subscribeToTokenPrice(tokenAddressList, callback), 5000)

		}
	}

}
