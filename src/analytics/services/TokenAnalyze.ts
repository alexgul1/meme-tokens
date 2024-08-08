export class TokenAnalyze {
	private static tokenMap = new Map();

	static setNewToken(token: string, price: string): void {
		this.tokenMap.set(token, {startPrice: Number(price)})
	}

	static setCurrentPriceToToken(token: string, price: string): void {
		const tokenInMap = this.tokenMap.get(token);

		if (!tokenInMap) {
			this.setNewToken(token, price);
			return;
		}

		this.tokenMap.set(token, {...tokenInMap, currentPrice: Number(price), percent: this.calculateDiffBetweenPrices(tokenInMap.startPrice, price)})
	}

	static calculateDiffBetweenPrices(oldPrice: string, newPrice: string):number {
		return ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice)) * 100
	}

	static get array(): Map<string, object> {
		return this.tokenMap
	}

}

