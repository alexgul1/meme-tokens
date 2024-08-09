
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
	private static isRunning = false

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

	static async fetchTokensPriceByTimeoutV2() {
		this.isRunning = false; // Flag to check if the function is currently running

		setInterval(async () => {
			if (this.isRunning) return; // Prevent overlapping calls
			this.isRunning = true;

			const tokensQuery = Array.from(this.tokensMap.keys()).join(',')

			if (!tokensQuery) {
				this.isRunning = false;
				return
			}

			const responseData = await this.getTokenPrice(tokensQuery);

			if (!responseData?.data) {
				this.isRunning = false;
				return;
			}

			Object.values(responseData.data).forEach(tokenInfo => {
				const callback = this.tokensMap.get(tokenInfo.id);

				callback?.(tokenInfo);
			})

			this.isRunning = false; // Reset the flag after the call finishes

		}, 5000); // 5000 ms = 5 seconds
	}
}
